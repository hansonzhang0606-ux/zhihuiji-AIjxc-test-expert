/**
 * 最终 XMind → KbCandidateBundle（Demand 6.3）
 * 优先解析「技术引用」结构化节点；自由文本 URL/API 标低可信
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { fingerprintPath } = require('./source_fingerprint');
const { matchPrimary } = require('../../../../src/scripts/shared/module_matcher');
const { parseNavigationStep, isNavigationStep } = require('../../../../src/scripts/shared/navigation_path');
const { normalizePageUrl, normalizeBackendApi } = require('../lib/tech_normalize');

function loadAdmZip() {
  const scriptsNode = path.resolve(__dirname, '../../../../src/scripts/node_modules/adm-zip');
  return require(scriptsNode);
}

function topicTitle(topic) {
  return String((topic && (topic.title || topic.label)) || '').trim();
}

function attached(topic) {
  if (!topic || !topic.children) return [];
  if (Array.isArray(topic.children.attached)) return topic.children.attached;
  if (Array.isArray(topic.children)) return topic.children;
  return [];
}

function walk(topic, visit, trail = []) {
  if (!topic) return;
  const title = topicTitle(topic);
  const nextTrail = title ? trail.concat(title) : trail;
  visit(topic, nextTrail);
  for (const child of attached(topic)) walk(child, visit, nextTrail);
}

function isNoiseTitle(title) {
  return /账号|密码|验证码|准备数据|造数|单次样例|用后即弃|步骤\d+|期望结果:|前提条件:/.test(title);
}

function parsePlatform(text) {
  if (/APP|移动端/i.test(text)) return 'app';
  if (/PC|Web|电脑/i.test(text)) return 'web';
  return null;
}

function parseStructuredTechRefs(rootTopic) {
  const items = [];
  let seq = 1;
  walk(rootTopic, (topic, trail) => {
    const title = topicTitle(topic);
    if (title !== '技术引用' && topic.type !== 'technical_refs') return;
    const caseTitle = trail.slice().reverse().find(t => /^\[P[0-3]\]/.test(t)) || trail[trail.length - 2] || '';
    const moduleGuess = trail.find(t => /模块|销售|进货|库存|资金|客户/.test(t)) || '';
    // 先扫页面地址，供同节点 API 绑定 page_id
    let boundPageId = '';
    for (const section of attached(topic)) {
      if (topicTitle(section) !== '页面地址' && !/页面地址|page_url/i.test(topicTitle(section))) continue;
      for (const leaf of attached(section)) {
        const leafTitle = topicTitle(leaf);
        const m = leafTitle.match(/\[(web|app)\]\s*(.+?):\s*(.+)$/i);
        if (m && m[2].trim().endsWith('页')) {
          boundPageId = m[2].trim();
          break;
        }
      }
    }
    if (!boundPageId) {
      const fromTrail = trail.find(t => /[\u4e00-\u9fa5A-Za-z0-9]+页/.test(t));
      if (fromTrail) {
        const m = fromTrail.match(/([\u4e00-\u9fa5A-Za-z0-9]+页)/);
        if (m) boundPageId = m[1];
      }
    }
    for (const section of attached(topic)) {
      const secTitle = topicTitle(section);
      for (const leaf of attached(section)) {
        const leafTitle = topicTitle(leaf);
        if (!leafTitle || isNoiseTitle(leafTitle)) continue;
        if (secTitle === '页面地址' || /页面地址|page_url/i.test(secTitle)) {
          const m = leafTitle.match(/\[(web|app)\]\s*(.+?):\s*(.+)$/i);
          const pageId = m ? m[2].trim() : '';
          const urlRaw = m ? m[3].trim() : leafTitle.replace(/^\[.*?\]\s*/, '').trim();
          const n = normalizePageUrl(urlRaw);
          if (!n.ok || !pageId.endsWith('页')) continue;
          items.push({
            candidate_id: `C-${String(seq++).padStart(3, '0')}`,
            module_l1: '',
            module_l2: '',
            kind: 'page_url',
            page_id: pageId,
            platform: 'web',
            page_url: n.value,
            confidence: 0.95,
            module_reason: `xmind_structured:${caseTitle || moduleGuess}`
          });
        }
        if (secTitle === '后端接口' || /后端接口|backend_api/i.test(secTitle)) {
          const m = leafTitle.match(
            /\[(web|app)\]\s*(.+?)\s+(GET|POST|PUT|PATCH|DELETE|WS)\s+(\S+)/i
          );
          if (!m) continue;
          const n = normalizeBackendApi({ method: m[3], path: m[4] });
          if (!n.ok) continue;
          const pageId = boundPageId;
          if (!pageId) continue; // 无页面归属不写 API
          items.push({
            candidate_id: `C-${String(seq++).padStart(3, '0')}`,
            module_l1: '',
            module_l2: '',
            kind: 'backend_api',
            page_id: pageId,
            platform: m[1].toLowerCase(),
            element_name: m[2].trim(),
            backend_api: n.value,
            assertions: Array.isArray(leaf.assertions) ? leaf.assertions : [],
            assertion_count: Number((leafTitle.match(/（(\d+)\s*条断言）/) || [])[1] || 0),
            confidence: 0.95,
            module_reason: `xmind_structured:${caseTitle || moduleGuess}`
          });
        }
      }
    }
  });
  return items;
}

