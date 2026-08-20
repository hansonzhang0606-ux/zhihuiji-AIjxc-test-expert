/**
 * Stage1 需求下载与命名（Demand 6.0 / S1-01～03）
 *
 * 落盘：{projectDir}/input/需求文档/{requirement_title}.md
 * 禁止以 pageId 作最终主文件名。
 *
 * 用法：
 *   node stage1_download.js --project-dir <工作区> --local-file <path.md> [--title <title>]
 *   node stage1_download.js --project-dir <工作区> --normalize [--title <title>]
 *   node stage1_download.js --project-dir <工作区> --ingest-skill-output <pagesDir> [--title <title>]
 *   node stage1_download.js --project-dir <工作区> --confluence-url <URL> [--title <title>]
 *   node stage1_download.js --self-test
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { sanitizeTitle, sanitizeFileName } = require('../lib/naming');
const {
  assertPublicRoot,
  contractPath,
  SRC_ROOT,
  PROJECT_ROOT
} = require('../lib/workspace');

const SCRIPT_VERSION = '6.0';
const REQ_DIR_REL = 'input/需求文档';

function now() {
  return new Date().toISOString();
}

function log(msg) {
  console.log(`[Stage1 download ${SCRIPT_VERSION}] ${msg}`);
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseArgs(argv) {
  const params = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project-dir' && argv[i + 1]) params.projectDir = argv[++i];
    else if (a === '--local-file' && argv[i + 1]) params.localFile = argv[++i];
    else if (a === '--ingest-skill-output' && argv[i + 1]) params.ingestSkillOutput = argv[++i];
    else if (a === '--confluence-url' && argv[i + 1]) params.confluenceUrl = argv[++i];
    else if (a === '--title' && argv[i + 1]) params.title = argv[++i];
    else if (a === '--parent-title' && argv[i + 1]) params.parentTitle = argv[++i];
    else if (a === '--normalize') params.normalize = true;
    else if (a === '--self-test') params.selfTest = true;
    else if (a === '--help' || a === '-h') params.help = true;
  }
  return params;
}

function printUsage() {
  console.log(`
Stage1 需求下载与命名 (Demand 6.0)

用法:
  node stage1_download.js --project-dir <工作区> --local-file <path.md> [--title <title>]
  node stage1_download.js --project-dir <工作区> --normalize [--title <title>]
  node stage1_download.js --project-dir <工作区> --ingest-skill-output <pagesDir> [--title <title>]
  node stage1_download.js --project-dir <工作区> --confluence-url <URL> [--title <title>]
  node stage1_download.js --self-test

说明:
  --local-file           本地 md 复制到 input/需求文档/{title}.md（S1-03）
  --normalize            规范化已有 md 文件名（剥 title_pageId → title）
  --ingest-skill-output  从任意 pages 目录摄入并命名为 {title}.md
  --confluence-url       登记下载请求；提示用 MCP 拉页后 --local-file / ingest
  --title                覆盖 session_info.requirement_title
`);
}

/** 纯 pageId 主名：全数字（可带 .md） */
function isPageIdOnlyName(basename) {
  const base = String(basename).replace(/\.md$/i, '');
  return /^\d{6,}$/.test(base);
}

/**
 * 从 skill 风格文件名剥掉 _{pageId}
 * 例：客户来源调研弹窗_100655199.md → 客户来源调研弹窗
 */
function stripPageIdSuffix(basename) {
  const noExt = String(basename).replace(/\.md$/i, '');
  const m = noExt.match(/^(.*)_(\d{6,})$/);
  if (m && m[1]) return m[1];
  return noExt;
}

function resolveParentTitle(projectDir, explicit) {
  if (explicit != null && String(explicit).trim() !== '') {
    return String(explicit).trim();
  }
  const sessionPath = contractPath(projectDir, 'sessionInfo');
  if (fs.existsSync(sessionPath)) {
    try {
      const sess = readJson(sessionPath);
      if (sess.source && sess.source.parent_title) {
        return String(sess.source.parent_title).trim();
      }
    } catch (_) {
      /* ignore */
    }
  }
  return null;
}

