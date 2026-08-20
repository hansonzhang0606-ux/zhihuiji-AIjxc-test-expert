/**
 * Demand 6.1 — 本需求临时知识点读写（WP-61-FACTS / 1A）
 *
 *   node domain_facts.js --self-test
 *   node domain_facts.js --project-dir <工作区> [--check-aliases]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { validateFile, CONTRACTS_DIR } = require('../lib/validate');

const SCRIPT_VERSION = '6.1.0';
const FACTS_REL = path.join('script', 'stage1', 'domain_facts.json');
const FACTS_SCHEMA = path.join(CONTRACTS_DIR, 'domain_facts.schema.json');
const ALIAS_NAMES = ['session_facts.json', 'kb_applied.json'];

function factsPath(projectDir) {
  return path.join(projectDir, FACTS_REL);
}

function emptyFacts(requirementTitle) {
  return {
    schema_version: '6.1',
    requirement_title: String(requirementTitle || ''),
    facts: [],
    updated_at: new Date().toISOString()
  };
}

function validateFacts(data) {
  const tmpDir = path.join(
    require('os').tmpdir(),
    'df-validate-' + process.pid
  );
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, 'domain_facts.json');
  try {
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    return validateFile(tmp, FACTS_SCHEMA);
  } finally {
    try {
      fs.unlinkSync(tmp);
      fs.rmdirSync(tmpDir);
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * @returns {{ ok: boolean, data: object|null, errors: string[], missing: boolean }}
 */
function loadDomainFacts(projectDir) {
  const p = factsPath(projectDir);
  if (!fs.existsSync(p)) {
    return { ok: true, data: null, errors: [], missing: true };
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return {
      ok: false,
      data: null,
      errors: ['domain_facts.json 解析失败: ' + e.message],
      missing: false
    };
  }
  const v = validateFacts(data);
  if (!v.ok) {
    return {
      ok: false,
      data: null,
      errors: (v.errors || ['schema 失败']).map(e => 'domain_facts: ' + e),
      missing: false
    };
  }
  return { ok: true, data, errors: [], missing: false };
}

/**
 * human_review 覆盖同 id 的 kb_applied（默认）
 */
function mergeFacts(base, incoming, opts) {
  const preferHuman = !opts || opts.preferHumanReview !== false;
  const title =
    (incoming && incoming.requirement_title) ||
    (base && base.requirement_title) ||
    '';
  const out = emptyFacts(title);
  const map = new Map();
  for (const f of (base && base.facts) || []) {
    map.set(f.id, { ...f });
  }
  for (const f of (incoming && incoming.facts) || []) {
    const prev = map.get(f.id);
    if (!prev) {
      map.set(f.id, { ...f });
      continue;
    }
    if (preferHuman && prev.source === 'human_review' && f.source === 'kb_applied') {
      continue;
    }
    if (preferHuman && f.source === 'human_review') {
      map.set(f.id, { ...f });
      continue;
    }
    map.set(f.id, { ...f });
  }
  out.facts = Array.from(map.values()).sort((a, b) =>
    String(a.id).localeCompare(String(b.id))
  );
  out.updated_at = new Date().toISOString();
  if (base && base.note) out.note = base.note;
  if (incoming && incoming.note) out.note = incoming.note;
  return out;
}

