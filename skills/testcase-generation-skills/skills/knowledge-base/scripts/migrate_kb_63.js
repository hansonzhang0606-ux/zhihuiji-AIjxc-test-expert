/**
 * 批量迁移 KB Markdown 表头到 6.3（只补列，不猜 URL/API 值）
 *
 *   node migrate_kb_63.js --kb-root <path> --dry-run
 *   node migrate_kb_63.js --kb-root <path> --apply
 */
'use strict';

const fs = require('fs');
const path = require('path');

function walkMd(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkMd(p, out);
    else if (ent.name.endsWith('.md')) out.push(p);
  }
  return out;
}

function migrateRelation(text) {
  const warnings = [];
  let next = text.replace(/\r\n/g, '\n');
  let changed = false;
  // Web 对照表：2 列 → 3 列，URL 填「待补充（历史）」
  if (/本端页面名（对照）/.test(next) && !/前端 URL 模板/.test(next)) {
    next = next.replace(/### 2\.1 本端页面名（对照）/, '### 2.1 本端页面名与 URL（对照）');
    next = next.replace(
      /\| 统一页面名称 \| 本端页面名 \|\n\|[-| ]+\|\n((?:\|.+\n)*)/,
      (m, body) => {
        changed = true;
        const rows = body
          .split('\n')
          .filter(Boolean)
          .map(line => {
            const cells = line.split('|').slice(1, -1).map(c => c.trim());
            if (cells.length < 2) return line;
            if (cells.length >= 3) return line;
            return `| ${cells[0]} | ${cells[1]} | 待补充（历史） |`;
          })
          .join('\n');
        return (
          '| 统一页面名称 | 本端页面名 | 前端 URL 模板 |\n' +
          '|--------------|------------|---------------|\n' +
          rows +
          '\n'
        );
      }
    );
    warnings.push('relation: added URL column with 待补充（历史）');
  }
  return { text: next, changed, warnings };
}

function migrateElement(text) {
  const warnings = [];
  let next = text.replace(/\r\n/g, '\n');
  let changed = false;
  if (
    /\| 元素 \| 位置 \| 输入\/选项 \| 交互 \| 交互结果 \| 下游影响说明 \|/.test(next) &&
    !/\| 后端接口 \|/.test(next)
  ) {
    next = next.replace(
      /\| 元素 \| 位置 \| 输入\/选项 \| 交互 \| 交互结果 \| 下游影响说明 \|\n\|[-| ]+\|\n((?:\|.+\n?)*)/g,
      (m, body) => {
        changed = true;
        const rows = body
          .split('\n')
          .filter(Boolean)
          .map(line => {
            const cells = line.split('|').slice(1, -1).map(c => c.trim());
            if (cells.length < 6) return line;
            if (cells.length >= 7) return line;
            const downstream = cells[5];
            return `| ${cells[0]} | ${cells[1]} | ${cells[2]} | ${cells[3]} | ${cells[4]} | 待补充（历史） | ${downstream} |`;
          })
          .join('\n');
        return (
          '| 元素 | 位置 | 输入/选项 | 交互 | 交互结果 | 后端接口 | 下游影响说明 |\n' +
          '|------|------|-----------|------|----------|----------|--------------|\n' +
          rows +
          (body.endsWith('\n') || !rows ? '\n' : '\n')
        );
      }
    );
    warnings.push('element: added 后端接口 column with 待补充（历史）');
  }
  return { text: next, changed, warnings };
}

function migrateKb(kbRoot, { apply = false } = {}) {
  const root = path.resolve(kbRoot);
  const files = walkMd(root).filter(f => !/知识库索引\.json$/.test(f));
  const diffs = [];
  for (const file of files) {
    const base = path.basename(file);
    const raw = fs.readFileSync(file, 'utf8');
    let result = { text: raw, changed: false, warnings: [] };
    if (base === '页面关系.md') result = migrateRelation(raw);
    else if (/^(主页面_|子页面_)/.test(base)) result = migrateElement(raw);
    if (!result.changed) continue;
    const rel = path.relative(root, file).replace(/\\/g, '/');
    diffs.push({ file: rel, warnings: result.warnings });
    if (apply) fs.writeFileSync(file, result.text, 'utf8');
  }
  return {
    ok: true,
    mode: apply ? 'apply' : 'dry-run',
    changed_count: diffs.length,
    diffs,
    note: '只补列，不猜 URL/API；索引不入 Git；请人工审 diff 后再 --apply'
  };
}

function parseArgs(argv) {
  const out = { dryRun: true, apply: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--kb-root' && argv[i + 1]) out.kbRoot = argv[++i];
    else if (argv[i] === '--dry-run') out.dryRun = true;
    else if (argv[i] === '--apply') {
      out.apply = true;
      out.dryRun = false;
    } else if (argv[i] === '--help' || argv[i] === '-h') out.help = true;
  }
  return out;
}

function selfTest() {
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb63_mig_'));
  const dir = path.join(tmp, '销售', '销售');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, '页面关系.md'),
    [
      '## 2. 电脑端（Web）',
      '',
      '### 2.1 本端页面名（对照）',
      '',
      '| 统一页面名称 | 本端页面名 |',
      '|--------------|------------|',
      '| 销售单列表页 | 销售单列表页 |',
      '',
      '### 2.2 跳转路径',
      ''
    ].join('\n'),
    'utf8'
  );
  fs.writeFileSync(
    path.join(dir, '主页面_销售单列表页.md'),
    [
      '## 电脑端',
      '',
      '### 核心元素',
      '',
      '| 元素 | 位置 | 输入/选项 | 交互 | 交互结果 | 下游影响说明 |',
      '|------|------|-----------|------|----------|--------------|',
      '| 表头.设置 | a | b | c | d | — |',
      ''
    ].join('\n'),
    'utf8'
  );
  const dry = migrateKb(tmp, { apply: false });
  if (dry.changed_count < 2) {
    console.error('migrate dry-run expected 2 files', dry);
    process.exit(1);
  }
  const applied = migrateKb(tmp, { apply: true });
  const rel = fs.readFileSync(path.join(dir, '页面关系.md'), 'utf8');
  const el = fs.readFileSync(path.join(dir, '主页面_销售单列表页.md'), 'utf8');
  const ok =
    applied.changed_count >= 2 &&
    rel.includes('前端 URL 模板') &&
    rel.includes('待补充（历史）') &&
    el.includes('后端接口') &&
    !/\/sales\//.test(rel);
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!ok) {
    console.error('migrate self-test failed');
    process.exit(1);
  }
  console.log('✓ migrate_kb_63 self-test');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || process.argv.includes('--self-test')) {
    if (process.argv.includes('--self-test')) return selfTest();
    console.log('用法: node migrate_kb_63.js --kb-root <path> --dry-run|--apply');
    return;
  }
  if (!args.kbRoot) {
    console.error('缺少 --kb-root');
    process.exitCode = 1;
    return;
  }
  const report = migrateKb(args.kbRoot, { apply: args.apply });
  console.log(JSON.stringify(report, null, 2));
}

module.exports = { migrateKb, selfTest };
if (require.main === module) main();
