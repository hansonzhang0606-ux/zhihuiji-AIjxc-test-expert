/**
 * Demand 6.0 XMind 通用导出库（XMIND-01）
 *
 * 三种模板：
 *   - requirement_points / test_points：章节树 + 通用写 ZIP
 *   - test_cases：Stage4 专用节点规则（见文末「测试用例」一节）
 *
 * .xmind = ZIP(content.json + metadata.json + manifest.json)，用 adm-zip（勿用 archiver）
 * 布局：所有导出统一 structureClass = org.xmind.ui.logic.right（从左往右）
 *
 * CLI: node lib/xmind_export.js --self-test
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

let AdmZip;
try {
  AdmZip = require('adm-zip');
} catch (e) {
  AdmZip = null;
}

const CREATOR = {
  name: 'testcase-generation-framework',
  version: '6.0.0'
};

/** 统一布局：逻辑图从左往右（根在左，子节点仅向右展开） */
const STRUCTURE_LEFT_TO_RIGHT = 'org.xmind.ui.logic.right';

const KINDS = {
  requirement_points: {
    build: buildRequirementPointsTree,
    suffix: '需求点'
  },
  test_points: {
    build: buildTestPointsTree,
    suffix: '测试点'
  },
  test_cases: {
    build: buildTestCasesTree,
    suffix: '测试用例',
    // 用例写出走 Stage4 专用 convert（见测试用例节）
    write: writeTestCasesXmind
  }
};

// ═══════════════════════════════════════════════════════════
// 通用：写 ZIP（需求点 / 测试点 / 任意已构好的 {root} 树）
// 不含 Stage4 用例节点语义；用例请用 writeTestCasesXmind
// ═══════════════════════════════════════════════════════════

let idCounter = 0;
function genId() {
  return 'topic_' + ++idCounter + '_' + Date.now().toString(36);
}

function resetIdCounter() {
  idCounter = 0;
}

/**
 * 通用：中间树节点 → XMind topic（仅 title / 可选 labels / children）
 * 不做用例前提/步骤/期望等业务约定。
 */
function toXmindTopic(node) {
  const topic = {
    id: genId(),
    title: (node && node.title) || ''
  };
  if (node && Array.isArray(node.labels) && node.labels.length > 0) {
    topic.labels = node.labels.slice();
  }
  if (node && Array.isArray(node.children) && node.children.length > 0) {
    topic.children = {
      attached: node.children.map(toXmindTopic)
    };
  }
  return topic;
}

function normalizeTree(treeOrRoot) {
  if (!treeOrRoot) throw new Error('xmind tree 为空');
  if (treeOrRoot.root) return treeOrRoot;
  return { root: treeOrRoot };
}

/**
 * @param {object} treeOrRoot
 * @param {string} outputPath
 * @param {function} [topicConverter=toXmindTopic]
 */
function writeXmindFile(treeOrRoot, outputPath, topicConverter) {
  if (!AdmZip) {
    throw new Error('缺少依赖 adm-zip，请在 src/scripts 下执行: npm install');
  }
  const convert = topicConverter || toXmindTopic;
  const tree = normalizeTree(treeOrRoot);
  const root = tree.root;
  if (!root || typeof root.title !== 'string') {
    throw new Error('root.title 必填');
  }

  resetIdCounter();
  const abs = path.resolve(outputPath);
  const dir = path.dirname(abs);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const rootTopic = convert(root);
  rootTopic.structureClass = STRUCTURE_LEFT_TO_RIGHT;

  const sheet = {
    id: genId(),
    class: 'sheet',
    title: root.title,
    rootTopic: rootTopic
  };

  const zip = new AdmZip();
  zip.addFile(
    'content.json',
    Buffer.from(JSON.stringify([sheet], null, 2), 'utf8')
  );
  zip.addFile(
    'metadata.json',
    Buffer.from(JSON.stringify({ creator: CREATOR }, null, 2), 'utf8')
  );
  zip.addFile(
    'manifest.json',
    Buffer.from(
      JSON.stringify(
        { 'file-entries': { 'content.json': {}, 'metadata.json': {} } },
        null,
        2
      ),
      'utf8'
    )
  );
  zip.writeZip(abs);

  const stats = fs.statSync(abs);
  return { path: abs, size: stats.size };
}

/**
 * @param {'requirement_points'|'test_points'|'test_cases'} kind
 * @param {object} data
 * @param {string} outputPath
 */
