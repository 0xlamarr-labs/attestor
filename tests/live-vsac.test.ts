/**
 * LIVE VSAC FHIR Validation Test
 *
 * Proves that the official NLM VSAC FHIR service is reachable and, when a UMLS API key
 * is configured, expands the curated Layer 7 value sets used by the current healthcare demo.
 *
 * ENV-GATED:
 * - VSAC_UMLS_API_KEY (preferred)
 * - UMLS_API_KEY (fallback)
 *
 * Run: VSAC_UMLS_API_KEY=... npx tsx tests/live-vsac.test.ts
 */

import { strict as assert } from 'node:assert';

let passed = 0;
function ok(condition: boolean, msg: string): void { assert(condition, msg); passed++; }

async function run() {
  console.log('\n================================================================');
  console.log('  LIVE VSAC FHIR API - Layer 7 Value Set Validation');
  console.log('================================================================\n');

  const {
    fetchVsacCapabilityStatement,
    isVsacConfigured,
    validateVsacLayer7ForMeasures,
  } = await import('../src/filing/vsac-api-client.js');
  const {
    CMS165_BLOOD_PRESSURE,
    CMS122_DIABETES_A1C,
    CMS130_COLORECTAL_SCREENING,
  } = await import('../src/domains/healthcare-measures.js');

  console.log('  [VSAC Capability Statement]');
  const capability = await fetchVsacCapabilityStatement();
  ok(capability.httpStatus === 200, `VSAC capability statement reachable (HTTP ${capability.httpStatus})`);
  ok(capability.resourceType === 'CapabilityStatement', 'VSAC capability: resourceType = CapabilityStatement');
  ok((capability.fhirVersion ?? '').startsWith('4.'), `VSAC capability: FHIR R4 surfaced (${capability.fhirVersion ?? 'unknown'})`);
  console.log(`    HTTP ${capability.httpStatus}, fhirVersion=${capability.fhirVersion ?? 'unknown'}, reachable=${capability.reachable}`);

  if (!isVsacConfigured()) {
    console.log('\n  o FULL VALUE-SET EXPANSION SKIPPED: VSAC_UMLS_API_KEY / UMLS_API_KEY not set');
    console.log('    Get your UMLS API key from: https://uts.nlm.nih.gov/uts/profile');
    console.log('    Then run: VSAC_UMLS_API_KEY=your_key npx tsx tests/live-vsac.test.ts');
    console.log(`\n  Live VSAC Tests: ${passed} passed (connectivity only)\n`);
    return;
  }

  console.log('\n  [VSAC Layer 7 Expansion]');
  const result = await validateVsacLayer7ForMeasures([
    CMS165_BLOOD_PRESSURE,
    CMS122_DIABETES_A1C,
    CMS130_COLORECTAL_SCREENING,
  ]);

  ok(result.scope === 'vsac_layer7_live', 'VSAC-L7: scope = vsac_layer7_live');
  ok(result.totalTargets === 11, 'VSAC-L7: 11 curated targets requested');
  ok(result.targets.every(target => target.httpStatus > 0), 'VSAC-L7: every target returned an HTTP status');

  if (!result.valid) {
    console.log(`    ! ${result.expandedTargets}/${result.totalTargets} targets expanded cleanly`);
    for (const target of result.targets.filter(entry => !entry.valid).slice(0, 10)) {
      console.log(`      - ${target.name} [${target.oid}] HTTP ${target.httpStatus}: ${target.error ?? 'unknown error'}`);
    }
    ok(false, 'VSAC-L7: one or more curated value sets failed live expansion');
  }

  ok(result.totalCodes > 0, `VSAC-L7: total expanded codes > 0 (${result.totalCodes})`);
  console.log(`    ok ${result.expandedTargets}/${result.totalTargets} targets, codes=${result.totalCodes}, manifest=${result.manifestUrl ?? 'none'}`);

  console.log(`\n  Live VSAC Tests: ${passed} passed\n`);
}

run().catch(err => { console.error('  CRASHED:', err); process.exit(1); });