function stripStepPrefix(title) {
  return String(title || '').replace(/^步骤\s*\d+\s*[:：]\s*/, '').trim();
}

function inferElementName(action) {
  return String(action || '')
    .replace(/^(点击|选择|输入|填写|勾选|取消勾选|打开|关闭|提交|保存|搜索|切换)\s*/, '')
    .replace(/[，。；;].*$/, '')
    .trim();
}

function parseFunctionalCandidates(caseTopic, caseTitle) {
  const items = [];
  let seq = 1000;
  let currentPage = '';
  const platform = parsePlatform([caseTitle, ...(caseTopic.labels || [])].join(' ')) || 'web';
  for (const topic of attached(caseTopic)) {
    const title = topicTitle(topic);
    if (!title || /技术引用|前提条件:/.test(title)) continue;
    const action = stripStepPrefix(title);
    if (isNavigationStep(action)) {
      const parsed = parseNavigationStep(action);
      if (!parsed.valid) continue;
      currentPage = parsed.target_page;
      const pages = [...new Set(parsed.tokens.filter(t => /页$/.test(t)))];
      for (const pageId of pages) {
        items.push({
          candidate_id: `C-${String(seq++).padStart(3, '0')}`,
          module_l1: '',
          module_l2: '',
          kind: 'page',
          page_id: pageId,
          page_role: pageId === pages[0] ? '主页面' : '子页面',
          platform,
          statement: `由 P0 导航路径确认：${parsed.normalized_path}`,
          confidence: 0.9,
          case_id: caseTitle.match(/\bTC-\d{3,}\b/)?.[0],
          module_reason: `xmind_navigation:${caseTitle}`
        });
      }
      for (const relation of parsed.relations) {
        items.push({
          candidate_id: `C-${String(seq++).padStart(3, '0')}`,
          module_l1: '',
          module_l2: '',
          kind: 'page_relation',
          page_id: relation.to_page,
          platform,
          relation: { from: relation.from_page, action: relation.action, to: relation.to_page },
          confidence: 0.95,
          case_id: caseTitle.match(/\bTC-\d{3,}\b/)?.[0],
          module_reason: `xmind_navigation:${caseTitle}`
        });
      }
      continue;
    }
    if (!currentPage || !/^步骤\s*\d+\s*[:：]/.test(title)) continue;
    if (/^检查接口\s+/i.test(action)) continue;
    const expectedNode = attached(topic).find(child => /期望结果[:：]/.test(topicTitle(child)));
    const expected = expectedNode ? topicTitle(expectedNode).replace(/^期望结果[:：]\s*/, '') : '';
    const elementName = inferElementName(action);
    if (!elementName) continue;
    items.push({
      candidate_id: `C-${String(seq++).padStart(3, '0')}`,
      module_l1: '',
      module_l2: '',
      kind: 'page_element',
      page_id: currentPage,
      platform,
      element_name: elementName,
      element: { name: elementName, interaction: action, result: expected },
      confidence: 0.8,
      case_id: caseTitle.match(/\bTC-\d{3,}\b/)?.[0],
      module_reason: `xmind_step:${caseTitle}`
    });
  }
  return items;
}

/**
 * 从测试用例树提取「业务规则知识」（页面 / 核心元素 / 补充说明）。
 * 仅 P0/P1；排除非功能。产出 kind: page | page_element | supplement；与 P0 导航/技术引用通道互补。
 */
