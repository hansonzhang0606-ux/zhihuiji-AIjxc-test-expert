/**
 * 候选 → ChangeSet（对账骨架）
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parseMarkdownTables, parseWebCompareTables, parseElementTables } = require('./markdown_model');

function hashObj(obj) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16)}`;
}

function pageFileName(pageId, role) {
  const prefix = role === '主页面' ? '主页面_' : '子页面_';
  return `${prefix}${pageId}.md`;
}

function readExistingPageUrl(kbRoot, l1, l2, pageId) {
  const rel = path.join(l1, l2, '页面关系.md');
  const file = path.join(kbRoot, rel);
  if (!fs.existsSync(file)) return { exists: false, urls: [], target_ref: rel.replace(/\\/g, '/') };
  const parsed = parseWebCompareTables(fs.readFileSync(file, 'utf8'));
  const row = parsed.rows.find(r => r.page_id === pageId);
  return {
    exists: true,
    urls: row ? row.urls : [],
    target_ref: rel.replace(/\\/g, '/'),
    row
  };
}

function readExistingElementApis(kbRoot, l1, l2, pageId, platform, elementName) {
  for (const prefix of ['主页面_', '子页面_']) {
    const rel = path.join(l1, l2, `${prefix}${pageId}.md`).replace(/\\/g, '/');
    const file = path.join(kbRoot, rel);
    if (!fs.existsSync(file)) continue;
    const parsed = parseElementTables(fs.readFileSync(file, 'utf8'));
    const plat = parsed.platforms.find(p => p.platform === platform);
    const el = plat && plat.elements.find(e => e.name === elementName);
    return {
      exists: !!el,
      apis: el ? el.backend_apis : [],
      target_ref: rel,
      element: el
    };
  }
  return {
    exists: false,
    apis: [],
    target_ref: path.join(l1, l2, pageFileName(pageId, '主页面')).replace(/\\/g, '/')
  };
}

function readRelationModel(kbRoot, l1, l2) {
  const rel = path.join(l1, l2, '页面关系.md').replace(/\\/g, '/');
  const file = path.join(kbRoot, rel);
  const out = { target_ref: rel, pages: [], relations: [] };
  if (!fs.existsSync(file)) return out;
  const tables = parseMarkdownTables(fs.readFileSync(file, 'utf8'));
  let platform = null;
  for (const table of tables) {
    if (/电脑端|^###\s*2\./.test(table.heading)) platform = 'web';
    if (/APP端|^###\s*3\./.test(table.heading)) platform = 'app';
    if (table.header.join('|') === '统一页面名称|角色|支持端|一句话说明') {
      for (const row of table.rows) out.pages.push({
        page_id: row.cells[0], page_role: row.cells[1], support: row.cells[2], statement: row.cells[3]
      });
    }
    if (table.header.join('|') === '起点|动作|终点') {
      for (const row of table.rows) out.relations.push({
        platform, from: row.cells[0], action: row.cells[1], to: row.cells[2]
      });
    }
  }
  return out;
}

function readExistingElement(kbRoot, l1, l2, pageId, platform, elementName) {
  const found = readExistingElementApis(kbRoot, l1, l2, pageId, platform, elementName);
  return { ...found, element: found.element || null };
}

function buildChangeSet(candidate, opts = {}) {
  const kbRoot = opts.kbRoot;
  const baseCommit = opts.baseCommit || 'local:unknown';
  const overviewId = opts.overviewId || `ov-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
  const changes = [];
  const skipped = [];
  const conflicts = [];
  let n = 1;

  for (const item of candidate.items || []) {
    if (!item.module_l1 || item.module_l1 === '_inbox') {
      skipped.push({
        reason: 'module_unresolved',
        summary: `无法唯一归属模块: ${item.candidate_id}`,
        source_ref: item.candidate_id
      });
      continue;
    }

    if (item.kind === 'page') {
      const cur = readRelationModel(kbRoot, item.module_l1, item.module_l2);
      const before = cur.pages.find(p => p.page_id === item.page_id) || null;
      const after = {
        page_id: item.page_id,
        page_role: item.page_role || '子页面',
        support: item.platform || 'web',
        statement: item.statement || ''
      };
      if (before && before.page_role === after.page_role && before.support.includes(after.support) &&
          (!after.statement || before.statement === after.statement)) {
        skipped.push({ reason: 'unchanged', summary: `页面未变化 ${item.page_id}`, source_ref: item.candidate_id });
        continue;
      }
      const conflict = before && before.page_role !== after.page_role;
      const change_id = `CH-${String(n++).padStart(3, '0')}`;
      if (conflict) conflicts.push({ change_id, old_summary: before.page_role, new_summary: after.page_role, reason_tag: 'page_role_change' });
      changes.push({
        change_id, kind: 'page', operation: before ? 'update' : 'add',
        module_l1: item.module_l1, module_l2: item.module_l2, page_id: item.page_id,
        page_role: after.page_role, platform: item.platform || 'web', target_ref: cur.target_ref,
        summary: `${before ? '更新' : '补充'}页面 ${item.page_id}`.slice(0, 80),
        before, after, conflict_kind: conflict ? 'semantic_conflict' : 'none',
        source_ref: item.candidate_id, selected: !conflict
      });
      continue;
    }

    if (item.kind === 'page_relation') {
      const r = item.relation || {};
      const after = { from: r.from || r.from_page, action: r.action, to: r.to || r.to_page };
      const cur = readRelationModel(kbRoot, item.module_l1, item.module_l2);
      const before = cur.relations.find(x => x.platform === (item.platform || 'web') &&
        x.from === after.from && x.action === after.action && x.to === after.to);
      if (before) {
        skipped.push({ reason: 'unchanged', summary: `页面关系未变化 ${after.from}→${after.to}`, source_ref: item.candidate_id });
        continue;
      }
      const competing = cur.relations.find(x => x.platform === (item.platform || 'web') &&
        x.from === after.from && x.action === after.action && x.to !== after.to);
      const change_id = `CH-${String(n++).padStart(3, '0')}`;
      if (competing) {
        conflicts.push({
          change_id,
          old_summary: `${competing.from} --${competing.action}→ ${competing.to}`,
          new_summary: `${after.from} --${after.action}→ ${after.to}`,
          reason_tag: 'relation_target_conflict'
        });
      }
      changes.push({
        change_id, kind: 'page_relation', operation: 'relation_change',
        module_l1: item.module_l1, module_l2: item.module_l2, page_id: after.to,
        platform: item.platform || 'web', target_ref: cur.target_ref,
        relation: after, summary: `补充页面关系 ${after.from}→${after.to}`.slice(0, 80),
        before: competing || null, after,
        conflict_kind: competing ? 'semantic_conflict' : 'none',
        source_ref: item.candidate_id, selected: !competing
      });
      continue;
    }

    if (item.kind === 'page_element' && item.element) {
      const after = { ...item.element, name: item.element_name || item.element.name };
      const cur = readExistingElement(kbRoot, item.module_l1, item.module_l2, item.page_id, item.platform || 'web', after.name);
      if (!cur.exists) {
        const siblingPage = (candidate.items || []).find(other => other.kind === 'page' &&
          other.module_l1 === item.module_l1 && other.module_l2 === item.module_l2 &&
          other.page_id === item.page_id);
        if (siblingPage) {
          cur.target_ref = path.join(
            item.module_l1,
            item.module_l2,
            pageFileName(item.page_id, siblingPage.page_role === '主页面' ? '主页面' : '子页面')
          ).replace(/\\/g, '/');
        }
      }
      const before = cur.element;
      if (before && before.interaction === after.interaction && before.result === after.result) {
        skipped.push({ reason: 'unchanged', summary: `元素未变化 ${after.name}`, source_ref: item.candidate_id });
        continue;
      }
      const conflict = before && (before.interaction !== after.interaction || before.result !== after.result);
      const change_id = `CH-${String(n++).padStart(3, '0')}`;
      if (conflict) conflicts.push({ change_id, old_summary: `${before.interaction}|${before.result}`, new_summary: `${after.interaction}|${after.result}`, reason_tag: 'element_replace' });
      changes.push({
        change_id, kind: 'page_element', operation: before ? 'update' : 'add',
        module_l1: item.module_l1, module_l2: item.module_l2, page_id: item.page_id,
        page_role: item.page_role || '子页面',
        platform: item.platform || 'web', element_name: after.name, target_ref: cur.target_ref,
        summary: `${before ? '更新' : '补充'}元素 ${after.name}`.slice(0, 80),
        before, after, conflict_kind: conflict ? 'semantic_conflict' : 'none',
        source_ref: item.candidate_id, selected: !conflict
      });
      continue;
    }

    if (item.kind === 'supplement') {
      const target_ref = path.join(item.module_l1, item.module_l2, pageFileName(item.page_id, item.page_role || '子页面')).replace(/\\/g, '/');
      const file = path.join(kbRoot, target_ref);
      const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (content.includes(item.statement)) {
        skipped.push({ reason: 'unchanged', summary: `补充规则已存在 ${item.statement}`, source_ref: item.candidate_id });
        continue;
      }
      changes.push({
        change_id: `CH-${String(n++).padStart(3, '0')}`, kind: 'supplement', operation: 'add',
        module_l1: item.module_l1, module_l2: item.module_l2, page_id: item.page_id,
        page_role: item.page_role || '子页面',
        platform: item.platform || 'web', target_ref,
        category: item.element_category || '',
        summary: `补充稳定规则 ${item.page_id}`.slice(0, 80),
        before: null, after: item.statement, conflict_kind: 'none', source_ref: item.candidate_id, selected: true
      });
      continue;
    }

    if (item.kind === 'page_url') {
      const cur = readExistingPageUrl(kbRoot, item.module_l1, item.module_l2, item.page_id);
      const after = item.page_url;
      const before = cur.urls[0] || null;
      let operation = 'add';
      let conflict_kind = 'none';
      if (before && before.template === after.template) {
        skipped.push({ reason: 'unchanged', summary: `URL 未变化 ${item.page_id}`, source_ref: item.candidate_id });
        continue;
      }
      if (before && before.template !== after.template) {
        operation = 'update';
        conflict_kind = 'strengthen';
        conflicts.push({
          change_id: `CH-${String(n).padStart(3, '0')}`,
          old_summary: before.template,
          new_summary: after.template,
          reason_tag: 'url_replace'
        });
      }
      const change_id = `CH-${String(n++).padStart(3, '0')}`;
      changes.push({
        change_id,
        kind: 'page_url',
        operation,
        module_l1: item.module_l1,
        module_l2: item.module_l2,
        page_id: item.page_id,
        platform: 'web',
        target_ref: cur.target_ref,
        summary: `${operation === 'add' ? '补充' : '更新'} ${item.page_id} Web URL`.slice(0, 80),
        before,
        after,
        conflict_kind,
        source_ref: item.candidate_id,
        selected: true
      });
      continue;
    }

    if (item.kind === 'backend_api') {
      const elName = item.element_name || (item.element && item.element.name);
      const apis = item.backend_api
        ? [item.backend_api]
        : (item.element && item.element.backend_apis) || [];
      if (!elName || !apis.length) {
        skipped.push({ reason: 'incomplete_api', summary: `缺元素或接口 ${item.candidate_id}`, source_ref: item.candidate_id });
        continue;
      }
      const cur = readExistingElementApis(
        kbRoot,
        item.module_l1,
        item.module_l2,
        item.page_id,
        item.platform || 'web',
        elName
      );
      if (!cur.exists) {
        const siblingPage = (candidate.items || []).find(other => other.kind === 'page' &&
          other.module_l1 === item.module_l1 && other.module_l2 === item.module_l2 &&
          other.page_id === item.page_id);
        if (siblingPage) {
          cur.target_ref = path.join(
            item.module_l1,
            item.module_l2,
            pageFileName(item.page_id, siblingPage.page_role === '主页面' ? '主页面' : '子页面')
          ).replace(/\\/g, '/');
        }
      }
      const after = apis[0];
      const before = cur.apis[0] || null;
      let operation = cur.exists ? 'update' : 'add';
      let conflict_kind = 'none';
      if (before && before.method === after.method && before.path === after.path) {
        skipped.push({ reason: 'unchanged', summary: `API 未变化 ${elName}`, source_ref: item.candidate_id });
        continue;
      }
      if (before && (before.method !== after.method || before.path !== after.path)) {
        conflict_kind = 'semantic_conflict';
        conflicts.push({
          change_id: `CH-${String(n).padStart(3, '0')}`,
          old_summary: `${before.method} ${before.path}`,
          new_summary: `${after.method} ${after.path}`,
          reason_tag: 'api_replace'
        });
      }
      const change_id = `CH-${String(n++).padStart(3, '0')}`;
      changes.push({
        change_id,
        kind: 'backend_api',
        operation,
        module_l1: item.module_l1,
        module_l2: item.module_l2,
        page_id: item.page_id,
        platform: item.platform || 'web',
        element_name: elName,
        target_ref: cur.target_ref,
        summary: `${operation === 'add' ? '补充' : '更新'} ${elName} 接口`.slice(0, 80),
        before,
        after,
        conflict_kind,
        source_ref: item.candidate_id,
        api_rich: (Array.isArray(item.assertions) && item.assertions.length > 0) || item.assertion_count > 0,
        selected: conflict_kind === 'semantic_conflict' ? false : true
      });
      continue;
    }

    skipped.push({
      reason: 'unsupported_kind',
      summary: `暂未支持 kind=${item.kind}`,
      source_ref: item.candidate_id
    });
  }

  const body = {
    schema_version: '6.3',
    overview_id: overviewId,
    source_fingerprint: candidate.source_fingerprint,
    base_commit: baseCommit,
    created_at: new Date().toISOString(),
    changes,
    skipped
  };
  body.changeset_hash = hashObj({
    overview_id: body.overview_id,
    source_fingerprint: body.source_fingerprint,
    base_commit: body.base_commit,
    changes: body.changes
  });

  return { changeset: body, conflicts };
}

function buildOverview(candidate, changeset, conflicts, opts = {}) {
  const modulesMap = new Map();
  for (const ch of changeset.changes) {
    const key = `${ch.module_l1}/${ch.module_l2}`;
    if (!modulesMap.has(key)) {
      modulesMap.set(key, { module_l1: ch.module_l1, module_l2: ch.module_l2, pages: [] });
    }
    const m = modulesMap.get(key);
    if (ch.page_id && !m.pages.includes(ch.page_id)) m.pages.push(ch.page_id);
  }
  const overview = {
    schema_version: '6.3',
    overview_id: changeset.overview_id,
    source: candidate.source,
    source_fingerprint: changeset.source_fingerprint,
    base_commit: changeset.base_commit,
    changeset_hash: changeset.changeset_hash,
    created_at: changeset.created_at,
    degrade_mode: opts.degradeMode || null,
    modules: [...modulesMap.values()],
    items: changeset.changes.map(ch => ({
      change_id: ch.change_id,
      operation: ch.operation,
      module_l1: ch.module_l1,
      module_l2: ch.module_l2,
      page_id: ch.page_id,
      element_name: ch.element_name,
      platform: ch.platform,
      summary: ch.summary,
      api_rich: !!ch.api_rich,
      selected: ch.selected
    })),
    conflicts: conflicts || [],
    skipped: changeset.skipped || []
  };
  if (candidate.source_manifest) overview.source_manifest = candidate.source_manifest;
  if (candidate.source_manifest_path) overview.source_manifest_path = candidate.source_manifest_path;
  if (candidate.source_manifest_fingerprint) overview.source_manifest_fingerprint = candidate.source_manifest_fingerprint;
  return overview;
}

module.exports = { buildChangeSet, buildOverview, hashObj };
