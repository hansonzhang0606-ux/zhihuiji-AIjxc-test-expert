/**
 * Demand 6.2/6.3 — domain_facts → C-TP.technical_refs；Stage4 仅复制
 */
'use strict';

const ASSERTION_FIELDS = ['location', 'json_path', 'operator', 'expected'];
const TECHNICAL_REF_FIELDS = [
  'type',
  'platform',
  'page_id',
  'element_name',
  'method',
  'target',
  'operation',
  'kb_ref'
];
const EXPECTED_OPERATORS = new Set(['eq', 'contains', 'not_contains']);
const ASSERTION_OPERATORS = new Set([
  ...EXPECTED_OPERATORS,
  'exists',
  'not_exists',
  'unique'
]);
const ASSERTION_LOCATIONS = new Set(['status', 'header', 'body']);
const BACKEND_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'WS']);
const SENSITIVE_RE =
  /(bearer\s+|token=|access_token|refresh_token|authorization|cookie=|password=|secret=|api[_-]?key=)/i;
const REAL_BUSINESS_ID_QUERY_RE =
  /[?&](?:tenant|user|order|bill|shop|store)[_-]?id=([^{&][^&]*)/i;

function copyAssertion(assertion) {
  if (!assertion || typeof assertion !== 'object') return null;
  const copy = {};
  for (const field of ASSERTION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(assertion, field)) {
      copy[field] = assertion[field];
    }
  }
  if (!ASSERTION_LOCATIONS.has(copy.location)) return null;
  if (!ASSERTION_OPERATORS.has(copy.operator)) return null;
  if (copy.location === 'body' && !String(copy.json_path || '').trim()) return null;
  if (EXPECTED_OPERATORS.has(copy.operator) &&
      !Object.prototype.hasOwnProperty.call(copy, 'expected')) {
    return null;
  }
  return copy;
}

function copyValidatedAssertions(assertions) {
  if (!Array.isArray(assertions)) return undefined;
  const copied = assertions.map(copyAssertion).filter(Boolean);
  return copied.length ? copied : undefined;
}

function normalizeBackendMethod(method) {
  const normalized = String(method || '').trim().toUpperCase();
  return BACKEND_METHODS.has(normalized) ? normalized : null;
}

function normalizeBackendTarget(target) {
  let value = String(target || '').trim();
  if (!value || SENSITIVE_RE.test(value) || REAL_BUSINESS_ID_QUERY_RE.test(value)) return null;
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      value = parsed.pathname + parsed.search;
    } catch (_) {
      return null;
    }
  }
  value = value.replace(
    /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi,
    '/{id}'
  );
  value = value.replace(/\/[0-9]{2,}(?=\/|$)/g, '/{id}');
  if (!value.startsWith('/')) return null;
  return value;
}

function stableBackendRefKey(ref) {
  if (!ref || ref.type !== 'backend_api') return null;
  const method = normalizeBackendMethod(ref.method) || String(ref.method || '');
  const target = normalizeBackendTarget(ref.target) || String(ref.target || '');
  return [
    ref.platform || '',
    ref.page_id || '',
    ref.element_name || '',
    method,
    target
  ].join('|');
}

function factToTechnicalRef(fact) {
  if (!fact || fact.source !== 'kb_applied') return null;
  if (fact.fact_kind === 'page_url' && fact.page_url && fact.page_url.template) {
    const platform = (fact.platforms && fact.platforms[0]) || 'web';
    return {
      type: 'page_url',
      platform,
      page_id: fact.page_id,
      target: fact.page_url.template,
      kb_ref: fact.kb_ref || fact.id
    };
  }
  if (fact.fact_kind === 'backend_api' && fact.backend_api) {
    const platform = (fact.platforms && fact.platforms[0]) || 'web';
    const method = normalizeBackendMethod(fact.backend_api.method);
    const target = normalizeBackendTarget(fact.backend_api.path);
    if (!method || !target) return null;
    const assertions = copyValidatedAssertions(
      fact.backend_api.assertions || fact.assertions
    );
    return {
      type: 'backend_api',
      platform,
      page_id: fact.page_id,
      element_name: fact.element_name,
      method,
      target,
      operation: fact.backend_api.operation,
      kb_ref: fact.kb_ref || fact.id,
      ...(assertions ? { assertions } : {})
    };
  }
  return null;
}

function platformTagsToKb(platforms) {
  const out = new Set();
  for (const p of platforms || []) {
    if (p === 'PC端' || p === 'web') out.add('web');
    if (p === 'APP端' || p === 'app') out.add('app');
  }
  return out;
}

/**
 * 将相关 page_url / backend_api facts 附着到测试点（不猜；按页名/元素名/端交叉）
 */
function attachTechnicalRefsToTestPoints(testPoints, factsDoc) {
  const facts = (factsDoc && factsDoc.facts) || [];
  const techFacts = facts
    .map(factToTechnicalRef)
    .filter(Boolean);
  if (!techFacts.length) return { applied: 0 };

  let applied = 0;
  for (const tp of testPoints || []) {
    const text = [tp.title, ...(tp.steps_outline || []), ...(tp.expected_outline || [])].join(' ');
    const plats = platformTagsToKb(tp.platform_tags);
    const existing = copyTechnicalRefsFromTp(tp) || [];
    const refs = [...existing];
    for (const ref of techFacts) {
      if (!plats.has(ref.platform)) continue;
      if (ref.page_id && !text.includes(ref.page_id) && !(tp.title || '').includes(ref.page_id)) {
        // 宽松：模块同属销售场景时，若关键词命中元素名也收
        if (ref.element_name && text.includes(ref.element_name)) {
          /* ok */
        } else if (ref.type === 'page_url' && /列表|开单|详情/.test(text) && /列表|开单|详情/.test(ref.page_id)) {
          /* ok: 弱相关页名片段 */
        } else {
          continue;
        }
      }
      if (ref.element_name && !text.includes(ref.element_name) && ref.type === 'backend_api') {
        // API 必须元素名出现在 TP 文本中，避免整页灌入
        if (!text.includes(ref.element_name.split('.')[0])) continue;
      }
      refs.push(ref);
    }
    // 去重
    const seen = new Set();
    const uniq = [];
    for (const r of refs) {
      const key = r.type === 'backend_api'
        ? stableBackendRefKey(r)
        : `${r.type}|${r.platform}|${r.page_id}|${r.target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(r);
    }
    if (uniq.length) {
      tp.technical_refs = uniq.slice(0, 15);
      applied += Math.max(0, tp.technical_refs.length - existing.length);
    }
  }
  return { applied };
}

/** Stage4：仅从 TP 复制/裁剪到 TC */
function copyTechnicalRefsFromTp(tp) {
  if (!tp || !Array.isArray(tp.technical_refs)) return undefined;
  return tp.technical_refs.map((ref) => {
    const copy = {};
    for (const field of TECHNICAL_REF_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(ref, field)) copy[field] = ref[field];
    }
    const assertions = copyValidatedAssertions(ref.assertions);
    if (assertions) copy.assertions = assertions;
    return copy;
  });
}

module.exports = {
  copyValidatedAssertions,
  factToTechnicalRef,
  attachTechnicalRefsToTestPoints,
  copyTechnicalRefsFromTp,
  normalizeBackendMethod,
  normalizeBackendTarget,
  stableBackendRefKey
};
