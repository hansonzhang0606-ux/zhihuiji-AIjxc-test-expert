/**
 * Stage5：P0 用例 → 金蝶 DevOps 用例管理平台 Excel
 * 列映射与字段规则见 src/stages/stage5_platform_import.md
 */
'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { formatDisplayLabels } = require('../lib/xmind_export');

const SRC_ROOT = path.resolve(__dirname, '..', '..');
const EXCEL_TEMPLATE = path.join(SRC_ROOT, 'templates', '数据模板_用例管理.xlsx');
const DEFAULT_CONFIG_EXAMPLE = path.join(SRC_ROOT, 'templates', '用例平台导入配置.example.json');

const DEFAULTS = {
  team: '智慧记-星火',
  product: '星火',
  modulePath: '智慧记AI进销存-智慧记AI进销存',
  caseType: '功能测试',
  manager: '傅文浩',
  autoState: '否',
  source: '',
  priorityFilter: 'P0',
  story_by_title_hint: []
};

function stepAction(s) {
  return s.action || s.step_description || '';
}
function stepExpected(s) {
  return s.expected || s.expected_result || '';
}
function stepOrder(s, i) {
  return s.order != null ? s.order : s.step_id != null ? s.step_id : i + 1;
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/** 合并：defaults < 模板配置 < 工作区 script/config/platform_import.json < CLI overrides */
function loadPlatformImportConfig(workspaceRoot, cliOverrides) {
  const merged = Object.assign({}, DEFAULTS);
  const example = readJsonIfExists(DEFAULT_CONFIG_EXAMPLE);
  if (example && example.defaults) Object.assign(merged, example.defaults);
  if (example && example.story_by_title_hint) {
    merged.story_by_title_hint = example.story_by_title_hint.slice();
  }
  const templateCfg = path.join(SRC_ROOT, 'templates', '用例平台导入配置.json');
  const tpl = readJsonIfExists(templateCfg);
  if (tpl && tpl.defaults) Object.assign(merged, tpl.defaults);
  if (tpl && tpl.story_by_title_hint) merged.story_by_title_hint = tpl.story_by_title_hint.slice();
  if (workspaceRoot) {
    const wsCfg = readJsonIfExists(
      path.join(workspaceRoot, 'script', 'config', 'platform_import.json')
    );
    if (wsCfg && wsCfg.defaults) Object.assign(merged, wsCfg.defaults);
    if (wsCfg && wsCfg.relate_req_code) merged.relate_req_code = wsCfg.relate_req_code;
    if (wsCfg && wsCfg.story_by_title_hint) merged.story_by_title_hint = wsCfg.story_by_title_hint.slice();
  }
  if (cliOverrides) Object.assign(merged, cliOverrides);
  return merged;
}

function resolveVersion(rootHint, title) {
  const text = `${title || ''}\n${rootHint || ''}`;
  const m = text.match(/[Vv](\d+\.\d+\.\d+)/);
  if (m) return `V${m[1]}`;
  const folder = text.match(/v(\d+\.\d+\.\d+)/i);
  if (folder) return `V${folder[1]}`;
  return 'V0.0.0';
}

/** PC+APP 并存 → web端；仅 APP → app端；仅 PC → web端；小程序 → 小程序端 */
function resolvePlatformLabel(cases) {
  const tags = new Set();
  for (const tc of cases) {
    for (const p of tc.platform_tags || []) tags.add(String(p).trim());
  }
  const hasPC = tags.has('PC端');
  const hasAPP = tags.has('APP端');
  const hasMini = tags.has('小程序端');
  if (hasPC && hasAPP) return 'web端';
  if (hasPC) return 'web端';
  if (hasAPP) return 'app端';
  if (hasMini) return '小程序端';
  return 'web端';
}

function buildCaseGroup(title, cases, rootHint) {
  const year = new Date().getFullYear();
  const version = resolveVersion(rootHint, title);
  const platform = resolvePlatformLabel(cases);
  const reqName = String(title || '').trim();
  return `${year}-${version}-${platform}-${reqName}`;
}

function resolveRelateReqCode(title, rootHint, config) {
  if (config.relate_req_code) return String(config.relate_req_code).trim();
  const text = `${title || ''}\n${rootHint || ''}`;
  for (const item of config.story_by_title_hint || []) {
    if (item.hint && text.includes(item.hint)) {
      return item.prj || item.story || item.relate_req_code || '';
    }
  }
  return '';
}

function filterCasesByPriority(testCases, priorityFilter) {
  const pf = String(priorityFilter || 'P0').toUpperCase();
  return (testCases.test_cases || []).filter(
    (tc) => String(tc.priority || '').toUpperCase() === pf
  );
}

function generatePlatformP0Excel(testCases, outPath, options) {
  const cfg = options.config || DEFAULTS;
  const title = testCases.requirement_title || options.title || '';
  const rootHint = options.rootHint || '';
  const cases = filterCasesByPriority(testCases, cfg.priorityFilter);
  const caseGroup = buildCaseGroup(title, cases, rootHint);
  const storyCode = resolveRelateReqCode(title, rootHint, cfg);

  if (!storyCode) {
    throw new Error(
      '未解析关联用户故事 PRJ：请在 script/config/platform_import.json 设置 relate_req_code，或配置 story_by_title_hint'
    );
  }
  if (cases.length === 0) {
    throw new Error(`无 ${cfg.priorityFilter || 'P0'} 用例可导出`);
  }

  const templateWorkbook = XLSX.readFile(EXCEL_TEMPLATE);
  const workbook = XLSX.utils.book_new();
  const data = [];

  data.push(['用例管理 # dmp_testcase']);
  data.push(['请将鼠标移到灰色标题行查看字段录入要求。红色带星号（*）的字段为必录字段。']);
  data.push([
    'team', 'caseGroup', 'number', 'name', 'caseLabels', 'preCondition',
    'input', 'output', 'product', 'modulePath', 'version', 'caseType',
    'source', 'caseLevel', 'manager', 'autoState', 'relateReqCode',
    'workload', 'remarks', 'separator', 'autoCaseId', 'autoCaseName',
    'autoProductId', 'autoVersionId'
  ]);
  data.push([
    '*项目组', '*功能路径（用例分组）', '用例编号', '*功能点（用例名称）',
    '用例标签', '功能说明（前置条件）', 'input（步骤描述）', 'output（预期结果）',
    '*产品', '*模块路径', '适用版本', '*用例类型', '来源', '用例级别',
    '*责任人', '已实现自动化', '关联用户故事', '工作量（分钟）', '备注',
    '分隔符', '接口自动化用例ID', '接口自动化用例名称', '接口自动化产品ID', '接口自动化版本ID'
  ]);

  for (const tc of cases) {
    const row = new Array(24).fill('');
    const labels = formatDisplayLabels(tc);
    row[0] = cfg.team;
    row[1] = caseGroup;
    row[2] = tc.id;
    row[3] = tc.title;
    row[4] = labels.join(',');
    row[5] = tc.precondition;
    row[6] = tc.steps.map((s, i) => `${stepOrder(s, i)}. ${stepAction(s)}`).join('\n');
    row[7] = tc.steps.map((s, i) => `${stepOrder(s, i)}. ${stepExpected(s)}`).join('\n');
    row[8] = cfg.product;
    row[9] = cfg.modulePath;
    row[10] = (tc.version_tags || []).join(',');
    row[11] = cfg.caseType;
    row[12] = cfg.source != null ? cfg.source : '';
    row[13] = tc.priority;
    row[14] = cfg.manager;
    row[15] = cfg.autoState;
    row[16] = storyCode;
    data.push(row);
  }

  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(workbook, ws, templateWorkbook.SheetNames[0]);
  for (let i = 1; i < templateWorkbook.SheetNames.length; i++) {
    const sheetName = templateWorkbook.SheetNames[i];
    if (templateWorkbook.Sheets[sheetName]) {
      XLSX.utils.book_append_sheet(workbook, templateWorkbook.Sheets[sheetName], sheetName);
    }
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  XLSX.writeFile(workbook, outPath);

  return {
    ok: true,
    requirement_title: title,
    case_group: caseGroup,
    relate_req_code: storyCode,
    priority_filter: cfg.priorityFilter || 'P0',
    case_count: cases.length,
    output: outPath,
    fields: {
      team: cfg.team,
      product: cfg.product,
      modulePath: cfg.modulePath,
      caseType: cfg.caseType,
      manager: cfg.manager,
      source: cfg.source != null ? cfg.source : ''
    }
  };
}

module.exports = {
  DEFAULTS,
  EXCEL_TEMPLATE,
  loadPlatformImportConfig,
  resolveVersion,
  resolvePlatformLabel,
  buildCaseGroup,
  resolveRelateReqCode,
  filterCasesByPriority,
  generatePlatformP0Excel
};