function assertNoAliasInputs(projectDir) {
  const errors = [];
  const dir = path.join(projectDir, 'script', 'stage1');
  for (const name of ALIAS_NAMES) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) {
      errors.push(
        `禁止并行输入 ${name}；请合并进 script/stage1/domain_facts.json`
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 草稿/RP 文案是否触碰 forbid_patterns
 * @returns {string[]} errors
 */
function auditDraftAgainstFacts(draftOrRp, factsDoc) {
  const errors = [];
  if (!factsDoc || !Array.isArray(factsDoc.facts) || !factsDoc.facts.length) {
    return errors;
  }
  const points = []
    .concat(draftOrRp.confirmed_points || [])
    .concat(draftOrRp.pending_points || []);
  for (const fact of factsDoc.facts) {
    const patterns = Array.isArray(fact.forbid_patterns)
      ? fact.forbid_patterns
      : [];
    for (const pat of patterns) {
      if (!pat) continue;
      for (const p of points) {
        const text = `${p.title || ''} ${p.detail || ''} ${p.pending_reason || ''}`;
        if (text.indexOf(pat) !== -1) {
          errors.push(
            `${p.id || '(no-id)'} 触碰临时知识点 ${fact.id} 禁写「${pat}」（断言: ${fact.statement}）`
          );
        }
      }
    }
  }
  return errors;
}

function writeDomainFacts(projectDir, data) {
  const v = validateFacts(data);
  if (!v.ok) {
    throw new Error('domain_facts schema 失败: ' + (v.errors || []).join('; '));
  }
  const p = factsPath(projectDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  return p;
}

function runSelfTest() {
  let failed = 0;
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'df-'));

  const miss = loadDomainFacts(tmp);
  console.log(
    (miss.ok && miss.missing && miss.data === null ? '✓' : '✗') +
      ' 无文件 → 空消费'
  );
  if (!(miss.ok && miss.missing)) failed++;

  const doc = emptyFacts('示例需求标题');
  doc.facts.push({
    id: 'DF-001',
    statement: '对象A 在条件C下结果为 R1',
    forbid_patterns: ['结果为 R2'],
    source: 'human_review',
    session_only: true
  });
  writeDomainFacts(tmp, doc);
  const loaded = loadDomainFacts(tmp);
  console.log((loaded.ok && loaded.data.facts.length === 1 ? '✓' : '✗') + ' 读写+schema');
  if (!loaded.ok) failed++;

  const forbidErr = auditDraftAgainstFacts(
    {
      confirmed_points: [
        { id: 'RP-001', title: '对象A 结果为 R2', detail: 'x' }
      ]
    },
    loaded.data
  );
  console.log((forbidErr.length === 1 ? '✓' : '✗') + ' forbid 命中');
  if (forbidErr.length !== 1) failed++;

  const okPass = auditDraftAgainstFacts(
    {
      confirmed_points: [
        { id: 'RP-002', title: '对象A 结果为 R1', detail: 'ok' }
      ]
    },
    loaded.data
  );
  console.log((okPass.length === 0 ? '✓' : '✗') + ' 合规文案不拦');
  if (okPass.length) failed++;

  fs.writeFileSync(
    path.join(tmp, 'script', 'stage1', 'kb_applied.json'),
    '{}',
    'utf8'
  );
  const alias = assertNoAliasInputs(tmp);
  console.log((!alias.ok ? '✓' : '✗') + ' 禁止并行 kb_applied.json');
  if (alias.ok) failed++;

  const merged = mergeFacts(doc, {
    requirement_title: '示例需求标题',
    facts: [
      {
        id: 'DF-001',
        statement: '来自 KB 应被 human 盖住',
        forbid_patterns: [],
        source: 'kb_applied',
        session_only: false
      },
      {
        id: 'DF-002',
        statement: '新条',
        forbid_patterns: [],
        source: 'kb_applied',
        session_only: false
      }
    ]
  });
  const keepHuman =
    merged.facts.find(f => f.id === 'DF-001').source === 'human_review' &&
    merged.facts.some(f => f.id === 'DF-002');
  console.log((keepHuman ? '✓' : '✗') + ' merge 保留 human_review');
  if (!keepHuman) failed++;

  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }

  if (failed) {
    console.error('domain_facts self-test failed: ' + failed);
    process.exit(1);
  }
  console.log('domain_facts self-test passed');
  process.exit(0);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    runSelfTest();
    return;
  }
  let projectDir = null;
  let checkAliases = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project-dir' && argv[i + 1]) projectDir = argv[++i];
    else if (argv[i] === '--check-aliases') checkAliases = true;
  }
  if (!projectDir) {
    console.log(`用法:
  node domain_facts.js --self-test
  node domain_facts.js --project-dir <工作区> [--check-aliases]`);
    process.exit(1);
  }
  projectDir = path.resolve(projectDir);
  const loaded = loadDomainFacts(projectDir);
  const out = {
    ok: loaded.ok,
    missing: loaded.missing,
    errors: loaded.errors,
    facts_count: loaded.data ? loaded.data.facts.length : 0,
    path: FACTS_REL.replace(/\\/g, '/')
  };
  if (checkAliases) {
    const a = assertNoAliasInputs(projectDir);
    out.alias_ok = a.ok;
    if (!a.ok) {
      out.ok = false;
      out.errors = out.errors.concat(a.errors);
    }
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}

module.exports = {
  SCRIPT_VERSION,
  FACTS_REL,
  FACTS_SCHEMA,
  factsPath,
  emptyFacts,
  validateFacts,
  loadDomainFacts,
  mergeFacts,
  assertNoAliasInputs,
  auditDraftAgainstFacts,
  writeDomainFacts
};

if (require.main === module) {
  main();
}
