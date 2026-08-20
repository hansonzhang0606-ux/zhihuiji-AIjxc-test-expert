/**
 * S3-14～18 — 3B 矩阵标签裁剪（Demand 6.2 §4）
 *
 *   node stage3b_matrix_tag_filter.js --project-dir <工作区> [--export]
 *   node stage3b_matrix_tag_filter.js --self-test
 *
 * 读：C-TP、C-CTX（可选）、知识库模块矩阵总览的功能支持矩阵
 * 写：写回 C-TP 的 version_tags/product_tags；matrix_filter_report.json
 * 不改：C-TP schema 字段集合；不改 3.3/3A 步骤契约
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { contractPath, createWorkspace, SRC_ROOT } = require('../lib/workspace');
const { sanitizeTitle } = require('../lib/naming');
const {
  loadMatrix,
  lookupModule,
  allowedVersionsForProducts,
  VERSION_TAG
} = require('./version_function_matrix');

const SCRIPT_VERSION = '6.2.0';

const MSG = {
  trimmed: '已按功能矩阵剔除不支持的版本标签',
  productRemoved: '该产品在此功能模块下不受支持，已从产品标签中移除',
  intlNoBilling: '国际版不支持开单版，已从版本标签中移除',
  noMatchingTags: '该功能模块无匹配标签',
  noMatrixRule: '该功能模块在知识库中没有设置标签匹配规则',
  moduleMismatch: '测试点模块与归属结果不一致，已按测试点模块裁剪标签',
  skipUnmatched: '未匹配模块，跳过标签裁剪',
  done: '矩阵标签裁剪完成'
};

function log(msg) {
  console.log(`[Stage3B matrix ${SCRIPT_VERSION}] ${msg}`);
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
    else if (a === '--export') params.doExport = true;
    else if (a === '--self-test') params.selfTest = true;
    else if (a === '--help' || a === '-h') params.help = true;
  }
  return params;
}

function loadCtx(projectDir) {
  const p = path.join(projectDir, 'script', 'config', 'test_context.json');
  if (!fs.existsSync(p)) return null;
  return readJson(p);
}

function loadMod(projectDir) {
  const p = contractPath(projectDir, 'moduleAttribution');
  if (!fs.existsSync(p)) return null;
  return readJson(p);
}

function ctxInScopeVersions(ctx) {
  if (!ctx || !ctx.versions) return null;
  return new Set(ctx.versions.in_scope || []);
}

function ctxInScopeProducts(ctx) {
  if (!ctx || !ctx.products) return null;
  return ctx.products.in_scope || [];
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function rpModuleMap(mod) {
  const map = {};
  if (!mod) return map;
  for (const a of mod.attributions || []) {
    map[a.rp_id] = a;
  }
  return map;
}

/**
 * 对单条 TP 裁剪标签
 * @returns {{ tp: object, entry?: object, warnings: object[], changed: boolean }}
 */
