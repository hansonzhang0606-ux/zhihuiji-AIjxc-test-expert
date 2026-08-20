/**
 * Stage1 测试上下文识别（1CTX / Demand 6.0.2 / S1-04～07）
 *
 * 产出：script/config/test_context.json（C-CTX）
 * 不写需求点；不导出 XMind。
 *
 *   node stage1_context.js --project-dir <工作区> [--title <title>]
 *   node stage1_context.js --project-dir <工作区> --approve
 *   node stage1_context.js --self-test
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { sanitizeTitle } = require('../lib/naming');
const {
  contractPath,
  SRC_ROOT
} = require('../lib/workspace');
const { validateFile } = require('../lib/validate');

const SCRIPT_VERSION = '6.1.0';
const { buildRegressionHints } = require('../lib/regression_hints');
const TAG_RULES = path.join(SRC_ROOT, 'templates', '标签规则.md');
const CTX_SCHEMA = path.join(SRC_ROOT, 'contracts', 'test_context.schema.json');

function validateCtx(filePath) {
  return validateFile(filePath, CTX_SCHEMA);
}

const FULL = {
  products: ['智慧记AI进销存', 'ailit', '智慧记', '智慧记零售'],
  versions: ['开单版', '单店版', '多店版'],
  platforms: ['PC端', 'APP端', '小程序端', 'H5端']
};

const SPARK_PRODUCTS = ['智慧记AI进销存', 'ailit'];

/** Confluence 父级 title → 产品线 */
const PRODUCT_LINES = {
  spark: {
    id: 'spark',
    label: '星火',
    supported: true,
    allowed: SPARK_PRODUCTS
  },
  zhihuiji: {
    id: 'zhihuiji',
    label: '智慧记',
    supported: false,
    allowed: ['智慧记']
  },
  zhihuiji_retail: {
    id: 'zhihuiji_retail',
    label: '智慧记零售',
    supported: false,
    allowed: ['智慧记零售']
  }
};

/**
 * 从 Confluence 父页面 title 识别产品线
 * - 星火 V… → spark
 * - 智慧记零售版 V… → zhihuiji_retail（优先于智慧记）
 * - 智慧记 V… → zhihuiji
 */
function detectProductLineFromParent(parentTitle) {
  const t = String(parentTitle || '').trim();
  if (!t) return null;

  if (
    /智慧记零售(?:版)?\s*[Vv]/i.test(t) ||
    /^智慧记零售/i.test(t)
  ) {
    return PRODUCT_LINES.zhihuiji_retail;
  }
  if (/星火\s*[Vv]/i.test(t) || /^星火/i.test(t)) {
    return PRODUCT_LINES.spark;
  }
  if (
    /^智慧记\s*[Vv]/i.test(t) &&
    !/智慧记(?:AI|零售|星火)/i.test(t)
  ) {
    return PRODUCT_LINES.zhihuiji;
  }
  return null;
}

function readParentTitle(projectDir) {
  const candidates = [
    path.join(projectDir, 'script', 'stage1', 'download_manifest.json'),
    contractPath(projectDir, 'sessionInfo')
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const j = readJson(p);
      if (j.parent_title) return String(j.parent_title).trim();
      if (j.source && j.source.parent_title) {
        return String(j.source.parent_title).trim();
      }
    } catch (_) {
      /* ignore */
    }
  }
  return '';
}

const DEFAULT_IN = {
  products: ['智慧记AI进销存', 'ailit'],
  versions: ['开单版', '单店版', '多店版'],
  platforms: ['PC端', 'APP端']
};

/**
 * 关键词 → 规范枚举（契约内一律全称）
 * 别名：国内版→智慧记AI进销存；国际版→ailit；零售→智慧记零售
 */
const DICT = {
  products: {
    智慧记AI进销存: [
      '智慧记AI进销存',
      'AI进销存',
      '国内版',
      '国内版本',
      'Domestic',
      '境内版'
    ],
    ailit: [
      'ailit',
      'Ailit',
      'AILIT',
      '国际版',
      '国际版本',
      'International',
      'Global',
      '海外版',
      '境外版',
      '跨境'
    ],
    智慧记零售: ['智慧记零售', '零售版', '零售'],
    智慧记: ['智慧记']
  },
  versions: {
    开单版: ['开单版', '开单版本', '基础版', '免费版'],
    单店版: ['单店版', '单店版本', '标准版', '专业版', '单门店'],
    多店版: ['多店版', '多店版本', '连锁版', '旗舰版', '企业版', '连锁']
  },
  platforms: {
    PC端: ['PC端', 'PC', 'Web端', 'Web', '客户端', '电脑端', '桌面'],
    APP端: ['APP端', 'APP', '移动端', '移动', '手机端', '手机', 'Android', 'iOS', '安卓', '云店'],
    小程序端: ['小程序端', '小程序', '微信小程序'],
    H5端: ['H5端', 'H5', '手机网页', '浏览器页']
  }
};

