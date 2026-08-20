/**
 * Demand 6.1 — regression_hints 策略（1CTX 生成 + 3A 门禁共用）
 *
 * 默认对「非星火产品线 / 非本需求端」标 auto_skip_tp=true，3A 不生成对应回归 TP。
 */
'use strict';

const SPARK_PRODUCTS = ['智慧记AI进销存', 'ailit'];

const NON_SPARK_PRODUCTS = ['智慧记', '智慧记零售'];

/**
 * @param {'product_regression'|'version_regression'|'platform_regression'} type
 * @param {string} target
 * @returns {boolean}
 */
function shouldAutoSkipTp(type, target) {
  if (type === 'product_regression') {
    return NON_SPARK_PRODUCTS.includes(target);
  }
  if (type === 'platform_regression') {
    return true;
  }
  return false;
}

/**
 * @param {object} ctx C-CTX 或 test_context 子树
 * @returns {object[]}
 */
function buildRegressionHints(ctx) {
  const hints = [];
  const map = [
    ['products', 'product_regression', '产品'],
    ['versions', 'version_regression', '版本'],
    ['platforms', 'platform_regression', '端']
  ];
  for (const [dim, type, label] of map) {
    const block = ctx[dim] || {};
    for (const target of block.out_of_scope || []) {
      const auto_skip_tp = shouldAutoSkipTp(type, target);
      hints.push({
        type,
        target,
        priority: 'P3',
        suggestion: auto_skip_tp
          ? `（默认 skip）${label}「${target}」不在本次范围，人审①可显式取消 skip 后再生成回归 TP`
          : `建议增加1条低优先级回归用例，验证${label}「${target}」不受本次需求影响`,
        auto_skip_tp
      });
    }
  }
  return hints;
}

/**
 * @param {object} hint
 * @returns {boolean}
 */
function isAutoSkipHint(hint) {
  return !!(hint && hint.auto_skip_tp === true);
}

/**
 * @param {object} tp
 * @param {object} hint
 * @returns {boolean}
 */
function regressionTpMatchesHint(tp, hint) {
  if (!tp || !tp.is_regression || !hint) return false;
  if (hint.type === 'product_regression') {
    return (tp.product_tags || []).includes(hint.target);
  }
  if (hint.type === 'platform_regression') {
    return (tp.platform_tags || []).includes(hint.target);
  }
  if (hint.type === 'version_regression') {
    return (tp.version_tags || []).includes(hint.target);
  }
  return false;
}

/**
 * @param {object[]} points draft 或 normalized 测试点
 * @param {object|null} ctx C-CTX
 * @returns {{ ok: boolean, errors: string[], regression_skipped: object[] }}
 */
function checkAutoSkipRegression(points, ctx) {
  const hints = (ctx && ctx.regression_hints) || [];
  const skipHints = hints.filter(isAutoSkipHint);
  const regression_skipped = skipHints.map(h => ({
    type: h.type,
    target: h.target,
    reason: 'auto_skip_tp'
  }));

  if (!skipHints.length) {
    return { ok: true, errors: [], regression_skipped };
  }

  // 显式「生成」的回归 hint（auto_skip=false）可覆盖平台/版本维度的 auto_skip。
  // 例如：ailit 产品回归（auto_skip=false）落点为 H5 端页面，而 H5 端平台 hint 为
  // auto_skip=true 且自身注明「已由 ailit 提示覆盖」——此时该回归 TP 应豁免。
  const genHints = hints.filter(h => !isAutoSkipHint(h));

  const errors = [];
  for (const tp of points || []) {
    if (!tp.is_regression) continue;
    for (const hint of skipHints) {
      if (regressionTpMatchesHint(tp, hint)) {
        const exempt = genHints.some(g => regressionTpMatchesHint(tp, g));
        if (exempt) continue;
        errors.push(
          `${tp.id}: 回归 TP 对应 auto_skip_tp hint（${hint.type}/${hint.target}），默认不应生成`
        );
      }
    }
  }
  return { ok: errors.length === 0, errors, regression_skipped };
}

module.exports = {
  SPARK_PRODUCTS,
  NON_SPARK_PRODUCTS,
  shouldAutoSkipTp,
  buildRegressionHints,
  isAutoSkipHint,
  regressionTpMatchesHint,
  checkAutoSkipRegression
};
