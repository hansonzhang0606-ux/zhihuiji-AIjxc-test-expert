/**
 * Demand 6.2 — KB 三级召回：索引 → 矩阵 → 页面关系/元素切片。
 *
 * 仅 status=已确认 的元素页可写入 domain_facts.json。无命中不是错误。
 *
 *   node kb/extract_kb.js --project-dir <工作区> --module-l1 销售 --module-l2 销售 [--keywords "表头,开单"]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_KB_ROOT,
  INDEX_NAME,
  buildIndex,
  writeIndex,
  parseFrontmatter,
  isIndexStale
} = require('./rebuild_index');
const { loadMatrix, normalizePlatform, resolveSupport } = require('../lib/kb_matrix');
const { emptyFacts, loadDomainFacts, writeDomainFacts } = require('../stage1/domain_facts');
const {
  parseWebCompareTables,
  parseElementTables
} = require('../../../skills/knowledge-base/scripts/core/markdown_model');
const { findSensitiveIssues } = require('../../../skills/knowledge-base/scripts/lib/tech_normalize');

const MAX_RELATIONS = 30;
const MAX_ELEMENTS = 20;
const MAX_SUPPLEMENTS = 8;
const MAX_URLS = 10;
const MAX_APIS = 20;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function ensureIndex(kbRoot) {
  const file = path.join(kbRoot, INDEX_NAME);
  const current = fs.existsSync(file) ? readJson(file) : null;
  if (!current || isIndexStale(kbRoot, current)) {
    const rebuilt = buildIndex(kbRoot);
    writeIndex(kbRoot, rebuilt);
    return rebuilt;
  }
  return current;
}

function platformScope(ctx) {
  const values = (ctx && ctx.platforms && ctx.platforms.in_scope) || [];
  return [...new Set(values.map(normalizePlatform).filter(item => item === 'web' || item === 'app'))];
}

function keywordsFrom(value) {
  return String(value || '')
    .split(/[，,、\s]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function matchesKeywords(page, rawKeywords) {
  if (!rawKeywords.length) return false;
  const haystack = (page.keywords || []).join(' ');
  return rawKeywords.some(keyword => haystack.includes(keyword) || keyword.includes(page.page_id));
}

function parseRowsInSection(text, platform) {
  const parsed = parseElementTables(text);
  const block = parsed.platforms.find(p => p.platform === platform);
  if (!block) return [];
  return block.elements.map(el => {
    // 兼容旧调用方：数组形态 [name, pos, input, interaction, result, downstream|api...]
    const apiCell = el.backend_apis && el.backend_apis.length
      ? el.backend_apis.map(a => `${a.method} ${a.path}`).join('<br>')
      : '';
    return {
      cells: [
        el.name,
        el.position,
        el.input_options,
        el.interaction,
        el.result,
        apiCell,
        el.downstream
      ],
      element: el
    };
  });
}

function parseSupplements(text, elementNames) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === '## 补充说明');
  if (start < 0) return [];
  const result = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    if (!line.startsWith('-')) continue;
    if (elementNames.some(name => line.includes(name))) result.push(line.replace(/^-\s*/, '').trim());
  }
  return result;
}

function parseRelations(text, platform) {
  const sectionHeading = platform === 'web' ? '## 2. 电脑端（Web）' : '## 3. APP端';
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === sectionHeading);
  if (start < 0) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const section = lines.slice(start, end);
  const tableStart = section.findIndex(line => line.trim() === '### 2.2 跳转路径' || line.trim() === '### 3.2 跳转路径');
  if (tableStart < 0) return [];
  const result = [];
  let header = false;
  for (const line of section.slice(tableStart + 1)) {
    if (/^###\s/.test(line)) break;
    if (!line.trim().startsWith('|')) continue;
    const cells = line.trim().split('|').slice(1, -1).map(value => value.trim());
    if (!header) {
      header = true;
      continue;
    }
    if (cells.every(value => /^-+$/.test(value))) continue;
    if (cells.length === 3) result.push({ from: cells[0], action: cells[1], to: cells[2] });
  }
  return result;
}