function resolveRequirementTitle(projectDir, explicitTitle) {
  if (explicitTitle != null && String(explicitTitle).trim() !== '') {
    return sanitizeTitle(explicitTitle);
  }
  const sessionPath = contractPath(projectDir, 'sessionInfo');
  if (fs.existsSync(sessionPath)) {
    try {
      const sess = readJson(sessionPath);
      if (sess.requirement_title) return sanitizeTitle(sess.requirement_title);
    } catch (_) {
      /* ignore */
    }
  }
  // 回退：工作区目录名
  return sanitizeTitle(path.basename(path.resolve(projectDir)));
}

function resolveReqDir(projectDir) {
  const dir = path.join(projectDir, REQ_DIR_REL);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function targetMdPath(projectDir, title) {
  return path.join(resolveReqDir(projectDir), sanitizeFileName(title, '.md'));
}

function assertNotPageIdFinal(filePath) {
  const base = path.basename(filePath);
  if (isPageIdOnlyName(base)) {
    throw new Error(`禁止以 pageId 作为需求文档主名: ${base}`);
  }
}

function writeManifest(projectDir, manifest) {
  const out = path.join(projectDir, 'script', 'stage1', 'download_manifest.json');
  writeJson(out, Object.assign({ schema_version: '6.0', completed_at: now() }, manifest));
  return out;
}

function copyToTarget(srcAbs, destAbs) {
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  fs.copyFileSync(srcAbs, destAbs);
}

/**
 * 本地文件模式（S1-03）
 */
function ingestLocalFile(projectDir, localFile, title) {
  const src = path.resolve(localFile);
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
    throw new Error('本地文件不存在: ' + src);
  }
  const dest = targetMdPath(projectDir, title);
  assertNotPageIdFinal(dest);
  copyToTarget(src, dest);
  const st = fs.statSync(dest);
  if (st.size === 0) throw new Error('落盘文件为空: ' + dest);
  return {
    source: 'local_file',
    source_path: src,
    target_path: path.relative(projectDir, dest).replace(/\\/g, '/'),
    absolute_target: dest,
    bytes: st.size
  };
}

/**
 * 规范化 input/需求文档 下已有 md
 */
function normalizeReqDocs(projectDir, title) {
  const reqDir = resolveReqDir(projectDir);
  const files = fs.readdirSync(reqDir).filter(f => f.toLowerCase().endsWith('.md'));
  if (files.length === 0) {
    throw new Error('input/需求文档/ 下无 .md，无法 normalize');
  }

  const preferred = sanitizeFileName(title, '.md');
  const preferredAbs = path.join(reqDir, preferred);

  // 已有正确名
  if (fs.existsSync(preferredAbs) && fs.statSync(preferredAbs).size > 0) {
    // 清理纯 pageId 文件（不删内容：若是唯一来源则先改名）
    for (const f of files) {
      if (f === preferred) continue;
      if (isPageIdOnlyName(f)) {
        log('  ⚠ 发现 pageId 主名，保留内容已由正确 title 文件覆盖时可手工删除: ' + f);
      }
    }
    return {
      source: 'normalize',
      source_path: preferredAbs,
      target_path: path.relative(projectDir, preferredAbs).replace(/\\/g, '/'),
      absolute_target: preferredAbs,
      bytes: fs.statSync(preferredAbs).size,
      action: 'already_named'
    };
  }

  // 优先：title_pageId.md / 含 title 的 md / 唯一 md
  let candidate = null;
  const titleBase = sanitizeTitle(title);
  for (const f of files) {
    const stripped = sanitizeTitle(stripPageIdSuffix(f), { allowEmpty: true });
    if (stripped === titleBase) {
      candidate = f;
      break;
    }
  }
  if (!candidate) {
    const nonPageId = files.filter(f => !isPageIdOnlyName(f));
    if (nonPageId.length === 1) candidate = nonPageId[0];
    else if (files.length === 1) candidate = files[0];
  }
  if (!candidate) {
    throw new Error(
      '无法自动选定源 md（多文件且无匹配 title）。请 --local-file 指定。现有: ' +
        files.join(', ')
    );
  }

  const srcAbs = path.join(reqDir, candidate);
  if (isPageIdOnlyName(candidate) && !title) {
    throw new Error('源文件名为纯 pageId，必须提供 --title');
  }
  copyToTarget(srcAbs, preferredAbs);
  assertNotPageIdFinal(preferredAbs);
  if (path.resolve(srcAbs) !== path.resolve(preferredAbs)) {
    // 源是错误命名：保留源文件以免丢数据，仅提示
    log('  ✓ 已规范化: ' + candidate + ' → ' + preferred);
  }
  return {
    source: 'normalize',
    source_path: srcAbs,
    target_path: path.relative(projectDir, preferredAbs).replace(/\\/g, '/'),
    absolute_target: preferredAbs,
    bytes: fs.statSync(preferredAbs).size,
    action: 'renamed_from',
    from_name: candidate
  };
}

