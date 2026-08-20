/**
 * Demand 6.2 — 可配置语义库 Git 同步。
 *
 * 默认配置 disabled。本脚本不 force、不 stash、不改远程历史。
 *
 *   node kb/kb_git_sync.js --config <kb_remote.json> --action pull|push|resume|status
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildIndex, writeIndex } = require('./rebuild_index');
const {
  loadKbDotenv,
  getGitAuthFromEnv,
  buildAuthRepoUrl,
  redactUrl
} = require('../../../skills/knowledge-base/scripts/lib/load_dotenv');

function runGit(cwd, args, allowFailure) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    // 防止 token 出现在错误文本里
    throw new Error(`git ${args.map(redactUrl).join(' ')} 失败: ${redactUrl(output)}`);
  }
  return { ok: result.status === 0, output, status: result.status };
}

function loadConfig(file) {
  const resolved = path.resolve(file);
  loadKbDotenv({
    workspaceRoot: path.resolve(path.dirname(resolved), '..', '..')
  });
  const config = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (!config.enabled) return { ...config, enabled: false };
  for (const key of ['repo_url', 'branch', 'local_path']) {
    if (!config[key]) throw new Error(`kb_remote 缺少 ${key}`);
  }
  if (config.push && config.push.mode && config.push.mode !== 'direct') {
    throw new Error('当前仅支持 push.mode=direct');
  }
  return config;
}

function authUrlFor(config) {
  const auth = getGitAuthFromEnv(config);
  if (!auth.present) return config.repo_url;
  return buildAuthRepoUrl(config.repo_url, auth.username, auth.token);
}

/** 网络操作期间临时注入凭据 URL，结束后恢复干净 origin（避免 token 落盘） */
function withAuthOrigin(root, config, fn) {
  const clean = config.repo_url;
  const authUrl = authUrlFor(config);
  if (authUrl === clean) return fn();
  try {
    runGit(root, ['remote', 'set-url', 'origin', authUrl]);
    return fn();
  } finally {
    runGit(root, ['remote', 'set-url', 'origin', clean], true);
  }
}

function assertOrigin(root, expected) {
  const origin = runGit(root, ['remote', 'get-url', 'origin']).output;
  if (origin !== expected) throw new Error(`origin URL 不一致: ${origin}`);
}

function ensureRepo(config) {
  const root = path.resolve(config.local_path);
  if (!fs.existsSync(root)) {
    const auth = getGitAuthFromEnv(config);
    if (!auth.present) {
      throw new Error(
        `kb_root 不存在且缺少 Git 凭据，无法 clone。请在 %USERPROFILE%\\.testcase-kb\\.env 或 src/config/.env 写入 KB_GIT_USERNAME / KB_GIT_TOKEN（见 .env.example），勿写入 kb_remote.json`
      );
    }
    fs.mkdirSync(path.dirname(root), { recursive: true });
    const cloneUrl = authUrlFor(config);
    runGit(path.dirname(root), ['clone', '--branch', config.branch, cloneUrl, root]);
    // clone 后立刻去掉 remote 中的 token
    runGit(root, ['remote', 'set-url', 'origin', config.repo_url], true);
  } else if (!fs.existsSync(path.join(root, '.git'))) {
    throw new Error(`kb local_path 不是 Git 仓: ${root}`);
  }
  assertOrigin(root, config.repo_url);
  return root;
}

function rebuild(root) {
  writeIndex(root, buildIndex(root));
}

function pull(config) {
  if (!config.enabled) return { ok: true, action: 'pull', skipped: true };
  const root = ensureRepo(config);
  const dirty = runGit(root, ['status', '--porcelain']).output;
  if (dirty) throw new Error('知识库工作区存在未提交变更，拒绝自动 stash/pull');
  withAuthOrigin(root, config, () => {
    runGit(root, ['fetch', 'origin', config.branch]);
    runGit(root, ['merge', '--ff-only', `origin/${config.branch}`]);
  });
  rebuild(root);
  return { ok: true, action: 'pull', kb_root: root };
}

function stageBusinessFiles(root) {
  runGit(root, ['add', '-A', '--', '.', ':!知识库索引.json', ':!**/*.tmp', ':!.DS_Store']);
}

function push(config, resume) {
  if (!config.enabled) return { ok: true, action: resume ? 'resume' : 'push', skipped: true };
  const root = ensureRepo(config);
  return withAuthOrigin(root, config, () => {
    runGit(root, ['fetch', 'origin', config.branch]);
    const aheadBehind = runGit(root, ['rev-list', '--left-right', '--count', `HEAD...origin/${config.branch}`]).output.split(/\s+/);
    const behind = Number(aheadBehind[1] || 0);
    if (behind > 0) throw new Error('远程已有新提交；请先 pull --ff-only 并复检 diff，禁止强推');

    stageBusinessFiles(root);
    const staged = runGit(root, ['diff', '--cached', '--name-only']).output;
    if (staged) {
      if (resume) throw new Error('resume 检测到新的未提交变更；请先人工确认后再 push');
      const prefix = (config.push && config.push.message_prefix) || 'kb:';
      runGit(root, ['commit', '-m', `${prefix} update knowledge base`]);
    }
    const ahead = Number(runGit(root, ['rev-list', '--count', `origin/${config.branch}..HEAD`]).output || 0);
    if (!ahead) return { ok: true, action: 'push', kb_root: root, nothing_to_push: true };
    runGit(root, ['push', 'origin', `HEAD:${config.branch}`]);
    return { ok: true, action: resume ? 'resume' : 'push', kb_root: root, pushed: true };
  });
}

function status(config) {
  if (!config.enabled) return { ok: true, action: 'status', skipped: true };
  const root = ensureRepo(config);
  return {
    ok: true,
    action: 'status',
    kb_root: root,
    status: runGit(root, ['status', '--short']).output,
    ahead_behind: runGit(root, ['rev-list', '--left-right', '--count', `HEAD...origin/${config.branch}`]).output
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' && argv[i + 1]) out.config = argv[++i];
    else if (argv[i] === '--action' && argv[i + 1]) out.action = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') out.help = true;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.config || !args.action) {
    console.log('用法: node kb/kb_git_sync.js --config <kb_remote.json> --action pull|push|resume|status');
    process.exit(args.help ? 0 : 1);
  }
  const config = loadConfig(args.config);
  const actions = { pull, push: config => push(config, false), resume: config => push(config, true), status };
  if (!actions[args.action]) throw new Error(`未知 action: ${args.action}`);
  console.log(JSON.stringify(actions[args.action](config), null, 2));
}

module.exports = { loadConfig, pull, push, status, ensureRepo };
if (require.main === module) main();
