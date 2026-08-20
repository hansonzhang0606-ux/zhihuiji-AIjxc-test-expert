/**
 * Demand 6.0 文件名 / 目录名清洗（FOUND-04）
 *
 * 规则（对齐 demand6.0 §3.5）：
 * - 去掉 Windows/跨平台非法字符：\ / : * ? " < > |
 * - 连续空白 → 单下划线 _
 * - 压缩连续 _，去掉首尾 _
 * - 默认最大长度 80，截断后去掉尾部 _
 * - 不拼接业务编号；调用方只传入需求文档 title 或文档标题
 *
 * 版本维度目录（output/ 下）：
 * - 标题以 v4.6.0 / V4.6.0 等形式开头 → 工作区落在 output/v4.6.0/{title}/
 * - 标题无版本前缀 → 直接落在 output/{title}/
 *
 * 周迭代子需求命名：
 * - v4.6.0_周迭代_{子需求名称}
 *
 * CLI:
 *   node scripts/lib/naming.js --sanitize "客户来源调研弹窗【国际版】"
 *   node scripts/lib/naming.js --file "销售单保存.md"
 *   node scripts/lib/naming.js --workspace-rel "V4.6.0 【APP】示例"
 *   node scripts/lib/naming.js --self-test
 */
'use strict';

const path = require('path');

