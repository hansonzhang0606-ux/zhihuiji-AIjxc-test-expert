'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeTestCasesXmind } = require('../../../src/scripts/lib/xmind_export');
const { loadXmindSource } = require('./adapters/xmind_source');
const { loadCtcSource } = require('./adapters/ctc_source');
const { buildChangeSet, buildOverview } = require('./core/changeset');
const { evaluateCompleteness } = require('./core/completeness_gate');
const { prepareOverview, prepareReview, applyReview } = require('./core/kb_core');
const { applyChanges } = require('./core/apply_transaction');
const Ajv2020 = require('../../../src/scripts/node_modules/ajv/dist/2020');
const addFormats = require('../../../src/scripts/node_modules/ajv-formats');

function assert(name, condition) {
  if (!condition) throw new Error(`assertion_failed:${name}`);
  console.log('✓', name);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function candidate(items) {
  return {
    schema_version: '6.3',
    source: { type: 'ctc', ref: 'fixture' },
    source_fingerprint: 'sha256:kb64fixture',
    items
  };
}

function main() {
  const root = path.join(os.tmpdir(), `kb64_${Date.now()}`);
  const kb = path.join(root, 'kb');
  copyDir(path.resolve(__dirname, '..', '..', '..', 'src', 'templates', '模块矩阵知识库'), kb);

  const xmind = path.join(root, 'mixed.xmind');
  writeTestCasesXmind({
    root: { title: '6.4', children: [{ title: '销售', children: [{ title: '销售', children: [
      { title: '[P0] TC-001 导航和接口', labels: ['PC端'], children: [
        { title: '步骤1: 进入销售单开单页（销售单列表页 → 新增 → 销售单开单页）', type: 'step' },
        { title: '步骤2: 点击顶部.保存', type: 'step', children: [{ title: '期望结果: 保存成功', type: 'expected_result' }] },
        { title: '技术引用', type: 'technical_refs', children: [
          { title: '页面地址', children: [{ title: '[web] 销售单开单页: /sales/order/edit' }] },
          { title: '后端接口', children: [{ title: '[web] 顶部.保存 POST /api/sales/order' }] }
        ] }
      ] },
      { title: '[P1] TC-002 不应回流', labels: ['PC端'], children: [
        { title: '步骤1: 进入忽略页（销售单列表页 → 打开 → 忽略页）', type: 'step' }
      ] }
    ] }] }] }
  }, xmind);
  const xb = loadXmindSource(xmind);
  assert('functional P0 yields candidates', xb.items.some(i => i.kind === 'page_element'));
  // 导航/技术引用仅 P0：P1 用例不得产出 page_relation / backend_api
  assert(
    'nav/tech P0 only',
    !xb.items.some(i => (i.kind === 'page_relation' || i.kind === 'backend_api') && i.page_id === '忽略页')
  );
  // 业务规则允许 P0/P1，但 P2+ 仍排除；本 fixture 的 P1 标题「不应回流」可产出业务候选
  assert(
    'business channel may include P1 page',
    xb.items.some(i => i.module_reason === 'xmind_business_rules' && i.page_id === '忽略页') ||
      xb.notes.some(n => /业务规则：P0\/P1/.test(n))
  );
  assert('navigation and refs both parsed', xb.items.some(i => i.kind === 'page_relation') && xb.items.some(i => i.kind === 'backend_api'));
  assert('backend only from structured refs', xb.items.filter(i => i.kind === 'backend_api').every(i => /structured/.test(i.module_reason)));

  const ctcPath = path.join(root, 'test_cases.json');
  const ctc = {
    schema_version: '6.0',
    test_cases: [
      {
        id: 'TC-010', title: '销售开单', module_l1: '销售', module_l2: '销售', priority: 'P0',
        platform_tags: ['PC端'],
        steps: [
          { order: 1, action: '进入销售单开单页（销售单列表页 → 新增 → 销售单开单页）', expected: '进入页面' },
          { order: 2, action: '点击顶部.保存', expected: '保存成功' }
        ],
        technical_refs: [{
          type: 'backend_api', platform: 'web', page_id: '销售单开单页',
          element_name: '顶部.保存', method: 'POST', target: '/api/sales/order',
          assertions: [{ location: 'status', operator: 'eq', expected: 200 }]
        }]
      },
      { id: 'TC-011', title: '忽略', priority: 'P2', steps: [] }
    ]
  };
  fs.writeFileSync(ctcPath, JSON.stringify(ctc), 'utf8');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(ctcPath)).digest('hex');
  const manifestPath = path.join(root, 'final_artifact.json');
  const xmindSha = crypto.createHash('sha256').update(fs.readFileSync(xmind)).digest('hex');
  fs.writeFileSync(manifestPath, JSON.stringify({
    schema_version: '6.4', finalized: true, finalized_at: new Date().toISOString(),
    artifacts: [
      { type: 'c_tc', path: 'test_cases.json', sha256: sha },
      { type: 'xmind', path: 'mixed.xmind', sha256: xmindSha }
    ]
  }), 'utf8');
  const cb = loadCtcSource(ctcPath);
  assert('ctc manifest and P0 filter', cb.items.length > 0 && cb.items.every(i => i.case_id === 'TC-010'));
  assert('api-rich sorted first', cb.items[0].kind === 'backend_api' && cb.items[0].assertions.length === 1);
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const candidateSchema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'contracts', 'kb_candidate.schema.json')));
  assert('ctc candidate is schema-valid', ajv.compile(candidateSchema)(cb));
  const ctcOverview = prepareOverview({ kbRoot: kb, source: 'ctc', input: ctcPath });
  assert('ctc is wired through KB core', ctcOverview.ok && ctcOverview.overview.source.type === 'ctc');

  const incomplete = candidate([{
    candidate_id: 'C-001', module_l1: '销售', module_l2: '销售', kind: 'page_element',
    page_id: '销售单列表页', platform: 'web', element_name: '表头.新按钮',
    // 缺 interaction/result → 阻塞；缺 backend_api 仅告警，不得单独阻断
    element: { name: '表头.新按钮', interaction: '', result: '' }
  }]);
  const blockedCs = buildChangeSet(incomplete, { kbRoot: kb, baseCommit: 'local:test', overviewId: 'ov-blocked' });
  const blockedOverview = buildOverview(incomplete, blockedCs.changeset, blockedCs.conflicts);
  blockedOverview.blocked_write = false; // simulate edited overview
  const blockedReview = prepareReview({
    kbRoot: kb, overview: blockedOverview, changeset: blockedCs.changeset,
    reviewRoot: path.join(root, 'blocked-review')
  });
  assert('edited blocked overview cannot review', !blockedReview.ok && blockedReview.error === 'completeness_blocked');

  const fakeReview = path.join(root, 'fake-review');
  fs.mkdirSync(fakeReview, { recursive: true });
  fs.writeFileSync(path.join(fakeReview, 'changeset.json'), JSON.stringify(blockedCs.changeset));
  fs.writeFileSync(path.join(fakeReview, 'overview.json'), JSON.stringify(blockedOverview));
  const fakeManifest = {
    overview_id: 'ov-blocked', review_id: 'rv-blocked', review_root: fakeReview,
    changeset_hash: blockedCs.changeset.changeset_hash, source_fingerprint: incomplete.source_fingerprint,
    base_commit: 'local:test', selected_change_ids: blockedCs.changeset.changes.map(c => c.change_id)
  };
  const fakeManifestPath = path.join(fakeReview, 'review_manifest.json');
  fs.writeFileSync(fakeManifestPath, JSON.stringify(fakeManifest));
  const blockedApply = applyReview({ kbRoot: kb, reviewManifestPath: fakeManifestPath, contentConfirmed: true });
  assert('blocked plan cannot apply', !blockedApply.ok && blockedApply.error === 'completeness_blocked');

  const completeItems = [
    {
      candidate_id: 'C-101', module_l1: '销售', module_l2: '销售', kind: 'page_relation',
      page_id: '销售单详情页', platform: 'web',
      relation: { from: '销售单开单页', action: '查看结果', to: '销售单详情页' }
    },
    {
      candidate_id: 'C-102', module_l1: '销售', module_l2: '销售', kind: 'page_element',
      page_id: '销售单列表页', platform: 'web', element_name: '表头.临时筛选',
      element: {
        name: '表头.临时筛选', interaction: '点击筛选', result: '刷新列表',
        backend_apis: [{ method: 'NONE', path: '无后端调用（纯前端）' }]
      }
    }
  ];
  const complete = candidate(completeItems);
  const gate = evaluateCompleteness({ candidate: complete, kbRoot: kb });
  assert('warning-only can proceed', !gate.report.blocked_write && gate.report.warning_gaps.length > 0);
  const completenessSchema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'contracts', 'kb_completeness_report.schema.json')));
  assert('completeness report is schema-valid', ajv.compile(completenessSchema)(gate.report));
  const first = buildChangeSet(complete, { kbRoot: kb, baseCommit: 'local:test', overviewId: 'ov-idempotent' });
  const applied = applyChanges({
    kbRoot: kb, changeset: first.changeset,
    selectedIds: first.changeset.changes.map(c => c.change_id), contentConfirmed: true
  });
  assert('relation and element apply', applied.ok);
  const second = buildChangeSet(complete, { kbRoot: kb, baseCommit: 'local:test2', overviewId: 'ov-idempotent2' });
  assert('relation and element idempotent', second.changeset.changes.length === 0 &&
    second.changeset.skipped.filter(s => s.reason === 'unchanged').length === 2);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('self_test_64_reflow passed');
}

main();
