/**
 * Connector Interface + XBRL Filing Adapter Tests
 *
 * Run: npx tsx tests/connectors-and-filing.test.ts
 */

import { strict as assert } from 'node:assert';
import JSZip from 'jszip';

let passed = 0;
function ok(condition: boolean, msg: string): void { assert(condition, msg); passed++; }

async function run() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  CONNECTOR + FILING ADAPTER TESTS');
  console.log('══════════════════════════════════════════════════════════════\n');

  // ═══ CONNECTOR REGISTRY ═══
  console.log('  [Connector Registry]');
  {
    const { ConnectorRegistry } = await import('../src/connectors/connector-interface.js');
    const registry = new ConnectorRegistry();

    ok(registry.list().length === 0, 'Registry: starts empty');
    ok(!registry.has('snowflake'), 'Registry: no snowflake yet');

    // Register a mock connector for testing
    const mockConnector = {
      id: 'test-db',
      displayName: 'Test DB',
      isAvailable: async () => true,
      loadConfig: () => ({ provider: 'test', connectionUrl: 'test://', timeoutMs: 5000, maxRows: 100 }),
      execute: async () => ({ success: true, provider: 'test', durationMs: 1, rowCount: 0, columns: [], columnTypes: [], rows: [], error: null, executionContextHash: 'abc', executionTimestamp: new Date().toISOString() }),
      probe: async () => ({ provider: 'test', success: true, steps: [], serverVersion: '1.0', message: 'ok' }),
    };
    registry.register(mockConnector as any);
    ok(registry.has('test-db'), 'Registry: test-db registered');
    ok(registry.list().length === 1, 'Registry: 1 connector');

    const found = await registry.findAvailable();
    ok(found !== null, 'Registry: findAvailable returns connector');
    ok(found!.id === 'test-db', 'Registry: found test-db');

    console.log(`    connectors: ${registry.listIds().join(', ')}`);
  }

  // ═══ SNOWFLAKE CONNECTOR STRUCTURE ═══
  console.log('\n  [Snowflake Connector]');
  {
    const { snowflakeConnector } = await import('../src/connectors/snowflake-connector.js');

    ok(snowflakeConnector.id === 'snowflake', 'Snowflake: id correct');
    ok(snowflakeConnector.displayName === 'Snowflake Data Cloud', 'Snowflake: displayName');
    ok(typeof snowflakeConnector.execute === 'function', 'Snowflake: execute is function');
    ok(typeof snowflakeConnector.probe === 'function', 'Snowflake: probe is function');
    ok(typeof snowflakeConnector.preflight === 'function', 'Snowflake: preflight is function');
    ok(typeof snowflakeConnector.isAvailable === 'function', 'Snowflake: isAvailable is function');
    ok(typeof snowflakeConnector.loadConfig === 'function', 'Snowflake: loadConfig is function');

    // Without env vars, config should be null
    const config = snowflakeConnector.loadConfig();
    const hasEnv = !!process.env.SNOWFLAKE_ACCOUNT;
    if (!hasEnv) {
      ok(config === null, 'Snowflake: no config without env vars');
    } else {
      ok(config !== null, 'Snowflake: config loaded from env');
    }

    console.log(`    id=${snowflakeConnector.id}, env=${hasEnv ? 'configured' : 'not set'}`);
  }

  // ═══ XBRL ADAPTER ═══
  console.log('\n  [XBRL Filing Adapter]');
  {
    const { xbrlUsGaapAdapter, buildCounterpartyEnvelope } = await import('../src/filing/xbrl-adapter.js');

    ok(xbrlUsGaapAdapter.id === 'xbrl-us-gaap-2024', 'XBRL: adapter id');
    ok(xbrlUsGaapAdapter.format === 'xbrl', 'XBRL: format');
    ok(xbrlUsGaapAdapter.taxonomyVersion === 'US-GAAP 2024', 'XBRL: taxonomy version');

    // Build a test envelope
    const rows = [
      { counterparty_name: 'Bank of Nova Scotia', exposure_usd: 250000000, credit_rating: 'AA-', sector: 'Banking' },
      { counterparty_name: 'Deutsche Bank AG', exposure_usd: 200000000, credit_rating: 'A-', sector: 'Banking' },
    ];
    const envelope = buildCounterpartyEnvelope('test-run', 'pass', 'cert_123', 'abc123def456', rows, 'live_runtime');

    ok(envelope.runId === 'test-run', 'XBRL: envelope runId');
    ok(envelope.decision === 'pass', 'XBRL: envelope decision');
    ok(envelope.domain === 'finance', 'XBRL: envelope domain');
    ok(Object.keys(envelope.fields).length > 5, 'XBRL: envelope has fields');
    ok(envelope.fields.total_exposure.value === 450000000, 'XBRL: total exposure = 450M');
    ok(envelope.fields.total_exposure.unit === 'USD', 'XBRL: unit = USD');

    // Map to taxonomy
    const mapping = xbrlUsGaapAdapter.mapToTaxonomy(envelope);
    ok(mapping.mapped.length > 0, 'XBRL: has mapped fields');
    ok(mapping.coveragePercent > 50, 'XBRL: coverage > 50%');
    ok(mapping.mapped.some(m => m.taxonomyConcept.includes('us-gaap')), 'XBRL: has US-GAAP concepts');
    ok(mapping.mapped.some(m => m.taxonomyConcept === 'us-gaap:CreditRiskExposure'), 'XBRL: exposure mapped to CreditRiskExposure');
    ok(mapping.mapped.some(m => m.taxonomyConcept === 'us-gaap:CounterpartyNameAxis'), 'XBRL: counterparty mapped');

    console.log(`    mapped: ${mapping.mapped.length}, unmapped: ${mapping.unmapped.length}, coverage: ${mapping.coveragePercent}%`);

    // Generate package
    const pkg = xbrlUsGaapAdapter.generatePackage(mapping);
    ok(pkg.format === 'xbrl', 'XBRL: package format');
    ok(pkg.validation.coveragePercent === mapping.coveragePercent, 'XBRL: package coverage matches');
    ok(pkg.content.taxonomyVersion === 'US-GAAP 2024', 'XBRL: package taxonomy');
    ok(Array.isArray((pkg.content as any).facts), 'XBRL: package has facts array');
    ok((pkg.content as any).facts.length === mapping.mapped.length, 'XBRL: facts count = mapped count');
    ok((pkg.content as any).schemaRef.includes('us-gaap'), 'XBRL: schema ref present');

    const { issueFilingPackage } = await import('../src/filing/report-package.js');
    pkg.evidenceLink = { runId: envelope.runId, certificateId: envelope.certificateId, evidenceChainTerminal: envelope.evidenceChainTerminal };
    pkg.issuedPackage = await issueFilingPackage(pkg);
    ok(pkg.issuedPackage !== null, 'XBRL: issued package present');
    ok(pkg.issuedPackage!.fileExtension === '.xbr', 'XBRL: issued package uses .xbr');
    ok(pkg.issuedPackage!.files.some((f) => f.path === 'META-INF/reportPackage.json'), 'XBRL: reportPackage.json included');
    ok(pkg.issuedPackage!.files.some((f) => f.path.startsWith('reports/') && f.path.endsWith('.xbrl')), 'XBRL: XBRL report included');

    const issuedZip = await JSZip.loadAsync(Buffer.from(pkg.issuedPackage!.archive.base64, 'base64'));
    ok(issuedZip.file(`${pkg.issuedPackage!.topLevelDirectory}/META-INF/reportPackage.json`) !== null, 'XBRL: zip has metadata file');
    ok(issuedZip.file(`${pkg.issuedPackage!.topLevelDirectory}/${pkg.issuedPackage!.reportPath}`) !== null, 'XBRL: zip has report file');

    console.log(`    package: ${(pkg.content as any).facts.length} facts, valid=${pkg.validation.valid}, warnings=${pkg.validation.warnings.length}`);
  }

  // ═══ xBRL-CSV PACKAGING ═══
  console.log('\n  [xBRL-CSV Filing Package]');
  {
    const { xbrlCsvEbaAdapter } = await import('../src/filing/xbrl-csv-adapter.js');
    const { buildCounterpartyEnvelope } = await import('../src/filing/xbrl-adapter.js');
    const { issueFilingPackage } = await import('../src/filing/report-package.js');

    const rows = [
      { counterparty_name: 'Bank of Nova Scotia', exposure_usd: 250000000, credit_rating: 'AA-', sector: 'Banking' },
    ];
    const envelope = buildCounterpartyEnvelope('csv-run', 'pass', 'cert_csv', 'csvhash', rows, 'live_runtime');
    const mapping = xbrlCsvEbaAdapter.mapToTaxonomy(envelope);
    const pkg = xbrlCsvEbaAdapter.generatePackage(mapping);
    pkg.evidenceLink = { runId: envelope.runId, certificateId: envelope.certificateId, evidenceChainTerminal: envelope.evidenceChainTerminal };
    pkg.issuedPackage = await issueFilingPackage(pkg);

    ok(pkg.issuedPackage!.reportPath.endsWith('.json'), 'xBRL-CSV: report path is JSON-rooted');
    ok(pkg.issuedPackage!.files.some((f) => f.path.startsWith('reports/') && f.path.endsWith('.csv')), 'xBRL-CSV: CSV file included');

    const issuedZip = await JSZip.loadAsync(Buffer.from(pkg.issuedPackage!.archive.base64, 'base64'));
    const metadataEntry = issuedZip.file(`${pkg.issuedPackage!.topLevelDirectory}/${pkg.issuedPackage!.reportPath}`);
    ok(metadataEntry !== null, 'xBRL-CSV: metadata file exists');
    const metadataJson = JSON.parse(await metadataEntry!.async('string'));
    ok(metadataJson.documentInfo.documentType === 'https://xbrl.org/2021/xbrl-csv', 'xBRL-CSV: official documentType');

    console.log(`    package: files=${pkg.issuedPackage!.files.length}, csv=${pkg.issuedPackage!.files.filter((f) => f.path.endsWith('.csv')).length}`);
  }

  // ═══ FILING ADAPTER REGISTRY ═══
  console.log('\n  [Filing Registry]');
  {
    const { FilingAdapterRegistry } = await import('../src/filing/filing-adapter.js');
    const { xbrlUsGaapAdapter } = await import('../src/filing/xbrl-adapter.js');

    const registry = new FilingAdapterRegistry();
    registry.register(xbrlUsGaapAdapter);

    ok(registry.list().length === 1, 'FilingRegistry: 1 adapter');
    ok(registry.get('xbrl-us-gaap-2024') !== undefined, 'FilingRegistry: XBRL adapter found');
    ok(registry.listByFormat('xbrl').length === 1, 'FilingRegistry: 1 XBRL adapter');
    ok(registry.listByFormat('iso20022').length === 0, 'FilingRegistry: 0 ISO 20022 adapters');

    console.log(`    adapters: ${registry.list().map(a => a.id).join(', ')}`);
  }

  console.log(`\n  Connector + Filing Tests: ${passed} passed, 0 failed\n`);
}

run().catch(err => {
  console.error('  TEST CRASHED:', err);
  process.exit(1);
});