const ELEMENT_HINTS = [
  '搜索框', '分类标签', '商品分类', '搜索结果', '当前分类', '全部类别',
  '分类筛选', '云店商品标签', '搜索按钮', '查询按钮',
  '批量生成进货单', '批量生成进货预订', '生成进货单', '生成进货预订'
];

// 页面视觉顺序（自上而下、自左而右），用于：
//   1) detectElements 产出 page_element 变更的顺序（元素行表）
//   2) 补充说明子标题（### 元素名）的呈现顺序
// 兼顾两模块：销售元素(搜索框/分类标签/商品分类/搜索结果/当前分类/全部类别)
//         + 云店元素(搜索框/搜索结果/分类筛选/当前分类/全部类别/云店商品标签)
const ELEMENT_DISPLAY_ORDER = [
  '搜索框', '分类标签', '商品分类', '搜索结果',
  '分类筛选', '当前分类', '全部类别', '云店商品标签'
];

function isValidPageName(p) {
  if (/^(页面|列表|菜单|导航|按钮|显示|当前|全部|这个|该|此|翻页|页签|分页|首页|末页|上一|下一|单页|多页|起止)/.test(p)) return false;
  if (/翻页|页签|分页|加载更多|下一页/.test(p)) return false;
  if (/^(观察|查看|浏览|看到|打开|进入|跳转|点击|设置|展示|显示|检查|核对|验证|操作|返回|刷新|确认|保存|删除|新增|清空|选购|购买|结账|收款)/.test(p)) return false;
  return p.length >= 2 && p.length <= 14;
}

function cleanPageName(name) {
  return String(name).replace(/^(左侧|右侧|上半|下半|上方|下方|顶部|底部|左边|右边|该|此)/, '');
}

function detectPageId(texts) {
  // 优先级：动词锚定「进入/打开/在…页」> 句尾「xx页/xx页面」；两者都需经 isValidPageName 过滤
  for (const t of texts) {
    const s = String(t);
    let m = s.match(/(?:进入|打开|跳转到|来到|前往|切换到|在)\s*([\u4e00-\u9fa5A-Za-z0-9]{1,12}?)(?:页面|页)/);
    if (m) {
      const p = cleanPageName(m[1]) + '页';
      if (isValidPageName(p)) return p;
    }
    // 句尾匹配：页面名须延伸到句尾（允许尾随标点），贪婪捕获整段再过滤长度；捕获段不含连词/方位词
    const endMatch = s.match(/([\u4e00-\u9fa5A-Za-z0-9]+?)(?:页面|页)[。！？；;]?$/);
    if (endMatch) {
      const raw = endMatch[1];
      if (/[或和与、及]/.test(raw)) continue;
      if (raw.length > 14) continue;
      const p = cleanPageName(raw) + '页';
      if (isValidPageName(p)) return p;
    }
  }
  return '';
}

function detectElements(texts) {
  const out = [];
  for (const t of texts) {
    const b = String(t).match(/【([^】]+)】/g);
    if (b) for (const x of b) out.push(x.slice(1, -1));
  }
  for (const t of texts) {
    for (const h of ELEMENT_HINTS) {
      if (String(t).includes(h)) out.push(h);
    }
  }
  return [...new Set(out)];
}

