/**
 * WP-63-CONTRACT 自测：KB 新契约 + 扩展后的 domain_facts / TP / TC
 */
'use strict';

const fs = require('fs');
const path = require('path');

const KB_CONTRACTS = path.resolve(__dirname, '..', 'contracts');
const SRC_CONTRACTS = path.resolve(__dirname, '..', '..', '..', 'src', 'contracts');
const FIXTURES = path.resolve(__dirname, '..', 'fixtures', 'contracts');

function loadAjv() {
  const scriptsNode = path.resolve(__dirname, '..', '..', '..', 'src', 'scripts', 'node_modules');
  const Ajv2020 = require(path.join(scriptsNode, 'ajv', 'dist', '2020'));
  const addFormats = require(path.join(scriptsNode, 'ajv-formats'));
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateSchema: false });
  addFormats(ajv);
  return ajv;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function addSchemaFile(ajv, file) {
  const schema = readJson(file);
  if (!ajv.getSchema(schema.$id)) ajv.addSchema(schema);
  return schema;
}

function assert(name, cond, detail) {
  if (!cond) {
    console.error(`✗ ${name}`, detail || '');
    process.exit(1);
  }
  console.log(`✓ ${name}`);
}

function validate(ajv, schemaId, data) {
  const v = ajv.getSchema(schemaId);
  const ok = v(data);
  return { ok, errors: v.errors };
}

function main() {
  const ajv = loadAjv();
  const kbFiles = [
    'kb_candidate.schema.json',
    'kb_changeset.schema.json',
    'kb_completeness_report.schema.json',
    'kb_ingest_overview.schema.json',
    'kb_review_manifest.schema.json',
    'kb_ingest_report.schema.json'
  ];
  for (const f of kbFiles) addSchemaFile(ajv, path.join(KB_CONTRACTS, f));
  addSchemaFile(ajv, path.join(SRC_CONTRACTS, 'final_artifact.schema.json'));
  addSchemaFile(ajv, path.join(SRC_CONTRACTS, 'domain_facts.schema.json'));
  addSchemaFile(ajv, path.join(SRC_CONTRACTS, 'test_points.schema.json'));
  addSchemaFile(ajv, path.join(SRC_CONTRACTS, 'test_cases.schema.json'));

  const cases = [
    ['candidate valid', 'https://testcase-generation.local/contracts/kb_candidate.schema.json', 'candidate.valid.json', true],
    ['changeset valid', 'https://testcase-generation.local/contracts/kb_changeset.schema.json', 'changeset.valid.json', true],
    ['overview valid', 'https://testcase-generation.local/contracts/kb_ingest_overview.schema.json', 'overview.valid.json', true],
    ['review valid', 'https://testcase-generation.local/contracts/kb_review_manifest.schema.json', 'review.valid.json', true],
    ['report valid', 'https://testcase-generation.local/contracts/kb_ingest_report.schema.json', 'report.valid.json', true],
    ['domain_facts legacy', 'https://testcase-generation.local/contracts/domain_facts.schema.json', 'domain_facts.legacy.json', true],
    ['domain_facts page_url', 'https://testcase-generation.local/contracts/domain_facts.schema.json', 'domain_facts.page_url.json', true],
    ['domain_facts backend_api', 'https://testcase-generation.local/contracts/domain_facts.schema.json', 'domain_facts.backend_api.json', true],
    ['domain_facts api missing element', 'https://testcase-generation.local/contracts/domain_facts.schema.json', 'domain_facts.backend_api.missing_element.json', false],
    ['tp with technical_refs', 'https://testcase-generation.local/contracts/test_points.schema.json', 'test_points.techrefs.json', true],
    ['tp api missing method', 'https://testcase-generation.local/contracts/test_points.schema.json', 'test_points.techrefs.bad.json', false],
    ['tc with technical_refs', 'https://testcase-generation.local/contracts/test_cases.schema.json', 'test_cases.techrefs.json', true],
    ['tp assertions and gaps valid', 'https://testcase-generation.local/contracts/test_points.schema.json', 'test_points.assertions.valid.json', true],
    ['tp body assertion missing json_path', 'https://testcase-generation.local/contracts/test_points.schema.json', 'test_points.assertions.invalid.json', false],
    ['tc assertions valid', 'https://testcase-generation.local/contracts/test_cases.schema.json', 'test_cases.assertions.valid.json', true],
    ['completeness valid', 'https://testcase-generation.local/contracts/kb_completeness_report.schema.json', 'completeness.valid.json', true],
    ['final artifact valid', 'https://testcase-generation.local/contracts/final_artifact.schema.json', 'final_artifact.valid.json', true]
  ];

  for (const [name, id, file, expectOk] of cases) {
    const data = readJson(path.join(FIXTURES, file));
    const r = validate(ajv, id, data);
    assert(name, r.ok === expectOk, r.ok ? '' : JSON.stringify(r.errors, null, 2));
  }

  const clone = (value) => JSON.parse(JSON.stringify(value));

  const tpMissingExpected = readJson(path.join(FIXTURES, 'test_points.assertions.valid.json'));
  delete tpMissingExpected.test_points[0].technical_refs[0].assertions[0].expected;
  let r = validate(
    ajv,
    'https://testcase-generation.local/contracts/test_points.schema.json',
    tpMissingExpected
  );
  assert('eq/contains/not_contains assertion requires expected', !r.ok);

  const completenessMismatch = readJson(path.join(FIXTURES, 'completeness.valid.json'));
  completenessMismatch.blocked_write = false;
  r = validate(
    ajv,
    'https://testcase-generation.local/contracts/kb_completeness_report.schema.json',
    completenessMismatch
  );
  assert('blocking gaps require blocked_write', !r.ok);

  const overview64 = readJson(path.join(FIXTURES, 'overview.valid.json'));
  overview64.source.type = 'ctc';
  overview64.items[0].api_rich = true;
  overview64.completeness_report = readJson(path.join(FIXTURES, 'completeness.valid.json'));
  overview64.blocked_write = true;
  r = validate(
    ajv,
    'https://testcase-generation.local/contracts/kb_ingest_overview.schema.json',
    overview64
  );
  assert('overview accepts ctc and completeness metadata', r.ok, JSON.stringify(r.errors, null, 2));

  const review64 = readJson(path.join(FIXTURES, 'review.valid.json'));
  review64.completeness_summary = {
    blocking_gap_count: 0,
    warning_gap_count: 1,
    blocked_write: false,
    report_hash: 'sha256:report64'
  };
  review64.source_manifest = clone(readJson(path.join(FIXTURES, 'final_artifact.valid.json')));
  r = validate(
    ajv,
    'https://testcase-generation.local/contracts/kb_review_manifest.schema.json',
    review64
  );
  assert('review accepts completeness and source manifest', r.ok, JSON.stringify(r.errors, null, 2));

  const invalidManifest = clone(review64.source_manifest);
  invalidManifest.finalized = false;
  r = validate(
    ajv,
    'https://testcase-generation.local/contracts/final_artifact.schema.json',
    invalidManifest
  );
  assert('final artifact must be finalized', !r.ok);

  const missingXmindManifest = clone(review64.source_manifest);
  missingXmindManifest.artifacts = missingXmindManifest.artifacts.filter(
    (artifact) => artifact.type !== 'xmind'
  );
  r = validate(
    ajv,
    'https://testcase-generation.local/contracts/final_artifact.schema.json',
    missingXmindManifest
  );
  assert('final artifact requires c_tc and xmind exactly once', !r.ok);

  require('./lib/tech_normalize').selfTest();
  console.log('self_test_contracts passed');
}

main();
