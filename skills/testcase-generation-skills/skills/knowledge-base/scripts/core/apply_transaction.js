/**
 * 原子写盘：失败回滚到 apply 前快照（文件级，非 git reset）
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { renderBackendApiCell } = require('./markdown_model');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFileSafe(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

/**
 * Resolve target_ref under kbRoot; reject absolute paths and `..` escapes.
 */
function resolveTarget(kbRoot, targetRef) {
  if (!targetRef || typeof targetRef !== 'string' || targetRef.includes('\0')) {
    throw new Error(`invalid_target_ref: ${targetRef}`);
  }
  const posix = targetRef.replace(/\\/g, '/');
  if (
    path.isAbsolute(targetRef) ||
    path.win32.isAbsolute(targetRef) ||
    posix.startsWith('/') ||
    /^[a-zA-Z]:/.test(posix)
  ) {
    throw new Error(`path_escape: absolute target_ref ${targetRef}`);
  }
  if (posix.split('/').includes('..')) {
    throw new Error(`path_escape: ${targetRef}`);
  }
  const root = path.resolve(kbRoot);
  const abs = path.resolve(root, targetRef);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`path_escape: ${targetRef}`);
  }
  return { abs, rel: rel.replace(/\\/g, '/') };
}

function snapshotPaths(kbRoot, paths) {
  const snapRoot = path.join(os.tmpdir(), `kb_apply_snap_${Date.now()}`);
  ensureDir(snapRoot);
  const snaps = [];
  for (const rel of paths) {
    const { abs, rel: safeRel } = resolveTarget(kbRoot, rel);
    const had = fs.existsSync(abs);
    const snap = path.join(snapRoot, safeRel);
    if (had) copyFileSafe(abs, snap);
    snaps.push({ rel: safeRel, had, snap });
  }
  return { snapRoot, snaps };
}

function rollback(kbRoot, snaps) {
  for (const s of snaps) {
    const { abs } = resolveTarget(kbRoot, s.rel);
    if (s.had) copyFileSafe(s.snap, abs);
    else if (fs.existsSync(abs)) fs.unlinkSync(abs);
  }
}

function isTableSeparator(cells) {
  return cells.length > 0 && cells.every(v => /^:?-+:?$/.test(v));
}

function upsertWebUrl(content, pageId, template) {
  // 若已有对照表行则更新；缺失时向 Web 对照表追加正式行（禁止 silent HTML comment no-op）
  const lines = content.split(/\r?\n/);
  let inWebCompare = false;
  let headerCols = 0;
  let headerLine = -1;
  let lastDataRow = -1;
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('## 3. APP') || t === '## APP端' || t.startsWith('## APP端')) {
      inWebCompare = false;
    }
    if (/本端页面名/.test(t) && /URL/.test(t)) {
      inWebCompare = true;
      continue;
    }
    if (/本端页面名（对照）/.test(t)) {
      inWebCompare = true;
      continue;
    }
    if (inWebCompare && t.startsWith('|')) {
      const cells = t.split('|').slice(1, -1).map(c => c.trim());
      if (cells[0] === '统一页面名称') {
        headerLine = i;
        headerCols = cells.length;
        if (headerCols === 2) {
          lines[i] = '| 统一页面名称 | 本端页面名 | 前端 URL 模板 |';
          if (i + 1 < lines.length && /^\|[-:\s|]+\|$/.test(lines[i + 1].trim())) {
            lines[i + 1] = '|--------------|------------|---------------|';
          }
          headerCols = 3;
        }
        continue;
      }
      if (isTableSeparator(cells)) continue;
      lastDataRow = i;
      if (cells[0] === pageId) {
        const local = cells[1] || pageId;
        lines[i] = `| ${pageId} | ${local} | \`${template}\` |`;
        changed = true;
        break;
      }
    }
    if (inWebCompare && /^#{1,3}\s/.test(t)) inWebCompare = false;
  }
  if (!changed) {
    const newRow = `| ${pageId} | ${pageId} | \`${template}\` |`;
    if (lastDataRow >= 0) {
      if (headerLine >= 0) {
        lines[headerLine] = '| 统一页面名称 | 本端页面名 | 前端 URL 模板 |';
        if (headerLine + 1 < lines.length && /^\|[-:\s|]+\|$/.test(lines[headerLine + 1].trim())) {
          lines[headerLine + 1] = '|--------------|------------|---------------|';
        }
      }
      lines.splice(lastDataRow + 1, 0, newRow);
    } else {
      const block = [
        '',
        '### 2.1 本端页面名与 URL（对照）',
        '',
        '| 统一页面名称 | 本端页面名 | 前端 URL 模板 |',
        '|--------------|------------|---------------|',
        newRow,
        ''
      ];
      const appIdx = lines.findIndex(line => /^##\s*(?:3\.\s*)?APP/.test(line.trim()));
      if (appIdx >= 0) lines.splice(appIdx, 0, ...block);
      else lines.push(...block);
    }
  }
  return lines.join('\n').replace(/\n<!-- KB_REVIEW_PENDING -->[\s\S]*$/m, '\n');
}

