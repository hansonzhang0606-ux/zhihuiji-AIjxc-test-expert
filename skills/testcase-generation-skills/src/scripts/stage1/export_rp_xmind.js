/**
 * XMIND-02 — 需求点 XMind 导出 CLI
 *
 * fixture / 工作区 C-RP → output/需求点_{title}.xmind
 *
 *   node stage1/export_rp_xmind.js --project-dir <工作区根>
 *   node stage1/export_rp_xmind.js --file <requirement_points.json> --out <path.xmind>
 *
 * 默认契约路径：
 *   读 script/stage1/requirement_points.json
 *   写 output/需求点_{requirement_title}.xmind
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
  node stage1/export_rp_xmind.js --project-dir <工作区根>
  node stage1/export_rp_xmind.js --file <requirement_points.json> [--out <path.xmind>]

示例（fixture）:
  node stage1/export_rp_xmind.js --project-dir ../fixtures/客户来源调研弹窗`);
}

function main() {
  const params = parseArgs(process.argv.slice(2));
  if (params.help || (!params.projectDir && !params.file)) {
    usage();
    process.exit(params.help ? 0 : 1);
  }

  let rpPath;
  let outPath;
  let workspaceRoot = null;

  if (params.file) {
    rpPath = path.resolve(params.file);
  } else {
    workspaceRoot = path.resolve(params.projectDir);
    rpPath = contractPath(workspaceRoot, 'requirementPoints');
  }

  if (!fs.existsSync(rpPath)) {
    console.error(JSON.stringify({ ok: false, error: '缺少 C-RP: ' + rpPath }));
    process.exit(1);
  }

  const rp = JSON.parse(fs.readFileSync(rpPath, 'utf8'));
  if (!rp.requirement_title) {
    console.error(JSON.stringify({ ok: false, error: 'requirement_points 缺少 requirement_title' }));
    process.exit(1);
  }

  if (params.out) {
    outPath = path.resolve(params.out);
  } else if (workspaceRoot) {
    outPath = getXmindPaths(workspaceRoot, rp.requirement_title).requirementPoints;
  } else {
    // 仅 --file：默认写到 JSON 同级 ../output/ 或 cwd/output
    const title = rp.requirement_title;
    outPath = path.resolve(
      path.dirname(rpPath),
      '..',
      '..',
      'output',
      '需求点_' + title + '.xmind'
    );
  }

  const result = exportXmind('requirement_points', rp, outPath);
  console.log(
    JSON.stringify(
      {
        ok: true,
        kind: 'requirement_points',
        input: rpPath,
        output: result.path,
        size: result.size,
        title: rp.requirement_title
      },
      null,
      2
    )
  );
}

main();
