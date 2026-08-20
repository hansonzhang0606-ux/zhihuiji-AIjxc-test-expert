/**
 * XMIND-04 — 用例 XMind 导出 CLI（Demand 6.0 路径）
 *
 * fixture / 工作区 C-TC → output/测试用例_{title}.xmind
 * Excel 不由此 CLI 产出；默认仍由 Stage4 写到 script/stage4/test_cases.xlsx
 *
 *   node stage4/export_tc_xmind.js --project-dir <工作区根>
 *   node stage4/export_tc_xmind.js --file <test_cases.json> --out <path.xmind>
 *
 * 默认契约路径：
 *   读 script/stage4/test_cases.json
 *   写 output/测试用例_{requirement_title}.xmind
 *
 * 说明：旧 export_xmind.js 仍可把「已构好的 xmind.json」压成 .xmind；
 * 本 CLI 从 C-TC 契约 JSON 直接走 lib 用例模板（createXmindCaseNode + convertToXmindTopic）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  contractPath,
  getXmindPaths
} = require('../lib/workspace');
const { exportXmind } = require('../lib/xmind_export');
const { writeFinalArtifact } = require('./stage4_execute');

function parseArgs(argv) {
  const params = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project-dir' && argv[i + 1]) params.projectDir = argv[++i];
    else if (a === '--file' && argv[i + 1]) params.file = argv[++i];
    else if (a === '--out' && argv[i + 1]) params.out = argv[++i];
    else if (a === '--help' || a === '-h') params.help = true;
  }
  return params;
}

function usage() {
  console.log(`用法:
  node stage4/export_tc_xmind.js --project-dir <工作区根>
  node stage4/export_tc_xmind.js --file <test_cases.json> [--out <path.xmind>]

示例（fixture）:
  node stage4/export_tc_xmind.js --project-dir ../fixtures/客户来源调研弹窗

路径约定（6.0）:
  XMind → output/测试用例_{title}.xmind
  Excel → script/stage4/test_cases.xlsx（本 CLI 不生成）`);
}

function main() {
  const params = parseArgs(process.argv.slice(2));
  if (params.help || (!params.projectDir && !params.file)) {
    usage();
    process.exit(params.help ? 0 : 1);
  }

  let tcPath;
  let outPath;
  let workspaceRoot = null;

  if (params.file) {
    tcPath = path.resolve(params.file);
  } else {
    workspaceRoot = path.resolve(params.projectDir);
    tcPath = contractPath(workspaceRoot, 'testCases');
  }

  if (!fs.existsSync(tcPath)) {
    console.error(JSON.stringify({ ok: false, error: '缺少 C-TC: ' + tcPath }));
    process.exit(1);
  }

  const tc = JSON.parse(fs.readFileSync(tcPath, 'utf8'));
  if (!tc.requirement_title) {
    console.error(JSON.stringify({ ok: false, error: 'test_cases 缺少 requirement_title' }));
    process.exit(1);
  }

  if (params.out) {
    outPath = path.resolve(params.out);
  } else if (workspaceRoot) {
    outPath = getXmindPaths(workspaceRoot, tc.requirement_title).testCases;
  } else {
    const title = tc.requirement_title;
    outPath = path.resolve(
      path.dirname(tcPath),
      '..',
      '..',
      'output',
      '测试用例_' + title + '.xmind'
    );
  }

  const result = exportXmind('test_cases', tc, outPath);
  const finalArtifact = workspaceRoot
    ? writeFinalArtifact(workspaceRoot, tcPath, result.path)
    : null;
  console.log(
    JSON.stringify(
      {
        ok: true,
        kind: 'test_cases',
        input: tcPath,
        output: result.path,
        size: result.size,
        title: tc.requirement_title,
        case_count: Array.isArray(tc.test_cases) ? tc.test_cases.length : 0,
        final_artifact: finalArtifact ? finalArtifact.path : null,
        excel_default: 'script/stage4/test_cases.xlsx'
      },
      null,
      2
    )
  );
}

main();