function log(msg) {
  console.log(`[Stage1 context ${SCRIPT_VERSION}] ${msg}`);
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseArgs(argv) {
  const params = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project-dir' && argv[i + 1]) params.projectDir = argv[++i];
    else if (a === '--title' && argv[i + 1]) params.title = argv[++i];
    else if (a === '--approve') params.approve = true;
    else if (a === '--self-test') params.selfTest = true;
    else if (a === '--help' || a === '-h') params.help = true;
  }
  return params;
}

function printUsage() {
  console.log(`
Stage1 测试上下文识别 (1CTX / Demand 6.0.2)

  node stage1_context.js --project-dir <工作区> [--title <title>]
  node stage1_context.js --project-dir <工作区> --approve
  node stage1_context.js --self-test
`);
}

function resolveTitle(projectDir, explicit) {
  if (explicit != null && String(explicit).trim() !== '') {
    return sanitizeTitle(explicit);
  }
  const sessionPath = contractPath(projectDir, 'sessionInfo');
  if (fs.existsSync(sessionPath)) {
    try {
      const s = readJson(sessionPath);
      if (s.requirement_title) return sanitizeTitle(s.requirement_title);
    } catch (_) {
      /* ignore */
    }
  }
  return sanitizeTitle(path.basename(path.resolve(projectDir)));
}

function resolveReqMd(projectDir, title) {
  const dir = path.join(projectDir, 'input', '需求文档');
  const preferred = path.join(dir, title + '.md');
  if (fs.existsSync(preferred)) return preferred;
  if (!fs.existsSync(dir)) return null;
  const mds = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.md'));
  if (mds.length === 1) return path.join(dir, mds[0]);
  return null;
}

function unique(arr) {
  return [...new Set(arr)];
}

function findKwIndex(text, kw) {
  // 拉丁词忽略大小写（ailit / International 等）
  if (/^[A-Za-z]/.test(kw)) {
    return text.toLowerCase().indexOf(kw.toLowerCase());
  }
  return text.indexOf(kw);
}

function spansOverlap(a0, a1, b0, b1) {
  return !(a1 <= b0 || b1 <= a0);
}

/** 当前位置是否其实是更长产品/标签词的前缀（避免二次「智慧记零售」被拆成「智慧记」） */
function isPrefixOfLongerKeyword(text, start, kw, dim) {
  for (const [, kws] of Object.entries(DICT[dim])) {
    for (const other of kws) {
      if (other.length <= kw.length) continue;
      const slice = text.slice(start, start + other.length);
      if (slice.length < other.length) continue;
      if (findKwIndex(slice, other) === 0) return true;
    }
  }
  return false;
}

/** 将某规范枚举下所有关键词在全文中的命中区间标为已占用 */
function occupyAllKeywordSpans(text, canon, dim, occupied) {
  const kws = DICT[dim][canon] || [];
  for (const kw of kws) {
    let from = 0;
    while (from < text.length) {
      const slice = text.slice(from);
      const rel = findKwIndex(slice, kw);
      if (rel < 0) break;
      const start = from + rel;
      const end = start + kw.length;
      if (!occupied.some(([s, e]) => spansOverlap(start, end, s, e))) {
        occupied.push([start, end]);
      }
      from = start + 1;
    }
  }
}

/**
 * 全局最长关键词优先；已占用区间不再次匹配，避免
 * 「智慧记AI进销存」误拆成「智慧记」。命中后占用该枚举全部关键词区间。
 */
function matchTokensInText(text, dim) {
  if (!text) return [];
  const pairs = [];
  for (const [canon, kws] of Object.entries(DICT[dim])) {
    for (const kw of kws) {
      pairs.push({ canon, kw });
    }
  }
  pairs.sort((a, b) => b.kw.length - a.kw.length || a.canon.localeCompare(b.canon));

  const occupied = [];
  const hit = new Set();

  for (const { canon, kw } of pairs) {
    if (hit.has(canon)) continue;
    let from = 0;
    while (from < text.length) {
      const slice = text.slice(from);
      const rel = findKwIndex(slice, kw);
      if (rel < 0) break;
      const start = from + rel;
      const end = start + kw.length;
      const blocked = occupied.some(([s, e]) => spansOverlap(start, end, s, e));
      if (
        !blocked &&
        !isPrefixOfLongerKeyword(text, start, kw, dim)
      ) {
        hit.add(canon);
        occupyAllKeywordSpans(text, canon, dim, occupied);
        break;
      }
      from = start + 1;
    }
  }
  return [...hit];
}

