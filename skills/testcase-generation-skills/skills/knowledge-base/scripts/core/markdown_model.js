/**
 * Demand 6.3 — KB Markdown 模型（URL / API 读写与兼容）
 *
 * 读：兼容旧二列对照表 / 六列元素表；缺 URL/API 仅 warning
 * 写：严格模式（拟写已确认）要求 Web URL、元素后端接口或纯前端声明
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  normalizePageUrl,
  normalizeBackendApi,
  findSensitiveIssues
} = require('../lib/tech_normalize');

const ELEMENT_HEADERS_LEGACY = ['元素', '位置', '输入/选项', '交互', '交互结果', '下游影响说明'];
const ELEMENT_HEADERS_V63 = [
  '元素',
  '位置',
  '输入/选项',
  '交互',
  '交互结果',
  '后端接口',
  '下游影响说明'
];
const ELEMENT_HEADERS_V64 = [
  '元素',
  '位置',
  '输入/选项',
  '展示内容',
  '交互',
  '交互结果',
  '后端接口',
  '下游影响说明'
];
const WEB_COMPARE_HEADERS_LEGACY = ['统一页面名称', '本端页面名'];
const WEB_COMPARE_HEADERS_V63 = ['统一页面名称', '本端页面名', '前端 URL 模板'];

function splitCells(line) {
  return line
    .trim()
    .split('|')
    .slice(1, -1)
    .map(v => v.trim());
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every(v => /^:?-+:?$/.test(v));
}

function headersEqual(actual, expected) {
  if (!actual || actual.length !== expected.length) return false;
  return expected.every((name, i) => actual[i] === name);
}

function parseMarkdownTables(text) {
  const lines = String(text || '').split(/\r?\n/);
  const tables = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim().startsWith('|')) {
      i++;
      continue;
    }
    const start = i;
    const rows = [];
    while (i < lines.length && lines[i].trim().startsWith('|')) {
      rows.push({ line: i + 1, cells: splitCells(lines[i]) });
      i++;
    }
    if (rows.length < 2) continue;
    const header = rows[0].cells;
    const body = rows.slice(1).filter(r => !isSeparatorRow(r.cells));
    // 向上找最近标题
    let heading = '';
    for (let j = start - 1; j >= 0; j--) {
      if (/^#{1,6}\s/.test(lines[j])) {
        heading = lines[j].trim();
        break;
      }
    }
    tables.push({ heading, header, rows: body, startLine: start + 1 });
  }
  return tables;
}

function stripMdCode(s) {
  return String(s || '')
    .trim()
    .replace(/`/g, '')
    .trim();
}

function parseBackendApiCell(cell) {
  const raw = String(cell || '').trim();
  if (!raw || raw === '—' || raw === '-') {
    return { apis: [], warnings: ['backend_api.empty'], raw };
  }
  const parts = raw
    .split(/<br\s*\/?>/i)
    .map(s => stripMdCode(s.replace(/\s+/g, ' ')))
    .filter(Boolean);
  const apis = [];
  const errors = [];
  const warnings = [];
  for (const part of parts) {
    if (/^无后端调用（纯前端）$/.test(part) || /^NONE$/i.test(part)) {
      apis.push({ method: 'NONE', path: '无后端调用（纯前端）', operation: '', raw: part });
      continue;
    }
    if (/^待确认$/.test(part) || /^PENDING$/i.test(part) || /^待补充（历史）$/.test(part)) {
      apis.push({ method: 'PENDING', path: part, operation: '', raw: part });
      continue;
    }
    const m = part.match(/^(GET|POST|PUT|PATCH|DELETE|WS)\s+(\S+)(?:\s*[（(]([^）)]+)[）)])?/i);
    if (!m) {
      errors.push(`backend_api.unparseable:${part}`);
      continue;
    }
    const normalized = normalizeBackendApi({
      method: m[1],
      path: m[2],
      operation: m[3] || ''
    });
    if (!normalized.ok) {
      errors.push(...normalized.errors.map(e => `${e}:${part}`));
      continue;
    }
    apis.push({ ...normalized.value, raw: part });
  }
  return { apis, errors, warnings, raw };
}

function parsePageUrlCell(cell) {
  const raw = stripMdCode(cell);
  if (!raw || raw === '—' || raw === '-') {
    return { urls: [], warnings: ['page_url.empty'], raw };
  }
  if (/^待补充（历史）$/.test(raw) || /^待确认$/.test(raw)) {
    return { urls: [], warnings: ['page_url.pending_or_historical'], raw };
  }
  const parts = String(cell || '')
    .split(/<br\s*\/?>/i)
    .map(s => stripMdCode(s))
    .filter(Boolean);
  const urls = [];
  const errors = [];
  for (const part of parts) {
    const n = normalizePageUrl(part);
    if (!n.ok) {
      errors.push(...n.errors.map(e => `${e}:${part}`));
      continue;
    }
    urls.push({ ...n.value, raw: part });
  }
  return { urls, errors, warnings: [], raw };
}

/**
 * 按 ## 电脑端 / ## APP端 切分，避免 App 对照表被当成 Web URL 表
 */
