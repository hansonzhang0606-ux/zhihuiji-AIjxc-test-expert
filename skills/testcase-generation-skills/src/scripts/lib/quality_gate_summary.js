/**
 * Demand 6.1 P2 — 跨阶段质量门禁聚合（可选）
 *
 * 默认不自动运行；仅当 Agent/用户显式请求时写入 summary。
 *
 *   node lib/quality_gate_summary.js --project-dir <工作区> [--write]
 *   node lib/quality_gate_summary.js --self-test
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { contractPath, SRC_ROOT } = require('./workspace');
const { validateData } = require('./validate');

const SCHEMA = path.join(
  SRC_ROOT,
  'contracts',
  'quality_gate_summary.schema.json'
);

function readJsonSafe(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function countFactsGaps(factsApplied) {
  let n = 0;
  for (const f of factsApplied || []) {
    if (f.coverage === 'gap') n++;
  }
  return n;
}

function collectHumanReviewPending(ctx) {
  const pending = [];
  const merge = ctx.mergeReport;
  if (merge && merge.absorb_candidates && merge.absorb_candidates.length) {
    pending.push({
      kind: 'absorb',
      message: `存在 ${merge.absorb_candidates.length} 条 absorb 候选，请确认是否应独立成条`,
      refs: merge.absorb_candidates.map(a => a.tp_id)
    });
  }
  if (merge && merge.facts_applied) {
    const gaps = (merge.facts_applied || []).filter(f => f.coverage === 'gap');
    if (gaps.length) {
      pending.push({
        kind: 'facts_gap',
        message: `临时知识点 ${gaps.length} 条未覆盖到 TP`,
        refs: gaps.map(f => f.fact_id)
      });
    }
  }
  if (merge && merge.purity_violations && merge.purity_violations.length) {
    pending.push({
      kind: 'purity',
      message: '存在主断言纯度违规（定稿应已失败；若仍见此项请重跑 finalize）',
      refs: merge.purity_violations.map(v => v.tp_id)
    });
  }
  if (ctx.rp && (ctx.rp.pending_points || []).length) {
    pending.push({
      kind: 'pending_rp',
      message: `仍有 ${ctx.rp.pending_points.length} 条待确认需求点`,
      refs: ctx.rp.pending_points.map(p => p.id)
    });
  }
  if (ctx.mod && ctx.mod.unmatched_count > 0) {
    pending.push({
      kind: 'unmatched_module',
      message: `模块未匹配 ${ctx.mod.unmatched_count} 条，禁止 approve / Stage4`,
      refs: (ctx.mod.unmatched || []).map(u => u.rp_id)
    });
  }
  return pending;
}

/**
 * @param {string} projectDir
 * @returns {object}
 */
function aggregateQualitySummary(projectDir) {
  const prog = readJsonSafe(contractPath(projectDir, 'progressTracker')) || {};
  const ctxDoc = readJsonSafe(contractPath(projectDir, 'testContext'));
  const rp = readJsonSafe(contractPath(projectDir, 'requirementPoints'));
  const tp = readJsonSafe(contractPath(projectDir, 'testPoints'));
  const mergeReport =
    readJsonSafe(contractPath(projectDir, 'mergeReport')) ||
    (tp && tp.merge_report) ||
    null;
  const matrixRpt = readJsonSafe(
    path.join(projectDir, 'script', 'stage3', 'matrix_filter_report.json')
  );
  const tc = readJsonSafe(contractPath(projectDir, 'testCases'));
  const qr = readJsonSafe(
    path.join(projectDir, 'script', 'stage4', 'quality_report.json')
  );
  const mod = readJsonSafe(contractPath(projectDir, 'moduleAttribution'));
  const factsPath = path.join(projectDir, 'script', 'stage1', 'domain_facts.json');

  const hints = (ctxDoc && ctxDoc.regression_hints) || [];
  const title =
    (rp && rp.requirement_title) ||
    (tp && tp.requirement_title) ||
    (ctxDoc && ctxDoc.requirement_title) ||
    path.basename(projectDir);

  const summary = {
    schema_version: '6.1',
    generated_at: new Date().toISOString(),
    requirement_title: title,
    progress: {
      test_context_approved: !!prog.test_context_approved,
      stage1_approved: !!prog.stage1_approved,
      stage3_approved: !!prog.stage3_approved,
      unmatched_count:
        tp && typeof tp.unmatched_count === 'number'
          ? tp.unmatched_count
          : mod && typeof mod.unmatched_count === 'number'
            ? mod.unmatched_count
            : 0,
      stage4_blocked_unmatched: !!prog.stage4_blocked_unmatched
    },
    regression: {
      hints_total: hints.length,
      auto_skip_count: hints.filter(h => h.auto_skip_tp === true).length
    },
    stage1: {
      confirmed_count: rp ? (rp.confirmed_points || []).length : 0,
      pending_count: rp ? (rp.pending_points || []).length : 0,
      domain_facts_present: fs.existsSync(factsPath)
    },
    stage3: {
      test_points_count: tp ? (tp.test_points || []).length : 0,
      merge_report: {
        absorb_candidates_count: mergeReport
          ? (mergeReport.absorb_candidates || []).length
          : 0,
        regression_skipped_count: mergeReport
          ? (mergeReport.regression_skipped || []).length
          : 0,
        purity_violations_count: mergeReport
          ? (mergeReport.purity_violations || []).length
          : 0,
        facts_applied_count: mergeReport
          ? (mergeReport.facts_applied || []).length
          : 0,
        facts_gap_count: countFactsGaps(
          mergeReport && mergeReport.facts_applied
        ),
        canonical_key_conflicts_count: mergeReport
          ? (mergeReport.canonical_key_conflicts || []).length
          : 0,
        vague_references_count: mergeReport
          ? (mergeReport.vague_references || []).length
          : 0
      },
      matrix_filter_warnings_count: matrixRpt
        ? (matrixRpt.warnings || []).length
        : 0
    },
    stage4: {
      present: !!tc,
      test_cases_count: tc ? (tc.test_cases || []).length : 0,
      ...(qr && qr.overall_quality_score != null
        ? { overall_quality_score: qr.overall_quality_score }
        : {}),
      ...(qr && qr.demand61 ? { demand61: qr.demand61 } : {})
    },
    human_review_pending: collectHumanReviewPending({
      mergeReport,
      rp,
      mod
    })
  };

  return summary;
}

