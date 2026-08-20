/**
 * KB Skill CLI — extract adapter（骨架）
 * 迁移期仍可调用 src/scripts/kb/extract_kb.js；本入口将逐步切到 core/extract.js
 */
'use strict';

const path = require('path');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project-dir' && argv[i + 1]) out.projectDir = argv[++i];
    else if (a === '--kb-root' && argv[i + 1]) out.kbRoot = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('用法: node run_extract.js --project-dir <WS> [--kb-root <path>]');
    return;
  }
  // 临时透传到现有 6.2 extract，保持 Fast Path 可用
  const legacy = path.resolve(__dirname, '..', '..', '..', 'src', 'scripts', 'kb', 'extract_kb.js');
  const { spawnSync } = require('child_process');
  const childArgs = [];
  if (args.projectDir) childArgs.push('--project-dir', args.projectDir);
  if (args.kbRoot) childArgs.push('--kb-root', args.kbRoot);
  const r = spawnSync(process.execPath, [legacy, ...childArgs], { stdio: 'inherit' });
  process.exitCode = r.status == null ? 1 : r.status;
}

if (require.main === module) main();
module.exports = { parseArgs };
