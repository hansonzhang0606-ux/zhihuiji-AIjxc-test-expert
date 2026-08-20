/**
 * S1-10 — 需求点 C-RP 校验 + 门禁
 *
 *   node validate_rp.js --project-dir <工作区>
 *   node validate_rp.js --project-dir <工作区> --gate-only
 *   node validate_rp.js --file <requirement_points.json> [--project-dir <工作区>]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { contractPath } = require('../lib/workspace');
const { validateFile, CONTRACTS_DIR } = require('../lib/validate');
const { findCanonicalKeyConflicts } = require('../lib/canonical_key');
const {
  loadDomainFacts,
  assertNoAliasInputs,
  auditDraftAgainstFacts
} = require('./domain_facts');

const RP_SCHEMA = path.join(CONTRACTS_DIR, 'requirement_points.schema.json');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function parseArgs(argv) {
  const params = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project-dir' && argv[i + 1]) params.projectDir = argv[++i];
    else if (a === '--file' && argv[i + 1]) params.file = argv[++i];
    else if (a === '--gate-only') params.gateOnly = true;
    else if (a === '--help' || a === '-h') params.help = true;
  }
  return params;
}

function checkContextApproved(projectDir) {
  const errors = [];
  const progressPath = path.join(projectDir, 'script', 'config', 'progress_tracker.json');
  if (!fs.existsSync(progressPath)) {
    errors.push('缺少 progress_tracker.json');
    return { ok: false, errors, approved: false };
  }
  const p = readJson(progressPath);
  if (p.test_context_approved !== true) {
    errors.push('test_context_approved!==true：禁止进入 1A / 定稿需求点');
  }
  return { ok: errors.length === 0, errors, approved: p.test_context_approved === true };
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalizeCtx(ctx) {
  if (!ctx) return ctx;
  const copy = JSON.parse(JSON.stringify(ctx));
  delete copy.recognized_at;
  return copy;
}

function checkInventoryCoverage(rp) {
  const errors = [];
  const warnings = [];
  const ic = rp.inventory_checks || {};
  const texts = []
    .concat(rp.confirmed_points || [])
    .concat(rp.pending_points || [])
    .map(p => `${p.title || ''} ${p.detail || ''} ${p.pending_reason || ''}`)
    .join('\n');

  const rules = [
    {
      flag: 'affects_stock',
      re: /库存|出入库|盘点|成本|扣减库存|入库|出库/,
      label: '库存链路'
    },
    {
      flag: 'affects_payment',
      re: /收账|支付|收款|结算|付款|资金/,
      label: '收账/支付链路'
    },
    {
      flag: 'affects_order_lifecycle',
      re: /销售单|单据|保存|提交|审核|作废|状态|草稿|已保存/,
      label: '单据生命周期'
    }
  ];

  for (const r of rules) {
    if (!ic[r.flag]) continue;
    if (!r.re.test(texts)) {
      errors.push(
        `inventory_checks.${r.flag}=true 但需求点中未见${r.label}相关描述（应补 confirmed/pending）`
      );
    }
  }

  const pending = rp.pending_points || [];
  const confirmed = rp.confirmed_points || [];
  const total = pending.length + confirmed.length;
  if (total > 0 && pending.length / total > 0.4) {
    warnings.push(
      `pending_points 占比 ${(pending.length / total * 100).toFixed(0)}% > 40%，建议补齐需求点或人工澄清`
    );
  }

  return { errors, warnings };
}

function checkLockedContext(projectDir, rp) {
  const errors = [];
  const ctxPath = path.join(projectDir, 'script', 'config', 'test_context.json');
  if (!fs.existsSync(ctxPath)) {
    errors.push('缺少锁定 C-CTX: script/config/test_context.json');
    return { ok: false, errors };
  }
  const locked = readJson(ctxPath);
  if (!rp.test_context) {
    errors.push('C-RP 缺少 test_context');
    return { ok: false, errors };
  }
  const a = normalizeCtx(locked);
  const b = normalizeCtx(rp.test_context);
  // 对齐比对：忽略 requirement_title / recognized_at 差异时仍比三维
  const dims = ['products', 'versions', 'platforms', 'regression_hints'];
  for (const d of dims) {
    if (!deepEqual(a[d], b[d])) {
      errors.push(`C-RP.test_context.${d} 与锁定 C-CTX 不一致`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function checkCanonicalKeyConflicts(rp) {
  return findCanonicalKeyConflicts(rp.confirmed_points || []);
}

/**
 * 临时知识点 + 并行别名文件门禁（无文件不失败）
 */
function checkDomainFactsGates(projectDir, rpOrDraft) {
  const errors = [];
  const warnings = [];
  const alias = assertNoAliasInputs(projectDir);
  if (!alias.ok) errors.push(...alias.errors);

  const loaded = loadDomainFacts(projectDir);
  if (!loaded.ok) {
    errors.push(...loaded.errors);
    return { ok: false, errors, warnings, facts: null };
  }
  if (loaded.data) {
    const forbid = auditDraftAgainstFacts(rpOrDraft, loaded.data);
    errors.push(...forbid);
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    facts: loaded.data
  };
}

function validateRp(projectDir, filePath) {
  const errors = [];
  const warnings = [];

  const gate = checkContextApproved(projectDir);
  if (!gate.ok) errors.push(...gate.errors);

  const rpPath =
    filePath ||
    path.join(projectDir, 'script', 'stage1', 'requirement_points.json');
  if (!fs.existsSync(rpPath)) {
    errors.push('缺少 C-RP: ' + rpPath);
    return { ok: false, errors, warnings, path: rpPath };
  }

  const schemaResult = validateFile(rpPath, RP_SCHEMA);
  if (!schemaResult.ok) {
    errors.push(...(schemaResult.errors || ['schema 失败']));
  }

  const rp = readJson(rpPath);
  const ctxCheck = checkLockedContext(projectDir, rp);
  if (!ctxCheck.ok) errors.push(...ctxCheck.errors);

  const inv = checkInventoryCoverage(rp);
  errors.push(...inv.errors);
  warnings.push(...inv.warnings);

  const keyCheck = checkCanonicalKeyConflicts(rp);
  if (!keyCheck.ok) errors.push(...keyCheck.errors);

  const factsGate = checkDomainFactsGates(projectDir, rp);
  if (!factsGate.ok) errors.push(...factsGate.errors);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    path: rpPath,
    requirement_title: rp.requirement_title
  };
}

function main() {
  const params = parseArgs(process.argv.slice(2));
  if (params.help || !params.projectDir) {
    console.log(`用法:
  node validate_rp.js --project-dir <工作区> [--gate-only]
  node validate_rp.js --project-dir <工作区> [--file <rp.json>]`);
    process.exit(params.help ? 0 : 1);
  }

  const projectDir = path.resolve(params.projectDir);
  if (params.gateOnly) {
    const gate = checkContextApproved(projectDir);
    console.log(JSON.stringify({ ok: gate.ok, gate: 'test_context_approved', errors: gate.errors }, null, 2));
    process.exit(gate.ok ? 0 : 1);
  }

  const result = validateRp(projectDir, params.file ? path.resolve(params.file) : null);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

module.exports = {
  checkContextApproved,
  validateRp,
  checkInventoryCoverage,
  checkLockedContext,
  checkCanonicalKeyConflicts,
  checkDomainFactsGates
};

if (require.main === module) {
  main();
}
