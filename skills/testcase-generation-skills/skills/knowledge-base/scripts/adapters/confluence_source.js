/**
 * Confluence 下载产物 → KbCandidateBundle
 * 只消费 pages/*.md + *_metadata.json；禁止读 chunks/embeddings/index
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { fingerprintPaths } = require('./source_fingerprint');
const { matchPrimary } = require('../../../../src/scripts/shared/module_matcher');
const { normalizePageUrl, normalizeBackendApi } = require('../lib/tech_normalize');

const FORBIDDEN_DIR_NAMES = new Set(['chunks', 'embeddings', 'index', 'state', 'validation']);

function assertAllowedRoot(pagesDir) {
  const abs = path.resolve(pagesDir);
  const parts = abs.split(path.sep).map(p => p.toLowerCase());
  for (const bad of FORBIDDEN_DIR_NAMES) {
    if (parts.includes(bad)) {
      throw new Error(`confluence_source_forbidden_path:${bad}`);
    }
  }
  if (!/pages$/i.test(path.basename(abs))) {
    throw new Error('confluence_source_expect_pages_dir');
  }
}

function listPagePairs(pagesDir) {
  const files = fs.readdirSync(pagesDir).filter(n => n.endsWith('.md') && !n.endsWith('_metadata.md'));
  return files.map(name => {
    const md = path.join(pagesDir, name);
    const meta = path.join(pagesDir, name.replace(/\.md$/, '_metadata.json'));
    return { md, meta: fs.existsSync(meta) ? meta : null, name };
  });
}

function isConfluenceUrl(url) {
  return /finkms\.|confluence|atlassian|\/download\/attachments\//i.test(url);
}

function isProductPagePath(raw) {
  if (!raw || raw.length < 4) return false;
  if (/^\/?(api|graphql|download|rest|wiki|v\d+)\b/i.test(raw)) return false;
  if (isConfluenceUrl(raw)) return false;
  if (/attachments\//i.test(raw)) return false;
  if (/\.(png|jpe?g|gif|webp|svg|pdf|zip)(\?|$)/i.test(raw)) return false;
  // 至少两段：/module/page
  if ((raw.replace(/\/+$/, '').split('/').filter(Boolean).length || 0) < 2) return false;
  return true;
}

function extractFromMarkdown(md, meta) {
  const items = [];
  let seq = 1;
  const title = (meta && meta.title) || '';
  const pageHint = (title.match(/[\u4e00-\u9fa5A-Za-z0-9]+页/) || [])[0] || '';
  const hit = matchPrimary(title);
  const module_l1 = hit ? hit.l1 : '_inbox';
  const module_l2 = hit ? hit.l2 : '_inbox';

  // API：METHOD /path
  const apiRe = /\b(GET|POST|PUT|PATCH|DELETE|WS)\s+(\/[^\s`）)]+)/gi;
  let m;
  while ((m = apiRe.exec(md))) {
    const n = normalizeBackendApi({ method: m[1], path: m[2] });
    if (!n.ok) continue;
    items.push({
      candidate_id: `C-${String(seq++).padStart(3, '0')}`,
      module_l1,
      module_l2,
      kind: 'backend_api',
      page_id: pageHint,
      platform: /APP/i.test(title) && !/PC/i.test(title) ? 'app' : 'web',
      element_name: '未命名元素',
      backend_api: n.value,
      confidence: 0.55,
      module_reason: hit ? hit.reason : 'matcher_unmatched'
    });
  }

  // 产品路由：以 / 开头；排除 API / Confluence 附件路径
  const urlRe = /`?(\/[a-zA-Z][a-zA-Z0-9_\-{}/]*)`?/g;
  while ((m = urlRe.exec(md))) {
    const raw = m[1];
    if (!isProductPagePath(raw)) continue;
    if (!pageHint.endsWith('页')) continue;
    const n = normalizePageUrl(raw);
    if (!n.ok) continue;
    items.push({
      candidate_id: `C-${String(seq++).padStart(3, '0')}`,
      module_l1,
      module_l2,
      kind: 'page_url',
      page_id: pageHint,
      platform: 'web',
      page_url: n.value,
      confidence: 0.5,
      module_reason: hit ? hit.reason : 'matcher_unmatched'
    });
  }

  // 绝对 URL：仅当不像 Confluence；规范化后仍须像产品路径
  const absRe = /https?:\/\/[^\s)`"']+/g;
  while ((m = absRe.exec(md))) {
    if (isConfluenceUrl(m[0])) continue;
    const n = normalizePageUrl(m[0]);
    if (!n.ok || !pageHint.endsWith('页')) continue;
    if (!isProductPagePath(n.value.template)) continue;
    items.push({
      candidate_id: `C-${String(seq++).padStart(3, '0')}`,
      module_l1,
      module_l2,
      kind: 'page_url',
      page_id: pageHint,
      platform: 'web',
      page_url: n.value,
      confidence: 0.45,
      module_reason: 'confluence_abs_url'
    });
  }

  return items;
}

function loadConfluenceSource(pagesDir) {
  assertAllowedRoot(pagesDir);
  const pairs = listPagePairs(pagesDir);
  if (!pairs.length) {
    return {
      schema_version: '6.3',
      source: { type: 'confluence', ref: path.resolve(pagesDir), read_at: new Date().toISOString() },
      source_fingerprint: 'sha256:empty00000000',
      source_manifest: { pages: [] },
      items: [],
      notes: ['no pages']
    };
  }

  const allFiles = [];
  for (const p of pairs) {
    allFiles.push(p.md);
    if (p.meta) allFiles.push(p.meta);
  }
  const fp = fingerprintPaths(allFiles);
  if (!fp.ok) throw new Error(fp.error);

  const pagesManifest = [];
  const items = [];
  for (const p of pairs) {
    const md = fs.readFileSync(p.md, 'utf8');
    let meta = null;
    if (p.meta) meta = JSON.parse(fs.readFileSync(p.meta, 'utf8'));
    const contentHash = crypto.createHash('sha256').update(md).digest('hex').slice(0, 16);
    pagesManifest.push({
      pageId: (meta && meta.page_id) || p.name,
      version: (meta && meta.version) || null,
      title: (meta && meta.title) || p.name,
      content_hash: contentHash,
      md: path.basename(p.md)
    });
    items.push(...extractFromMarkdown(md, meta));
  }

  // 去重（同 kind+target）
  const seen = new Set();
  const uniq = [];
  for (const it of items) {
    const key = `${it.kind}|${it.page_id}|${it.element_name || ''}|${JSON.stringify(it.page_url || it.backend_api)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(it);
  }

  return {
    schema_version: '6.3',
    source: {
      type: 'confluence',
      ref: path.resolve(pagesDir),
      read_at: new Date().toISOString()
    },
    source_fingerprint: fp.fingerprint,
    source_manifest: { pages: pagesManifest },
    items: uniq,
    notes: ['只消费 pages Markdown + metadata；未读 chunks/embeddings']
  };
}

function selfTest() {
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb63_cf_'));
  const pages = path.join(tmp, 'pages');
  fs.mkdirSync(pages);
  const md = [
    '# 销售单列表页改造',
    '',
    '前端路由 `/sales/order/list`',
    '',
    '接口 `GET /api/v1/columns`',
    '',
    '附件 https://finkms.kingdee.com/download/attachments/1/a.png 不应作为产品 URL'
  ].join('\n');
  fs.writeFileSync(path.join(pages, 'demo_1.md'), md, 'utf8');
  fs.writeFileSync(
    path.join(pages, 'demo_1_metadata.json'),
    JSON.stringify({ page_id: '1', title: '销售单列表页改造', version: 3 }),
    'utf8'
  );
  const cand = loadConfluenceSource(pages);
  const urlTemplates = cand.items.filter(i => i.kind === 'page_url').map(i => i.page_url && i.page_url.template);
  const hasUrl = urlTemplates.includes('/sales/order/list');
  const hasApi = cand.items.some(i => i.kind === 'backend_api');
  const noCf = urlTemplates.every(
    t => t && !/finkms|download\/attachments|^\/api\//i.test(t) && t === '/sales/order/list'
  );
  let forbiddenOk = false;
  try {
    loadConfluenceSource(path.join(tmp, 'chunks'));
  } catch (e) {
    forbiddenOk = /forbidden|expect_pages/.test(String(e.message));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!(hasUrl && hasApi && noCf && forbiddenOk)) {
    console.error('confluence_source self-test failed', {
      hasUrl,
      hasApi,
      noCf,
      forbiddenOk,
      urlTemplates,
      items: cand.items
    });
    process.exit(1);
  }
  console.log('✓ confluence_source self-test');
}

module.exports = { loadConfluenceSource, selfTest };
if (require.main === module) selfTest();
