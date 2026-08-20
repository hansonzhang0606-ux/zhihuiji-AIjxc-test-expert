/**
 * 评审工作区：内容审前不改 kb_root
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { renderBackendApiCell } = require('./markdown_model');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function defaultReviewRoot(overviewId) {
  return path.join(os.tmpdir(), 'kb_review', overviewId);
}

/**
 * 基于 selected changes 生成评审副本（最小实现：写入拟补丁说明 + 目标文件快照）
 */
function createReviewWorkspace({ kbRoot, overview, changeset, selectedIds, reviewRoot }) {
  const ids = selectedIds && selectedIds.length
    ? selectedIds
    : changeset.changes.filter(c => c.selected !== false).map(c => c.change_id);

  const selected = changeset.changes.filter(c => ids.includes(c.change_id));
  if (!selected.length) {
    return { ok: false, error: 'no_selected_changes' };
  }

  const root = path.resolve(reviewRoot || defaultReviewRoot(overview.overview_id));
  if (path.resolve(root).startsWith(path.resolve(kbRoot))) {
    return { ok: false, error: 'review_root_inside_kb_root' };
  }

  ensureDir(root);
  const filesDir = path.join(root, 'files');
  ensureDir(filesDir);

  const fileEntries = [];
  const diffLines = [];
  const byTarget = new Map();
  for (const ch of selected) {
    if (!byTarget.has(ch.target_ref)) byTarget.set(ch.target_ref, []);
    byTarget.get(ch.target_ref).push(ch);
  }

  for (const [targetRef, chs] of byTarget.entries()) {
    const src = path.join(kbRoot, targetRef);
    const dest = path.join(filesDir, targetRef);
    ensureDir(path.dirname(dest));
    let content = fs.existsSync(src) ? fs.readFileSync(src, 'utf8') : '';
    // 在副本末尾追加拟变更块（人工可审）；真正 merge 在 apply
    const block = ['', '<!-- KB_REVIEW_PENDING -->', `## 拟变更（${overview.overview_id}）`, ''];
    for (const ch of chs) {
      block.push(`- ${ch.change_id} ${ch.operation}: ${ch.summary}`);
      if (ch.after && ch.after.template) block.push(`  - URL → \`${ch.after.template}\``);
      if (ch.after && ch.after.method) {
        block.push(`  - API → ${renderBackendApiCell([ch.after])}`);
      }
      diffLines.push(`*** ${targetRef}`);
      diffLines.push(`--- ${ch.change_id} ${ch.operation}`);
      diffLines.push(`+++ ${ch.summary}`);
      if (ch.before) diffLines.push(`- ${JSON.stringify(ch.before)}`);
      if (ch.after) diffLines.push(`+ ${JSON.stringify(ch.after)}`);
    }
    block.push('');
    content = content + block.join('\n');
    fs.writeFileSync(dest, content, 'utf8');
    fileEntries.push({
      target_ref: targetRef,
      review_path: path.relative(root, dest).replace(/\\/g, '/'),
      change_ids: chs.map(c => c.change_id)
    });
  }

  const diffPath = path.join(root, 'diff.patch');
  fs.writeFileSync(diffPath, diffLines.join('\n') + '\n', 'utf8');

  const manifest = {
    schema_version: '6.3',
    review_id: `rv-${overview.overview_id.replace(/^ov-/, '')}`,
    overview_id: overview.overview_id,
    source_fingerprint: overview.source_fingerprint,
    base_commit: overview.base_commit,
    changeset_hash: overview.changeset_hash,
    created_at: new Date().toISOString(),
    selected_change_ids: selected.map(c => c.change_id),
    review_root: root,
    files: fileEntries,
    diff_path: 'diff.patch',
    content_confirmed: false,
    completeness_summary: {
      blocking_gap_count: (overview.completeness_report.blocking_gaps || []).length,
      warning_gap_count: (overview.completeness_report.warning_gaps || []).length,
      blocked_write: overview.completeness_report.blocked_write,
      report_hash: overview.completeness_report_hash
    }
  };
  if (overview.source_manifest) manifest.source_manifest = overview.source_manifest;
  fs.writeFileSync(path.join(root, 'review_manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(root, 'changeset.json'), JSON.stringify(changeset, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(root, 'overview.json'), JSON.stringify(overview, null, 2) + '\n', 'utf8');

  return { ok: true, manifest, review_root: root };
}

module.exports = { createReviewWorkspace, defaultReviewRoot };
