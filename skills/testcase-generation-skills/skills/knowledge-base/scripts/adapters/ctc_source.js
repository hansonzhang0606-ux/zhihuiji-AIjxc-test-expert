'use strict';

const fs = require('fs');
const path = require('path');
const { fingerprintPath, sha256File } = require('./source_fingerprint');
const { matchPrimary } = require('../../../../src/scripts/shared/module_matcher');
const { parseNavigationStep, isNavigationStep } = require('../../../../src/scripts/shared/navigation_path');
const { normalizePageUrl, normalizeBackendApi } = require('../lib/tech_normalize');

function locateManifest(inputPath, explicitPath) {
  const candidates = [
    explicitPath,
    path.join(path.dirname(path.resolve(inputPath)), 'final_artifact.json'),
    path.join(path.dirname(path.dirname(path.resolve(inputPath))), 'final_artifact.json')
  ].filter(Boolean);
  return candidates.find(p => fs.existsSync(p)) || null;
}

function validateFinalArtifact(inputPath, manifestPath) {
  const found = locateManifest(inputPath, manifestPath);
  if (!found) throw new Error('final_artifact_missing');
  const manifest = JSON.parse(fs.readFileSync(found, 'utf8'));
  if (manifest.schema_version !== '6.4') throw new Error('final_artifact_schema_version_invalid');
  if (manifest.finalized !== true) throw new Error('final_artifact_not_finalized');
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  if (artifacts.length !== 2 ||
      artifacts.filter(a => a.type === 'c_tc').length !== 1 ||
      artifacts.filter(a => a.type === 'xmind').length !== 1) {
    throw new Error('final_artifact_artifacts_invalid');
  }
  const inputAbs = path.resolve(inputPath);
  const manifestDir = path.dirname(path.resolve(found));
  // Stage4 writes final_artifact under script/stage4/ with workspace-relative
  // paths (e.g. script/stage4/test_cases.json). Flat fixtures may place the
  // manifest next to the C-TC and use basename-relative paths.
  const resolveRoots = [
    path.resolve(manifestDir, '..', '..'),
    manifestDir,
    path.dirname(inputAbs)
  ];
  const artifact = artifacts.find(a => {
    const relative = String(a.path || '').replace(/\\/g, '/');
    if (!relative || path.isAbsolute(relative) || relative.split('/').includes('..')) {
      return false;
    }
    return resolveRoots.some(root => path.resolve(root, relative) === inputAbs);
  });
  if (!artifact) throw new Error('final_artifact_input_not_listed');
  const actual = sha256File(inputAbs);
  if (String(artifact.sha256 || '').replace(/^sha256:/, '').toLowerCase() !== actual.toLowerCase()) {
    throw new Error('final_artifact_hash_mismatch');
  }
  return { manifest, manifest_path: path.resolve(found), artifact };
}

function moduleFor(tc, text) {
  if (tc.module_l1 && tc.module_l2) return { l1: tc.module_l1, l2: tc.module_l2, reason: 'ctc_explicit' };
  return matchPrimary(text) || { l1: '_inbox', l2: '_inbox', reason: 'matcher_unmatched' };
}

function actionElement(action) {
  return String(action || '').replace(/^(点击|选择|输入|填写|勾选|打开|关闭|提交|保存|搜索|切换)\s*/, '').trim();
}

