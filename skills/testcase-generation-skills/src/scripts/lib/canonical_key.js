/**
 * Demand 6.1 — 因果等价类规范化键（WP-61-1A）
 * 初期仅用于 draft / validator，不强制写入 C-RP schema。
 */
'use strict';

const crypto = require('crypto');

function normalizeToken(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。；;：:\-_/\\（）()【】\[\]「」""'']/g, '')
    .trim();
}

/**
 * 从需求点对象计算 canonical_key。
 * 优先：显式 canonical_key → 四分量 → 由 title 派生（弱键，仅防明显重复）。
 */
function buildCanonicalKey(point) {
  if (!point || typeof point !== 'object') return '';
  if (point.canonical_key) {
    return normalizeToken(point.canonical_key);
  }
  const hasParts =
    point.trigger != null ||
    point.primary_object != null ||
    point.condition != null ||
    point.primary_outcome != null;
  if (hasParts) {
    const raw = [
      normalizeToken(point.trigger),
      normalizeToken(point.primary_object),
      normalizeToken(point.condition),
      normalizeToken(point.primary_outcome)
    ].join('|');
    return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16);
  }
  // 弱键：规范化标题；过短则不参与同键判定
  const t = normalizeToken(point.title);
  if (t.length < 6) return '';
  return 't:' + crypto.createHash('sha1').update(t).digest('hex').slice(0, 16);
}

/**
 * 检查 confirmed_points 同键冲突。
 * @returns {{ ok: boolean, errors: string[], keys: Record<string,string[]> }}
 */
function findCanonicalKeyConflicts(points) {
  const errors = [];
  const map = Object.create(null);
  const list = Array.isArray(points) ? points : [];
  for (const p of list) {
    const key = buildCanonicalKey(p);
    if (!key) continue;
    if (!map[key]) map[key] = [];
    map[key].push(p.id || '(no-id)');
  }
  for (const [key, ids] of Object.entries(map)) {
    if (ids.length > 1) {
      errors.push(
        `canonical_key 冲突: ${ids.join(' / ')} 归一为同一键（${key.slice(0, 12)}…）`
      );
    }
  }
  return { ok: errors.length === 0, errors, keys: map };
}

function runSelfTest() {
  let failed = 0;
  const a = {
    id: 'RP-001',
    title: '条件C下对象A结果为R1',
    trigger: '操作T',
    primary_object: '对象A',
    condition: '条件C',
    primary_outcome: '结果R1'
  };
  const b = {
    id: 'RP-002',
    title: '另一表述',
    trigger: '操作T',
    primary_object: '对象A',
    condition: '条件C',
    primary_outcome: '结果R1'
  };
  const c = {
    id: 'RP-003',
    title: '条件C下对象B结果为R1',
    trigger: '操作T',
    primary_object: '对象B',
    condition: '条件C',
    primary_outcome: '结果R1'
  };
  const dup = findCanonicalKeyConflicts([a, b]);
  const okDup = !dup.ok && dup.errors.length === 1;
  console.log((okDup ? '✓' : '✗') + ' 同四分量双 RP 冲突');
  if (!okDup) failed++;

  const okSplit = findCanonicalKeyConflicts([a, c]).ok;
  console.log((okSplit ? '✓' : '✗') + ' 不同 primary_object 不冲突');
  if (!okSplit) failed++;

  const titleDup = findCanonicalKeyConflicts([
    { id: 'RP-010', title: '保存后状态变为已审核' },
    { id: 'RP-011', title: '保存后状态变为已审核' }
  ]);
  console.log(
    (!titleDup.ok ? '✓' : '✗') + ' 同标题弱键冲突'
  );
  if (titleDup.ok) failed++;

  if (failed) {
    console.error('canonical_key self-test failed: ' + failed);
    process.exit(1);
  }
  console.log('canonical_key self-test passed');
}

module.exports = {
  normalizeToken,
  buildCanonicalKey,
  findCanonicalKeyConflicts
};

if (require.main === module) {
  runSelfTest();
}
