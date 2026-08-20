/**
 * C-TP 校验 + Stage3 门禁
 *
 *   node validate_tp.js --project-dir <工作区>
 *   node validate_tp.js --project-dir <工作区> --gate-only
 *   node validate_tp.js --file <test_points.json>
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { contractPath } = require('../lib/workspace');
const { validateFile, CONTRACTS_DIR } = require('../lib/validate');
const { evaluateNfr, isCoreScenario } = require('./nfr_rules');
const {
  collectApiAssertionGaps,
  collectPathGaps
} = require('./tp_quality_gates');

const TP_SCHEMA = path.join(CONTRACTS_DIR, 'test_points.schema.json');

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

function checkStage1Approved(projectDir) {
  const p = path.join(projectDir, 'script', 'config', 'progress_tracker.json');
  if (!fs.existsSync(p)) return { ok: false, errors: ['缺少 progress_tracker'] };
  const prog = readJson(p);
  if (prog.stage1_approved !== true) {
    return { ok: false, errors: ['stage1_approved≠true，禁止 Stage3 定稿/批准'] };
  }
  return { ok: true, errors: [] };
}

function checkInventoryBaseline(projectDir, tp) {
  const warnings = [];
  const rpPath = contractPath(projectDir, 'requirementPoints');
  if (!fs.existsSync(rpPath)) return warnings;
  const rp = readJson(rpPath);
  const checks = rp.inventory_checks || {};
  const titles = (tp.test_points || []).map(t => `${t.title} ${(t.steps_outline || []).join(' ')}`);
  const blob = titles.join('\n');

  if (checks.affects_order_lifecycle) {
    if (!/状态|保存|草稿|关闭|驳回|失败/.test(blob)) {
      warnings.push(
        'inventory: affects_order_lifecycle=true 但测试点未见状态迁移/失败路径覆盖（建议 pending 或补点）'
      );
    }
  }
  if (checks.affects_stock) {
    if (!/库存|仓库|批次|序列号|数量/.test(blob)) {
      warnings.push('inventory: affects_stock=true 但未见库存相关测试点');
    }
  }
  if (checks.affects_payment) {
    if (!/收账|收款|支付|付款|撤销/.test(blob)) {
      warnings.push('inventory: affects_payment=true 但未见收账/支付相关测试点');
    }
  }
  return warnings;
}

function semanticChecks(tp) {
  const errors = [];
  const warnings = [];
  const points = tp.test_points || [];
  let unmatched = 0;
  for (const p of points) {
    if (p.module_match === 'unmatched') unmatched++;
    if (p.module_match === 'matched' && p.module_l1 === '未匹配') {
      errors.push(`${p.id}: module_match=matched 但 module_l1=未匹配`);
    }
    if (p.is_core_scenario && p.merged_from && p.merged_from.length) {
      warnings.push(`${p.id}: 核心场景仍带 merged_from，请确认未违规合并`);
    }
    const core = isCoreScenario(p.title);
    if (core && p.is_core_scenario === false) {
      warnings.push(`${p.id}: 标题似核心开单/收账/支付但 is_core_scenario=false`);
    }
  }
  if (typeof tp.unmatched_count === 'number' && tp.unmatched_count !== unmatched) {
    errors.push(
      `unmatched_count=${tp.unmatched_count} 与实际 unmatched=${unmatched} 不一致`
    );
  }
  const pathCheck = collectPathGaps(points);
  warnings.push(...pathCheck.warnings);
  for (const gap of pathCheck.gaps) {
    warnings.push(
      `${gap.tp_id}: 导航路径缺口 ${gap.page_id}/${gap.platform}（${gap.reason}）`
    );
  }
  for (const gap of collectApiAssertionGaps(points)) {
    warnings.push(
      `${gap.tp_id}: technical_refs[${gap.technical_ref_index}] 接口断言缺少 ${gap.missing_fields.join('/')}`
    );
  }
  return { errors, warnings, unmatched };
}

function validateTpData(tp, projectDir) {
  const schemaPath = TP_SCHEMA;
  // 写临时文件走 validateFile，或用 validateData
  const { validateData } = require('../lib/validate');
  const schemaResult = validateData(tp, schemaPath);
  const errors = [...(schemaResult.errors || [])];
  const warnings = [];

  const sem = semanticChecks(tp);
  errors.push(...sem.errors);
  warnings.push(...sem.warnings);

  if (projectDir) {
    warnings.push(...checkInventoryBaseline(projectDir, tp));
    const nfr = evaluateNfr(
      [
        tp.test_essence,
        ...(tp.test_points || []).map(p => p.title)
      ].join('\n')
    );
    for (const d of nfr) {
      if (!d.should_generate) continue;
      const has = (tp.test_points || []).some(p => p.nfr_type === d.type);
      if (!has) {
        warnings.push(`nfr: 建议补充 ${d.type}（${d.reason}）`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    unmatched_count: sem.unmatched
  };
}

function validateTpFile(filePath, projectDir) {
  const tp = readJson(filePath);
  return { ...validateTpData(tp, projectDir), tp };
}

function main() {
  const params = parseArgs(process.argv.slice(2));
  if (params.help || (!params.projectDir && !params.file)) {
    console.log(`
  node validate_tp.js --project-dir <工作区> [--gate-only]
  node validate_tp.js --file <test_points.json>
`);
    process.exit(params.help ? 0 : 1);
  }

  if (params.gateOnly && params.projectDir) {
    const g = checkStage1Approved(path.resolve(params.projectDir));
    console.log(JSON.stringify(g, null, 2));
    process.exit(g.ok ? 0 : 1);
  }

  let file;
  let projectDir = null;
  if (params.file) {
    file = path.resolve(params.file);
  } else {
    projectDir = path.resolve(params.projectDir);
    file = contractPath(projectDir, 'testPoints');
  }
  if (!fs.existsSync(file)) {
    console.error(JSON.stringify({ ok: false, errors: ['缺少 C-TP: ' + file] }));
    process.exit(1);
  }

  const result = validateTpFile(file, projectDir);
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        errors: result.errors,
        warnings: result.warnings,
        unmatched_count: result.unmatched_count
      },
      null,
      2
    )
  );
  process.exit(result.ok ? 0 : 1);
}

module.exports = {
  validateTpData,
  validateTpFile,
  checkStage1Approved,
  checkInventoryBaseline
};

if (require.main === module) {
  main();
}