function loadCtcSource(inputPath, opts = {}) {
  const fp = fingerprintPath(inputPath);
  if (!fp.ok) throw new Error(`${fp.error}: ${inputPath}`);
  const verified = validateFinalArtifact(inputPath, opts.manifestPath);
  const doc = JSON.parse(fs.readFileSync(fp.path, 'utf8'));
  const cases = Array.isArray(doc.test_cases) ? doc.test_cases : [];
  const p0 = cases.filter(tc => tc.priority === 'P0');
  const items = [];
  let seq = 1;

  for (const tc of p0) {
    const hit = moduleFor(tc, `${tc.title || ''} ${tc.module_l1 || ''}`);
    let currentPage = '';
    const platform = /APP/i.test((tc.platform_tags || []).join(' ')) ? 'app' : 'web';
    for (const step of tc.steps || []) {
      const action = String(step.action || '').trim();
      if (isNavigationStep(action)) {
        const parsed = parseNavigationStep(action);
        if (!parsed.valid) continue;
        currentPage = parsed.target_page;
        for (const pageId of [...new Set(parsed.tokens.filter(t => /页$/.test(t)))]) {
          items.push({
            candidate_id: `C-${String(seq++).padStart(3, '0')}`, case_id: tc.id,
            module_l1: hit.l1, module_l2: hit.l2, kind: 'page', page_id: pageId,
            page_role: pageId === parsed.tokens.find(t => /页$/.test(t)) ? '主页面' : '子页面',
            platform, statement: `由 P0 导航路径确认：${parsed.normalized_path}`,
            confidence: 0.95, module_reason: `ctc_navigation:${hit.reason}`
          });
        }
        for (const r of parsed.relations) {
          items.push({
            candidate_id: `C-${String(seq++).padStart(3, '0')}`, case_id: tc.id,
            module_l1: hit.l1, module_l2: hit.l2, kind: 'page_relation', page_id: r.to_page,
            platform, relation: { from: r.from_page, action: r.action, to: r.to_page },
            confidence: 0.98, module_reason: `ctc_navigation:${hit.reason}`
          });
        }
      } else if (currentPage && action && !/^检查接口\s+/i.test(action)) {
        const name = actionElement(action);
        items.push({
          candidate_id: `C-${String(seq++).padStart(3, '0')}`, case_id: tc.id,
          module_l1: hit.l1, module_l2: hit.l2, kind: 'page_element', page_id: currentPage,
          platform, element_name: name,
          element: { name, interaction: action, result: String(step.expected || '') },
          confidence: 0.85, module_reason: `ctc_step:${hit.reason}`
        });
      }
    }

    // This channel alone may create URL/API candidates. Step proximity is never consulted.
    for (const ref of tc.technical_refs || []) {
      const refPlatform = ref.platform || platform;
      if (ref.type === 'page_url') {
        if (refPlatform !== 'web') continue;
        const normalized = normalizePageUrl(ref.target);
        if (!normalized.ok || !ref.page_id) continue;
        items.push({
          candidate_id: `C-${String(seq++).padStart(3, '0')}`, case_id: tc.id,
          module_l1: hit.l1, module_l2: hit.l2, kind: 'page_url', page_id: ref.page_id,
          platform: refPlatform, page_url: normalized.value, confidence: 1,
          module_reason: `ctc_structured:${hit.reason}`
        });
      } else if (ref.type === 'backend_api' && ref.page_id && ref.element_name) {
        const normalized = normalizeBackendApi({ method: ref.method, path: ref.target });
        if (!normalized.ok) continue;
        items.push({
          candidate_id: `C-${String(seq++).padStart(3, '0')}`, case_id: tc.id,
          module_l1: hit.l1, module_l2: hit.l2, kind: 'backend_api', page_id: ref.page_id,
          platform: refPlatform, element_name: ref.element_name, backend_api: normalized.value,
          assertions: Array.isArray(ref.assertions) ? JSON.parse(JSON.stringify(ref.assertions)) : [],
          confidence: 1, module_reason: `ctc_structured:${hit.reason}`
        });
      }
    }
  }

  const rank = item => item.kind === 'backend_api' && item.assertions.length ? 0
    : item.kind === 'backend_api' ? 1 : item.kind === 'page_relation' ? 2 : item.kind === 'page' ? 3 : 4;
  const unique = new Map();
  for (const item of items) {
    const r = item.relation || {};
    const key = [
      item.case_id, item.kind, item.page_id, item.element_name,
      r.from, r.action, r.to,
      item.backend_api && item.backend_api.method, item.backend_api && item.backend_api.path
    ].join('|');
    if (!unique.has(key)) unique.set(key, item);
  }
  const sortedItems = [...unique.values()].sort((a, b) => rank(a) - rank(b));
  return {
    schema_version: '6.3',
    source: { type: 'ctc', ref: fp.path, read_at: new Date().toISOString() },
    source_fingerprint: fp.fingerprint,
    source_manifest: verified.manifest,
    source_manifest_path: verified.manifest_path,
    source_manifest_fingerprint: fingerprintPath(verified.manifest_path).fingerprint,
    items: sortedItems,
    notes: [`严格 P0 过滤：${p0.length}/${cases.length} 个用例`, 'final_artifact SHA256 已验证']
  };
}

module.exports = { loadCtcSource, validateFinalArtifact, locateManifest };