function filterOneTp(tp, matrix, ctx, modMap) {
  const warnings = [];
  const entry = {
    tp_id: tp.id,
    module_l1: tp.module_l1,
    module_l2: tp.module_l2,
    removed_version_tags: [],
    kept_version_tags: [],
    removed_product_tags: [],
    kept_product_tags: [],
    message: null
  };

  if (tp.module_match === 'unmatched') {
    warnings.push({
      tp_id: tp.id,
      module_l1: tp.module_l1,
      module_l2: tp.module_l2,
      code: 'skip_unmatched',
      message: MSG.skipUnmatched
    });
    return { tp, warnings, changed: false };
  }

  // 模块不一致提示（仍以 TP 为准）
  const primaryRp = (tp.source_rp_ids || [])[0];
  if (primaryRp && modMap[primaryRp]) {
    const a = modMap[primaryRp];
    if (
      (a.module_l1 && a.module_l1 !== tp.module_l1) ||
      (a.module_l2 && a.module_l2 !== tp.module_l2)
    ) {
      warnings.push({
        tp_id: tp.id,
        module_l1: tp.module_l1,
        module_l2: tp.module_l2,
        code: 'module_mismatch',
        message: MSG.moduleMismatch
      });
    }
  }

  const row = lookupModule(matrix, tp.module_l1, tp.module_l2);
  if (!row) {
    warnings.push({
      tp_id: tp.id,
      module_l1: tp.module_l1,
      module_l2: tp.module_l2,
      code: 'no_matrix_rule',
      message: MSG.noMatrixRule
    });
    return { tp, warnings, changed: false };
  }

  let products = Array.isArray(tp.product_tags) ? [...tp.product_tags] : [];
  if (products.length === 0) {
    products = [...(ctxInScopeProducts(ctx) || [])];
  }
  if (products.length === 0) {
    products = ['智慧记AI进销存'];
  }

  const allowed = allowedVersionsForProducts(row, products);
  if (!allowed.ok || allowed.reason === 'no_matrix_rule') {
    warnings.push({
      tp_id: tp.id,
      module_l1: tp.module_l1,
      module_l2: tp.module_l2,
      code: 'no_matrix_rule',
      message: MSG.noMatrixRule
    });
    return { tp, warnings, changed: false };
  }

  const beforeProducts = [...products];
  // 剔除该模块下完全不支持的产品
  if (allowed.unsupportedProducts && allowed.unsupportedProducts.length) {
    products = products.filter((p) => !allowed.unsupportedProducts.includes(p));
    // 若全剔光，保留原产品并告警空标签路径走版本
    if (products.length === 0) {
      products = beforeProducts;
    } else {
      for (const p of allowed.unsupportedProducts) {
        if (beforeProducts.includes(p) && !products.includes(p)) {
          entry.removed_product_tags.push(p);
        }
      }
    }
  }

  // 产品变更后重算 allowed（若剔了国际产品等）
  const allowed2 = allowedVersionsForProducts(row, products);
  let versionAllowed = allowed2.versions;

  const ctxVers = ctxInScopeVersions(ctx);
  const beforeVersions = Array.isArray(tp.version_tags) ? [...tp.version_tags] : [];
  let nextVersions = beforeVersions.filter((v) => {
    if (ctxVers && !ctxVers.has(v)) return false;
    return versionAllowed.has(v);
  });

  // 国际产品强制无开单（兜底）
  const hadIntl = products.some((p) => p === 'ailit');
  if (hadIntl && beforeVersions.includes(VERSION_TAG.billing) && !nextVersions.includes(VERSION_TAG.billing)) {
    // already removed
  }

  const changedVersions = !sameSet(beforeVersions, nextVersions);
  const changedProducts = !sameSet(beforeProducts, products);
  const changed = changedVersions || changedProducts;

  entry.removed_version_tags = beforeVersions.filter((v) => !nextVersions.includes(v));
  entry.kept_version_tags = nextVersions;
  entry.kept_product_tags = products;
  if (entry.removed_product_tags.length === 0 && changedProducts) {
    entry.removed_product_tags = beforeProducts.filter((p) => !products.includes(p));
  }

  if (changedVersions && entry.removed_version_tags.length) {
    entry.message =
      hadIntl && entry.removed_version_tags.includes(VERSION_TAG.billing)
        ? MSG.intlNoBilling
        : MSG.trimmed;
  } else if (changedProducts && entry.removed_product_tags.length) {
    entry.message = MSG.productRemoved;
  }

  const next = {
    ...tp,
    version_tags: nextVersions,
    product_tags: products
  };

  // 空标签仅写入报告告警，不往 C-TP 加额外字段（schema additionalProperties:false）
  if (nextVersions.length === 0) {
    warnings.push({
      tp_id: tp.id,
      module_l1: tp.module_l1,
      module_l2: tp.module_l2,
      code: 'no_matching_tags',
      message: MSG.noMatchingTags
    });
  }

  return {
    tp: next,
    entry: changed || nextVersions.length === 0 ? entry : null,
    warnings,
    changed
  };
}

