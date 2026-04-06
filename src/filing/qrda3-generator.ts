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

  // Document header — CMS 2026 IG conformance (CONF:4484-*)
  doc.ele('realmCode').att('code', 'US').up();
  doc.ele('typeId').att('root', '2.16.840.1.113883.1.3').att('extension', 'POCD_HD000040').up();
  doc.ele('templateId').att('root', TEMPLATE_IDS.qrda3Report).att('extension', '2020-12-01').up();  // CONF:4484-17209 + 21319
  doc.ele('templateId').att('root', TEMPLATE_IDS.qrda3ReportCms).att('extension', '2025-05-01').up();  // CMS 2026 IG (CONF:CMS_1/2/3)
  doc.ele('id').att('root', crypto.randomUUID()).up();
  doc.ele('code').att('code', '55184-6').att('codeSystem', '2.16.840.1.113883.6.1').att('displayName', 'Quality Reporting Document Architecture Calculated Summary Report').up();
  doc.ele('title').txt(`Attestor QRDA III Report — ${reportingYear}`).up();
  doc.ele('effectiveTime').att('value', now).up();
  doc.ele('confidentialityCode').att('code', 'N').att('codeSystem', '2.16.840.1.113883.5.25').up();
  doc.ele('languageCode').att('code', 'en').up();

  // recordTarget — required by CMS (CONF:4484-17212), nullFlavor for aggregate reporting
  const rt = doc.ele('recordTarget');
  rt.ele('patientRole').ele('id').att('nullFlavor', 'NA').up().up();

  // author — required by CMS (CONF:4484-18156)
  const author = doc.ele('author');
  author.ele('time').att('value', now).up();
  const assignedAuthor = author.ele('assignedAuthor');
  assignedAuthor.ele('id').att('root', '2.16.840.1.113883.4.6').att('extension', options.performerNpi ?? '0000000000').up();
  assignedAuthor.ele('assignedPerson').ele('name').ele('family').txt(options.performerName ?? 'Attestor').up().up().up();
  assignedAuthor.ele('representedOrganization').ele('id').att('root', '2.16.840.1.113883.4.2').att('extension', '000000000').up().ele('name').txt(options.performerName ?? 'Attestor').up().up();  // CONF:4484-18163

  // custodian — required by CMS (CONF:4484-17213)
  const custodian = doc.ele('custodian');
  custodian.ele('assignedCustodian').ele('representedCustodianOrganization').ele('id').att('root', crypto.randomUUID()).up().up().up();

  // informationRecipient — required by CMS (CONF:CMS_7)
  const infoRecip = doc.ele('informationRecipient');
  const intendedRecip = infoRecip.ele('intendedRecipient');
  intendedRecip.ele('id').att('root', '2.16.840.1.113883.3.249.7').att('extension', options.programName ?? 'MIPS_INDIV').up();

  // documentationOf — required by CMS (CONF:5562-18170_C01)
  const docOf = doc.ele('documentationOf').att('typeCode', 'DOC');
  const serviceEvent = docOf.ele('serviceEvent').att('classCode', 'PCPR');
  const performer = serviceEvent.ele('performer').att('typeCode', 'PRF');
  performer.ele('time').ele('low').att('value', `${reportingYear}0101`).up().ele('high').att('value', `${reportingYear}1231`).up().up();
  const assignedEntity = performer.ele('assignedEntity');
  assignedEntity.ele('id').att('root', '2.16.840.1.113883.4.6').att('extension', options.performerNpi ?? '0000000000').up();
  assignedEntity.ele('representedOrganization').ele('id').att('root', '2.16.840.1.113883.4.2').att('extension', '000000000').up().up();

  // Reporting period
  const component = doc.ele('component').ele('structuredBody');

  // Reporting parameters section
  const reportingSection = component.ele('component').ele('section');
  reportingSection.ele('templateId').att('root', '2.16.840.1.113883.10.20.17.2.1').att('extension', '2020-12-01').up();  // CONF:4484-18098 + 26552
  reportingSection.ele('code').att('code', '55187-9').att('codeSystem', '2.16.840.1.113883.6.1').up();
  reportingSection.ele('title').txt('Reporting Parameters').up();
  const rpEntry = reportingSection.ele('entry').ele('act').att('classCode', 'ACT').att('moodCode', 'EVN');
  rpEntry.ele('templateId').att('root', '2.16.840.1.113883.10.20.17.3.8').att('extension', '2020-12-01').up();  // CONF:4484-18098
  const rpTime = rpEntry.ele('effectiveTime');
  rpTime.ele('low').att('value', `${reportingYear}0101`).up();
  rpTime.ele('high').att('value', `${reportingYear}1231`).up();

  // Measure section
  for (const measure of measures) {
    const measureSection = component.ele('component').ele('section');
    measureSection.ele('templateId').att('root', TEMPLATE_IDS.measureSection).att('extension', '2020-12-01').up();  // CONF:4484-17285 + 21171
    measureSection.ele('templateId').att('root', '2.16.840.1.113883.10.20.27.2.6').att('extension', '2025-05-01').up();  // CMS Measure Section (CONF:5562-21394_C01)
    measureSection.ele('code').att('code', '55186-1').att('codeSystem', '2.16.840.1.113883.6.1').up();
    measureSection.ele('title').txt(measure.title).up();

    const entry = measureSection.ele('entry');
    const organizer = entry.ele('organizer').att('classCode', 'CLUSTER').att('moodCode', 'EVN');
    organizer.ele('templateId').att('root', '2.16.840.1.113883.10.20.27.3.1').att('extension', '2020-12-01').up();  // CONF:4484-17909 + 21170
    organizer.ele('templateId').att('root', '2.16.840.1.113883.10.20.27.3.17').att('extension', '2025-05-01').up();  // CMS Measure Reference (CONF:CMS_54/55/56)
    organizer.ele('templateId').att('root', '2.16.840.1.113883.10.20.27.3.25').att('extension', '2022-05-01').up();  // CMS Measure Data (CONF:CMS_59/60/61)
    organizer.ele('statusCode').att('code', 'completed').up();

    // Measure reference
    const ref = organizer.ele('reference').att('typeCode', 'REFR');
    const extDoc = ref.ele('externalDocument').att('classCode', 'DOC').att('moodCode', 'EVN');
    extDoc.ele('id').att('root', '2.16.840.1.113883.4.738').att('extension', measure.measureId).up();

    // Population counts
    for (const pop of measure.populations) {
      const popCode = POPULATION_CODES[pop.type];
      if (!popCode) continue;

      // Measure Data component with CMS templates (CONF:4484-18425 + CONF:4526-18425_C01)
      const comp = organizer.ele('component');
      const measureDataObs = comp.ele('observation').att('classCode', 'OBS').att('moodCode', 'EVN');
      measureDataObs.ele('templateId').att('root', '2.16.840.1.113883.10.20.27.3.5').att('extension', '2016-09-01').up();  // Measure Data V3 (CONF:4484-18426)
      measureDataObs.ele('templateId').att('root', '2.16.840.1.113883.10.20.27.3.16').att('extension', '2025-05-01').up();  // CMS Measure Data V5 (CONF:5569-18426_C01)
      measureDataObs.ele('code').att('code', 'ASSERTION').att('codeSystem', '2.16.840.1.113883.5.4').up();
      measureDataObs.ele('statusCode').att('code', 'completed').up();
      measureDataObs.ele('value').att('xsi:type', 'CD').att('code', popCode.code).att('codeSystem', '2.16.840.1.113883.5.4').att('displayName', popCode.displayName).up();
      // Aggregate count as entryRelationship
      const aggrER = measureDataObs.ele('entryRelationship').att('typeCode', 'SUBJ').att('inversionInd', 'true');
      const aggrObs = aggrER.ele('observation').att('classCode', 'OBS').att('moodCode', 'EVN');
      aggrObs.ele('templateId').att('root', TEMPLATE_IDS.aggregateCount).up();
      aggrObs.ele('code').att('code', 'MSRAGG').att('codeSystem', '2.16.840.1.113883.5.4').att('displayName', 'rate aggregation').up();  // CONF:77-19508
      aggrObs.ele('statusCode').att('code', 'completed').up();
      aggrObs.ele('value').att('xsi:type', 'INT').att('value', String(pop.count)).up();
      aggrObs.ele('methodCode').att('code', 'COUNT').att('codeSystem', '2.16.840.1.113883.5.84').att('displayName', 'Count').up();  // CONF:77-19509 + 77-19510
    }

    // Performance rate
    if (measure.rate !== null) {
      const prComp = organizer.ele('component');
      const prObs = prComp.ele('observation').att('classCode', 'OBS').att('moodCode', 'EVN');
      prObs.ele('templateId').att('root', TEMPLATE_IDS.performanceRate).att('extension', '2020-12-01').up();  // CONF:4484-19650 + 21444
      prObs.ele('code').att('code', 'ASSERTION').att('codeSystem', '2.16.840.1.113883.5.4').up();
      prObs.ele('reference').att('typeCode', 'REFR').ele('externalObservation').att('classCode', 'OBS').att('moodCode', 'EVN').ele('id').att('root', measure.measureId).up().up().up();  // CONF:4484-19651
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
