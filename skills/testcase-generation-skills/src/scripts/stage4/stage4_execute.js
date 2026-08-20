/**
 * Stage4：用例生成（Demand 6.0 / WP-S4）
 *
 *   node stage4_execute.js --project-dir <工作区>
 *   node stage4_execute.js --self-test
 *
 * 读：script/stage3/test_points.json（C-TP）+ script/config/test_context.json
 *      + 可选 script/stage3/merge_report.json（absorb 等）
 * 写：script/stage4/test_cases.json（C-TC）
 *     output/测试用例_{title}.xmind
 *     script/stage4/test_cases.xlsx（默认）
 *     script/stage4/quality_report.json
 *
 * Demand 6.1：禁止读取 domain_facts.json；端差异用 platform_tags，不按端复制用例。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const XLSX = require('xlsx');
const {
  SRC_ROOT,
  contractPath,
  getXmindPaths,
  createWorkspace
} = require('../lib/workspace');
const { validateData, CONTRACTS_DIR } = require('../lib/validate');
const {
  buildTestCasesTree,
  writeTestCasesXmind,
  formatDisplayLabels
} = require('../lib/xmind_export');
const {
  loadMergeReport,
  filterAbsorbPoints,
  sortTestCases,
  checkTitleTyping,
  checkNoPlatformExplosion,
  buildApiCheckSteps,
  checkApiAssertionMapping,
  assertSourceAvoidsDomainFacts
} = require('./tc_postprocess');

const SCRIPT_VERSION = '6.4.0';
const TC_SCHEMA = path.join(CONTRACTS_DIR, 'test_cases.schema.json');
const FINAL_ARTIFACT_SCHEMA = path.join(
  CONTRACTS_DIR,
  'final_artifact.schema.json'
);
const EXCEL_TEMPLATE = path.join(
  SRC_ROOT,
  'templates',
  '数据模板_用例管理.xlsx'
);

const QUALITY_TARGETS = {
  atomicity: 0.95,
  completeness: 0.98,
  step_expect: 1.0,
  overall: 90
};

const NFR_L2 = {
  performance: '性能测试',
  security: '安全测试',
  compatibility: '兼容性测试',
  integration: '集成测试'
};

function log(msg) {
  console.log(`[Stage4 ${SCRIPT_VERSION}] ${msg}`);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function nowIso() {
  return new Date().toISOString();
}

function nowLocal() {
  return nowIso().replace('T', ' ').substring(0, 19);
}

function parseArgs(argv) {
  const params = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project-dir' && argv[i + 1]) params.projectDir = argv[++i];
    else if (a === '--skip-gate') params.skipGate = true;
    else if (a === '--no-excel') params.noExcel = true;
    else if (a === '--copy-excel-to-output') params.copyExcelToOutput = true;
    else if (a === '--kb') params.kb = true;
    else if (a === '--self-test') params.selfTest = true;
    else if (a === '--help' || a === '-h') params.help = true;
  }
  return params;
}

function usage() {
  console.log(`用法:
  node stage4/stage4_execute.js --project-dir <工作区>
  node stage4/stage4_execute.js --self-test

选项:
  --skip-gate              跳过 stage3_approved（仅联调）
  --no-excel               不生成 xlsx
  --copy-excel-to-output   额外复制 xlsx 到 output/（须用户明确要求）
  --kb                     开启知识库转化（默认关；仅 script/stage4/knowledge_base/）`);
}

function stage4Paths(projectDir) {
  const stage4 = path.join(projectDir, 'script', 'stage4');
  return {
    draft: path.join(stage4, 'test_cases_draft.json'),
    testCasesJson: contractPath(projectDir, 'testCases'),
    testCasesXlsx: path.join(stage4, 'test_cases.xlsx'),
    finalArtifact: path.join(stage4, 'final_artifact.json'),
    qualityReport: path.join(stage4, 'quality_report.json'),
    completionReport: path.join(stage4, 'stage4_completion_report.json'),
    kbDir: path.join(stage4, 'knowledge_base'),
    kbManifest: path.join(stage4, 'knowledge_base', 'manifest.json')
  };
}

// ─── 门禁 ───────────────────────────────────────────────

function checkStage3Gate(projectDir, skipGate) {
  if (skipGate) {
    return { ok: true, skipped: true, warnings: ['已 --skip-gate，跳过 stage3_approved'] };
  }
  const progressPath = contractPath(projectDir, 'progressTracker');
  if (!fs.existsSync(progressPath)) {
    return { ok: false, errors: ['缺少 progress_tracker.json'] };
  }
  const prog = readJson(progressPath);
  const errors = [];
  if (prog.stage3_approved !== true) {
    errors.push('stage3_approved≠true，禁止 Stage4（请先完成人审②）');
  }
  if (prog.stage4_blocked_unmatched === true) {
    errors.push('stage4_blocked_unmatched=true，存在未匹配模块，禁止 Stage4');
  }
  return { ok: errors.length === 0, errors, progress: prog };
}

function loadInputs(projectDir) {
  const tpPath = contractPath(projectDir, 'testPoints');
  const ctxPath = contractPath(projectDir, 'testContext');
  if (!fs.existsSync(tpPath)) {
    throw new Error('缺少 C-TP: ' + tpPath);
  }
  if (!fs.existsSync(ctxPath)) {
    throw new Error('缺少 C-CTX: ' + ctxPath);
  }
  if (!fs.existsSync(EXCEL_TEMPLATE)) {
    throw new Error(
      '缺少 Excel 模板（须存在于 src/templates/）: ' + EXCEL_TEMPLATE
    );
  }
  const testPoints = readJson(tpPath);
  const testContext = readJson(ctxPath);
  if (testPoints.unmatched_count > 0) {
    throw new Error(
      `C-TP unmatched_count=${testPoints.unmatched_count}，禁止 Stage4`
    );
  }
  const mergeReport = loadMergeReport(projectDir) || testPoints.merge_report || null;
  return { testPoints, testContext, mergeReport, tpPath, ctxPath };
}

// ─── TP → TC ─────────────────────────────────────────────

function extractModules(tp) {
  if (tp.nfr_type && NFR_L2[tp.nfr_type]) {
    return { module_l1: '非功能', module_l2: NFR_L2[tp.nfr_type] };
  }
  return {
    module_l1: tp.module_l1 || '未分类',
    module_l2: tp.module_l2 || ''
  };
}

function generatePrecondition(tp) {
  const parts = [];
  const tags = []
    .concat(tp.product_tags || [])
    .concat(tp.version_tags || [])
    .concat(tp.platform_tags || []);
  const context = [(tp.title || ''), ...(tp.steps_outline || [])].join(' ');

  if (tags.includes('老板角色') && !tags.includes('员工角色')) {
    parts.push('以老板账号登录系统');
  } else if (tags.includes('员工角色') && !tags.includes('老板角色')) {
    parts.push('以员工账号登录系统');
  }

  if (/首张|首次|新用户|无历史/.test(context)) {
    parts.push('该账号未产生过销售单');
  }
  if (/已有|非首|再次/.test(context)) {
    parts.push('该账号已有销售单记录');
  }
  if (/收银/.test(context)) parts.push('系统已开启收银台功能');
  if (/预订单/.test(context)) parts.push('系统已开启预订单功能');
  if (/云店/.test(context)) parts.push('系统已开通云店');
  if (/弱网/.test(context)) parts.push('已配置弱网测试环境');
  if (/并发/.test(context)) parts.push('具备并发请求模拟工具');

  if (tp.nfr_type === 'performance') parts.push('已准备性能测试环境和工具');
  if (tp.nfr_type === 'security') parts.push('已准备安全测试工具');
  if (tp.nfr_type === 'compatibility') parts.push('已准备多端/多浏览器环境');
  if (tp.nfr_type === 'integration') parts.push('已部署完整联调环境');

  if (tp.is_regression) {
    parts.push('对照环境未启用本次需求改动或使用 out_of_scope 产品/端账号');
  }

  if (parts.length === 0) return '无';
  return parts.join('；');
}

function generateSteps(tp) {
  const outlines = Array.isArray(tp.steps_outline) ? tp.steps_outline : [];
  const expecteds = Array.isArray(tp.expected_outline) ? tp.expected_outline : [];
  const steps = [];

  if (outlines.length === 0) {
    steps.push({
      order: 1,
      action: '执行测试验证：' + (tp.title || ''),
      expected:
        expecteds[0] ||
        (Array.isArray(expecteds) && expecteds.length
          ? expecteds.join('；')
          : '结果符合预期')
    });
    return steps;
  }

  for (let i = 0; i < outlines.length; i++) {
    let expected = expecteds[i];
    if (!expected || !String(expected).trim()) {
      expected =
        i === outlines.length - 1
          ? expecteds[expecteds.length - 1] || '结果符合预期'
          : '操作完成';
    }
    steps.push({
      order: i + 1,
      action: String(outlines[i]).trim(),
      expected: String(expected).trim()
    });
  }
  return steps;
}

function generateTcId(tp) {
  const id = tp.id || '';
  if (/^TP-\d+/i.test(id)) return id.replace(/^TP-/i, 'TC-');
  return 'TC-001';
}

function convertTpToTc(tp) {
  const mods = extractModules(tp);
  const source = [tp.id].concat(tp.source_rp_ids || []).filter(Boolean);
  const { copyTechnicalRefsFromTp } = require('../lib/technical_refs');
  const technical_refs = copyTechnicalRefsFromTp(tp);
  const uiSteps = generateSteps(tp);
  const tc = {
    id: generateTcId(tp),
    title: tp.title || '',
    module_l1: mods.module_l1,
    module_l2: mods.module_l2,
    product_tags: (tp.product_tags || []).slice(),
    version_tags: (tp.version_tags || []).slice(),
    platform_tags: (tp.platform_tags || []).slice(),
    priority: tp.priority,
    precondition: generatePrecondition(tp),
    // 保持 C-TP 原步骤（含完整导航字符串）顺序，再追加接口检查。
    steps: uiSteps.concat(buildApiCheckSteps(technical_refs, uiSteps.length)),
    source: source
  };
  if (technical_refs && technical_refs.length) tc.technical_refs = technical_refs;
  return tc;
}

function buildTestCases(testPoints, mergeReport) {
  const { kept, skipped } = filterAbsorbPoints(testPoints, mergeReport);
  const tpById = Object.create(null);
  for (const p of testPoints.test_points || []) {
    tpById[p.id] = p;
  }
  let cases = kept.map(convertTpToTc);
  cases = sortTestCases(cases, tpById);
  return {
    doc: {
      schema_version: '6.0',
      requirement_title: testPoints.requirement_title,
      generated_at: nowIso(),
      test_cases: cases
    },
    absorb_skipped_tp_ids: skipped,
    tpById
  };
}

// ─── 质量 ───────────────────────────────────────────────

function stepAction(s) {
  return s.action || s.step_description || '';
}

function stepExpected(s) {
  return s.expected || s.expected_result || '';
}

function stepOrder(s, i) {
  return s.order != null ? s.order : s.step_id != null ? s.step_id : i + 1;
}

function runQualityValidation(testCases, tpById) {
  const total = testCases.test_cases.length;
  const report = {
    report_id: 'QR-STAGE4-001',
    report_time: nowLocal(),
    schema_version: SCRIPT_VERSION,
    total_cases: total,
    targets: QUALITY_TARGETS,
    quality_metrics: {
      atomicity: { pass_rate: 0, pass_count: 0, fail_count: 0, issues: [] },
      completeness: { pass_rate: 0, pass_count: 0, fail_count: 0, issues: [] },
      executability: { pass_rate: 0, pass_count: 0, fail_count: 0, issues: [] },
      step_expectation_mapping: {
        pass_rate: 0,
        pass_count: 0,
        fail_count: 0,
        issues: []
      },
      api_assertion_mapping: {
        pass_rate: 1,
        pass_count: 0,
        fail_count: 0,
        required_checks: 0,
        issues: []
      }
    },
    overall_quality_score: 0,
    quality_level: '',
    passed: false
  };

  let atomicityPass = 0;
  let completenessPass = 0;
  let executabilityPass = 0;
  let mappingPass = 0;

  for (const tc of testCases.test_cases) {
    const atomicityIssues = [];
    const allText = [
      tc.precondition,
      ...tc.steps.map(stepAction),
      ...tc.steps.map(stepExpected)
    ].join(' ');
    const tcIdRefs = allText.match(/TC-\d+/g) || [];
    for (const ref of tcIdRefs) {
      if (ref !== tc.id) atomicityIssues.push('引用了其他用例: ' + ref);
    }
    if (/已执行完成|依赖用例|执行后结果/.test(tc.precondition || '')) {
      atomicityIssues.push('前提条件可能依赖其他用例执行结果');
    }
    if (atomicityIssues.length === 0) atomicityPass++;
    else {
      report.quality_metrics.atomicity.issues.push({
        case_id: tc.id,
        issue: atomicityIssues.join('; '),
        suggestion: '补充前置条件或拆分为独立用例'
      });
    }

    const completenessIssues = [];
    if (!tc.title || !String(tc.title).trim()) completenessIssues.push('标题为空');
    if (!tc.precondition || !String(tc.precondition).trim()) {
      completenessIssues.push('前提条件为空');
    }
    if (!tc.steps || tc.steps.length === 0) completenessIssues.push('步骤为空');
    if (!tc.module_l1 || !String(tc.module_l1).trim()) {
      completenessIssues.push('一级模块为空');
    }
    if (!['P0', 'P1', 'P2', 'P3'].includes(tc.priority)) {
      completenessIssues.push('优先级非法');
    }
    if (!tc.product_tags || !tc.product_tags.length) {
      completenessIssues.push('缺少 product_tags');
    }
    if (!tc.version_tags || !tc.version_tags.length) {
      // 国际版/ailit 等版本无关产品线，允许空 version_tags（与 C-TP minItems 0 对齐）
      const isVersionAgnostic = (tc.product_tags || []).some((t) =>
        /ailit|国际版/.test(t)
      );
      if (!isVersionAgnostic) completenessIssues.push('缺少 version_tags');
    }
    if (!tc.platform_tags || !tc.platform_tags.length) {
      completenessIssues.push('缺少 platform_tags');
    }
    if (completenessIssues.length === 0) completenessPass++;
    else {
      report.quality_metrics.completeness.issues.push({
        case_id: tc.id,
        issue: completenessIssues.join('; '),
        suggestion: '补充缺失字段'
      });
    }

    const execIssues = [];
    if ((tc.precondition || '').length < 1) execIssues.push('前提条件为空');
    tc.steps.forEach((s, i) => {
      const ord = stepOrder(s, i);
      if (stepAction(s).length < 2) execIssues.push('步骤' + ord + '描述过于简略');
      if (!String(stepExpected(s)).trim()) {
        execIssues.push('步骤' + ord + '缺少期望结果');
      }
    });
    if (execIssues.length === 0) executabilityPass++;
    else {
      report.quality_metrics.executability.issues.push({
        case_id: tc.id,
        issue: execIssues.join('; '),
        suggestion: '细化步骤与期望'
      });
    }

    const hasAllExpected =
      tc.steps.length > 0 &&
      tc.steps.every((s) => String(stepExpected(s)).trim() !== '');
    if (hasAllExpected) mappingPass++;
    else {
      report.quality_metrics.step_expectation_mapping.issues.push({
        case_id: tc.id,
        issue: '步骤与期望结果不完全对应',
        suggestion: '补充缺失的期望结果'
      });
    }
  }

  function fill(metric, passCount) {
    const fail = total - passCount;
    metric.pass_count = passCount;
    metric.fail_count = fail;
    metric.pass_rate = total ? passCount / total : 0;
  }

  fill(report.quality_metrics.atomicity, atomicityPass);
  fill(report.quality_metrics.completeness, completenessPass);
  fill(report.quality_metrics.executability, executabilityPass);
  fill(report.quality_metrics.step_expectation_mapping, mappingPass);

  const apiMapping = checkApiAssertionMapping(testCases.test_cases, tpById || {});
  report.quality_metrics.api_assertion_mapping = {
    pass_rate:
      apiMapping.required_checks === 0
        ? 1
        : apiMapping.matched_checks / apiMapping.required_checks,
    pass_count: apiMapping.matched_checks,
    fail_count: apiMapping.required_checks - apiMapping.matched_checks,
    required_checks: apiMapping.required_checks,
    issues: apiMapping.issues
  };

  const scores = [
    report.quality_metrics.atomicity.pass_rate * 100,
    report.quality_metrics.completeness.pass_rate * 100,
    report.quality_metrics.executability.pass_rate * 100,
    report.quality_metrics.step_expectation_mapping.pass_rate * 100
  ];
  report.overall_quality_score = Math.round(
    scores.reduce((a, b) => a + b, 0) / scores.length
  );
  report.quality_level =
    report.overall_quality_score >= 90
      ? '优秀'
      : report.overall_quality_score >= 80
        ? '良好'
        : report.overall_quality_score >= 60
          ? '合格'
          : '不合格';

  report.passed =
    report.quality_metrics.atomicity.pass_rate >= QUALITY_TARGETS.atomicity &&
    report.quality_metrics.completeness.pass_rate >= QUALITY_TARGETS.completeness &&
    report.quality_metrics.step_expectation_mapping.pass_rate >=
      QUALITY_TARGETS.step_expect &&
    apiMapping.ok &&
    report.overall_quality_score >= QUALITY_TARGETS.overall;

  return report;
}

function attachDemand61Quality(report, extras) {
  report.demand61 = {
    sort_applied: true,
    absorb_skipped_tp_ids: extras.absorb_skipped_tp_ids || [],
    title_typing: extras.title_typing || null,
    platform_explosion: extras.platform_explosion || null,
    domain_facts_read: false,
    note: 'Stage4 仅消费 C-TP（+ merge_report absorb）；不读 domain_facts.json'
  };
  return report;
}

// ─── Excel / XMind / KB ──────────────────────────────────

function generateExcel(testCases, outPath) {
  const templateWorkbook = XLSX.readFile(EXCEL_TEMPLATE);
  const workbook = XLSX.utils.book_new();
  const data = [];

  data.push(['用例管理 # dmp_testcase']);
  data.push([
    '请将鼠标移到灰色标题行查看字段录入要求。红色带星号（*）的字段为必录字段。'
  ]);
  data.push([
    'team',
    'caseGroup',
    'number',
    'name',
    'caseLabels',
    'preCondition',
    'input',
    'output',
    'product',
    'modulePath',
    'version',
    'caseType',
    'source',
    'caseLevel',
    'manager',
    'autoState',
    'relateReqCode',
    'workload',
    'remarks',
    'separator',
    'autoCaseId',
    'autoCaseName',
    'autoProductId',
    'autoVersionId'
  ]);
  data.push([
    '*项目组',
    '*功能路径（用例分组）',
    '用例编号',
    '*功能点（用例名称）',
    '用例标签',
    '功能说明（前置条件）',
    'input（步骤描述）',
    'output（预期结果）',
    '*产品',
    '*模块路径',
    '适用版本',
    '*用例类型',
    '来源',
    '用例级别',
    '*责任人',
    '已实现自动化',
    '关联用户故事',
    '工作量（分钟）',
    '备注',
    '分隔符',
    '接口自动化用例ID',
    '接口自动化用例名称',
    '接口自动化产品ID',
    '接口自动化版本ID'
  ]);

  for (const tc of testCases.test_cases) {
    const row = new Array(24).fill('');
    const labels = formatDisplayLabels(tc);
    row[1] = `${tc.module_l1}-${tc.module_l2 || ''}`.replace(/-$/, '');
    row[2] = tc.id;
    row[3] = tc.title;
    row[4] = labels.join(',');
    row[5] = tc.precondition;
    row[6] = tc.steps
      .map((s, i) => `${stepOrder(s, i)}. ${stepAction(s)}`)
      .join('\n');
    row[7] = tc.steps
      .map((s, i) => `${stepOrder(s, i)}. ${stepExpected(s)}`)
      .join('\n');
    row[8] = (tc.product_tags || []).join(',');
    row[9] = row[1];
    row[10] = (tc.version_tags || []).join(',');
    row[11] = '功能测试';
    row[12] = (tc.source || []).join(',');
    row[13] = tc.priority;
    row[15] = '否';
    row[16] = testCases.requirement_title;
    data.push(row);
  }

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [
    { wch: 15 },
    { wch: 30 },
    { wch: 15 },
    { wch: 50 },
    { wch: 30 },
    { wch: 40 },
    { wch: 65 },
    { wch: 65 },
    { wch: 20 },
    { wch: 30 },
    { wch: 20 },
    { wch: 15 },
    { wch: 25 },
    { wch: 12 },
    { wch: 15 },
    { wch: 15 },
    { wch: 20 },
    { wch: 12 },
    { wch: 20 },
    { wch: 12 },
    { wch: 20 },
    { wch: 20 },
    { wch: 20 },
    { wch: 20 }
  ];
  XLSX.utils.book_append_sheet(workbook, ws, templateWorkbook.SheetNames[0]);
  for (let i = 1; i < templateWorkbook.SheetNames.length; i++) {
    const sheetName = templateWorkbook.SheetNames[i];
    if (templateWorkbook.Sheets[sheetName]) {
      XLSX.utils.book_append_sheet(
        workbook,
        templateWorkbook.Sheets[sheetName],
        sheetName
      );
    }
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  XLSX.writeFile(workbook, outPath);
  return { total_rows: testCases.test_cases.length, columns: 24, path: outPath };
}

function exportXmind(projectDir, testCases) {
  const tree = buildTestCasesTree(testCases);
  const outPath = getXmindPaths(projectDir, testCases.requirement_title).testCases;
  const written = writeTestCasesXmind(tree, outPath);
  return written;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function workspaceRelative(projectDir, filePath) {
  const relative = path.relative(projectDir, filePath).split(path.sep).join('/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new Error('最终产物不在工作区内: ' + filePath);
  }
  return relative;
}

/** C-TC 与 XMind 均写完后刷新最终产物清单；Excel 是否跳过不影响清单。 */
function writeFinalArtifact(projectDir, testCasesPath, xmindPath) {
  const paths = stage4Paths(projectDir);
  const manifest = {
    schema_version: '6.4',
    finalized: true,
    finalized_at: nowIso(),
    artifacts: [
      {
        type: 'c_tc',
        path: workspaceRelative(projectDir, testCasesPath),
        sha256: sha256File(testCasesPath)
      },
      {
        type: 'xmind',
        path: workspaceRelative(projectDir, xmindPath),
        sha256: sha256File(xmindPath)
      }
    ]
  };
  const result = validateData(manifest, FINAL_ARTIFACT_SCHEMA);
  if (!result.ok) {
    throw new Error(
      'final_artifact schema 校验失败: ' +
        (result.errors || []).slice(0, 5).join('; ')
    );
  }
  writeJson(paths.finalArtifact, manifest);
  return { path: paths.finalArtifact, manifest };
}

