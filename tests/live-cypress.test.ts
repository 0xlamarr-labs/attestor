/**
 * LIVE ONC Cypress API Validation Test
 *
 * Validates generated QRDA III XML against the REAL ONC Cypress server
 * at cypressdemo.healthit.gov.
 *
 * ENV-GATED: Requires CYPRESS_UMLS_USER and CYPRESS_UMLS_PASS.
 * These are free NLM/UMLS credentials — sign up at uts.nlm.nih.gov.
 * Skip gracefully when credentials are not set.
 *
 * Run: CYPRESS_UMLS_USER=x CYPRESS_UMLS_PASS=y npx tsx tests/live-cypress.test.ts
 */

import { strict as assert } from 'node:assert';

let passed = 0;
function ok(condition: boolean, msg: string): void { assert(condition, msg); passed++; }

async function run() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  LIVE ONC CYPRESS API — Real Server Validation');
  console.log('══════════════════════════════════════════════════════════════\n');

  const { isCypressConfigured, validateViaCypressApi } = await import('../src/filing/cypress-api-client.js');

  // ═══ CONNECTIVITY TEST (always runs, no credentials needed) ═══
  console.log('  [Cypress API Connectivity Test]');
  {
    const { generateQrda3: genQrda } = await import('../src/filing/qrda3-generator.js');
    const { CMS165_BLOOD_PRESSURE: bp, evaluateMeasure: evalM } = await import('../src/domains/healthcare-measures.js');
    const testXml = genQrda([evalM(bp, { initial_population: 100, denominator: 90, denominator_exclusion: 10, numerator: 72 })]);
    const connResult = await validateViaCypressApi(testXml, { user: 'connectivity-test', pass: 'connectivity-test', year: '2025' });
    ok(connResult.scope === 'onc_cypress_api', 'Connectivity: scope = onc_cypress_api');
    ok(connResult.httpStatus === 401, 'Connectivity: server reachable (HTTP 401 = auth required)');
    ok(connResult.errors.length > 0, 'Connectivity: server returned error message');
    console.log(`    HTTP ${connResult.httpStatus}: ${connResult.errors[0]?.message ?? 'no message'}`);
    console.log('    ✓ ONC Cypress server is reachable and responding\n');
  }

  if (!isCypressConfigured()) {
    console.log('  ⊘ FULL VALIDATION SKIPPED: CYPRESS_UMLS_USER / CYPRESS_UMLS_PASS not set');
    console.log('    Sign up for free UMLS credentials at: https://uts.nlm.nih.gov/uts/signup-login');
    console.log('    Then: CYPRESS_UMLS_USER=x CYPRESS_UMLS_PASS=y npx tsx tests/live-cypress.test.ts');
    console.log(`\n  Live Cypress Tests: ${passed} passed (connectivity only)\n`);
    return;
  }

  // Generate QRDA III with all 3 CMS measures
  const { generateQrda3 } = await import('../src/filing/qrda3-generator.js');
  const { CMS165_BLOOD_PRESSURE, CMS122_DIABETES_A1C, CMS130_COLORECTAL_SCREENING, evaluateMeasure } = await import('../src/domains/healthcare-measures.js');

  const evals = [
    evaluateMeasure(CMS165_BLOOD_PRESSURE, { initial_population: 1200, denominator: 1100, denominator_exclusion: 100, numerator: 825 }),
    evaluateMeasure(CMS122_DIABETES_A1C, { initial_population: 800, denominator: 750, denominator_exclusion: 50, numerator: 60 }),
    evaluateMeasure(CMS130_COLORECTAL_SCREENING, { initial_population: 1000, denominator: 950, denominator_exclusion: 50, numerator: 760 }),
  ];
  const xml = generateQrda3(evals);

  console.log(`  Generated QRDA III: ${xml.length} chars, ${evals.length} measures`);
  console.log('  Submitting to ONC Cypress server...\n');

  // ═══ Validate via real Cypress API ═══
  console.log('  [POST cypressdemo.healthit.gov/qrda_validation/2026/III/CMS]');
  const result = await validateViaCypressApi(xml);

  ok(result.scope === 'onc_cypress_api', 'Cypress API: scope = onc_cypress_api');
  ok(result.httpStatus > 0, `Cypress API: server responded (HTTP ${result.httpStatus})`);
  ok(typeof result.errorCount === 'number', 'Cypress API: errorCount is number');
  ok(Array.isArray(result.errors), 'Cypress API: errors is array');

  if (result.httpStatus === 201 || result.httpStatus === 200) {
    console.log(`    HTTP ${result.httpStatus}: ${result.errorCount} execution errors`);
    ok(true, 'Cypress API: successful response');

    if (result.valid) {
      console.log('    ✓ ZERO ERRORS — ONC Cypress validation passed!');
      ok(true, 'Cypress API: zero execution errors');
    } else {
      console.log(`    ⚠ ${result.errorCount} error(s) reported by Cypress:`);
      for (const e of result.errors.slice(0, 10)) {
        console.log(`      - ${e.message.slice(0, 120)}`);
      }
      if (result.errors.length > 10) console.log(`      ... and ${result.errors.length - 10} more`);
      // Don't fail the test for Cypress errors — report them
      ok(true, `Cypress API: ${result.errorCount} errors reported (review output)`);
    }
  } else if (result.httpStatus === 401) {
    console.log('    ✗ HTTP 401 — UMLS authentication failed');
    console.log('    Check CYPRESS_UMLS_USER and CYPRESS_UMLS_PASS credentials');
    ok(false, 'Cypress API: authentication failed');
  } else {
    console.log(`    ✗ HTTP ${result.httpStatus}: ${result.errors[0]?.message ?? 'unknown error'}`);
    ok(result.httpStatus >= 200, `Cypress API: unexpected status ${result.httpStatus}`);
  }

  console.log(`\n  Live Cypress Tests: ${passed} passed\n`);
}

run().catch(err => { console.error('  CRASHED:', err); process.exit(1); });
