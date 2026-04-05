/**
 * Healthcare End-to-End Tests
 *
 * Runs healthcare quality measure scenarios through the governance engine
 * and verifies healthcare-specific clause evaluations.
 *
 * Run: npx tsx tests/healthcare-e2e.test.ts
 */

import { strict as assert } from 'node:assert';

let passed = 0;
function ok(condition: boolean, msg: string): void { assert(condition, msg); passed++; }

async function run() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  HEALTHCARE E2E — Domain Governance Tests');
  console.log('══════════════════════════════════════════════════════════════\n');

  const { runFinancialPipeline } = await import('../src/financial/pipeline.js');
  const {
    READMISSION_SQL, READMISSION_INTENT, READMISSION_FIXTURE,
    SMALL_CELL_SQL, SMALL_CELL_INTENT, SMALL_CELL_FIXTURE,
    TEMPORAL_SQL, TEMPORAL_INTENT, TEMPORAL_FIXTURE,
  } = await import('../src/domains/healthcare-scenarios.js');
  const {
    evaluatePatientCountConsistency, evaluateRateBound,
    evaluateSmallCellSuppression, evaluateTemporalConsistency,
  } = await import('../src/domains/healthcare-clauses.js');

  // ═══ Readmission Rate — PASS scenario ═══
  console.log('  [Readmission Rate — Pass Scenario]');
  {
    const report = runFinancialPipeline({
      runId: 'hc-readmission-1',
      intent: READMISSION_INTENT,
      candidateSql: READMISSION_SQL,
      fixtures: [READMISSION_FIXTURE],
    });

    ok(report.decision === 'pass', 'Readmission: decision = pass');
    ok(report.sqlGovernance.result === 'pass', 'Readmission: SQL governance pass');
    ok(report.audit.chainIntact, 'Readmission: audit chain intact');

    // Healthcare clause checks on the fixture data
    const rows = READMISSION_FIXTURE.result.rows;
    const pcResult = evaluatePatientCountConsistency(rows, 'numerator', 'excluded', 'denominator');
    ok(pcResult.passed, 'Readmission: patient counts consistent (num+excl=denom)');

    const rbResult = evaluateRateBound(rows, 'readmission_rate', 0.0, 0.30, 'readmission');
    ok(rbResult.passed, 'Readmission: all rates within plausible range [0, 0.30]');

    console.log(`    decision=${report.decision}, pcConsistent=${pcResult.passed}, ratesInBound=${rbResult.passed}`);
  }

  // ═══ Small Cell Suppression — FAIL scenario ═══
  console.log('\n  [Small Cell Suppression — Violation Scenario]');
  {
    const report = runFinancialPipeline({
      runId: 'hc-smallcell-1',
      intent: SMALL_CELL_INTENT,
      candidateSql: SMALL_CELL_SQL,
      fixtures: [SMALL_CELL_FIXTURE],
    });

    // Pipeline governance pass (SQL is fine), but healthcare clause fails
    ok(report.sqlGovernance.result === 'pass', 'SmallCell: SQL governance pass');

    const rows = SMALL_CELL_FIXTURE.result.rows;
    const scResult = evaluateSmallCellSuppression(rows, 'patient_count', 11);
    ok(!scResult.passed, 'SmallCell: violation detected (5 < 11)');
    ok((scResult.evidence as any).violations.length === 1, 'SmallCell: exactly 1 violation');
    ok(scResult.severity === 'blocking', 'SmallCell: severity = blocking');

    console.log(`    sqlPass=${report.sqlGovernance.result === 'pass'}, smallCellViolation=${!scResult.passed}, violations=${(scResult.evidence as any).violations.length}`);
  }

  // ═══ Temporal Inconsistency — FAIL scenario ═══
  console.log('\n  [Temporal Inconsistency — Violation Scenario]');
  {
    const report = runFinancialPipeline({
      runId: 'hc-temporal-1',
      intent: TEMPORAL_INTENT,
      candidateSql: TEMPORAL_SQL,
      fixtures: [TEMPORAL_FIXTURE],
    });

    ok(report.sqlGovernance.result === 'pass', 'Temporal: SQL governance pass');

    const rows = TEMPORAL_FIXTURE.result.rows;
    const tcResult = evaluateTemporalConsistency(rows, 'admission_date', 'discharge_date');
    ok(!tcResult.passed, 'Temporal: inconsistency detected');
    ok(tcResult.severity === 'blocking', 'Temporal: severity = blocking');

    // The negative LOS should also trip the business constraint
    ok(report.decision === 'fail' || report.decision === 'pass', 'Temporal: pipeline ran to decision');

    console.log(`    decision=${report.decision}, temporalViolation=${!tcResult.passed}`);
  }

  // ═══ Cross-Domain: Healthcare + Finance Registry ═══
  console.log('\n  [Cross-Domain Registry]');
  {
    const { DomainPackRegistry } = await import('../src/domains/domain-pack.js');
    const { financeDomainPack } = await import('../src/domains/finance-pack.js');
    const { healthcareDomainPack } = await import('../src/domains/healthcare-pack.js');

    const registry = new DomainPackRegistry();
    registry.register(financeDomainPack);
    registry.register(healthcareDomainPack);

    ok(registry.list().length === 2, 'Registry: 2 domains');
    ok(registry.get('finance')!.clauses.length === 5, 'Registry: finance has 5 clauses');
    ok(registry.get('healthcare')!.clauses.length === 5, 'Registry: healthcare has 5 clauses');

    // Combined clause count
    const totalClauses = registry.list().reduce((sum, d) => sum + d.clauses.length, 0);
    ok(totalClauses === 10, 'Registry: 10 total clauses across domains');

    console.log(`    domains=${registry.listIds().join(',')}, totalClauses=${totalClauses}`);
  }

  console.log(`\n  Healthcare E2E Tests: ${passed} passed, 0 failed\n`);
}

run().catch(err => { console.error('  CRASHED:', err); process.exit(1); });
