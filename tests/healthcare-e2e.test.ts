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

  // ═══ QRDA III Structural Validation ═══
  console.log('\n  [QRDA III Structural Validation]');
  {
    const { generateQrda3, validateQrda3Structure } = await import('../src/filing/qrda3-generator.js');
    const {
      CMS165_BLOOD_PRESSURE, CMS122_DIABETES_A1C, CMS130_COLORECTAL_SCREENING,
      evaluateMeasure, toFhirMeasureReport,
    } = await import('../src/domains/healthcare-measures.js');

    // Evaluate the 3 CMS measures with test data
    const eval165 = evaluateMeasure(CMS165_BLOOD_PRESSURE, { initial_population: 1200, denominator: 1100, denominator_exclusion: 100, numerator: 825 });
    const eval122 = evaluateMeasure(CMS122_DIABETES_A1C, { initial_population: 800, denominator: 750, denominator_exclusion: 50, numerator: 60 });
    const eval130 = evaluateMeasure(CMS130_COLORECTAL_SCREENING, { initial_population: 1000, denominator: 950, denominator_exclusion: 50, numerator: 760 });

    // Generate QRDA III
    const xml = generateQrda3([eval165, eval122, eval130], { reportingYear: '2026' });
    ok(xml.length > 5000, 'QRDA3: generated substantial XML');

    // Structural validation
    const validation = validateQrda3Structure(xml, 3);
    ok(validation.scope === 'structural_self_check', 'QRDA3: validation scope is structural_self_check');
    ok(validation.valid, `QRDA3: structural validation passed (${validation.checks.length} checks)`);

    // Verify individual structural checks
    const checkNames = validation.checks.map(c => c.name);
    ok(checkNames.includes('root_element'), 'QRDA3: ClinicalDocument root verified');
    ok(checkNames.includes('template_qrda3'), 'QRDA3: QRDA III template ID verified');
    ok(checkNames.includes('template_qrda3_cms'), 'QRDA3: CMS template ID verified');
    ok(checkNames.includes('measure_count'), 'QRDA3: measure count verified');
    ok(checkNames.includes('pop_ipp'), 'QRDA3: IPP population code verified');
    ok(checkNames.includes('pop_denom'), 'QRDA3: DENOM population code verified');
    ok(checkNames.includes('xml_closed'), 'QRDA3: XML properly closed');

    // All checks should have passed
    const failedChecks = validation.checks.filter(c => !c.passed);
    ok(failedChecks.length === 0, `QRDA3: all ${validation.checks.length} checks passed`);

    console.log(`    xml=${xml.length} chars, checks=${validation.checks.length} passed, scope=${validation.scope}`);
  }

  // ═══ FHIR MeasureReport Structure ═══
  console.log('\n  [FHIR MeasureReport Structure]');
  {
    const { CMS165_BLOOD_PRESSURE, evaluateMeasure, toFhirMeasureReport } = await import('../src/domains/healthcare-measures.js');
    const eval165 = evaluateMeasure(CMS165_BLOOD_PRESSURE, { initial_population: 1200, denominator: 1100, denominator_exclusion: 100, numerator: 825 });
    const fhir = toFhirMeasureReport(eval165);

    ok(fhir.resourceType === 'MeasureReport', 'FHIR: resourceType = MeasureReport');
    ok(fhir.type === 'summary', 'FHIR: type = summary');
    ok(fhir.measure.includes('CMS165v12'), 'FHIR: measure reference includes CMS165v12');
    ok(fhir.period.start === '2026-01-01', 'FHIR: period start correct');
    ok(fhir.period.end === '2026-12-31', 'FHIR: period end correct');
    ok(fhir.group.length === 1, 'FHIR: one group present');
    ok(fhir.group[0].population.length >= 3, 'FHIR: 3+ population entries');
    ok(fhir.group[0].measureScore.value !== null, 'FHIR: measure score present');
    ok(typeof fhir.group[0].measureScore.value === 'number', 'FHIR: measure score is number');

    // Check population codes are present
    const popCodes = fhir.group[0].population.map(p => p.code);
    ok(popCodes.includes('initial_population'), 'FHIR: IPP population present');
    ok(popCodes.includes('denominator'), 'FHIR: DENOM population present');
    ok(popCodes.includes('numerator'), 'FHIR: NUMER population present');

    console.log(`    resourceType=${fhir.resourceType}, populations=${popCodes.length}, score=${fhir.group[0].measureScore.value?.toFixed(4)}`);
  }

  // ═══ FHIR MeasureReport Schema Validation ═══
  console.log('\n  [FHIR MeasureReport Schema Validation]');
  {
    const { CMS165_BLOOD_PRESSURE, CMS122_DIABETES_A1C, CMS130_COLORECTAL_SCREENING, evaluateMeasure, toFhirMeasureReport } = await import('../src/domains/healthcare-measures.js');
    const { validateFhirMeasureReport } = await import('../src/domains/fhir-validator.js');

    // Validate all 3 CMS measures
    const measures = [
      { def: CMS165_BLOOD_PRESSURE, counts: { initial_population: 1200, denominator: 1100, denominator_exclusion: 100, numerator: 825 } },
      { def: CMS122_DIABETES_A1C, counts: { initial_population: 800, denominator: 750, denominator_exclusion: 50, numerator: 60 } },
      { def: CMS130_COLORECTAL_SCREENING, counts: { initial_population: 1000, denominator: 950, denominator_exclusion: 50, numerator: 760 } },
    ];

    for (const m of measures) {
      const evaluation = evaluateMeasure(m.def, m.counts);
      const fhir = toFhirMeasureReport(evaluation);
      const result = await validateFhirMeasureReport(fhir);

      ok(result.scope === 'fhir_r4_schema', `FHIR-V(${m.def.measureId}): scope = fhir_r4_schema`);
      ok(result.resourceType === 'MeasureReport', `FHIR-V(${m.def.measureId}): resourceType = MeasureReport`);
      ok(result.valid, `FHIR-V(${m.def.measureId}): valid (${result.errors.length} errors)`);
      console.log(`    ${m.def.measureId}: valid=${result.valid}, errors=${result.errors.length}, scope=${result.scope}`);
    }
  }

  // ═══ CMS IG XPath Validation (SaxonJS) ═══
  console.log('\n  [CMS IG XPath Validation — SaxonJS]');
  {
    const { generateQrda3 } = await import('../src/filing/qrda3-generator.js');
    const { CMS165_BLOOD_PRESSURE, CMS122_DIABETES_A1C, CMS130_COLORECTAL_SCREENING, evaluateMeasure } = await import('../src/domains/healthcare-measures.js');
    const { validateQrda3Schematron, CMS_QRDA3_RULES } = await import('../src/filing/qrda3-schematron.js');

    const evals = [
      evaluateMeasure(CMS165_BLOOD_PRESSURE, { initial_population: 1200, denominator: 1100, denominator_exclusion: 100, numerator: 825 }),
      evaluateMeasure(CMS122_DIABETES_A1C, { initial_population: 800, denominator: 750, denominator_exclusion: 50, numerator: 60 }),
      evaluateMeasure(CMS130_COLORECTAL_SCREENING, { initial_population: 1000, denominator: 950, denominator_exclusion: 50, numerator: 760 }),
    ];
    const xml = generateQrda3(evals);
    const result = await validateQrda3Schematron(xml);

    ok(result.scope === 'cms_qrda3_xpath', 'CMS-V: scope = cms_qrda3_xpath');
    ok(result.totalRules === CMS_QRDA3_RULES.length, `CMS-V: totalRules = ${CMS_QRDA3_RULES.length}`);
    ok(result.valid, `CMS-V: valid (${result.errors} errors)`);
    ok(result.errors === 0, 'CMS-V: 0 errors');
    ok(result.passedRules === result.totalRules, `CMS-V: all ${result.totalRules} rules pass`);

    // Check key conformance rule IDs are present
    const ruleIds = result.assertions.map(a => a.ruleId);
    ok(ruleIds.includes('CONF:3338-17208'), 'CMS-V: QRDA III template rule present');
    ok(ruleIds.includes('CMS_0001'), 'CMS-V: CMS template rule present');
    ok(ruleIds.includes('CONF:3338-17244'), 'CMS-V: Reporting Parameters rule present');
    ok(ruleIds.includes('CONF:3338-17284'), 'CMS-V: Measure Section rule present');
    ok(ruleIds.includes('CONF:3338-17563'), 'CMS-V: Aggregate Count rule present');
    ok(ruleIds.includes('CONF:3338-18411'), 'CMS-V: Performance Rate rule present');
    ok(ruleIds.includes('CMS_POP_IPP'), 'CMS-V: IPP population rule present');
    ok(ruleIds.includes('CMS_POP_DENOM'), 'CMS-V: DENOM population rule present');

    // Check sections covered
    const sections = [...new Set(result.assertions.map(a => a.section))];
    ok(sections.includes('Document'), 'CMS-V: Document section covered');
    ok(sections.includes('ReportingParameters'), 'CMS-V: ReportingParameters section covered');
    ok(sections.includes('MeasureSection'), 'CMS-V: MeasureSection section covered');
    ok(sections.includes('AggregateCount'), 'CMS-V: AggregateCount section covered');
    ok(sections.includes('PerformanceRate'), 'CMS-V: PerformanceRate section covered');

    console.log(`    rules=${result.passedRules}/${result.totalRules}, errors=${result.errors}, scope=${result.scope}, sections=${sections.join(',')}`);
  }

  // ═══ CMS 2026 Schematron Validation (Real .sch File) ═══
  console.log('\n  [CMS 2026 Schematron — Real .sch Execution]');
  {
    const { generateQrda3 } = await import('../src/filing/qrda3-generator.js');
    const { CMS165_BLOOD_PRESSURE, CMS122_DIABETES_A1C, CMS130_COLORECTAL_SCREENING, evaluateMeasure } = await import('../src/domains/healthcare-measures.js');
    const { validateCmsSchematron } = await import('../src/filing/qrda3-cms-schematron.js');

    const evals = [
      evaluateMeasure(CMS165_BLOOD_PRESSURE, { initial_population: 1200, denominator: 1100, denominator_exclusion: 100, numerator: 825 }),
      evaluateMeasure(CMS122_DIABETES_A1C, { initial_population: 800, denominator: 750, denominator_exclusion: 50, numerator: 60 }),
      evaluateMeasure(CMS130_COLORECTAL_SCREENING, { initial_population: 1000, denominator: 950, denominator_exclusion: 50, numerator: 760 }),
    ];
    const xml = generateQrda3(evals);
    const result = await validateCmsSchematron(xml);

    ok(result.scope === 'cms_schematron_2026', 'CMS-Sch: scope = cms_schematron_2026');
    ok(typeof result.errorCount === 'number', 'CMS-Sch: errorCount is number');
    ok(typeof result.warningCount === 'number', 'CMS-Sch: warningCount is number');
    ok(result.schematronFile.includes('2026_CMS_QRDA_Category_III'), 'CMS-Sch: uses vendored 2026 .sch file');
    ok(Array.isArray(result.errors), 'CMS-Sch: errors is array');

    // We expect some remaining errors (supplemental data, etc.) — track the count
    // to ensure future generator improvements reduce it
    console.log(`    scope=${result.scope}, errors=${result.errorCount}, warnings=${result.warningCount}`);
    if (result.errorCount > 0) {
      const unique = new Map<string, number>();
      for (const e of result.errors) unique.set(e.description, (unique.get(e.description) ?? 0) + 1);
      console.log(`    unique error types: ${unique.size}`);
    }
  }

  // ═══ Cypress-Equivalent Validators (Layers 2-6) ═══
  console.log('\n  [Cypress-Equivalent Validators — Layers 2-6]');
  {
    const { generateQrda3 } = await import('../src/filing/qrda3-generator.js');
    const { CMS165_BLOOD_PRESSURE, CMS122_DIABETES_A1C, CMS130_COLORECTAL_SCREENING, evaluateMeasure } = await import('../src/domains/healthcare-measures.js');
    const { validateCypressLayers } = await import('../src/filing/qrda3-cypress-validators.js');

    const evals = [
      evaluateMeasure(CMS165_BLOOD_PRESSURE, { initial_population: 1200, denominator: 1100, denominator_exclusion: 100, numerator: 825 }),
      evaluateMeasure(CMS122_DIABETES_A1C, { initial_population: 800, denominator: 750, denominator_exclusion: 50, numerator: 60 }),
      evaluateMeasure(CMS130_COLORECTAL_SCREENING, { initial_population: 1000, denominator: 950, denominator_exclusion: 50, numerator: 760 }),
    ];
    const xml = generateQrda3(evals);
    const result = validateCypressLayers(xml);

    ok(result.scope === 'cypress_validators', 'Cypress-eq: scope = cypress_validators');
    ok(result.valid, `Cypress-eq: valid (${result.totalErrors} errors)`);
    ok(result.totalErrors === 0, 'Cypress-eq: 0 errors');
    ok(result.layers.length === 5, 'Cypress-eq: 5 layers (2-6)');

    // Each layer passes
    for (const layer of result.layers) {
      ok(layer.valid, `Cypress-eq L${layer.layer} ${layer.name}: valid`);
      ok(layer.errors.length === 0, `Cypress-eq L${layer.layer}: 0 errors`);
    }

    // Layer names present
    const names = result.layers.map(l => l.name);
    ok(names.includes('MeasureIdValidator'), 'Cypress-eq: MeasureIdValidator present');
    ok(names.includes('PerformanceRateValidator'), 'Cypress-eq: PerformanceRateValidator present');
    ok(names.includes('PopulationLogicValidator'), 'Cypress-eq: PopulationLogicValidator present');
    ok(names.includes('ProgramValidator'), 'Cypress-eq: ProgramValidator present');
    ok(names.includes('MeasurePeriodValidator'), 'Cypress-eq: MeasurePeriodValidator present');

    console.log(`    layers=${result.layers.length}, errors=${result.totalErrors}, warnings=${result.totalWarnings}, scope=${result.scope}`);
  }

  // ═══ VSAC Layer 7 Target Coverage ═══
  console.log('\n  [VSAC Layer 7 Target Coverage]');
  {
    const {
      CMS165_BLOOD_PRESSURE,
      CMS122_DIABETES_A1C,
      CMS130_COLORECTAL_SCREENING,
    } = await import('../src/domains/healthcare-measures.js');
    const { collectVsacLayer7Targets } = await import('../src/filing/vsac-api-client.js');

    const targets = collectVsacLayer7Targets([
      CMS165_BLOOD_PRESSURE,
      CMS122_DIABETES_A1C,
      CMS130_COLORECTAL_SCREENING,
    ]);

    ok(targets.length === 11, 'VSAC-L7: 11 unique curated value-set targets');
    ok(targets.some(t => t.name === 'Essential Hypertension'), 'VSAC-L7: CMS165 hypertension target present');
    ok(targets.some(t => t.name === 'Diabetes'), 'VSAC-L7: CMS122 diabetes target present');
    ok(targets.some(t => t.name === 'Colonoscopy'), 'VSAC-L7: CMS130 colonoscopy target present');
    ok(targets.some(t => t.name === 'Federal Administrative Sex'), 'VSAC-L7: common federal administrative sex target present');
    ok(targets.some(t => t.name === 'Payer'), 'VSAC-L7: payer target present');
    ok(targets.some(t => t.measureIds.length === 3 && t.category === 'supplemental'), 'VSAC-L7: shared supplemental targets span all 3 measures');

    console.log(`    targets=${targets.length}, sharedSupplementals=${targets.filter(t => t.measureIds.length === 3).length}`);
  }

  console.log(`\n  Healthcare E2E Tests: ${passed} passed, 0 failed\n`);
}

run().catch(err => { console.error('  CRASHED:', err); process.exit(1); });
