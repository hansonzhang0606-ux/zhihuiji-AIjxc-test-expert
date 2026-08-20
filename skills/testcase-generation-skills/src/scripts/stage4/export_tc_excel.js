/**
 * 从已确认的 C-TC 重新生成 Excel，不覆盖 test_cases.json
 * 用法：node stage4/export_tc_excel.js --project-dir <WS>
 */
'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { contractPath } = require('../lib/workspace');
const { formatDisplayLabels } = require('../lib/xmind_export');

const SRC_ROOT = path.resolve(__dirname, '../..');
const EXCEL_TEMPLATE = path.join(SRC_ROOT, 'templates', '数据模板_用例管理.xlsx');

function stepAction(s) { return s.action || s.step_description || ''; }
function stepExpected(s) { return s.expected || s.expected_result || ''; }
function stepOrder(s, i) { return s.order != null ? s.order : s.step_id != null ? s.step_id : i + 1; }

function generateExcel(testCases, outPath) {
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

  for (const tc of testCases.test_cases) {
    const row = new Array(24).fill('');
    const labels = formatDisplayLabels(tc);
    row[1] = `${tc.module_l1}-${tc.module_l2 || ''}`.replace(/-$/, '');
    row[2] = tc.id;
    row[3] = tc.title;
    row[4] = labels.join(',');
    row[5] = tc.precondition;
    row[6] = tc.steps.map((s, i) => `${stepOrder(s, i)}. ${stepAction(s)}`).join('\n');
    row[7] = tc.steps.map((s, i) => `${stepOrder(s, i)}. ${stepExpected(s)}`).join('\n');
    row[8] = (tc.product_tags || []).join(',');
    row[9] = row[1];
    row[10] = (tc.version_tags || []).join(',');
    row[11] = '功能测试';
    row[12] = (tc.source || []).join(',');
    row[13] = tc.priority;
    row[15] = '否';
    row[16] = testCases.requirement_title;
    data.push(row);
  }

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [
    { wch: 15 }, { wch: 30 }, { wch: 15 }, { wch: 50 }, { wch: 30 },
    { wch: 40 }, { wch: 65 }, { wch: 65 }, { wch: 20 }, { wch: 30 },
    { wch: 20 }, { wch: 15 }, { wch: 25 }, { wch: 12 }, { wch: 15 },
    { wch: 15 }, { wch: 20 }, { wch: 12 }, { wch: 20 }, { wch: 12 },
    { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }
  ];
  XLSX.utils.book_append_sheet(workbook, ws, templateWorkbook.SheetNames[0]);
  for (let i = 1; i < templateWorkbook.SheetNames.length; i++) {
    const sheetName = templateWorkbook.SheetNames[i];
    if (templateWorkbook.Sheets[sheetName]) {
      XLSX.utils.book_append_sheet(workbook, templateWorkbook.Sheets[sheetName], sheetName);
    }
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  XLSX.writeFile(workbook, outPath);
}

function parseArgs(argv) {
  const params = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project-dir' && argv[i + 1]) params.projectDir = argv[++i];
  }
  return params;
}

function main() {
  const params = parseArgs(process.argv.slice(2));
  if (!params.projectDir) {
    console.error('用法: node stage4/export_tc_excel.js --project-dir <WS>');
    process.exit(1);
  }
  const tcPath = contractPath(params.projectDir, 'testCases');
  const outPath = path.join(params.projectDir, 'script', 'stage4', 'test_cases.xlsx');
  const testCases = JSON.parse(fs.readFileSync(tcPath, 'utf8'));
  generateExcel(testCases, outPath);
  console.log(JSON.stringify({ ok: true, input: tcPath, output: outPath, case_count: testCases.test_cases.length }, null, 2));
}

main();