function exportXmind(kind, data, outputPath) {
  const meta = KINDS[kind];
  if (!meta) {
    throw new Error(
      '未知 kind: ' + kind + '；允许: ' + Object.keys(KINDS).join(', ')
    );
  }
  const tree = meta.build(data);
  if (typeof meta.write === 'function') {
    return meta.write(tree, outputPath);
  }
  return writeXmindFile(tree, outputPath);
}

// ─── 通用小工具（需求点 / 测试点树构建）──────────────────

function node(title, children, labels) {
  const n = { title: String(title == null ? '' : title) };
  if (labels && labels.length) n.labels = labels;
  if (children && children.length) n.children = children;
  return n;
}

function textOrDash(v) {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.join('、') : '—';
  return String(v);
}

function formatScopeLine(label, dim) {
  const d = dim || {};
  const inn = Array.isArray(d.in_scope) ? d.in_scope : [];
  const out = Array.isArray(d.out_of_scope) ? d.out_of_scope : [];
  return (
    label +
    '：涉及【' +
    (inn.length ? inn.join('、') : '无') +
    '】 / 不涉及【' +
    (out.length ? out.join('、') : '无') +
    '】'
  );
}

function pushUnique(labels, arr) {
  if (!Array.isArray(arr)) return;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] && labels.indexOf(arr[i]) === -1) labels.push(arr[i]);
  }
}

/** 展示用：端顺序 */
const PLATFORM_DISPLAY_ORDER = ['PC端', 'APP端', '小程序端', 'H5端'];
/** 展示用：产品简称顺序 */
const PRODUCT_DISPLAY_ORDER = ['国内版', '国际版'];
/** 展示用：版本简称顺序 */
const VERSION_DISPLAY_ORDER = ['开单', '单店', '多店'];
/** 展示用：角色简称顺序 */
const ROLE_DISPLAY_ORDER = ['老板', '员工'];

function normalizePlatformTag(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^PC/i.test(s) || s.indexOf('Web') !== -1 || s === '电脑端') return 'PC端';
  if (/^APP/i.test(s) || s.indexOf('移动') !== -1) return 'APP端';
  if (s.indexOf('小程序') !== -1) return '小程序端';
  if (/H5/i.test(s)) return 'H5端';
  if (PLATFORM_DISPLAY_ORDER.indexOf(s) !== -1) return s;
  return s;
}

function normalizeProductDisplay(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (
    s === '智慧记AI进销存' ||
    s.indexOf('国内') !== -1 ||
    s.indexOf('普通') !== -1 ||
    s === 'Domestic'
  ) {
    return '国内版';
  }
  if (
    s === 'ailit' ||
    /^Ailit$/i.test(s) ||
    s.indexOf('国际') !== -1 ||
    s.indexOf('海外') !== -1
  ) {
    return '国际版';
  }
  return null;
}

function normalizeVersionDisplay(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (s.indexOf('开单') !== -1) return '开单';
  if (s.indexOf('单店') !== -1 || s.indexOf('单门店') !== -1) return '单店';
  if (s.indexOf('多店') !== -1 || s.indexOf('连锁') !== -1) return '多店';
  return null;
}

function normalizeRoleDisplay(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (s.indexOf('老板') !== -1 || s.indexOf('商户') !== -1 || s.indexOf('管理员') !== -1) {
    return '老板';
  }
  if (s.indexOf('员工') !== -1 || s.indexOf('店员') !== -1 || s.indexOf('收银员') !== -1) {
    return '员工';
  }
  return null;
}

function orderedUnique(values, order) {
  const set = {};
  for (let i = 0; i < values.length; i++) {
    if (values[i]) set[values[i]] = true;
  }
  const out = [];
  for (let j = 0; j < order.length; j++) {
    if (set[order[j]]) out.push(order[j]);
  }
  return out;
}

function collectRoleRaws(item) {
  const raws = [];
  if (Array.isArray(item.role_tags)) pushUnique(raws, item.role_tags);
  if (item.tags && typeof item.tags === 'object' && !Array.isArray(item.tags)) {
    pushUnique(raws, item.tags.role_tags);
  }
  if (Array.isArray(item.tags)) {
    for (let i = 0; i < item.tags.length; i++) {
      const n = normalizeRoleDisplay(item.tags[i]);
      if (n) raws.push(item.tags[i]);
    }
  }
  return raws;
}

/**
 * 版本「全选」判定：
 * - 仅国际版产品 → 单店+多店 即为全选
 * - 含国内版（或未识别产品）→ 开单+单店+多店 为全选
 */