/**
 * @param {object} tpData
 * @param {object} [ctx]
 * @param {object} [mod]
 * @param {object} [matrix]
 */
function applyFilter(tpData, ctx, mod, matrix) {
  const m = matrix || loadMatrix();
  const modMap = rpModuleMap(mod);
  const entries = [];
  const warnings = [];
  let changedCount = 0;
  const test_points = [];

  for (const tp of tpData.test_points || []) {
    const r = filterOneTp(tp, m, ctx, modMap);
    test_points.push(r.tp);
    if (r.entry) entries.push(r.entry);
    if (r.warnings.length) warnings.push(...r.warnings);
    if (r.changed) changedCount++;
  }

  const report = {
    schema_version: SCRIPT_VERSION,
    matrix_source: path.relative(SRC_ROOT, m.source).replace(/\\/g, '/'),
    matrix_section: '【机器区】电脑端 · 功能支持矩阵',
    requirement_title: tpData.requirement_title || null,
    summary: {
      total: test_points.length,
      adjusted: changedCount,
      warnings: warnings.length
    },
    entries,
    warnings,
    message: `${MSG.done}：调整 ${changedCount} 条，告警 ${warnings.length} 条`
  };

  return {
    tpData: { ...tpData, test_points },
    report,
    changedCount
  };
}

function clearStage3Approved(projectDir) {
  const p = path.join(projectDir, 'script', 'config', 'progress_tracker.json');
  if (!fs.existsSync(p)) return;
  const prog = readJson(p);
  if (prog.stage3_approved) {
    prog.stage3_approved = false;
    delete prog.stage3_approved_at;
    writeJson(p, prog);
    log('已清除 stage3_approved（标签已变更，需重新人审②）');
  }
}