function upsertElementApi(content, elementName, api) {
  const lines = content.split(/\r?\n/);
  let inElements = false;
  let header = null;
  let apiIdx = -1;
  let downstreamIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '### 核心元素') {
      inElements = true;
      header = null;
      continue;
    }
    if (inElements && /^#{1,3}\s/.test(t)) {
      inElements = false;
      continue;
    }
    if (!inElements || !t.startsWith('|')) continue;
    const cells = t.split('|').slice(1, -1).map(c => c.trim());
    if (!header) {
      header = cells;
      apiIdx = header.indexOf('后端接口');
      downstreamIdx = header.indexOf('下游影响说明');
      if (apiIdx < 0) {
        // 升级为 7 列
        lines[i] =
          '| 元素 | 位置 | 输入/选项 | 交互 | 交互结果 | 后端接口 | 下游影响说明 |';
        if (i + 1 < lines.length && /^\|[-:\s|]+\|$/.test(lines[i + 1].trim())) {
          lines[i + 1] = '|------|------|-----------|------|----------|----------|--------------|';
        }
        header = ['元素', '位置', '输入/选项', '交互', '交互结果', '后端接口', '下游影响说明'];
        apiIdx = 5;
        downstreamIdx = 6;
      }
      continue;
    }
    if (cells.every(v => /^:?-+:?$/.test(v))) continue;
    if (cells[0] === elementName) {
      while (cells.length < 7) cells.push(cells[5] || '—');
      // legacy 6 col: [0..5] where 5 is downstream
      if (apiIdx === 5 && cells.length === 6) {
        const downstream = cells[5];
        cells[5] = renderBackendApiCell([api]);
        cells[6] = downstream;
      } else {
        cells[apiIdx] = renderBackendApiCell([api]);
      }
      lines[i] = `| ${cells.join(' | ')} |`;
      break;
    }
  }
  return lines.join('\n').replace(/\n<!-- KB_REVIEW_PENDING -->[\s\S]*$/m, '\n');
}

function appendRowToTable(content, headerText, row, sectionPattern) {
  const lines = String(content || '').split(/\r?\n/);
  let sectionOk = !sectionPattern;
  let header = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s/.test(lines[i].trim())) sectionOk = !sectionPattern || sectionPattern.test(lines[i].trim());
    if (sectionOk && lines[i].split('|').slice(1, -1).map(c => c.trim()).join('|') === headerText) {
      header = i;
      break;
    }
  }
  if (header < 0) return null;
  let end = header + 2;
  while (end < lines.length && lines[end].trim().startsWith('|')) end++;
  lines.splice(end, 0, `| ${row.join(' | ')} |`);
  return lines.join('\n');
}

function upsertPage(content, page) {
  const header = '统一页面名称|角色|支持端|一句话说明';
  const lines = String(content || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split('|').slice(1, -1).map(c => c.trim());
    if (cells.length === 4 && cells[0] === page.page_id) {
      const support = [...new Set(`${cells[2]}+${page.support}`.split('+').filter(Boolean))].join('+');
      lines[i] = `| ${page.page_id} | ${page.page_role || cells[1]} | ${support} | ${page.statement || cells[3]} |`;
      return lines.join('\n');
    }
  }
  return appendRowToTable(content, header, [page.page_id, page.page_role, page.support, page.statement || '—']) || content;
}

function upsertRelation(content, platform, relation) {
  const section = platform === 'app' ? /^##\s*(?:3\.\s*)?APP端/ : /^##\s*(?:2\.\s*)?电脑端/;
  const key = `| ${relation.from} | ${relation.action} | ${relation.to} |`;
  if (String(content).split(/\r?\n/).some(line => line.trim() === key)) return content;
  return appendRowToTable(content, '起点|动作|终点', [relation.from, relation.action, relation.to], section) || content;
}

