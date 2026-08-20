/**
 * Stage 0: 初始化（Demand 6.0）
 *
 * 依据：stages/stage0_init.md
 * 目录：contracts/workspace.md（input/ ∥ output/ ∥ script/；无 story_id）
 *
 * 用法：
 *   # 本地模式（S0-02 验收）：仅按 title 建工作区
 *   node stage0_init.js --title "<需求文档title>" [--output-dir <path>]
 *
 *   # Confluence 模式（保留 V2 两阶段）
 *   node stage0_init.js --confluence-url <URL> [--confluence-metadata '<json>'] [--output-dir <path>]
 *
 * 默认输出根：testcase-generation-skills/output/
 */
const fs = require('fs');
const path = require('path');
const {
  createWorkspace,
  assertPublicRoot,
  ensurePathMode,
  readPathMode,
  normalizePathMode,
  DEFAULT_PATH_MODE,
  DEFAULT_OUTPUT_DIR: WS_DEFAULT_OUTPUT_DIR,
  contractPath
} = require('../lib/workspace');
const { sanitizeTitle, resolveWorkspaceRelPath, isWeeklyIterationTitle } = require('../lib/naming');
const {
  loadKbDotenv,
  getConfluenceAuthFromEnv
} = require(path.join(
  __dirname,
  '..',
  '..',
  '..',
  'skills',
  'knowledge-base',
  'scripts',
  'lib',
  'load_dotenv'
));

// ===== 版本信息 =====
const SCRIPT_VERSION = '6.0';
const STAGE_VERSION = '6.0';

// ===== 路径配置 =====
const SRC_ROOT = path.resolve(__dirname, '..', '..');
const PROJECT_ROOT = path.resolve(SRC_ROOT, '..');
const GLOBAL_ROOT = SRC_ROOT;
const TEMPLATES_SRC = path.join(SRC_ROOT, 'templates');
const DEFAULT_OUTPUT_DIR = WS_DEFAULT_OUTPUT_DIR || path.join(PROJECT_ROOT, 'output');

/**
 * 0.1c 输出路径：默认 testcase-generation-skills/output（禁止默认落到 code/）
 * @param {object} params
 * @returns {string} 绝对路径
 */
function resolveOutputDir(params) {
  const raw = params && params.outputDir ? params.outputDir : DEFAULT_OUTPUT_DIR;
  const abs = path.resolve(raw);
  // 兼容误传旧默认：若用户显式传 …/code 仍可用，但启动时警告
  const norm = abs.replace(/\\/g, '/').toLowerCase();
  if (norm.endsWith('/code') || /\/code$/.test(norm)) {
    console.warn(
      '  [Stage 0 6.0] ⚠ 检测到输出根为历史 code/；Demand 6.0 默认应为 testcase-generation-skills/output/'
    );
  }
  return abs;
}

// ===== 命令行参数解析 =====
function parseArgs() {
  const args = process.argv.slice(2);
  const params = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--title' && args[i + 1]) {
      params.title = args[++i];
    } else if (args[i] === '--confluence-url' && args[i + 1]) {
      params.confluenceUrl = args[++i];
    } else if (args[i] === '--confluence-metadata' && args[i + 1]) {
      params.confluenceMetadataJson = args[++i];
    } else if (args[i] === '--output-dir' && args[i + 1]) {
      params.outputDir = args[++i];
    } else if (args[i] === '--path-mode' && args[i + 1]) {
      params.pathMode = args[++i];
      params.pathModeExplicit = true;
    } else if (args[i] === '--confluence-user' && args[i + 1]) {
      params.confluenceUser = args[++i];
    } else if (args[i] === '--confluence-password' && args[i + 1]) {
      params.confluencePassword = args[++i];
    } else if (args[i] === '--self-check') {
      params.selfCheck = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      printUsage();
      process.exit(0);
    }
  }
  return params;
}

function printUsage() {
  console.log(`
Stage 0: 初始化 (Demand 6.0)

用法:
  node stage0_init.js --self-check
  node stage0_init.js --title "<需求文档title>" [--output-dir <path>] [--path-mode fast|full]
  node stage0_init.js --confluence-url <URL> [--confluence-metadata '<json>'] [--output-dir <path>] [--path-mode fast|full]

参数:
  --self-check           环境自检（依赖 + src/templates）；失败 exit 1
  --title                本地模式：需求文档 title
  --confluence-url       Confluence 需求链接
  --confluence-metadata  页面元数据 JSON
  --output-dir           输出根（默认: testcase-generation-skills/output）
  --path-mode            Fast/Full 路径（默认 fast；显式传入则覆盖已有）
  --confluence-user / --confluence-password  可选凭证
`);
}

// ===== 工具函数 =====
function now() {
  return new Date().toISOString();
}

function nowDisplay() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    return true;
  }
  return false;
}

/** Stage0 模板校验清单（只读 src/templates，不复制到工作区） */
const REQUIRED_TEMPLATE_FILES = [
  '隐式需求惯例.md',
  '质量问题目录.md',
  '模块匹配规则.md',
  '优先级规则.md',
  '标签规则.md',
  '需求文档过滤规则.md',
  '数据模板_用例管理.xlsx',
  '模块矩阵知识库/模块矩阵总览.md'
];
const REQUIRED_TEMPLATE_DIRS = ['模块矩阵知识库'];

/**
 * 从 Confluence URL 中提取 pageId
 * 支持格式：
 *   - https://host/pages/viewpage.action?pageId=123456
 *   - https://host/pages/123456
 *   - https://host/wiki/spaces/KEY/pages/123/Title
 *   - 123456（直接 pageId）
 */
