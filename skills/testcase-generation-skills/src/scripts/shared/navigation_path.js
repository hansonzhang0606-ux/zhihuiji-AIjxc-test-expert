/**
 * Demand 6.4 shared navigation-path parser.
 *
 * This module deliberately has no Stage3, Stage4, or KB dependencies so every
 * consumer applies the same read-compatible/write-canonical path rules.
 */
'use strict';

const CANONICAL_SEPARATOR = '→';
const NAVIGATION_PREFIX = /^\s*进入\s*/;

function normalizePageToken(token, warnings, index) {
  const trimmed = String(token || '').trim();
  if (trimmed.endsWith('页面')) {
    if (warnings) {
      warnings.push({
        code: 'page_suffix_normalized',
        token: trimmed,
        token_index: index,
        message: '页面名后缀“页面”已规范化为“页”'
      });
    }
    return `${trimmed.slice(0, -2)}页`;
  }
  return trimmed;
}

function normalizePathDetailed(path) {
  const warnings = [];
  let value = String(path == null ? '' : path).trim();
  value = value.replace(/\s*->\s*/g, CANONICAL_SEPARATOR);

  const legacySeparators = [
    { pattern: /\s*／\s*/g, name: '／' },
    { pattern: /\s*-\s*/g, name: '-' }
  ];

  for (const separator of legacySeparators) {
    separator.pattern.lastIndex = 0;
    if (separator.pattern.test(value)) {
      warnings.push({
        code: 'legacy_separator_normalized',
        separator: separator.name,
        message: `历史分隔符“${separator.name}”已规范化为“${CANONICAL_SEPARATOR}”`
      });
      separator.pattern.lastIndex = 0;
      value = value.replace(separator.pattern, CANONICAL_SEPARATOR);
    }
  }

  value = value.replace(/\s*→\s*/g, CANONICAL_SEPARATOR);
  const rawTokens = value
    .split(CANONICAL_SEPARATOR)
    .map((token) => token.trim())
    .filter(Boolean);
  const tokens = rawTokens.map((token, index) => normalizePageToken(token, warnings, index));

  return {
    normalized: tokens.join(` ${CANONICAL_SEPARATOR} `),
    tokens,
    warnings
  };
}

function normalizeNavigationPath(path) {
  return normalizePathDetailed(path).normalized;
}

function isPageToken(token) {
  return typeof token === 'string' && token.endsWith('页');
}

function extractRelations(parsedOrTokens) {
  const tokens = Array.isArray(parsedOrTokens)
    ? parsedOrTokens
    : (parsedOrTokens && Array.isArray(parsedOrTokens.tokens) ? parsedOrTokens.tokens : []);
  const relations = [];

  for (let index = 0; index <= tokens.length - 3; index += 1) {
    if (isPageToken(tokens[index]) && !isPageToken(tokens[index + 1]) && isPageToken(tokens[index + 2])) {
      relations.push({
        from_page: tokens[index],
        action: tokens[index + 1],
        to_page: tokens[index + 2],
        token_indexes: [index, index + 1, index + 2]
      });
    }
  }

  return relations;
}

function isNavigationStep(action) {
  if (typeof action !== 'string') return false;
  return NAVIGATION_PREFIX.test(action) && /[（(].+[）)]\s*$/.test(action);
}

function parseNavigationStep(action) {
  const result = {
    target_page: null,
    tokens: [],
    relations: [],
    normalized_path: '',
    normalized_action: String(action == null ? '' : action).trim(),
    valid: false,
    errors: [],
    warnings: []
  };

  if (typeof action !== 'string' || !isNavigationStep(action)) {
    result.errors.push({
      code: 'not_navigation_step',
      message: '导航步骤必须使用“进入目标页（路径链）”格式'
    });
    return result;
  }

  const match = action.trim().match(/^进入\s*(.+?)\s*[（(]\s*(.+?)\s*[）)]\s*$/);
  if (!match) {
    result.errors.push({
      code: 'navigation_syntax_invalid',
      message: '无法解析导航步骤的目标页或路径链'
    });
    return result;
  }

  result.target_page = normalizePageToken(match[1], result.warnings, -1);
  const normalized = normalizePathDetailed(match[2]);
  result.tokens = normalized.tokens;
  result.normalized_path = normalized.normalized;
  result.warnings.push(...normalized.warnings);
  result.relations = extractRelations(result.tokens);
  result.normalized_action = `进入${result.target_page}（${result.normalized_path}）`;

  if (!isPageToken(result.target_page)) {
    result.errors.push({
      code: 'target_page_suffix_invalid',
      target_page: result.target_page,
      message: '目标页名称必须以“页”结尾'
    });
  }

  const pageTokens = result.tokens.filter(isPageToken);
  if (pageTokens.length === 0) {
    result.errors.push({
      code: 'path_has_no_page',
      message: '路径链至少需要一个以“页”结尾的页面 token'
    });
  } else if (pageTokens[pageTokens.length - 1] !== result.target_page) {
    result.errors.push({
      code: 'target_page_mismatch',
      target_page: result.target_page,
      path_last_page: pageTokens[pageTokens.length - 1],
      message: '目标页必须等于路径链末级页面'
    });
  }

  result.valid = result.errors.length === 0;
  return result;
}

function detectDuplicateNavigationSteps(steps) {
  const byTarget = new Map();

  (Array.isArray(steps) ? steps : []).forEach((step, index) => {
    const action = typeof step === 'string' ? step : step && step.action;
    if (!isNavigationStep(action)) return;
    const parsed = parseNavigationStep(action);
    if (!parsed.target_page) return;
    if (!byTarget.has(parsed.target_page)) byTarget.set(parsed.target_page, []);
    byTarget.get(parsed.target_page).push(index);
  });

  return Array.from(byTarget.entries())
    .filter((entry) => entry[1].length > 1)
    .map(([target_page, step_indexes]) => ({
      target_page,
      step_indexes,
      count: step_indexes.length
    }));
}

module.exports = {
  CANONICAL_SEPARATOR,
  detectDuplicateNavigationSteps,
  extractRelations,
  isNavigationStep,
  normalizeNavigationPath,
  parseNavigationStep
};