function runKnowledgeBase(projectDir, testCases, enabled) {
  const paths = stage4Paths(projectDir);
  fs.mkdirSync(paths.kbDir, { recursive: true });

  if (!enabled) {
    writeJson(paths.kbManifest, {
      enabled: false,
      schema_version: SCRIPT_VERSION,
      note: '知识库转化默认关闭；使用 --kb 开启；产物仅允许 script/stage4/knowledge_base/',
      generated_at: nowIso()
    });
    return { enabled: false, path: paths.kbManifest };
  }

  // 轻量占位：完整控件图谱属 Hybrid，默认不对用户展示
  const controls = testCases.test_cases.map((tc) => ({
    case_id: tc.id,
    title: tc.title,
    module: `${tc.module_l1}/${tc.module_l2 || ''}`.replace(/\/$/, ''),
    tags: formatDisplayLabels(tc)
  }));
  writeJson(paths.kbManifest, {
    enabled: true,
    schema_version: SCRIPT_VERSION,
    generated_at: nowIso(),
    control_count: controls.length,
    max_relation_depth: 3,
    note: '仅存 script/；禁止复制到工作区根或 output/ 除非用户明确要求'
  });
  writeJson(path.join(paths.kbDir, 'controls_index.json'), {
    requirement_title: testCases.requirement_title,
    controls: controls
  });
  return { enabled: true, path: paths.kbDir, control_count: controls.length };
}