function extractPageId(urlOrId) {
  if (!urlOrId || typeof urlOrId !== 'string') return null;
  const trimmed = urlOrId.trim();

  // 纯数字 pageId
  if (/^\d+$/.test(trimmed)) return trimmed;

  // viewpage.action?pageId=xxx
  const match1 = trimmed.match(/pageId=(\d+)/);
  if (match1) return match1[1];

  // /pages/123456 或 /pages/123/Title
  const match2 = trimmed.match(/\/pages\/(\d+)/);
  if (match2) return match2[1];

  return null;
}

/**
 * 目录名清洗 → 委托 naming.sanitizeTitle（Demand 6.0）
 */
function sanitizeDirName(title) {
  return sanitizeTitle(title);
}

function log(msg) {
  console.log(`  [Stage 0 ${STAGE_VERSION}] ${msg}`);
}

function logStep(step, msg) {
  console.log(`  [Stage 0 ${STAGE_VERSION}] Step ${step}: ${msg}`);
}

// ===== Step 0.1: 参数校验（V2：仅校验 Confluence URL） =====
function step01_validateParams(params) {
  logStep('0.1', '参数校验');
  const errors = [];

  if (!params.confluenceUrl || params.confluenceUrl.trim() === '') {
    errors.push('Confluence 需求文档链接（--confluence-url）不能为空');
  }

  // 提取 pageId（用于初步校验）
  const pageId = params.confluenceUrl ? extractPageId(params.confluenceUrl) : null;
  if (params.confluenceUrl && !pageId) {
    errors.push(
      `无法从链接中提取 pageId: ${params.confluenceUrl}\n` +
      `    支持的格式:\n` +
      `      - https://host/pages/viewpage.action?pageId=123456\n` +
      `      - https://host/pages/123456\n` +
      `      - 123456（直接 pageId）`
    );
  }

  // 解析 Confluence 元数据（如果提供了）
  let metadata = null;
  if (params.confluenceMetadataJson) {
    try {
      metadata = JSON.parse(params.confluenceMetadataJson);
    } catch (err) {
      errors.push(`Confluence 元数据 JSON 解析失败: ${err.message}`);
    }
  }

  if (errors.length > 0) {
    console.error('\n  参数校验失败:');
    errors.forEach(e => console.error(`    - ${e}`));
    console.error('\n  使用方式:');
    console.error('    node stage0_init.js --confluence-url <URL> [--confluence-metadata \'<json>\']');
    process.exit(1);
  }

  log(`  Confluence 链接: ${params.confluenceUrl}`);
  log(`  提取 pageId: ${pageId}`);
  log(`  元数据提供: ${metadata ? '是（将完成初始化）' : '否（仅执行阶段 A）'}`);

  return { confluenceUrl: params.confluenceUrl, pageId, metadata };
}

// ===== Step 0.2: 依赖检查（Skills + Confluence MCP） =====
function step02_checkDependencies(options) {
  const opts = options || {};
  logStep('0.2', '依赖检查');

  const report = {
    check_time: now(),
    skills: {},
    mcp: {},
    confluence_mcp_available: false
  };

  // --- 检查 testcase-generation 框架 ---
  const frameworkExists =
    fs.existsSync(path.join(GLOBAL_ROOT, 'stages')) &&
    fs.existsSync(path.join(GLOBAL_ROOT, 'templates'));
  report.skills['testcase-generation'] = {
    status: frameworkExists ? 'available' : 'not_found',
    path: GLOBAL_ROOT
  };
  if (!frameworkExists) {
    log('  ✗ testcase-generation 框架不完整');
  } else {
    log('  ✓ testcase-generation 框架: available');
  }

  const kbSkill = path.join(GLOBAL_ROOT, '..', 'skills', 'knowledge-base');
  report.skills['knowledge-base'] = {
    status: fs.existsSync(kbSkill) ? 'available' : 'not_found',
    path: kbSkill
  };
  log(
    report.skills['knowledge-base'].status === 'available'
      ? '  ✓ knowledge-base: available'
      : '  ○ knowledge-base: not_found（入库旁路不可用）'
  );

  // --- 检查 Confluence MCP 可用性（可选；需求 md 也可本地自备） ---
  // 注意：真正的 MCP 调用由 LLM 执行，脚本层面仅记录状态占位。
  // 如果 LLM 提供了 metadata，则说明 MCP 可用。
  // 此处通过环境变量或参数标记 MCP 状态。
  const mcpAvailableEnv = process.env.CONFLUENCE_MCP_AVAILABLE;
  // 如果 LLM 编排时提供了 metadata，MCP 一定可用
  const mcpImplied = process.argv.includes('--confluence-metadata');

  if (mcpImplied || mcpAvailableEnv === 'true') {
    report.mcp.confluence_mcp = {
      status: 'available',
      server_name: 'mcp-atlassian',
      tools_verified: [
        'confluence_get_page',
        'confluence_get_page_children',
        'confluence_search'
      ],
      verification_method: mcpImplied ? 'implied_by_metadata' : 'env_variable'
    };
    report.confluence_mcp_available = true;
    log('  ✓ Confluence MCP: available');
  } else {
    report.mcp.confluence_mcp = {
      status: 'unknown',
      note: 'MCP 可用性将在 LLM 调用 confluence_get_page 时验证。若调用成功则 MCP 可用。'
    };
    report.confluence_mcp_available = false;
    log('  ○ Confluence MCP: 待验证（LLM 调用时确认）');
  }

  // 阻塞检查：testcase-generation 必须可用（self-check 用 fatal:false）
  if (!frameworkExists && opts.fatal !== false) {
    log('  ✗ 致命错误: testcase-generation 框架不可用，无法继续');
    process.exit(1);
  }

  report.framework_ok = frameworkExists;
  return report;
}