function isVersionFullSelection(versionDisplays, productDisplays) {
  if (!versionDisplays.length) return true;
  const onlyIntl =
    productDisplays.length > 0 &&
    productDisplays.indexOf('国内版') === -1 &&
    productDisplays.indexOf('国际版') !== -1;
  const full = onlyIntl ? ['单店', '多店'] : ['开单', '单店', '多店'];
  if (versionDisplays.length !== full.length) return false;
  for (let i = 0; i < full.length; i++) {
    if (versionDisplays.indexOf(full[i]) === -1) return false;
  }
  return true;
}

function isRoleFullSelection(roleDisplays) {
  return (
    roleDisplays.indexOf('老板') !== -1 && roleDisplays.indexOf('员工') !== -1
  );
}

/**
 * 最终展示标签（精简）：
 * - JSON 仍存数组；此处按维合并为「端」「产品」「版本」「角色」最多 4 枚
 * - 端 / 产品：有则合并展示（国内版/国际版、PC端/APP端…）
 * - 版本：仅非全选时展示（开单/单店/多店）；全选或空不展示
 * - 角色：仅非全选时展示（老板 或 员工）；老板+员工全选不展示
 */
function formatDisplayLabels(item) {
  if (!item || typeof item !== 'object') return [];

  let productRaws = item.product_tags || [];
  let versionRaws = item.version_tags || [];
  let platformRaws = item.platform_tags || [];
  if (item.tags && typeof item.tags === 'object' && !Array.isArray(item.tags)) {
    if (!productRaws.length) productRaws = item.tags.product_tags || [];
    if (!versionRaws.length) versionRaws = item.tags.version_tags || [];
    if (!platformRaws.length) platformRaws = item.tags.platform_tags || [];
    if (!productRaws.length && item.tags.system_tags) {
      productRaws = item.tags.system_tags;
    }
  }

  const platforms = orderedUnique(
    (platformRaws || []).map(normalizePlatformTag).filter(Boolean),
    PLATFORM_DISPLAY_ORDER
  );
  const products = orderedUnique(
    (productRaws || []).map(normalizeProductDisplay).filter(Boolean),
    PRODUCT_DISPLAY_ORDER
  );
  const versions = orderedUnique(
    (versionRaws || []).map(normalizeVersionDisplay).filter(Boolean),
    VERSION_DISPLAY_ORDER
  );
  const roles = orderedUnique(
    collectRoleRaws(item).map(normalizeRoleDisplay).filter(Boolean),
    ROLE_DISPLAY_ORDER
  );

  const labels = [];
  if (products.length) labels.push(products.join('/'));
  if (platforms.length) labels.push(platforms.join('/'));
  if (versions.length && !isVersionFullSelection(versions, products)) {
    labels.push(versions.join('/'));
  }
  if (roles.length && !isRoleFullSelection(roles)) {
    labels.push(roles.join('/'));
  }
  return labels;
}

/** 测试点：三维 tags → 展示用 labels（按维合并） */
function combineTags(tp) {
  return formatDisplayLabels(tp);
}

/** 解析 RP-001 / TP-003 / TC-012 中的序号；无法解析则靠后 */
function idNumericOrder(id) {
  const m = String(id == null ? '' : id).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 999999;
}

/**
 * 取条目关联的最小需求点序号（便于按需求点顺序排列，而非 P0–P3）
 * - 测试点：source_rp_ids
 * - 测试用例：source 中的 RP-xxx
 */
function primaryRpOrder(item) {
  let ids = [];
  if (item && Array.isArray(item.source_rp_ids)) {
    ids = item.source_rp_ids;
  } else if (item && Array.isArray(item.source)) {
    ids = item.source.filter(function (s) {
      return /^RP-\d+/i.test(String(s || ''));
    });
  }
  if (!ids.length) return 999999;
  let min = 999999;
  for (let i = 0; i < ids.length; i++) {
    const n = idNumericOrder(ids[i]);
    if (n < min) min = n;
  }
  return min;
}

function primaryRpId(item) {
  let ids = [];
  if (item && Array.isArray(item.source_rp_ids)) {
    ids = item.source_rp_ids.slice();
  } else if (item && Array.isArray(item.source)) {
    ids = item.source.filter(function (s) {
      return /^RP-\d+/i.test(String(s || ''));
    });
  }
  if (!ids.length) return '未关联需求点';
  ids.sort(function (a, b) {
    return idNumericOrder(a) - idNumericOrder(b);
  });
  return String(ids[0]);
}