function writeCompletionReport(projectDir, testCases, qualityReport, extras) {
  const paths = stage4Paths(projectDir);
  const byModule = {};
  const byPriority = { P0: 0, P1: 0, P2: 0, P3: 0 };
  const byPlatform = {};
  let totalSteps = 0;

  for (const tc of testCases.test_cases) {
    byModule[tc.module_l1] = (byModule[tc.module_l1] || 0) + 1;
    byPriority[tc.priority] = (byPriority[tc.priority] || 0) + 1;
    for (const p of tc.platform_tags || []) {
      byPlatform[p] = (byPlatform[p] || 0) + 1;
    }
    totalSteps += tc.steps.length;
  }

  const report = {
    stage4_completion_report: {
      report_id: 'STAGE4-COMP-001',
      report_time: nowLocal(),
      schema_version: SCRIPT_VERSION,
      requirement_title: testCases.requirement_title,
      stage_status: qualityReport.passed ? 'completed' : 'completed_with_quality_fail',
      output_products: {
        'test_cases.json': {
          path: 'script/stage4/test_cases.json',
          cases_count: testCases.test_cases.length
        },
        'test_cases.xmind': {
          path: 'output/测试用例_' + testCases.requirement_title + '.xmind',
          note: extras.xmindPath || ''
        },
        'test_cases.xlsx': {
          path: extras.excelSkipped
            ? null
            : 'script/stage4/test_cases.xlsx',
          note: 'Excel 默认不进 output/'
        },
        quality_report: { path: 'script/stage4/quality_report.json' },
        final_artifact: { path: 'script/stage4/final_artifact.json' },
        knowledge_base: {
          enabled: !!extras.kbEnabled,
          path: 'script/stage4/knowledge_base/'
        }
      },
      statistics_summary: {
        total_cases: testCases.test_cases.length,
        by_module: byModule,
        by_priority: byPriority,
        by_platform: byPlatform,
        average_steps:
          Math.round((totalSteps / Math.max(testCases.test_cases.length, 1)) * 10) /
          10,
        quality_score: qualityReport.overall_quality_score,
        quality_passed: qualityReport.passed
      },
      preview_hint: {
        xmind_readonly: true,
        source_of_truth: 'script/stage4/test_cases.json',
        section_8_3:
          testCases.test_cases.length <= 40
            ? '小单：对话直接列举改动'
            : '大单：下发改动清单（>40）'
      }
    }
  };
  writeJson(paths.completionReport, report);
  return report;
}