function extractBracketContents(text) {
  const brackets = [];
  if (!text) return brackets;
  const re = /【([^】]+)】/g;
  let m;
  while ((m = re.exec(text)) !== null) brackets.push(m[1]);
  return brackets;
}

const DEFAULT_PLATFORMS = ['PC端', 'APP端'];
const DEFAULT_VERSIONS = ['开单版', '单店版', '多店版'];

function mergeDimHits(a, b) {
  const out = {};
  for (const dim of ['products', 'versions', 'platforms']) {
    out[dim] = unique([...(a[dim] || []), ...(b[dim] || [])]);
  }
  return out;
}

function mergeFullFlags(a, b) {
  return {
    products: !!(a.products || b.products),
    versions: !!(a.versions || b.versions),
    platforms: !!(a.platforms || b.platforms)
  };
}

/** 仅从标题字符串（及【】拆分）提取命中，不含正文 */
function extractTitleOnly(title) {
  const found = { products: [], versions: [], platforms: [] };
  if (!title) {
    return {
      found,
      fullFlags: { products: false, versions: false, platforms: false },
      brackets: []
    };
  }

  const brackets = extractBracketContents(title);
  const scanParts = [];
  for (const b of brackets) {
    for (const part of b.split(/[+／/、,，\s]+/)) {
      if (part.trim()) scanParts.push(part.trim());
    }
  }
  scanParts.push(title);

  const allText = scanParts.join('\n');
  for (const dim of Object.keys(found)) {
    found[dim] = matchTokensInText(allText, dim);
  }

  const scanForFull = [title, ...brackets].join('\n');
  const fullFlags = {
    products:
      /国内\s*\+\s*国际|国际\s*\+\s*国内|全产品|全系统|全部产品|四大产品/.test(
        scanForFull
      ),
    versions: /全版本|全部版本/.test(scanForFull),
    platforms: /全端|全平台|三端|四端/.test(scanForFull)
  };

  return { found, fullFlags, brackets };
}