function nextFactId(existing, offset) {
  const max = existing.reduce((current, fact) => {
    const match = String(fact.id || '').match(/^DF-(\d+)$/);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `DF-${String(max + offset + 1).padStart(3, '0')}`;
}

function buildExtraction({ kbRoot, moduleL1, moduleL2, keywords, platforms }) {
  const index = ensureIndex(kbRoot);
  const matrix = loadMatrix(path.join(kbRoot, '模块矩阵总览.md'));
  const moduleCheck = moduleL2 ? resolveSupport(matrix, moduleL1, moduleL2, platforms[0] || 'web') : null;
  const warnings = [];
  if (moduleCheck && !moduleCheck.ok) return { facts: [], warnings: [moduleCheck.warning], status: 'invalid_module', matched: [] };
  const entry = (index.modules || []).find(item => item.module_l1 === moduleL1 && item.module_l2 === moduleL2);
  if (!entry) return { facts: [], warnings, status: 'no_module_kb', matched: [] };

  const rawKeywords = keywordsFrom(keywords);
  const hitPages = entry.pages.filter(page => matchesKeywords(page, rawKeywords));
  if (!hitPages.length) return { facts: [], warnings, status: 'no_match', matched: [] };
  const facts = [];
  const matched = [];

  const allowedPlatforms = platforms.filter(platform => {
    const result = resolveSupport(matrix, moduleL1, moduleL2, platform);
    if (result.warning) warnings.push(result.warning);
    return result.support !== '不支持';
  });
  const relationText = fs.readFileSync(path.join(kbRoot, entry.pages_file), 'utf8');
  const pageIds = new Set(hitPages.map(page => page.page_id));
  for (const platform of allowedPlatforms) {
    for (const relation of parseRelations(relationText, platform)) {
      if (facts.filter(fact => fact.fact_kind === 'page_relation').length >= MAX_RELATIONS) break;
      if (!pageIds.has(relation.from) && !pageIds.has(relation.to)) continue;
      facts.push({
        statement: `${relation.from} 经「${relation.action}」进入 ${relation.to}`,
        forbid_patterns: [],
        source: 'kb_applied',
        session_only: false,
        platforms: [platform],
        fact_kind: 'page_relation',
        page_id: relation.from,
        relation: { from: relation.from, to: relation.to },
        kb_ref: `${entry.pages_file}#${platform}:${relation.from}>${relation.to}`
      });
    }
  }

  // Web URL：仅命中且已确认页；敏感值拒绝
  if (allowedPlatforms.includes('web')) {
    const webUrls = parseWebCompareTables(relationText);
    for (const w of webUrls.warnings || []) warnings.push(w);
    for (const row of webUrls.rows) {
      if (!pageIds.has(row.page_id)) continue;
      const pageMeta = hitPages.find(p => p.page_id === row.page_id);
      if (!pageMeta || pageMeta.status !== '已确认') continue;
      if (facts.filter(f => f.fact_kind === 'page_url').length >= MAX_URLS) {
        warnings.push('page_url truncated to ' + MAX_URLS);
        break;
      }
      for (const u of row.urls || []) {
        const issues = findSensitiveIssues(u.template);
        if (issues.length) {
          warnings.push(`page_url rejected sensitive ${row.page_id}: ${issues.join(',')}`);
          continue;
        }
        facts.push({
          statement: `${row.page_id} Web URL ${u.template}`,
          forbid_patterns: [],
          source: 'kb_applied',
          session_only: false,
          platforms: ['web'],
          fact_kind: 'page_url',
          page_id: row.page_id,
          page_url: { template: u.template, absolute: !!u.absolute },
          kb_ref: `${entry.pages_file}#url:${row.page_id}`
        });
      }
    }
  }

  for (const page of hitPages) {
    matched.push({ page_id: page.page_id, status: page.status, file: page.file });
    if (!page.file || page.status !== '已确认') continue;
    const file = path.join(kbRoot, page.file);
    const text = fs.readFileSync(file, 'utf8');
    const frontmatter = parseFrontmatter(text);
    if (frontmatter['状态'] !== '已确认') continue;
    for (const platform of allowedPlatforms.filter(item => page.platforms.includes(item))) {
      const selected = parseRowsInSection(text, platform).filter(row => {
        const haystack = row.cells.join(' ');
        return rawKeywords.some(keyword => haystack.includes(keyword) || keyword.includes(row.cells[0]));
      });
      for (const row of selected) {
        if (facts.filter(fact => fact.fact_kind === 'page_element').length >= MAX_ELEMENTS) break;
        const cells = row.cells;
        facts.push({
          statement: `${page.page_id}「${cells[0]}」：${cells[2]}；操作「${cells[3]}」；结果「${cells[4]}」`,
          forbid_patterns: [],
          source: 'kb_applied',
          session_only: false,
          platforms: [platform],
          fact_kind: 'page_element',
          page_id: page.page_id,
          element_name: cells[0],
          kb_ref: `${page.file}#${platform}:${cells[0]}`
        });

        // 同行后端接口 → backend_api facts（只取命中元素；跳过待确认/敏感）
        const apis = (row.element && row.element.backend_apis) || [];
        for (const api of apis) {
          if (facts.filter(f => f.fact_kind === 'backend_api').length >= MAX_APIS) {
            warnings.push('backend_api truncated to ' + MAX_APIS);
            break;
          }
          if (api.method === 'PENDING' || api.method === 'NONE') continue;
          const issues = findSensitiveIssues(`${api.method} ${api.path}`);
          if (issues.length) {
            warnings.push(`backend_api rejected ${cells[0]}: ${issues.join(',')}`);
            continue;
          }
          facts.push({
            statement: `${page.page_id}「${cells[0]}」${platform} ${api.method} ${api.path}`,
            forbid_patterns: [],
            source: 'kb_applied',
            session_only: false,
            platforms: [platform],
            fact_kind: 'backend_api',
            page_id: page.page_id,
            element_name: cells[0],
            backend_api: {
              method: api.method,
              path: api.path,
              operation: api.operation || undefined
            },
            kb_ref: `${page.file}#${platform}:${cells[0]}:api`
          });
        }
      }
      const elementNames = selected.map(row => row.cells[0]);
      for (const note of parseSupplements(text, elementNames)) {
        if (facts.filter(fact => fact.fact_kind === 'supplement').length >= MAX_SUPPLEMENTS) break;
        facts.push({
          statement: `${page.page_id}补充：${note}`,
          forbid_patterns: [],
          source: 'kb_applied',
          session_only: false,
          platforms: [platform],
          fact_kind: 'supplement',
          page_id: page.page_id,
          kb_ref: `${page.file}#补充说明`
        });
      }
    }
  }
  const onlyUnconfirmed = matched.length > 0 && facts.length === 0 && matched.every(item => item.status !== '已确认');
  return { facts, warnings, status: onlyUnconfirmed ? 'only_unconfirmed' : (facts.length ? 'matched' : 'no_match'), matched };
}

function writeFacts(projectDir, result, requirementTitle) {
  const loaded = loadDomainFacts(projectDir);
  if (!loaded.ok) throw new Error(loaded.errors.join('；'));
  const base = loaded.data || emptyFacts(requirementTitle);
  const retained = (base.facts || []).filter(fact => fact.source !== 'kb_applied');
  const facts = result.facts.map((fact, index) => ({
    ...fact,
    id: nextFactId(retained, index)
  }));
  const document = {
    ...base,
    requirement_title: base.requirement_title || requirementTitle,
    facts: retained.concat(facts),
    updated_at: new Date().toISOString()
  };
  writeDomainFacts(projectDir, document);
  return document;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project-dir' && argv[i + 1]) out.projectDir = argv[++i];
    else if (arg === '--kb-root' && argv[i + 1]) out.kbRoot = argv[++i];
    else if (arg === '--module-l1' && argv[i + 1]) out.moduleL1 = argv[++i];
    else if (arg === '--module-l2' && argv[i + 1]) out.moduleL2 = argv[++i];
    else if (arg === '--keywords' && argv[i + 1]) out.keywords = argv[++i];
    else if (arg === '--self-test') out.selfTest = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

function modulesFromAttribution(projectDir) {
  const file = path.join(projectDir, 'script', 'stage3', 'module_attribution.json');
  if (!fs.existsSync(file)) throw new Error(`缺少 C-MOD: ${file}`);
  const unique = new Map();
  for (const item of readJson(file).attributions || []) {
    if (item.module_match !== 'matched' || !item.module_l1 || !item.module_l2) continue;
    const key = `${item.module_l1}\u0000${item.module_l2}`;
    const current = unique.get(key) || {
      moduleL1: item.module_l1,
      moduleL2: item.module_l2,
      keywords: []
    };
    current.keywords.push(item.match_keyword, item.rp_title);
    unique.set(key, current);
  }
  return [...unique.values()];
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

function runSelfTest() {
  const result = buildExtraction({
    kbRoot: DEFAULT_KB_ROOT,
    moduleL1: '销售',
    moduleL2: '销售',
    keywords: '表头 设置 商品列表',
    platforms: ['web', 'app']
  });
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kb-extract-'));
  fs.mkdirSync(path.join(tmp, 'script', 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'script', 'config', 'test_context.json'),
    JSON.stringify({ requirement_title: 'KB 截取自测' }),
    'utf8'
  );
  fs.mkdirSync(path.join(tmp, 'script', 'stage3'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'script', 'stage3', 'module_attribution.json'),
    JSON.stringify({
      attributions: [{
        module_match: 'matched',
        module_l1: '销售',
        module_l2: '销售',
        match_keyword: '表头',
        rp_title: '销售单表头设置'
      }]
    }),
    'utf8'
  );
  const derivedModules = modulesFromAttribution(tmp);
  const factsDoc = writeFacts(tmp, result, 'KB 截取自测');
  const onlyConfirmed = factsDoc.facts.every(fact => fact.source !== 'kb_applied' || fact.platforms.length);
  const hasElement = result.facts.some(fact => fact.fact_kind === 'page_element');
  const hasRelation = result.facts.some(fact => fact.fact_kind === 'page_relation');
  const confirmedOnly = result.facts.every(fact => fact.source === 'kb_applied');

  // URL/API：在临时 KB 上补列后应召回
  const tmpKb = path.join(tmp, 'kb');
  copyTree(DEFAULT_KB_ROOT, tmpKb);
  const relFile = path.join(tmpKb, '销售', '销售', '页面关系.md');
  let rel = fs.readFileSync(relFile, 'utf8').replace(/\r\n/g, '\n');
  // 直接覆写 Web 对照表为 v63 三列，避免 CRLF/局部替换失败
  rel = rel.replace(
    /### 2\.1 本端页面名[^\n]*\n\n\|[\s\S]*?(?=\n### 2\.2)/,
    [
      '### 2.1 本端页面名与 URL（对照）',
      '',
      '| 统一页面名称 | 本端页面名 | 前端 URL 模板 |',
      '|--------------|------------|---------------|',
      '| 销售单列表页 | 销售单列表页 | `/sales/order/list` |',
      '| 销售单开单页 | 新增销售单页 / 修改销售单页 / 复制销售单页（同一开单页，入口不同） | `/sales/order/edit` |',
      '| 销售单详情页 | 查看销售单页（销售单详情页） | `/sales/order/{order_id}` |',
      ''
    ].join('\n')
  );
  fs.writeFileSync(relFile, rel, 'utf8');
  const elFile = path.join(tmpKb, '销售', '销售', '主页面_销售单列表页.md');
  let el = fs.readFileSync(elFile, 'utf8').replace(/\r\n/g, '\n');
  el = el.replace(
    /\| 元素 \| 位置 \| 输入\/选项 \| 交互 \| 交互结果 \| 下游影响说明 \|[\s\S]*?\| 表头\.设置[\s\S]*?\| — \|/,
    [
      '| 元素 | 位置 | 输入/选项 | 交互 | 交互结果 | 后端接口 | 下游影响说明 |',
      '|------|------|-----------|------|----------|----------|--------------|',
      '| 表头.设置 | 列表表头左侧齿轮 | 可选列←公用表头字段池（系统写死；本页不可新建） | 弹窗：已显示表头 ↔ 可选表头（+/-、拖动可排序） | 仅本列表按已显示表头列展示 | `GET /api/v1/columns`（查询可选列） | — |'
    ].join('\n')
  );
  fs.writeFileSync(elFile, el, 'utf8');
  // 清索引强制重建
  const indexPath = path.join(tmpKb, INDEX_NAME);
  if (fs.existsSync(indexPath)) fs.unlinkSync(indexPath);
  const enriched = buildExtraction({
    kbRoot: tmpKb,
    moduleL1: '销售',
    moduleL2: '销售',
    keywords: '表头 设置 销售单列表页',
    platforms: ['web', 'app']
  });

  const checks = [
    [result.status === 'matched', '命中知识库切片'],
    [hasElement, '召回核心元素'],
    [hasRelation, '召回页面关系'],
    [confirmedOnly, '事实标记 kb_applied'],
    [onlyConfirmed && factsDoc.facts.length === result.facts.length, '切片写入 domain_facts 并通过契约'],
    [derivedModules.length === 1 && derivedModules[0].moduleL2 === '销售', '从 C-MOD 提取模块范围'],
    [enriched.facts.some(f => f.fact_kind === 'page_url'), '召回 page_url'],
    [enriched.facts.some(f => f.fact_kind === 'backend_api'), '召回 backend_api'],
    [!enriched.facts.some(f => f.fact_kind === 'page_url' && /token=/i.test(JSON.stringify(f))), 'URL 无敏感串']
  ];
  let failed = 0;
  for (const [ok, name] of checks) {
    console.log(`${ok ? '✓' : '✗'} ${name}`);
    if (!ok) failed++;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  if (failed) process.exitCode = 1;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('用法: node kb/extract_kb.js --project-dir <工作区> [--module-l1 <一级> --module-l2 <二级> --keywords <关键词>]\n未指定模块时读取 script/stage3/module_attribution.json（C-MOD）。');
    return;
  }
  if (args.selfTest) return runSelfTest();
  if (!args.projectDir || !args.moduleL1 || !args.moduleL2) {
    if (!args.projectDir) throw new Error('缺少 --project-dir');
  }
  const projectDir = path.resolve(args.projectDir);
  const ctxFile = path.join(projectDir, 'script', 'config', 'test_context.json');
  const ctx = fs.existsSync(ctxFile) ? readJson(ctxFile) : null;
  const modules = args.moduleL1 && args.moduleL2
    ? [{ moduleL1: args.moduleL1, moduleL2: args.moduleL2, keywords: [args.keywords || ''] }]
    : modulesFromAttribution(projectDir);
  const results = modules.map(module => buildExtraction({
    kbRoot: path.resolve(args.kbRoot || DEFAULT_KB_ROOT),
    moduleL1: module.moduleL1,
    moduleL2: module.moduleL2,
    keywords: args.keywords || module.keywords.join(' '),
    platforms: platformScope(ctx)
  }));
  const result = {
    facts: results.flatMap(item => item.facts),
    warnings: results.flatMap(item => item.warnings),
    matched: results.flatMap(item => item.matched),
    status: results.some(item => item.status === 'matched')
      ? 'matched'
      : (results.every(item => item.status === 'only_unconfirmed') ? 'only_unconfirmed' : 'no_match')
  };
  const facts = writeFacts(projectDir, result, (ctx && ctx.requirement_title) || path.basename(projectDir));
  const report = {
    ok: true,
    status: result.status,
    warnings: result.warnings,
    matched: result.matched,
    modules: modules.map(item => ({ module_l1: item.moduleL1, module_l2: item.moduleL2 })),
    facts_added: result.facts.length,
    facts_total: facts.facts.length
  };
  const reportPath = path.join(projectDir, 'script', 'stage1', 'kb_extract_report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

module.exports = { buildExtraction, writeFacts, platformScope, modulesFromAttribution };
if (require.main === module) main();
