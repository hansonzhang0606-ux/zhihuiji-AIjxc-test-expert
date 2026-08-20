/**
 * Demand 6.2 — 模块分层与支持矩阵解析。
 *
 * 模块分层为知识库的模块名真源；需求如何匹配模块仍由 stage3 的
 * module_mapping 处理。本模块只做分层校验与端支持裁剪。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { SRC_ROOT } = require('./workspace');

const DEFAULT_MATRIX_PATH = path.join(
  SRC_ROOT,
  'templates',
  '模块矩阵知识库',
  '模块矩阵总览.md'
);

const SUPPORT_VALUES = new Set(['支持', '不支持', '部分支持', '未知']);
const PLATFORM_MAP = Object.freeze({
  web: 'web',
  'pc': 'web',
  'pc端': 'web',
  '电脑端': 'web',
  '电脑端（web）': 'web',
  app: 'app',
  'app端': 'app',
  '小程序': '小程序',
  '小程序端': '小程序'
});

function parseTableRow(line) {
  if (!line.trim().startsWith('|')) return null;
  const cells = line
    .trim()
    .split('|')
    .slice(1, -1)
    .map(cell => cell.trim());
  if (!cells.length || cells.every(cell => /^-+$/.test(cell))) return null;
  return cells;
}

function splitModules(value) {
  return String(value || '')
    .split(/[、，,]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizePlatform(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return PLATFORM_MAP[normalized] || null;
}

function normalizeSupport(value) {
  const text = String(value || '').trim();
  return SUPPORT_VALUES.has(text) ? text : null;
}

function parseMatrixText(text, sourcePath) {
  const layers = [];
  const moduleMap = new Map();
  const supports = new Map();
  const errors = [];
  const lines = String(text || '').split(/\r?\n/);
  let section = null;
  let header = null;

  for (const raw of lines) {
    const line = raw.trim();
    const heading = line.match(/^##\s+【机器区】(.+)$/);
    if (heading) {
      section = heading[1];
      header = null;
      continue;
    }
    if (/^##\s+/.test(line)) {
      section = null;
      header = null;
      continue;
    }
    const row = parseTableRow(line);
    if (!row || !section) continue;

    if (!header) {
      header = row;
      continue;
    }

    if (section === '模块分层') {
      if (header[0] !== '一级模块' || header[1] !== '二级模块') {
        errors.push('模块分层表头必须为「一级模块 | 二级模块」');
        section = null;
        continue;
      }
      const [l1, rawL2] = row;
      if (!l1 || !rawL2) {
        errors.push('模块分层存在空的一级或二级模块');
        continue;
      }
      const l2s = splitModules(rawL2);
      if (!l2s.length) {
        errors.push(`一级模块「${l1}」没有有效二级模块`);
        continue;
      }
      for (const l2 of l2s) {
        if (moduleMap.has(l2) && moduleMap.get(l2) !== l1) {
          errors.push(`二级模块「${l2}」同时属于「${moduleMap.get(l2)}」和「${l1}」`);
          continue;
        }
        moduleMap.set(l2, l1);
      }
      layers.push({ l1, l2s });
      continue;
    }

    if (section === '模块支持矩阵') {
      const expected = ['一级模块', '二级模块', 'web', 'app', '小程序', '产品版本'];
      if (expected.some((name, index) => header[index] !== name)) {
        errors.push('模块支持矩阵表头必须为「一级模块 | 二级模块 | web | app | 小程序 | 产品版本」');
        section = null;
        continue;
      }
      const [l1, l2, web, app, miniProgram, version] = row;
      if (!l1 || !l2) {
        errors.push('模块支持矩阵存在空的一级或二级模块');
        continue;
      }
      const cells = { web, app, 小程序: miniProgram, 产品版本: version };
      for (const [dimension, value] of Object.entries(cells)) {
        if (!normalizeSupport(value)) {
          errors.push(`模块支持矩阵「${l1}/${l2}」的 ${dimension} 值非法：「${value}」`);
        }
      }
      supports.set(`${l1}\u0000${l2}`, { l1, l2, ...cells });
    }
  }

  if (!layers.length) errors.push('未找到【机器区】模块分层');
  return {
    source_path: sourcePath || null,
    layers,
    module_map: moduleMap,
    supports,
    errors
  };
}

function loadMatrix(matrixPath = DEFAULT_MATRIX_PATH) {
  const abs = path.resolve(matrixPath);
  if (!fs.existsSync(abs)) throw new Error(`模块矩阵不存在: ${abs}`);
  const matrix = parseMatrixText(fs.readFileSync(abs, 'utf8'), abs);
  if (matrix.errors.length) {
    throw new Error('模块矩阵解析失败: ' + matrix.errors.join('；'));
  }
  return matrix;
}

function validateModule(matrix, l1, l2) {
  const actualL1 = matrix.module_map.get(l2);
  if (!actualL1) return { ok: false, reason: `二级模块「${l2}」不在模块分层中` };
  if (l1 && l1 !== actualL1) {
    return { ok: false, reason: `二级模块「${l2}」应属于一级模块「${actualL1}」，而非「${l1}」` };
  }
  return { ok: true, l1: actualL1, l2 };
}

function resolveSupport(matrix, l1, l2, platform) {
  const module = validateModule(matrix, l1, l2);
  if (!module.ok) return { ...module, support: '未知', warning: module.reason };
  const normalizedPlatform = normalizePlatform(platform);
  if (!normalizedPlatform) {
    return { ok: false, support: '未知', warning: `不支持的端标识: ${platform}` };
  }
  const row = matrix.supports.get(`${module.l1}\u0000${module.l2}`);
  const support = row ? row[normalizedPlatform] : '未知';
  return {
    ok: true,
    l1: module.l1,
    l2: module.l2,
    platform: normalizedPlatform,
    support,
    supported: support !== '不支持',
    partial: support === '部分支持',
    warning: support === '未知' ? `模块支持未知: ${module.l1}/${module.l2}/${normalizedPlatform}` : null
  };
}

function runSelfTest() {
  const matrix = loadMatrix();
  const sale = validateModule(matrix, '销售', '销售');
  const wrong = validateModule(matrix, '商品', '销售');
  const app = resolveSupport(matrix, '销售', '销售', 'APP端');
  const unknown = resolveSupport(matrix, '商品', '商品', 'web');
  const checks = [
    [matrix.module_map.size >= 68, '模块分层可解析'],
    [sale.ok, 'L1/L2 归属校验'],
    [!wrong.ok, '错误 L1/L2 被拒绝'],
    [app.ok && app.support === '支持', '端支持读取'],
    [unknown.ok && unknown.support === '未知' && !!unknown.warning, '缺失矩阵行保持未知']
  ];
  let failed = 0;
  for (const [ok, name] of checks) {
    console.log(`${ok ? '✓' : '✗'} ${name}`);
    if (!ok) failed++;
  }
  if (failed) process.exit(1);
}

module.exports = {
  DEFAULT_MATRIX_PATH,
  SUPPORT_VALUES,
  normalizePlatform,
  normalizeSupport,
  parseMatrixText,
  loadMatrix,
  validateModule,
  resolveSupport
};

if (require.main === module) {
  if (process.argv.includes('--self-test')) runSelfTest();
  else console.log('用法: node lib/kb_matrix.js --self-test');
}