/** 正文中的「标题标识」行，视为标题延伸（非全文收窄） */
function extractDeclaredTitleTags(body) {
  if (!body) return extractTitleOnly('');
  const parts = [];
  const idMatch = body.match(/标题标识[：:]\s*([^\n]+)/);
  if (idMatch) parts.push(idMatch[1]);
  const h1Match = body.match(/^#\s*(.+)$/m);
  if (h1Match) parts.push(h1Match[1]);
  return extractTitleOnly(parts.join('\n'));
}

/**
 * @deprecated 保留兼容；识别主路径改用 extractTitleOnly + extractDeclaredTitleTags
 */
function extractFromTitle(title, body) {
  const t = extractTitleOnly(title || '');
  const d = extractDeclaredTitleTags(body || '');
  return {
    found: mergeDimHits(t.found, d.found),
    fullFlags: mergeFullFlags(t.fullFlags, d.fullFlags),
    brackets: unique([].concat(t.brackets || [], d.brackets || []))
  };
}

/**
 * 正文命中：排除明显「不在范围 / 不涉及」否定句中的词
 */
function extractFromBody(body) {
  const found = { products: [], versions: [], platforms: [] };
  if (!body) return found;

  // 去掉含否定范围的句子，避免「小程序端不在范围内」把小程序打进 in_scope
  const cleaned = body
    .split(/[。！？\n]/)
    .filter(line => {
      const s = line.trim();
      if (!s) return false;
      if (/不在(本次)?(改动)?范围|不涉及|不覆盖|除外|无需(覆盖|测试)/.test(s)) {
        return false;
      }
      return true;
    })
    .join('\n');

  for (const dim of Object.keys(found)) {
    found[dim] = matchTokensInText(cleaned, dim);
  }
  return found;
}

function filterProductHits(hits, productLine) {
  let list = hits.slice();
  if (productLine && productLine.id === 'spark') {
    list = list.filter(p => SPARK_PRODUCTS.includes(p));
    return list;
  }
  if (productLine && !productLine.supported) {
    return list.filter(p => productLine.allowed.includes(p));
  }
  return list;
}

function buildProductsDimension(titleHits, bodyHits, forceFull, productLine) {
  const full = FULL.products;

  if (productLine && !productLine.supported) {
    const inScope = [...productLine.allowed];
    return {
      in_scope: inScope,
      out_of_scope: full.filter(v => !inScope.includes(v)),
      confidence: 'high',
      source: 'parent'
    };
  }

  let titleFiltered = filterProductHits(titleHits, productLine);

  if (forceFull && productLine && productLine.id === 'spark') {
    return {
      in_scope: [...SPARK_PRODUCTS],
      out_of_scope: full.filter(v => !SPARK_PRODUCTS.includes(v)),
      confidence: 'high',
      source: 'title'
    };
  }

  if (productLine && productLine.id === 'spark') {
    let inScope;
    let confidence;
    let source;

    if (titleFiltered.length > 0) {
      inScope = unique(titleFiltered);
      confidence = 'high';
      source = 'title';
    } else {
      inScope = [...SPARK_PRODUCTS];
      confidence = 'high';
      source = 'parent';
    }

    return {
      in_scope: inScope,
      out_of_scope: full.filter(v => !inScope.includes(v)),
      confidence,
      source
    };
  }

  if (titleFiltered.length > 0) {
    return buildDimension('products', titleFiltered, [], forceFull);
  }

  if (forceFull) {
    return {
      in_scope: [...SPARK_PRODUCTS],
      out_of_scope: full.filter(v => !SPARK_PRODUCTS.includes(v)),
      confidence: 'high',
      source: 'title'
    };
  }

  return {
    in_scope: [...DEFAULT_IN.products],
    out_of_scope: full.filter(v => !DEFAULT_IN.products.includes(v)),
    confidence: 'medium',
    source: 'default'
  };
}

function buildPlatformsDimension(titleHits, forceFull) {
  const full = FULL.platforms;

  if (forceFull) {
    return {
      in_scope: [...full],
      out_of_scope: [],
      confidence: 'high',
      source: 'title'
    };
  }

  if (titleHits.length > 0) {
    const inScope = unique(titleHits.filter(v => full.includes(v)));
    return {
      in_scope: inScope,
      out_of_scope: full.filter(v => !inScope.includes(v)),
      confidence: 'high',
      source: 'title'
    };
  }

  // 标题未写 PC/APP/小程序/H5/云店 等 → 默认 PC+APP（tag_rules §3.2）
  return {
    in_scope: [...DEFAULT_PLATFORMS],
    out_of_scope: full.filter(v => !DEFAULT_PLATFORMS.includes(v)),
    confidence: 'medium',
    source: 'default'
  };
}

function buildVersionsDimension(titleHits, forceFull, platformsInScope) {
  const full = FULL.versions;
  const hasPcApp = (platformsInScope || []).some(
    p => p === 'PC端' || p === 'APP端'
  );

  if (!hasPcApp) {
    return {
      in_scope: [],
      out_of_scope: [...full],
      confidence: 'high',
      source: 'title'
    };
  }

  if (forceFull) {
    return {
      in_scope: [...full],
      out_of_scope: [],
      confidence: 'high',
      source: 'title'
    };
  }

  if (titleHits.length > 0) {
    const inScope = unique(titleHits.filter(v => full.includes(v)));
    return {
      in_scope: inScope,
      out_of_scope: full.filter(v => !inScope.includes(v)),
      confidence: 'high',
      source: 'title'
    };
  }

  // 标题未写开单/单店/多店 → 默认全选（tag_rules §4.2）
  return {
    in_scope: [...DEFAULT_VERSIONS],
    out_of_scope: [],
    confidence: 'medium',
    source: 'default'
  };
}

function buildDimension(dim, titleHits, bodyHits, forceFull) {
  const full = FULL[dim];
  let inScope;
  let confidence;
  let source;

  if (forceFull) {
    inScope = [...full];
    confidence = 'high';
    source = 'title';
  } else if (titleHits.length > 0) {
    inScope = unique(titleHits.filter(v => full.includes(v)));
    confidence = 'high';
    source = 'title';
  } else if (bodyHits.length > 0) {
    inScope = unique(bodyHits.filter(v => full.includes(v)));
    confidence = 'medium';
    source = 'body';
  } else {
    inScope = [...DEFAULT_IN[dim]];
    confidence = 'low';
    source = 'default';
  }

  if (inScope.length === 0) {
    inScope = [...DEFAULT_IN[dim]];
    confidence = 'low';
    source = 'default';
  }

  const outScope = full.filter(v => !inScope.includes(v));
  return {
    in_scope: inScope,
    out_of_scope: outScope,
    confidence,
    source
  };
}

function recognize(title, body, opts) {
  opts = opts || {};
  const productLine =
    opts.productLine ||
    (opts.parentTitle ? detectProductLineFromParent(opts.parentTitle) : null);

  const titleOnly = extractTitleOnly(title || '');
  const declared = extractDeclaredTitleTags(body || '');
  const titleFound = mergeDimHits(titleOnly.found, declared.found);
  const fullFlags = mergeFullFlags(titleOnly.fullFlags, declared.fullFlags);
  const bodyFound = extractFromBody(body);

  const products = buildProductsDimension(
    titleFound.products,
    [],
    fullFlags.products,
    productLine
  );
  const platforms = buildPlatformsDimension(
    titleFound.platforms,
    fullFlags.platforms
  );
  const versions = buildVersionsDimension(
    titleFound.versions,
    fullFlags.versions,
    platforms.in_scope
  );

  const ctx = {
    requirement_title: title,
    products,
    versions,
    platforms,
    regression_hints: [],
    recognized_at: new Date().toISOString()
  };
  ctx.regression_hints = buildRegressionHints(ctx);

  const unsupported =
    productLine && !productLine.supported ? productLine : null;

  return {
    ctx,
    meta: {
      title_hits: titleFound,
      title_only_hits: titleOnly.found,
      declared_title_hits: declared.found,
      body_hits: bodyFound,
      full_flags: fullFlags,
      parent_title: opts.parentTitle || null,
      product_line: productLine ? productLine.id : null,
      product_line_label: productLine ? productLine.label : null,
      product_line_supported: productLine ? productLine.supported : null,
      unsupported_product_line: unsupported
        ? {
            id: unsupported.id,
            label: unsupported.label,
            message:
              '当前 Skills 仅支持星火产品线（智慧记AI进销存/ailit）。确认为「' +
              unsupported.label +
              '」需求后请停止，勿进入后续阶段。'
          }
        : null,
      tag_rules_path: TAG_RULES,
      tag_rules_exists: fs.existsSync(TAG_RULES)
    }
  };
}

function printSummary(ctx, meta) {
  const row = (label, block) => {
    log(
      `  ${label}: 涉及【${block.in_scope.join('、')}】 / 不涉及【${
        block.out_of_scope.length ? block.out_of_scope.join('、') : '无'
      }】（${block.confidence}, ${block.source}）`
    );
  };
  log('── 人审①摘要：请确认产品/版本/端是否准确 ──');
  if (meta && meta.parent_title) {
    log(`  Confluence 父级: ${meta.parent_title}`);
  }
  if (meta && meta.product_line_label) {
    log(
      `  产品线: ${meta.product_line_label}` +
        (meta.product_line_supported === false ? '（Skills 不支持）' : '（星火，可继续）')
    );
  }
  if (meta && meta.unsupported_product_line) {
    log(`  ⚠ ${meta.unsupported_product_line.message}`);
  }
  row('产品', ctx.products);
  row('版本', ctx.versions);
  row('端', ctx.platforms);
  const skipCount = ctx.regression_hints.filter(h => h.auto_skip_tp).length;
  const activeCount = ctx.regression_hints.length - skipCount;
  log(
    `  regression_hints: ${ctx.regression_hints.length} 条（默认生成 TP: ${activeCount}；auto_skip: ${skipCount}）`
  );
  if (meta && meta.unsupported_product_line) {
    log('  不支持的产品线：请勿 --approve，停止后续流程');
  } else {
    log('  确认后执行: node stage1/stage1_context.js --project-dir <工作区> --approve');
  }
}

function clearApproved(projectDir) {
  const progressPath = contractPath(projectDir, 'progressTracker');
  if (!fs.existsSync(progressPath)) return;
  try {
    const p = readJson(progressPath);
    if (p.test_context_approved) {
      p.test_context_approved = false;
      p.test_context_approved_at = null;
      writeJson(progressPath, p);
      log('已清除 test_context_approved（重新识别）');
    }
  } catch (_) {
    /* ignore */
  }
}

function runRecognize(projectDir, titleOpt) {
  const title = resolveTitle(projectDir, titleOpt);
  log('工作区: ' + projectDir);
  log('requirement_title: ' + title);

  if (!fs.existsSync(TAG_RULES)) {
    log('⚠ tag_rules 缺失: ' + TAG_RULES + '（仍按内置枚举识别）');
  } else {
    log('规则参考: ' + TAG_RULES + '（只读）');
  }

  const mdPath = resolveReqMd(projectDir, title);
  if (!mdPath) {
    throw new Error('未找到需求文档: input/需求文档/' + title + '.md');
  }
  const body = fs.readFileSync(mdPath, 'utf8');
  // 识别用标题：优先 session title；若 md 首行 # 含【】也可拼进扫描
  const h1 = (body.match(/^#\s*(.+)$/m) || [])[1] || '';
  const scanTitle = [title, h1].filter(Boolean).join(' ');

  const parentTitle = readParentTitle(projectDir);
  if (parentTitle) {
    log('Confluence 父级: ' + parentTitle);
  }

  const { ctx, meta } = recognize(scanTitle, body, { parentTitle });
  ctx.requirement_title = title;

  const ctxPath = path.join(projectDir, 'script', 'config', 'test_context.json');
  writeJson(ctxPath, ctx);
  clearApproved(projectDir);

  const recogPath = path.join(projectDir, 'script', 'stage1', 'context_recognition.json');
  writeJson(recogPath, {
    schema_version: '6.0',
    requirement_title: title,
    source_md: path.relative(projectDir, mdPath).replace(/\\/g, '/'),
    ...meta,
    completed_at: new Date().toISOString()
  });

  const v = validateCtx(ctxPath);
  if (!v.ok) {
    const msg = (v.errors || []).join('; ');
    throw new Error('C-CTX 校验失败: ' + msg);
  }

  log('✓ 已写入: script/config/test_context.json');
  log('✓ 已写入: script/stage1/context_recognition.json');
  printSummary(ctx, meta);

  const blocked = !!(meta.unsupported_product_line);

  console.log(
    JSON.stringify(
      {
        ok: true,
        action: 'recognize',
        requirement_title: title,
        path: path.relative(projectDir, ctxPath).replace(/\\/g, '/'),
        product_line: meta.product_line,
        unsupported_product_line: meta.unsupported_product_line,
        blocked,
        needs_review: blocked ||
          [ctx.products, ctx.versions, ctx.platforms].some(
            d => d.confidence === 'low'
          )
      },
      null,
      2
    )
  );
  return { ctx, ctxPath, meta, blocked };
}

function runApprove(projectDir) {
  const ctxPath = path.join(projectDir, 'script', 'config', 'test_context.json');
  if (!fs.existsSync(ctxPath)) {
    throw new Error('缺少 test_context.json，请先跑识别');
  }

  const recogPath = path.join(projectDir, 'script', 'stage1', 'context_recognition.json');
  if (fs.existsSync(recogPath)) {
    try {
      const recog = readJson(recogPath);
      if (recog.unsupported_product_line) {
        throw new Error(
          recog.unsupported_product_line.message +
            ' 当前 Skills 不支持该产品线，禁止 approve。'
        );
      }
      const inScope = (readJson(ctxPath).products || {}).in_scope || [];
      if (
        inScope.includes('智慧记') &&
        !inScope.includes('智慧记AI进销存') &&
        recog.product_line !== 'spark'
      ) {
        throw new Error(
          '产品范围为「智慧记」（非星火），当前 Skills 不支持，禁止 approve。'
        );
      }
      if (inScope.includes('智慧记零售') && recog.product_line !== 'spark') {
        throw new Error(
          '产品范围为「智慧记零售」，当前 Skills 不支持，禁止 approve。'
        );
      }
    } catch (e) {
      if (e.message.indexOf('Skills') !== -1 || e.message.indexOf('不支持') !== -1) {
        throw e;
      }
    }
  }

  const v = validateCtx(ctxPath);
  if (!v.ok) {
    throw new Error('C-CTX 非法，拒绝 approve: ' + (v.errors || []).join('; '));
  }

  const ctx = readJson(ctxPath);
  for (const dim of ['products', 'versions', 'platforms']) {
    if (ctx[dim]) ctx[dim].source = 'user_confirmed';
  }
  writeJson(ctxPath, ctx);

  const progressPath = path.join(projectDir, 'script', 'config', 'progress_tracker.json');
  let progress = {};
  if (fs.existsSync(progressPath)) {
    try {
      progress = readJson(progressPath);
    } catch (_) {
      progress = {};
    }
  }
  progress.test_context_approved = true;
  progress.test_context_approved_at = new Date().toISOString();
  if (progress.stage1_approved == null) progress.stage1_approved = false;
  if (progress.stage3_approved == null) progress.stage3_approved = false;
  writeJson(progressPath, progress);

  log('✓ test_context_approved=true');
  log('✓ 各维 source → user_confirmed');
  const recogMeta = fs.existsSync(recogPath) ? readJson(recogPath) : null;
  printSummary(ctx, recogMeta);
  console.log(
    JSON.stringify(
      {
        ok: true,
        action: 'approve',
        test_context_approved: true,
        next: '允许进入 1A（需求点+越界）；当前若未实现请停止'
      },
      null,
      2
    )
  );
}

function runSelfTest() {
  const os = require('os');
  const { createWorkspace } = require('../lib/workspace');
  let failed = 0;

  const rSparkParent = recognize(
    'V4.6.2 【PC/APP】版本降级时增购员工的处理',
    '正文无产品关键词',
    { parentTitle: '星火 V4.6' }
  );
  const okSpark =
    rSparkParent.ctx.products.in_scope.includes('智慧记AI进销存') &&
    rSparkParent.ctx.products.in_scope.includes('ailit') &&
    !rSparkParent.ctx.products.in_scope.includes('智慧记') &&
    rSparkParent.ctx.platforms.in_scope.includes('PC端') &&
    rSparkParent.ctx.platforms.in_scope.includes('APP端') &&
    rSparkParent.ctx.versions.in_scope.length === 3 &&
    rSparkParent.meta.product_line === 'spark';
  console.log((okSpark ? '✓' : '✗') + ' 父级星火 + 标题仅【PC/APP】→ 双产品+默认版本全选');
  if (!okSpark) {
    console.log(JSON.stringify(rSparkParent.ctx.products, null, 2));
    failed++;
  }

  const rZhihuijiParent = recognize('某需求', '', { parentTitle: '智慧记 V4.6' });
  const okZj =
    rZhihuijiParent.ctx.products.in_scope.includes('智慧记') &&
    rZhihuijiParent.meta.unsupported_product_line &&
    rZhihuijiParent.meta.unsupported_product_line.id === 'zhihuiji';
  console.log((okZj ? '✓' : '✗') + ' 父级智慧记 V4.6 → 不支持');
  if (!okZj) failed++;

  const rRetailParent = recognize('某需求', '', {
    parentTitle: '智慧记零售版 V4.6'
  });
  const okRetailParent =
    rRetailParent.ctx.products.in_scope.includes('智慧记零售') &&
    rRetailParent.meta.unsupported_product_line;
  console.log((okRetailParent ? '✓' : '✗') + ' 父级智慧记零售版 → 不支持');
  if (!okRetailParent) failed++;

  const r1 = recognize('【国际版】【PC+移动】客户来源调研弹窗', '正文提及国际版与PC端、APP端');
  const ok1 =
    r1.ctx.products.in_scope.includes('ailit') &&
    r1.ctx.products.out_of_scope.includes('智慧记AI进销存') &&
    r1.ctx.products.out_of_scope.includes('智慧记') &&
    r1.ctx.products.out_of_scope.includes('智慧记零售') &&
    r1.ctx.platforms.in_scope.includes('PC端') &&
    r1.ctx.platforms.in_scope.includes('APP端') &&
    r1.ctx.platforms.out_of_scope.includes('小程序端');
  console.log((ok1 ? '✓' : '✗') + ' title 【国际版】→ailit 【PC+移动】');
  if (!ok1) failed++;

  const rFixtureLike = recognize(
    '客户来源调研弹窗',
    '> 标题标识：【国际版】【PC+移动】\n小程序端不在范围内\n国内版不在本次改动范围\n'
  );
  const okF =
    rFixtureLike.ctx.products.in_scope.length === 1 &&
    rFixtureLike.ctx.products.in_scope[0] === 'ailit' &&
    rFixtureLike.ctx.platforms.out_of_scope.includes('小程序端') &&
    rFixtureLike.ctx.products.source === 'title';
  console.log((okF ? '✓' : '✗') + ' body 【】 + 否定句 → ailit');
  if (!okF) {
    console.log(JSON.stringify(rFixtureLike.ctx, null, 2));
    failed++;
  }

  const rFullName = recognize(
    'V4.6.0_【智慧记AI进销存APP智慧记小程序】货客易联登',
    '本期只涉及智慧记/AI进销存APP，需在智慧记小程序增加入口',
    { parentTitle: '星火 V4.6' }
  );
  const okFull =
    rFullName.ctx.products.in_scope.includes('智慧记AI进销存') &&
    !rFullName.ctx.products.in_scope.includes('智慧记') &&
    !rFullName.ctx.products.in_scope.includes('ailit') &&
    rFullName.ctx.platforms.in_scope.includes('APP端') &&
    rFullName.ctx.platforms.in_scope.includes('小程序端');
  console.log((okFull ? '✓' : '✗') + ' 星火父级+全称 智慧记AI进销存（不含单独智慧记）');
  if (!okFull) {
    console.log(JSON.stringify(rFullName.ctx.products, null, 2));
    failed++;
  }

  const rRetail = recognize('【智慧记零售】库存同步', '');
  const okRetail =
    rRetail.ctx.products.in_scope.includes('智慧记零售') &&
    rRetail.ctx.products.in_scope.length === 1;
  console.log((okRetail ? '✓' : '✗') + ' 智慧记零售（不误拆智慧记）');
  if (!okRetail) failed++;

  const rBare = recognize(
    '6、自定义商品属性支持输入至130个字符',
    '正文展示 Ailit 界面外语商品名，不涉及端与版本说明',
    { parentTitle: '星火 V4.6' }
  );
  const okBare =
    rBare.ctx.products.in_scope.includes('智慧记AI进销存') &&
    rBare.ctx.products.in_scope.includes('ailit') &&
    rBare.ctx.platforms.in_scope.includes('PC端') &&
    rBare.ctx.platforms.in_scope.includes('APP端') &&
    rBare.ctx.versions.in_scope.length === 3 &&
    !rBare.ctx.products.in_scope.includes('智慧记');
  console.log((okBare ? '✓' : '✗') + ' 无【】标题 → 双产品+PC/APP+版本全选');
  if (!okBare) {
    console.log(JSON.stringify(rBare.ctx, null, 2));
    failed++;
  }

  const r2 = recognize('普通功能无标识', '');
  const ok2 =
    r2.ctx.products.in_scope.includes('智慧记AI进销存') &&
    r2.ctx.products.in_scope.includes('ailit') &&
    r2.ctx.versions.in_scope.length === 3 &&
    r2.ctx.platforms.in_scope.includes('PC端') &&
    r2.ctx.platforms.in_scope.includes('APP端');
  console.log((ok2 ? '✓' : '✗') + ' 全无标识 → 双产品+PC/APP+版本全选');
  if (!ok2) failed++;

  const regHints = buildRegressionHints({
    products: {
      in_scope: ['ailit'],
      out_of_scope: ['智慧记AI进销存', '智慧记', '智慧记零售']
    },
    versions: { in_scope: ['开单版'], out_of_scope: ['单店版', '多店版'] },
    platforms: {
      in_scope: ['PC端', 'APP端'],
      out_of_scope: ['小程序端', 'H5端']
    }
  });
  const skipTargets = regHints.filter(h => h.auto_skip_tp).map(h => h.target);
  const okReg =
    regHints.length === 7 &&
    skipTargets.includes('智慧记') &&
    skipTargets.includes('智慧记零售') &&
    skipTargets.includes('小程序端') &&
    skipTargets.includes('H5端') &&
    !regHints.find(h => h.target === '智慧记AI进销存')?.auto_skip_tp &&
    !regHints.find(h => h.target === '单店版')?.auto_skip_tp;
  console.log((okReg ? '✓' : '✗') + ' regression_hints auto_skip_tp 策略');
  if (!okReg) {
    console.log(JSON.stringify(regHints, null, 2));
    failed++;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's1-ctx-'));
  const ws = createWorkspace({ title: '客户来源调研弹窗', outputDir: tmp }).workspaceRoot;
  const fixtureMd = path.join(
    SRC_ROOT,
    'fixtures',
    '客户来源调研弹窗',
    'input',
    '需求文档',
    '客户来源调研弹窗.md'
  );
  fs.copyFileSync(
    fixtureMd,
    path.join(ws, 'input', '需求文档', '客户来源调研弹窗.md')
  );

  const { ctx } = runRecognize(ws, '客户来源调研弹窗');
  const v = validateCtx(path.join(ws, 'script', 'config', 'test_context.json'));
  console.log((v.ok ? '✓' : '✗') + ' fixture workspace validate');
  if (!v.ok) failed++;

  runApprove(ws);
  const prog = readJson(path.join(ws, 'script', 'config', 'progress_tracker.json'));
  console.log((prog.test_context_approved ? '✓' : '✗') + ' approve flag');
  if (!prog.test_context_approved) failed++;

  // 重识别应清 approved
  runRecognize(ws, '客户来源调研弹窗');
  const prog2 = readJson(path.join(ws, 'script', 'config', 'progress_tracker.json'));
  console.log((!prog2.test_context_approved ? '✓' : '✗') + ' re-recognize clears approve');
  if (prog2.test_context_approved) failed++;

  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }

  if (failed > 0) {
    console.error('self-test failed: ' + failed);
    process.exit(1);
  }
  console.log('self-test passed');
  void ctx;
  process.exit(0);
}

function main() {
  const params = parseArgs(process.argv.slice(2));
  if (params.help) {
    printUsage();
    process.exit(0);
  }
  if (params.selfTest) {
    // self-test 会调用 runRecognize 打印大量日志；直接跑
    runSelfTest();
    return;
  }
  if (!params.projectDir) {
    printUsage();
    process.exit(1);
  }
  const projectDir = path.resolve(params.projectDir);
  if (!fs.existsSync(projectDir)) {
    console.error('错误: project-dir 不存在');
    process.exit(1);
  }

  try {
    if (params.approve) {
      runApprove(projectDir);
    } else {
      runRecognize(projectDir, params.title);
    }
  } catch (e) {
    console.error('错误: ' + e.message);
    process.exit(1);
  }
}

module.exports = {
  recognize,
  buildRegressionHints,
  detectProductLineFromParent,
  readParentTitle,
  PRODUCT_LINES,
  FULL,
  DEFAULT_IN
};

if (require.main === module) {
  main();
}
