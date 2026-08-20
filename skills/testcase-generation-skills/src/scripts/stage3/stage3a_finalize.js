/**
 * S3-04～11 — 3A 定稿 / 导出 / 人审②批准
 *
 *   node stage3a_finalize.js --project-dir <工作区> --from-draft <draft.json> [--export]
 *   node stage3a_finalize.js --project-dir <工作区> --approve
 *   node stage3a_finalize.js --self-test
 *
 * 草稿可由 LLM 按 stage3a_testpoint_synthesis.md 生成；亦可直接用已有 C-TP 形状。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { sanitizeTitle } = require('../lib/naming');
const { contractPath, SRC_ROOT, createWorkspace } = require('../lib/workspace');
const { validateData, CONTRACTS_DIR } = require('../lib/validate');
const {
  validateTpData,
  checkStage1Approved
} = require('./validate_tp');
const { isCoreScenario } = require('./nfr_rules');
const { runTpQualityGates } = require('./tp_quality_gates');
const {
  loadDomainFacts,
  assertNoAliasInputs
} = require('../stage1/domain_facts');
const { enrichTpSortFields } = require('../lib/cluster_key');
const {
  attachTechnicalRefsToTestPoints,
  copyTechnicalRefsFromTp,
  factToTechnicalRef,
  stableBackendRefKey
} = require('../lib/technical_refs');

const SCRIPT_VERSION = '6.4.0';
const TP_SCHEMA = path.join(CONTRACTS_DIR, 'test_points.schema.json');

function log(msg) {
  console.log(`[Stage3A finalize ${SCRIPT_VERSION}] ${msg}`);
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function parseArgs(argv) {
  const params = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project-dir' && argv[i + 1]) params.projectDir = argv[++i];
    else if (a === '--from-draft' && argv[i + 1]) params.fromDraft = argv[++i];
    else if (a === '--export') params.doExport = true;
    else if (a === '--approve') params.approve = true;
    else if (a === '--self-test') params.selfTest = true;
    else if (a === '--help' || a === '-h') params.help = true;
  }
  return params;
}

function resolveTitle(projectDir) {
  const sessionPath = contractPath(projectDir, 'sessionInfo');
  if (fs.existsSync(sessionPath)) {
    const s = readJson(sessionPath);
    if (s.requirement_title) return sanitizeTitle(s.requirement_title);
  }
  return sanitizeTitle(path.basename(projectDir));
}

function loadMod(projectDir) {
  const p = contractPath(projectDir, 'moduleAttribution');
  if (!fs.existsSync(p)) {
    throw new Error('缺少 C-MOD，请先运行 stage3_module.js: ' + p);
  }
  return readJson(p);
}

function loadCtx(projectDir) {
  const p = path.join(projectDir, 'script', 'config', 'test_context.json');
  if (!fs.existsSync(p)) return null;
  return readJson(p);
}

function rpModuleMap(mod) {
  const map = {};
  for (const a of mod.attributions || []) {
    map[a.rp_id] = a;
  }
  return map;
}

function defaultTagsFromCtx(ctx) {
  if (!ctx) {
    return {
      product_tags: ['智慧记AI进销存'],
      version_tags: ['开单版', '单店版', '多店版'],
      platform_tags: ['PC端', 'APP端']
    };
  }
  return {
    product_tags: [...(ctx.products.in_scope || [])],
    version_tags: [...(ctx.versions.in_scope || [])],
    platform_tags: [...(ctx.platforms.in_scope || [])]
  };
}

/**
 * 将草稿测试点与 C-MOD / C-CTX 对齐；补 unmatched_count / merge_report
 */
function pickOptionalTpFields(raw) {
  const keys = [
    'canonical_key',
    'primary_object',
    'trigger',
    'condition',
    'primary_outcome',
    'dependency_objects',
    'asserted_objects',
    'cluster_key',
    'sort_key',
    'coverage_candidate',
    'absorb_reason'
  ];
  const out = {};
  for (const k of keys) {
    if (raw[k] != null && raw[k] !== '') out[k] = raw[k];
  }
  return out;
}

