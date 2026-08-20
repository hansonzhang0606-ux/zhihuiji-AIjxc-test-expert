/**
 * Stage5：导出 P0 用例 Excel（金蝶 DevOps 用例管理平台导入格式）
 *
 * 用法：
 *   node stage5/export_platform_p0_excel.js --project-dir <WS>
 *   node stage5/export_platform_p0_excel.js --project-dir <WS> --prj PRJ-00758363
 *   node stage5/export_platform_p0_excel.js --self-test
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { contractPath } = require('../lib/workspace');
const {
  loadPlatformImportConfig,
  generatePlatformP0Excel
} = require('./platform_excel');

const SCRIPT_VERSION = '1.0';

function parseArgs(argv) {
  const params = { copyToOutput: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project-dir' && argv[i + 1]) params.projectDir = argv[++i];
    else if (a === '--prj' && argv[i + 1]) params.prj = argv[++i];
    else if (a === '--no-copy-output') params.copyToOutput = false;
    else if (a === '--self-test') params.selfTest = true;
    else if (a === '--help' || a === '-h') params.help = true;
  }
  return params;
}

function printUsage() {
  console.log(`
Stage5 平台 P0 Excel 导出

用法:
  node stage5/export_platform_p0_excel.js --project-dir <工作区>
  node stage5/export_platform_p0_excel.js --project-dir <WS> --prj PRJ-xxxxxxx
  node stage5/export_platform_p0_excel.js --self-test

产出:
  script/stage5/test_cases_P0_platform.xlsx
  output/测试用例_P0_{title}.xlsx   （默认复制，供 DevOps 手工导入）
  script/stage5/platform_export_report.json

配置:
  src/templates/用例平台导入配置.json（可选）
  {WS}/script/config/platform_import.json（可选，覆盖 PRJ/主数据字段）

导入平台见 src/stages/stage5_platform_import.md；接口抓包见仓库 demand/上传用例接口信息
`);
}

function writeReport(projectDir, report) {
  const reportPath = path.join(projectDir, 'script', 'stage5', 'platform_export_report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      Object.assign({ schema_version: '1.0', stage: 'stage5_export', exported_at: new Date().toISOString() }, report),
      null,
      2
    ),
    'utf8'
  );
  return reportPath;
}

function assertWorkspaceMinimal(projectDir) {
  for (const rel of ['input', 'output', 'script']) {
    if (!fs.existsSync(path.join(projectDir, rel))) {
      throw new Error('工作区缺少目录: ' + rel);
    }
  }
}

function runExport(params) {
  assertWorkspaceMinimal(params.projectDir);
  const tcPath = contractPath(params.projectDir, 'testCases');
  if (!fs.existsSync(tcPath)) {
    throw new Error('缺少 test_cases.json，请先完成 Stage4');
  }
  const testCases = JSON.parse(fs.readFileSync(tcPath, 'utf8'));
  const overrides = params.prj ? { relate_req_code: params.prj } : {};
  const config = loadPlatformImportConfig(params.projectDir, overrides);

  const stage5Dir = path.join(params.projectDir, 'script', 'stage5');
  fs.mkdirSync(stage5Dir, { recursive: true });
  const scriptOut = path.join(stage5Dir, 'test_cases_P0_platform.xlsx');
  const title = testCases.requirement_title || path.basename(params.projectDir);
  const publicOut = path.join(params.projectDir, 'output', `测试用例_P0_${title}.xlsx`);

  const result = generatePlatformP0Excel(testCases, scriptOut, {
    config,
    title,
    rootHint: params.projectDir
  });
  if (params.copyToOutput !== false) {
    fs.copyFileSync(scriptOut, publicOut);
    result.output_public = publicOut;
  }

  const reportPath = writeReport(params.projectDir, result);
  result.report = reportPath;
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function selfTest() {
  const fixture = path.resolve(__dirname, '..', '..', 'fixtures', '客户来源调研弹窗');
  const cfgPath = path.join(fixture, 'script', 'config', 'platform_import.json');
  const hadCfg = fs.existsSync(cfgPath);
  const backup = hadCfg ? fs.readFileSync(cfgPath, 'utf8') : null;
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({ relate_req_code: 'PRJ-TEST-00001' }, null, 2),
    'utf8'
  );
  try {
    const result = runExport({ projectDir: fixture, copyToOutput: false });
    if (!result.ok || result.case_count < 1) throw new Error('export failed');
    if (result.relate_req_code !== 'PRJ-TEST-00001') throw new Error('prj mismatch');
    console.log('stage5 export_platform_p0_excel self-test OK');
  } finally {
    if (backup != null) fs.writeFileSync(cfgPath, backup, 'utf8');
    else if (fs.existsSync(cfgPath)) fs.unlinkSync(cfgPath);
  }
}

function main() {
  const params = parseArgs(process.argv.slice(2));
  if (params.help) {
    printUsage();
    return;
  }
  if (params.selfTest) {
    selfTest();
    return;
  }
  if (!params.projectDir) {
    printUsage();
    process.exit(1);
  }
  try {
    runExport(params);
  } catch (err) {
    console.error(`[Stage5 ${SCRIPT_VERSION}]`, err.message || err);
    process.exit(1);
  }
}

main();
