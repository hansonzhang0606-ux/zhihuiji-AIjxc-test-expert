/**
 * WP-63-CORE / REVIEW 最小闭环自测（临时目录，不改样例库）
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareOverview, prepareReview, applyReview } = require('./core/kb_core');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function assert(name, cond) {
  if (!cond) {
    console.error('✗', name);
    process.exit(1);
  }
  console.log('✓', name);
}

function main() {
  const sample = path.resolve(__dirname, '..', '..', '..', 'src', 'templates', '模块矩阵知识库');
  const tmpKb = path.join(os.tmpdir(), `kb63_core_${Date.now()}`);
  copyDir(sample, tmpKb);

  const input = path.resolve(__dirname, '..', 'fixtures', 'sources', 'text_sales_url_api.txt');
  const overviewRes = prepareOverview({ kbRoot: tmpKb, source: 'text', input });
  assert('overview ok', overviewRes.ok && overviewRes.overview);
  assert('has changes', overviewRes.changeset.changes.length >= 1);

  const reviewRes = prepareReview({
    kbRoot: tmpKb,
    overview: overviewRes.overview,
    changeset: overviewRes.changeset,
    reviewRoot: path.join(os.tmpdir(), `kb63_review_${Date.now()}`)
  });
  assert('review ok', reviewRes.ok && reviewRes.manifest);
  assert('review outside kb', !reviewRes.review_root.startsWith(tmpKb));

  // 未确认不得写入
  const blocked = applyReview({
    kbRoot: tmpKb,
    reviewManifestPath: path.join(reviewRes.review_root, 'review_manifest.json'),
    contentConfirmed: false
  });
  assert('block without content confirm', !blocked.ok);

  const report = applyReview({
    kbRoot: tmpKb,
    reviewManifestPath: path.join(reviewRes.review_root, 'review_manifest.json'),
    contentConfirmed: true
  });
  assert('apply ok', report.ok);
  assert('changed paths', report.changed_paths.length >= 1);
  assert('index rebuilt', report.index && report.index.rebuilt === true);

  const rel = fs.readFileSync(path.join(tmpKb, '销售', '销售', '页面关系.md'), 'utf8');
  assert('url written', rel.includes('/sales/order/list'));

  const { resolveTarget, upsertWebUrl } = require('./core/apply_transaction');
  let escaped = false;
  try {
    resolveTarget(tmpKb, '../outside.md');
  } catch (err) {
    escaped = /path_escape/.test(String(err.message || err));
  }
  assert('reject path escape', escaped);

  const missingPageMd = upsertWebUrl(
    '# 页面关系\n\n## 2. 电脑端（Web）\n\n### 2.1 本端页面名（对照）\n\n| 统一页面名称 | 本端页面名 |\n|--------------|------------|\n| 已有页 | 已有页 |\n\n## 3. APP端\n',
    '新页面页',
    '/new/page'
  );
  assert('upsertWebUrl appends row for missing page', missingPageMd.includes('| 新页面页 | 新页面页 | `/new/page` |'));
  assert('upsertWebUrl no silent comment', !missingPageMd.includes('<!-- applied URL'));

  require('../../../src/scripts/shared/module_matcher').selfTest();
  console.log('self_test_core passed');
}

main();
