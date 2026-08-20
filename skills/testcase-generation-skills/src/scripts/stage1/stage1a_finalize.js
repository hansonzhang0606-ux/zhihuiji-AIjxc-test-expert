/**
 * S1-08～12 — 1A 定稿 / 导出协调 / 人审①′批准
 *
 *   node stage1a_finalize.js --project-dir <工作区> --from-draft <draft.json> [--export]
 *   node stage1a_finalize.js --project-dir <工作区> --approve
 *   node stage1a_finalize.js --self-test
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { sanitizeTitle } = require('../lib/naming');
const { contractPath, SRC_ROOT, createWorkspace } = require('../lib/workspace');
const {
  checkContextApproved,
  validateRp,
  checkInventoryCoverage
} = require('./validate_rp');
const { validateFile, CONTRACTS_DIR } = require('../lib/validate');
const {
  runFilter,
  auditDraftAgainstFilter
} = require('./filter_requirement_doc');
const { findCanonicalKeyConflicts } = require('../lib/canonical_key');
const {
  loadDomainFacts,
  assertNoAliasInputs,
  auditDraftAgainstFacts,
  writeDomainFacts,
  emptyFacts
} = require('./domain_facts');

const SCRIPT_VERSION = '6.1.0';
const RP_SCHEMA = path.join(CONTRACTS_DIR, 'requirement_points.schema.json');

function stripPointForContract(p) {
  const out = {
    id: p.id,
    title: p.title,
    detail: p.detail
  };
  if (p.priority_hint) out.priority_hint = p.priority_hint;
  if (p.pending_reason) out.pending_reason = p.pending_reason;
  return out;
}

function log(msg) {
  console.log(`[Stage1A finalize ${SCRIPT_VERSION}] ${msg}`);
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

function loadLockedContext(projectDir) {
  const ctxPath = path.join(projectDir, 'script', 'config', 'test_context.json');
  if (!fs.existsSync(ctxPath)) {
    throw new Error('缺少锁定 C-CTX: ' + ctxPath);
  }
  return readJson(ctxPath);
}

function readReqMd(projectDir) {
  const filtered = path.join(
    projectDir,
    'script',
    'stage1',
    'requirement_filtered.md'
  );
  if (!fs.existsSync(filtered)) {
    throw new Error('缺少过滤正文: script/stage1/requirement_filtered.md（须先跑 filter）');
  }
  return fs.readFileSync(filtered, 'utf8');
}

function ensureFilteredDoc(projectDir, title) {
  const filtered = path.join(
    projectDir,
    'script',
    'stage1',
    'requirement_filtered.md'
  );
  // 每次定稿重跑过滤，保证与原文同步
  runFilter(projectDir, title);
  if (!fs.existsSync(filtered)) {
    throw new Error('过滤失败：未生成 requirement_filtered.md');
  }
  return filtered;
}

/**
 * 脚本辅助：从正文「非目标」与 out_of_scope 冲突句生成越界提示
 */
