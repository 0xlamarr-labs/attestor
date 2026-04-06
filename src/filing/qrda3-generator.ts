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