/** 测试点/用例：先按关联需求点顺序，再按自身 ID；不按优先级 */
function sortByRequirementPointOrder(a, b) {
  const ra = primaryRpOrder(a);
  const rb = primaryRpOrder(b);
  if (ra !== rb) return ra - rb;
  return idNumericOrder(a && a.id) - idNumericOrder(b && b.id);
}

// ═══════════════════════════════════════════════════════════
// Template: 需求点（demand6.0 §4.5）
// ═══════════════════════════════════════════════════════════

function buildRequirementPointsTree(rp) {
  if (!rp || !rp.requirement_title) {
    throw new Error('requirement_points 缺少 requirement_title');
  }

  const title = rp.requirement_title;
  const ctx = rp.test_context || {};
  const confirmed = Array.isArray(rp.confirmed_points) ? rp.confirmed_points : [];
  const pending = Array.isArray(rp.pending_points) ? rp.pending_points : [];

  function pointNode(p) {
    const pri = p.priority_hint || p.priority || 'P?';
    const id = p.id || '';
    const head = '[' + pri + '] ' + (id ? id + ' ' : '') + (p.title || '');
    const kids = [];
    if (p.detail) kids.push(node(p.detail));
    return node(head, kids);
  }

  return {
    root: node(title + ' · 需求点', [
      node('一、需求本质', [node(textOrDash(rp.requirement_essence))]),
      node('二、测试上下文', [
        node(formatScopeLine('产品', ctx.products)),
        node(formatScopeLine('版本', ctx.versions)),
        node(formatScopeLine('端', ctx.platforms))
      ]),
      node(
        '三、已确认需求点',
        confirmed.length ? confirmed.map(pointNode) : [node('（无）')]
      ),
      node(
        '四、待确认需求点',
        pending.length ? pending.map(pointNode) : [node('（无）')]
      )
    ])
  };
}

// ═══════════════════════════════════════════════════════════
// Template: 测试点（demand6.0 §6.6）
// ═══════════════════════════════════════════════════════════

function buildTestPointsTree(tp) {
  if (!tp || !tp.requirement_title) {
    throw new Error('test_points 缺少 requirement_title');
  }

  const title = tp.requirement_title;
  const points = Array.isArray(tp.test_points) ? tp.test_points : [];
  const confirmed = [];
  const pending = [];
  const unmatched = [];

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.module_match === 'unmatched') unmatched.push(p);
    else if (p.status === 'pending' || p.pending === true) pending.push(p);
    else confirmed.push(p);
  }

  function tpLeaf(p) {
    const pri = p.priority || 'P?';
    const id = p.id || '';
    const head = '[' + pri + '] ' + (id ? id + ' ' : '') + (p.title || '');
    const labels = combineTags(p);
    const kids = [];
    const steps = Array.isArray(p.steps_outline) ? p.steps_outline : [];
    const expects = Array.isArray(p.expected_outline) ? p.expected_outline : [];
    if (p.module_l1 || p.module_l2) {
      kids.push(
        node(
          '模块：' +
            (p.module_l1 || '未分类') +
            (p.module_l2 ? ' / ' + p.module_l2 : '')
        )
      );
    }
    if (steps.length) {
      kids.push(
        node(
          '步骤要点',
          steps.map(function (s, idx) {
            return node(String(idx + 1) + '. ' + s);
          })
        )
      );
    }
    if (expects.length) {
      kids.push(
        node(
          '期望要点',
          expects.map(function (s, idx) {
            return node(String(idx + 1) + '. ' + s);
          })
        )
      );
    }
    return node(head, kids, labels);
  }

  /** 按关联需求点（source_rp_ids）分组并排序，便于对照需求点人工检查 */
  function groupByRequirementPoint(list) {
    const map = {};
    const order = [];
    for (let i = 0; i < list.length; i++) {
      const rp = primaryRpId(list[i]);
      if (!map[rp]) {
        map[rp] = [];
        order.push(rp);
      }
      map[rp].push(list[i]);
    }
    order.sort(function (a, b) {
      if (a === '未关联需求点') return 1;
      if (b === '未关联需求点') return -1;
      return idNumericOrder(a) - idNumericOrder(b);
    });
    return order.map(function (rp) {
      const sorted = map[rp].slice().sort(function (a, b) {
        return idNumericOrder(a.id) - idNumericOrder(b.id);
      });
      return node('需求点：' + rp, sorted.map(tpLeaf));
    });
  }

  const merge = tp.merge_report || {};
  // 等价合并细节仅保留在 script/stage3/merge_report.json（及 C-TP 内嵌字段），
  // 对外测试点 XMind 不展示「等价合并报告」，避免干扰人审。
  void merge;

  const pendingSorted = pending.slice().sort(sortByRequirementPointOrder);
  const unmatchedSorted = unmatched.slice().sort(sortByRequirementPointOrder);

  return {
    root: node(title + ' · 测试点', [
      node('一、测试本质', [node(textOrDash(tp.test_essence))]),
      node(
        '二、已确认测试点（按需求点顺序）',
        confirmed.length ? groupByRequirementPoint(confirmed) : [node('（无）')]
      ),
      node(
        '三、待确认测试点',
        pendingSorted.length ? pendingSorted.map(tpLeaf) : [node('（无）')]
      ),
      node(
        '四、未匹配模块的测试点',
        unmatchedSorted.length
          ? unmatchedSorted.map(tpLeaf)
          : [node('（无；unmatched_count=' + (tp.unmatched_count || 0) + '）')]
      )
    ])
  };
}

