/**
 * Demand 6.0 工作区目录工具（FOUND-03，修订）
 *
 * - 工作区目录名 = 需求文档 title
 * - input/ 与 output/ 平级；input 子目录中文命名
 *
 * CLI:
 *   node scripts/lib/workspace.js --create --title <需求title> [--output-dir <dir>]
 *   node scripts/lib/workspace.js --assert-root --project-dir <workspaceRoot> [--title <title>]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  sanitizeTitle,
  xmindBaseName,
  extractVersionFolder,
  resolveWorkspaceRelPath,
  isWeeklyIterationTitle,
  buildWeeklySubRequirementTitle
} = require('./naming');

/** src/ （契约、templates、scripts 所在） */
const SRC_ROOT = path.resolve(__dirname, '..', '..');
/** testcase-generation-skills/ （对外：skill.md、output、skills、src） */
const PROJECT_ROOT = path.resolve(SRC_ROOT, '..');
/** 生成产物基目录：工程最外层 output/ */
const DEFAULT_OUTPUT_DIR = path.join(PROJECT_ROOT, 'output');

const REQUIRED_DIRS = [
  'input/需求文档',
  'input/技术文档',
  'input/历史文档参考',
  'output',
  'script/config',
  'script/stage1',
  'script/stage2',
  'script/stage3',
  'script/stage4',
  'script/stage4/knowledge_base',
  'script/adapters_runtime',
  'script/logs'
];

const ROOT_ALLOWED_DIRS = new Set(['input', 'output', 'script']);
const XMIND_SUFFIXES = ['需求点', '测试点', '测试用例', '技术改动'];

/** Fast Path / Full Path（Demand 6.0 §2） */
const PATH_MODES = Object.freeze(['fast', 'full']);
const DEFAULT_PATH_MODE = 'fast';
const PATH_MODE_SCHEMA_VERSION = '6.0';

/**
 * @param {unknown} mode
 * @returns {'fast'|'full'}
 */
function normalizePathMode(mode) {
  if (mode == null || mode === '') return DEFAULT_PATH_MODE;
  const m = String(mode).trim().toLowerCase();
  if (!PATH_MODES.includes(m)) {
    throw new Error(
      `path_mode 非法: "${mode}"（仅允许 ${PATH_MODES.join('|')}，默认 ${DEFAULT_PATH_MODE}）`
    );
  }
  return m;
}

/**
 * @param {'fast'|'full'|string} [mode]
 * @returns {{ mode: 'fast'|'full', schema_version: string, flags: object }}
 */
function buildPathModeConfig(mode) {
  return {
    mode: normalizePathMode(mode),
    schema_version: PATH_MODE_SCHEMA_VERSION,
    flags: {}
  };
}

const PATH_MODE_REL = 'script/config/path_mode.json';

/**
 * 写入/覆盖 script/config/path_mode.json
 * @param {string} workspaceRoot
 * @param {'fast'|'full'|string} [mode]
 * @returns {{ path: string, config: object }}
 */
function writePathMode(workspaceRoot, mode) {
  const config = buildPathModeConfig(mode);
  const filePath = path.join(workspaceRoot, PATH_MODE_REL);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
  return { path: filePath, config };
}

/**
 * 读取并校验 path_mode.json
 * @param {string} workspaceRoot
 * @returns {{ ok: boolean, config?: object, error?: string, path: string }}
 */
function readPathMode(workspaceRoot) {
  const filePath = path.join(workspaceRoot, PATH_MODE_REL);
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: 'path_mode.json 不存在', path: filePath };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!raw || raw.mode == null || raw.mode === '') {
      return { ok: false, error: '缺少 mode 字段', path: filePath };
    }
    const mode = normalizePathMode(raw.mode);
    return {
      ok: true,
      path: filePath,
      config: {
        mode,
        schema_version: raw.schema_version || PATH_MODE_SCHEMA_VERSION,
        flags: raw.flags || {}
      }
    };
  } catch (e) {
    return { ok: false, error: e.message, path: filePath };
  }
}

