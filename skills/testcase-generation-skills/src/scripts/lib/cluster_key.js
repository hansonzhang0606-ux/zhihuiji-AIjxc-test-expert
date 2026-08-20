/**
 * Demand 6.1 P2 — C-TP cluster_key / sort_key 计算（Stage3A finalize + Stage4 共用）
 */
'use strict';

const { normalizeToken } = require('./canonical_key');

/**
 * @param {object} tp
 * @returns {string}
 */
function computeClusterKey(tp) {
  const p = tp || {};
  if (p.cluster_key) return String(p.cluster_key);
  const primary = normalizeToken(p.primary_object || '').slice(0, 40);
  const module = normalizeToken(p.module_l2 || p.module_l1 || '');
  if (primary && module) return module + '\u0002' + primary;
  if (primary) return primary;
  return normalizeToken(p.title || '').slice(0, 24);
}

/**
 * @param {object} tp
 * @returns {string}
 */
function computeSortKey(tp) {
  const p = tp || {};
  if (p.sort_key) return String(p.sort_key);
  return [
    p.module_l1 || '',
    p.module_l2 || '',
    computeClusterKey(p),
    normalizeToken(p.title || ''),
    p.id || ''
  ].join('\u0001');
}

/**
 * 定稿时补全 cluster/sort（不覆盖 LLM 显式值）
 * @param {object} tp
 * @returns {object}
 */
function enrichTpSortFields(tp) {
  const out = { ...tp };
  if (!out.cluster_key) out.cluster_key = computeClusterKey(out);
  if (!out.sort_key) out.sort_key = computeSortKey(out);
  return out;
}

function runSelfTest() {
  let failed = 0;
  const tp = {
    id: 'TP-001',
    module_l1: '销售',
    module_l2: '销售单',
    title: '条件C下对象A结果为R1',
    primary_object: '对象A'
  };
  const ck = computeClusterKey(tp);
  const sk = computeSortKey(tp);
  const ok =
    /对象a/i.test(ck) &&
    sk.indexOf('TP-001') !== -1 &&
    sk.length > ck.length;
  console.log((ok ? '✓' : '✗') + ' cluster_key + sort_key');
  if (!ok) failed++;

  const enriched = enrichTpSortFields({ ...tp });
  console.log(
    (enriched.cluster_key && enriched.sort_key ? '✓' : '✗') + ' enrichTpSortFields'
  );
  if (!enriched.cluster_key || !enriched.sort_key) failed++;

  if (failed) {
    console.error('cluster_key self-test failed: ' + failed);
    process.exit(1);
  }
  console.log('cluster_key self-test passed');
}

module.exports = {
  computeClusterKey,
  computeSortKey,
  enrichTpSortFields
};

if (require.main === module) {
  runSelfTest();
}