// ═══════════════════════════════════════════════════════════
// Template: 测试用例（Stage4 专用规则 —— 仅对本模板生效）
// 自 stage4/export_xmind.js + stage4_execute 迁入，替换旧「简单用例树」
//
// 层级：中心 → 一级模块 → 二级模块 → [P?]标题(+labels) → 前提/步骤 → 期望
// 组内排序：按关联需求点（source 中 RP）顺序，不按 P0–P3
// ═══════════════════════════════════════════════════════════

/** 一级模块排序（继承 stage4_execute；短名与「xx模块」均可） */
const MODULE_L1_ORDER = [
  '销售模块',
  '销售',
  '资金模块',
  '资金',
  '客户模块',
  '客户',
  '商品模块',
  '商品',
  '库存模块',
  '库存',
  '设置模块',
  '设置',
  '非功能模块',
  '非功能'
];

function sortModuleL1(a, b) {
  const ia = MODULE_L1_ORDER.indexOf(a);
  const ib = MODULE_L1_ORDER.indexOf(b);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
}

/**
 * 用例标签收集（仅测试用例模板）
 * 与测试点一致：按维合并展示；版本/角色全选时隐藏。
 */
function collectCaseLabels(tc) {
  return formatDisplayLabels(tc);
}

/**
 * 将【测试用例】自定义节点结构转换为 XMind 标准 topic
 * （从 stage4/export_xmind.js 完整迁移；只服务用例模板）
 *
 * 【重要】必须传递 labels（药丸形标签），不能丢失。
 * 禁止把标签写成 children 子节点（如「标签: xxx | xxx」）。
 *
 * 自定义节点约定：
 *   {
 *     title: string,
 *     labels?: string[],   // 用例标题上的药丸标签
 *     type?: string,       // precondition | step | expected_result
 *     children?: Node[]
 *   }
 *
 * 输出标准 topic：
 *   { id, title, labels?, children?: { attached: Topic[] } }
 */
function convertToXmindTopic(node) {
  const topic = {
    id: genId(),
    title: (node && node.title) || ''
  };

  // 传递 labels（XMind 标签，显示在标题上）——不可丢弃
  if (node && Array.isArray(node.labels) && node.labels.length > 0) {
    topic.labels = node.labels.slice();
  }

  if (node && Array.isArray(node.children) && node.children.length > 0) {
    topic.children = {
      attached: node.children.map(function (child) {
        return convertToXmindTopic(child);
      })
    };
  }

  return topic;
}

/**
 * 创建单个测试用例自定义节点（从 stage4_execute.createXmindCaseNode 迁移）
 *
 *   [P?] 标题  + labels(药丸)
 *   ├── 前提条件: …          (type: precondition，与步骤同级)
 *   ├── 步骤N: …             (type: step)
 *   │   └── 期望结果: …      (type: expected_result)
 *   └── …
 *
 * 兼容：6.0 order/action/expected；旧 step_id/step_description/expected_result
 */