function assistOutOfBound(draft, lockedCtx, body) {
  const hints = Array.isArray(draft.out_of_bound_hints)
    ? [...draft.out_of_bound_hints]
    : [];
  let n = hints.length + 1;

  const outPlatforms = (lockedCtx.platforms && lockedCtx.platforms.out_of_scope) || [];
  const outProducts = (lockedCtx.products && lockedCtx.products.out_of_scope) || [];

  const lines = String(body || '').split(/\n/);
  for (const line of lines) {
    const s = line.trim();
    if (!s || /^#/.test(s) || /^>/.test(s)) continue;
    // 功能句里宣称要做 out_of_scope 端/产品（且非「不在范围」否定）
    if (/不在(本次)?(改动)?范围|不涉及|不覆盖|除外|非目标/.test(s)) continue;

    for (const p of outPlatforms) {
      if (s.includes(p) && /(支持|实现|覆盖|适配|开发|上线)/.test(s)) {
        const id = 'OOB-' + String(n++).padStart(3, '0');
        if (!hints.some(h => h.source_excerpt === s && h.summary.includes(p))) {
          hints.push({
            id,
            summary: `正文似将「${p}」纳入实现范围`,
            reason: `与锁定上下文 platforms.out_of_scope 含「${p}」冲突`,
            source_excerpt: s.slice(0, 200)
          });
        }
      }
    }
    for (const p of outProducts) {
      if (s.includes(p) && /(支持|实现|覆盖|适配|开发|上线)/.test(s)) {
        const id = 'OOB-' + String(n++).padStart(3, '0');
        if (!hints.some(h => h.source_excerpt === s && h.summary.includes(p))) {
          hints.push({
            id,
            summary: `正文似将「${p}」纳入实现范围`,
            reason: `与锁定上下文 products.out_of_scope 含「${p}」冲突`,
            source_excerpt: s.slice(0, 200)
          });
        }
      }
    }
  }

  return hints;
}

/**
 * 关键词推断 inventory_checks（草稿未给或需校正时）
 */
function assistInventory(draft, body) {
  const text = `${body}\n${JSON.stringify(draft.confirmed_points || [])}\n${JSON.stringify(
    draft.pending_points || []
  )}`;
  const base = draft.inventory_checks || {};
  return {
    affects_stock:
      base.affects_stock != null
        ? !!base.affects_stock
        : /库存|出入库|盘点|扣减库存/.test(text),
    affects_payment:
      base.affects_payment != null
        ? !!base.affects_payment
        : /收账|支付|收款|结算资金/.test(text),
    affects_order_lifecycle:
      base.affects_order_lifecycle != null
        ? !!base.affects_order_lifecycle
        : /销售单|保存成功|单据|审核|作废|草稿/.test(text)
  };
}

function ensureInventoryPending(rp) {
  const inv = checkInventoryCoverage(rp);
  if (inv.errors.length === 0) return rp;

  const pending = [...(rp.pending_points || [])];
  let seq = pending.length + (rp.confirmed_points || []).length + 1;
  for (const err of inv.errors) {
    const id = 'RP-' + String(seq++).padStart(3, '0');
    pending.push({
      id,
      title: '进销存链路待补全',
      pending_reason: err,
      detail: err,
      priority_hint: 'P1'
    });
  }
  rp.pending_points = pending;
  return rp;
}

function clearStage1Approved(projectDir) {
  const progressPath = path.join(projectDir, 'script', 'config', 'progress_tracker.json');
  if (!fs.existsSync(progressPath)) return;
  const p = readJson(progressPath);
  if (p.stage1_approved) {
    p.stage1_approved = false;
    p.stage1_approved_at = null;
    writeJson(progressPath, p);
    log('已清除 stage1_approved（重新定稿）');
  }
}

function finalizeFromDraft(projectDir, draftPath) {
  const gate = checkContextApproved(projectDir);
  if (!gate.ok) {
    throw new Error(gate.errors.join('; '));
  }

  const title = resolveTitle(projectDir);
  ensureFilteredDoc(projectDir, title);

  const locked = loadLockedContext(projectDir);
  const draft = readJson(path.resolve(draftPath));
  const body = readReqMd(projectDir);

  const filterAudit = auditDraftAgainstFilter(draft);
  if (filterAudit.length) {
    const msg = filterAudit
      .map(w => w.id + ': ' + w.reason)
      .join('; ');
    throw new Error(
      '草稿未通过需求文档过滤审计（疑似仍从需求背景抽点）: ' + msg
    );
  }

  // 背景门禁仍只依赖 filter_requirement_doc（不另起过滤链路）
  const alias = assertNoAliasInputs(projectDir);
  if (!alias.ok) {
    throw new Error(alias.errors.join('; '));
  }

  const keyCheck = findCanonicalKeyConflicts(draft.confirmed_points || []);
  if (!keyCheck.ok) {
    throw new Error(keyCheck.errors.join('; '));
  }

  const factsLoaded = loadDomainFacts(projectDir);
  if (!factsLoaded.ok) {
    throw new Error(factsLoaded.errors.join('; '));
  }
  if (factsLoaded.data) {
    const forbid = auditDraftAgainstFacts(draft, factsLoaded.data);
    if (forbid.length) {
      throw new Error(
        '草稿触碰临时知识点禁写: ' + forbid.join('; ')
      );
    }
    log(
      `已注入校验 domain_facts（${factsLoaded.data.facts.length} 条）`
    );
  }

  const rp = {
    requirement_title: title,
    requirement_essence: draft.requirement_essence || '',
    domain_objects: draft.domain_objects || [],
    state_machine: draft.state_machine || [],
    boundaries: draft.boundaries || [],
    test_context: locked,
    confirmed_points: (draft.confirmed_points || []).map(stripPointForContract),
    pending_points: (draft.pending_points || []).map(stripPointForContract),
    out_of_bound_hints: assistOutOfBound(draft, locked, body),
    inventory_checks: assistInventory(draft, body),
    schema_version: '6.0',
    generated_at: new Date().toISOString()
  };

  if (!rp.requirement_essence) {
    throw new Error('草稿缺少 requirement_essence');
  }

  ensureInventoryPending(rp);

  const outPath = path.join(projectDir, 'script', 'stage1', 'requirement_points.json');
  writeJson(outPath, rp);
  clearStage1Approved(projectDir);

  const schemaResult = validateFile(outPath, RP_SCHEMA);
  if (!schemaResult.ok) {
    throw new Error('C-RP schema 失败: ' + (schemaResult.errors || []).join('; '));
  }

  const full = validateRp(projectDir, outPath);
  if (!full.ok) {
    throw new Error('C-RP 校验失败: ' + full.errors.join('; '));
  }

  log('✓ 已定稿: script/stage1/requirement_points.json');
  if (full.warnings && full.warnings.length) {
    for (const w of full.warnings) log('⚠ ' + w);
  }
  log(
    `  confirmed=${rp.confirmed_points.length} pending=${rp.pending_points.length} oob=${(rp.out_of_bound_hints || []).length}`
  );

  return { rp, outPath, warnings: full.warnings || [] };
}

function runExport(projectDir) {
  const script = path.join(__dirname, 'export_rp_xmind.js');
  const r = spawnSync(process.execPath, [script, '--project-dir', projectDir], {
    encoding: 'utf8'
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    throw new Error('export_rp_xmind 失败, exit=' + r.status);
  }
  log('✓ 已导出需求点 XMind');
}

function runApprove(projectDir) {
  const gate = checkContextApproved(projectDir);
  if (!gate.ok) throw new Error(gate.errors.join('; '));

  const full = validateRp(projectDir);
  if (!full.ok) throw new Error('批准前校验失败: ' + full.errors.join('; '));

  const progressPath = path.join(projectDir, 'script', 'config', 'progress_tracker.json');
  const p = fs.existsSync(progressPath) ? readJson(progressPath) : {};
  p.stage1_approved = true;
  p.stage1_approved_at = new Date().toISOString();
  writeJson(progressPath, p);
  log('✓ stage1_approved=true');
  console.log(
    JSON.stringify(
      {
        ok: true,
        action: 'approve',
        stage1_approved: true,
        next: '可进入 Stage2(可选) / Stage3'
      },
      null,
      2
    )
  );
}

function runSelfTest() {
  const os = require('os');
  let failed = 0;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's1a-'));
  const ws = createWorkspace({
    title: '客户来源调研弹窗',
    outputDir: tmp
  }).workspaceRoot;

  const fixtureRoot = path.join(SRC_ROOT, 'fixtures', '客户来源调研弹窗');
  fs.copyFileSync(
    path.join(fixtureRoot, 'input', '需求文档', '客户来源调研弹窗.md'),
    path.join(ws, 'input', '需求文档', '客户来源调研弹窗.md')
  );
  fs.copyFileSync(
    path.join(fixtureRoot, 'script', 'config', 'test_context.json'),
    path.join(ws, 'script', 'config', 'test_context.json')
  );

  // 未批准应失败
  try {
    finalizeFromDraft(
      ws,
      path.join(fixtureRoot, 'script', 'stage1', 'requirement_points.json')
    );
    console.log('✗ gate should block');
    failed++;
  } catch (e) {
    console.log('✓ gate blocks without approve');
  }

  const progressPath = path.join(ws, 'script', 'config', 'progress_tracker.json');
  const prog = readJson(progressPath);
  prog.test_context_approved = true;
  writeJson(progressPath, prog);

  // 用精简草稿（无 test_context）
  const draftPath = path.join(tmp, 'draft.json');
  const fixtureRp = readJson(
    path.join(fixtureRoot, 'script', 'stage1', 'requirement_points.json')
  );
  const draft = {
    requirement_essence: fixtureRp.requirement_essence,
    domain_objects: fixtureRp.domain_objects,
    state_machine: fixtureRp.state_machine,
    boundaries: fixtureRp.boundaries,
    confirmed_points: fixtureRp.confirmed_points,
    pending_points: fixtureRp.pending_points,
    inventory_checks: fixtureRp.inventory_checks,
    out_of_bound_hints: []
  };
  writeJson(draftPath, draft);

  const { rp } = finalizeFromDraft(ws, draftPath);
  const ok =
    rp.test_context &&
    rp.test_context.products.in_scope.includes('ailit') &&
    rp.schema_version === '6.0';
  console.log((ok ? '✓' : '✗') + ' finalize injects locked context');
  if (!ok) failed++;

  runExport(ws);
  const xmind = path.join(ws, 'output', '需求点_客户来源调研弹窗.xmind');
  console.log((fs.existsSync(xmind) ? '✓' : '✗') + ' export xmind');
  if (!fs.existsSync(xmind)) failed++;

  runApprove(ws);
  const p2 = readJson(progressPath);
  console.log((p2.stage1_approved ? '✓' : '✗') + ' stage1_approved');
  if (!p2.stage1_approved) failed++;

  // S1：无 domain_facts 已在上方 finalize 覆盖
  console.log('✓ S1 无 domain_facts 可定稿');

  // S2：同 canonical_key 双 confirmed 应失败
  const dupDraft = {
    ...draft,
    confirmed_points: [
      {
        id: 'RP-101',
        title: '条件C下对象A结果R1',
        detail: 'a',
        trigger: 'T',
        primary_object: '对象A',
        condition: 'C',
        primary_outcome: 'R1'
      },
      {
        id: 'RP-102',
        title: '另一表述',
        detail: 'b',
        trigger: 'T',
        primary_object: '对象A',
        condition: 'C',
        primary_outcome: 'R1'
      }
    ]
  };
  const dupPath = path.join(tmp, 'draft-dup.json');
  writeJson(dupPath, dupDraft);
  try {
    finalizeFromDraft(ws, dupPath);
    console.log('✗ S2 同键应失败');
    failed++;
  } catch (e) {
    const hit = /canonical_key|冲突/.test(String(e.message));
    console.log((hit ? '✓' : '✗') + ' S2 同键双 RP 定稿失败');
    if (!hit) {
      console.log('  msg=' + e.message);
      failed++;
    }
  }

  // S3：forbid 写反应失败
  const factsDoc = emptyFacts('客户来源调研弹窗');
  factsDoc.facts.push({
    id: 'DF-001',
    statement: '对象A 结果为 R1',
    forbid_patterns: ['结果为 R2'],
    source: 'human_review',
    session_only: true
  });
  writeDomainFacts(ws, factsDoc);
  const badFactsDraft = {
    ...draft,
    confirmed_points: [
      {
        id: 'RP-201',
        title: '对象A 结果为 R2',
        detail: '违反临时知识点'
      }
    ]
  };
  const badPath = path.join(tmp, 'draft-forbid.json');
  writeJson(badPath, badFactsDraft);
  try {
    finalizeFromDraft(ws, badPath);
    console.log('✗ S3 forbid 应失败');
    failed++;
  } catch (e) {
    const hit = /禁写|临时知识点/.test(String(e.message));
    console.log((hit ? '✓' : '✗') + ' S3 forbid 定稿失败');
    if (!hit) {
      console.log('  msg=' + e.message);
      failed++;
    }
  }

  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }

  if (failed > 0) {
    console.error('self-test failed: ' + failed);
    process.exit(1);
  }
  console.log('self-test passed');
  process.exit(0);
}

function main() {
  const params = parseArgs(process.argv.slice(2));
  if (params.help) {
    console.log(`用法:
  node stage1a_finalize.js --project-dir <工作区> --from-draft <draft.json> [--export]
  node stage1a_finalize.js --project-dir <工作区> --approve
  node stage1a_finalize.js --self-test`);
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
      return;
    }
    if (!params.fromDraft) {
      console.error('需要 --from-draft 或 --approve');
      process.exit(1);
    }
    const result = finalizeFromDraft(projectDir, params.fromDraft);
    if (params.doExport) runExport(projectDir);
    console.log(
      JSON.stringify(
        {
          ok: true,
          action: 'finalize',
          path: 'script/stage1/requirement_points.json',
          warnings: result.warnings,
          next: 'export_rp_xmind（若未 --export）→ 人审①′ → --approve'
        },
        null,
        2
      )
    );
  } catch (e) {
    console.error('错误: ' + e.message);
    process.exit(1);
  }
}

module.exports = {
  finalizeFromDraft,
  assistOutOfBound,
  assistInventory
};

if (require.main === module) {
  main();
}
