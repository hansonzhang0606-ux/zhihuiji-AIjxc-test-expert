/**
 * 系统版本功能矩阵（Demand 6.2 / 3B）
 * 权威：src/templates/模块矩阵知识库/模块矩阵总览.md「电脑端 · 功能支持矩阵」
 *
 *   node version_function_matrix.js --self-test
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { SRC_ROOT } = require('../lib/workspace');

const KB_MATRIX_MD = path.join(
  SRC_ROOT,
  'templates',
  '模块矩阵知识库',
  '模块矩阵总览.md'
);

const MATRIX_SECTION = '## 【机器区】电脑端 · 功能支持矩阵';

/** 国内系产品（用开单/单店/多店列） */
const DOMESTIC_PRODUCTS = new Set([
  '智慧记AI进销存',
  '智慧记',
  '智慧记零售'
]);

/** 国际产品（用国际单店/国际多店列；无开单版） */
const INTL_PRODUCTS = new Set(['ailit']);

const COL = {
  billing: '开单版本',
  single: '单店版本',
  multi: '多店版本',
  intlSingle: '国际单店',
  intlMulti: '国际多店'
};

const VERSION_TAG = {
  billing: '开单版',
  single: '单店版',
  multi: '多店版'
};

/**
 * @param {string} [mdPath]
 * @returns {{ source: string, rows: Map<string, object>, list: object[] }}
 */
function loadMatrix(mdPath) {
  const file = mdPath || KB_MATRIX_MD;
  if (!fs.existsSync(file)) {
    throw new Error('缺少知识库功能支持矩阵: ' + file);
  }
  const text = fs.readFileSync(file, 'utf8');
  const idx = text.indexOf(MATRIX_SECTION);
  if (idx < 0) {
    throw new Error('模块矩阵总览未找到章节: ' + MATRIX_SECTION);
  }
  const slice = text.slice(idx);
  const lines = slice.split(/\r?\n/);
  const rows = new Map();
  const list = [];
  let lastL1 = '';

  for (const line of lines) {
    if (/^##\s+/.test(line) && !line.includes('电脑端 · 功能支持矩阵')) break;
    if (!line.startsWith('|')) continue;

    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim().replace(/\*\*/g, ''));
    if (cells.length < 7) continue;

    // 跳过表头与对齐分隔行（勿用 /\|[-:\s|]+\|/，会误伤「| | 套餐 |」续行）
    if (cells[0] === '一级模块' || cells[1] === '二级模块') continue;
    if (cells.every((c) => c === '' || /^:?-{2,}:?$/.test(c))) continue;

    const l1Raw = cells[0];
    const l2 = cells[1];
    if (!l2) continue;
    if (l1Raw) lastL1 = l1Raw;
    const l1 = lastL1;
    if (!l1) continue;

    const support = {
      [COL.billing]: isSupported(cells[2]),
      [COL.single]: isSupported(cells[3]),
      [COL.multi]: isSupported(cells[4]),
      [COL.intlSingle]: isSupported(cells[5]),
      [COL.intlMulti]: isSupported(cells[6])
    };
    const key = moduleKey(l1, l2);
    const row = { module_l1: l1, module_l2: l2, support };
    rows.set(key, row);
    list.push(row);
  }

  if (rows.size === 0) {
    throw new Error('功能矩阵表解析结果为空: ' + file);
  }

  return { source: file, rows, list };
}

function isSupported(cell) {
  const s = String(cell || '').trim();
  if (s.includes('❌') || s === 'x' || s === 'X' || s === '否') return false;
  if (s.includes('✅') || s === '√' || s === '是') return true;
  return false;
}

function moduleKey(l1, l2) {
  return String(l1 || '').trim() + '|' + String(l2 || '').trim();
}

function isDomesticProduct(p) {
  return DOMESTIC_PRODUCTS.has(p);
}

function isIntlProduct(p) {
  return INTL_PRODUCTS.has(p);
}

/**
 * 查矩阵行；找不到返回 null
 * @param {{ rows: Map }} matrix
 * @param {string} l1
 * @param {string} l2
 */
function lookupModule(matrix, l1, l2) {
  return matrix.rows.get(moduleKey(l1, l2)) || null;
}

/**
 * 某产品线下，该模块允许的版本标签集合
 * @returns {{ ok: boolean, versions: Set<string>, productSupported: boolean, reason?: string }}
 */
