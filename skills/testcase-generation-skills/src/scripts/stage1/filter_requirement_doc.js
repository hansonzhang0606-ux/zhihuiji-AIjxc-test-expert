/**
 * Stage1A 前置：硬剥离需求文档中无测试价值章节
 *
 *   node filter_requirement_doc.js --project-dir <工作区> [--title <title>]
 *   node filter_requirement_doc.js --self-test
 *
 * 读：input/需求文档/{title}.md
 * 写：script/stage1/requirement_filtered.md
 *     script/stage1/requirement_filter_report.json
 *
 * 规则对齐 templates/需求文档过滤规则.md：
 * 命中过滤类标题 → 整棵子树剔除（含其下「核心规则/现状问题」），LLM 不得再读到原文。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { sanitizeTitle } = require('../lib/naming');
const { contractPath } = require('../lib/workspace');

const SCRIPT_VERSION = '6.0.2';

/** 过滤类：命中则整节（含子孙）删除 */
const FILTER_TITLE_RES = [
  /需求背景/,
  /背景介绍/,
  /为什么做/,
  /项目背景/,
  /立项背景/,
  /市场调研/,
  /用户调研/,
  /竞品/,
  /对标产品/,
  /\bROI\b/i,
  /投入产出/,
  /收益分析/,
  /未来规划/,
  /后续迭代/,
  /Roadmap/i,
  /展望/,
  /历史版本/,
  /往期说明/,
  /旧逻辑说明/
];

/** 历史版本类：标题含「本期仍生效/需回归/与本期差异」则保留整节 */
const HISTORY_KEEP_RES = [/本期(仍)?生效/, /需回归/, /与本期差异/, /本次仍/];

function log(msg) {
  console.log(`[filter_requirement_doc ${SCRIPT_VERSION}] ${msg}`);
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function parseArgs(argv) {
  const params = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project-dir' && argv[i + 1]) params.projectDir = argv[++i];
    else if (a === '--title' && argv[i + 1]) params.title = argv[++i];
    else if (a === '--self-test') params.selfTest = true;
    else if (a === '--help' || a === '-h') params.help = true;
  }
  return params;
}

function resolveTitle(projectDir, explicit) {
  if (explicit != null && String(explicit).trim() !== '') {
    return sanitizeTitle(explicit);
  }
  const sessionPath = contractPath(projectDir, 'sessionInfo');
  if (fs.existsSync(sessionPath)) {
    try {
      const s = readJson(sessionPath);
      if (s.requirement_title) return sanitizeTitle(s.requirement_title);
    } catch (_) {
      /* ignore */
    }
  }
  return sanitizeTitle(path.basename(path.resolve(projectDir)));
}

/**
 * 解析标题行：返回 { level, title } 或 null
 * 支持 # markdown 与「一、」「1.1」类纯文本标题行
 * 规范化：中文「一、二、」章级一律 L1，避免 `## 二、` 被当成 L2 而吞进「一、」过滤子树
 */
