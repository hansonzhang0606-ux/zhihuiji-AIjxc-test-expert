/**
 * S3-05 — 非功能规则（Demand 6.0 §6.3）
 *
 * 纯函数：根据需求/测试点文本判定是否应生成性能/安全等 NFR 提示。
 *
 *   node nfr_rules.js --self-test
 */
'use strict';

/**
 * @typedef {{ type: 'performance'|'security'|'compatibility'|'integration', should_generate: boolean, reason: string }} NfrDecision
 */

const PERF_HINT =
  /搜索|查询|批量|AI\s*提取|列表加载|分页|导出大量|并发/;
const SECURITY_HINT =
  /新增.*(输入|文本|备注|说明)|支持长文本|多行文本|富文本|备注框/;
const COMPAT_HINT = /多端|兼容|浏览器|PC\s*\+\s*APP|跨端/;
const INTEGRATION_HINT = /对接|接口集成|第三方|Webhook|开放API|联登|SSO/;

/**
 * @param {string} text
 * @returns {NfrDecision[]}
 */
function evaluateNfr(text) {
  const t = String(text || '');
  const out = [];

  const perf = PERF_HINT.test(t);
  out.push({
    type: 'performance',
    should_generate: perf,
    reason: perf
      ? '命中搜索/查询/批量/AI 提取等条件 → 可生成性能点'
      : '未命中性能条件 → 不生成'
  });

  const sec = SECURITY_HINT.test(t);
  out.push({
    type: 'security',
    should_generate: sec,
    reason: sec
      ? '疑似新增输入且支持长文本 → 可生成安全点'
      : '未同时满足「新增输入框且长文本」→ 不生成'
  });

  const compat = COMPAT_HINT.test(t);
  out.push({
    type: 'compatibility',
    should_generate: compat,
    reason: compat ? '命中多端/兼容表述' : '未命中兼容条件 → 不强制生成'
  });

  const integ = INTEGRATION_HINT.test(t);
  out.push({
    type: 'integration',
    should_generate: integ,
    reason: integ ? '命中对接/集成表述' : '未命中集成条件 → 不强制生成'
  });

  return out;
}

/**
 * 场景贡献 &lt; 60% 不补充（弱启发：标题含「可选/次要/顺便」等）
 */
function shouldSupplementScenario(title, detail) {
  const t = `${title || ''} ${detail || ''}`;
  if (/可选|次要|低价值|顺便|无关紧要/.test(t)) {
    return { ok: false, reason: '疑似对需求贡献 < 60%，不补充' };
  }
  return { ok: true, reason: '默认可补充（由 3A / 人审裁决）' };
}

/**
 * 核心场景禁合并
 */
function isCoreScenario(text) {
  return /开单|收账|收款|支付|付款成功|收银/.test(String(text || ''));
}

function runSelfTest() {
  let failed = 0;
  const d1 = evaluateNfr('支持批量查询客户列表');
  const ok1 = d1.find(x => x.type === 'performance').should_generate === true;
  console.log((ok1 ? '✓' : '✗') + ' performance on 批量查询');
  if (!ok1) failed++;

  const d2 = evaluateNfr('保存销售单后弹窗');
  const ok2 = d2.find(x => x.type === 'performance').should_generate === false;
  console.log((ok2 ? '✓' : '✗') + ' no performance on 弹窗');
  if (!ok2) failed++;

  const d3 = evaluateNfr('新增备注输入框，支持长文本');
  const ok3 = d3.find(x => x.type === 'security').should_generate === true;
  console.log((ok3 ? '✓' : '✗') + ' security on 长文本输入');
  if (!ok3) failed++;

  const okCore = isCoreScenario('销售开单收款');
  console.log((okCore ? '✓' : '✗') + ' core scenario');
  if (!okCore) failed++;

  if (failed) {
    console.error('self-test failed: ' + failed);
    process.exit(1);
  }
  console.log('self-test passed');
}

module.exports = {
  evaluateNfr,
  shouldSupplementScenario,
  isCoreScenario
};

if (require.main === module) {
  if (process.argv.includes('--self-test')) runSelfTest();
  else {
    console.log('Usage: node nfr_rules.js --self-test');
  }
}