// ===== Step 0.4: 校验 src/templates（只读，不复制到工作区） =====
function step03_checkResources(_projectDir) {
  logStep('0.4', '校验 src/templates（只读）');

  const report = {
    check_time: now(),
    step: '0.4',
    source_templates: TEMPLATES_SRC,
    copy_to_workspace: false,
    status: 'success',
    issues: [],
    present_files: [],
    missing_files: []
  };

  if (!fs.existsSync(TEMPLATES_SRC)) {
    report.status = 'failed';
    report.issues.push('源模板目录不存在: ' + TEMPLATES_SRC);
    log('  ✗ 源模板目录不存在: ' + TEMPLATES_SRC);
    return report;
  }

  for (let i = 0; i < REQUIRED_TEMPLATE_DIRS.length; i++) {
    const subDir = REQUIRED_TEMPLATE_DIRS[i];
    if (!fs.existsSync(path.join(TEMPLATES_SRC, subDir))) {
      report.issues.push('缺少子目录: ' + subDir);
    }
  }

  for (let i = 0; i < REQUIRED_TEMPLATE_FILES.length; i++) {
    const file = REQUIRED_TEMPLATE_FILES[i];
    const abs = path.join(TEMPLATES_SRC, file);
    if (!fs.existsSync(abs)) {
      report.missing_files.push(file);
      report.issues.push('缺少文件: ' + file);
    } else {
      report.present_files.push(file);
    }
  }

  // S0-04 关键：模块匹配规则 / 标签规则 必须存在
  const critical = ['模块匹配规则.md', '标签规则.md'];
  const missingCritical = critical.filter(function (f) {
    return report.missing_files.indexOf(f) !== -1;
  });
  if (missingCritical.length > 0) {
    report.status = 'failed';
    log('  ✗ 关键模板缺失: ' + missingCritical.join(', '));
  } else if (report.issues.length > 0) {
    report.status = 'warning';
    log('  ⚠ src/templates 不完整，缺少 ' + report.issues.length + ' 项');
    report.issues.forEach(function (i) {
      log('    - ' + i);
    });
  } else {
    log('  ✓ src/templates 完整（' + report.present_files.length + ' 个必需文件）');
    log('  ✓ 不复制到工作区；后续 Stage 直接读: ' + TEMPLATES_SRC);
  }

  return report;
}

// ===== Step 0.1b: Confluence 凭证检查（demand §3.2） =====
function step04_checkCredentials(params) {
  logStep('0.1b', 'Confluence 凭证检查');

  const report = {
    check_time: now(),
    step: '0.1b',
    user_provided: false,
    password_provided: false,
    auth_method: 'none',
    verified: false,
    status: 'not_configured',
    action_required: null,
    hint: null
  };

  // 优先级 1: 命令行参数
  if (params.confluenceUser && params.confluencePassword) {
    report.user_provided = true;
    report.password_provided = true;
    report.auth_method = 'cli_args';
    report.status = 'configured';
    log('  ✓ Confluence 凭证: 通过命令行参数提供');
    return report;
  }

  // 优先级 2/3: 已有 process.env + 合并加载 .env 候选路径
  // （含 skills/knowledge-base/config/.env、src/config/.env、~/.testcase-kb/.env）
  const dotenvInfo = loadKbDotenv({ workspaceRoot: PROJECT_ROOT });
  const auth = getConfluenceAuthFromEnv();
  if (auth.present) {
    report.user_provided = true;
    report.password_provided = true;
    report.auth_method = dotenvInfo.keys.some((k) => /^CONFLUENCE_/.test(k))
      ? 'env_file'
      : 'env';
    report.status = 'configured';
    if (dotenvInfo.loadedFrom) report.env_file = dotenvInfo.loadedFrom;
    log(
      report.auth_method === 'env_file'
        ? '  ✓ Confluence 凭证: 通过 .env 提供' +
            (report.env_file ? ' (' + report.env_file + ')' : '')
        : '  ✓ Confluence 凭证: 通过环境变量提供'
    );
    return report;
  }

  // 未配置 → 索取提示（不阻断本地 --title；Confluence 模式需人工补凭证或改本地 md）
  const skillEnv = path.join(PROJECT_ROOT, 'skills', 'knowledge-base', 'config', '.env');
  const srcEnv = path.join(SRC_ROOT, 'config', '.env');
  const homeEnv = path.join(require('os').homedir(), '.testcase-kb', '.env');
  report.status = 'not_configured';
  report.action_required = 'ask_user_for_credentials_or_use_local_md';
  report.hint =
    '无 Confluence 凭证：请提供账号，或改用 --title 本地模式并把需求 md 放入 input/需求文档/';
  log('  ⚠ Confluence 凭证未配置（0.1b）');
  log('  ────────────────────────────────────────');
  log('    在线拉取 Confluence 需要凭证。请任选其一：');
  log('');
  log('    方式 1: 命令行');
  log('      --confluence-user <账号> --confluence-password <密码或Token>');
  log('');
  log('    方式 2: 环境变量');
  log('      set CONFLUENCE_USERNAME=<账号>     # Windows PowerShell: $env:CONFLUENCE_USERNAME=...');
  log('      set CONFLUENCE_API_TOKEN=<Token>');
  log('');
  log('    方式 3: .env（推荐复制 skills/.../config/.env.example）');
  log('      ' + skillEnv);
  log('      ' + srcEnv);
  log('      ' + homeEnv);
  log('      CONFLUENCE_BASE_URL=https://finkms.kingdee.com');
  log('      CONFLUENCE_USERNAME=<账号>');
  log('      CONFLUENCE_API_TOKEN=<Token或密码>');
  log('');
  log('    方式 4: 不走 Confluence（本地 md）');
  log('      node stage0_init.js --title "<需求文档title>"');
  log('      然后将 md 放入 output/<title>/input/需求文档/');
  log('  ────────────────────────────────────────');

  return report;
}