/**
 * 从外部 pages 目录摄入（任意含 .md 的目录）
 */
function ingestSkillPages(projectDir, pagesDir, title) {
  const dir = path.resolve(pagesDir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error('skill pages 目录不存在: ' + dir);
  }
  const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.md'));
  if (files.length === 0) throw new Error('pages 目录无 .md: ' + dir);

  const titleBase = sanitizeTitle(title);
  let pick = null;
  let pageId = null;
  for (const f of files) {
    const stripped = sanitizeTitle(stripPageIdSuffix(f), { allowEmpty: true });
    const m = String(f).replace(/\.md$/i, '').match(/_(\d{6,})$/);
    if (stripped === titleBase) {
      pick = f;
      pageId = m ? m[1] : null;
      break;
    }
  }
  if (!pick) {
    // 单文件则取之
    if (files.length === 1) {
      pick = files[0];
      const m = String(pick).replace(/\.md$/i, '').match(/_(\d{6,})$/);
      pageId = m ? m[1] : null;
    } else {
      throw new Error(
        'pages 中未找到与 title 匹配的 md。title=' +
          titleBase +
          ' files=' +
          files.join(', ')
      );
    }
  }

  const srcAbs = path.join(dir, pick);
  const dest = targetMdPath(projectDir, title);
  assertNotPageIdFinal(dest);
  copyToTarget(srcAbs, dest);
  return {
    source: 'skill_ingest',
    source_path: srcAbs,
    target_path: path.relative(projectDir, dest).replace(/\\/g, '/'),
    absolute_target: dest,
    bytes: fs.statSync(dest).size,
    page_id: pageId,
    from_name: pick
  };
}

/**
 * Confluence：登记请求 + 指引（真实下载由 MCP/Agent 执行后再 local-file / ingest）
 */
function registerConfluenceRequest(projectDir, url, title) {
  const request = {
    schema_version: '6.0',
    requirement_title: title,
    confluence_url: url,
    status: 'pending_download',
    next_steps: [
      '使用 MCP confluence.get_page（或其它方式）获取页面正文 Markdown',
      '账号可配在 skills/knowledge-base/config/.env（见同目录 .env.example：CONFLUENCE_USERNAME / CONFLUENCE_API_TOKEN）',
      '经本脚本 --local-file <md> 或 --ingest-skill-output <pagesDir> 写入 input/需求文档/{title}.md',
      '也可直接把已有 md 放到 input/需求文档/{title}.md 后 --normalize'
    ],
    created_at: now()
  };
  const reqPath = path.join(projectDir, 'script', 'stage1', 'download_request.json');
  writeJson(reqPath, request);
  return { request, reqPath };
}