function updateProgress(projectDir, ok) {
  const progressPath = contractPath(projectDir, 'progressTracker');
  if (!fs.existsSync(progressPath)) return;
  const p = readJson(progressPath);
  p.stage4 = p.stage4 || {};
  p.stage4.status = ok ? 'completed' : 'quality_failed';
  p.stage4.completed_at = nowIso();
  writeJson(progressPath, p);
}

// ─── 主流程 ─────────────────────────────────────────────

function runStage4(projectDir, options) {
  const opts = options || {};
  const paths = stage4Paths(projectDir);

  log('项目目录: ' + projectDir);

  const gate = checkStage3Gate(projectDir, opts.skipGate);
  if (!gate.ok) {
    throw new Error((gate.errors || []).join('; '));
  }
  if (gate.skipped) log('⚠ ' + gate.warnings.join('; '));

  const { testPoints, testContext, mergeReport } = loadInputs(projectDir);
  log(
    `输入 C-TP: ${testPoints.test_points.length} 个测试点；上下文: ${testContext.requirement_title || testPoints.requirement_title}`
  );

  const built = buildTestCases(testPoints, mergeReport);
  const testCases = built.doc;
  if (built.absorb_skipped_tp_ids.length) {
    log(
      `absorb 裁剪跳过 ${built.absorb_skipped_tp_ids.length} 个 TP: ${built.absorb_skipped_tp_ids.join(', ')}`
    );
  }
  writeJson(paths.draft, testCases);

  let qualityReport = runQualityValidation(testCases, built.tpById);
  const titleTyping = checkTitleTyping(testCases.test_cases, built.tpById);
  const platformExplosion = checkNoPlatformExplosion(testCases.test_cases);
  qualityReport = attachDemand61Quality(qualityReport, {
    absorb_skipped_tp_ids: built.absorb_skipped_tp_ids,
    title_typing: titleTyping,
    platform_explosion: platformExplosion
  });
  for (const w of titleTyping.warnings || []) {
    log('⚠ 标题分型: ' + w);
  }
  if (!platformExplosion.ok) {
    for (const e of platformExplosion.errors) log('⚠ 端/触发膨胀: ' + e);
  }

  testCases.quality_metrics = {
    atomicity_rate: qualityReport.quality_metrics.atomicity.pass_rate,
    completeness_rate: qualityReport.quality_metrics.completeness.pass_rate,
    step_expect_match_rate:
      qualityReport.quality_metrics.step_expectation_mapping.pass_rate,
    overall_score: qualityReport.overall_quality_score
  };

  const schemaResult = validateData(testCases, TC_SCHEMA);
  if (!schemaResult.ok) {
    writeJson(paths.qualityReport, {
      ...qualityReport,
      schema_errors: schemaResult.errors
    });
    throw new Error(
      'C-TC schema 校验失败: ' +
        (schemaResult.errors || []).slice(0, 5).join('; ')
    );
  }

  writeJson(paths.testCasesJson, testCases);
  writeJson(paths.qualityReport, qualityReport);
  log(`已写 C-TC: ${testCases.test_cases.length} 条 → script/stage4/test_cases.json`);
  log(
    `质量: 原子性 ${(qualityReport.quality_metrics.atomicity.pass_rate * 100).toFixed(0)}% / 完整性 ${(qualityReport.quality_metrics.completeness.pass_rate * 100).toFixed(0)}% / 步骤期望 ${(qualityReport.quality_metrics.step_expectation_mapping.pass_rate * 100).toFixed(0)}% / 综合 ${qualityReport.overall_quality_score} (${qualityReport.quality_level})`
  );

  const xmindWritten = exportXmind(projectDir, testCases);
  log('XMind: output/' + path.basename(xmindWritten.path));
  const finalArtifact = writeFinalArtifact(
    projectDir,
    paths.testCasesJson,
    xmindWritten.path
  );
  log('最终产物清单: script/stage4/final_artifact.json');

  let excelSkipped = false;
  if (opts.noExcel) {
    excelSkipped = true;
    log('已跳过 Excel（--no-excel）');
  } else {
    generateExcel(testCases, paths.testCasesXlsx);
    log('Excel: script/stage4/test_cases.xlsx');
    if (opts.copyExcelToOutput) {
      const dest = path.join(
        projectDir,
        'output',
        '测试用例_' + testCases.requirement_title + '.xlsx'
      );
      fs.copyFileSync(paths.testCasesXlsx, dest);
      log('已按要求复制 Excel → output/（非常规）');
    }
  }

  const kb = runKnowledgeBase(projectDir, testCases, !!opts.kb);
  if (kb.enabled) log('知识库已写: script/stage4/knowledge_base/');
  else log('知识库转化默认关闭（可用 --kb）');

  writeCompletionReport(projectDir, testCases, qualityReport, {
    xmindPath: xmindWritten.path,
    excelSkipped,
    kbEnabled: kb.enabled
  });

  updateProgress(projectDir, qualityReport.passed);

  if (!qualityReport.passed) {
    const err = new Error(
      `用例质量未达标（综合 ${qualityReport.overall_quality_score}），详见 script/stage4/quality_report.json；请回退修改 C-TP，勿在用例层发明业务`
    );
    err.qualityReport = qualityReport;
    err.testCases = testCases;
    throw err;
  }

  return {
    ok: true,
    requirement_title: testCases.requirement_title,
    total_cases: testCases.test_cases.length,
    xmind: xmindWritten.path,
    json: paths.testCasesJson,
    final_artifact: finalArtifact.path,
    quality_score: qualityReport.overall_quality_score
  };
}

