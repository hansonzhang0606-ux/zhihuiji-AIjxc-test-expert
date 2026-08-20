/**
 * 共享模块匹配 Tool（Demand 6.3 WP-63-MATCHER）
 * testcase-generation 与 knowledge-base 共用；规则数据仍来自 module_keyword_mapping.js
 */
'use strict';

const {
  EXPECTED_MAPPING_VERSION,
  BUILTIN_KEYWORD_MAPPING,
  toModuleL1
} = require('../stage3/module_keyword_mapping');

function matchPoint(text, rules = BUILTIN_KEYWORD_MAPPING) {
  const hits = [];
  const lower = String(text || '');
  const flat = [];
  for (const rule of rules) {
    for (const kw of rule.keywords) flat.push({ kw, rule });
  }
  flat.sort((a, b) => b.kw.length - a.kw.length);
  const seen = new Set();
  for (const { kw, rule } of flat) {
    if (!lower.includes(kw)) continue;
    const key = `${rule.module_id}|${rule.sub_module_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({
      module: rule.module,
      module_id: rule.module_id,
      sub_module: rule.sub_module,
      sub_module_id: rule.sub_module_id,
      match_keyword: kw,
      confidence: 'high'
    });
  }
  return hits;
}

function pickPrimary(hits) {
  if (!hits.length) return null;
  const prefer = hits.find(h => h.module_id !== 'NON_FUNCTIONAL');
  return prefer || hits[0];
}

/**
 * @param {string} text
 * @param {{ rules?: object[] }} [opts]
 * @returns {{ l1: string, l2: string, confidence: number, reason: string, version: string }[]}
 */
function match(text, opts = {}) {
  const rules = opts.rules || BUILTIN_KEYWORD_MAPPING;
  const hits = matchPoint(text, rules);
  return hits.map(h => ({
    l1: toModuleL1(h.module),
    l2: h.sub_module,
    confidence: h.confidence === 'high' ? 0.9 : 0.5,
    reason: `keyword:${h.match_keyword}`,
    version: EXPECTED_MAPPING_VERSION,
    module_id: h.module_id,
    sub_module_id: h.sub_module_id,
    match_keyword: h.match_keyword
  }));
}

function matchPrimary(text, opts = {}) {
  const all = match(text, opts);
  if (!all.length) return null;
  const prefer = all.find(h => h.module_id !== 'NON_FUNCTIONAL');
  return prefer || all[0];
}

function selfTest() {
  const r = matchPrimary('销售单保存成功弹出调研弹窗');
  const cases = [
    ['sales hit', r && r.l1 === '销售' && r.l2 === '销售'],
    ['version present', r && r.version === EXPECTED_MAPPING_VERSION],
    ['empty no hit', match('zzzz_no_module_zzz').length === 0]
  ];
  const failed = cases.filter(([, ok]) => !ok);
  if (failed.length) {
    console.error('module_matcher self-test failed:', failed.map(([n]) => n));
    process.exit(1);
  }
  console.log('✓ module_matcher self-test');
}

module.exports = {
  EXPECTED_MAPPING_VERSION,
  match,
  matchPrimary,
  matchPoint,
  pickPrimary,
  toModuleL1,
  selfTest
};

if (require.main === module) selfTest();