/**
 * 确保 path_mode.json 合法（S0-06）
 * @param {string} workspaceRoot
 * @param {object} [opts]
 * @param {'fast'|'full'|string} [opts.mode] 新建/非法时的目标模式，默认 fast
 * @param {boolean} [opts.force=false] 强制覆盖为 opts.mode（CLI --path-mode）
 * @returns {{ path: string, config: object, written: boolean }}
 */
function ensurePathMode(workspaceRoot, opts) {
  const options = opts || {};
  const force = !!options.force;
  const existing = readPathMode(workspaceRoot);

  if (force) {
    const target = normalizePathMode(
      options.mode != null ? options.mode : DEFAULT_PATH_MODE
    );
    const written = writePathMode(workspaceRoot, target);
    return { ...written, written: true };
  }

  if (existing.ok) {
    const needsRewrite =
      existing.config.schema_version !== PATH_MODE_SCHEMA_VERSION ||
      typeof existing.config.flags !== 'object';
    if (needsRewrite) {
      const written = writePathMode(workspaceRoot, existing.config.mode);
      return { ...written, written: true };
    }
    return { path: existing.path, config: existing.config, written: false };
  }

  const target = normalizePathMode(
    options.mode != null ? options.mode : DEFAULT_PATH_MODE
  );
  const written = writePathMode(workspaceRoot, target);
  return { ...written, written: true };
}

/**
 * @param {object} opts
 * @param {string} opts.title 需求文档 title（Confluence page title / 本地文档名）
 * @param {string} [opts.outputDir]
 * @param {boolean} [opts.writeBootstrapConfig=true]
 * @param {'fast'|'full'|string} [opts.pathMode] S0-06；默认 fast
 * @param {boolean} [opts.forcePathMode=false] 强制覆盖已有 path_mode
 */
function createWorkspace(opts) {
  const rel = resolveWorkspaceRelPath(opts.title);
  const requirementTitle = rel.folderName;
  const versionFolder = rel.versionFolder;
  const outputDir = path.resolve(opts.outputDir || DEFAULT_OUTPUT_DIR);
  const writeBootstrapConfig = opts.writeBootstrapConfig !== false;
  // 有版本前缀 → output/v4.6.0/{title}/；无则 → output/{title}/
  const workspaceRoot = path.join(outputDir, rel.relativePath);

  if (versionFolder) {
    fs.mkdirSync(path.join(outputDir, versionFolder), { recursive: true });
  }
  fs.mkdirSync(workspaceRoot, { recursive: true });

  const createdDirs = [];
  for (const rel of REQUIRED_DIRS) {
    const abs = path.join(workspaceRoot, rel);
    if (!fs.existsSync(abs)) {
      fs.mkdirSync(abs, { recursive: true });
      createdDirs.push(rel);
    } else {
      createdDirs.push(rel + ' (exists)');
    }
  }

  let pathModeResult = null;
  if (writeBootstrapConfig) {
    pathModeResult = ensurePathMode(workspaceRoot, {
      mode: opts.pathMode != null ? opts.pathMode : DEFAULT_PATH_MODE,
      force: !!opts.forcePathMode
    });

    const progressPath = path.join(workspaceRoot, 'script/config/progress_tracker.json');
    if (!fs.existsSync(progressPath)) {
      fs.writeFileSync(
        progressPath,
        JSON.stringify(
          {
            stage1_approved: false,
            stage3_approved: false,
            test_context_approved: false,
            current: 'initialized'
          },
          null,
          2
        ),
        'utf8'
      );
    }

    const sessionPath = path.join(workspaceRoot, 'script/config/session_info.json');
    if (!fs.existsSync(sessionPath)) {
      fs.writeFileSync(
        sessionPath,
        JSON.stringify(
          {
            requirement_title: requirementTitle,
            schema_version: '6.0',
            version_folder: versionFolder,
            workspace_rel: rel.relativePath.replace(/\\/g, '/'),
            is_weekly_iteration: isWeeklyIterationTitle(opts.title),
            created_at: new Date().toISOString()
          },
          null,
          2
        ),
        'utf8'
      );
    }
  }

  return {
    workspaceRoot,
    requirementTitle,
    folderName: requirementTitle,
    versionFolder,
    workspaceRel: rel.relativePath.replace(/\\/g, '/'),
    isWeeklyIteration: isWeeklyIterationTitle(opts.title),
    createdDirs,
    outputDir,
    pathMode: pathModeResult ? pathModeResult.config.mode : undefined
  };
}