function runSelfTest() {
  let failed = 0;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's4-'));
  const fixtureRoot = path.join(SRC_ROOT, 'fixtures', '客户来源调研弹窗');

  const ws = createWorkspace({
    title: '客户来源调研弹窗',
    outputDir: tmp
  }).workspaceRoot;

  fs.copyFileSync(
    path.join(fixtureRoot, 'script', 'stage3', 'test_points.json'),
    path.join(ws, 'script', 'stage3', 'test_points.json')
  );
  fs.copyFileSync(
    path.join(fixtureRoot, 'script', 'config', 'test_context.json'),
    path.join(ws, 'script', 'config', 'test_context.json')
  );

  const progPath = path.join(ws, 'script', 'config', 'progress_tracker.json');
  const prog = readJson(progPath);
  prog.stage3_approved = true;
  prog.stage4_blocked_unmatched = false;
  writeJson(progPath, prog);

  // 门禁：未批准应失败
  try {
    prog.stage3_approved = false;
    writeJson(progPath, prog);
    runStage4(ws, {});
    console.log('✗ 未批准应阻断');
    failed++;
  } catch (e) {
    console.log('✓ 未批准阻断 Stage4');
  }

  prog.stage3_approved = true;
  writeJson(progPath, prog);

  let result;
  try {
    result = runStage4(ws, {});
    console.log('✓ execute from fixture C-TP');
  } catch (e) {
    console.log('✗ execute: ' + e.message);
    failed++;
  }

  const tcPath = contractPath(ws, 'testCases');
  if (fs.existsSync(tcPath)) {
    const v = validateData(readJson(tcPath), TC_SCHEMA);
    console.log((v.ok ? '✓' : '✗') + ' C-TC schema');
    if (!v.ok) {
      console.log(v.errors && v.errors.slice(0, 3));
      failed++;
    }
  } else {
    console.log('✗ 缺少 C-TC');
    failed++;
  }

  const xmind = path.join(ws, 'output', '测试用例_客户来源调研弹窗.xmind');
  console.log((fs.existsSync(xmind) ? '✓' : '✗') + ' output/测试用例_{title}.xmind');
  if (!fs.existsSync(xmind)) failed++;

  const excel = path.join(ws, 'script', 'stage4', 'test_cases.xlsx');
  console.log((fs.existsSync(excel) ? '✓' : '✗') + ' Excel in script/stage4/');
  if (!fs.existsSync(excel)) failed++;

  // 根目录不应有 kb md
  const rootFiles = fs.readdirSync(ws);
  const badRoot = rootFiles.filter(
    (n) => n.endsWith('.md') || n.endsWith('.xlsx') || n.includes('kb')
  );
  console.log((badRoot.length === 0 ? '✓' : '✗') + ' 根目录无 Excel/kb md');
  if (badRoot.length) failed++;

  // 默认无 controls_index（kb 关）
  const controlsIdx = path.join(
    ws,
    'script',
    'stage4',
    'knowledge_base',
    'controls_index.json'
  );
  console.log(
    (!fs.existsSync(controlsIdx) ? '✓' : '✗') + ' 默认不生成知识库索引'
  );
  if (fs.existsSync(controlsIdx)) failed++;

  if (result && result.total_cases >= 1) {
    console.log('✓ cases=' + result.total_cases + ' score=' + result.quality_score);
  }

  // Demand 6.4：导航/UI 步骤原样保留；完整接口断言按 API 追加，Method/Path-only 不追加。
  const apiTp = {
    id: 'TP-064',
    title: '搜索商品后展示唯一结果',
    priority: 'P0',
    module_l1: '销售',
    module_l2: '销售开单',
    product_tags: ['ailit'],
    version_tags: ['单店版'],
    platform_tags: ['APP端'],
    source_rp_ids: ['RP-064'],
    steps_outline: ['导航路径：工作台 > 销售开单 > 商品选择页', '在搜索框输入商品名'],
    expected_outline: ['进入商品选择页', '展示匹配商品'],
    technical_refs: [
      {
        type: 'backend_api',
        platform: 'app',
        page_id: '商品选择页',
        element_name: '搜索框',
        method: 'GET',
        target: '/v1/products',
        kb_ref: 'DF-064-A',
        assertions: [
          { location: 'status', operator: 'eq', expected: 200 },
          { location: 'body', json_path: '$.data', operator: 'contains', expected: '{product}' },
          { location: 'body', json_path: '$.data', operator: 'unique' }
        ]
      },
      {
        type: 'backend_api',
        platform: 'app',
        page_id: '商品选择页',
        element_name: '搜索框',
        method: 'POST',
        target: '/v1/audit',
        kb_ref: 'DF-064-B',
        assertions: [
          { location: 'body', json_path: '$.secret', operator: 'not_contains', expected: 'token' },
          { location: 'body', json_path: '$.id', operator: 'exists' },
          { location: 'body', json_path: '$.legacy', operator: 'not_exists' }
        ]
      },
      {
        type: 'backend_api',
        platform: 'app',
        page_id: '商品选择页',
        element_name: '搜索框',
        method: 'GET',
        target: '/v1/display-only',
        kb_ref: 'DF-064-C'
      }
    ]
  };
  const apiTc = convertTpToTc(apiTp);
  const apiActions = apiTc.steps.filter((s) => /^检查接口 /.test(s.action));
  const apiGenerationOk =
    apiTc.steps[0].action === apiTp.steps_outline[0] &&
    apiTc.steps[1].action === apiTp.steps_outline[1] &&
    apiActions.length === 2 &&
    apiActions[0].expected ===
      '响应状态 等于 200；$.data 包含 {product}；$.data 中数据不重复' &&
    apiActions[1].expected ===
      '$.secret 不包含 token；$.id 存在；$.legacy 不存在';
  console.log((apiGenerationOk ? '✓' : '✗') + ' 6.4 导航保留与 API 双断言');
  if (!apiGenerationOk) failed++;

  const apiDoc = { test_cases: [apiTc] };
  const mappingOk = checkApiAssertionMapping(apiDoc.test_cases, { 'TP-064': apiTp });
  apiTc.steps.pop();
  const mappingMissing = checkApiAssertionMapping(apiDoc.test_cases, { 'TP-064': apiTp });
  console.log(
    (mappingOk.ok && !mappingMissing.ok ? '✓' : '✗') +
      ' 6.4 TP assertions 到 TC API 检查质量门禁'
  );
  if (!(mappingOk.ok && !mappingMissing.ok)) failed++;

  const manifestPath = path.join(ws, 'script', 'stage4', 'final_artifact.json');
  const manifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : null;
  const manifestValidation = manifest
    ? validateData(manifest, FINAL_ARTIFACT_SCHEMA)
    : { ok: false };
  const manifestOk =
    manifestValidation.ok &&
    manifest.artifacts.some((a) => a.type === 'c_tc') &&
    manifest.artifacts.some((a) => a.type === 'xmind');
  console.log((manifestOk ? '✓' : '✗') + ' 6.4 final_artifact 含 C-TC/XMind hash');
  if (!manifestOk) failed++;

  if (manifestOk) {
    const oldHash = manifest.artifacts.find((a) => a.type === 'c_tc').sha256;
    fs.appendFileSync(tcPath, '\n', 'utf8');
    const changedHash = sha256File(tcPath);
    const staleDetected = oldHash !== changedHash;
    console.log((staleDetected ? '✓' : '✗') + ' 6.4 产物变化使旧 hash 失效');
    if (!staleDetected) failed++;
  }

  // S7：工作区故意放 domain_facts，Stage4 仍成功且源码不引用
  const dfDir = path.join(ws, 'script', 'stage1');
  fs.mkdirSync(dfDir, { recursive: true });
  fs.writeFileSync(
    path.join(dfDir, 'domain_facts.json'),
    JSON.stringify({
      schema_version: '6.1',
      requirement_title: '客户来源调研弹窗',
      facts: [
        {
          id: 'DF-001',
          statement: '不应被 Stage4 读取',
          forbid_patterns: ['___NEVER___'],
          source: 'human_review',
          session_only: true
        }
      ]
    }),
    'utf8'
  );
  try {
    runStage4(ws, { noExcel: true });
    const noExcelManifest = readJson(
      path.join(ws, 'script', 'stage4', 'final_artifact.json')
    );
    const noExcelManifestOk =
      validateData(noExcelManifest, FINAL_ARTIFACT_SCHEMA).ok &&
      noExcelManifest.artifacts.length === 2;
    console.log(
      (noExcelManifestOk ? '✓' : '✗') +
        ' S7 存在 domain_facts 且 --no-excel 仍产出最终清单'
    );
    if (!noExcelManifestOk) failed++;
  } catch (e) {
    console.log('✗ S7: ' + e.message);
    failed++;
  }
  const srcOk = assertSourceAvoidsDomainFacts(
    path.join(__dirname, 'stage4_execute.js')
  );
  console.log((srcOk.ok ? '✓' : '✗') + ' S7 源码不引用 domain_facts');
  if (!srcOk.ok) failed++;

  // S6：absorb 裁剪
  writeJson(path.join(ws, 'script', 'stage3', 'merge_report.json'), {
    rules_applied: ['core_no_merge', 'absorb_coverage'],
    entries: [],
    absorb_candidates: [
      { tp_id: 'TP-002', reason: '已被主路径覆盖' }
    ]
  });
  const before = readJson(path.join(ws, 'script', 'stage3', 'test_points.json'))
    .test_points.length;
  const r2 = runStage4(ws, { noExcel: true });
  const after = readJson(contractPath(ws, 'testCases')).test_cases.length;
  const qr = readJson(path.join(ws, 'script', 'stage4', 'quality_report.json'));
  const absorbOk =
    after === before - 1 &&
    qr.demand61 &&
    (qr.demand61.absorb_skipped_tp_ids || []).includes('TP-002');
  console.log((absorbOk ? '✓' : '✗') + ' S6 absorb 裁剪 (' + before + '→' + after + ')');
  if (!absorbOk) failed++;

  console.log(
    (qr.demand61 && qr.demand61.sort_applied && qr.demand61.domain_facts_read === false
      ? '✓'
      : '✗') + ' quality_report.demand61 标记'
  );
  if (
    !(
      qr.demand61 &&
      qr.demand61.sort_applied &&
      qr.demand61.domain_facts_read === false
    )
  ) {
    failed++;
  }

  console.log(
    failed === 0
      ? '\nStage4 self-test PASSED'
      : '\nStage4 self-test FAILED (' + failed + ')'
  );
  return failed === 0;
}

function main() {
  const params = parseArgs(process.argv.slice(2));
  if (params.help) {
    usage();
    process.exit(0);
  }
  if (params.selfTest) {
    process.exit(runSelfTest() ? 0 : 1);
  }
  if (!params.projectDir) {
    usage();
    process.exit(1);
  }

  const projectDir = path.resolve(params.projectDir);
  try {
    const result = runStage4(projectDir, params);
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Stage4 失败:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
}

module.exports = {
  runStage4,
  convertTpToTc,
  buildTestCases,
  runQualityValidation,
  checkStage3Gate,
  writeFinalArtifact
};

if (require.main === module) {
  main();
}
