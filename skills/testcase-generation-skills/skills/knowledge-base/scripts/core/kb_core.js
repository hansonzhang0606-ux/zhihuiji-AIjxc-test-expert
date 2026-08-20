/**
 * KB Core — 唯一领域入口（CLI / 未来 HTTP 只调这里）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { loadTextSource } = require('../adapters/text_source');
const { loadXmindSource } = require('../adapters/xmind_source');
const { loadCtcSource, validateFinalArtifact } = require('../adapters/ctc_source');
const { loadConfluenceSource } = require('../adapters/confluence_source');
const { fingerprintPath, assertFresh } = require('../adapters/source_fingerprint');
const { buildChangeSet, buildOverview, hashObj } = require('./changeset');
const { evaluateCompleteness } = require('./completeness_gate');
const { createReviewWorkspace } = require('./review_workspace');
const { applyChanges } = require('./apply_transaction');
const { resolveKbRoot, loadKbRemoteConfig } = require('./config');

function baseCommitOf(kbRoot) {
  try {
    const { spawnSync } = require('child_process');
    const r = spawnSync('git', ['-C', kbRoot, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
    if (r.status === 0) return `git:${r.stdout.trim()}`;
  } catch {
    /* ignore */
  }
  return `local:${Date.now().toString(36)}`;
}

function prepareOverview({ kbRoot, source = 'text', input, workspaceRoot, manifestPath }) {
  const root = resolveKbRoot({
    kbRoot,
    workspaceRoot,
    defaultSampleRoot: path.resolve(__dirname, '../../../../src/templates/模块矩阵知识库')
  });
  if (!root || !fs.existsSync(root)) {
    return {
      ok: true,
      degrade_mode: 'empty_kb',
      overview: null,
      changeset: null,
      message: 'kb_root empty or missing; extract/write must not invent knowledge'
    };
  }

  // Phase A 默认本地 Core；服务探测失败时由 adapter 填 degrade_mode=service_local
  const degrade_mode = null;
  void loadKbRemoteConfig({ workspaceRoot });

  let candidate;
  if (source === 'text') {
    candidate = loadTextSource(input);
  } else if (source === 'xmind') {
    candidate = loadXmindSource(input);
  } else if (source === 'ctc') {
    candidate = loadCtcSource(input, { manifestPath });
  } else if (source === 'confluence') {
    candidate = loadConfluenceSource(input);
  } else {
    return { ok: false, error: `source_not_ready:${source}` };
  }

  const { changeset, conflicts } = buildChangeSet(candidate, {
    kbRoot: root,
    baseCommit: baseCommitOf(root)
  });
  const overview = buildOverview(candidate, changeset, conflicts, { degradeMode: degrade_mode });
  const completeness = evaluateCompleteness({ candidate, changeset, kbRoot: root });
  overview.completeness_report = completeness.report;
  overview.blocked_write = completeness.report.blocked_write;
  overview.completeness_report_hash = completeness.report_hash;
  if (candidate.source_manifest) overview.source_manifest = candidate.source_manifest;
  return { ok: true, kb_root: root, candidate, overview, changeset, conflicts, degrade_mode };
}

function prepareReview({ kbRoot, overview, changeset, selectedIds, reviewRoot }) {
  const expectedHash = hashObj({
    overview_id: changeset.overview_id,
    source_fingerprint: changeset.source_fingerprint,
    base_commit: changeset.base_commit,
    changes: changeset.changes
  });
  if (expectedHash !== changeset.changeset_hash || overview.changeset_hash !== changeset.changeset_hash) {
    return { ok: false, error: 'changeset_integrity_failed', next_action: 'reprepare_overview' };
  }
  const completeness = evaluateCompleteness({ changeset, kbRoot });
  if (completeness.report.blocked_write) {
    return {
      ok: false,
      error: 'completeness_blocked',
      blocked_write: true,
      completeness_report: completeness.report,
      next_action: 'human_fill_then_reoverview'
    };
  }
  const trustedOverview = {
    ...overview,
    completeness_report: completeness.report,
    completeness_report_hash: completeness.report_hash,
    blocked_write: false
  };
  return createReviewWorkspace({
    kbRoot,
    overview: trustedOverview,
    changeset,
    selectedIds,
    reviewRoot
  });
}