function writeSummary(projectDir, summary) {
  const outPath = path.join(
    projectDir,
    'script',
    'config',
    'quality_gate_summary.json'
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');
  return outPath;
}

function runSelfTest() {
  const os = require('os');
  const { createWorkspace } = require('./workspace');
  let failed = 0;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qgs-'));
  const fixtureRoot = path.join(SRC_ROOT, 'fixtures', '客户来源调研弹窗');
  const ws = createWorkspace({
    title: '客户来源调研弹窗',
    outputDir: tmp
  }).workspaceRoot;

  for (const rel of [
    'script/config/test_context.json',
    'script/config/progress_tracker.json',
    'script/stage1/requirement_points.json',
    'script/stage3/test_points.json',
    'script/stage3/module_attribution.json'
  ]) {
    const src = path.join(fixtureRoot, rel);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(ws, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }

  const prog = readJsonSafe(path.join(ws, 'script', 'config', 'progress_tracker.json'));
  prog.stage1_approved = true;
  prog.test_context_approved = true;
  fs.writeFileSync(
    path.join(ws, 'script', 'config', 'progress_tracker.json'),
    JSON.stringify(prog, null, 2)
  );

  const summary = aggregateQualitySummary(ws);
  const v = validateData(summary, SCHEMA);
  console.log((v.ok ? '✓' : '✗') + ' aggregate + schema');
  if (!v.ok) {
    console.log(v.errors);
    failed++;
  }

  const out = writeSummary(ws, summary);
  console.log((fs.existsSync(out) ? '✓' : '✗') + ' --write');
  if (!fs.existsSync(out)) failed++;

  console.log(
    (summary.stage3.merge_report.regression_skipped_count >= 0 ? '✓' : '✗') +
      ' merge_report counts'
  );

  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }

  if (failed) {
    console.error('quality_gate_summary self-test failed: ' + failed);
    process.exit(1);
  }
  console.log('quality_gate_summary self-test passed');
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    runSelfTest();
    return;
  }
  let projectDir = null;
  let doWrite = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project-dir' && argv[i + 1]) projectDir = argv[++i];
    else if (argv[i] === '--write') doWrite = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`用法:
  node lib/quality_gate_summary.js --project-dir <工作区> [--write]
  node lib/quality_gate_summary.js --self-test`);
      process.exit(0);
    }
  }
  if (!projectDir) {
    console.error('缺少 --project-dir');
    process.exit(1);
  }
  projectDir = path.resolve(projectDir);
  const summary = aggregateQualitySummary(projectDir);
  const v = validateData(summary, SCHEMA);
  if (!v.ok) {
    console.error('summary schema 失败:', v.errors.join('; '));
    process.exit(1);
  }
  if (doWrite) {
    const out = writeSummary(projectDir, summary);
    console.log(JSON.stringify({ ok: true, path: out, summary }, null, 2));
  } else {
    console.log(JSON.stringify({ ok: true, summary }, null, 2));
  }
}

module.exports = {
  aggregateQualitySummary,
  writeSummary,
  SCHEMA
};

if (require.main === module) {
  main();
}