function normalizeDraft(draft, mod, ctx, title) {
  const modMap = rpModuleMap(mod);
  const defaults = defaultTagsFromCtx(ctx);
  const points = Array.isArray(draft.test_points) ? draft.test_points : [];
  const normalized = [];

  for (let i = 0; i < points.length; i++) {
    const raw = points[i];
    const id = raw.id || 'TP-' + String(i + 1).padStart(3, '0');
    const sourceIds = raw.source_rp_ids || [];
    let module_l1 = raw.module_l1;
    let module_l2 = raw.module_l2 || '';
    let module_match = raw.module_match;

    // 从首个 source RP 注入模块（未匹配则标 unmatched）
    const primaryRp = sourceIds[0];
    if (primaryRp && modMap[primaryRp]) {
      const a = modMap[primaryRp];
      if (a.module_match === 'unmatched') {
        module_l1 = '未匹配';
        module_l2 = '';
        module_match = 'unmatched';
      } else {
        module_l1 = module_l1 || a.module_l1;
        module_l2 = module_l2 || a.module_l2;
        module_match = module_match || 'matched';
      }
    }
    if (!module_match) {
      module_match = module_l1 === '未匹配' ? 'unmatched' : 'matched';
    }
    if (!module_l1) {
      module_l1 = '未匹配';
      module_match = 'unmatched';
    }

    const isCore =
      typeof raw.is_core_scenario === 'boolean'
        ? raw.is_core_scenario
        : isCoreScenario(raw.title || '');

    normalized.push(
      enrichTpSortFields({
        id,
        title: raw.title,
        priority: raw.priority || 'P1',
        module_l1,
        module_l2,
        module_match,
        product_tags: raw.product_tags || defaults.product_tags,
        version_tags: raw.version_tags || defaults.version_tags,
        platform_tags: raw.platform_tags || defaults.platform_tags,
        source_rp_ids: (sourceIds.length || raw.is_regression) ? sourceIds : ['RP-001'],
        steps_outline: raw.steps_outline || [],
        expected_outline: raw.expected_outline || [],
        is_core_scenario: isCore,
        is_regression: !!raw.is_regression,
        nfr_type: raw.nfr_type != null ? raw.nfr_type : null,
        ...(raw.merged_from ? { merged_from: raw.merged_from } : {}),
        ...pickOptionalTpFields(raw),
        ...(raw.technical_refs
          ? { technical_refs: copyTechnicalRefsFromTp(raw) }
          : {})
      })
    );
  }

  let unmatched_count = normalized.filter(p => p.module_match === 'unmatched').length;
  // C-MOD 有未匹配 RP：若草稿未覆盖，补占位 TP 以免静默丢失
  for (const u of mod.unmatched || []) {
    const covered = normalized.some(
      p => (p.source_rp_ids || []).includes(u.rp_id) && p.module_match === 'unmatched'
    );
    if (!covered) {
      normalized.push({
        id: 'TP-' + String(900 + normalized.length).padStart(3, '0'),
        title: `[未匹配模块] ${u.rp_title || u.rp_id}`,
        priority: 'P1',
        module_l1: '未匹配',
        module_l2: '',
        module_match: 'unmatched',
        product_tags: defaults.product_tags,
        version_tags: defaults.version_tags,
        platform_tags: defaults.platform_tags,
        source_rp_ids: [u.rp_id],
        steps_outline: ['待归属模块后补充步骤'],
        expected_outline: ['模块归属确认前不得进入 Stage4'],
        is_core_scenario: false,
        is_regression: false,
        nfr_type: null
      });
    }
  }
  unmatched_count = normalized.filter(p => p.module_match === 'unmatched').length;

  const merge_report = draft.merge_report || {
    rules_applied: ['core_no_merge'],
    entries: draft.merge_entries || []
  };

  return {
    requirement_title: sanitizeTitle(draft.requirement_title || title),
    test_essence: draft.test_essence || '（待补充测试本质）',
    test_points: normalized,
    unmatched_count,
    merge_report,
    schema_version: '6.0',
    generated_at: new Date().toISOString()
  };
}

