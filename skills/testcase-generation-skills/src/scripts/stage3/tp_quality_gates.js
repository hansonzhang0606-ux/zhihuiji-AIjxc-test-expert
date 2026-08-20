/**
 * Demand 6.1 — Stage3A 质量门禁（纯度 / absorb / 模糊指代 / 悬空 RP / facts 固化追溯）
 * 结果写入 merge_report 扩展字段，不新建平行 quality_gate_report。
 */
'use strict';

const { findCanonicalKeyConflicts } = require('../lib/canonical_key');
const { checkAutoSkipRegression } = require('../lib/regression_hints');
const { auditDraftAgainstFacts } = require('../stage1/domain_facts');
const { parseNavigationStep } = require('../shared/navigation_path');

const VAGUE_RE =
  /见\s*(其他|上|下|左侧|TP-?\d|RP-?\d)|同上|同左|同右|参考\s*(该|此|上|其他)?\s*(测试点|TP|用例)/i;
const UI_INTERACTION_RE =
  /点击|输入|选择|勾选|切换|拖拽|上传|打开|关闭|保存|提交|搜索|筛选|创建|编辑|删除|登录|弹窗|按钮|菜单|表单|列表|页面|界面/;
const NON_UI_RE =
  /API[-_ ]?only|仅接口|纯接口|接口层测试|后台任务|定时任务|异步任务|消息队列|离线任务|批处理任务|无\s*UI|无页面交互|不涉及页面|纯后端|服务端逻辑/i;
const API_ASSERTION_RE =
  /接口|API|响应|返回字段|状态码|请求|后端调用|埋点|上报/i;
const EXPECTED_ASSERTION_OPERATORS = new Set(['eq', 'contains', 'not_contains']);
const ASSERTION_OPERATORS = new Set([
  ...EXPECTED_ASSERTION_OPERATORS,
  'exists',
  'not_exists',
  'unique'
]);
const ASSERTION_LOCATIONS = new Set(['status', 'header', 'body']);
const MISSING_FIELD_ORDER = ['assertions', 'location', 'json_path', 'operator', 'expected'];

function isIntegrationModule(p) {
  const l1 = String(p.module_l1 || '');
  const l2 = String(p.module_l2 || '');
  return /集成/.test(l1) || /集成/.test(l2);
}

function assertionText(p) {
  return [p.title || '', ...(p.expected_outline || [])].join('\n');
}

function stepsText(p) {
  return (p.steps_outline || []).join('\n');
}

function tpText(tp) {
  return [
    tp && tp.title,
    ...((tp && tp.steps_outline) || []),
    ...((tp && tp.expected_outline) || [])
  ].filter(Boolean).join('\n');
}

/**
 * Demand 6.4: only clearly interactive P0 UI scenarios require a page path.
 * Ambiguous points remain exempt until the author explicitly describes a UI action.
 */
function requiresPagePath(tp) {
  if (!tp || tp.priority !== 'P0' || tp.nfr_type != null) return false;
  const text = tpText(tp);
  if (!text || NON_UI_RE.test(text)) return false;
  return UI_INTERACTION_RE.test(text);
}

function platformKinds(tp) {
  const kinds = new Set();
  for (const platform of (tp && tp.platform_tags) || []) {
    if (platform === 'PC端' || platform === 'H5端' || platform === 'web') kinds.add('web');
    if (platform === 'APP端' || platform === '小程序端' || platform === 'app') kinds.add('app');
  }
  return kinds.size ? [...kinds].sort() : ['web'];
}

function navigationCandidate(action) {
  return typeof action === 'string' && /^\s*进入/.test(action) && /页/.test(action);
}