function createXmindCaseNode(tc) {
  const caseNode = {
    title: '[' + (tc.priority || 'P?') + '] ' + (tc.title || ''),
    children: []
  };

  const labels = collectCaseLabels(tc);
  if (labels.length > 0) {
    caseNode.labels = labels;
  }

  caseNode.children.push({
    title: '前提条件: ' + textOrDash(tc.precondition),
    type: 'precondition'
  });

  const steps = Array.isArray(tc.steps) ? tc.steps.slice() : [];
  steps.sort(function (a, b) {
    const oa = a.order != null ? a.order : a.step_id != null ? Number(a.step_id) : 0;
    const ob = b.order != null ? b.order : b.step_id != null ? Number(b.step_id) : 0;
    return oa - ob;
  });

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const order =
      s.order != null ? s.order : s.step_id != null ? s.step_id : i + 1;
    const action = s.action || s.step_description || '';
    const expected = s.expected || s.expected_result || '';

    caseNode.children.push({
      title: '步骤' + order + ': ' + action,
      type: 'step',
      children: [
        {
          title: '期望结果: ' + expected,
          type: 'expected_result'
        }
      ]
    });
  }

  // Demand 6.3：技术引用（仅展示 TP→TC 已固化内容，不读 KB）
  const refs = Array.isArray(tc.technical_refs) ? tc.technical_refs : [];
  if (refs.length) {
    const techNode = { title: '技术引用', type: 'technical_refs', children: [] };
    const urls = refs.filter(r => r.type === 'page_url');
    const apis = refs.filter(r => r.type === 'backend_api');
    if (urls.length) {
      techNode.children.push({
        title: '页面地址',
        children: urls.map(u => ({
          title: `[${u.platform}] ${u.page_id}: ${u.target}`
        }))
      });
    }
    if (apis.length) {
      techNode.children.push({
        title: '后端接口',
        children: apis.map(a => ({
          title: (
            `[${a.platform}] ${a.element_name || ''} ${a.method || ''} ${a.target}` +
            (Array.isArray(a.assertions) && a.assertions.length
              ? `（${a.assertions.length} 条断言）`
              : '')
          ).trim()
        }))
      });
    }
    caseNode.children.push(techNode);
  }

  return caseNode;
}

/**
 * 从 test_cases.json 构建用例自定义树
 * @param {object} tc C-TC
 * @returns {{ root: object, metadata?: object }}
 */
function buildTestCasesTree(tc) {
  if (!tc || !tc.requirement_title) {
    throw new Error('test_cases 缺少 requirement_title');
  }

  const title = tc.requirement_title;
  const cases = Array.isArray(tc.test_cases) ? tc.test_cases : [];

  const moduleL1Groups = {};
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const l1 = c.module_l1 || '未分类';
    if (!moduleL1Groups[l1]) moduleL1Groups[l1] = [];
    moduleL1Groups[l1].push(c);
  }

  const sortedL1 = Object.keys(moduleL1Groups).sort(sortModuleL1);
  const rootChildren = [];

  for (let i = 0; i < sortedL1.length; i++) {
    const l1 = sortedL1[i];
    const l1Cases = moduleL1Groups[l1];
    const l1Node = { title: l1, children: [] };

    const l2Groups = {};
    for (let j = 0; j < l1Cases.length; j++) {
      const c = l1Cases[j];
      const l2 = c.module_l2 || '其他';
      if (!l2Groups[l2]) l2Groups[l2] = [];
      l2Groups[l2].push(c);
    }

    const l2Keys = Object.keys(l2Groups).sort();
    for (let k = 0; k < l2Keys.length; k++) {
      const l2 = l2Keys[k];
      // 按关联需求点顺序排列（非 P0–P3），便于对照需求点检查
      const subCases = l2Groups[l2].slice().sort(sortByRequirementPointOrder);
      l1Node.children.push({
        title: l2,
        children: subCases.map(createXmindCaseNode)
      });
    }

    rootChildren.push(l1Node);
  }

  if (!rootChildren.length) {
    rootChildren.push({ title: '（无用例）', children: [] });
  }

  return {
    root: {
      title: title + ' · 测试用例',
      children: rootChildren
    },
    metadata: {
      creator: CREATOR.name,
      version: CREATOR.version,
      total_cases: cases.length
    }
  };
}

/**
 * 用例专用写盘：用 convertToXmindTopic（保留 labels / 用例节点语义）
 * @param {object} treeOrRoot buildTestCasesTree 结果，或已有 xmind.json
 * @param {string} outputPath
 */
function writeTestCasesXmind(treeOrRoot, outputPath) {
  return writeXmindFile(treeOrRoot, outputPath, convertToXmindTopic);
}

// ═══════════════════════════════════════════════════════════
// self-test
// ═══════════════════════════════════════════════════════════

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function peekZipRootTopic(xmindPath) {
  const zip = new AdmZip(xmindPath);
  const entry = zip.getEntry('content.json');
  assert(entry, '缺少 content.json: ' + xmindPath);
  const content = JSON.parse(entry.getData().toString('utf8'));
  assert(
    Array.isArray(content) && content[0] && content[0].rootTopic,
    'content 结构异常'
  );
  return content[0].rootTopic;
}