// ===== Step 0.5: Confluence 页面元数据处理 =====
function step05_processConfluenceMetadata(validatedParams, credentialsReport) {
  logStep('0.5', 'Confluence 页面元数据处理');

  const metadata = validatedParams.metadata;

  if (!metadata) {
    // 阶段 A：无元数据，输出请求文件供 LLM 读取
    log('  ○ Confluence 元数据未提供，进入阶段 A（环境准备）');
    log('  ○ LLM 需调用 Confluence MCP 工具获取页面信息后重新执行');

    return {
      phase: 'A',
      metadata_request: {
        action_required: 'LLM 需调用 Confluence MCP 获取页面信息',
        mcp_tool: 'mcp__mcp-atlassian__confluence_get_page',
        mcp_params: {
          page_id: validatedParams.pageId,
          include_metadata: true
        },
        also_suggested: {
          mcp_tool: 'mcp__mcp-atlassian__confluence_get_page_children',
          mcp_params: {
            parent_id: validatedParams.pageId,
            limit: 50
          }
        },
        expected_metadata_format: {
          page_id: 'string (页面 ID)',
          title: 'string (页面标题 → 作为需求标题)',
          parent_title: 'string (父页面标题 → 定产品线：星火/智慧记/零售)',
          parent_id: 'string (父页面 ID，可选)',
          space_key: 'string (空间 Key)',
          version: 'number (版本号)',
          child_page_count: 'number (子页面数)',
          page_tree: 'array (子页面树结构，可选)'
        }
      },
      requirement_title: null
    };
  }

  // 阶段 B：有元数据，解析并提取需求标题
  log('  ✓ Confluence 元数据已提供，进入阶段 B（完成初始化）');

  const pageId = metadata.page_id || validatedParams.pageId;
  const title = metadata.title;
  const parentTitle = metadata.parent_title || metadata.parent?.title || '';
  const parentId = metadata.parent_id || metadata.parent?.id || null;
  const spaceKey = metadata.space_key || '';
  const version = metadata.version || 0;
  const childPageCount = metadata.child_page_count || 0;
  const pageTree = metadata.page_tree || [];

  if (!title || typeof title !== 'string' || title.trim() === '') {
    log('  ✗ 元数据中缺少 title 字段，无法确定需求标题');
    process.exit(1);
  }

  log(`  ✓ 页面 ID:    ${pageId}`);
  log(`  ✓ 需求标题:   ${title}`);
  if (parentTitle) log(`  ✓ 父级页面:   ${parentTitle}`);
  log(`  ✓ 空间 Key:   ${spaceKey}`);
  log(`  ✓ 版本号:     v${version}`);
  log(`  ✓ 子页面数:   ${childPageCount}`);

  return {
    phase: 'B',
    pageId,
    requirement_title: title.trim(),
    parent_title: parentTitle ? String(parentTitle).trim() : null,
    parent_id: parentId,
    space_key: spaceKey,
    version,
    child_page_count: childPageCount,
    page_tree: pageTree,
    confluence_url: validatedParams.confluenceUrl
  };
}

// ===== Step 0.6: 工作目录生成（Demand 6.0 §3.3） =====
function step06_initWorkDir(params) {
  logStep('0.6', '工作目录生成');

  const outputDir = resolveOutputDir(params);
  log('  ✓ 输出根(0.1c): ' + outputDir);
  const title = params.requirement_title;
  const rel = resolveWorkspaceRelPath(title);
  const dirExistsBefore = fs.existsSync(path.join(outputDir, rel.relativePath));

  const ws = createWorkspace({
    title: title,
    outputDir: outputDir,
    writeBootstrapConfig: true,
    pathMode: params.pathMode,
    forcePathMode: !!params.pathModeExplicit
  });

  if (rel.versionFolder) {
    log('  ✓ 版本目录: ' + rel.versionFolder + '/');
  } else {
    log('  · 标题无版本前缀，工作区直接落在 output/ 下');
  }
  if (ws.isWeeklyIteration) {
    log('  ⚠ 检测到「周迭代」总览页：下载后须拆分子需求，勿整页当单需求跑完');
  }

  if (dirExistsBefore) {
    log('  ⚠ 需求工作空间已存在: ' + (ws.workspaceRel || ws.requirementTitle) + '/');
    log('    已对齐/补齐 §3.3 目录');
  } else {
    log('  ✓ 创建需求工作空间: ' + (ws.workspaceRel || ws.requirementTitle) + '/');
  }
  log('  ✓ 根目录仅允许: input/ | output/ | script/');
  log('  ✓ 目录项: ' + ws.createdDirs.length);

  return {
    outputDir: ws.outputDir,
    projectDir: ws.workspaceRoot,
    dirName: ws.requirementTitle,
    requirementTitle: ws.requirementTitle,
    versionFolder: ws.versionFolder || null,
    workspaceRel: ws.workspaceRel || rel.relativePath.replace(/\\/g, '/'),
    isWeeklyIteration: !!ws.isWeeklyIteration,
    dirStatus: dirExistsBefore ? 'used_existing' : 'created',
    createdDirs: ws.createdDirs
  };
}