function candidateTarget(action) {
  const match = String(action || '').match(/^\s*进入\s*([^（(：:，,\n]+?(?:页面|页))/);
  return match ? match[1].trim().replace(/页面$/, '页') : null;
}

function inferredTargetPages(tp, parsedCandidates) {
  const pages = new Set();
  for (const parsed of parsedCandidates) {
    if (parsed.target_page) pages.add(parsed.target_page);
  }
  for (const ref of (tp && tp.technical_refs) || []) {
    if (ref && ref.page_id) pages.add(String(ref.page_id).replace(/页面$/, '页'));
  }
  if (!pages.size) {
    const text = tpText(tp);
    const pattern = /(?:进入|打开|跳转至|跳转到|在)\s*([^，。；;\n（）()]{1,30}?(?:页面|页))/g;
    let match;
    while ((match = pattern.exec(text))) {
      pages.add(match[1].trim().replace(/页面$/, '页'));
    }
  }
  if (!pages.size) pages.add('待确认目标页');
  return [...pages].sort();
}

function collectPathGaps(points) {
  const gaps = [];
  const warnings = [];
  for (const tp of points || []) {
    if (!requiresPagePath(tp)) continue;
    const candidates = (tp.steps_outline || [])
      .filter(navigationCandidate)
      .map((action, index) => ({
        action,
        index,
        parsed: parseNavigationStep(action)
      }));
    for (const item of candidates) {
      for (const warning of item.parsed.warnings || []) {
        warnings.push(`${tp.id}: ${warning.message}`);
      }
    }
    const targets = inferredTargetPages(tp, candidates.map(item => item.parsed));
    for (const page_id of targets) {
      const matching = candidates.filter((item) =>
        (item.parsed.target_page || candidateTarget(item.action)) === page_id
      );
      const validCount = matching.filter(item => item.parsed.valid).length;
      let reason = null;
      if (matching.some(item => !item.parsed.valid)) reason = 'navigation_syntax_invalid';
      else if (validCount > 1) reason = 'duplicate_navigation_for_target_page';
      else if (validCount === 0) reason = 'kb_and_requirement_path_missing';
      if (!reason) continue;
      for (const platform of platformKinds(tp)) {
        const relatedRef = ((tp.technical_refs || []).find(ref => ref.page_id === page_id) || {});
        gaps.push({
          tp_id: tp.id,
          page_id,
          ...(relatedRef.element_name ? { element_name: relatedRef.element_name } : {}),
          platform,
          reason
        });
      }
    }
  }
  gaps.sort((a, b) =>
    [a.tp_id, a.page_id, a.platform, a.reason].join('|')
      .localeCompare([b.tp_id, b.page_id, b.platform, b.reason].join('|'))
  );
  return { gaps, warnings };
}

function requiresApiAssertions(tp, ref) {
  if (!ref || ref.type !== 'backend_api') return false;
  if (Array.isArray(ref.assertions)) return true;
  return tp.priority === 'P0' || API_ASSERTION_RE.test(tpText(tp));
}

function missingAssertionFields(assertions) {
  if (!Array.isArray(assertions) || assertions.length === 0) return ['assertions'];
  const missing = new Set();
  for (const assertion of assertions) {
    if (!assertion || !ASSERTION_LOCATIONS.has(assertion.location)) missing.add('location');
    if (!assertion || !ASSERTION_OPERATORS.has(assertion.operator)) missing.add('operator');
    if (assertion && assertion.location === 'body' &&
        !String(assertion.json_path || '').trim()) {
      missing.add('json_path');
    }
    if (assertion && EXPECTED_ASSERTION_OPERATORS.has(assertion.operator) &&
        !Object.prototype.hasOwnProperty.call(assertion, 'expected')) {
      missing.add('expected');
    }
  }
  return MISSING_FIELD_ORDER.filter(field => missing.has(field));
}

function collectApiAssertionGaps(points) {
  const gaps = [];
  for (const tp of points || []) {
    (tp.technical_refs || []).forEach((ref, technical_ref_index) => {
      if (!requiresApiAssertions(tp, ref)) return;
      const missing_fields = missingAssertionFields(ref.assertions);
      if (!missing_fields.length) return;
      gaps.push({
        tp_id: tp.id,
        technical_ref_index,
        missing_fields,
        reason: missing_fields[0] === 'assertions'
          ? 'api_assertions_missing'
          : 'api_assertions_incomplete'
      });
    });
  }
  gaps.sort((a, b) =>
    a.tp_id.localeCompare(b.tp_id) || a.technical_ref_index - b.technical_ref_index
  );
  return gaps;
}

/**
 * 主断言纯度：只检 title + expected_outline。
 * 草稿可带 asserted_objects[]（主断言涉及的主业务对象列表）。
 * 步骤提及 dependency_objects 不构成违规。
 */
function checkModulePurity(points) {
  const errors = [];
  const violations = [];
  for (const p of points || []) {
    if (isIntegrationModule(p)) continue;
    const asserted = p.asserted_objects || p.assertion_objects;
    if (Array.isArray(asserted)) {
      const uniq = [...new Set(asserted.map(s => String(s || '').trim()).filter(Boolean))];
      if (uniq.length > 1) {
        const reason = `非集成模块主断言混写多个主对象: ${uniq.join('、')}`;
        errors.push(`${p.id}: ${reason}`);
        violations.push({
          tp_id: p.id,
          asserted_objects: uniq,
          reason
        });
      }
      continue;
    }
    // 无显式 asserted_objects：用 primary_object + dependency_objects 启发式
    const primary = String(p.primary_object || '').trim();
    const deps = Array.isArray(p.dependency_objects) ? p.dependency_objects : [];
    if (!primary || !deps.length) continue;
    const assertion = assertionText(p);
    const steps = stepsText(p);
    for (const d of deps) {
      const dep = String(d || '').trim();
      if (!dep) continue;
      if (assertion.indexOf(dep) === -1) continue;
      // 依赖对象出现在主断言中 → 违规；仅步骤出现 → 允许
      if (steps.indexOf(dep) !== -1 && assertion.indexOf(dep) === -1) continue;
      const reason = `主断言（标题/期望）出现依赖对象「${dep}」，疑似多主对象终态混写；步骤中提及则允许`;
      errors.push(`${p.id}: ${reason}`);
      violations.push({
        tp_id: p.id,
        asserted_objects: [primary, dep],
        reason
      });
    }
  }
  return { ok: errors.length === 0, errors, violations };
}

function checkVagueReferences(points) {
  const errors = [];
  const vague_references = [];
  for (const p of points || []) {
    const blob = [assertionText(p), stepsText(p)].join('\n');
    const m = blob.match(VAGUE_RE);
    if (m) {
      const excerpt = m[0];
      errors.push(`${p.id}: 模糊指代「${excerpt}」，测试点须原子自洽`);
      vague_references.push({ tp_id: p.id, excerpt });
    }
  }
  return { ok: errors.length === 0, errors, vague_references };
}

function checkDanglingRpIds(points, rpDoc) {
  const errors = [];
  if (!rpDoc) return { ok: true, errors };
  const known = new Set();
  for (const p of rpDoc.confirmed_points || []) known.add(p.id);
  for (const p of rpDoc.pending_points || []) known.add(p.id);
  for (const p of points || []) {
    if (p.is_regression) continue;
    for (const id of p.source_rp_ids || []) {
      if (!known.has(id)) {
        errors.push(`${p.id}: 悬空 source_rp_ids ${id}（C-RP 中不存在）`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function collectAbsorbCandidates(rawPoints) {
  const absorb_candidates = [];
  for (const p of rawPoints || []) {
    if (
      p.coverage_candidate === 'absorb' ||
      p.absorb === true ||
      (p.coverage_candidate && String(p.coverage_candidate).toLowerCase() === 'absorb')
    ) {
      absorb_candidates.push({
        tp_id: p.id,
        reason: p.absorb_reason || 'coverage_candidate=absorb'
      });
    }
  }
  return absorb_candidates;
}

/**
 * 校验 forbid；追溯 statement 是否已落入某 TP 标题/期望（固化可追溯）
 */
function applyFactsTrace(points, factsDoc) {
  const errors = [];
  const facts_applied = [];
  if (!factsDoc || !Array.isArray(factsDoc.facts) || !factsDoc.facts.length) {
    return { ok: true, errors, facts_applied, warnings: [] };
  }
  // 复用 1A 扫描：对 TP 映射为 title/detail
  const pseudo = {
    confirmed_points: (points || []).map(p => ({
      id: p.id,
      title: p.title,
      detail: (p.expected_outline || []).join('；')
    }))
  };
  errors.push(...auditDraftAgainstFacts(pseudo, factsDoc));

  const warnings = [];
  for (const fact of factsDoc.facts) {
    const covered_by_tp_ids = [];
    const stmt = String(fact.statement || '');
    for (const p of points || []) {
      const blob = assertionText(p);
      if (stmt && blob.indexOf(stmt) !== -1) {
        covered_by_tp_ids.push(p.id);
        continue;
      }
      // 弱覆盖：statement 去掉空白后的显著子串（≥6 字）命中
      const compact = stmt.replace(/\s/g, '');
      if (compact.length >= 6 && blob.replace(/\s/g, '').indexOf(compact) !== -1) {
        covered_by_tp_ids.push(p.id);
      }
    }
    const coverage = covered_by_tp_ids.length ? 'covered' : 'gap';
    facts_applied.push({
      fact_id: fact.id,
      statement: stmt,
      covered_by_tp_ids,
      coverage
    });
    if (coverage === 'gap') {
      warnings.push(
        `domain_facts ${fact.id} 未落入任何 TP 标题/期望，请在草稿中固化后再定稿`
      );
    }
  }
  return { ok: errors.length === 0, errors, facts_applied, warnings };
}

function enrichMergeReport(baseReport, extras) {
  const report = {
    rules_applied: (baseReport && baseReport.rules_applied) || ['core_no_merge'],
    entries: (baseReport && baseReport.entries) || []
  };
  if (extras.absorb_candidates && extras.absorb_candidates.length) {
    report.absorb_candidates = extras.absorb_candidates;
    if (!report.rules_applied.includes('absorb_coverage')) {
      report.rules_applied = report.rules_applied.concat(['absorb_coverage']);
    }
  }
  if (extras.purity_violations && extras.purity_violations.length) {
    report.purity_violations = extras.purity_violations;
  }
  if (extras.canonical_key_conflicts && extras.canonical_key_conflicts.length) {
    report.canonical_key_conflicts = extras.canonical_key_conflicts;
  }
  if (extras.facts_applied && extras.facts_applied.length) {
    report.facts_applied = extras.facts_applied;
  }
  if (extras.vague_references && extras.vague_references.length) {
    report.vague_references = extras.vague_references;
  }
  if (extras.regression_skipped && extras.regression_skipped.length) {
    report.regression_skipped = extras.regression_skipped;
  }
  if (extras.sliceHint) {
    if (!report.rules_applied.includes('slice_by_primary_object')) {
      report.rules_applied = report.rules_applied.concat(['slice_by_primary_object']);
    }
  }
  report.path_gaps = [...(extras.path_gaps || [])];
  report.api_assertion_gaps = [...(extras.api_assertion_gaps || [])];
  return report;
}

function runTpQualityGates(rawPoints, normalizedPoints, opts) {
  const errors = [];
  const warnings = [];
  const optsSafe = opts || {};

  const purity = checkModulePurity(rawPoints);
  errors.push(...purity.errors);

  const vague = checkVagueReferences(normalizedPoints);
  errors.push(...vague.errors);

  const dangling = checkDanglingRpIds(
    normalizedPoints,
    optsSafe.rpDoc || null
  );
  errors.push(...dangling.errors);

  const keyCheck = findCanonicalKeyConflicts(
    (rawPoints || []).map(p => ({
      id: p.id,
      title: p.title,
      trigger: p.trigger,
      primary_object: p.primary_object,
      condition: p.condition,
      primary_outcome: p.primary_outcome,
      canonical_key: p.canonical_key
    }))
  );
  if (!keyCheck.ok) errors.push(...keyCheck.errors);

  const absorb_candidates = collectAbsorbCandidates(rawPoints);
  const facts = applyFactsTrace(normalizedPoints, optsSafe.factsDoc || null);
  errors.push(...facts.errors);
  warnings.push(...(facts.warnings || []));

  const regSkip = checkAutoSkipRegression(rawPoints, optsSafe.ctx || null);
  errors.push(...regSkip.errors);
  const pathCheck = collectPathGaps(normalizedPoints);
  warnings.push(...pathCheck.warnings);
  const api_assertion_gaps = collectApiAssertionGaps(normalizedPoints);

  const merge_report = enrichMergeReport(optsSafe.baseMergeReport, {
    absorb_candidates,
    purity_violations: purity.violations,
    canonical_key_conflicts: keyCheck.ok ? [] : keyCheck.errors,
    facts_applied: facts.facts_applied,
    vague_references: vague.vague_references,
    regression_skipped: regSkip.regression_skipped,
    path_gaps: pathCheck.gaps,
    api_assertion_gaps,
    sliceHint: true
  });

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    merge_report
  };
}

function runSelfTest() {
  let failed = 0;

  const s4 = checkModulePurity([
    {
      id: 'TP-001',
      module_l1: '设置',
      module_l2: '模块X',
      title: '条件C下对象A结果R1',
      expected_outline: ['对象A 结果为 R1'],
      steps_outline: ['准备对象B 的数据'],
      primary_object: '对象A',
      dependency_objects: ['对象B'],
      asserted_objects: ['对象A']
    }
  ]);
  console.log((s4.ok ? '✓' : '✗') + ' S4 步骤提及依赖不误杀');
  if (!s4.ok) failed++;

  const s5 = checkModulePurity([
    {
      id: 'TP-002',
      module_l1: '设置',
      module_l2: '模块X',
      title: '对象A与对象B均达终态',
      expected_outline: ['对象A 保留且对象B 清零'],
      asserted_objects: ['对象A', '对象B']
    }
  ]);
  console.log((!s5.ok ? '✓' : '✗') + ' S5 主断言混写失败');
  if (s5.ok) failed++;

  const integ = checkModulePurity([
    {
      id: 'TP-003',
      module_l1: '非功能模块',
      module_l2: '集成测试',
      title: '协同',
      expected_outline: ['对象A 与 对象B'],
      asserted_objects: ['对象A', '对象B']
    }
  ]);
  console.log((integ.ok ? '✓' : '✗') + ' 集成模块允许多对象');
  if (!integ.ok) failed++;

  const absorb = collectAbsorbCandidates([
    { id: 'TP-010', coverage_candidate: 'absorb', absorb_reason: '已被主路径覆盖' }
  ]);
  console.log(
    (absorb.length === 1 && absorb[0].tp_id === 'TP-010' ? '✓' : '✗') +
      ' absorb 收集'
  );
  if (absorb.length !== 1) failed++;

  const regSkip = checkAutoSkipRegression(
    [
      {
        id: 'TP-030',
        is_regression: true,
        platform_tags: ['小程序端'],
        product_tags: ['ailit'],
        version_tags: ['单店版']
      }
    ],
    {
      regression_hints: [
        {
          type: 'platform_regression',
          target: '小程序端',
          auto_skip_tp: true
        }
      ]
    }
  );
  console.log((!regSkip.ok ? '✓' : '✗') + ' auto_skip 回归 TP 应失败');
  if (regSkip.ok) failed++;

  const regOk = checkAutoSkipRegression(
    [
      {
        id: 'TP-031',
        is_regression: true,
        platform_tags: ['PC端'],
        product_tags: ['智慧记AI进销存'],
        version_tags: ['单店版']
      }
    ],
    {
      regression_hints: [
        {
          type: 'platform_regression',
          target: '小程序端',
          auto_skip_tp: true
        }
      ]
    }
  );
  console.log((regOk.ok ? '✓' : '✗') + ' 非 skip 回归 TP 通过');
  if (!regOk.ok) failed++;

  const vague = checkVagueReferences([
    {
      id: 'TP-020',
      title: '见其他测试点',
      expected_outline: ['同上'],
      steps_outline: []
    }
  ]);
  console.log((!vague.ok ? '✓' : '✗') + ' 模糊指代失败');
  if (vague.ok) failed++;

  if (failed) {
    console.error('tp_quality_gates self-test failed: ' + failed);
    process.exit(1);
  }
  console.log('tp_quality_gates self-test passed');
}

module.exports = {
  collectApiAssertionGaps,
  collectPathGaps,
  isIntegrationModule,
  missingAssertionFields,
  requiresApiAssertions,
  requiresPagePath,
  checkModulePurity,
  checkVagueReferences,
  checkDanglingRpIds,
  collectAbsorbCandidates,
  applyFactsTrace,
  enrichMergeReport,
  runTpQualityGates
};

if (require.main === module) {
  runSelfTest();
}