function finalizeFromDraft(projectDir, draftPath) {
  const gate = checkStage1Approved(projectDir);
  if (!gate.ok) throw new Error(gate.errors.join('; '));

  const alias = assertNoAliasInputs(projectDir);
  if (!alias.ok) throw new Error(alias.errors.join('; '));

  const mod = loadMod(projectDir);
  const ctx = loadCtx(projectDir);
  const title = resolveTitle(projectDir);
  const draft = readJson(draftPath);
  const rawPoints = Array.isArray(draft.test_points) ? draft.test_points : [];
  const tp = normalizeDraft(draft, mod, ctx, title);

  const rpPath = contractPath(projectDir, 'requirementPoints');
  const rpDoc = fs.existsSync(rpPath) ? readJson(rpPath) : null;
  const factsLoaded = loadDomainFacts(projectDir);
  if (!factsLoaded.ok) throw new Error(factsLoaded.errors.join('; '));

  const tech = attachTechnicalRefsToTestPoints(tp.test_points, factsLoaded.data);
  if (tech.applied) {
    log(`technical_refs 附着 ${tech.applied} 条（来自 domain_facts）`);
  }

  const gates = runTpQualityGates(rawPoints, tp.test_points, {
    rpDoc,
    factsDoc: factsLoaded.data,
    ctx,
    baseMergeReport: tp.merge_report
  });
  if (!gates.ok) {
    throw new Error('C-TP 质量门禁失败: ' + gates.errors.join('; '));
  }
  for (const w of gates.warnings || []) log('⚠ ' + w);
  tp.merge_report = gates.merge_report;

  const schemaResult = validateData(tp, TP_SCHEMA);
  if (!schemaResult.ok) {
    throw new Error('C-TP schema 失败: ' + (schemaResult.errors || []).join('; '));
  }
  const sem = validateTpData(tp, projectDir);
  if (!sem.ok) {
    throw new Error('C-TP 语义失败: ' + sem.errors.join('; '));
  }
  for (const w of sem.warnings || []) {
    log('⚠ ' + w);
  }

  const outPath = contractPath(projectDir, 'testPoints');
  writeJson(outPath, tp);

  const mergePath = contractPath(projectDir, 'mergeReport');
  writeJson(mergePath, tp.merge_report);

  const progressPath = contractPath(projectDir, 'progressTracker');
  if (fs.existsSync(progressPath)) {
    const prog = readJson(progressPath);
    prog.stage3_approved = false;
    delete prog.stage3_approved_at;
    prog.stage4_blocked_unmatched = tp.unmatched_count > 0;
    writeJson(progressPath, prog);
  }

  log('✓ 已定稿: script/stage3/test_points.json');
  log(`  points=${tp.test_points.length} unmatched=${tp.unmatched_count}`);
  if (tp.merge_report.absorb_candidates && tp.merge_report.absorb_candidates.length) {
    log(`  absorb=${tp.merge_report.absorb_candidates.length}`);
  }
  return { tp, outPath };
}

