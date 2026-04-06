/**
 * QRDA Category III XML Generator
 *
 * Generates CMS-compatible QRDA III aggregate quality measure reports.
 * QRDA III is the mandated format for eCQM reporting to CMS programs
 * (MIPS, MSSP ACO, CPC+).
 *
 * ARCHITECTURE:
 * - Accepts MeasureEvaluation objects from healthcare-measures.ts
 * - Generates HL7 CDA R2 XML with CMS-required template IDs
 * - Output is structurally valid against CMS QRDA III IG
 *
 * BOUNDARY:
 * - Structural generation, not full CMS certification
 * - Does not run CMS Schematron validation (requires Java/Saxon)
 * - Template IDs based on CMS 2025 IG (annual updates required)
 * - For full certification, validate with Project Cypress
 */

import { create } from 'xmlbuilder2';
import type { MeasureEvaluation, PopulationCount } from '../domains/healthcare-measures.js';

// ─── CMS Template OIDs ──────────────────────────────────────────────────────

const TEMPLATE_IDS = {
  qrda3Report: '2.16.840.1.113883.10.20.27.1.1',
  qrda3ReportCms: '2.16.840.1.113883.10.20.27.1.2',
  measureSection: '2.16.840.1.113883.10.20.27.2.1',
  measureReference: '2.16.840.1.113883.10.20.24.3.98',
  aggregateCount: '2.16.840.1.113883.10.20.27.3.3',
  performanceRate: '2.16.840.1.113883.10.20.27.3.14',
};

const POPULATION_CODES: Record<string, { code: string; displayName: string }> = {
  initial_population: { code: 'IPP', displayName: 'Initial Population' },
  denominator: { code: 'DENOM', displayName: 'Denominator' },
  denominator_exclusion: { code: 'DENEX', displayName: 'Denominator Exclusion' },
  denominator_exception: { code: 'DENEXCEP', displayName: 'Denominator Exception' },
  numerator: { code: 'NUMER', displayName: 'Numerator' },
  numerator_exclusion: { code: 'NUMEX', displayName: 'Numerator Exclusion' },
};

// ─── Generator ──────────────────────────────────────────────────────────────

export interface Qrda3Options {
  performerName?: string;
  performerNpi?: string;
  programName?: string;
  reportingYear?: string;
}

/**
 * Generate a QRDA Category III XML document from measure evaluations.
 */
export function generateQrda3(
  measures: MeasureEvaluation[],
  options: Qrda3Options = {},
): string {
  const now = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const reportingYear = options.reportingYear ?? '2026';

  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('ClinicalDocument', {
      'xmlns': 'urn:hl7-org:v3',
      'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      'xmlns:sdtc': 'urn:hl7-org:sdtc',
    });

  // Document header
  doc.ele('realmCode').att('code', 'US').up();
  doc.ele('typeId').att('root', '2.16.840.1.113883.1.3').att('extension', 'POCD_HD000040').up();
  doc.ele('templateId').att('root', TEMPLATE_IDS.qrda3Report).up();
  doc.ele('templateId').att('root', TEMPLATE_IDS.qrda3ReportCms).att('extension', '2024-05-01').up();
  doc.ele('id').att('root', crypto.randomUUID()).up();
  doc.ele('code').att('code', '55184-6').att('codeSystem', '2.16.840.1.113883.6.1').att('displayName', 'Quality Reporting Document Architecture Calculated Summary Report').up();
  doc.ele('title').txt(`Attestor QRDA III Report — ${reportingYear}`).up();
  doc.ele('effectiveTime').att('value', now).up();
  doc.ele('confidentialityCode').att('code', 'N').att('codeSystem', '2.16.840.1.113883.5.25').up();
  doc.ele('languageCode').att('code', 'en').up();

  // Reporting period
  const component = doc.ele('component').ele('structuredBody');

  // Reporting parameters section
  const reportingSection = component.ele('component').ele('section');
  reportingSection.ele('templateId').att('root', '2.16.840.1.113883.10.20.17.2.1').up();
  reportingSection.ele('code').att('code', '55187-9').att('codeSystem', '2.16.840.1.113883.6.1').up();
  reportingSection.ele('title').txt('Reporting Parameters').up();
  const rpEntry = reportingSection.ele('entry').ele('act').att('classCode', 'ACT').att('moodCode', 'EVN');
  rpEntry.ele('templateId').att('root', '2.16.840.1.113883.10.20.17.3.8').up();
  const rpTime = rpEntry.ele('effectiveTime');
  rpTime.ele('low').att('value', `${reportingYear}0101`).up();
  rpTime.ele('high').att('value', `${reportingYear}1231`).up();

  // Measure section
  for (const measure of measures) {
    const measureSection = component.ele('component').ele('section');
    measureSection.ele('templateId').att('root', TEMPLATE_IDS.measureSection).up();
    measureSection.ele('code').att('code', '55186-1').att('codeSystem', '2.16.840.1.113883.6.1').up();
    measureSection.ele('title').txt(measure.title).up();

    const entry = measureSection.ele('entry');
    const organizer = entry.ele('organizer').att('classCode', 'CLUSTER').att('moodCode', 'EVN');
    organizer.ele('templateId').att('root', '2.16.840.1.113883.10.20.27.3.1').up();
    organizer.ele('statusCode').att('code', 'completed').up();

    // Measure reference
    const ref = organizer.ele('reference').att('typeCode', 'REFR');
    const extDoc = ref.ele('externalDocument').att('classCode', 'DOC').att('moodCode', 'EVN');
    extDoc.ele('id').att('root', '2.16.840.1.113883.4.738').att('extension', measure.measureId).up();

    // Population counts
    for (const pop of measure.populations) {
      const popCode = POPULATION_CODES[pop.type];
      if (!popCode) continue;

      const comp = organizer.ele('component');
      const obs = comp.ele('observation').att('classCode', 'OBS').att('moodCode', 'EVN');
      obs.ele('templateId').att('root', TEMPLATE_IDS.aggregateCount).up();
      obs.ele('code').att('code', popCode.code).att('codeSystem', '2.16.840.1.113883.5.4').att('displayName', popCode.displayName).up();
      obs.ele('statusCode').att('code', 'completed').up();
      obs.ele('value').att('xsi:type', 'INT').att('value', String(pop.count)).up();
    }

    // Performance rate
    if (measure.rate !== null) {
      const prComp = organizer.ele('component');
      const prObs = prComp.ele('observation').att('classCode', 'OBS').att('moodCode', 'EVN');
      prObs.ele('templateId').att('root', TEMPLATE_IDS.performanceRate).up();
      prObs.ele('code').att('code', 'ASSERTION').att('codeSystem', '2.16.840.1.113883.5.4').up();
      prObs.ele('statusCode').att('code', 'completed').up();
      prObs.ele('value').att('xsi:type', 'REAL').att('value', measure.rate.toFixed(6)).up();
    }
  }

  return doc.end({ prettyPrint: true });
}

