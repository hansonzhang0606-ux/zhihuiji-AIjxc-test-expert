/**
 * Stage3 模块归属（3.3 / Demand 6.0 / S3-01～03）
 *
 *   node stage3_module.js --project-dir <工作区>
 *   node stage3_module.js --self-test
 *
 * 读：script/stage1/requirement_points.json（C-RP）
 * 规则：src/templates/模块匹配规则.md（只读，勿用工作区 templates）
 * 写：script/stage3/module_attribution.json（C-MOD）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { sanitizeTitle } = require('../lib/naming');
const { contractPath, SRC_ROOT, createWorkspace } = require('../lib/workspace');
const {
  EXPECTED_MAPPING_VERSION,
  BUILTIN_KEYWORD_MAPPING,
  toModuleL1
} = require('./module_keyword_mapping');
const { matchPoint, pickPrimary } = require('../shared/module_matcher');

const SCRIPT_VERSION = '6.0';
const MAPPING_MD = path.join(SRC_ROOT, 'templates', '模块匹配规则.md');

function log(msg) {
  console.log(`[Stage3 module ${SCRIPT_VERSION}] ${msg}`);
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
    else if (a === '--self-test') params.selfTest = true;
    else if (a === '--help' || a === '-h') params.help = true;
  }
  return params;
}

function resolveTitle(projectDir) {
  const sessionPath = contractPath(projectDir, 'sessionInfo');
  if (fs.existsSync(sessionPath)) {
    try {
      const s = readJson(sessionPath);
      if (s.requirement_title) return sanitizeTitle(s.requirement_title);
    } catch (_) {
      /* ignore */
    }
  }
  return sanitizeTitle(path.basename(projectDir));
}

function checkStage1Gate(projectDir) {
  const progressPath = contractPath(projectDir, 'progressTracker');
  if (!fs.existsSync(progressPath)) {
    return { ok: false, reason: '缺少 progress_tracker.json' };
  }
  const p = readJson(progressPath);
  if (p.stage1_approved !== true) {
    return {
      ok: false,
      reason: 'stage1_approved≠true：须先完成人审①′（可用 fixture 自测时手动置 true）'
    };
  }
  return { ok: true };
}

function readMappingVersion(content) {
  const m = content.match(/\|\s*(\d+\.\d+)\s*\|\s*\d{4}-\d{2}-\d{2}\s*\|/g);
  if (!m || !m.length) return 'unknown';
  const last = m[m.length - 1].match(/\|\s*(\d+\.\d+)\s*\|/);
  return last ? last[1] : 'unknown';
}

function loadMapping() {
  if (!fs.existsSync(MAPPING_MD)) {
    throw new Error('缺少 模块匹配规则.md: ' + MAPPING_MD);
  }
  const content = fs.readFileSync(MAPPING_MD, 'utf8');
  const docVersion = readMappingVersion(content);
  let versionOk = true;
  if (docVersion !== 'unknown' && docVersion !== EXPECTED_MAPPING_VERSION) {
    versionOk = false;
    console.warn(
      `[Stage3 module] ⚠ mapping 版本不一致：文档=${docVersion} 脚本期望=${EXPECTED_MAPPING_VERSION}；请同步 module_keyword_mapping.js 与 模块匹配规则.md`
    );
  } else {
    log(`mapping 版本 OK：${docVersion}（期望 ${EXPECTED_MAPPING_VERSION}）`);
  }
  return {
    rules: BUILTIN_KEYWORD_MAPPING,
    docVersion,
    versionOk,
    mappingPath: MAPPING_MD
  };
}

function collectPoints(rp) {
  const list = [];
  for (const p of rp.confirmed_points || []) {
    list.push({ ...p, _bucket: 'confirmed' });
  }
  for (const p of rp.pending_points || []) {
    list.push({ ...p, _bucket: 'pending' });
  }
  return list;
}

function searchTextForPoint(_rpDoc, point) {
  // 仅用该需求点自身文本匹配，避免 domain_objects/boundaries 污染导致「全员假匹配」
  return [point.title || '', point.detail || '', point.description || ''].join(' ');
}

