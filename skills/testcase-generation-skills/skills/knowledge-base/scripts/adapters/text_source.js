/**
 * 自然语言 / 结构化文本 → KbCandidateBundle
 * 支持：直接 JSON candidate；或简易「模块/页面/URL/API」行协议
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const { matchPrimary } = require('../../../../src/scripts/shared/module_matcher');
const { normalizePageUrl, normalizeBackendApi } = require('../lib/tech_normalize');

function fingerprint(content) {
  return `sha256:${crypto.createHash('sha256').update(String(content)).digest('hex').slice(0, 16)}`;
}

function parseLineProtocol(text) {
  const items = [];
  let seq = 1;
  let moduleL1 = '';
  let moduleL2 = '';
  let pageId = '';
  let platform = 'web';

  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const mMod = line.match(/^模块[：:]\s*(.+?)(?:\s*[\/|]\s*(.+))?$/);
    if (mMod) {
      moduleL1 = mMod[1].trim();
      moduleL2 = (mMod[2] || mMod[1]).trim();
      continue;
    }
    const mPage = line.match(/^页面[：:]\s*(.+)$/);
    if (mPage) {
      pageId = mPage[1].trim();
      continue;
    }
    const mPlat = line.match(/^端[：:]\s*(web|app|电脑|PC|APP)$/i);
    if (mPlat) {
      const v = mPlat[1].toLowerCase();
      platform = v === 'app' || v === 'app' ? 'app' : v.startsWith('a') ? 'app' : 'web';
      if (/app/i.test(mPlat[1])) platform = 'app';
      else platform = 'web';
      continue;
    }
    const mUrl = line.match(/^URL[：:]\s*(.+)$/i);
    if (mUrl) {
      const n = normalizePageUrl(mUrl[1]);
      if (n.ok) {
        items.push({
          candidate_id: `C-${String(seq++).padStart(3, '0')}`,
          module_l1: moduleL1,
          module_l2: moduleL2,
          kind: 'page_url',
          page_id: pageId,
          platform: 'web',
          page_url: n.value
        });
      }
      continue;
    }
    const mApi = line.match(/^API[：:]\s*(\S+)\s+(\S+)(?:\s+(.+))?$/i);
    if (mApi) {
      const n = normalizeBackendApi({ method: mApi[1], path: mApi[2], operation: mApi[3] || '' });
      const el = line.match(/元素[：:]\s*([^\s]+)/);
      // 支持 "API: GET /path 元素:表头.设置 查询"
      const elMatch = String(raw).match(/元素[：:]\s*([^\s]+)/);
      if (n.ok) {
        items.push({
          candidate_id: `C-${String(seq++).padStart(3, '0')}`,
          module_l1: moduleL1,
          module_l2: moduleL2,
          kind: 'backend_api',
          page_id: pageId,
          platform,
          element_name: elMatch ? elMatch[1] : '未命名元素',
          backend_api: n.value
        });
      }
      continue;
    }
    const mEl = line.match(/^元素[：:]\s*(.+)$/);
    if (mEl && !/^API/i.test(line)) {
      items.push({
        candidate_id: `C-${String(seq++).padStart(3, '0')}`,
        module_l1: moduleL1,
        module_l2: moduleL2,
        kind: 'page_element',
        page_id: pageId,
        platform,
        element: { name: mEl[1].trim() }
      });
    }
  }

  // 模块未填时尝试 matcher
  for (const it of items) {
    if (!it.module_l1 || !it.module_l2) {
      const hit = matchPrimary(`${it.page_id || ''} ${it.element_name || ''} ${(it.element && it.element.name) || ''}`);
      if (hit) {
        it.module_l1 = it.module_l1 || hit.l1;
        it.module_l2 = it.module_l2 || hit.l2;
        it.module_reason = hit.reason;
      } else {
        it.module_l1 = it.module_l1 || '_inbox';
        it.module_l2 = it.module_l2 || '_inbox';
        it.module_reason = 'matcher_unmatched';
      }
    }
  }
  return items;
}

function loadTextSource(inputPathOrText, opts = {}) {
  const isPath = opts.asPath !== false && fs.existsSync(inputPathOrText);
  const content = isPath ? fs.readFileSync(inputPathOrText, 'utf8') : String(inputPathOrText || '');
  const ref = isPath ? inputPathOrText : opts.ref || 'inline://text';
  let items;
  const trimmed = content.trim();
  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    if (parsed.items) {
      return {
        schema_version: '6.3',
        source: { type: 'text', ref, read_at: new Date().toISOString() },
        source_fingerprint: fingerprint(content),
        items: parsed.items
      };
    }
  }
  items = parseLineProtocol(content);
  return {
    schema_version: '6.3',
    source: { type: 'text', ref, read_at: new Date().toISOString() },
    source_fingerprint: fingerprint(content),
    items
  };
}

module.exports = { loadTextSource, parseLineProtocol, fingerprint };
