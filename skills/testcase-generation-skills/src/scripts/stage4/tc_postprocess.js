/**
 * Demand 6.1 — Stage4 后处理（absorb 裁剪 / sort_key / 标题分型）
 * Stage4 **禁止**读取 domain_facts.json。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeToken } = require('../lib/canonical_key');
const {
  copyValidatedAssertions,
  stableBackendRefKey
} = require('../lib/technical_refs');

/** 因果标题弱模式：功能/规则类倾向；NFR 不强制 */
const CAUSAL_TITLE_RE = /则|→|->|从而|之后|时，|时；|后，|后；/;

function loadMergeReport(projectDir) {
  const p = path.join(projectDir, 'script', 'stage3', 'merge_report.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function absorbIdSet(mergeReport, testPointsDoc) {
  const set = new Set();
  const fromReport =
    (mergeReport && mergeReport.absorb_candidates) ||
    (testPointsDoc &&
      testPointsDoc.merge_report &&
      testPointsDoc.merge_report.absorb_candidates) ||
    [];
  for (const a of fromReport) {
    if (a && a.tp_id) set.add(a.tp_id);
  }
  return set;
}

function filterAbsorbPoints(testPointsDoc, mergeReport) {
  const absorb = absorbIdSet(mergeReport, testPointsDoc);
  const all = testPointsDoc.test_points || [];
  const kept = [];
  const skipped = [];
  for (const p of all) {
    if (absorb.has(p.id)) skipped.push(p.id);
    else kept.push(p);
  }
  return { kept, skipped, absorb };
}

function computeSortKey(tc, tp) {
  const { computeSortKey: tpSortKey } = require('../lib/cluster_key');
  if (tp && tp.sort_key) return tp.sort_key;
  if (tp) return tpSortKey(tp);
  const primary = normalizeToken(tc.title || '').slice(0, 20);
  return [
    tc.module_l1 || '',
    tc.module_l2 || '',
    primary,
    normalizeToken(tc.title || ''),
    tc.id || ''
  ].join('\u0001');
}

function sortTestCases(cases, tpById) {
  const list = (cases || []).slice();
  list.sort((a, b) => {
    const ka = computeSortKey(a, tpById[a.source && a.source[0]]);
    const kb = computeSortKey(b, tpById[b.source && b.source[0]]);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return list;
}

/**
 * 功能/规则类：建议因果标题；NFR（由源 TP nfr_type）不强制。
 * @returns {{ warnings: string[], checked: number, nfr_skipped: number }}
 */
function checkTitleTyping(cases, tpById) {
  const warnings = [];
  let checked = 0;
  let nfr_skipped = 0;
  for (const tc of cases || []) {
    const tpId = (tc.source || []).find(s => /^TP-/.test(s));
    const tp = tpId ? tpById[tpId] : null;
    if (tp && tp.nfr_type) {
      nfr_skipped++;
      continue;
    }
    checked++;
    const title = String(tc.title || '');
    if (!CAUSAL_TITLE_RE.test(title)) {
      warnings.push(
        `${tc.id}: 功能/规则类标题建议体现「条件，则结果」（当前: ${title.slice(0, 40)}）`
      );
    }
  }
  return { warnings, checked, nfr_skipped };
}

/**
 * 端策略：单条 TC 用 platform_tags 表达多端，禁止按端复制出多条同标题 TC。
 */
function checkNoPlatformExplosion(cases) {
  const errors = [];
  const byTitle = Object.create(null);
  for (const tc of cases || []) {
    const t = normalizeToken(tc.title);
    if (!t) continue;
    if (!byTitle[t]) byTitle[t] = [];
    byTitle[t].push(tc.id);
  }
  for (const [t, ids] of Object.entries(byTitle)) {
    if (ids.length > 1) {
      errors.push(
        `同逻辑多条用例（疑似按端/触发复制）: ${ids.join(', ')}`
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

function renderAssertionValue(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function assertionSubject(assertion) {
  if (assertion.json_path) return assertion.json_path;
  if (assertion.location === 'status') return '响应状态';
  if (assertion.location === 'header') return '响应头';
  return '响应体';
}

/** Demand 6.4：将白名单 operator 渲染为稳定、可判定的中文期望。 */
function renderApiAssertion(assertion) {
  const subject = assertionSubject(assertion);
  const value = renderAssertionValue(assertion.expected);
  const templates = {
    eq: `${subject} 等于 ${value}`,
    contains: `${subject} 包含 ${value}`,
    not_contains: `${subject} 不包含 ${value}`,
    exists: `${subject} 存在`,
    not_exists: `${subject} 不存在`,
    unique: `${subject} 中数据不重复`
  };
  return templates[assertion.operator] || null;
}

function apiCheckDescriptor(ref) {
  if (!ref || ref.type !== 'backend_api') return null;
  const assertions = copyValidatedAssertions(ref.assertions);
  if (!assertions || assertions.length === 0) return null;
  const rendered = assertions.map(renderApiAssertion);
  if (rendered.some((item) => !item)) return null;
  return {
    ref_key: stableBackendRefKey(ref),
    action: `检查接口 ${ref.method} ${ref.target}`,
    expected: rendered.join('；'),
    assertion_count: assertions.length
  };
}

/** 每个稳定 API ref 仅生成一个检查步骤；Method/Path-only ref 保持展示态。 */
function buildApiCheckSteps(technicalRefs, startOrder) {
  const steps = [];
  const seen = new Set();
  for (const ref of technicalRefs || []) {
    const descriptor = apiCheckDescriptor(ref);
    if (!descriptor || !descriptor.ref_key || seen.has(descriptor.ref_key)) continue;
    seen.add(descriptor.ref_key);
    steps.push({
      order: Number(startOrder || 0) + steps.length + 1,
      action: descriptor.action,
      expected: descriptor.expected
    });
  }
  return steps;
}

/**
 * TP 中可渲染的 API assertions 必须在关联 TC 中有一一对应的检查步骤。
 * 比较稳定 action/expected，同时检查重复，避免多 API 导致 UI 步骤复制。
 */
function checkApiAssertionMapping(testCases, tpById) {
  const issues = [];
  let required_checks = 0;
  let matched_checks = 0;
  for (const tc of testCases || []) {
    const tpId = (tc.source || []).find((id) => /^TP-/.test(id));
    const tp = tpId && tpById ? tpById[tpId] : null;
    if (!tp) continue;
    const expected = [];
    const seen = new Set();
    for (const ref of tp.technical_refs || []) {
      const descriptor = apiCheckDescriptor(ref);
      if (!descriptor || !descriptor.ref_key || seen.has(descriptor.ref_key)) continue;
      seen.add(descriptor.ref_key);
      expected.push(descriptor);
    }
    required_checks += expected.length;
    for (const descriptor of expected) {
      const matches = (tc.steps || []).filter(
        (step) =>
          (step.action || step.step_description) === descriptor.action &&
          (step.expected || step.expected_result) === descriptor.expected
      );
      if (matches.length === 1) matched_checks++;
      else {
        issues.push({
          case_id: tc.id,
          tp_id: tpId,
          ref_key: descriptor.ref_key,
          issue:
            matches.length === 0
              ? 'TP 接口断言缺少对应 TC API 检查步骤'
              : 'TC API 检查步骤重复'
        });
      }
    }
  }
  return {
    ok: issues.length === 0,
    required_checks,
    matched_checks,
    issues
  };
}

/** 静态断言：stage4_execute 不得 require/调用 domain_facts 模块（注释中提及路径名允许） */
function assertSourceAvoidsDomainFacts(stage4ExecutePath) {
  const src = fs.readFileSync(stage4ExecutePath, 'utf8');
  const badRequire =
    /require\s*\(\s*['"][^'"]*domain_facts(\.js)?['"]\s*\)/.test(src) ||
    /\bloadDomainFacts\s*\(/.test(src) ||
    /\bauditDraftAgainstFacts\s*\(/.test(src);
  return {
    ok: !badRequire,
    errors: badRequire
      ? ['stage4_execute.js 不得 require/调用 domain_facts 模块（S7）']
      : []
  };
}

function runSelfTest() {
  let failed = 0;
  const filtered = filterAbsorbPoints(
    {
      test_points: [
        { id: 'TP-001', title: 'a' },
        { id: 'TP-002', title: 'b' }
      ]
    },
    { absorb_candidates: [{ tp_id: 'TP-002', reason: 'x' }] }
  );
  console.log(
    (filtered.kept.length === 1 && filtered.skipped[0] === 'TP-002'
      ? '✓'
      : '✗') + ' absorb 裁剪'
  );
  if (filtered.kept.length !== 1) failed++;

  const cases = [
    {
      id: 'TC-002',
      title: '模块Y 条件乙则结果',
      module_l1: '设置',
      module_l2: '模块Y',
      source: ['TP-002']
    },
    {
      id: 'TC-001',
      title: '模块X 条件甲则结果',
      module_l1: '设置',
      module_l2: '模块X',
      source: ['TP-001']
    },
    {
      id: 'TC-001b',
      title: '模块X 条件甲则另一',
      module_l1: '设置',
      module_l2: '模块X',
      source: ['TP-003']
    }
  ];
  const sorted = sortTestCases(cases, {});
  const okOrder =
    sorted[0].module_l2 === '模块X' &&
    sorted[1].module_l2 === '模块X' &&
    sorted[2].module_l2 === '模块Y';
  console.log((okOrder ? '✓' : '✗') + ' S8 同 module 相邻排序');
  if (!okOrder) failed++;

  const nfr = checkTitleTyping(
    [{ id: 'TC-N', title: '接口 P95 延迟', source: ['TP-N'] }],
    { 'TP-N': { nfr_type: 'performance' } }
  );
  console.log(
    (nfr.nfr_skipped === 1 && nfr.warnings.length === 0 ? '✓' : '✗') +
      ' S9 NFR 不强制因果标题'
  );
  if (!(nfr.nfr_skipped === 1 && nfr.warnings.length === 0)) failed++;

  const srcCheck = assertSourceAvoidsDomainFacts(
    path.join(__dirname, 'stage4_execute.js')
  );
  console.log((srcCheck.ok ? '✓' : '✗') + ' S7 源码不引用 domain_facts');
  if (!srcCheck.ok) failed++;

  if (failed) {
    console.error('tc_postprocess self-test failed: ' + failed);
    process.exit(1);
  }
  console.log('tc_postprocess self-test passed');
}

module.exports = {
  loadMergeReport,
  absorbIdSet,
  filterAbsorbPoints,
  computeSortKey,
  sortTestCases,
  checkTitleTyping,
  checkNoPlatformExplosion,
  renderApiAssertion,
  apiCheckDescriptor,
  buildApiCheckSteps,
  checkApiAssertionMapping,
  assertSourceAvoidsDomainFacts,
  CAUSAL_TITLE_RE
};

if (require.main === module) {
  runSelfTest();
}