function assertLeftToRightLayout(rootTopic) {
  assert(
    rootTopic && rootTopic.structureClass === STRUCTURE_LEFT_TO_RIGHT,
    'rootTopic 须为从左往右布局: ' +
      (rootTopic && rootTopic.structureClass ? rootTopic.structureClass : '(未设置)')
  );
}

function findFirstLabeledTopic(topic) {
  if (!topic) return null;
  if (Array.isArray(topic.labels) && topic.labels.length > 0) return topic;
  const kids =
    topic.children && Array.isArray(topic.children.attached)
      ? topic.children.attached
      : [];
  for (let i = 0; i < kids.length; i++) {
    const found = findFirstLabeledTopic(kids[i]);
    if (found) return found;
  }
  return null;
}

function assertTestCaseCustomTree(tree) {
  const root = tree.root;
  assert(root && root.children && root.children.length, '用例树无一级模块');
  const l1 = root.children[0];
  assert(l1.children && l1.children.length, '用例树无二级模块');
  const l2 = l1.children[0];
  assert(l2.children && l2.children.length, '用例树无用例节点');
  const caseNode = l2.children[0];
  assert(
    Array.isArray(caseNode.labels) && caseNode.labels.length > 0,
    '用例标题缺少 labels（药丸标签）'
  );
  assert(
    caseNode.children &&
      caseNode.children[0] &&
      caseNode.children[0].type === 'precondition',
    '首子节点应为前提条件'
  );
  const step = caseNode.children.find(function (c) {
    return c.type === 'step';
  });
  assert(step, '缺少步骤节点');
  assert(
    step.children &&
      step.children[0] &&
      step.children[0].type === 'expected_result',
    '期望结果必须挂在步骤下'
  );

  resetIdCounter();
  const std = convertToXmindTopic(caseNode);
  assert(
    Array.isArray(std.labels) && std.labels.length === caseNode.labels.length,
    'convertToXmindTopic 丢失 labels'
  );

  const apiCase = createXmindCaseNode({
    priority: 'P0',
    title: '接口检查导出',
    precondition: '无',
    steps: [
      {
        order: 1,
        action: '导航路径：工作台 > 商品选择页',
        expected: '进入商品选择页'
      },
      {
        order: 2,
        action: '检查接口 GET /v1/products',
        expected: '$.data 存在'
      }
    ],
    technical_refs: [
      {
        type: 'backend_api',
        platform: 'app',
        element_name: '搜索框',
        method: 'GET',
        target: '/v1/products',
        assertions: [{ location: 'body', json_path: '$.data', operator: 'exists' }]
      }
    ]
  });
  const apiTreeText = JSON.stringify(apiCase);
  assert(
    apiTreeText.indexOf('导航路径：工作台 > 商品选择页') !== -1 &&
      apiTreeText.indexOf('步骤2: 检查接口 GET /v1/products') !== -1,
    'XMind 须将导航与 API 检查均作为普通步骤导出'
  );
  assert(
    apiTreeText.indexOf('（1 条断言）') !== -1 &&
      apiTreeText.indexOf('$.data 存在') === apiTreeText.lastIndexOf('$.data 存在'),
    '技术引用应摘要断言数量，不重复完整断言'
  );
}

