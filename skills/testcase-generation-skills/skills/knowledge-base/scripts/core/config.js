/**
 * KB 远程/本地配置加载（Demand 6.3）
 * 顺序：用户目录 > 工作区 src/config/kb_remote.json > disabled
 * example 不当实配
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadKbDotenv } = require('../lib/load_dotenv');

function userConfigPath() {
  return path.join(os.homedir(), '.testcase-kb', 'kb_remote.json');
}

function workspaceConfigPath(workspaceRoot) {
  return path.join(workspaceRoot, 'src', 'config', 'kb_remote.json');
}

function readJsonSafe(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * @param {{ workspaceRoot?: string, explicitPath?: string }} [opts]
 */
function loadKbRemoteConfig(opts = {}) {
  // 先装 .env（不覆盖已有环境变量）；密钥永不写入 json
  loadKbDotenv({ workspaceRoot: opts.workspaceRoot });

  const sources = [];
  if (opts.explicitPath) sources.push({ kind: 'explicit', path: opts.explicitPath });
  sources.push({ kind: 'user', path: userConfigPath() });
  if (opts.workspaceRoot) {
    sources.push({ kind: 'workspace', path: workspaceConfigPath(opts.workspaceRoot) });
  }

  for (const s of sources) {
    const data = readJsonSafe(s.path);
    if (!data) continue;
    if (String(s.path).endsWith('.example')) continue;
    return {
      enabled: data.enabled !== false,
      config: data,
      source: s.kind,
      path: s.path,
      local_path: data.local_path || data.kb_root || null,
      service: data.service || null,
      git: data.git || null
    };
  }
  return {
    enabled: false,
    config: { enabled: false },
    source: 'disabled',
    path: null,
    local_path: null,
    service: null,
    git: null
  };
}

function resolveKbRoot(opts = {}) {
  if (opts.kbRoot) return path.resolve(opts.kbRoot);
  const cfg = loadKbRemoteConfig(opts);
  if (cfg.local_path && fs.existsSync(cfg.local_path)) return path.resolve(cfg.local_path);
  if (opts.defaultSampleRoot && fs.existsSync(opts.defaultSampleRoot)) {
    return path.resolve(opts.defaultSampleRoot);
  }
  return null;
}

module.exports = {
  userConfigPath,
  workspaceConfigPath,
  loadKbRemoteConfig,
  resolveKbRoot
};
