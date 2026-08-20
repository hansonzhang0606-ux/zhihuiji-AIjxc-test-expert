/**
 * XMind / Confluence / migrate / freshness 打包自测
 */
'use strict';

require('./adapters/xmind_source').selfTest();
require('./adapters/confluence_source').selfTest();
require('./migrate_kb_63').selfTest();

const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareOverview, prepareReview, applyReview } = require('./core/kb_core');
const { writeTestCasesXmind } = require('../../../src/scripts/lib/xmind_export');

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
  const tmpKb = path.join(os.tmpdir(), `kb63_src_${Date.now()}`);
  copyDir(sample, tmpKb);

  const xmindPath = path.join(os.tmpdir(), `kb63_reflow_${Date.now()}.xmind`);
  writeTestCasesXmind(
    {
      root: {
        title: '回流自测 · 测试用例',
        children: [
          {
            title: '销售',
            children: [
              {
                title: '销售',
                children: [
                  {
                    title: '[P0] 销售单列表页表头设置',
                    labels: ['PC端'],
                    children: [
                      { title: '前提条件: 无', type: 'precondition' },
                      {
                        title: '步骤1: 打开设置',
                        type: 'step',
                        children: [{ title: '期望结果: 弹窗', type: 'expected_result' }]
                      },
                      {
                        title: '技术引用',
                        type: 'technical_refs',
                        children: [
                          {
                            title: '页面地址',
                            children: [{ title: '[web] 销售单列表页: /sales/order/list' }]
                          },
                          {
                            title: '后端接口',
                            children: [{ title: '[web] 表头.设置 GET /api/v1/columns' }]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    },
    xmindPath
  );

  const ov = prepareOverview({ kbRoot: tmpKb, source: 'xmind', input: xmindPath });
  assert('xmind overview', ov.ok && ov.changeset.changes.length >= 1);

  const rv = prepareReview({
    kbRoot: tmpKb,
    overview: ov.overview,
    changeset: ov.changeset,
    reviewRoot: path.join(os.tmpdir(), `kb63_rv_${Date.now()}`)
  });
  assert('xmind review', rv.ok);

  // 篡改源文件使 fingerprint 变化
  fs.appendFileSync(xmindPath, Buffer.from([0]));
  const stale = applyReview({
    kbRoot: tmpKb,
    reviewManifestPath: path.join(rv.review_root, 'review_manifest.json'),
    contentConfirmed: true
  });
  assert('stale xmind blocked', !stale.ok && (stale.errors || []).includes('source_stale_reprepare_required'));

  // 用新鲜源重新走一遍 apply
  const xmind2 = path.join(os.tmpdir(), `kb63_reflow2_${Date.now()}.xmind`);
  fs.copyFileSync(xmindPath, xmind2);
  // 重新导出干净文件
  writeTestCasesXmind(
    {
      root: {
        title: '回流自测2 · 测试用例',
        children: [
          {
            title: '销售',
            children: [
              {
                title: '销售',
                children: [
                  {
                    title: '[P0] 销售单列表页表头设置',
                    labels: ['PC端'],
                    children: [
                      { title: '前提条件: 无', type: 'precondition' },
                      {
                        title: '步骤1: 打开设置',
                        type: 'step',
                        children: [{ title: '期望结果: 弹窗', type: 'expected_result' }]
                      },
                      {
                        title: '技术引用',
                        type: 'technical_refs',
                        children: [
                          {
                            title: '页面地址',
                            children: [{ title: '[web] 销售单列表页: /sales/order/list' }]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    },
    xmind2
  );
  const ov2 = prepareOverview({ kbRoot: tmpKb, source: 'xmind', input: xmind2 });
  const rv2 = prepareReview({
    kbRoot: tmpKb,
    overview: ov2.overview,
    changeset: ov2.changeset,
    reviewRoot: path.join(os.tmpdir(), `kb63_rv2_${Date.now()}`)
  });
  const report = applyReview({
    kbRoot: tmpKb,
    reviewManifestPath: path.join(rv2.review_root, 'review_manifest.json'),
    contentConfirmed: true
  });
  assert('xmind apply ok', report.ok);

  try {
    fs.unlinkSync(xmindPath);
  } catch (_) {
    /* ignore */
  }
  try {
    fs.unlinkSync(xmind2);
  } catch (_) {
    /* ignore */
  }
  fs.rmSync(tmpKb, { recursive: true, force: true });
  console.log('self_test_sources passed');
}

main();