// ===== Step 0.7: 配置文件生成 → script/config/ =====
function step07_generateConfigs(params, dirInfo, depsReport, credentialsReport, resourceReport) {
  logStep('0.7', '配置文件生成');

  const configDir = path.join(dirInfo.projectDir, 'script', 'config');
  ensureDir(configDir);

  const sourceType = params.source_type || (params.pageId ? 'confluence' : 'local');

  const sessionInfo = {
    requirement_title: dirInfo.requirementTitle || sanitizeTitle(params.requirement_title),
    schema_version: '6.0',
    script_version: SCRIPT_VERSION,
    created_at: now(),
    version_folder: dirInfo.versionFolder || null,
    workspace_rel: dirInfo.workspaceRel || null,
    is_weekly_iteration:
      dirInfo.isWeeklyIteration != null
        ? !!dirInfo.isWeeklyIteration
        : isWeeklyIterationTitle(params.requirement_title),
    source: {
      type: sourceType,
      confluence_url: params.confluence_url || null,
      confluence_page_id: params.pageId || null,
      confluence_space_key: params.space_key || null,
      confluence_version: params.version != null ? params.version : null,
      parent_title: params.parent_title || null,
      parent_id: params.parent_id || null,
      child_page_count: params.child_page_count != null ? params.child_page_count : null
    },
    work_directory: {
      base_path: dirInfo.outputDir,
      workspace_root: dirInfo.projectDir,
      dir_name: dirInfo.dirName,
      version_folder: dirInfo.versionFolder || null,
      workspace_rel: dirInfo.workspaceRel || null,
      directory_status: dirInfo.dirStatus
    },
    confluence: {
      user_provided: !!(credentialsReport && credentialsReport.user_provided),
      password_provided: !!(credentialsReport && credentialsReport.password_provided),
      auth_method: (credentialsReport && credentialsReport.auth_method) || 'none',
      verified: !!(credentialsReport && credentialsReport.verified),
      note:
        credentialsReport && credentialsReport.status === 'configured'
          ? '凭证已获取（不存储明文）'
          : '未配置或本地模式'
    },
    dependencies: {
      testcase_generation_skill:
        depsReport && depsReport.skills && depsReport.skills['testcase-generation']
          ? depsReport.skills['testcase-generation'].status
          : 'unknown',
      confluence_mcp: depsReport && depsReport.confluence_mcp_available ? 'available' : 'unknown',
      knowledge_base_skill:
        depsReport &&
        depsReport.skills &&
        depsReport.skills['knowledge-base'] &&
        depsReport.skills['knowledge-base'].status === 'available'
          ? 'available'
          : 'not_found'
    },
    templates: {
      source: TEMPLATES_SRC,
      copy_to_workspace: false,
      check_status: resourceReport ? resourceReport.status : 'skipped',
      present_files: (resourceReport && resourceReport.present_files) || []
    }
  };
  writeJson(path.join(configDir, 'session_info.json'), sessionInfo);
  log('  ✓ 已生成: script/config/session_info.json');

  const validationRules = {
    version: SCRIPT_VERSION,
    created_at: now(),
    rules: {
      atomicity: {
        description: '测试用例原子性校验',
        threshold: 0.95,
        check_method: 'no_cross_reference'
      },
      completeness: {
        description: '测试用例完整性校验',
        threshold: 0.98,
        required_fields: ['title', 'precondition', 'steps', 'module_l1', 'priority']
      },
      executability: {
        description: '测试用例可执行性校验',
        threshold: 0.9,
        min_step_length: 3,
        min_precondition_length: 5
      },
      step_expectation_mapping: {
        description: '步骤-期望结果对应性校验',
        threshold: 1.0,
        rule: 'one_to_one'
      }
    }
  };
  writeJson(path.join(configDir, 'validation_rules.json'), validationRules);
  log('  ✓ 已生成: script/config/validation_rules.json');

  const progressTracker = {
    schema_version: '6.0',
    created_at: now(),
    stage0_completed: false,
    test_context_approved: false,
    stage1_approved: false,
    stage3_approved: false,
    current: 'stage0',
    stages: {
      stage0: { status: 'in_progress', started_at: now() },
      stage1: { status: 'pending' },
      stage2: { status: 'pending', note: '可选' },
      stage3: { status: 'pending' },
      stage4: { status: 'pending' }
    }
  };
  writeJson(path.join(configDir, 'progress_tracker.json'), progressTracker);
  log('  ✓ 已生成: script/config/progress_tracker.json');

  const pathModeResult = ensurePathMode(dirInfo.projectDir, {
    mode: params.pathMode != null ? params.pathMode : DEFAULT_PATH_MODE,
    force: !!params.pathModeExplicit
  });
  const pathMode = pathModeResult.config;
  log(
    '  ✓ ' +
      (pathModeResult.written ? '已写入' : '已确认') +
      ': script/config/path_mode.json (mode=' +
      pathMode.mode +
      ')'
  );

  return { sessionInfo, validationRules, progressTracker, pathMode };
}

