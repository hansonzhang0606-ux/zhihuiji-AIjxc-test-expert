/**
 * WP-64-PATH self-test.
 */
'use strict';

const assert = require('assert');
const {
  detectDuplicateNavigationSteps,
  extractRelations,
  isNavigationStep,
  normalizeNavigationPath,
  parseNavigationStep
} = require('./navigation_path');

function run() {
  const web = parseNavigationStep(
    '进入销售单详情页（工作台页 → 点击销售单 → 销售单列表页 → 打开销售单 → 销售单详情页）'
  );
  assert.strictEqual(web.valid, true);
  assert.strictEqual(web.target_page, '销售单详情页');
  assert.strictEqual(web.relations.length, 2);
  assert.deepStrictEqual(web.relations[0], {
    from_page: '工作台页',
    action: '点击销售单',
    to_page: '销售单列表页',
    token_indexes: [0, 1, 2]
  });

  const app = parseNavigationStep(
    '进入商品选择页（APP首页 → 点击销售开单 → 销售开单页 → 点击选择商品 → 商品选择页）'
  );
  assert.strictEqual(app.valid, true);
  assert.strictEqual(app.relations.length, 2);

  const legacy = parseNavigationStep(
    '进入商品选择页（APP首页 - 点击销售开单 - 销售开单页 ／ 点击选择商品 ／ 商品选择页）'
  );
  assert.strictEqual(legacy.valid, true);
  assert.strictEqual(
    legacy.normalized_path,
    'APP首页 → 点击销售开单 → 销售开单页 → 点击选择商品 → 商品选择页'
  );
  assert.ok(legacy.warnings.some((warning) => warning.code === 'legacy_separator_normalized'));
  assert.strictEqual(
    normalizeNavigationPath('APP首页-点击销售开单-销售开单页'),
    'APP首页 → 点击销售开单 → 销售开单页'
  );
  assert.strictEqual(
    normalizeNavigationPath('工作台页 ／ 点击销售单 ／ 销售单列表页'),
    '工作台页 → 点击销售单 → 销售单列表页'
  );

  const mismatch = parseNavigationStep(
    '进入商品选择页（APP首页 → 点击销售开单 → 销售开单页）'
  );
  assert.strictEqual(mismatch.valid, false);
  assert.ok(mismatch.errors.some((error) => error.code === 'target_page_mismatch'));

  const noPage = parseNavigationStep('进入商品选择页（启动应用 → 点击销售开单）');
  assert.strictEqual(noPage.valid, false);
  assert.ok(noPage.errors.some((error) => error.code === 'path_has_no_page'));

  const normalizedPage = parseNavigationStep(
    '进入商品选择页面（APP首页 → 点击选择商品 → 商品选择页面）'
  );
  assert.strictEqual(normalizedPage.valid, true);
  assert.strictEqual(normalizedPage.target_page, '商品选择页');
  assert.ok(normalizedPage.warnings.some((warning) => warning.code === 'page_suffix_normalized'));

  const duplicates = detectDuplicateNavigationSteps([
    { action: '进入商品选择页（APP首页 → 点击选择商品 → 商品选择页）' },
    { action: '在搜索框输入商品名称' },
    { action: '进入商品选择页（销售开单页 → 点击选择商品 → 商品选择页）' }
  ]);
  assert.deepStrictEqual(duplicates, [
    { target_page: '商品选择页', step_indexes: [0, 2], count: 2 }
  ]);

  assert.strictEqual(isNavigationStep('进入商品选择页（APP首页 → 商品选择页）'), true);
  assert.strictEqual(isNavigationStep('点击商品选择按钮'), false);
  assert.deepStrictEqual(
    extractRelations(['首页', '点击设置', '设置页']).map((relation) => relation.to_page),
    ['设置页']
  );

  console.log('navigation_path.self_test passed');
}

if (require.main === module) run();

module.exports = { run };