function allowedVersionsForProduct(row, product) {
  if (!row) {
    return {
      ok: false,
      versions: new Set(),
      productSupported: false,
      reason: 'no_matrix_rule'
    };
  }
  const s = row.support;
  const versions = new Set();

  if (isIntlProduct(product)) {
    if (s[COL.intlSingle]) versions.add(VERSION_TAG.single);
    if (s[COL.intlMulti]) versions.add(VERSION_TAG.multi);
    // ailit 无开单版
    const productSupported = versions.size > 0;
    return { ok: true, versions, productSupported };
  }

  if (isDomesticProduct(product)) {
    if (s[COL.billing]) versions.add(VERSION_TAG.billing);
    if (s[COL.single]) versions.add(VERSION_TAG.single);
    if (s[COL.multi]) versions.add(VERSION_TAG.multi);
    const productSupported = versions.size > 0;
    return { ok: true, versions, productSupported };
  }

  // 未知产品：不裁剪版本，视为产品仍保留
  return {
    ok: true,
    versions: new Set([
      VERSION_TAG.billing,
      VERSION_TAG.single,
      VERSION_TAG.multi
    ]),
    productSupported: true,
    reason: 'unknown_product'
  };
}

/**
 * 合并多个产品下的允许版本
 */
function allowedVersionsForProducts(row, products) {
  const allowed = new Set();
  let anyKnown = false;
  const unsupportedProducts = [];

  for (const p of products) {
    const r = allowedVersionsForProduct(row, p);
    if (r.reason === 'no_matrix_rule') {
      return {
        ok: false,
        versions: new Set(),
        unsupportedProducts: [],
        reason: 'no_matrix_rule'
      };
    }
    anyKnown = true;
    if (!r.productSupported && (isDomesticProduct(p) || isIntlProduct(p))) {
      unsupportedProducts.push(p);
    }
    for (const v of r.versions) allowed.add(v);
  }

  // ailit 强制去掉开单版
  if (products.some(isIntlProduct)) {
    allowed.delete(VERSION_TAG.billing);
  }

  return {
    ok: anyKnown,
    versions: allowed,
    unsupportedProducts,
    reason: null
  };
}

function runSelfTest() {
  let failed = 0;
  const m = loadMatrix();
  console.log('[matrix] rows=' + m.list.length + ' source=' + m.source);

  const tao = lookupModule(m, '商品', '套餐');
  if (!tao || tao.support[COL.billing] !== false || tao.support[COL.single] !== true) {
    console.log('✗ 套餐矩阵');
    failed++;
  } else console.log('✓ 套餐：开单❌ 单店✅');

  const store = lookupModule(m, '设置', '门店管理');
  if (
    !store ||
    store.support[COL.billing] !== false ||
    store.support[COL.single] !== false ||
    store.support[COL.multi] !== true
  ) {
    console.log('✗ 门店管理矩阵');
    failed++;
  } else console.log('✓ 门店管理：仅多店✅');

  const decor = lookupModule(m, '云店', '云店装修');
  const intl = allowedVersionsForProduct(decor, 'ailit');
  if (intl.productSupported !== false) {
    console.log('✗ 云店装修国际应不支持');
    failed++;
  } else console.log('✓ 云店装修：国际不支持');

  const sale = lookupModule(m, '销售', '销售');
  const ailitSale = allowedVersionsForProduct(sale, 'ailit');
  if (ailitSale.versions.has(VERSION_TAG.billing)) {
    console.log('✗ ailit 不应有开单版');
    failed++;
  } else console.log('✓ ailit 销售无开单版');

  if (failed) {
    console.error('self-test failed: ' + failed);
    process.exit(1);
  }
  console.log('version_function_matrix self-test OK');
}

module.exports = {
  KB_MATRIX_MD,
  DOMESTIC_PRODUCTS,
  INTL_PRODUCTS,
  COL,
  VERSION_TAG,
  loadMatrix,
  lookupModule,
  moduleKey,
  allowedVersionsForProduct,
  allowedVersionsForProducts,
  isDomesticProduct,
  isIntlProduct
};

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) runSelfTest();
  else {
    const m = loadMatrix();
    console.log(JSON.stringify({ count: m.list.length, sample: m.list.slice(0, 3) }, null, 2));
  }
}