function emptyPageFile(ch) {
  const label = ch.platform === 'app' ? 'APP端' : '电脑端';
  return `---\n页面标识: ${ch.page_id}\n页面角色: ${ch.page_role || '子页面'}\n状态: 已确认\n一级模块: ${ch.module_l1}\n二级模块: ${ch.module_l2}\n---\n\n# ${ch.page_role || '子页面'}：${ch.page_id}\n\n## ${label}\n\n### 核心元素\n\n| 元素 | 位置 | 输入/选项 | 展示内容 | 交互 | 交互结果 | 后端接口 | 下游影响说明 |\n|------|------|-----------|----------|------|----------|----------|--------------|\n`;
}

function upsertElement(content, element) {
  const lines = String(content || '').split(/\r?\n/);
  let header = null;
  let headerIndex = -1;
  let displayIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split('|').slice(1, -1).map(c => c.trim());
    if (cells[0] === '元素' && cells.includes('交互结果')) {
      if (cells.includes('展示内容')) {
        header = cells;
        displayIdx = cells.indexOf('展示内容');
      } else if (cells.includes('后端接口') && element.backend_apis && element.backend_apis.length) {
        header = ['元素', '位置', '输入/选项', '展示内容', '交互', '交互结果', '后端接口', '下游影响说明'];
        displayIdx = 3;
      } else {
        header = ['元素', '位置', '输入/选项', '展示内容', '交互', '交互结果', '后端接口', '下游影响说明'];
        displayIdx = 3;
      }
      if (lines[i].trim() !== `| ${header.join(' | ')} |`) {
        lines[i] = `| ${header.join(' | ')} |`;
        if (i + 1 < lines.length) lines[i + 1] = `| ${header.map(() => '------').join('|')} |`;
      }
      headerIndex = i;
      continue;
    }
    if (!header || !lines[i].trim().startsWith('|')) continue;
    const rowCells = lines[i].split('|').slice(1, -1).map(c => c.trim());
    if (rowCells[0] !== element.name) continue;
    const values = {
      元素: element.name,
      位置: element.position || rowCells[1] || '-',
      '输入/选项': element.input_options || rowCells[2] || '-',
      展示内容: element.display_content || rowCells[displayIdx] || '-',
      交互: element.interaction || rowCells[displayIdx + 1] || '-',
      交互结果: element.result || rowCells[displayIdx + 2] || '-',
      后端接口: renderBackendApiCell(element.backend_apis),
      下游影响说明: element.downstream || rowCells[rowCells.length - 1] || '-'
    };
    lines[i] = `| ${header.map(h => values[h] || '-').join(' | ')} |`;
    return lines.join('\n');
  }
  if (!header) return content;
  const values = {
    元素: element.name, 位置: element.position || '-', '输入/选项': element.input_options || '-',
    展示内容: element.display_content || '-',
    交互: element.interaction || '-', 交互结果: element.result || '-',
    后端接口: renderBackendApiCell(element.backend_apis), 下游影响说明: element.downstream || '-'
  };
  let end = headerIndex + 2;
  while (end < lines.length && lines[end].trim().startsWith('|')) end++;
  lines.splice(end, 0, `| ${header.map(h => values[h] || '-').join(' | ')} |`);
  return lines.join('\n');
}