function xmindFileName(title, kind) {
  return xmindBaseName(title, kind);
}

function getXmindPaths(workspaceRoot, title) {
  const t = sanitizeTitle(title);
  return {
    requirementPoints: path.join(workspaceRoot, 'output', xmindFileName(t, '需求点')),
    testPoints: path.join(workspaceRoot, 'output', xmindFileName(t, '测试点')),
    testCases: path.join(workspaceRoot, 'output', xmindFileName(t, '测试用例')),
    technical: path.join(workspaceRoot, 'output', xmindFileName(t, '技术改动'))
  };
}

const CONTRACT_REL_PATHS = {
  inputRequirementDir: 'input/需求文档',
  inputTechnicalDir: 'input/技术文档',
  inputReferenceDir: 'input/历史文档参考',
  outputDir: 'output',
  testContext: 'script/config/test_context.json',
  requirementPoints: 'script/stage1/requirement_points.json',
  moduleAttribution: 'script/stage3/module_attribution.json',
  testPoints: 'script/stage3/test_points.json',
  mergeReport: 'script/stage3/merge_report.json',
  testCases: 'script/stage4/test_cases.json',
  pathMode: 'script/config/path_mode.json',
  sessionInfo: 'script/config/session_info.json',
  progressTracker: 'script/config/progress_tracker.json',
  qualityGateSummary: 'script/config/quality_gate_summary.json'
};

function contractPath(workspaceRoot, key) {
  const rel = CONTRACT_REL_PATHS[key];
  if (!rel) {
    throw new Error('未知契约 key: ' + key);
  }
  return path.join(workspaceRoot, rel);
}

/**
 * 校验：根下仅 input/output/script；output 内 xmind 命名合法
 */