const DEFAULT_MAX_LEN = 80;
const ILLEGAL = /[\\/:*?"<>|]/g;
/** 标题开头的版本号，如 V4.6.0 / v4.6.0（后可接空格、下划线、【 等，不能再用 \b：_ 算单词字符） */
const VERSION_PREFIX_RE = /^[vV]?(\d+\.\d+\.\d+)(?![.\d])/;

/**
 * @param {unknown} raw
 * @param {object} [opts]
 * @param {number} [opts.maxLen=80]
 * @param {boolean} [opts.allowEmpty=false] 为 true 时空串返回 ''，否则抛错
 * @returns {string}
 */
function sanitizeTitle(raw, opts) {
  const options = opts || {};
  const maxLen = options.maxLen == null ? DEFAULT_MAX_LEN : options.maxLen;
  const allowEmpty = options.allowEmpty === true;

  let s = String(raw == null ? '' : raw).trim();
  // 全角空格等
  s = s.replace(/[\u00A0\u3000]/g, ' ');
  s = s.replace(ILLEGAL, '');
  s = s.replace(/\s+/g, '_');
  s = s.replace(/_+/g, '_');
  s = s.replace(/^_+|_+$/g, '');

  if (!s) {
    if (allowEmpty) return '';
    throw new Error('清洗后为空，请提供有效的需求文档 title 或文件标题');
  }

  if (s.length > maxLen) {
    s = s.slice(0, maxLen).replace(/_+$/g, '');
    if (!s) {
      if (allowEmpty) return '';
      throw new Error('清洗并截断后为空');
    }
  }
  return s;
}

/**
 * 从需求标题提取版本维度目录名（统一小写 v + x.y.z）
 * 仅当标题**开头**带版本号时返回，例如 `V4.6.0 周迭代` → `v4.6.0`
 * 无版本前缀则返回 null（工作区直接落在 output/ 下）
 * @param {unknown} rawTitle
 * @returns {string|null}
 */
function extractVersionFolder(rawTitle) {
  const s = String(rawTitle == null ? '' : rawTitle).trim();
  if (!s) return null;
  const m = s.match(VERSION_PREFIX_RE);
  if (!m) return null;
  return 'v' + m[1];
}

/**
 * 标题是否为「周迭代」总览页（一页含多个子需求）
 * 子需求命名形如 `v4.6.0_周迭代_{名称}`，不应再被识别为总览页。
 * @param {unknown} rawTitle
 * @returns {boolean}
 */
function isWeeklyIterationTitle(rawTitle) {
  const s = String(rawTitle == null ? '' : rawTitle);
  if (!s) return false;
  if (/_周迭代_/.test(s)) return false;
  return /周迭代/.test(s);
}

/**
 * 去掉标题开头的版本前缀（含可选空格/下划线），便于拼周迭代子需求名
 * @param {unknown} rawTitle
 * @returns {string}
 */
function stripVersionPrefix(rawTitle) {
  let s = String(rawTitle == null ? '' : rawTitle).trim();
  s = s.replace(VERSION_PREFIX_RE, '').replace(/^[\s_]+/, '');
  return s;
}

/**
 * 周迭代子需求工作区标题：`v4.6.0_周迭代_{子需求名称}`
 * @param {string} parentOrVersionTitle 总览页 title，或已提取的 v4.6.0
 * @param {string} subRequirementName 表中「需求名称」或章节标题
 * @param {object} [opts] 传给 sanitizeTitle
 * @returns {string}
 */
function buildWeeklySubRequirementTitle(parentOrVersionTitle, subRequirementName, opts) {
  const ver =
    extractVersionFolder(parentOrVersionTitle) ||
    (/^v\d+\.\d+\.\d+$/i.test(String(parentOrVersionTitle || '').trim())
      ? String(parentOrVersionTitle).trim().toLowerCase()
      : null);
  let sub = String(subRequirementName == null ? '' : subRequirementName).trim();
  sub = stripVersionPrefix(sub);
  sub = sub.replace(/^周迭代[\s_]*/u, '');
  if (!sub) {
    throw new Error('周迭代子需求名称为空');
  }
  const raw = ver ? ver + '_周迭代_' + sub : '周迭代_' + sub;
  return sanitizeTitle(raw, opts);
}

/**
 * 相对产物根的工作区路径
 * - 有版本：`v4.6.0/{sanitizedTitle}`
 * - 无版本：`{sanitizedTitle}`
 * @param {unknown} rawTitle
 * @returns {{ versionFolder: string|null, folderName: string, relativePath: string }}
 */
function resolveWorkspaceRelPath(rawTitle) {
  const folderName = sanitizeTitle(rawTitle);
  const versionFolder = extractVersionFolder(rawTitle) || extractVersionFolder(folderName);
  if (versionFolder) {
    return {
      versionFolder,
      folderName,
      relativePath: path.join(versionFolder, folderName)
    };
  }
  return {
    versionFolder: null,
    folderName,
    relativePath: folderName
  };
}

/**
 * 生成带扩展名的安全文件名（扩展名不清洗语义，仅规范化小写可选）
 * @param {string} titleOrBasename 不含或含扩展名均可
 * @param {string} [ext] 如 '.md'；若 basename 已含扩展名且未传 ext，则保留原扩展名
 * @param {object} [opts]
 * @returns {string} 如 `客户来源调研弹窗.md`
 */
function sanitizeFileName(titleOrBasename, ext, opts) {
  const raw = String(titleOrBasename == null ? '' : titleOrBasename).trim();
  let base = raw;
  let resolvedExt = ext;

  if (resolvedExt == null || resolvedExt === '') {
    const m = raw.match(/^(.*)(\.[A-Za-z0-9]{1,8})$/);
    if (m) {
      base = m[1];
      resolvedExt = m[2];
    } else {
      resolvedExt = '';
    }
  } else if (resolvedExt.charAt(0) !== '.') {
    resolvedExt = '.' + resolvedExt;
  }

  const name = sanitizeTitle(base, opts);
  return name + resolvedExt;
}

/**
 * output 下 XMind 文件名：类型在前，需求 title 在后
 * @param {string} title
 * @param {'需求点'|'测试点'|'测试用例'|'技术改动'} kind
 */
function xmindBaseName(title, kind) {
  const allowed = ['需求点', '测试点', '测试用例', '技术改动'];
  if (allowed.indexOf(kind) === -1) {
    throw new Error('未知 XMind 类型: ' + kind);
  }
  return kind + '_' + sanitizeTitle(title) + '.xmind';
}

function runSelfTest() {
  const cases = [
    {
      name: '基本中文',
      input: '客户来源调研弹窗',
      expect: '客户来源调研弹窗'
    },
    {
      name: '非法字符',
      input: 'a/b:c*d?e"f<g>h|i',
      expect: 'abcdefghi'
    },
    {
      name: '空白压缩',
      input: '客户  来源\t调研',
      expect: '客户_来源_调研'
    },
    {
      name: '首尾下划线',
      input: '__弹窗__',
      expect: '弹窗'
    },
    {
      name: '带扩展名',
      fn: 'file',
      input: '销售单保存接口变更说明.md',
      expect: '销售单保存接口变更说明.md'
    },
    {
      name: 'xmind',
      fn: 'xmind',
      input: '客户来源调研弹窗',
      kind: '需求点',
      expect: '需求点_客户来源调研弹窗.xmind'
    },
    {
      name: '版本目录',
      fn: 'version',
      input: 'V4.6.0 【APP】询问客户来源',
      expect: 'v4.6.0'
    },
    {
      name: '版本目录(下划线后)',
      fn: 'version',
      input: 'v4.6.0_周迭代_【PC】打印',
      expect: 'v4.6.0'
    },
    {
      name: '无版本',
      fn: 'version',
      input: '客户来源调研弹窗',
      expect: null
    },
    {
      name: '工作区相对路径',
      fn: 'rel',
      input: 'V4.6.1 【APP云店】优化搜索',
      expect: path.join('v4.6.1', sanitizeTitle('V4.6.1 【APP云店】优化搜索'))
    },
    {
      name: '周迭代子需求名',
      fn: 'weekly',
      parent: 'V4.6.0 周迭代',
      sub: '【PC】打印设置页面，【模板商城】改为【智慧商城】',
      expect: sanitizeTitle(
        'v4.6.0_周迭代_【PC】打印设置页面，【模板商城】改为【智慧商城】'
      )
    },
    {
      name: '周迭代识别',
      fn: 'isWeekly',
      input: 'V4.6.0 周迭代',
      expect: true
    },
    {
      name: '周迭代子需求不识别为总览',
      fn: 'isWeekly',
      input: 'v4.6.0_周迭代_【PC】打印设置',
      expect: false
    }
  ];

  let failed = 0;
  for (const c of cases) {
    let got;
    if (c.fn === 'file') {
      got = sanitizeFileName(c.input);
    } else if (c.fn === 'xmind') {
      got = xmindBaseName(c.input, c.kind);
    } else if (c.fn === 'version') {
      got = extractVersionFolder(c.input);
    } else if (c.fn === 'rel') {
      got = resolveWorkspaceRelPath(c.input).relativePath;
    } else if (c.fn === 'weekly') {
      got = buildWeeklySubRequirementTitle(c.parent, c.sub);
    } else if (c.fn === 'isWeekly') {
      got = isWeeklyIterationTitle(c.input);
    } else {
      got = sanitizeTitle(c.input);
    }
    const ok = got === c.expect;
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + c.name + ': ' + JSON.stringify(got));
    if (!ok) {
      console.log('      expect ' + JSON.stringify(c.expect));
      failed++;
    }
  }

  let threw = false;
  try {
    sanitizeTitle('   ');
  } catch (e) {
    threw = true;
  }
  console.log((threw ? 'PASS' : 'FAIL') + '  空串抛错');
  if (!threw) failed++;

  const long = sanitizeTitle('一二三四五六七八九十'.repeat(10), { maxLen: 10 });
  const lenOk = long.length <= 10 && long.length > 0;
  console.log((lenOk ? 'PASS' : 'FAIL') + '  maxLen: ' + long);
  if (!lenOk) failed++;

  return failed === 0;
}

