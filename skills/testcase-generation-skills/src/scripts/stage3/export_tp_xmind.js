/**
 * XMIND-03 — 测试点 XMind 导出 CLI
 *
 * fixture / 工作区 C-TP → output/测试点_{title}.xmind
 *
 *   node stage3/export_tp_xmind.js --project-dir <工作区根>
 *   node stage3/export_tp_xmind.js --file <test_points.json> --out <path.xmind>
 *
 * 默认契约路径：
 *   读 script/stage3/test_points.json
 *   写 output/测试点_{requirement_title}.xmind
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  contractPath,
  getXmindPaths
} = require('../lib/workspace');
const { exportXmind } = require('../lib/xmind_export');

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
  node stage3/export_tp_xmind.js --project-dir <工作区根>
  node stage3/export_tp_xmind.js --file <test_points.json> [--out <path.xmind>]

示例（fixture）:
  node stage3/export_tp_xmind.js --project-dir ../fixtures/客户来源调研弹窗`);
}

function main() {
  const params = parseArgs(process.argv.slice(2));
  if (params.help || (!params.projectDir && !params.file)) {
    usage();
    process.exit(params.help ? 0 : 1);
  }

  let tpPath;
  let outPath;
  let workspaceRoot = null;

  if (params.file) {
    tpPath = path.resolve(params.file);
  } else {
    workspaceRoot = path.resolve(params.projectDir);
    tpPath = contractPath(workspaceRoot, 'testPoints');
  }

  if (!fs.existsSync(tpPath)) {
    console.error(JSON.stringify({ ok: false, error: '缺少 C-TP: ' + tpPath }));
    process.exit(1);
  }

  const tp = JSON.parse(fs.readFileSync(tpPath, 'utf8'));
  if (!tp.requirement_title) {
    console.error(JSON.stringify({ ok: false, error: 'test_points 缺少 requirement_title' }));
    process.exit(1);
  }

  if (params.out) {
    outPath = path.resolve(params.out);
  } else if (workspaceRoot) {
    outPath = getXmindPaths(workspaceRoot, tp.requirement_title).testPoints;
  } else {
    const title = tp.requirement_title;
    outPath = path.resolve(
      path.dirname(tpPath),
      '..',
      '..',
      'output',
      '测试点_' + title + '.xmind'
    );
  }

  const result = exportXmind('test_points', tp, outPath);
  console.log(
    JSON.stringify(
      {
        ok: true,
        kind: 'test_points',
        input: tpPath,
        output: result.path,
        size: result.size,
        title: tp.requirement_title,
        unmatched_count: tp.unmatched_count
      },
      null,
      2
    )
  );
}

main();