// ===== Step 0.8: 初始化结果校验（§3.3） =====
function step08_validateInit(
  projectDir,
  depsReport,
  resourceReport,
  configs,
  credentialsReport,
  confluenceInfo
) {
  logStep('0.8', '初始化结果校验');

  const checks = [];
  let allPassed = true;

  const title =
    (configs && configs.sessionInfo && configs.sessionInfo.requirement_title) ||
    (confluenceInfo && confluenceInfo.requirement_title) ||
    null;

  const rootCheckResult = assertPublicRoot(projectDir, { title: title });
  const dirCheck = {
    item: '目录结构完整性(§3.3)',
    status: rootCheckResult.ok ? 'passed' : 'failed',
    detail: rootCheckResult.ok
      ? '根下仅 input/output/script，input 中文子目录齐全'
      : (rootCheckResult.violations || []).join('; ')
  };
  checks.push(dirCheck);
  if (dirCheck.status === 'failed') allPassed = false;

  const requiredConfigs = ['session_info.json', 'progress_tracker.json', 'path_mode.json'];
  const missingConfigs = requiredConfigs.filter(
    f => !fs.existsSync(path.join(projectDir, 'script', 'config', f))
  );
  const configCheck = {
    item: '配置文件完整性',
    status: missingConfigs.length === 0 ? 'passed' : 'failed',
    detail:
      missingConfigs.length === 0
        ? 'script/config 必需文件已生成'
        : '缺失: ' + missingConfigs.join(', ')
  };
  checks.push(configCheck);
  if (configCheck.status === 'failed') allPassed = false;

  const pathModeCheckResult = readPathMode(projectDir);
  const pathModeCheck = {
    item: 'path_mode（fast|full）',
    status: pathModeCheckResult.ok ? 'passed' : 'failed',
    detail: pathModeCheckResult.ok
      ? 'mode=' + pathModeCheckResult.config.mode
      : pathModeCheckResult.error || 'path_mode 非法'
  };
  checks.push(pathModeCheck);
  if (pathModeCheck.status === 'failed') allPassed = false;

  const sessionPath = path.join(projectDir, 'script', 'config', 'session_info.json');
  let sessionOk = false;
  let sessionDetail = 'session_info 不可读';
  if (fs.existsSync(sessionPath)) {
    try {
      const sess = readJson(sessionPath);
      if (sess.story_id != null) sessionDetail = '禁止出现 story_id 字段';
      else if (!sess.requirement_title) sessionDetail = '缺少 requirement_title';
      else {
        sessionOk = true;
        sessionDetail = 'requirement_title=' + sess.requirement_title;
      }
    } catch (e) {
      sessionDetail = e.message;
    }
  }
  checks.push({
    item: 'session_info 主键',
    status: sessionOk ? 'passed' : 'failed',
    detail: sessionDetail
  });
  if (!sessionOk) allPassed = false;

  if (depsReport) {
    checks.push({
      item: 'Confluence MCP 可用性',
      status: depsReport.confluence_mcp_available ? 'passed' : 'warning',
      detail: depsReport.confluence_mcp_available
        ? 'Confluence MCP 可用'
        : 'Confluence MCP 待验证或本地模式'
    });
  }

  if (resourceReport) {
    const templateCheck = {
      item: 'src/templates 可用性(只读)',
      status: resourceReport.status !== 'failed' ? 'passed' : 'failed',
      detail:
        resourceReport.status === 'success'
          ? '已校验 ' +
            ((resourceReport.present_files && resourceReport.present_files.length) || 0) +
            ' 个文件 @ ' +
            TEMPLATES_SRC +
            '（不复制）'
          : '模板问题: ' +
            ((resourceReport.issues || []).join('; ') || resourceReport.status)
    };
    checks.push(templateCheck);
    if (templateCheck.status === 'failed') allPassed = false;
  }

  if (credentialsReport) {
    checks.push({
      item: 'Confluence 凭证配置',
      status: credentialsReport.status === 'configured' ? 'passed' : 'warning',
      detail:
        credentialsReport.status === 'configured'
          ? '凭证已配置 (auth_method: ' + credentialsReport.auth_method + ')'
          : '凭证未配置或本地模式'
    });
  }

  const initReport = {
    report_id: 'INIT-' + Date.now(),
    report_time: now(),
    stage_version: STAGE_VERSION,
    project_directory: projectDir,
    overall_status: allPassed ? 'passed' : 'failed',
    checks,
    summary: {
      total_checks: checks.length,
      passed: checks.filter(c => c.status === 'passed').length,
      failed: checks.filter(c => c.status === 'failed').length,
      warning: checks.filter(c => c.status === 'warning').length
    }
  };

  writeJson(
    path.join(projectDir, 'script', 'logs', 'initialization_report.json'),
    initReport
  );
  return { initReport, allPassed, checks };
}


// ===== 阶段 A 输出：输出元数据请求文件 =====
function writeMetadataRequest(validatedParams, depsReport, credentialsReport, resourceReport, outputDir) {
  const logsDir = path.join(outputDir || DEFAULT_OUTPUT_DIR, '_pending');
  ensureDir(logsDir);

  // 保存阶段 A 的中间结果
  const phaseAResult = {
    phase: 'A',
    completed_at: now(),
    confluence_url: validatedParams.confluenceUrl,
    page_id: validatedParams.pageId,
    dependencies: depsReport,
    credentials: {
      user_provided: credentialsReport.user_provided,
      password_provided: credentialsReport.password_provided,
      auth_method: credentialsReport.auth_method,
      status: credentialsReport.status
    },
    resources: resourceReport,
    metadata_request: {
      action_required: 'LLM 需调用 Confluence MCP 获取页面信息',
      mcp_tool: 'mcp__mcp-atlassian__confluence_get_page',
      mcp_params: {
        page_id: validatedParams.pageId,
        include_metadata: true
      },
      also_suggested: {
        mcp_tool: 'mcp__mcp-atlassian__confluence_get_page_children',
        mcp_params: {
          parent_id: validatedParams.pageId,
          limit: 50
        }
      },
      expected_metadata_format: {
        page_id: 'string',
        title: 'string → 作为需求标题',
        space_key: 'string',
        version: 'number',
        child_page_count: 'number',
        page_tree: 'array (可选)'
      }
    },
    resume_command_template:
      `node stage0_init.js --confluence-url ${validatedParams.confluenceUrl} ` +
      `--confluence-metadata '<metadata_json>'`
  };

  const requestPath = path.join(logsDir, `phase_a_${validatedParams.pageId}.json`);
  writeJson(requestPath, phaseAResult);

  return { phaseAResult, requestPath };
}

// ===== 输出汇总 =====
function printPhaseASummary(validatedParams, depsReport, credentialsReport, resourceReport, phaseAInfo) {
  console.log('');
  log('═══════════════════════════════════════════════════');
  log('  Stage 0 V2: 阶段 A 完成（环境准备）');
  log('═══════════════════════════════════════════════════');
  log(`  Confluence 链接:  ${validatedParams.confluenceUrl}`);
  log(`  提取 pageId:      ${validatedParams.pageId}`);
  log(`  testcase-generation: ${depsReport.skills['testcase-generation']?.status || 'unknown'}`);
  log(`  knowledge-base:    ${(depsReport.skills['knowledge-base'] && depsReport.skills['knowledge-base'].status) || 'unknown'}`);
  log(`  Confluence MCP:    ${depsReport.confluence_mcp_available ? 'available' : '待验证（可用本地 md）'}`);
  log(`  凭证状态:          ${credentialsReport.status}`);
  log(`  模板资源:          ${resourceReport.status}`);
  log('');
  log('  ── 下一步：LLM 需调用 Confluence MCP 获取页面信息 ──');
  log('');
  log('  MCP 工具: mcp__mcp-atlassian__confluence_get_page');
  log(`  参数:     page_id = "${validatedParams.pageId}"`);
  log('');
  log('  获取后，将元数据作为 JSON 传入完成初始化:');
  log(`  ${phaseAInfo.phaseAResult.resume_command_template}`);
  log('');
  log(`  阶段 A 中间结果已保存: ${phaseAInfo.requestPath}`);
  log('═══════════════════════════════════════════════════');
}