function assertPublicRoot(workspaceRoot, opts) {
  const options = opts || {};
  const allowMissingXmind = options.allowMissingXmind !== false;
  const violations = [];

  if (!fs.existsSync(workspaceRoot)) {
    return { ok: false, violations: ['工作区不存在: ' + workspaceRoot] };
  }

  const title = options.title ? sanitizeTitle(options.title) : null;
  const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });

  for (const ent of entries) {
    const name = ent.name;
    if (ent.isDirectory() && ROOT_ALLOWED_DIRS.has(name)) {
      continue;
    }
    violations.push(
      '工作区根不允许: ' + name + (ent.isDirectory() ? '/' : '') + '（仅允许 input/、output/、script/）'
    );
  }

  for (const rel of REQUIRED_DIRS) {
    if (!fs.existsSync(path.join(workspaceRoot, rel))) {
      violations.push('缺少约定目录: ' + rel);
    }
  }

  const outputAbs = path.join(workspaceRoot, 'output');
  if (fs.existsSync(outputAbs)) {
    // Demand 6.0.3：命名为 `{类型}_{title}.xmind`（与 naming.xmindBaseName 一致）
    const allowed = new Set();
    if (title) {
      for (const suf of XMIND_SUFFIXES) {
        allowed.add(xmindBaseName(title, suf));
      }
    }
    for (const ent of fs.readdirSync(outputAbs, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        violations.push('output/ 不允许子目录: ' + ent.name);
        continue;
      }
      const name = ent.name;
      if (!name.endsWith('.xmind')) {
        violations.push('output/ 不允许非 xmind: ' + name);
        continue;
      }
      if (title && !allowed.has(name)) {
        violations.push('output/ 非法 xmind 命名: ' + name);
      } else if (!title) {
        const ok = XMIND_SUFFIXES.some((suf) => name.startsWith(suf + '_'));
        if (!ok) {
          violations.push('output/ 非法 xmind 命名: ' + name);
        }
      }
    }
  }

  if (!allowMissingXmind && title) {
    for (const suf of ['需求点', '测试点', '测试用例']) {
      const f = path.join(outputAbs, xmindBaseName(title, suf));
      if (!fs.existsSync(f)) {
        violations.push('缺少对外产物: output/' + path.basename(f));
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

function parseArgs(argv) {
  const params = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--create') params.create = true;
    else if (a === '--assert-root') params.assertRoot = true;
    else if (a === '--title' && argv[i + 1]) params.title = argv[++i];
    else if (a === '--output-dir' && argv[i + 1]) params.outputDir = argv[++i];
    else if (a === '--project-dir' && argv[i + 1]) params.projectDir = argv[++i];
    else if (a === '--path-mode' && argv[i + 1]) {
      params.pathMode = argv[++i];
      params.forcePathMode = true;
    }
    else if (a === '--help' || a === '-h') params.help = true;
  }
  return params;
}

function printUsage() {
  console.log(`
Demand 6.0 workspace 工具 (FOUND-03)

  node scripts/lib/workspace.js --create --title <需求文档title> [--output-dir <dir>] [--path-mode fast|full]
  node scripts/lib/workspace.js --assert-root --project-dir <workspaceRoot> [--title <title>]

说明: 工作区目录名 = 需求文档 title（来自 Confluence/本地文档），无其他编号参数。
      --path-mode 默认 fast；显式传入时覆盖已有 path_mode.json。
`);
}

function main() {
  const params = parseArgs(process.argv.slice(2));
  if (params.help || (!params.create && !params.assertRoot)) {
    printUsage();
    process.exit(params.help ? 0 : 1);
  }

  if (params.create) {
    if (!params.title) {
      console.error('错误: --create 需要 --title');
      process.exit(1);
    }
    const result = createWorkspace({
      title: params.title,
      outputDir: params.outputDir,
      pathMode: params.pathMode,
      forcePathMode: !!params.forcePathMode
    });
    console.log(JSON.stringify({ ok: true, action: 'create', ...result }, null, 2));
    const check = assertPublicRoot(result.workspaceRoot, {
      title: result.requirementTitle
    });
    if (!check.ok) {
      console.error('创建后校验失败:', check.violations);
      process.exit(1);
    }
    process.exit(0);
  }

  if (params.assertRoot) {
    if (!params.projectDir) {
      console.error('错误: --assert-root 需要 --project-dir');
      process.exit(1);
    }
    const root = path.resolve(params.projectDir);
    const check = assertPublicRoot(root, { title: params.title });
    console.log(JSON.stringify({ workspaceRoot: root, ...check }, null, 2));
    process.exit(check.ok ? 0 : 1);
  }
}

module.exports = {
  SRC_ROOT,
  PROJECT_ROOT,
  DEFAULT_OUTPUT_DIR,
  REQUIRED_DIRS,
  CONTRACT_REL_PATHS,
  PATH_MODES,
  DEFAULT_PATH_MODE,
  PATH_MODE_SCHEMA_VERSION,
  sanitizeTitle,
  extractVersionFolder,
  resolveWorkspaceRelPath,
  isWeeklyIterationTitle,
  buildWeeklySubRequirementTitle,
  normalizePathMode,
  buildPathModeConfig,
  writePathMode,
  readPathMode,
  ensurePathMode,
  createWorkspace,
  xmindFileName,
  getXmindPaths,
  contractPath,
  assertPublicRoot
};

if (require.main === module) {
  main();
}