// ─── Structural Self-Validation ─────────────────────────────────────────────
// Checks required CDA elements exist in generated XML.
// This is NOT CMS Schematron validation — it is a structural conformance check
// that verifies our generator output meets minimum CDA/QRDA III requirements.

export interface Qrda3ValidationResult {
  valid: boolean;
  checks: { name: string; passed: boolean; detail: string }[];
  errors: string[];
  /** Structural self-check only, not CMS Schematron or Cypress */
  scope: 'structural_self_check';
}

/**
 * Validate QRDA III XML structural conformance.
 * Checks required CDA elements, template IDs, population codes, and rates.
 */
export function validateQrda3Structure(xml: string, expectedMeasureCount: number): Qrda3ValidationResult {
  const checks: Qrda3ValidationResult['checks'] = [];
  const errors: string[] = [];

  function check(name: string, passed: boolean, detail: string) {
    checks.push({ name, passed, detail });
    if (!passed) errors.push(`${name}: ${detail}`);
  }

  // 1. Root CDA element
  check('root_element', xml.includes('<ClinicalDocument'), 'ClinicalDocument root element');

  // 2. Required CMS template IDs
  check('template_qrda3', xml.includes(TEMPLATE_IDS.qrda3Report), `QRDA III Report template (${TEMPLATE_IDS.qrda3Report})`);
  check('template_qrda3_cms', xml.includes(TEMPLATE_IDS.qrda3ReportCms), `QRDA III CMS template (${TEMPLATE_IDS.qrda3ReportCms})`);
  check('template_measure_section', xml.includes(TEMPLATE_IDS.measureSection), `Measure section template (${TEMPLATE_IDS.measureSection})`);

  // 3. Required header elements
  check('realm_code', xml.includes('realmCode') && xml.includes('"US"'), 'US realm code');
  check('type_id', xml.includes('typeId'), 'CDA type ID');
  check('confidentiality', xml.includes('confidentialityCode'), 'Confidentiality code');
  check('language', xml.includes('languageCode') && xml.includes('"en"'), 'Language code (en)');

  // 4. Reporting parameters section
  check('reporting_params', xml.includes('2.16.840.1.113883.10.20.17.2.1'), 'Reporting parameters section template');
  check('reporting_period', xml.includes('<low') && xml.includes('<high'), 'Reporting period with low/high bounds');

  // 5. Measure count — count measure section template occurrences
  const measureSectionMatches = xml.match(new RegExp(TEMPLATE_IDS.measureSection.replace(/\./g, '\\.'), 'g'));
  const actualMeasureCount = measureSectionMatches ? measureSectionMatches.length : 0;
  check('measure_count', actualMeasureCount === expectedMeasureCount, `Expected ${expectedMeasureCount} measure sections, found ${actualMeasureCount}`);

  // 6. Population aggregate counts present
  check('aggregate_counts', xml.includes(TEMPLATE_IDS.aggregateCount), `Aggregate count observations (${TEMPLATE_IDS.aggregateCount})`);

  // 7. Performance rates present
  check('performance_rates', xml.includes(TEMPLATE_IDS.performanceRate), `Performance rate observations (${TEMPLATE_IDS.performanceRate})`);

  // 8. Population codes — at least IPP and DENOM
  check('pop_ipp', xml.includes('"IPP"'), 'Initial Population (IPP) code');
  check('pop_denom', xml.includes('"DENOM"'), 'Denominator (DENOM) code');

  // 9. Well-formed XML (basic check — ends properly)
  check('xml_closed', xml.trimEnd().endsWith('</ClinicalDocument>'), 'XML document properly closed');

  return {
    valid: errors.length === 0,
    checks,
    errors,
    scope: 'structural_self_check',
  };
}
