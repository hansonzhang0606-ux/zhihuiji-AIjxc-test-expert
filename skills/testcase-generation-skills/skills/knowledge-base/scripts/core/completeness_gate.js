'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parseMarkdownTables, parseWebCompareTables, parseElementTables } = require('./markdown_model');

function hashReport(report) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex')}`;
}

function relationModel(kbRoot, l1, l2) {
  const file = path.join(kbRoot, l1 || '', l2 || '', '页面关系.md');
  if (!fs.existsSync(file)) return { pages: [], relations: [], urls: [] };
  const text = fs.readFileSync(file, 'utf8');
  const tables = parseMarkdownTables(text);
  const pages = [];
  const relations = [];
  let platform = null;
  for (const table of tables) {
    if (/电脑端|^###\s*2\./.test(table.heading)) platform = 'web';
    if (/APP端|^###\s*3\./.test(table.heading)) platform = 'app';
    if (table.header.join('|') === '统一页面名称|角色|支持端|一句话说明') {
      for (const row of table.rows) {
        pages.push({
          page_id: row.cells[0], role: row.cells[1], support: row.cells[2], statement: row.cells[3]
        });
      }
    }
    if (table.header.join('|') === '起点|动作|终点') {
      for (const row of table.rows) {
        relations.push({ platform, from_page: row.cells[0], action: row.cells[1], to_page: row.cells[2] });
      }
    }
  }
  return { pages, relations, urls: parseWebCompareTables(text).rows };
}

function existingElement(kbRoot, item) {
  for (const prefix of ['主页面_', '子页面_']) {
    const file = path.join(kbRoot, item.module_l1 || '', item.module_l2 || '', `${prefix}${item.page_id}.md`);
    if (!fs.existsSync(file)) continue;
    const parsed = parseElementTables(fs.readFileSync(file, 'utf8'));
    const group = parsed.platforms.find(p => p.platform === (item.platform || 'web'));
    const name = item.element_name || (item.element && item.element.name);
    const found = group && group.elements.find(e => e.name === name);
    if (found) return found;
  }
  return null;
}

function candidateFromChanges(changeset) {
  return {
    source: { type: 'text' },
    source_fingerprint: changeset.source_fingerprint,
    items: (changeset.changes || []).map(ch => ({
      candidate_id: ch.source_ref || ch.change_id,
      module_l1: ch.module_l1,
      module_l2: ch.module_l2,
      kind: ch.kind || (ch.after && ch.after.method ? 'backend_api' : ch.after && ch.after.template ? 'page_url' : ''),
      page_id: ch.page_id,
      page_role: ch.page_role,
      platform: ch.platform,
      element_name: ch.element_name,
      relation: ch.relation || (ch.kind === 'page_relation' ? ch.after : undefined),
      element: ch.kind === 'page_element' ? ch.after : undefined,
      statement: ch.kind === 'supplement' ? ch.after : undefined,
      page_url: ch.kind === 'page_url' ? ch.after : undefined,
      backend_api: ch.kind === 'backend_api' ? ch.after : undefined
    }))
  };
}

function evaluateCompleteness({ candidate, changeset, kbRoot }) {
  const bundle = candidate || candidateFromChanges(changeset || { changes: [] });
  const extracted = { pages: [], relations: [], elements: [], supplements: [] };
  const blocking_gaps = [];
  const warning_gaps = [];
  const pageCache = new Map();
  const gap = (list, ref, field, platform, reason) => {
    const value = { ref: String(ref || '?'), field, reason };
    if (platform === 'web' || platform === 'app') value.platform = platform;
    list.push(value);
  };
  const modelFor = item => {
    const key = `${item.module_l1}/${item.module_l2}`;
    if (!pageCache.has(key)) pageCache.set(key, relationModel(kbRoot, item.module_l1, item.module_l2));
    return pageCache.get(key);
  };

  for (const item of bundle.items || []) {
    const ref = item.candidate_id || '?';
    const platform = item.platform || 'web';
    const model = modelFor(item);
    if (item.kind === 'page' || item.kind === 'page_url') {
      const current = model.pages.find(p => p.page_id === item.page_id) || {};
      const fields = {
        page_id: item.page_id,
        role: item.page_role || current.role,
        support: current.support || (item.platform ? item.platform : ''),
        statement: item.statement || current.statement,
        url: item.page_url ||
          ((bundle.items || []).find(other => other.kind === 'page_url' &&
            other.module_l1 === item.module_l1 && other.module_l2 === item.module_l2 &&
            other.page_id === item.page_id && (other.platform || 'web') === platform) || {}).page_url ||
          (model.urls.find(u => u.page_id === item.page_id) || {}).urls
      };
      extracted.pages.push({ kind: 'page', page_id: item.page_id, platform, fields_present: Object.keys(fields).filter(k => fields[k] && (!Array.isArray(fields[k]) || fields[k].length)) });
      for (const name of ['page_id', 'role', 'support']) if (!fields[name]) gap(blocking_gaps, ref, name, platform, 'page_required');
      // 显式 page_url 变更缺 URL 仍阻塞；业务规则 page 登记缺 URL 仅告警（由技术引用通道另补）
      if (platform === 'web' && !fields.url) {
        if (item.kind === 'page_url') gap(blocking_gaps, ref, 'page_url', platform, 'web_page_requires_url');
        else gap(warning_gaps, ref, 'page_url', platform, 'web_page_url_recommended');
      }
      if (!fields.statement) gap(warning_gaps, ref, 'statement', platform, 'page_summary_recommended');
    } else if (item.kind === 'page_relation') {
      const r = item.relation || {};
      extracted.relations.push({ kind: 'page_relation', from_page: r.from || r.from_page, action: r.action, to_page: r.to || r.to_page, platform, fields_present: ['from_page', 'action', 'to_page', 'platform'].filter(k => ({ from_page: r.from || r.from_page, action: r.action, to_page: r.to || r.to_page, platform })[k]) });
      for (const [name, value] of [['from_page', r.from || r.from_page], ['action', r.action], ['to_page', r.to || r.to_page]]) {
        if (!value) gap(blocking_gaps, ref, name, platform, 'relation_triple_required');
      }
    } else if (item.kind === 'page_element' || item.kind === 'backend_api') {
      const existing = existingElement(kbRoot, item) || {};
      const el = item.element || {};
      const siblingApis = (bundle.items || []).filter(other => other.kind === 'backend_api' &&
        other.module_l1 === item.module_l1 && other.module_l2 === item.module_l2 &&
        other.page_id === item.page_id && other.element_name === (item.element_name || el.name) &&
        (other.platform || 'web') === platform).map(other => other.backend_api).filter(Boolean);
      const apis = item.backend_api ? [item.backend_api]
        : (el.backend_apis || siblingApis.length && siblingApis || existing.backend_apis || []);
      const values = {
        name: item.element_name || el.name || existing.name,
        interaction: el.interaction || existing.interaction,
        result: el.result || existing.result,
        backend_api: apis.length ? apis : null,
        position: el.position || existing.position,
        input_options: el.input_options || existing.input_options
      };
      extracted.elements.push({ kind: 'page_element', page_id: item.page_id, name: values.name, platform, fields_present: Object.keys(values).filter(k => values[k]) });
      for (const name of ['name', 'interaction', 'result']) if (!values[name]) gap(blocking_gaps, ref, name, platform, 'element_required');
      if (!values.backend_api) gap(warning_gaps, ref, 'backend_api', platform, 'element_api_recommended');
      for (const name of ['position', 'input_options']) if (!values[name]) gap(warning_gaps, ref, name, platform, 'element_detail_recommended');
    } else if (item.kind === 'supplement') {
      extracted.supplements.push({ kind: 'supplement', page_id: item.page_id, platform, fields_present: item.statement ? ['statement'] : [] });
      if (!item.statement) gap(blocking_gaps, ref, 'statement', platform, 'stable_rule_required');
    }
  }

  const report = {
    schema_version: '6.4',
    source_type: (bundle.source && bundle.source.type) || 'text',
    source_hash: bundle.source_fingerprint || 'unknown-source',
    p0_case_ids: [...new Set((bundle.items || []).map(i => i.case_id).filter(id => /^TC-\d{3,}$/.test(id || '')))],
    extracted,
    blocking_gaps,
    warning_gaps,
    blocked_write: blocking_gaps.length > 0,
    next_action: blocking_gaps.length ? 'human_fill_then_reoverview' : 'prepare_review'
  };
  return { report, report_hash: hashReport(report) };
}

module.exports = { evaluateCompleteness, hashReport, candidateFromChanges };