function sectionPlatformAt(lines, lineNo1Based) {
  let platform = null;
  for (let i = 0; i < lineNo1Based - 1; i++) {
    const t = lines[i].trim();
    if (t === '## 电脑端' || t.startsWith('## 电脑端') || t.startsWith('## 2. 电脑端')) {
      platform = 'web';
    } else if (t === '## APP端' || t.startsWith('## APP端') || t.startsWith('## 3. APP')) {
      platform = 'app';
    }
  }
  return platform;
}

/**
 * 解析页面关系 Web 对照表（兼容 2/3 列）；仅读取 web 节
 */
function parseWebCompareTables(text) {
  const lines = String(text || '').split(/\r?\n/);
  const tables = parseMarkdownTables(text);
  const out = [];
  const warnings = [];
  for (const t of tables) {
    const platform = sectionPlatformAt(lines, t.startLine);
    if (platform !== 'web') continue;
    const legacy = headersEqual(t.header, WEB_COMPARE_HEADERS_LEGACY);
    const v63 = headersEqual(t.header, WEB_COMPARE_HEADERS_V63);
    if (!legacy && !v63) continue;
    if (legacy) warnings.push(`${t.heading || 'table'}:L${t.startLine} migration_warning:missing_url_column`);
    for (const row of t.rows) {
      const pageId = row.cells[0] || '';
      const localName = row.cells[1] || '';
      let urls = [];
      let urlErrors = [];
      let urlWarnings = [];
      if (v63) {
        const parsed = parsePageUrlCell(row.cells[2]);
        urls = parsed.urls;
        urlErrors = parsed.errors || [];
        urlWarnings = parsed.warnings || [];
      } else {
        urlWarnings = ['page_url.column_absent'];
      }
      out.push({
        page_id: pageId,
        local_name: localName,
        urls,
        line: row.line,
        schema: v63 ? 'v63' : 'legacy',
        errors: urlErrors,
        warnings: urlWarnings
      });
    }
  }
  return { rows: out, warnings };
}

/**
 * 解析页面元素核心表（兼容 6/7 列）
 */