function parseBusinessKnowledge(rootTopic) {
  const items = [];
  const seenRules = new Set();
  const seenElements = new Set();
  const seenPages = new Set();
  let seq = 2000;

  // 元素位置（容器→子元素层级）
  const ELEMENT_POSITION = {
    '搜索框': '页面顶部',
    '分类标签': '页面左侧 / 分类标签区',
    '搜索结果': '页面中部主区域',
    '当前分类': '搜索结果 > 当前分类区块',
    '全部类别': '搜索结果 > 全部类别区块',
    '商品分类': '页面左侧 / 分类标签区',
    '分类筛选': '搜索结果 > 分类筛选区',
    '云店商品标签': '分类筛选内选项'
  };
  // 展示内容（结果输出元素）
  const ELEMENT_DISPLAY = {
    '分类标签': '商品分类标签列表',
    '搜索结果': '匹配的商品项列表（含名称/规格/编号/单位/最新库存）',
    '当前分类': '当前分类下匹配的商品列表',
    '全部类别': '全部类别下匹配的商品列表（去重后）',
    '分类筛选': '分类筛选标签列表（含云店商品标签）'
  };
  // 元素优先级：决定补充说明归属（高→低 = 最终展示结果优先）
  const PRIORITY_SALE = ['搜索结果', '当前分类', '全部类别', '分类标签', '商品分类', '搜索框'];
  const PRIORITY_CLOUD = ['搜索结果', '当前分类', '分类筛选', '全部类别', '云店商品标签', '搜索框'];
  // 非功能用例：禁止入库
  const NONFUNCTIONAL_RE = /\[(性能|集成)\]|稳定性|兼容|并发|网络异常|压力测试/;

  // 第一遍：收集用例
  const cases = [];
  const modulePageFreq = new Map();
  walk(rootTopic, (topic, trail) => {
    const title = topicTitle(topic);
    const pm = String(title).match(/^\[(P[0-3])\]\s*(.*)$/);
    if (!pm) return;
    const priority = pm[1];
    if (priority !== 'P0' && priority !== 'P1') return; // 仅 P0/P1
    const caseTitle = pm[2].trim();
    if (!caseTitle || isNoiseTitle(caseTitle)) return;
    if (NONFUNCTIONAL_RE.test(caseTitle)) return; // 排除非功能
    if (trail.some(t => t === '非功能')) return; // 排除非功能模块

    const nonCase = trail.slice(0, -1).filter(t => !/^\[P[0-3]\]/.test(t));
    const treeL2 = nonCase[nonCase.length - 1] || '';
    const treeL1 = nonCase[nonCase.length - 2] || treeL2;
    if (!treeL1 || !treeL2) return;

    const isCloudShop = /^云店-/.test(caseTitle);
    const moduleL1 = isCloudShop ? '云店' : treeL1;
    const moduleL2 = isCloudShop ? '选购' : treeL2;

    const steps = [];
    const expects = [];
    walk(topic, (child) => {
      const ct = topicTitle(child);
      if (!ct) return;
      if (child.type === 'step' || /^步骤\d*[:：]/.test(ct)) {
        const v = ct.replace(/^步骤\d*[:：]\s*/, '').trim();
        if (v && steps.length < 6) steps.push(v);
      } else if (child.type === 'expected_result' || /^期望结果[:：]/.test(ct)) {
        const v = ct.replace(/^期望结果[:：]\s*/, '').trim();
        if (v && !expects.includes(v)) expects.push(v);
      }
    });

    const pageId = isCloudShop
      ? '云店搜索结果页'
      : detectPageId([...steps, ...expects, title, ...nonCase]);
    const platform = parsePlatform([title, ...nonCase, ...steps].join(' ')) || 'web';
    const ruleText = caseTitle
      .replace(/^(APP|PC|小程序|H5)[/｜|\s\-_]*(场景[ABCDEF]?[：:])?/, '')
      .replace(/^云店-/, '')
      .replace(/^场景[ABCDEF]?[：:]/, '')
      .trim();
    if (pageId) {
      const k = `${moduleL1}/${moduleL2}/${pageId}`;
      modulePageFreq.set(k, (modulePageFreq.get(k) || 0) + 1);
    }
    cases.push({ moduleL1, moduleL2, pageId, platform, ruleText, steps, expects, title, caseTitle, isCloudShop });
  });

  // 元素分类器：按模块的优先级映射挑选 rule 文本中出现的最高优先级元素
  function classifyElement(ruleText, isCloudShop) {
    const priority = isCloudShop ? PRIORITY_CLOUD : PRIORITY_SALE;
    for (const el of priority) {
      if (ruleText.includes(el)) return el;
    }
    return '';
  }

  // 视觉顺序索引
  function displayRank(name) {
    const i = ELEMENT_DISPLAY_ORDER.indexOf(name);
    return i < 0 ? 999 : i;
  }

  // 第二遍：先按 (target, kind) 暂存，最后按视觉顺序排序输出
  const buckets = new Map(); // key = `${tref}|${kind}` -> array of items
  function bucketPush(tref, kind, item) {
    const k = `${tref}|${kind}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(item);
  }
  function cmpRank(a, b) {
    return displayRank(a) - displayRank(b);
  }

  for (const c of cases) {
    let pageId = c.pageId;
    if (!pageId) {
      const mk = `${c.moduleL1}/${c.moduleL2}`;
      let best = '';
      let bestCount = 0;
      for (const [k, n] of modulePageFreq.entries()) {
        if (k.startsWith(mk + '/') && n > bestCount) {
          bestCount = n;
          best = k.slice(mk.length + 1);
        }
      }
      pageId = best;
    }
    if (!pageId) continue;

    const pageKey = `${c.moduleL1}/${c.moduleL2}/${pageId}`;
    const tref = pageKey; // supplement/element 都归到元素文件

    if (!seenPages.has(pageKey)) {
      seenPages.add(pageKey);
      const pageItem = {
        candidate_id: `C-${String(seq++).padStart(3, '0')}`,
        module_l1: c.moduleL1,
        module_l2: c.moduleL2,
        kind: 'page',
        page_id: pageId,
        page_role: '子页面',
        platform: c.platform,
        statement: `${c.moduleL2}相关页面`,
        confidence: 0.7,
        module_reason: 'xmind_business_rules'
      };
      bucketPush(`${c.moduleL1}/${c.moduleL2}/页面关系.md`, 'page', pageItem);
    }

    for (const el of detectElements([c.title, ...c.steps, ...c.expects])) {
      const elKey = `${pageKey}/${el}/${c.platform}`;
      if (seenElements.has(elKey)) continue;
      seenElements.add(elKey);
      const interaction = c.steps.find(s => s.includes(el)) || c.ruleText;
      const result = c.expects.find(e => e.includes(el)) || c.expects[0] || c.ruleText;
      bucketPush(tref, 'page_element', {
        candidate_id: `C-${String(seq++).padStart(3, '0')}`,
        module_l1: c.moduleL1,
        module_l2: c.moduleL2,
        kind: 'page_element',
        page_id: pageId,
        page_role: '子页面',
        platform: c.platform,
        element_name: el,
        element: {
          name: el,
          position: ELEMENT_POSITION[el] || '',
          input_options: '',
          display_content: ELEMENT_DISPLAY[el] || '',
          interaction,
          result,
          backend_apis: []
        },
        confidence: 0.5,
        module_reason: 'xmind_business_rules'
      });
    }

    const statement = c.ruleText;
    const category = classifyElement(statement, c.isCloudShop);
    if (statement && !seenRules.has(statement)) {
      seenRules.add(statement);
      bucketPush(tref, 'supplement', {
        candidate_id: `C-${String(seq++).padStart(3, '0')}`,
        module_l1: c.moduleL1,
        module_l2: c.moduleL2,
        kind: 'supplement',
        page_id: pageId,
        page_role: '子页面',
        platform: c.platform,
        statement,
        element_category: category,
        confidence: 0.6,
        module_reason: 'xmind_business_rules'
      });
    }
  }

  // 按视觉顺序排序后输出
  for (const [k, arr] of buckets.entries()) {
    arr.sort((a, b) => {
      const ak = a.element_name || a.element_category || a.kind;
      const bk = b.element_name || b.element_category || b.kind;
      return cmpRank(ak, bk);
    });
    for (const it of arr) items.push(it);
  }
  return items;
}

function enrichModules(items) {
  for (const it of items) {
    if (it.module_l1 && it.module_l2) continue;
    const hit = matchPrimary(`${it.page_id || ''} ${it.element_name || ''} ${it.module_reason || ''}`);
    if (hit) {
      it.module_l1 = hit.l1;
      it.module_l2 = hit.l2;
      it.module_reason = (it.module_reason || '') + `|matcher:${hit.reason}`;
    } else {
      it.module_l1 = '_inbox';
      it.module_l2 = '_inbox';
      it.module_reason = (it.module_reason || '') + '|matcher_unmatched';
    }
  }
  return items;
}

function findCases(rootTopic) {
  const cases = [];
  walk(rootTopic, topic => {
    const title = topicTitle(topic);
    if (/^\[P[0-3]\](?:\s|$)/.test(title)) cases.push({ topic, title });
  });
  return cases;
}

function itemRank(item) {
  if (item.kind === 'backend_api' &&
      ((item.assertions && item.assertions.length) || item.assertion_count > 0)) return 0;
  if (item.kind === 'backend_api') return 1;
  if (item.kind === 'page_relation') return 2;
  if (item.kind === 'page') return 3;
  return 4;
}

function dedupeCandidates(items) {
  const seen = new Map();
  for (const item of items) {
    const r = item.relation || {};
    const key = [
      item.case_id || item.module_reason, item.kind, item.page_id, item.element_name,
      item.statement || '',
      r.from, r.action, r.to,
      item.backend_api && item.backend_api.method, item.backend_api && item.backend_api.path
    ].join('|');
    if (!seen.has(key)) {
      seen.set(key, item);
    } else {
      const kept = seen.get(key);
      kept.confidence = Math.max(kept.confidence || 0, item.confidence || 0);
      kept.assertion_count = Math.max(kept.assertion_count || 0, item.assertion_count || 0);
    }
  }
  return [...seen.values()];
}

function loadXmindSource(xmindPath) {
  const fp = fingerprintPath(xmindPath);
  if (!fp.ok) throw new Error(fp.error + ': ' + xmindPath);
  const AdmZip = loadAdmZip();
  const zip = new AdmZip(fp.path);
  const entry = zip.getEntry('content.json');
  if (!entry) throw new Error('xmind_missing_content_json');
  const content = JSON.parse(entry.getData().toString('utf8'));
  const rootTopic = Array.isArray(content) ? content[0] && content[0].rootTopic : content.rootTopic;
  if (!rootTopic) throw new Error('xmind_invalid_rootTopic');

  const allCases = findCases(rootTopic);
  const p0Cases = allCases.filter(c => /^\[P0\](?:\s|$)/.test(c.title));
  const warnings = [];
  if (!allCases.length) warnings.push('未识别优先级；没有用例被当作 P0');
  const combined = [];
  for (const entry of p0Cases) {
    // 两个通道彼此独立执行；结构化引用绝不由普通步骤或邻近关系制造。
    const navigationItems = parseFunctionalCandidates(entry.topic, entry.title);
    const technicalItems = parseStructuredTechRefs(entry.topic);
    combined.push(...navigationItems, ...technicalItems);
  }
  // 业务规则通道：仅 P0/P1（排除非功能）→ 页面/核心元素/补充说明
  combined.push(...parseBusinessKnowledge(rootTopic));
  const items = dedupeCandidates(enrichModules(combined)).sort((a, b) => itemRank(a) - itemRank(b));
  const p01Business = allCases.filter(c => /^\[P[01]\](?:\s|$)/.test(c.title)).length;

  return {
    schema_version: '6.3',
    source: {
      type: 'xmind',
      ref: fp.path,
      read_at: new Date().toISOString()
    },
    source_fingerprint: fp.fingerprint,
    source_manifest: {
      path: fp.path,
      size: fp.size,
      mtime_ms: fp.mtime_ms,
      sha256: fp.sha256
    },
    items,
    notes: warnings.concat([
      `导航/技术引用：严格 P0（${p0Cases.length}/${allCases.length}）`,
      `业务规则：P0/P1（候选池约 ${p01Business} 条用例标题）`,
      '导航步骤与结构化技术引用独立解析',
      '业务规则通道 → 页面/核心元素/补充说明（排除非功能）'
    ])
  };
}

function selfTest() {
  const { writeTestCasesXmind } = require('../../../../src/scripts/lib/xmind_export');
  const os = require('os');
  const tmp = path.join(os.tmpdir(), `kb63_xmind_${Date.now()}.xmind`);
  writeTestCasesXmind(
    {
      root: {
        title: '自测 · 测试用例',
        children: [
          {
            title: '销售',
            children: [
              {
                title: '销售单',
                children: [
                  {
                    title: '[P0] 打开销售单列表页',
                    labels: ['ailit', 'PC端'],
                    children: [
                      { title: '前提条件: 已登录', type: 'precondition' },
                      {
                        title: '步骤1: 打开列表',
                        type: 'step',
                        children: [{ title: '期望结果: 展示列表', type: 'expected_result' }]
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
    tmp
  );
  const cand = loadXmindSource(tmp);
  const ok =
    cand.items.some(i => i.kind === 'page_url' && i.page_url.template === '/sales/order/list') &&
    cand.items.some(i => i.kind === 'backend_api' && i.element_name === '表头.设置') &&
    cand.items.some(i => i.kind === 'supplement' && /打开销售单列表页/.test(i.statement)) &&
    cand.items.some(i => i.kind === 'page' && i.page_id === '打开销售单列表页');
  fs.unlinkSync(tmp);
  if (!ok) {
    console.error('xmind_source self-test failed', cand.items);
    process.exit(1);
  }
  console.log('✓ xmind_source self-test');
}

module.exports = {
  loadXmindSource,
  parseStructuredTechRefs,
  parseFunctionalCandidates,
  parseBusinessKnowledge,
  findCases,
  dedupeCandidates,
  selfTest
};
if (require.main === module) selfTest();