function printPhaseBSummary(dirInfo, configs, depsReport, credentialsReport, resourceReport, confluenceInfo, validationResult) {
  console.log('');
  const title =
    (configs.sessionInfo && configs.sessionInfo.requirement_title) ||
    dirInfo.requirementTitle ||
    '';
  if (validationResult.allPassed) {
    log('═══════════════════════════════════════════════════');
    log('  Stage 0: 初始化完成 — 校验通过 (6.0)');
    log('═══════════════════════════════════════════════════');
    log(`  需求标题:        ${title}`);
    if (confluenceInfo && confluenceInfo.pageId) {
      log(`  Confluence 页面:  ${confluenceInfo.pageId}`);
      log(`  Confluence URL:   ${confluenceInfo.confluence_url || ''}`);
    } else {
      log('  来源:            本地 title 模式');
    }
    log(`  工作目录:        ${dirInfo.projectDir}`);
    log(`  目录状态:        ${dirInfo.dirStatus}`);
    if (credentialsReport) {
      log(`  凭证状态:        ${credentialsReport.status} (${credentialsReport.auth_method})`);
    }
    if (resourceReport) {
      log(
        '  模板:            src/templates 只读校验 ' +
          (resourceReport.status || '') +
          '（不复制到工作区）'
      );
    }
    log(
      `  校验结果:        ${validationResult.checks.length} 项，` +
        `${validationResult.checks.filter(c => c.status === 'passed').length} 通过，` +
        `${validationResult.checks.filter(c => c.status === 'warning').length} 警告`
    );
    log('═══════════════════════════════════════════════════');
    log('');
    log('  下一步: Stage 1（下载或放入 input/需求文档/）');
  } else {
    log('═══════════════════════════════════════════════════');
    log('  Stage 0: 初始化完成 — 校验失败');
    log('═══════════════════════════════════════════════════');
    validationResult.checks
      .filter(c => c.status === 'failed')
      .forEach(c => {
        log(`  ✗ ${c.item}: ${c.detail}`);
      });
    log('═══════════════════════════════════════════════════');
    process.exit(1);
  }
}

function runInitForTitle(params, title, sourceExtras) {
  // 0.1c：解析并打印默认/指定输出根
  params.outputDir = resolveOutputDir(params);
  logStep('0.1c', '输出路径');
  log('  ✓ 默认/指定输出根: ' + params.outputDir);
  log('  ✓ （Demand 6.0 默认 = testcase-generation-skills/output）');

  const depsReport = step02_checkDependencies();
  const resourceReport = step03_checkResources(null);
  const credentialsReport =
    params.confluenceUrl || params.confluenceUser
      ? step04_checkCredentials(params)
      : {
          check_time: now(),
          step: '0.1b',
          user_provided: false,
          password_provided: false,
          auth_method: 'none',
          verified: false,
          status: 'local_mode',
          action_required: null,
          hint: '本地 --title 模式，跳过 Confluence 凭证'
        };

  if (credentialsReport.status === 'local_mode') {
    logStep('0.1b', 'Confluence 凭证检查');
    log('  ○ 本地模式：跳过凭证（后续可补 Confluence 或继续用本地 md）');
  }

  const dirInfo = step06_initWorkDir({
    outputDir: params.outputDir,
    requirement_title: title,
    pathMode: params.pathMode,
    pathModeExplicit: params.pathModeExplicit
  });

  const configParams = Object.assign(
    {
      requirement_title: title,
      source_type: sourceExtras && sourceExtras.source_type ? sourceExtras.source_type : 'local',
      pathMode: params.pathMode,
      pathModeExplicit: params.pathModeExplicit
    },
    sourceExtras || {}
  );

  const configs = step07_generateConfigs(
    configParams,
    dirInfo,
    depsReport,
    credentialsReport,
    resourceReport
  );

  const confluenceInfo = Object.assign(
    { requirement_title: title, pageId: null },
    sourceExtras || {}
  );

  const validationResult = step08_validateInit(
    dirInfo.projectDir,
    depsReport,
    resourceReport,
    configs,
    credentialsReport,
    confluenceInfo
  );

  printPhaseBSummary(
    dirInfo,
    configs,
    depsReport,
    credentialsReport,
    resourceReport,
    confluenceInfo,
    validationResult
  );

  if (validationResult.allPassed) {
    const progressPath = path.join(
      dirInfo.projectDir,
      'script',
      'config',
      'progress_tracker.json'
    );
    const progress = readJson(progressPath);
    progress.stages.stage0.status = 'completed';
    progress.stages.stage0.completed_at = now();
    progress.stage0_completed = true;
    progress.current = 'stage1';
    writeJson(progressPath, progress);
  }

  return { dirInfo, configs, validationResult };
}

/**
 * S0-05：环境自检（不建工作区）
 * 失败条件（exit 1）：
 *   - src 缺 stages/templates
 *   - src/templates 缺关键文件（module_mapping / tag_rules 等）
 *   - scripts/lib 缺 naming/workspace/validate/xmind_export
 *   - npm 依赖 ajv / adm-zip 无法 require
 * 警告不失败：MCP / knowledge-base 未配置
 */