function runModuleAttribution(projectDir, opts) {
  const skipGate = opts && opts.skipGate;
  if (!skipGate) {
    const gate = checkStage1Gate(projectDir);
    if (!gate.ok) throw new Error(gate.reason);
  }

  const rpPath = contractPath(projectDir, 'requirementPoints');
  if (!fs.existsSync(rpPath)) {
    throw new Error('缺少 C-RP: ' + rpPath);
  }
  const rp = readJson(rpPath);
  const title = sanitizeTitle(rp.requirement_title || resolveTitle(projectDir));
  const { rules, docVersion, versionOk, mappingPath } = loadMapping();

  const attributions = [];
  const unmatched = [];

  for (const point of collectPoints(rp)) {
    const text = searchTextForPoint(rp, point);
    const hits = matchPoint(text, rules);
    const primary = pickPrimary(hits);
    if (!primary) {
      unmatched.push({
        rp_id: point.id,
        rp_title: point.title || '',
        reason: 'module_mapping 无命中，严禁臆造模块'
      });
      attributions.push({
        rp_id: point.id,
        rp_title: point.title || '',
        module_l1: '未匹配',
        module_l2: '',
        module_match: 'unmatched',
        match_keyword: null,
        confidence: 'low',
        all_hits: []
      });
      continue;
    }
    attributions.push({
      rp_id: point.id,
      rp_title: point.title || '',
      module_l1: toModuleL1(primary.module),
      module_l2: primary.sub_module,
      module_match: 'matched',
      match_keyword: primary.match_keyword,
      confidence: primary.confidence,
      all_hits: hits.map(h => ({
        module_l1: toModuleL1(h.module),
        module_l2: h.sub_module,
        match_keyword: h.match_keyword
      }))
    });
  }

  const out = {
    schema_version: '6.0',
    requirement_title: title,
    mapping_source: 'src/templates/模块匹配规则.md',
    mapping_version: docVersion,
    mapping_version_expected: EXPECTED_MAPPING_VERSION,
    mapping_version_ok: versionOk,
    attributions,
    unmatched,
    unmatched_count: unmatched.length,
    completed_at: new Date().toISOString()
  };

  const outPath = contractPath(projectDir, 'moduleAttribution');
  writeJson(outPath, out);

  // 重跑清除 stage3_approved
  const progressPath = contractPath(projectDir, 'progressTracker');
  if (fs.existsSync(progressPath)) {
    const prog = readJson(progressPath);
    if (prog.stage3_approved) {
      prog.stage3_approved = false;
      delete prog.stage3_approved_at;
      prog.stage4_blocked_unmatched = unmatched.length > 0;
      writeJson(progressPath, prog);
      log('已清除 stage3_approved（重新归属）');
    } else {
      prog.stage4_blocked_unmatched = unmatched.length > 0;
      writeJson(progressPath, prog);
    }
  }

  log('✓ 已写入: script/stage3/module_attribution.json');
  log(
    `匹配 ${attributions.length - unmatched.length}/${attributions.length}；未匹配 ${unmatched.length}`
  );
  for (const u of unmatched) {
    log(`  [未匹配] ${u.rp_id}: ${u.rp_title}`);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        action: 'module_attribution',
        requirement_title: title,
        unmatched_count: unmatched.length,
        mapping_version_ok: versionOk,
        mapping_path: mappingPath,
        path: 'script/stage3/module_attribution.json'
      },
      null,
      2
    )
  );
  return out;
}

function runSelfTest() {
  const os = require('os');
  let failed = 0;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's3-mod-'));
  const ws = createWorkspace({
    title: '客户来源调研弹窗',
    outputDir: tmp
  }).workspaceRoot;

  const fixtureRoot = path.join(SRC_ROOT, 'fixtures', '客户来源调研弹窗');
  fs.copyFileSync(
    path.join(fixtureRoot, 'script', 'stage1', 'requirement_points.json'),
    path.join(ws, 'script', 'stage1', 'requirement_points.json')
  );
  const progPath = path.join(ws, 'script', 'config', 'progress_tracker.json');
  const prog = readJson(progPath);
  prog.stage1_approved = true;
  writeJson(progPath, prog);

  const out = runModuleAttribution(ws, { skipGate: false });
  const okMatch =
    out.unmatched_count === 0 &&
    out.attributions.every(a => a.module_match === 'matched') &&
    out.attributions.some(a => a.module_l1 === '销售' || a.module_l1 === '客户');
  console.log((okMatch ? '✓' : '✗') + ' fixture C-RP → 全部匹配');
  if (!okMatch) {
    console.log(JSON.stringify(out, null, 2));
    failed++;
  }
  console.log((out.mapping_version_ok ? '✓' : '✗') + ' mapping 版本校验');
  if (!out.mapping_version_ok) failed++;

  // 未匹配用例：伪造无关键词 RP
  const rp = readJson(path.join(ws, 'script', 'stage1', 'requirement_points.json'));
  rp.confirmed_points.push({
    id: 'RP-999',
    title: '完全无映射的玄学功能点XYZ',
    detail: 'abcdef'
  });
  writeJson(path.join(ws, 'script', 'stage1', 'requirement_points.json'), rp);
  const out2 = runModuleAttribution(ws);
  const okU = out2.unmatched_count === 1 && out2.unmatched[0].rp_id === 'RP-999';
  console.log((okU ? '✓' : '✗') + ' 未匹配写入 unmatched[]');
  if (!okU) failed++;

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
Stage3 模块归属 (Demand 6.0)

  node stage3_module.js --project-dir <工作区>
  node stage3_module.js --self-test
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
  try {
    runModuleAttribution(path.resolve(params.projectDir));
  } catch (e) {
    console.error('错误: ' + e.message);
    process.exit(1);
  }
}

module.exports = { runModuleAttribution, matchPoint, checkStage1Gate };

if (require.main === module) {
  main();
}
