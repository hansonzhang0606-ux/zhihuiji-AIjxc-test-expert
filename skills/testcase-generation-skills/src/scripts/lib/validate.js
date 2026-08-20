/**
 * Demand 6.0 Schema 校验 CLI（FOUND-05）
 *
 * - JSON Schema（draft 2020-12）结构校验
 * - test_context 语义规则：每维 in∪out=全量枚举、不相交；regression_hints 与 out 对齐
 *
 * CLI:
 *   node scripts/lib/validate.js --schema <path> --file <json>
 *   node scripts/lib/validate.js --type test_context|requirement_points|test_points|test_cases --file <json>
 *   node scripts/lib/validate.js --self-test
 *
 * 退出码：0 通过，1 失败
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CONTRACTS_DIR = path.resolve(__dirname, '..', '..', 'contracts');

const TYPE_TO_SCHEMA = {
  test_context: 'test_context.schema.json',
  requirement_points: 'requirement_points.schema.json',
  test_points: 'test_points.schema.json',
  test_cases: 'test_cases.schema.json'
};

const FULL_ENUMS = {
  products: ['智慧记AI进销存', 'ailit', '智慧记', '智慧记零售'],
  versions: ['开单版', '单店版', '多店版'],
  platforms: ['PC端', 'APP端', '小程序端', 'H5端']
};

const HINT_TYPE_TO_DIM = {
  product_regression: 'products',
  version_regression: 'versions',
  platform_regression: 'platforms'
};

let _ajv = null;

function getAjv() {
  if (_ajv) return _ajv;
  let Ajv2020;
  let addFormats;
  try {
    Ajv2020 = require('ajv/dist/2020');
    addFormats = require('ajv-formats');
  } catch (e) {
    throw new Error(
      '缺少依赖 ajv / ajv-formats，请在 scripts/ 下执行: npm install ajv ajv-formats'
    );
  }
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateSchema: false
  });
  addFormats(ajv);

  // 预加载全部契约，解析交叉 $ref
  for (const file of Object.values(TYPE_TO_SCHEMA)) {
    const abs = path.join(CONTRACTS_DIR, file);
    if (!fs.existsSync(abs)) continue;
    const schema = JSON.parse(fs.readFileSync(abs, 'utf8'));
    if (!ajv.getSchema(schema.$id)) {
      ajv.addSchema(schema);
    }
  }
  _ajv = ajv;
  return ajv;
}

function loadJson(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error('文件不存在: ' + abs);
  }
  return {
    abs,
    data: JSON.parse(fs.readFileSync(abs, 'utf8'))
  };
}

function resolveSchemaPath(params) {
  if (params.schema) {
    return path.resolve(params.schema);
  }
  if (params.type) {
    const name = TYPE_TO_SCHEMA[params.type];
    if (!name) {
      throw new Error(
        '未知 --type: ' +
          params.type +
          '，可选: ' +
          Object.keys(TYPE_TO_SCHEMA).join(', ')
      );
    }
    return path.join(CONTRACTS_DIR, name);
  }
  throw new Error('请提供 --schema <path> 或 --type <name>');
}

/**
 * @returns {string[]} 错误信息列表
 */