function upsertSupplement(content, statement, category) {
  if (!statement) return content;
  if (String(content).includes(statement)) return content;
  const lines = String(content || '').split(/\r?\n/);
  let heading = lines.findIndex(line => /^##\s*补充说明/.test(line.trim()));
  if (heading < 0) {
    lines.push('', '## 补充说明');
    heading = lines.length - 1;
  }
  const subHeading = category ? `### ${category}` : `### 通用规则`;
  let subIdx = lines.findIndex((l, i) => i > heading && l.trim() === subHeading);
  const bullet = `- ${statement}`;
  if (subIdx >= 0) {
    let subEnd = subIdx + 1;
    while (subEnd < lines.length && !/^(##|###)\s/.test(lines[subEnd].trim())) subEnd++;
    lines.splice(subEnd, 0, bullet);
  } else {
    // 新建 subsection：定位到 补充说明 块末尾（下一个 ## 节或文件末）
    let end = heading + 1;
    while (end < lines.length && !/^##\s/.test(lines[end].trim())) end++;
    lines.splice(end, 0, subHeading, bullet);
  }
  return lines.join('\n');
}

function rebuildKbIndex(kbRoot) {
  const rebuildJs = path.resolve(__dirname, '../../../../src/scripts/kb/rebuild_index.js');
  if (!fs.existsSync(rebuildJs)) {
    return { rebuilt: false, error: 'rebuild_index_missing' };
  }
  const { buildIndex, writeIndex, INDEX_NAME } = require(rebuildJs);
  const target = writeIndex(kbRoot, buildIndex(kbRoot));
  const rel = path.relative(path.resolve(kbRoot), target).replace(/\\/g, '/') || INDEX_NAME;
  return { rebuilt: true, path: rel };
}

function applyChanges({ kbRoot, changeset, selectedIds, contentConfirmed }) {
  if (!contentConfirmed) {
    return { ok: false, error: 'content_not_confirmed', degrade_mode: 'write_stopped' };
  }
  const ids = selectedIds || changeset.changes.filter(c => c.selected !== false).map(c => c.change_id);
  const selected = changeset.changes.filter(c => ids.includes(c.change_id));
  let snaps = [];
  const changed = [];

  try {
    const targets = [...new Set(selected.map(c => resolveTarget(kbRoot, c.target_ref).rel))];
    ({ snaps } = snapshotPaths(kbRoot, targets));

    for (const ch of selected) {
      const { abs, rel } = resolveTarget(kbRoot, ch.target_ref);
      ensureDir(path.dirname(abs));
      let content = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
      if (!content && (ch.kind === 'page_element' || ch.kind === 'backend_api' || ch.kind === 'supplement')) {
        content = emptyPageFile(ch);
      }
      if (ch.kind === 'page') {
        if (!String(content).trim()) {
          content = `# 页面关系 · ${ch.module_l1} / ${ch.module_l2}\n\n## 1. 页面清单（跨端统一页面名称）\n\n| 统一页面名称 | 角色 | 支持端 | 一句话说明 |\n|--------------|------|--------|------------|\n`;
        }
        content = upsertPage(content, ch.after);
      } else if (ch.kind === 'page_relation') {
        content = upsertRelation(content, ch.platform, ch.after);
      } else if (ch.kind === 'page_element') {
        content = upsertElement(content, ch.after);
      } else if (ch.kind === 'supplement') {
        content = upsertSupplement(content, ch.after, ch.category);
      } else if (ch.after && ch.after.template) {
        content = upsertWebUrl(content, ch.page_id, ch.after.template);
      } else if (ch.after && ch.after.method) {
        content = upsertElementApi(content, ch.element_name, ch.after);
      }
      fs.writeFileSync(abs, content, 'utf8');
      changed.push(rel);
    }

    // 可选：调用现有 validate
    const validateJs = path.resolve(__dirname, '../../../../src/scripts/kb/validate_kb.js');
    let validation = { ok: true, errors: [], warnings: [] };
    if (fs.existsSync(validateJs)) {
      const r = spawnSync(process.execPath, [validateJs, '--kb-root', kbRoot], { encoding: 'utf8' });
      try {
        validation = JSON.parse(r.stdout || '{}');
      } catch {
        validation = { ok: r.status === 0, errors: r.status === 0 ? [] : ['validate_parse_failed'], warnings: [] };
      }
      if (!validation.ok) {
        rollback(kbRoot, snaps);
        return {
          ok: false,
          error: 'validation_failed',
          validation,
          changed_paths: [],
          degrade_mode: 'write_stopped'
        };
      }
    }

    const index = rebuildKbIndex(kbRoot);
    if (!index.rebuilt) {
      rollback(kbRoot, snaps);
      return {
        ok: false,
        error: index.error || 'index_rebuild_failed',
        validation,
        changed_paths: [],
        index,
        degrade_mode: 'write_stopped'
      };
    }

    return {
      ok: true,
      changed_paths: changed,
      validation,
      index,
      git: { action: 'skipped', detail: 'phase-a local apply; push via kb_git_sync' },
      degrade_mode: null
    };
  } catch (err) {
    if (snaps.length) rollback(kbRoot, snaps);
    return {
      ok: false,
      error: String(err.message || err),
      changed_paths: [],
      degrade_mode: 'write_stopped'
    };
  }
}

module.exports = {
  applyChanges,
  resolveTarget,
  upsertWebUrl,
  upsertElementApi,
  upsertPage,
  upsertRelation,
  upsertElement,
  upsertSupplement
};