function parseArgs(argv) {
  const params = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sanitize' && argv[i + 1]) params.sanitize = argv[++i];
    else if (a === '--file' && argv[i + 1]) params.file = argv[++i];
    else if (a === '--workspace-rel' && argv[i + 1]) params.workspaceRel = argv[++i];
    else if (a === '--self-test') params.selfTest = true;
    else if (a === '--help' || a === '-h') params.help = true;
  }
  return params;
}

function printUsage() {
  console.log(`
Demand 6.0 naming 工具 (FOUND-04)

  node scripts/lib/naming.js --sanitize "<title>"
  node scripts/lib/naming.js --file "<name.md>"
  node scripts/lib/naming.js --workspace-rel "<title>"
  node scripts/lib/naming.js --self-test
`);
}

function main() {
  const params = parseArgs(process.argv.slice(2));
  if (
    params.help ||
    (!params.sanitize && !params.file && !params.workspaceRel && !params.selfTest)
  ) {
    printUsage();
    process.exit(params.help ? 0 : 1);
  }
  if (params.selfTest) {
    const ok = runSelfTest();
    process.exit(ok ? 0 : 1);
  }
  if (params.sanitize != null) {
    console.log(sanitizeTitle(params.sanitize));
    process.exit(0);
  }
  if (params.file != null) {
    console.log(sanitizeFileName(params.file));
    process.exit(0);
  }
  if (params.workspaceRel != null) {
    console.log(JSON.stringify(resolveWorkspaceRelPath(params.workspaceRel), null, 2));
    process.exit(0);
  }
}

module.exports = {
  DEFAULT_MAX_LEN,
  sanitizeTitle,
  sanitizeFileName,
  xmindBaseName,
  extractVersionFolder,
  isWeeklyIterationTitle,
  stripVersionPrefix,
  buildWeeklySubRequirementTitle,
  resolveWorkspaceRelPath,
  runSelfTest
};

if (require.main === module) {
  main();
}
