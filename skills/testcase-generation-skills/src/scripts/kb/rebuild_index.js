/**
 * Demand 6.2 — 重建知识库本地索引。
 *
 * 索引是 Markdown 业务真源的可再生导航，不应提交到语义库远程仓。
 *
 *   node kb/rebuild_index.js --kb-root <知识库根>
 *   node kb/rebuild_index.js --self-test
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { SRC_ROOT } = require('../lib/workspace');
const { loadMatrix } = require('../lib/kb_matrix');

const DEFAULT_KB_ROOT = path.join(SRC_ROOT, 'templates', '模块矩阵知识库');
const INDEX_NAME = '知识库索引.json';

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function relative(root, file) {
  return path.relative(root, file).replace(/\\/g, '/');
}

function newestBusinessMtime(root) {
  let newest = 0;
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(file);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        newest = Math.max(newest, fs.statSync(file).mtimeMs);
      }
    }
  }
  visit(root);
  return newest;
}

function isIndexStale(kbRoot, index) {
  if (!index || index.schema_version !== '6.2' || !index.generated_at) return true;
  const generatedAt = Date.parse(index.generated_at);
  if (Number.isNaN(generatedAt)) return true;
  return newestBusinessMtime(path.resolve(kbRoot)) > generatedAt;
}

function parseTableRows(text, heading) {
  const lines = String(text).split(/\r?\n/);
  const rows = [];
  let active = false;
  let headerSeen = false;
  for (const line of lines) {
    if (line.trim() === heading) {
      active = true;
      headerSeen = false;
      continue;
    }
    if (active && /^#{1,6}\s/.test(line)) break;
    if (!active || !line.trim().startsWith('|')) continue;
    const cells = line.trim().split('|').slice(1, -1).map(v => v.trim());
    if (!headerSeen) {
      headerSeen = true;
      continue;
    }
    if (!cells.length || cells.every(v => /^-+$/.test(v))) continue;
    rows.push(cells);
  }
  return rows;
}

function parseFrontmatter(text) {
  const match = String(text).match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const out = {};
  if (!match) return out;
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([^:：]+)[:：]\s*(.*)$/);
    if (pair) out[pair[1].trim()] = pair[2].trim();
  }
  return out;
}

function platformsFromSupport(value) {
  if (value === 'web') return ['web'];
  if (value === 'app') return ['app'];
  if (value === 'web+app') return ['web', 'app'];
  return [];
}

function keywordList(text, pageId) {
  const keywords = new Set([pageId]);
  for (const row of parseTableRows(text, '### 核心元素')) {
    if (row[0]) keywords.add(row[0]);
  }
  for (const line of String(text).split(/\r?\n/)) {
    const label = line.match(/^-\s+\*\*([^*]+?)(?:（[^）]+）)?\*\*[：:]/);
    if (label) keywords.add(label[1].trim());
  }
  return [...keywords];
}

function findElementFile(dir, pageId) {
  for (const prefix of ['主页面_', '子页面_']) {
    const candidate = path.join(dir, `${prefix}${pageId}.md`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function parsePageRelation(file) {
  const text = readText(file);
  const pages = parseTableRows(text, '## 1. 页面清单（跨端统一页面名称）');
  return pages
    .filter(row => row.length >= 4)
    .map(([page_id, role, support, description]) => ({
      page_id,
      role,
      platforms: platformsFromSupport(support),
      description
    }))
    .filter(page => {
      const id = String(page.page_id || '').trim();
      const role = String(page.role || '').trim();
      return id && id !== '（待补充）' && id !== '待补充' && !/^[—\-]+$/.test(id) && role !== '—' && role !== '-';
    });
}

function buildIndex(kbRoot = DEFAULT_KB_ROOT) {
  const root = path.resolve(kbRoot);
  const matrix = loadMatrix(path.join(root, '模块矩阵总览.md'));
  const modules = [];
  for (const [l2, l1] of matrix.module_map.entries()) {
    const moduleDir = path.join(root, l1, l2);
    const relationFile = path.join(moduleDir, '页面关系.md');
    if (!fs.existsSync(relationFile)) continue;

    const pages = parsePageRelation(relationFile).map(page => {
      const elementFile = findElementFile(moduleDir, page.page_id);
      const source = elementFile ? readText(elementFile) : '';
      const frontmatter = elementFile ? parseFrontmatter(source) : {};
      return {
        page_id: page.page_id,
        role: page.role,
        file: elementFile ? relative(root, elementFile) : null,
        platforms: page.platforms,
        status: elementFile ? (frontmatter['状态'] || '草稿') : '仅关系',
        keywords: elementFile ? keywordList(source, page.page_id) : [page.page_id]
      };
    });

    modules.push({
      module_l1: l1,
      module_l2: l2,
      path: relative(root, moduleDir),
      pages_file: relative(root, relationFile),
      pages
    });
  }
  return {
    schema_version: '6.2',
    generated_at: new Date().toISOString(),
    generated_by: 'rebuild_index.js',
    modules
  };
}

function writeIndex(kbRoot, index) {
  const target = path.join(path.resolve(kbRoot), INDEX_NAME);
  fs.writeFileSync(target, JSON.stringify(index, null, 2) + '\n', 'utf8');
  return target;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--kb-root' && argv[i + 1]) out.kbRoot = argv[++i];
    else if (argv[i] === '--self-test') out.selfTest = true;
    else if (argv[i] === '--help' || argv[i] === '-h') out.help = true;
  }
  return out;
}

function runSelfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-index-'));
  try {
    const source = DEFAULT_KB_ROOT;
    fs.cpSync(source, tmp, { recursive: true });
    const index = buildIndex(tmp);
    const target = writeIndex(tmp, index);
    const sale = index.modules.find(item => item.module_l2 === '销售');
    const list = sale && sale.pages.find(item => item.page_id === '销售单列表页');
    const relationOnly = sale && sale.pages.find(item => item.page_id === '销售单开单成功页');
    const checks = [
      [fs.existsSync(target), '索引文件已生成'],
      [!isIndexStale(tmp, index), '新索引未过期'],
      [isIndexStale(tmp, { ...index, generated_at: '2000-01-01T00:00:00.000Z' }), '旧索引可识别过期'],
      [index.modules.length >= 2, '索引到样例模块'],
      [list && list.status === '已确认' && list.file, '确认元素页状态与路径正确'],
      [relationOnly && relationOnly.file === null && relationOnly.status === '仅关系', '仅关系页保留 file=null']
    ];
    let failed = 0;
    for (const [ok, name] of checks) {
      console.log(`${ok ? '✓' : '✗'} ${name}`);
      if (!ok) failed++;
    }
    if (failed) process.exitCode = 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('用法: node kb/rebuild_index.js --kb-root <知识库根>');
    return;
  }
  if (args.selfTest) return runSelfTest();
  const root = path.resolve(args.kbRoot || DEFAULT_KB_ROOT);
  const target = writeIndex(root, buildIndex(root));
  console.log(JSON.stringify({ ok: true, index: target }, null, 2));
}

module.exports = {
  DEFAULT_KB_ROOT,
  INDEX_NAME,
  parseFrontmatter,
  parsePageRelation,
  buildIndex,
  writeIndex,
  isIndexStale
};

if (require.main === module) main();