function applyReview({ kbRoot, reviewManifestPath, contentConfirmed }) {
  const manifest = JSON.parse(fs.readFileSync(reviewManifestPath, 'utf8'));
  if (!contentConfirmed && !manifest.content_confirmed) {
    return {
      ok: false,
      error: 'content_not_confirmed',
      degrade_mode: 'write_stopped',
      schema_version: '6.3'
    };
  }
  const reviewRoot = manifest.review_root;
  const changeset = JSON.parse(fs.readFileSync(path.join(reviewRoot, 'changeset.json'), 'utf8'));
  const overview = JSON.parse(fs.readFileSync(path.join(reviewRoot, 'overview.json'), 'utf8'));
  const expectedHash = hashObj({
    overview_id: changeset.overview_id,
    source_fingerprint: changeset.source_fingerprint,
    base_commit: changeset.base_commit,
    changes: changeset.changes
  });
  if (expectedHash !== changeset.changeset_hash || manifest.changeset_hash !== changeset.changeset_hash) {
    return { ok: false, error: 'changeset_integrity_failed', errors: ['reprepare_required'] };
  }
  const completeness = evaluateCompleteness({ changeset, kbRoot });
  if (completeness.report.blocked_write) {
    return {
      ok: false,
      error: 'completeness_blocked',
      blocked_write: true,
      completeness_report: completeness.report,
      next_action: 'human_fill_then_reoverview',
      errors: ['completeness_blocked']
    };
  }

  // 来源新鲜度：xmind/单文件源若仍存在则校验 fingerprint
  if (overview.source && ['xmind', 'ctc'].includes(overview.source.type) && overview.source.ref) {
    const cur = fingerprintPath(overview.source.ref);
    if (cur.ok) {
      const fresh = assertFresh(overview.source_fingerprint, cur.fingerprint);
      if (!fresh.ok) {
        return {
          schema_version: '6.3',
          ok: false,
          overview_id: manifest.overview_id,
          review_id: manifest.review_id,
          source_fingerprint: manifest.source_fingerprint,
          base_commit: manifest.base_commit,
          resulting_commit: null,
          changeset_hash: manifest.changeset_hash,
          changed_paths: [],
          validation: { ok: false, errors: ['source_stale'] },
          index: { rebuilt: false },
          git: { action: 'stopped' },
          degrade_mode: 'write_stopped',
          errors: ['source_stale_reprepare_required']
        };
      }
    }
  }
  if (overview.source && overview.source.type === 'ctc') {
    try {
      validateFinalArtifact(overview.source.ref, overview.source_manifest_path);
      const manifestFp = fingerprintPath(overview.source_manifest_path);
      if (!manifestFp.ok || !assertFresh(overview.source_manifest_fingerprint, manifestFp.fingerprint).ok) {
        throw new Error('source_manifest_stale');
      }
    } catch (err) {
      return { ok: false, error: String(err.message || err), errors: ['source_manifest_stale_reprepare_required'] };
    }
  }

  // Git HEAD 乐观锁
  const headNow = baseCommitOf(kbRoot);
  if (manifest.base_commit && manifest.base_commit.startsWith('git:') && headNow !== manifest.base_commit) {
    return {
      schema_version: '6.3',
      ok: false,
      overview_id: manifest.overview_id,
      review_id: manifest.review_id,
      source_fingerprint: manifest.source_fingerprint,
      base_commit: manifest.base_commit,
      resulting_commit: null,
      changeset_hash: manifest.changeset_hash,
      changed_paths: [],
      validation: { ok: false, errors: ['base_commit_changed'] },
      index: { rebuilt: false },
      git: { action: 'stopped', detail: `expected ${manifest.base_commit} got ${headNow}` },
      degrade_mode: 'write_stopped',
      errors: ['base_commit_changed_reprepare_required']
    };
  }

  const result = applyChanges({
    kbRoot,
    changeset,
    selectedIds: manifest.selected_change_ids,
    contentConfirmed: true
  });

  const report = {
    schema_version: '6.3',
    ok: !!result.ok,
    overview_id: manifest.overview_id,
    review_id: manifest.review_id,
    source_fingerprint: manifest.source_fingerprint,
    base_commit: manifest.base_commit,
    resulting_commit: null,
    changeset_hash: manifest.changeset_hash,
    changed_paths: result.changed_paths || [],
    validation: result.validation || { ok: false },
    index: result.index || { rebuilt: false },
    git: result.git || { action: 'stopped' },
    degrade_mode: result.degrade_mode || null,
    errors: result.error ? [result.error] : []
  };
  return report;
}

module.exports = {
  prepareOverview,
  prepareReview,
  applyReview,
  baseCommitOf
};