function runSelfTest() {
  // 展示合并：全选版本/角色隐藏；产品简称；按维 `/` 合并
  const fullDomestic = formatDisplayLabels({
    platform_tags: ['PC端', 'APP端'],
    product_tags: ['智慧记AI进销存', 'ailit'],
    version_tags: ['开单版', '单店版', '多店版'],
    role_tags: ['老板角色', '员工角色']
  });
  assert(
    fullDomestic.join('|') === '国内版/国际版|PC端/APP端',
    '全选版本+角色应隐藏，产品优先于端'
  );
  const subset = formatDisplayLabels({
    platform_tags: ['PC端'],
    product_tags: ['智慧记AI进销存'],
    version_tags: ['多店版'],
    role_tags: ['员工角色']
  });
  assert(
    subset.join('|') === '国内版|PC端|多店|员工',
    '非全选版本/角色应展示简称'
  );
  const ailitFull = formatDisplayLabels({
    platform_tags: ['PC端', 'APP端'],
    product_tags: ['ailit'],
    version_tags: ['单店版', '多店版']
  });
  assert(
    ailitFull.join('|') === '国际版|PC端/APP端',
    'ailit 下单店+多店为全选，版本不展示'
  );

  const fixturesRoot = path.resolve(
    __dirname,
    '..',
    '..',
    'fixtures',
    '客户来源调研弹窗'
  );
  const rpPath = path.join(
    fixturesRoot,
    'script',
    'stage1',
    'requirement_points.json'
  );
  const tpPath = path.join(fixturesRoot, 'script', 'stage3', 'test_points.json');
  const tcPath = path.join(fixturesRoot, 'script', 'stage4', 'test_cases.json');

  assert(fs.existsSync(rpPath), '缺少 fixture C-RP: ' + rpPath);
  assert(fs.existsSync(tpPath), '缺少 fixture C-TP: ' + tpPath);
  assert(fs.existsSync(tcPath), '缺少 fixture C-TC: ' + tcPath);

  const rp = JSON.parse(fs.readFileSync(rpPath, 'utf8'));
  const tp = JSON.parse(fs.readFileSync(tpPath, 'utf8'));
  const tc = JSON.parse(fs.readFileSync(tcPath, 'utf8'));

  const tcTree = buildTestCasesTree(tc);
  assertTestCaseCustomTree(tcTree);

  const outDir = path.join(os.tmpdir(), 'tg-xmind-self-test-' + Date.now());
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];

  const rpOut = path.join(outDir, '需求点_客户来源调研弹窗.xmind');
  exportXmind('requirement_points', rp, rpOut);
  const rpTopic = peekZipRootTopic(rpOut);
  assertLeftToRightLayout(rpTopic);
  assert(rpTopic.title.indexOf('需求点') !== -1, '需求点中心主题异常');
  results.push({ kind: 'requirement_points', path: rpOut, title: rpTopic.title });

  const tpOut = path.join(outDir, '测试点_客户来源调研弹窗.xmind');
  exportXmind('test_points', tp, tpOut);
  const tpTopic = peekZipRootTopic(tpOut);
  assertLeftToRightLayout(tpTopic);
  assert(tpTopic.title.indexOf('测试点') !== -1, '测试点中心主题异常');
  assert(
    JSON.stringify(tpTopic).indexOf('等价合并报告') === -1,
    '测试点 XMind 不应再含等价合并报告分区'
  );
  assert(
    JSON.stringify(tpTopic).indexOf('按需求点顺序') !== -1,
    '测试点 XMind 应按需求点顺序分区'
  );
  assert(
    JSON.stringify(tpTopic).indexOf('按一级模块') === -1,
    '测试点 XMind 不应再按一级模块分区排序'
  );
  results.push({ kind: 'test_points', path: tpOut, title: tpTopic.title });

  const tcOut = path.join(outDir, '测试用例_客户来源调研弹窗.xmind');
  exportXmind('test_cases', tc, tcOut);
  const tcTopic = peekZipRootTopic(tcOut);
  assertLeftToRightLayout(tcTopic);
  assert(tcTopic.title.indexOf('测试用例') !== -1, '用例中心主题异常');
  const labeled = findFirstLabeledTopic(tcTopic);
  assert(labeled, '用例 .xmind 未找到带 labels 的 topic');
  results.push({
    kind: 'test_cases',
    path: tcOut,
    title: tcTopic.title,
    sample_labels: labeled.labels,
    sample_case_title: labeled.title
  });

  console.log(JSON.stringify({ ok: true, outDir: outDir, results: results }, null, 2));
  return 0;
}

module.exports = {
  KINDS,
  STRUCTURE_LEFT_TO_RIGHT,
  // 通用
  toXmindTopic,
  writeXmindFile,
  exportXmind,
  buildRequirementPointsTree,
  buildTestPointsTree,
  formatDisplayLabels,
  combineTags,
  // 测试用例专用（Stage4）
  MODULE_L1_ORDER,
  collectCaseLabels,
  convertToXmindTopic,
  createXmindCaseNode,
  buildTestCasesTree,
  writeTestCasesXmind,
  runSelfTest
};

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.indexOf('--self-test') !== -1) {
    try {
      process.exit(runSelfTest());
    } catch (e) {
      console.error(
        JSON.stringify({
          ok: false,
          error: String(e && e.message ? e.message : e)
        })
      );
      process.exit(1);
    }
  } else {
    console.error('用法: node lib/xmind_export.js --self-test');
    process.exit(1);
  }
}