function parseElementTables(text) {
  const tables = parseMarkdownTables(text);
  const platforms = [];
  const warnings = [];
  const lines = String(text || '').split(/\r?\n/);

  function platformNear(startLine) {
    for (let i = startLine - 2; i >= 0; i--) {
      const t = lines[i].trim();
      if (t === '## 电脑端' || t.startsWith('## 电脑端')) return 'web';
      if (t === '## APP端' || t.startsWith('## APP端')) return 'app';
      if (/^##\s/.test(t)) break;
    }
    return null;
  }

  for (const t of tables) {
    if (t.heading !== '### 核心元素' && !/核心元素/.test(t.heading)) continue;
    const legacy = headersEqual(t.header, ELEMENT_HEADERS_LEGACY);
    const v63 = headersEqual(t.header, ELEMENT_HEADERS_V63);
    const v64 = headersEqual(t.header, ELEMENT_HEADERS_V64);
    if (!legacy && !v63 && !v64) {
      warnings.push(`unknown_element_header:L${t.startLine}:${(t.header || []).join('|')}`);
      continue;
    }
    if (legacy) warnings.push(`migration_warning:missing_api_column:L${t.startLine}`);
    const platform = platformNear(t.startLine);
    const elements = [];
    for (const row of t.rows) {
      const base = {
        name: row.cells[0] || '',
        position: row.cells[1] || '',
        input_options: row.cells[2] || '',
        interaction: row.cells[3] || '',
        result: row.cells[4] || '',
        line: row.line,
        schema: v64 ? 'v64' : (v63 ? 'v63' : 'legacy')
      };
      if (v64) {
        base.display_content = row.cells[3] || '';
        base.interaction = row.cells[4] || '';
        base.result = row.cells[5] || '';
        const apiCell = parseBackendApiCell(row.cells[6]);
        base.backend_apis = apiCell.apis;
        base.api_errors = apiCell.errors || [];
        base.api_warnings = apiCell.warnings || [];
        base.downstream = row.cells[7] || '';
      } else if (v63) {
        const apiCell = parseBackendApiCell(row.cells[5]);
        base.backend_apis = apiCell.apis;
        base.api_errors = apiCell.errors || [];
        base.api_warnings = apiCell.warnings || [];
        base.downstream = row.cells[6] || '';
      } else {
        base.backend_apis = [];
        base.api_errors = [];
        base.api_warnings = ['backend_api.column_absent'];
        base.downstream = row.cells[5] || '';
      }
      elements.push(base);
    }
    platforms.push({ platform, heading: t.heading, elements, schema: v63 ? 'v63' : 'legacy' });
  }
  return { platforms, warnings };
}

/**
 * 校验拟写入已确认内容（strict）
 */
function validateStrictWrite({ pageUrls = [], elements = [], platform = 'web', status = '已确认' }) {
  const errors = [];
  const warnings = [];
  if (status !== '已确认') return { ok: true, errors, warnings };

  if (platform === 'web') {
    for (const u of pageUrls) {
      if (!u.urls || !u.urls.length) {
        errors.push(`strict.web_page_missing_url:${u.page_id || '?'}`);
      }
      for (const err of u.errors || []) errors.push(err);
    }
  }

  for (const el of elements) {
    if (!el.backend_apis || !el.backend_apis.length) {
      errors.push(`strict.element_missing_api:${el.name || '?'}`);
      continue;
    }
    for (const err of el.api_errors || []) errors.push(err);
    for (const api of el.backend_apis) {
      const issues = findSensitiveIssues(`${api.method} ${api.path}`);
      for (const issue of issues) errors.push(`${issue}:${el.name}`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

function renderBackendApiCell(apis) {
  if (!apis || !apis.length) return '-';
  return apis
    .map(a => {
      if (a.method === 'NONE') return '无后端调用（纯前端）';
      if (a.method === 'PENDING') return a.path || '待确认';
      const op = a.operation ? `（${a.operation}）` : '';
      return `${a.method} ${a.path}${op}`;
    })
    .join('<br>');
}

function selfTest() {
  const fixDir = path.resolve(__dirname, '..', '..', 'fixtures', 'markdown');
  const legacyRel = fs.readFileSync(path.join(fixDir, '页面关系_legacy.md'), 'utf8');
  const v63Rel = fs.readFileSync(path.join(fixDir, '页面关系_v63.md'), 'utf8');
  const legacyEl = fs.readFileSync(path.join(fixDir, '元素_legacy.md'), 'utf8');
  const v63El = fs.readFileSync(path.join(fixDir, '元素_v63.md'), 'utf8');

  const cases = [];
  const r1 = parseWebCompareTables(legacyRel);
  cases.push(['legacy web compare no url col', r1.rows.length >= 1 && r1.rows[0].schema === 'legacy']);
  const r2 = parseWebCompareTables(v63Rel);
  cases.push([
    'v63 web url parsed',
    r2.rows.some(x => x.page_id === '销售单列表页' && x.urls.some(u => u.template === '/sales/order/list'))
  ]);
  cases.push(['app compare not misread as url', !r2.rows.some(x => x.page_id === '销售单开单成功页' && x.schema === 'v63' && x.urls.length)]);

  const e1 = parseElementTables(legacyEl);
  cases.push(['legacy element 6col', e1.platforms[0] && e1.platforms[0].schema === 'legacy']);
  const e2 = parseElementTables(v63El);
  const el = e2.platforms.find(p => p.platform === 'web');
  cases.push([
    'v63 multi api br',
    el &&
      el.elements[0] &&
      el.elements[0].backend_apis.length === 2 &&
      el.elements[0].backend_apis[0].method === 'GET'
  ]);
  const pure = el && el.elements.find(x => x.name === '表头.纯前端');
  cases.push(['pure frontend', pure && pure.backend_apis[0] && pure.backend_apis[0].method === 'NONE']);

  const strictBad = validateStrictWrite({
    pageUrls: [{ page_id: 'X页', urls: [], errors: [] }],
    elements: [{ name: '按钮', backend_apis: [], api_errors: [] }],
    platform: 'web',
    status: '已确认'
  });
  cases.push(['strict fail missing', !strictBad.ok]);

  const strictOk = validateStrictWrite({
    pageUrls: [{ page_id: 'X页', urls: [{ template: '/x' }], errors: [] }],
    elements: [
      {
        name: '按钮',
        backend_apis: [{ method: 'GET', path: '/api/x' }],
        api_errors: []
      }
    ],
    platform: 'web',
    status: '已确认'
  });
  cases.push(['strict ok', strictOk.ok]);

  const cell = renderBackendApiCell([
    { method: 'GET', path: '/a', operation: '查' },
    { method: 'NONE' }
  ]);
  cases.push(['render br', cell.includes('<br>') && cell.includes('纯前端')]);

  const failed = cases.filter(([, ok]) => !ok);
  if (failed.length) {
    console.error('markdown_model self-test failed:', failed.map(([n]) => n));
    process.exit(1);
  }
  console.log('✓ markdown_model self-test');
}

module.exports = {
  ELEMENT_HEADERS_LEGACY,
  ELEMENT_HEADERS_V63,
  ELEMENT_HEADERS_V64,
  WEB_COMPARE_HEADERS_LEGACY,
  WEB_COMPARE_HEADERS_V63,
  parseMarkdownTables,
  parseWebCompareTables,
  parseElementTables,
  parseBackendApiCell,
  parsePageUrlCell,
  validateStrictWrite,
  renderBackendApiCell,
  headersEqual,
  selfTest
};

if (require.main === module) {
  if (process.argv.includes('--self-test')) selfTest();
  else selfTest();
}
