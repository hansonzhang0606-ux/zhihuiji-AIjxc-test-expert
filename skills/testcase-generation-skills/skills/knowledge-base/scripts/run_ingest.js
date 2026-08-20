/**
 * KB Skill CLI — ingest adapter
 * Phase: overview | review | apply
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { prepareOverview, prepareReview, applyReview } = require('./core/kb_core');

function parseArgs(argv) {
  const out = { phase: 'overview', contentConfirmed: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--phase' && argv[i + 1]) out.phase = argv[++i];
    else if (a === '--kb-root' && argv[i + 1]) out.kbRoot = argv[++i];
    else if (a === '--source' && argv[i + 1]) out.source = argv[++i];
    else if (a === '--input' && argv[i + 1]) out.input = argv[++i];
    else if (a === '--manifest' && argv[i + 1]) out.manifestPath = argv[++i];
    else if (a === '--overview-file' && argv[i + 1]) out.overviewFile = argv[++i];
    else if (a === '--changeset-file' && argv[i + 1]) out.changesetFile = argv[++i];
    else if (a === '--review-manifest' && argv[i + 1]) out.reviewManifest = argv[++i];
    else if (a === '--review-root' && argv[i + 1]) out.reviewRoot = argv[++i];
    else if (a === '--out-dir' && argv[i + 1]) out.outDir = argv[++i];
    else if (a === '--select' && argv[i + 1]) out.select = argv[++i].split(',');
    else if (a === '--confirm-content') out.contentConfirmed = true;
    else if (a === '--workspace-root' && argv[i + 1]) out.workspaceRoot = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function writeOut(dir, name, obj) {
  if (!dir) return null;
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  return p;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`用法:
  node run_ingest.js --phase overview --kb-root <path> --source text|xmind|ctc|confluence --input <file|pagesDir> [--manifest <final_artifact.json>] [--out-dir <dir>]
  node run_ingest.js --phase review --kb-root <path> --overview-file <json> --changeset-file <json> [--select CH-001,CH-002]
  node run_ingest.js --phase apply --kb-root <path> --review-manifest <json> --confirm-content`);
    return;
  }

  if (args.phase === 'overview') {
    const r = prepareOverview({
      kbRoot: args.kbRoot,
      source: args.source || 'text',
      input: args.input,
      workspaceRoot: args.workspaceRoot,
      manifestPath: args.manifestPath
    });
    if (args.outDir && r.ok && r.overview) {
      writeOut(args.outDir, 'overview.json', r.overview);
      writeOut(args.outDir, 'changeset.json', r.changeset);
      writeOut(args.outDir, 'candidate.json', r.candidate);
    }
    console.log(JSON.stringify(r, null, 2));
    if (!r.ok) process.exitCode = 1;
    return;
  }

  if (args.phase === 'review') {
    const overview = JSON.parse(fs.readFileSync(args.overviewFile, 'utf8'));
    const changeset = JSON.parse(fs.readFileSync(args.changesetFile, 'utf8'));
    const r = prepareReview({
      kbRoot: args.kbRoot,
      overview,
      changeset,
      selectedIds: args.select,
      reviewRoot: args.reviewRoot
    });
    console.log(JSON.stringify(r, null, 2));
    if (!r.ok) process.exitCode = 1;
    return;
  }

  if (args.phase === 'apply') {
    const report = applyReview({
      kbRoot: args.kbRoot,
      reviewManifestPath: args.reviewManifest,
      contentConfirmed: args.contentConfirmed
    });
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  console.error(`unknown phase: ${args.phase}`);
  process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { parseArgs };