function runExport(projectDir) {
  const script = path.join(__dirname, 'export_tp_xmind.js');
  const r = spawnSync(process.execPath, [script, '--project-dir', projectDir], {
    encoding: 'utf8'
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    throw new Error('export_tp_xmind 失败');
  }
}

function run(projectDir, opts) {
  const options = opts || {};
  const tpPath = contractPath(projectDir, 'testPoints');
  if (!fs.existsSync(tpPath)) {
    throw new Error('缺少 C-TP: ' + tpPath);
  }
  const tpData = readJson(tpPath);
  const ctx = loadCtx(projectDir);
  const mod = loadMod(projectDir);
  const matrix = loadMatrix();

  const { tpData: next, report, changedCount } = applyFilter(
    tpData,
    ctx,
    mod,
    matrix
  );

  writeJson(tpPath, next);
  const reportPath = path.join(
    projectDir,
    'script',
    'stage3',
    'matrix_filter_report.json'
  );
  writeJson(reportPath, report);

  log(report.message);
  for (const w of report.warnings) {
    log('告警: [' + (w.tp_id || '-') + '] ' + w.message);
  }
  if (changedCount > 0) clearStage3Approved(projectDir);

  if (options.doExport) runExport(projectDir);

  return { tpPath, reportPath, report, changedCount };
}

function runSelfTest() {
  let failed = 0;
  const matrix = loadMatrix();

  // 1 套餐去开单
  {
    const tpData = {
      requirement_title: 'self-test',
      test_points: [
        {
          id: 'TP-T1',
          module_l1: '商品',
          module_l2: '套餐',
          module_match: 'matched',
          product_tags: ['智慧记AI进销存'],
          version_tags: ['开单版', '单店版', '多店版'],
          platform_tags: ['PC端']
        }
      ]
    };
    const { tpData: out, report } = applyFilter(tpData, null, null, matrix);
    const v = out.test_points[0].version_tags;
    if (
      v.includes('开单版') ||
      !v.includes('单店版') ||
      !v.includes('多店版')
    ) {
      console.log('✗ 套餐应去掉开单版', v);
      failed++;
    } else console.log('✓ 套餐去掉开单版');
    if (!report.entries.some((e) => e.removed_version_tags.includes('开单版'))) {
      console.log('✗ 报告未记裁剪');
      failed++;
    }
  }

  // 2 门店管理仅多店
  {
    const tpData = {
      test_points: [
        {
          id: 'TP-T2',
          module_l1: '设置',
          module_l2: '门店管理',
          module_match: 'matched',
          product_tags: ['智慧记AI进销存'],
          version_tags: ['开单版', '单店版', '多店版']
        }
      ]
    };
    const { tpData: out } = applyFilter(tpData, null, null, matrix);
    const v = out.test_points[0].version_tags;
    if (v.length !== 1 || v[0] !== '多店版') {
      console.log('✗ 门店管理应仅多店版', v);
      failed++;
    } else console.log('✓ 门店管理仅多店版');
  }

  // 3 云店装修剔国际产品
  {
    const tpData = {
      test_points: [
        {
          id: 'TP-T3',
          module_l1: '云店',
          module_l2: '云店装修',
          module_match: 'matched',
          product_tags: ['智慧记AI进销存', 'ailit'],
          version_tags: ['开单版', '单店版', '多店版']
        }
      ]
    };
    const { tpData: out, report } = applyFilter(tpData, null, null, matrix);
    const p = out.test_points[0].product_tags;
    if (p.includes('ailit')) {
      console.log('✗ 云店装修应去掉 ailit', p);
      failed++;
    } else console.log('✓ 云店装修去掉 ailit');
    const hasProductWarn = report.entries.some(
      (e) => e.removed_product_tags && e.removed_product_tags.includes('ailit')
    );
    if (!hasProductWarn) {
      console.log('✗ 报告应记录剔除 ailit');
      failed++;
    }
  }

  // 4 销售全支持（国内）标签可保留三角色版本
  {
    const tpData = {
      test_points: [
        {
          id: 'TP-T4',
          module_l1: '销售',
          module_l2: '销售',
          module_match: 'matched',
          product_tags: ['智慧记AI进销存'],
          version_tags: ['开单版', '单店版', '多店版']
        }
      ]
    };
    const { tpData: out, changedCount } = applyFilter(tpData, null, null, matrix);
    const v = out.test_points[0].version_tags;
    if (!sameSet(v, ['开单版', '单店版', '多店版']) || changedCount !== 0) {
      console.log('✗ 销售国内应不变', v, changedCount);
      failed++;
    } else console.log('✓ 销售国内标签不变');
  }

  // 5 ailit 销售去掉开单
  {
    const tpData = {
      test_points: [
        {
          id: 'TP-T5',
          module_l1: '销售',
          module_l2: '销售',
          module_match: 'matched',
          product_tags: ['ailit'],
          version_tags: ['开单版', '单店版', '多店版']
        }
      ]
    };
    const { tpData: out } = applyFilter(tpData, null, null, matrix);
    const v = out.test_points[0].version_tags;
    if (v.includes('开单版') || !v.includes('单店版')) {
      console.log('✗ ailit 销售应去开单', v);
      failed++;
    } else console.log('✓ ailit 销售去掉开单版');
  }

  // 6 模块不在矩阵
  {
    const tpData = {
      test_points: [
        {
          id: 'TP-T6',
          module_l1: '虚构',
          module_l2: '不存在',
          module_match: 'matched',
          product_tags: ['智慧记AI进销存'],
          version_tags: ['开单版']
        }
      ]
    };
    const { tpData: out, report } = applyFilter(tpData, null, null, matrix);
    if (out.test_points[0].version_tags[0] !== '开单版') {
      console.log('✗ 无规则应保留原标签');
      failed++;
    }
    if (!report.warnings.some((w) => w.message === MSG.noMatrixRule)) {
      console.log('✗ 应告警知识库无规则', report.warnings);
      failed++;
    } else console.log('✓ 无矩阵规则中文告警');
  }

  // 7 裁剪后为空
  {
    const tpData = {
      test_points: [
        {
          id: 'TP-T7',
          module_l1: '设置',
          module_l2: '门店管理',
          module_match: 'matched',
          product_tags: ['智慧记AI进销存'],
          version_tags: ['开单版', '单店版']
        }
      ]
    };
    const { tpData: out, report } = applyFilter(tpData, null, null, matrix);
    if (out.test_points[0].version_tags.length !== 0) {
      console.log('✗ 应裁空', out.test_points[0].version_tags);
      failed++;
    }
    if (!report.warnings.some((w) => w.message === MSG.noMatchingTags)) {
      console.log('✗ 应告警无匹配标签');
      failed++;
    } else console.log('✓ 无匹配标签中文告警');
  }

  // 8 幂等
  {
    const tpData = {
      test_points: [
        {
          id: 'TP-T8',
          module_l1: '商品',
          module_l2: '套餐',
          module_match: 'matched',
          product_tags: ['智慧记AI进销存'],
          version_tags: ['开单版', '单店版', '多店版']
        }
      ]
    };
    const r1 = applyFilter(tpData, null, null, matrix);
    const r2 = applyFilter(r1.tpData, null, null, matrix);
    if (r2.changedCount !== 0) {
      console.log('✗ 二次应幂等', r2.report);
      failed++;
    } else console.log('✓ 幂等');
  }

  // 9 工作区联调冒烟
  {
    const title = '3B矩阵标签自测';
    const ws = createWorkspace({
      title,
      outputDir: path.join(SRC_ROOT, 'fixtures'),
      writeBootstrapConfig: true
    }).workspaceRoot;
    const ctx = {
      products: {
        in_scope: ['智慧记AI进销存'],
        out_of_scope: [],
        source: 'self-test'
      },
      versions: {
        in_scope: ['开单版', '单店版', '多店版'],
        out_of_scope: [],
        source: 'self-test'
      },
      platforms: { in_scope: ['PC端'], out_of_scope: [], source: 'self-test' }
    };
    writeJson(path.join(ws, 'script', 'config', 'test_context.json'), ctx);
    writeJson(contractPath(ws, 'testPoints'), {
      schema_version: '6.0',
      requirement_title: title,
      test_essence: '3B',
      unmatched_count: 0,
      test_points: [
        {
          id: 'TP-001',
          title: '套餐',
          priority: 'P1',
          module_l1: '商品',
          module_l2: '套餐',
          module_match: 'matched',
          product_tags: ['智慧记AI进销存'],
          version_tags: ['开单版', '单店版', '多店版'],
          platform_tags: ['PC端'],
          source_rp_ids: [],
          steps_outline: ['x'],
          expected_outline: ['y']
        }
      ]
    });
    const r = run(ws, { doExport: false });
    const tp = readJson(contractPath(ws, 'testPoints'));
    if (tp.test_points[0].version_tags.includes('开单版')) {
      console.log('✗ 工作区写回失败');
      failed++;
    } else console.log('✓ 工作区写回 + 报告', path.basename(r.reportPath));
  }

  if (failed) {
    console.error('self-test failed: ' + failed);
    process.exit(1);
  }
  console.log('stage3b_matrix_tag_filter self-test OK');
}

function main() {
  const params = parseArgs(process.argv.slice(2));
  if (params.help) {
    console.log(`用法:
  node stage3b_matrix_tag_filter.js --project-dir <工作区> [--export]
  node stage3b_matrix_tag_filter.js --self-test
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
    run(path.resolve(params.projectDir), { doExport: !!params.doExport });
  } catch (e) {
    console.error('错误: ' + e.message);
    process.exit(1);
  }
}

module.exports = { applyFilter, run, MSG, filterOneTp };

if (require.main === module) {
  main();
}