function semanticValidateTestContext(ctx, pathPrefix) {
  const prefix = pathPrefix || 'test_context';
  const errors = [];
  if (!ctx || typeof ctx !== 'object') {
    return errors;
  }

  for (const [dim, full] of Object.entries(FULL_ENUMS)) {
    const block = ctx[dim];
    if (!block || typeof block !== 'object') continue;
    const inn = Array.isArray(block.in_scope) ? block.in_scope : [];
    const out = Array.isArray(block.out_of_scope) ? block.out_of_scope : [];

    const innSet = new Set(inn);
    const outSet = new Set(out);
    for (const v of inn) {
      if (outSet.has(v)) {
        errors.push(
          `${prefix}.${dim}: "${v}" 同时出现在 in_scope 与 out_of_scope`
        );
      }
    }
    const union = new Set([...inn, ...out]);
    for (const v of full) {
      if (!union.has(v)) {
        errors.push(
          `${prefix}.${dim}: 缺少枚举项 "${v}"（in∪out 须覆盖全量）`
        );
      }
    }
    for (const v of union) {
      if (full.indexOf(v) === -1) {
        errors.push(`${prefix}.${dim}: 非法枚举值 "${v}"`);
      }
    }
    if (innSet.size !== inn.length) {
      errors.push(`${prefix}.${dim}.in_scope: 存在重复项`);
    }
    if (outSet.size !== out.length) {
      errors.push(`${prefix}.${dim}.out_of_scope: 存在重复项`);
    }
  }

  const hints = Array.isArray(ctx.regression_hints)
    ? ctx.regression_hints
    : [];
  const expectedTargets = new Set();
  for (const dim of Object.keys(FULL_ENUMS)) {
    const out = (ctx[dim] && ctx[dim].out_of_scope) || [];
    for (const t of out) expectedTargets.add(dim + '::' + t);
  }

  const seenHintTargets = new Set();
  for (let i = 0; i < hints.length; i++) {
    const h = hints[i];
    const dim = HINT_TYPE_TO_DIM[h.type];
    if (!dim) continue;
    const out = (ctx[dim] && ctx[dim].out_of_scope) || [];
    if (out.indexOf(h.target) === -1) {
      errors.push(
        `${prefix}.regression_hints[${i}]: target "${h.target}" 不在 ${dim}.out_of_scope 中`
      );
    }
    const key = dim + '::' + h.target;
    if (seenHintTargets.has(key)) {
      errors.push(
        `${prefix}.regression_hints[${i}]: 重复的回归目标 ${h.target}`
      );
    }
    seenHintTargets.add(key);
  }

  for (const key of expectedTargets) {
    if (!seenHintTargets.has(key)) {
      const target = key.split('::')[1];
      errors.push(
        `${prefix}.regression_hints: 缺少对 out_of_scope 项 "${target}" 的 P3 提示`
      );
    }
  }

  return errors;
}