function parseHeadingLine(line) {
  const raw = String(line || '');
  let level = null;
  let title = null;
  let kind = null;

  const md = raw.match(/^(#{1,6})\s+(.+?)\s*$/);
  if (md) {
    level = md[1].length;
    title = md[2].trim();
    kind = 'md';
  } else {
    const cn = raw.match(
      /^[\s]*((?:[一二三四五六七八九十百]+、)|(?:（[一二三四五六七八九十]+）)|(?:\d+(?:\.\d+)*[.、．])|(?:第[一二三四五六七八九十\d]+[章节条]))\s*(.+?)\s*$/
    );
    if (!cn) return null;
    const prefix = cn[1];
    title = (prefix + cn[2]).trim();
    kind = 'plain';
    if (/^[一二三四五六七八九十百]+、/.test(prefix) || /^第/.test(prefix)) level = 1;
    else if (/^\d+\.\d+/.test(prefix)) level = 3;
    else if (/^\d+[.、．]/.test(prefix)) level = 2;
    else if (/^（/.test(prefix)) level = 2;
    else level = 2;
  }

  // 标题文本以中文章号开头 → 强制章级 L1（覆盖 ## 二、xxx）
  if (/^[一二三四五六七八九十百]+、/.test(title) || /^第[一二三四五六七八九十\d]+[章节]/.test(title)) {
    level = 1;
  } else if (/^\d+\.\d+/.test(title)) {
    level = 3;
  } else if (/^\d+[.、．]/.test(title)) {
    level = 2;
  }

  return { level, title, kind };
}

function isFilterTitle(title) {
  const t = String(title || '');
  if (!t) return false;
  // 历史版本特例：明确本期相关则不过滤
  if (/历史版本|往期|旧逻辑/.test(t) && HISTORY_KEEP_RES.some(re => re.test(t))) {
    return false;
  }
  return FILTER_TITLE_RES.some(re => re.test(t));
}

/**
 * 将 markdown 按「标题块」切分并剔除过滤子树
 * @returns {{ filtered: string, removed: Array<{title:string,level:number,lines:number}> }}
 */
function filterMarkdown(src) {
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
  const kept = [];
  const removed = [];
  let skipUntilLevel = null; // 正在跳过的过滤节级别
  let removing = null; // { title, level, lines }

  function endRemoving() {
    if (removing) {
      removed.push(removing);
      removing = null;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = parseHeadingLine(line);

    if (h) {
      if (skipUntilLevel != null) {
        if (h.level <= skipUntilLevel) {
          // 同级或更高级标题 → 结束当前过滤块
          endRemoving();
          skipUntilLevel = null;
          // 继续判断本行是否也是过滤标题
        } else {
          // 仍在过滤子树内
          removing.lines += 1;
          continue;
        }
      }

      if (isFilterTitle(h.title)) {
        skipUntilLevel = h.level;
        removing = { title: h.title, level: h.level, lines: 1 };
        continue;
      }

      kept.push(line);
      continue;
    }

    if (skipUntilLevel != null) {
      if (removing) removing.lines += 1;
      continue;
    }
    kept.push(line);
  }
  endRemoving();

  let filtered = kept.join('\n');
  // 压缩多余空行
  filtered = filtered.replace(/\n{3,}/g, '\n\n').trim() + '\n';

  const banner =
    '<!-- requirement_filtered: 已剔除需求背景/调研/竞品/ROI/项目背景/未来规划/历史版本等章节及其子节；1A 仅允许读本文件 -->\n\n';

  return { filtered: banner + filtered, removed };
}

function resolveReqMd(projectDir, title) {
  const preferred = path.join(projectDir, 'input', '需求文档', title + '.md');
  if (fs.existsSync(preferred)) return preferred;
  const dir = path.join(projectDir, 'input', '需求文档');
  if (!fs.existsSync(dir)) return null;
  const mds = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.md'));
  if (mds.length === 1) return path.join(dir, mds[0]);
  return null;
}

function runFilter(projectDir, titleOpt) {
  const title = resolveTitle(projectDir, titleOpt);
  const srcPath = resolveReqMd(projectDir, title);
  if (!srcPath) {
    throw new Error('未找到需求文档: input/需求文档/' + title + '.md');
  }
  const raw = fs.readFileSync(srcPath, 'utf8');
  const { filtered, removed } = filterMarkdown(raw);

  const outMd = path.join(projectDir, 'script', 'stage1', 'requirement_filtered.md');
  const outReport = path.join(
    projectDir,
    'script',
    'stage1',
    'requirement_filter_report.json'
  );
  fs.mkdirSync(path.dirname(outMd), { recursive: true });
  fs.writeFileSync(outMd, filtered, 'utf8');

  const report = {
    schema_version: SCRIPT_VERSION,
    requirement_title: title,
    source_md: path.relative(projectDir, srcPath).replace(/\\/g, '/'),
    filtered_md: 'script/stage1/requirement_filtered.md',
    removed_sections: removed,
    removed_count: removed.length,
    source_chars: raw.length,
    filtered_chars: filtered.length,
    completed_at: new Date().toISOString(),
    note:
      '1A/3A 提取需求点或测试点时禁止再读 input/需求文档 原文；仅读 requirement_filtered.md'
  };
  writeJson(outReport, report);

  log('✓ 已写: script/stage1/requirement_filtered.md');
  log('✓ 已写: script/stage1/requirement_filter_report.json');
  log('  剔除章节数: ' + removed.length);
  for (const r of removed) {
    log('  - [L' + r.level + '] ' + r.title + ' (' + r.lines + ' 行)');
  }

  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
  return report;
}

/**
 * 草稿自检：标题/detail 是否仍像「背景/现状问题」叙述型 RP
 */
function auditDraftAgainstFilter(draft) {
  const warnings = [];
  const points = []
    .concat(draft.confirmed_points || [])
    .concat(draft.pending_points || []);
  for (const p of points) {
    const title = String(p.title || '').trim();
    const text = (title + ' ' + (p.detail || '')).trim();
    if (/需求背景|市场调研|竞品分析|ROI|项目背景|未来规划/.test(text)) {
      warnings.push({
        id: p.id,
        reason: '文案含过滤类背景词，疑似未基于过滤后文档提取'
      });
    }
    // 硬过滤后「需求背景」整章已删除，任何引用保留区 1.x（核心规则/现状问题）的文案都不允许
    if (/保留区\s*1\.\d/.test(text)) {
      warnings.push({
        id: p.id,
        reason: '文案仍引用「保留区 1.x」来源，但需求背景整章已被过滤；请改写为可测改动点'
      });
    }
    if (/^现状问题[:：]/.test(title) || /保留区\s*1\.2/.test(text)) {
      warnings.push({
        id: p.id,
        reason: '疑似把「需求背景下的现状问题」直接写成 RP；应改为可测改动点，或剔除'
      });
    }
  }
  return warnings;
}

function runSelfTest() {
  let failed = 0;

  const sample = `# 标题

一、需求背景

### 1.1 核心规则
可用上限 = 基础量 + 增购量

### 1.2 现状问题
员工未弹窗直接停用

## 二、场景说明

### 2.1 多店转单店
应弹窗选择保留账号

## 三、市场调研
用户访谈摘要，无测试价值

## 四、埋点
曝光事件上报一次
`;

  const { filtered, removed } = filterMarkdown(sample);
  const okRemoved =
    removed.some(r => /需求背景/.test(r.title)) &&
    removed.some(r => /市场调研/.test(r.title));
  const okGone =
    !/核心规则/.test(filtered) &&
    !/现状问题/.test(filtered) &&
    !/市场调研/.test(filtered) &&
    !/用户访谈/.test(filtered);
  const okKeep =
    /场景说明/.test(filtered) &&
    /多店转单店/.test(filtered) &&
    /埋点/.test(filtered) &&
    /曝光事件/.test(filtered);

  console.log((okRemoved ? '✓' : '✗') + ' 报告剔除需求背景+市场调研');
  if (!okRemoved) failed++;
  console.log((okGone ? '✓' : '✗') + ' 过滤后无背景子节/调研正文');
  if (!okGone) {
    console.log(filtered);
    failed++;
  }
  console.log((okKeep ? '✓' : '✗') + ' 保留场景与埋点');
  if (!okKeep) failed++;

  const warn = auditDraftAgainstFilter({
    confirmed_points: [
      {
        id: 'RP-003',
        title: '现状问题: 员工未弹窗选择直接全部停用',
        detail: '保留区 1.2'
      }
    ]
  });
  console.log((warn.length >= 1 ? '✓' : '✗') + ' 草稿审计可检出现状问题型 RP');
  if (warn.length < 1) failed++;

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
    console.log(`
用法:
  node filter_requirement_doc.js --project-dir <工作区> [--title <title>]
  node filter_requirement_doc.js --self-test
`);
    process.exit(0);
  }
  if (params.selfTest) {
    runSelfTest();
    return;
  }
  if (!params.projectDir) {
    console.error('需要 --project-dir');
    process.exit(1);
  }
  try {
    runFilter(path.resolve(params.projectDir), params.title);
  } catch (e) {
    console.error('错误: ' + e.message);
    process.exit(1);
  }
}

module.exports = {
  filterMarkdown,
  isFilterTitle,
  auditDraftAgainstFilter,
  runFilter,
  FILTER_TITLE_RES
};

if (require.main === module) {
  main();
}