function runSelfCheck() {
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  Stage 0: --self-check (S0-05)');
  console.log('═══════════════════════════════════════════════════');
  console.log('');

  const checks = [];
  let ok = true;

  function add(name, passed, detail, level) {
    const item = {
      name: name,
      status: passed ? 'passed' : level === 'warn' ? 'warning' : 'failed',
      detail: detail
    };
    checks.push(item);
    const mark = passed ? '✓' : level === 'warn' ? '○' : '✗';
    log('  ' + mark + ' ' + name + ': ' + detail);
    if (!passed && level !== 'warn') ok = false;
  }

  const deps = step02_checkDependencies({ fatal: false });
  add(
    'framework',
    !!deps.framework_ok,
    deps.framework_ok
      ? 'src/stages + src/templates 存在'
      : '缺少 src/stages 或 src/templates'
  );
  add(
    'knowledge-base',
    !!(deps.skills && deps.skills['knowledge-base'] && deps.skills['knowledge-base'].status === 'available'),
    deps.skills && deps.skills['knowledge-base'] && deps.skills['knowledge-base'].status === 'available'
      ? 'available'
      : 'not_found（入库旁路不可用；用例生成可继续）',
    'warn'
  );

  const tpl = step03_checkResources(null);
  const tplOk = tpl.status !== 'failed';
  add(
    'templates',
    tplOk,
    tplOk
      ? 'src/templates 关键文件齐全（含 模块匹配规则 / 标签规则）'
      : (tpl.issues || []).join('; ') || 'templates 校验失败'
  );

  const libFiles = [
    'naming.js',
    'workspace.js',
    'validate.js',
    'xmind_export.js'
  ];
  const libDir = path.join(SRC_ROOT, 'scripts', 'lib');
  const missingLib = libFiles.filter(function (f) {
    return !fs.existsSync(path.join(libDir, f));
  });
  add(
    'scripts/lib',
    missingLib.length === 0,
    missingLib.length === 0
      ? 'naming/workspace/validate/xmind_export 齐全'
      : '缺少: ' + missingLib.join(', ')
  );

  const npmMods = ['ajv', 'adm-zip', 'ajv-formats'];
  const missingNpm = [];
  for (let i = 0; i < npmMods.length; i++) {
    try {
      require(npmMods[i]);
    } catch (e) {
      missingNpm.push(npmMods[i]);
    }
  }
  add(
    'npm-deps',
    missingNpm.length === 0,
    missingNpm.length === 0
      ? 'ajv / adm-zip / ajv-formats 可加载'
      : '请在 src/scripts 执行 npm install；缺少: ' + missingNpm.join(', ')
  );

  const outRoot = resolveOutputDir({});
  add(
    'output-default',
    /output$/i.test(outRoot.replace(/\\/g, '/').replace(/\/$/, '')),
    '默认输出根: ' + outRoot
  );

  const result = {
    ok: ok,
    stage: 'stage0_self_check',
    schema_version: '6.0',
    checked_at: now(),
    default_output_dir: outRoot,
    templates_root: TEMPLATES_SRC,
    checks: checks
  };

  console.log('');
  console.log(JSON.stringify(result, null, 2));
  console.log('');
  if (!ok) {
    log('── self-check 失败（exit 1）──');
    process.exit(1);
  }
  log('── self-check 通过（exit 0）──');
  return result;
}

// ===== 主流程 =====
function main() {
  const params = parseArgs();

  if (params.selfCheck) {
    runSelfCheck();
    return;
  }

  // S0-06：提前校验 --path-mode
  if (params.pathModeExplicit || params.pathMode != null) {
    try {
      params.pathMode = normalizePathMode(params.pathMode);
    } catch (e) {
      console.error('错误: ' + e.message);
      process.exit(1);
    }
  } else {
    params.pathMode = DEFAULT_PATH_MODE;
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Stage 0: 初始化 (${STAGE_VERSION}) — 开始执行`);
  console.log('═══════════════════════════════════════════════════');
  console.log('');

  // 本地模式：--title（S0-02 验收）
  if (params.title && !params.confluenceUrl) {
    runInitForTitle(params, params.title.trim(), { source_type: 'local' });
    return;
  }

  if (!params.confluenceUrl && !params.title) {
    printUsage();
    process.exit(1);
  }

  // Confluence 模式
  params.outputDir = resolveOutputDir(params);
  logStep('0.1c', '输出路径');
  log('  ✓ 输出根: ' + params.outputDir);

  const validatedParams = step01_validateParams(params);
  const depsReport = step02_checkDependencies();
  const resourceReportPre = step03_checkResources(null);
  const credentialsReport = step04_checkCredentials(params);
  const confluenceInfo = step05_processConfluenceMetadata(
    validatedParams,
    credentialsReport
  );

  if (confluenceInfo.phase === 'A') {
    // 无凭证时阶段 A 仍可出元数据请求，但明确要求人工补凭证或改本地模式
    if (credentialsReport.status === 'not_configured') {
      log('');
      log('  ⚠ 0.1b：当前无凭证。继续前请：');
      log('    - 提供凭证后重跑；或');
      log('    - 改用: node stage0_init.js --title "<页面title>"');
    }
    const phaseAInfo = writeMetadataRequest(
      validatedParams,
      depsReport,
      credentialsReport,
      resourceReportPre,
      params.outputDir
    );
    printPhaseASummary(
      validatedParams,
      depsReport,
      credentialsReport,
      resourceReportPre,
      phaseAInfo
    );
    return;
  }

  runInitForTitle(params, confluenceInfo.requirement_title, {
    source_type: 'confluence',
    pageId: confluenceInfo.pageId,
    space_key: confluenceInfo.space_key,
    version: confluenceInfo.version,
    child_page_count: confluenceInfo.child_page_count,
    confluence_url: confluenceInfo.confluence_url,
    parent_title: confluenceInfo.parent_title,
    parent_id: confluenceInfo.parent_id
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  resolveOutputDir,
  step04_checkCredentials,
  step02_checkDependencies,
  step03_checkResources,
  runSelfCheck,
  DEFAULT_OUTPUT_DIR,
  PROJECT_ROOT,
  TEMPLATES_SRC,
  SCRIPT_VERSION
};
