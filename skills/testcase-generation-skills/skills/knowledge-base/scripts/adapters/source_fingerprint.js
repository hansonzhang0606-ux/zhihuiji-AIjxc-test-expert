/**
 * 来源新鲜度：mtime + sha256；变化则要求重新 prepare
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function fingerprintPath(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    return { ok: false, error: 'source_missing', path: abs };
  }
  const st = fs.statSync(abs);
  const sha = sha256File(abs);
  return {
    ok: true,
    path: abs,
    size: st.size,
    mtime_ms: st.mtimeMs,
    sha256: sha,
    fingerprint: `sha256:${sha.slice(0, 16)}|mtime:${Math.floor(st.mtimeMs)}`
  };
}

function fingerprintPaths(paths) {
  const parts = [];
  const files = [];
  for (const p of paths) {
    const fp = fingerprintPath(p);
    if (!fp.ok) return fp;
    files.push(fp);
    parts.push(`${path.basename(p)}=${fp.sha256.slice(0, 12)}`);
  }
  const joined = crypto.createHash('sha256').update(parts.join('|')).digest('hex');
  return {
    ok: true,
    files,
    fingerprint: `sha256:${joined.slice(0, 16)}|n=${files.length}`
  };
}

function assertFresh(expectedFingerprint, currentFingerprint) {
  if (!expectedFingerprint || !currentFingerprint) {
    return { ok: false, error: 'fingerprint_missing' };
  }
  if (expectedFingerprint !== currentFingerprint) {
    return { ok: false, error: 'source_stale', expected: expectedFingerprint, current: currentFingerprint };
  }
  return { ok: true };
}

module.exports = {
  sha256File,
  fingerprintPath,
  fingerprintPaths,
  assertFresh
};