function runExport(projectDir) {
  const cli = path.join(__dirname, 'export_tp_xmind.js');
  const r = spawnSync(process.execPath, [cli, '--project-dir', projectDir], {
    encoding: 'utf8'
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) throw new Error('export_tp_xmind 失败');
  log('✓ 已导出测试点 XMind');
}

function runApprove(projectDir) {
  const tpPath = contractPath(projectDir, 'testPoints');
  if (!fs.existsSync(tpPath)) throw new Error('缺少 C-TP，无法批准');
  const tp = readJson(tpPath);
  const sem = validateTpData(tp, projectDir);
  if (!sem.ok) throw new Error('批准前校验失败: ' + sem.errors.join('; '));
  if (tp.unmatched_count > 0) {
    throw new Error(
      `存在 ${tp.unmatched_count} 个未匹配模块测试点，禁止 stage3_approved / 禁止 Stage4`
    );
  }
  const report = tp.merge_report || {};
  const pathGaps = Array.isArray(report.path_gaps) ? report.path_gaps : [];
  const apiGaps = Array.isArray(report.api_assertion_gaps)
    ? report.api_assertion_gaps
    : [];
  if (pathGaps.length || apiGaps.length) {
    throw new Error(
      `存在阻断缺口：path_gaps=${pathGaps.length}，api_assertion_gaps=${apiGaps.length}，` +
      '请补齐 C-TP/facts 后重新 finalize'
    );
  }

  const progressPath = contractPath(projectDir, 'progressTracker');
  const p = readJson(progressPath);
  p.stage3_approved = true;
  p.stage3_approved_at = new Date().toISOString();
  p.stage4_blocked_unmatched = false;
  writeJson(progressPath, p);
  log('✓ stage3_approved=true');
  console.log(
    JSON.stringify(
      {
        ok: true,
        action: 'approve',
        stage3_approved: true,
        next: '可进入 Stage4'
      },
      null,
      2
    )
  );
}

function runSelfTest() {
  const os = require('os');
  let failed = 0;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's3a-'));
  const ws = createWorkspace({
    title: '客户来源调研弹窗',
    outputDir: tmp
  }).workspaceRoot;

  const fixtureRoot = path.join(SRC_ROOT, 'fixtures', '客户来源调研弹窗');
  fs.copyFileSync(
    path.join(fixtureRoot, 'script', 'stage1', 'requirement_points.json'),
    path.join(ws, 'script', 'stage1', 'requirement_points.json')
  );
  fs.copyFileSync(
    path.join(fixtureRoot, 'script', 'config', 'test_context.json'),
    path.join(ws, 'script', 'config', 'test_context.json')
  );

  const progPath = path.join(ws, 'script', 'config', 'progress_tracker.json');
  const prog = readJson(progPath);
  prog.stage1_approved = true;
  writeJson(progPath, prog);

  const { runModuleAttribution } = require('./stage3_module');
  runModuleAttribution(ws);

  // 未批准门禁：先测 approve 在 unmatched 时失败——用 fixture C-TP 草稿
  const fixtureTp = readJson(
    path.join(fixtureRoot, 'script', 'stage3', 'test_points.json')
  );
  const draftPath = path.join(tmp, 'tp_draft.json');
  const fixturePointsWithNavigation = fixtureTp.test_points.map((point) =>
    point.id === 'TP-001'
      ? {
          ...point,
          steps_outline: [
            '进入销售开单页（工作台页 → 点击销售开单 → 销售开单页）',
            ...(point.steps_outline || [])
          ]
        }
      : point
  );
  writeJson(draftPath, {
    test_essence: fixtureTp.test_essence,
    test_points: fixturePointsWithNavigation,
    merge_report: fixtureTp.merge_report
  });

  const { tp } = finalizeFromDraft(ws, draftPath);
  const ok = tp.unmatched_count === 0 && tp.test_points.length >= 3;
  console.log((ok ? '✓' : '✗') + ' finalize from fixture draft');
  if (!ok) failed++;

  runExport(ws);
  const xmind = path.join(ws, 'output', '测试点_客户来源调研弹窗.xmind');
  console.log((fs.existsSync(xmind) ? '✓' : '✗') + ' export xmind');
  if (!fs.existsSync(xmind)) failed++;

  runApprove(ws);
  const p2 = readJson(progPath);
  console.log((p2.stage3_approved ? '✓' : '✗') + ' stage3_approved');
  if (!p2.stage3_approved) failed++;

  const { collectApiAssertionGaps, collectPathGaps, requiresPagePath } =
    require('./tp_quality_gates');
  const p0Ui = {
    id: 'TP-640',
    priority: 'P0',
    nfr_type: null,
    platform_tags: ['APP端'],
    title: '在商品选择页搜索商品',
    steps_outline: ['点击搜索按钮'],
    expected_outline: ['列表展示目标商品']
  };
  const pathGapCheck = collectPathGaps([p0Ui]);
  const pathGateOk =
    requiresPagePath(p0Ui) &&
    pathGapCheck.gaps.length === 1 &&
    pathGapCheck.gaps[0].page_id === '商品选择页' &&
    !requiresPagePath({ ...p0Ui, priority: 'P1' }) &&
    !requiresPagePath({ ...p0Ui, title: '纯接口校验', steps_outline: ['仅接口请求'] }) &&
    !requiresPagePath({ ...p0Ui, nfr_type: 'performance' });
  console.log((pathGateOk ? '✓' : '✗') + ' 6.4 conservative P0 path gate');
  if (!pathGateOk) failed++;

  const invalidAndDuplicate = collectPathGaps([
    {
      ...p0Ui,
      steps_outline: [
        '进入商品选择页：APP首页 → 商品选择页',
        '进入商品选择页（APP首页 → 点击商品 → 商品选择页）',
        '进入商品选择页（销售开单页 → 点击商品 → 商品选择页）'
      ]
    }
  ]);
  const navigationValidationOk = invalidAndDuplicate.gaps.some(
    gap => gap.reason === 'navigation_syntax_invalid'
  );
  console.log((navigationValidationOk ? '✓' : '✗') + ' 6.4 invalid navigation blocked');
  if (!navigationValidationOk) failed++;
  const duplicateNavigation = collectPathGaps([
    {
      ...p0Ui,
      steps_outline: [
        '进入商品选择页（APP首页 → 点击商品 → 商品选择页）',
        '进入商品选择页（销售开单页 → 点击商品 → 商品选择页）'
      ]
    }
  ]);
  const duplicateNavigationOk = duplicateNavigation.gaps.some(
    gap => gap.reason === 'duplicate_navigation_for_target_page'
  );
  console.log((duplicateNavigationOk ? '✓' : '✗') + ' 6.4 duplicate navigation blocked');
  if (!duplicateNavigationOk) failed++;

  const apiGapCheck = collectApiAssertionGaps([
    {
      ...p0Ui,
      technical_refs: [
        {
          type: 'backend_api',
          platform: 'app',
          page_id: '商品选择页',
          element_name: '顶部.搜索框',
          method: 'GET',
          target: '/v1/products',
          kb_ref: 'DF-064'
        }
      ]
    }
  ]);
  const apiGapOk =
    apiGapCheck.length === 1 &&
    apiGapCheck[0].missing_fields[0] === 'assertions';
  console.log((apiGapOk ? '✓' : '✗') + ' 6.4 relevant API assertion gap');
  if (!apiGapOk) failed++;

  const factRef = factToTechnicalRef({
    id: 'DF-064',
    source: 'kb_applied',
    fact_kind: 'backend_api',
    platforms: ['app'],
    page_id: '商品选择页',
    element_name: '顶部.搜索框',
    backend_api: {
      method: 'get',
      path: 'https://api.example.test/v1/products/12345',
      assertions: [
        {
          location: 'body',
          json_path: '$.data',
          operator: 'contains',
          expected: '商品B',
          ignored: 'must-not-copy'
        }
      ]
    }
  });
  const copiedRefs = copyTechnicalRefsFromTp({ technical_refs: [factRef] });
  copiedRefs[0].assertions[0].expected = 'changed';
  const techRefOk =
    factRef.method === 'GET' &&
    factRef.target === '/v1/products/{id}' &&
    factRef.assertions[0].ignored == null &&
    factRef.assertions[0].expected === '商品B' &&
    stableBackendRefKey(factRef) ===
      'app|商品选择页|顶部.搜索框|GET|/v1/products/{id}';
  console.log((techRefOk ? '✓' : '✗') + ' 6.4 technical_refs normalized deep copy');
  if (!techRefOk) failed++;

  const approvedTp = readJson(contractPath(ws, 'testPoints'));
  approvedTp.merge_report.path_gaps = pathGapCheck.gaps;
  writeJson(contractPath(ws, 'testPoints'), approvedTp);
  try {
    runApprove(ws);
    console.log('✗ 6.4 approve should block path gaps');
    failed++;
  } catch (e) {
    const hit = /path_gaps=1/.test(String(e.message));
    console.log((hit ? '✓' : '✗') + ' 6.4 approve blocked on path gaps');
    if (!hit) failed++;
  }
  approvedTp.merge_report.path_gaps = [];
  approvedTp.merge_report.api_assertion_gaps = apiGapCheck;
  writeJson(contractPath(ws, 'testPoints'), approvedTp);
  try {
    runApprove(ws);
    console.log('✗ 6.4 approve should block API assertion gaps');
    failed++;
  } catch (e) {
    const hit = /api_assertion_gaps=1/.test(String(e.message));
    console.log((hit ? '✓' : '✗') + ' 6.4 approve blocked on API assertion gaps');
    if (!hit) failed++;
  }
  approvedTp.merge_report.api_assertion_gaps = [];
  writeJson(contractPath(ws, 'testPoints'), approvedTp);

  const absorbOk =
    tp.merge_report &&
    Array.isArray(tp.merge_report.rules_applied) &&
    tp.merge_report.rules_applied.includes('slice_by_primary_object');
  console.log((absorbOk ? '✓' : '✗') + ' merge_report 含 slice 标记');
  if (!absorbOk) failed++;

  // S6：absorb 候选写入 merge_report
  const absorbDraft = {
    test_essence: fixtureTp.test_essence,
    test_points: fixtureTp.test_points.map((p, i) =>
      i === 1
        ? { ...p, coverage_candidate: 'absorb', absorb_reason: '已被主路径覆盖' }
        : p
    ),
    merge_report: fixtureTp.merge_report
  };
  writeJson(draftPath, absorbDraft);
  p2.stage3_approved = false;
  writeJson(progPath, p2);
  const { tp: tpAbs } = finalizeFromDraft(ws, draftPath);
  const hasAbsorb =
    tpAbs.merge_report.absorb_candidates &&
    tpAbs.merge_report.absorb_candidates.some(a => a.tp_id === 'TP-002');
  console.log((hasAbsorb ? '✓' : '✗') + ' S6 absorb_candidates');
  if (!hasAbsorb) failed++;

  // S5：主断言混写应失败
  const badPurity = {
    test_essence: '纯度',
    test_points: [
      {
        id: 'TP-801',
        title: '对象A与对象B终态',
        priority: 'P1',
        module_l1: '销售',
        module_l2: '销售单',
        module_match: 'matched',
        product_tags: ['ailit'],
        version_tags: ['单店版'],
        platform_tags: ['PC端'],
        source_rp_ids: ['RP-001'],
        steps_outline: ['准备'],
        expected_outline: ['对象A 与 对象B 均完成'],
        asserted_objects: ['对象A', '对象B'],
        is_core_scenario: false,
        is_regression: false,
        nfr_type: null
      }
    ],
    merge_report: { rules_applied: ['core_no_merge'], entries: [] }
  };
  writeJson(draftPath, badPurity);
  try {
    finalizeFromDraft(ws, draftPath);
    console.log('✗ S5 纯度应失败');
    failed++;
  } catch (e) {
    const hit = /纯度|主对象|混写/.test(String(e.message));
    console.log((hit ? '✓' : '✗') + ' S5 主断言混写定稿失败');
    if (!hit) {
      console.log('  msg=' + e.message);
      failed++;
    }
  }

  // S4：步骤提及依赖 + asserted 单对象 → 通过（与 absorb 定稿类似，单独测门禁）
  const { checkModulePurity } = require('./tp_quality_gates');
  const s4 = checkModulePurity([
    {
      id: 'TP-802',
      module_l1: '销售',
      module_l2: '销售单',
      title: '对象A 结果 R1',
      expected_outline: ['对象A 结果为 R1'],
      steps_outline: ['准备对象B 的数据'],
      asserted_objects: ['对象A'],
      primary_object: '对象A',
      dependency_objects: ['对象B']
    }
  ]);
  console.log((s4.ok ? '✓' : '✗') + ' S4 步骤提及依赖不误杀');
  if (!s4.ok) failed++;

  // auto_skip 回归：小程序端 skip hint 不应生成 TP
  const badSkipReg = {
    test_essence: fixtureTp.test_essence,
    test_points: [
      ...fixtureTp.test_points,
      {
        id: 'TP-088',
        title: '验证小程序端不受本次需求影响',
        priority: 'P3',
        module_l1: '销售',
        module_l2: '销售单',
        module_match: 'matched',
        product_tags: ['ailit'],
        version_tags: ['单店版'],
        platform_tags: ['小程序端'],
        source_rp_ids: ['RP-001'],
        steps_outline: ['小程序端首单保存'],
        expected_outline: ['无异常'],
        is_core_scenario: false,
        is_regression: true,
        nfr_type: null
      }
    ],
    merge_report: fixtureTp.merge_report
  };
  writeJson(draftPath, badSkipReg);
  try {
    finalizeFromDraft(ws, draftPath);
    console.log('✗ auto_skip 回归 TP 应失败');
    failed++;
  } catch (e) {
    const hit = /auto_skip_tp|auto_skip/.test(String(e.message));
    console.log((hit ? '✓' : '✗') + ' auto_skip 回归 TP 定稿失败');
    if (!hit) {
      console.log('  msg=' + e.message);
      failed++;
    }
  }

  // 未匹配阻断 approve
  const bad = readJson(contractPath(ws, 'testPoints'));
  bad.test_points.push({
    id: 'TP-099',
    title: '未匹配样例',
    priority: 'P2',
    module_l1: '未匹配',
    module_l2: '',
    module_match: 'unmatched',
    product_tags: ['ailit'],
    version_tags: ['单店版'],
    platform_tags: ['PC端'],
    source_rp_ids: ['RP-001'],
    steps_outline: ['x'],
    expected_outline: ['y'],
    is_core_scenario: false,
    is_regression: false,
    nfr_type: null
  });
  bad.unmatched_count = 1;
  writeJson(contractPath(ws, 'testPoints'), bad);
  p2.stage3_approved = false;
  writeJson(progPath, p2);
  try {
    runApprove(ws);
    console.log('✗ should block approve on unmatched');
    failed++;
  } catch (e) {
    console.log('✓ approve blocked on unmatched');
  }

  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }
  if (failed) {
    console.error('self-test failed: ' + failed);
    process.exit(1);
  }
  console.log('self-test passed');
  process.exit(0);
}

function main() {
  const params = parseArgs(process.argv.slice(2));
  if (params.help) {
    console.log(`
Stage3A 定稿 (Demand 6.0)

  node stage3a_finalize.js --project-dir <WS> --from-draft <draft.json> [--export]
  node stage3a_finalize.js --project-dir <WS> --approve
  node stage3a_finalize.js --self-test
`);
    process.exit(0);
  }
  if (params.selfTest) {
    runSelfTest();
    return;
  }
  if (!params.projectDir) {
    console.error('需要 --project-dir');
    process.exit(1);
  }
  const projectDir = path.resolve(params.projectDir);
  try {
    if (params.approve) {
      runApprove(projectDir);
    } else if (params.fromDraft) {
      finalizeFromDraft(projectDir, path.resolve(params.fromDraft));
      if (params.doExport) runExport(projectDir);
    } else {
      console.error('需要 --from-draft 或 --approve');
      process.exit(1);
    }
  } catch (e) {
    console.error('错误: ' + e.message);
    process.exit(1);
  }
}

module.exports = { finalizeFromDraft, runApprove, normalizeDraft };

if (require.main === module) {
  main();
}
