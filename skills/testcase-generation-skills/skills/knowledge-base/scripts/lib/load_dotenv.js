/**
 * 安全加载凭据 .env（不把密钥写入仓库/日志）
 *
 * 查找顺序（后者只补空缺，不覆盖已有 process.env / 已加载键）：
 * 1. KB_DOTENV_PATH（显式）
 * 2. %USERPROFILE%/.testcase-kb/.env   ← 推荐（完全在仓库外）
 * 3. skills/knowledge-base/config/.env
 * 4. src/config/.env
 * 5. 工程根 .env（兼容旧路径）
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function parseEnvText(text) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) out[key] = val;
  }
  return out;
}

function candidateEnvPaths(workspaceRoot) {
  const list = [];
  if (process.env.KB_DOTENV_PATH) list.push(process.env.KB_DOTENV_PATH);
  list.push(path.join(os.homedir(), '.testcase-kb', '.env'));
  const skillRoot = path.resolve(__dirname, '..', '..');
  list.push(path.join(skillRoot, 'config', '.env'));
  const guessed = workspaceRoot
    ? path.resolve(workspaceRoot)
    : path.resolve(skillRoot, '..', '..');
  list.push(path.join(guessed, 'src', 'config', '.env'));
  list.push(path.join(guessed, 'skills', 'knowledge-base', 'config', '.env'));
  list.push(path.join(guessed, '.env'));
  // 去重保序
  const seen = new Set();
  return list.filter((p) => {
    if (!p) return false;
    const key = path.resolve(p);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 合并加载全部候选 .env（只填空缺）。
 * @returns {{ loadedFrom: string|null, loadedFromAll: string[], keys: string[] }}
 */
function loadKbDotenv(opts = {}) {
  const loadedKeys = [];
  const loadedFromAll = [];
  for (const file of candidateEnvPaths(opts.workspaceRoot)) {
    if (!file || !fs.existsSync(file)) continue;
    const parsed = parseEnvText(fs.readFileSync(file, 'utf8'));
    let used = false;
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] == null || process.env[k] === '') {
        process.env[k] = v;
        loadedKeys.push(k);
        used = true;
      }
    }
    if (used || Object.keys(parsed).length > 0) loadedFromAll.push(file);
  }
  return {
    loadedFrom: loadedFromAll[0] || null,
    loadedFromAll,
    keys: loadedKeys
  };
}

function getGitAuthFromEnv(config) {
  const auth = (config && config.auth) || {};
  const userKey = auth.username_env || 'KB_GIT_USERNAME';
  const tokenKey = auth.token_env || 'KB_GIT_TOKEN';
  const username = process.env[userKey] || process.env.KB_GIT_USERNAME || '';
  const token = process.env[tokenKey] || process.env.KB_GIT_TOKEN || process.env.KB_GIT_PASSWORD || '';
  return {
    username: String(username).trim(),
    token: String(token).trim(),
    present: !!(String(username).trim() && String(token).trim())
  };
}

/** Confluence Basic/Token 凭据（Stage0 下载检查 / Agent MCP 配置参考） */
function getConfluenceAuthFromEnv() {
  const username = String(process.env.CONFLUENCE_USERNAME || '').trim();
  const token = String(
    process.env.CONFLUENCE_API_TOKEN || process.env.CONFLUENCE_PASSWORD || ''
  ).trim();
  const baseUrl = String(process.env.CONFLUENCE_BASE_URL || '').trim();
  return {
    username,
    token,
    baseUrl,
    present: !!(username && token)
  };
}

/** 构造带凭据的 HTTPS URL；禁止把返回值写入日志或提交到 remote 配置长期保存 */
function buildAuthRepoUrl(repoUrl, username, token) {
  if (!repoUrl || !username || !token) return repoUrl;
  if (!/^https:\/\//i.test(repoUrl)) return repoUrl;
  const u = new URL(repoUrl);
  u.username = username;
  u.password = token;
  return u.href;
}

function redactUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    if (u.username) u.username = u.username ? '***' : '';
    return u.toString();
  } catch {
    return String(url || '').replace(/\/\/([^:/@]+):([^@]+)@/g, '//***:***@');
  }
}

module.exports = {
  parseEnvText,
  candidateEnvPaths,
  loadKbDotenv,
  getGitAuthFromEnv,
  getConfluenceAuthFromEnv,
  buildAuthRepoUrl,
  redactUrl
};