function qualityGate(projectDir, title, targetAbs) {
  const checks = [];
  let ok = true;

  const root = assertPublicRoot(projectDir, { title });
  checks.push({
    item: '工作区根目录',
    status: root.ok ? 'passed' : 'failed',
    detail: root.ok ? 'input/output/script' : (root.violations || []).join('; ')
  });
  if (!root.ok) ok = false;

  const exists = fs.existsSync(targetAbs) && fs.statSync(targetAbs).isFile();
  const size = exists ? fs.statSync(targetAbs).size : 0;
  checks.push({
    item: '需求 md 存在非空',
    status: exists && size > 0 ? 'passed' : 'failed',
    detail: exists ? targetAbs + ' (' + size + ' bytes)' : '缺失: ' + targetAbs
  });
  if (!exists || size === 0) ok = false;

  const base = path.basename(targetAbs);
  const pageIdBad = isPageIdOnlyName(base);
  checks.push({
    item: '禁止 pageId 主名',
    status: pageIdBad ? 'failed' : 'passed',
    detail: base
  });
  if (pageIdBad) ok = false;

  const expected = sanitizeFileName(title, '.md');
  checks.push({
    item: '文件名=title',
    status: base === expected ? 'passed' : 'failed',
    detail: 'actual=' + base + ' expected=' + expected
  });
  if (base !== expected) ok = false;

  return { ok, checks };
}

function runSelfTest() {
  const { createWorkspace } = require('../lib/workspace');
  const os = require('os');

  const cases = [
    { name: 'strip', fn: () => stripPageIdSuffix('客户来源_100655199.md') === '客户来源' },
    { name: 'pageIdOnly', fn: () => isPageIdOnlyName('100655199.md') === true },
    { name: 'notPageId', fn: () => isPageIdOnlyName('客户来源.md') === false }
  ];
  let failed = 0;
  for (const c of cases) {
    const pass = !!c.fn();
    console.log((pass ? '✓' : '✗') + ' ' + c.name);
    if (!pass) failed++;
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 's1-dl-'));
  const wsInfo = createWorkspace({
    title: '客户来源调研弹窗',
    outputDir: tmpRoot,
    writeBootstrapConfig: true
  });
  const ws = wsInfo.workspaceRoot;

  const sample = path.join(tmpRoot, 'src.md');
  fs.writeFileSync(sample, '# 客户来源调研弹窗\n\n正文\n', 'utf8');
  const r1 = ingestLocalFile(ws, sample, '客户来源调研弹窗');
  const gate1 = qualityGate(ws, '客户来源调研弹窗', r1.absolute_target);
  console.log((gate1.ok ? '✓' : '✗') + ' local_file gate');
  if (!gate1.ok) {
    console.log(JSON.stringify(gate1.checks, null, 2));
    failed++;
  }

  // skill 风格名 normalize
  const badName = path.join(ws, 'input', '需求文档', '客户来源调研弹窗_100655199.md');
  fs.writeFileSync(badName, '# from skill\n', 'utf8');
  fs.unlinkSync(r1.absolute_target);
  const r2 = normalizeReqDocs(ws, '客户来源调研弹窗');
  const gate2 = qualityGate(ws, '客户来源调研弹窗', r2.absolute_target);
  console.log((gate2.ok ? '✓' : '✗') + ' normalize strip pageId');
  if (!gate2.ok) {
    console.log(JSON.stringify(gate2.checks, null, 2));
    failed++;
  }

  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }

  if (failed > 0) {
    console.error('self-test failed: ' + failed);
    process.exit(1);
  }
  console.log('self-test passed');
  process.exit(0);
}

