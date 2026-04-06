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

// ─── Supplemental Data Helper ──────────────────────────────────────────────
// CMS requires Payer, Sex, Race, Ethnicity supplemental data on each Measure Data observation.
// These emit minimal valid supplemental data elements with "unknown" aggregate counts.

function emitSupplementalData(parent: any, templateRoot: string, templateExt: string, loincCode: string, displayName: string, _tag: string): void {
  const er = parent.ele('entryRelationship').att('typeCode', 'COMP');
  const obs = er.ele('observation').att('classCode', 'OBS').att('moodCode', 'EVN');
  obs.ele('templateId').att('root', templateRoot).att('extension', templateExt).up();
  obs.ele('code').att('code', loincCode).att('codeSystem', '2.16.840.1.113883.6.1').att('displayName', displayName).up();
  obs.ele('statusCode').att('code', 'completed').up();
  const valEle = obs.ele('value').att('xsi:type', 'CD').att('nullFlavor', 'OTH');
  valEle.ele('translation').att('code', 'UNK').att('codeSystem', '2.16.840.1.113883.5.1').att('displayName', 'Unknown').up();
  valEle.up();
  // Aggregate count for this stratum
  const aggrER = obs.ele('entryRelationship').att('typeCode', 'SUBJ').att('inversionInd', 'true');
  const aggrObs = aggrER.ele('observation').att('classCode', 'OBS').att('moodCode', 'EVN');
  aggrObs.ele('templateId').att('root', '2.16.840.1.113883.10.20.27.3.3').up();
  aggrObs.ele('code').att('code', 'MSRAGG').att('codeSystem', '2.16.840.1.113883.5.4').att('displayName', 'rate aggregation').up();
  aggrObs.ele('statusCode').att('code', 'completed').up();
  aggrObs.ele('value').att('xsi:type', 'INT').att('value', '0').up();
  aggrObs.ele('methodCode').att('code', 'COUNT').att('codeSystem', '2.16.840.1.113883.5.84').att('displayName', 'Count').up();
}

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

  // CMS EHR Certification ID participant — CONF:CMS_140
  const participant = doc.ele('participant').att('typeCode', 'DEV');
  const associatedEntity = participant.ele('associatedEntity').att('classCode', 'RGPR');
  associatedEntity.ele('id').att('root', '2.16.840.1.113883.3.2074.1').att('extension', '0015HxDLbM0RXaO').up();
  associatedEntity.ele('code').att('code', '129465004').att('codeSystem', '2.16.840.1.113883.6.96').att('displayName', 'medical record').up();  // CONF:4484-18308

  // Reporting period
  const component = doc.ele('component').ele('structuredBody');

  // Reporting parameters section
  const reportingSection = component.ele('component').ele('section');
  reportingSection.ele('templateId').att('root', '2.16.840.1.113883.10.20.17.2.1').att('extension', '2020-12-01').up();  // CONF:4484-18098 + 26552
  reportingSection.ele('code').att('code', '55187-9').att('codeSystem', '2.16.840.1.113883.6.1').up();
  reportingSection.ele('title').txt('Reporting Parameters').up();
  const rpEntry = reportingSection.ele('entry').att('typeCode', 'DRIV');
  const rpAct = rpEntry.ele('act').att('classCode', 'ACT').att('moodCode', 'EVN');
  rpAct.ele('templateId').att('root', '2.16.840.1.113883.10.20.17.3.8').att('extension', '2020-12-01').up();  // CONF:4484-18098
  rpAct.ele('id').att('root', crypto.randomUUID()).up();  // CONF:4484-26549
  rpAct.ele('code').att('code', '252116004').att('codeSystem', '2.16.840.1.113883.6.96').att('displayName', 'Observation Parameters').up();  // CONF:4484-3272
  const rpTime = rpAct.ele('effectiveTime');
  rpTime.ele('low').att('value', `${reportingYear}0101`).up();
  rpTime.ele('high').att('value', `${reportingYear}1231`).up();

  // Single Measure Section containing all measures as entries (CMS IG: one section, multiple entries)
  const measureSection = component.ele('component').ele('section');
  measureSection.ele('templateId').att('root', TEMPLATE_IDS.measureSection).att('extension', '2020-12-01').up();  // CONF:4484-17285 + 21171
  measureSection.ele('templateId').att('root', '2.16.840.1.113883.10.20.27.2.3').att('extension', '2025-05-01').up();  // CMS Measure Section V6 (CONF:5562-21394_C01)
  measureSection.ele('code').att('code', '55186-1').att('codeSystem', '2.16.840.1.113883.6.1').up();
  measureSection.ele('title').txt('Measure Section').up();

  // Reporting Parameters Act reference within measure section (CONF:4484-21467/21468)
  const rpEntryInSection = measureSection.ele('entry').att('typeCode', 'DRIV');
  const rpActRef = rpEntryInSection.ele('act').att('classCode', 'ACT').att('moodCode', 'EVN');
  rpActRef.ele('templateId').att('root', '2.16.840.1.113883.10.20.17.3.8').att('extension', '2020-12-01').up();
  rpActRef.ele('id').att('root', crypto.randomUUID()).up();
  rpActRef.ele('code').att('code', '252116004').att('codeSystem', '2.16.840.1.113883.6.96').att('displayName', 'Observation Parameters').up();
  const rpActRefTime = rpActRef.ele('effectiveTime');
  rpActRefTime.ele('low').att('value', `${reportingYear}0101`).up();
  rpActRefTime.ele('high').att('value', `${reportingYear}1231`).up();

  for (const measure of measures) {
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

      // Measure Data reference — CONF:3259-18239/18240/18241
      const mdRef = measureDataObs.ele('reference').att('typeCode', 'REFR');
      mdRef.ele('externalObservation').att('classCode', 'OBS').att('moodCode', 'EVN')
        .ele('id').att('root', measure.measureId).att('extension', popCode.code).up().up();

      // Supplemental data elements — required per CMS Measure Data CMS V5
      // Payer (CONF:4427-18141_C01)
      emitSupplementalData(measureDataObs, '2.16.840.1.113883.10.20.27.3.18', '2018-05-01', '48768-6', 'Payer', 'PAYER');
      // Sex (CONF:4427-18136_C01 / CMS_151)
      emitSupplementalData(measureDataObs, '2.16.840.1.113883.10.20.27.3.21', '2025-05-01', '76689-9', 'Sex Assigned at Birth', 'SEX');
      // Race (CONF:4427-18140_C01 / 3259-18150)
      emitSupplementalData(measureDataObs, '2.16.840.1.113883.10.20.27.3.8', '2016-09-01', '72826-1', 'Race', 'RACE');
      // Ethnicity (CONF:4427-18139_C01 / 3259-18149)
      emitSupplementalData(measureDataObs, '2.16.840.1.113883.10.20.27.3.7', '2016-09-01', '69490-1', 'Ethnicity', 'ETH');
    }

    // Performance rate
    if (measure.rate !== null) {
      const prComp = organizer.ele('component');
      const prObs = prComp.ele('observation').att('classCode', 'OBS').att('moodCode', 'EVN');
      prObs.ele('templateId').att('root', TEMPLATE_IDS.performanceRate).att('extension', '2020-12-01').up();  // CONF:4484-19650 + 21444
      prObs.ele('templateId').att('root', '2.16.840.1.113883.10.20.27.3.25').att('extension', '2022-05-01').up();  // CMS Performance Rate (CONF:CMS_59/60/61)
      prObs.ele('code').att('code', 'ASSERTION').att('codeSystem', '2.16.840.1.113883.5.4').up();
      const prRef = prObs.ele('reference').att('typeCode', 'REFR');
      const prExtObs = prRef.ele('externalObservation').att('classCode', 'OBS').att('moodCode', 'EVN');
      prExtObs.ele('id').att('root', measure.measureId).up();  // CONF:4484-19651
      prExtObs.ele('code').att('code', 'NUMER').att('codeSystem', '2.16.840.1.113883.5.4').att('displayName', 'Numerator').up();  // CONF:4484-19657
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

  // 5. Measure count — count measure reference organizer entries (one per measure within the single section)
  // Match the exact template root followed by a quote (not a digit, to avoid matching .10, .16, .17, etc.)
  const measureOrganizerMatches = xml.match(/2\.16\.840\.1\.113883\.10\.20\.27\.3\.1["']/g);
  const actualMeasureCount = measureOrganizerMatches ? measureOrganizerMatches.length : 0;
  check('measure_count', actualMeasureCount === expectedMeasureCount, `Expected ${expectedMeasureCount} measure organizers, found ${actualMeasureCount}`);

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
