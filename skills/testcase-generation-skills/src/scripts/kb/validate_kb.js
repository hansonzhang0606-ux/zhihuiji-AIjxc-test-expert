/**
 * Demand 6.2 — 知识库 Markdown 结构校验。
 *
 *   node kb/validate_kb.js --kb-root <知识库根>
 *   node kb/validate_kb.js --self-test
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DEFAULT_KB_ROOT, parseFrontmatter, parsePageRelation } = require('./rebuild_index');
const { loadMatrix, normalizePlatform, validateModule } = require('../lib/kb_matrix');
const {
  ELEMENT_HEADERS_LEGACY,
  ELEMENT_HEADERS_V63,
  ELEMENT_HEADERS_V64,
  headersEqual,
  parseWebCompareTables,
  parseElementTables
} = require('../../../skills/knowledge-base/scripts/core/markdown_model');

const PAGE_ROLES = new Set(['主页面', '核心子页面', '子页面']);
const PAGE_STATUSES = new Set(['草稿', '待确认', '已确认', '已废弃']);

function tableRowsUnder(lines, heading) {
  let active = false;
  let header = null;
  const rows = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.trim() === heading) {
      active = true;
      header = null;
      continue;
    }
    if (active && /^#{1,6}\s/.test(line)) break;
    if (!active || !line.trim().startsWith('|')) continue;
    const cells = line.trim().split('|').slice(1, -1).map(v => v.trim());
    if (!header) {
      header = cells;
      continue;
    }
    if (cells.every(v => /^-+$/.test(v))) continue;
    rows.push({ cells, line: index + 1, header });
  }
  return { header, rows };
}

function readDirNames(dir) {
  return fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => item.name)
    : [];
}

function isSkeletonPageRow(page) {
  const id = String(page && page.page_id || '').trim();
  const role = String(page && page.role || '').trim();
  return !id || id === '（待补充）' || id === '待补充' || /^[—\-]+$/.test(id) || role === '—' || role === '-';
}

function validateRelationFile(file, l1, l2, errors, warnings = []) {
  const text = fs.readFileSync(file, 'utf8');
  const rawPages = parsePageRelation(file);
  const skeletonCount = rawPages.filter(isSkeletonPageRow).length;
  const pages = rawPages.filter(page => !isSkeletonPageRow(page));
  if (!pages.length) {
    // 云店等新增骨架模块可仅保留占位行；不阻断 apply / 索引重建
    if (skeletonCount > 0 || /状态\s*\|\s*待确认/.test(text) || /\|\s*待确认\s*\|/.test(text)) {
      warnings.push(`${file}: 页面清单为空或仅骨架占位（待确认模块）`);
      return new Map();
    }
    errors.push(`${file}: 缺少「## 1. 页面清单（跨端统一页面名称）」或有效页面行`);
    return new Map();
  }
  const map = new Map();
  for (const page of pages) {
    if (!page.page_id.endsWith('页')) errors.push(`${file}: 页面「${page.page_id}」须以「页」结尾`);
    if (!PAGE_ROLES.has(page.role)) errors.push(`${file}: 页面「${page.page_id}」角色非法: ${page.role}`);
    if (!page.platforms.length) errors.push(`${file}: 页面「${page.page_id}」支持端非法`);
    if (map.has(page.page_id)) errors.push(`${file}: 页面清单重复: ${page.page_id}`);
    map.set(page.page_id, page);
  }

  for (const platform of [{ name: '电脑端（Web）', code: 'web' }, { name: 'APP端', code: 'app' }]) {
    const jump = tableRowsUnder(text.split(/\r?\n/), `### ${platform.name}\n### 2.2 跳转路径`);
    // 表结构标题不是相邻同一行，改用通用搜索处理，下面的路径校验只检查所有三列表。
    void jump;
  }
  const pathRows = [];
  const lines = text.split(/\r?\n/);
  let inPaths = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '### 2.2 跳转路径' || lines[i].trim() === '### 3.2 跳转路径') {
      inPaths = true;
      continue;
    }
    if (inPaths && /^#{1,3}\s/.test(lines[i])) {
      inPaths = false;
      continue;
    }
    if (!inPaths || !lines[i].trim().startsWith('|')) continue;
    const cells = lines[i].trim().split('|').slice(1, -1).map(v => v.trim());
    if (cells[0] === '起点' || cells.every(v => /^-+$/.test(v))) continue;
    pathRows.push({ cells, line: i + 1 });
  }
  for (const row of pathRows) {
    if (row.cells.length !== 3) errors.push(`${file}:L${row.line} 跳转路径必须三列`);
    for (const pageId of [row.cells[0], row.cells[2]]) {
      if (pageId && !map.has(pageId)) {
        // 跨模块页允许不在本模块页面清单，但必须是明确页名。
        if (!pageId.endsWith('页')) errors.push(`${file}:L${row.line} 跳转目标「${pageId}」不是合法页面名`);
      }
    }
  }

  // Demand 6.3：Web 对照表兼容 2/3 列；缺 URL 列仅 warning
  const webCompare = parseWebCompareTables(text);
  for (const w of webCompare.warnings) warnings.push(`${file}: ${w}`);
  for (const row of webCompare.rows) {
    for (const err of row.errors || []) errors.push(`${file}:L${row.line} ${err}`);
    if (row.schema === 'legacy') {
      warnings.push(`${file}:L${row.line} Web 对照表缺「前端 URL 模板」列（兼容读取）`);
    } else if (!row.urls.length) {
      warnings.push(`${file}:L${row.line} 页面「${row.page_id}」缺前端 URL（迁移期不阻断）`);
    }
  }
  return map;
}

function validateElementFile(file, expected, l1, l2, errors, warnings = []) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const meta = parseFrontmatter(text);
  if (meta['页面标识'] !== expected.page_id) errors.push(`${file}: 页面标识须为「${expected.page_id}」`);
  if (meta['页面角色'] !== expected.role) errors.push(`${file}: 页面角色须与页面关系一致`);
  if (!PAGE_STATUSES.has(meta['状态'])) errors.push(`${file}: 状态须为 草稿/待确认/已确认/已废弃`);
  if (meta['一级模块'] !== l1 || meta['二级模块'] !== l2) errors.push(`${file}: frontmatter 模块归属不一致`);
  if (/^##\s+入口/m.test(text)) errors.push(`${file}: 元素文件禁止入口节`);

  const filename = path.basename(file);
  if (!filename.endsWith(`${expected.page_id}.md`)) errors.push(`${file}: 文件名须以统一页面名称结尾`);

  for (const platform of [{ heading: '## 电脑端', code: 'web' }, { heading: '## APP端', code: 'app' }]) {
    const start = lines.findIndex(line => line.trim() === platform.heading);
    if (start < 0) continue;
    if (!expected.platforms.includes(platform.code)) {
      errors.push(`${file}: 存在不受支持端的内容节 ${platform.heading}`);
    }
    const next = lines.slice(start + 1).findIndex(line => /^##\s/.test(line));
    const section = lines.slice(start, next < 0 ? undefined : start + 1 + next);
    const table = tableRowsUnder(section, '### 核心元素');
    const legacyOk = headersEqual(table.header, ELEMENT_HEADERS_LEGACY);
    const v63Ok = headersEqual(table.header, ELEMENT_HEADERS_V63);
    const v64Ok = headersEqual(table.header, ELEMENT_HEADERS_V64);
    if (!table.header || (!legacyOk && !v63Ok && !v64Ok)) {
      errors.push(
        `${file}: ${platform.heading} 的核心元素表头须为 6 列旧表、7 列（含后端接口）或 8 列（含展示内容）新表`
      );
      continue;
    }
    if (legacyOk) {
      warnings.push(`${file}: ${platform.heading} 缺「后端接口」列（兼容读取）`);
    }
    if (!table.rows.length) errors.push(`${file}: ${platform.heading} 不得保留空核心元素节`);
  }

  // 解析层敏感值 / 非法 API
  const parsed = parseElementTables(text);
  for (const p of parsed.platforms) {
    for (const el of p.elements || []) {
      for (const err of el.api_errors || []) errors.push(`${file}:L${el.line} ${err}`);
    }
  }
}

function validateKb(kbRoot = DEFAULT_KB_ROOT) {
  const root = path.resolve(kbRoot);
  const errors = [];
  const warnings = [];
  let matrix;
  try {
    matrix = loadMatrix(path.join(root, '模块矩阵总览.md'));
  } catch (error) {
    return { ok: false, errors: [error.message], warnings, stats: {} };
  }

  let relationFiles = 0;
  let elementFiles = 0;
  for (const [l2, l1] of matrix.module_map.entries()) {
    const dir = path.join(root, l1, l2);
    const relation = path.join(dir, '页面关系.md');
    if (!fs.existsSync(relation)) continue;
    relationFiles++;
    const pages = validateRelationFile(relation, l1, l2, errors, warnings);
    for (const page of pages.values()) {
      const matches = ['主页面_', '子页面_']
        .map(prefix => path.join(dir, `${prefix}${page.page_id}.md`))
        .filter(fs.existsSync);
      if (matches.length > 1) errors.push(`${dir}: 页面「${page.page_id}」存在多个元素文件`);
      if (matches.length === 1) {
        elementFiles++;
        validateElementFile(matches[0], page, l1, l2, errors, warnings);
      }
    }
    for (const name of readDirNames(dir)) {
      warnings.push(`${dir}: 忽略非文件目录「${name}」`);
    }
  }

  return { ok: errors.length === 0, errors, warnings, stats: { relation_files: relationFiles, element_files: elementFiles } };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--kb-root' && argv[i + 1]) out.kbRoot = argv[++i];
    else if (argv[i] === '--self-test') out.selfTest = true;
    else if (argv[i] === '--help' || argv[i] === '-h') out.help = true;
  }
  return out;
}

function runSelfTest() {
  const result = validateKb(DEFAULT_KB_ROOT);
  console.log(`${result.ok ? '✓' : '✗'} 样例知识库结构校验`);
  if (!result.ok) console.error(result.errors.join('\n'));
  const normalized = normalizePlatform('PC端') === 'web' && normalizePlatform('APP端') === 'app';
  console.log(`${normalized ? '✓' : '✗'} 端标识规范化`);
  if (!result.ok || !normalized) process.exitCode = 1;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log('用法: node kb/validate_kb.js --kb-root <知识库根>');
  if (args.selfTest) return runSelfTest();
  const result = validateKb(args.kbRoot || DEFAULT_KB_ROOT);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

module.exports = { validateKb, validateRelationFile, validateElementFile };
if (require.main === module) main();