function main() {
  const params = parseArgs(process.argv.slice(2));
  if (params.help) {
    printUsage();
    process.exit(0);
  }
  if (params.selfTest) {
    runSelfTest();
    return;
  }

  if (!params.projectDir) {
    printUsage();
    process.exit(1);
  }

  const projectDir = path.resolve(params.projectDir);
  if (!fs.existsSync(projectDir)) {
    console.error('错误: project-dir 不存在: ' + projectDir);
    process.exit(1);
  }

  let title;
  try {
    title = resolveRequirementTitle(projectDir, params.title);
  } catch (e) {
    console.error('错误: ' + e.message);
    process.exit(1);
  }

  log('工作区: ' + projectDir);
  log('requirement_title: ' + title);
  const parentTitle = resolveParentTitle(projectDir, params.parentTitle);
  if (parentTitle) log('parent_title: ' + parentTitle);

  let result;
  try {
    if (params.localFile) {
      result = ingestLocalFile(projectDir, params.localFile, title);
      log('✓ 本地文件已落盘: ' + result.target_path);
    } else if (params.ingestSkillOutput) {
      result = ingestSkillPages(projectDir, params.ingestSkillOutput, title);
      log('✓ skill 产物已摄入: ' + result.target_path + (result.page_id ? ' (pageId=' + result.page_id + ')' : ''));
    } else if (params.normalize) {
      result = normalizeReqDocs(projectDir, title);
      log('✓ 已规范化: ' + result.target_path);
    } else if (params.confluenceUrl) {
      const { request, reqPath } = registerConfluenceRequest(
        projectDir,
        params.confluenceUrl,
        title
      );
      writeManifest(projectDir, {
        requirement_title: title,
        source: 'confluence_request',
        source_path: params.confluenceUrl,
        target_path: null,
        confluence_url: params.confluenceUrl,
        page_id: null,
        download_request: path.relative(projectDir, reqPath).replace(/\\/g, '/')
      });
      log('已登记下载请求: ' + reqPath);
      log('请用 MCP 获取正文后执行 --local-file <md> 或 --ingest-skill-output <pagesDir>');
      // 若目标已存在则仍可通过门禁
      const existing = targetMdPath(projectDir, title);
      if (fs.existsSync(existing) && fs.statSync(existing).size > 0) {
        result = {
          source: 'confluence_request',
          source_path: params.confluenceUrl,
          target_path: path.relative(projectDir, existing).replace(/\\/g, '/'),
          absolute_target: existing,
          bytes: fs.statSync(existing).size,
          confluence_url: params.confluenceUrl
        };
        log('○ 检测到已有需求 md，跳过等待下载');
      } else {
        console.log(JSON.stringify({ ok: false, pending: true, request }, null, 2));
        process.exit(2);
      }
    } else {
      // 默认：尝试 normalize（适合用户已丢 md 进目录）
      result = normalizeReqDocs(projectDir, title);
      log('✓ 默认 normalize: ' + result.target_path);
    }
  } catch (e) {
    console.error('错误: ' + e.message);
    process.exit(1);
  }

  const manifestPath = writeManifest(projectDir, {
    requirement_title: title,
    source: result.source,
    source_path: result.source_path,
    target_path: result.target_path,
    confluence_url: result.confluence_url || null,
    page_id: result.page_id || null,
    parent_title: parentTitle,
    bytes: result.bytes,
    from_name: result.from_name || null
  });
  log('✓ manifest: ' + path.relative(projectDir, manifestPath));

  const gate = qualityGate(projectDir, title, result.absolute_target);
  for (const c of gate.checks) {
    log((c.status === 'passed' ? '✓' : '✗') + ' ' + c.item + ': ' + c.detail);
  }

  console.log(
    JSON.stringify(
      {
        ok: gate.ok,
        requirement_title: title,
        target_path: result.target_path,
        source: result.source,
        checks: gate.checks
      },
      null,
      2
    )
  );
  process.exit(gate.ok ? 0 : 1);
}

module.exports = {
  isPageIdOnlyName,
  stripPageIdSuffix,
  ingestLocalFile,
  normalizeReqDocs,
  ingestSkillPages,
  resolveRequirementTitle,
  qualityGate
};

if (require.main === module) {
  main();
}