/**
 * @param {object} data
 * @param {string} schemaAbs
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateData(data, schemaAbs) {
  const ajv = getAjv();
  const schema = JSON.parse(fs.readFileSync(schemaAbs, 'utf8'));
  let validate = schema.$id ? ajv.getSchema(schema.$id) : null;
  if (!validate) {
    validate = ajv.compile(schema);
  }

  const okSchema = validate(data);
  const errors = [];
  if (!okSchema && validate.errors) {
    for (const e of validate.errors) {
      const loc = e.instancePath || e.schemaPath || '';
      errors.push(`schema ${loc}: ${e.message}`);
    }
  }

  const base = path.basename(schemaAbs);
  if (base === 'test_context.schema.json') {
    errors.push(...semanticValidateTestContext(data, ''));
  } else if (base === 'requirement_points.schema.json' && data.test_context) {
    errors.push(
      ...semanticValidateTestContext(data.test_context, 'test_context')
    );
  }

  if (base === 'test_points.schema.json') {
    const points = Array.isArray(data.test_points) ? data.test_points : [];
    const unmatched = points.filter((p) => p.module_match === 'unmatched')
      .length;
    if (
      typeof data.unmatched_count === 'number' &&
      data.unmatched_count !== unmatched
    ) {
      errors.push(
        `unmatched_count=${data.unmatched_count} 与实际 unmatched 数 ${unmatched} 不一致`
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

function validateFile(filePath, schemaPath) {
  const { data } = loadJson(filePath);
  return validateData(data, path.resolve(schemaPath));
}

function buildValidContext() {
  return {
    products: {
      in_scope: ['ailit'],
      out_of_scope: ['智慧记AI进销存', '智慧记', '智慧记零售'],
      confidence: 'high',
      source: 'title'
    },
    versions: {
      in_scope: ['开单版', '单店版', '多店版'],
      out_of_scope: [],
      confidence: 'low',
      source: 'default'
    },
    platforms: {
      in_scope: ['PC端', 'APP端'],
      out_of_scope: ['小程序端', 'H5端'],
      confidence: 'high',
      source: 'title'
    },
    regression_hints: [
      {
        type: 'product_regression',
        target: '智慧记AI进销存',
        priority: 'P3',
        suggestion: '建议增加1条低优先级回归用例，验证智慧记AI进销存不受本次需求影响',
        auto_skip_tp: false
      },
      {
        type: 'product_regression',
        target: '智慧记',
        priority: 'P3',
        suggestion: '（默认 skip）产品「智慧记」不在本次范围，人审①可显式取消 skip 后再生成回归 TP',
        auto_skip_tp: true
      },
      {
        type: 'product_regression',
        target: '智慧记零售',
        priority: 'P3',
        suggestion: '（默认 skip）产品「智慧记零售」不在本次范围，人审①可显式取消 skip 后再生成回归 TP',
        auto_skip_tp: true
      },
      {
        type: 'platform_regression',
        target: '小程序端',
        priority: 'P3',
        suggestion: '（默认 skip）端「小程序端」不在本次范围，人审①可显式取消 skip 后再生成回归 TP',
        auto_skip_tp: true
      },
      {
        type: 'platform_regression',
        target: 'H5端',
        priority: 'P3',
        suggestion: '（默认 skip）端「H5端」不在本次范围，人审①可显式取消 skip 后再生成回归 TP',
        auto_skip_tp: true
      }
    ]
  };
}

function runSelfTest() {
  const ctxSchema = path.join(CONTRACTS_DIR, 'test_context.schema.json');
  let failed = 0;

  const good = validateData(buildValidContext(), ctxSchema);
  console.log((good.ok ? 'PASS' : 'FAIL') + '  合法 test_context');
  if (!good.ok) {
    console.log(good.errors);
    failed++;
  }

  const badOverlap = buildValidContext();
  badOverlap.products.out_of_scope = ['智慧记AI进销存', 'ailit', '智慧记', '智慧记零售'];
  const r1 = validateData(badOverlap, ctxSchema);
  console.log((!r1.ok ? 'PASS' : 'FAIL') + '  拒绝 in/out 重叠');
  if (r1.ok) failed++;

  const badMissingHint = buildValidContext();
  badMissingHint.regression_hints = [];
  const r2 = validateData(badMissingHint, ctxSchema);
  console.log((!r2.ok ? 'PASS' : 'FAIL') + '  拒绝缺少 regression_hints');
  if (r2.ok) failed++;

  const rpSchema = path.join(CONTRACTS_DIR, 'requirement_points.schema.json');
  const rp = {
    requirement_title: '客户来源调研弹窗',
    requirement_essence: '首单保存后弹出调研',
    domain_objects: ['销售单'],
    state_machine: ['草稿', '已保存'],
    boundaries: ['仅新用户'],
    test_context: buildValidContext(),
    confirmed_points: [
      { id: 'RP-001', title: '弹窗展示', detail: '保存成功后弹出' }
    ],
    pending_points: [],
    inventory_checks: {
      affects_stock: false,
      affects_payment: false,
      affects_order_lifecycle: true
    }
  };
  const r3 = validateData(rp, rpSchema);
  console.log((r3.ok ? 'PASS' : 'FAIL') + '  合法 requirement_points');
  if (!r3.ok) {
    console.log(r3.errors);
    failed++;
  }

  return failed === 0;
}

function parseArgs(argv) {
  const params = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--schema' && argv[i + 1]) params.schema = argv[++i];
    else if (a === '--file' && argv[i + 1]) params.file = argv[++i];
    else if (a === '--type' && argv[i + 1]) params.type = argv[++i];
    else if (a === '--self-test') params.selfTest = true;
    else if (a === '--help' || a === '-h') params.help = true;
  }
  return params;
}

function printUsage() {
  console.log(`
Demand 6.0 Schema 校验 (FOUND-05)

  node scripts/lib/validate.js --type test_context --file <json>
  node scripts/lib/validate.js --schema ../../contracts/test_points.schema.json --file <json>
  node scripts/lib/validate.js --self-test

--type 可选: ${Object.keys(TYPE_TO_SCHEMA).join(' | ')}
退出码: 0 通过 / 1 失败
`);
}

function main() {
  const params = parseArgs(process.argv.slice(2));
  if (params.help) {
    printUsage();
    process.exit(0);
  }
  if (params.selfTest) {
    const ok = runSelfTest();
    process.exit(ok ? 0 : 1);
  }
  if (!params.file) {
    printUsage();
    process.exit(1);
  }

  try {
    const schemaPath = resolveSchemaPath(params);
    const result = validateFile(params.file, schemaPath);
    if (result.ok) {
      console.log(JSON.stringify({ ok: true, file: path.resolve(params.file) }, null, 2));
      process.exit(0);
    }
    console.log(
      JSON.stringify(
        {
          ok: false,
          file: path.resolve(params.file),
          schema: schemaPath,
          errors: result.errors
        },
        null,
        2
      )
    );
    process.exit(1);
  } catch (e) {
    console.error('错误:', e.message);
    process.exit(1);
  }
}

module.exports = {
  CONTRACTS_DIR,
  TYPE_TO_SCHEMA,
  validateData,
  validateFile,
  semanticValidateTestContext,
  runSelfTest
};

if (require.main === module) {
  main();
}
