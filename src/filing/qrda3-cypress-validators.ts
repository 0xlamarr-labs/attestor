/**
 * Cypress-Grade QRDA III Validators — Layers 2-6
 *
 * Reimplements the validation logic from ONC Project Cypress's
 * cqm-validators Ruby gem in TypeScript/Node.js.
 *
 * These validators cover what Cypress checks BEYOND Schematron:
 * - Layer 2: Measure ID validation (HQMF IDs recognized)
 * - Layer 3: Performance Rate recalculation (arithmetic verification)
 * - Layer 4: Population Logic validation (inequality constraints)
 * - Layer 5: Program validation (CMS program code in informationRecipient)
 * - Layer 6: Measure Period validation (date range within reporting year)
 *
 * NOT included in this local validator module:
 * - Layer 7: Value Set / VSAC validation
 *
 * NOTE:
 * - Attestor now wires a separate live VSAC FHIR client for the current demo slice
 * - That path is env-gated because it requires a UMLS API key
 *
 * SCOPE: 'cypress_validators' — Cypress-equivalent validation layers 2-6
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CypressValidationResult {
  valid: boolean;
  layers: CypressLayerResult[];
  totalErrors: number;
  totalWarnings: number;
  /** Cypress-equivalent validators (Layers 2-6), not actual Cypress execution */
  scope: 'cypress_validators';
}

export interface CypressLayerResult {
  layer: number;
  name: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ─── XML Extraction Helpers ────────────────────────────────────────────────
// Simple regex-based extraction from QRDA III XML (no DOM parser needed)

function extractAttrValues(xml: string, elementPattern: string, attrName: string): string[] {
  const regex = new RegExp(`<${elementPattern}[^>]*?${attrName}="([^"]*)"`, 'g');
  const values: string[] = [];
  let m;
  while ((m = regex.exec(xml)) !== null) values.push(m[1]);
  return values;
}

interface PopulationData {
  measureId: string;
  populations: Map<string, number>;
  reportedRate: number | null;
}

function extractMeasures(xml: string): PopulationData[] {
  const measures: PopulationData[] = [];

  // Strategy: find each externalDocument measure reference, then look within
  // the surrounding organizer for population data and performance rates.
  // Split on organizer boundaries to isolate each measure.
  const parts = xml.split(/<organizer /);

  for (let i = 1; i < parts.length; i++) {
    const orgXml = '<organizer ' + parts[i].split(/<\/organizer>/)[0] + '</organizer>';

    // Only process measure reference organizers
    if (!orgXml.includes('2.16.840.1.113883.10.20.27.3.1')) continue;

    // Measure ID from externalDocument/id/@extension
    const midMatch = orgXml.match(/externalDocument[\s\S]*?<id[^>]*?extension="([^"]*?)"/);
    const measureId = midMatch ? midMatch[1] : 'unknown';

    // Population codes + counts: find CD value (pop code) paired with the first INT value (count)
    // Each Measure Data observation has: <value xsi:type="CD" code="IPP"...> followed by
    // an entryRelationship containing <value xsi:type="INT" value="1200">
    const populations = new Map<string, number>();

    // Find all CD code values (population types) - these are the Measure Data observations
    const cdPattern = /xsi:type="CD"[^>]*?code="(IPP|DENOM|DENEX|DENEXCEP|NUMER|NUMEX)"/g;
    let cdMatch;
    // For each CD match, find the nearest following INT value within the same component
    const components = orgXml.split(/<component>/);
    for (const comp of components) {
      const cdCode = comp.match(/xsi:type="CD"[^>]*?code="(IPP|DENOM|DENEX|DENEXCEP|NUMER|NUMEX)"/) ??
                     comp.match(/code="(IPP|DENOM|DENEX|DENEXCEP|NUMER|NUMEX)"[^>]*?xsi:type="CD"/);
      if (!cdCode) continue;
      // Find the FIRST INT value in this component (the aggregate count, not supplemental)
      const intMatch = comp.match(/xsi:type="INT"[^>]*?value="(\d+)"/);
      if (intMatch) {
        populations.set(cdCode[1], parseInt(intMatch[1], 10));
      }
    }

    // Performance rate from REAL value
    let reportedRate: number | null = null;
    const prMatch = orgXml.match(/xsi:type="REAL"[^>]*?value="([^"]*)"/);
    if (prMatch) {
      reportedRate = parseFloat(prMatch[1]);
    }

    measures.push({ measureId, populations, reportedRate });
  }

  return measures;
}

// ─── Layer 2: Measure ID Validator ─────────────────────────────────────────
// Validates HQMF IDs are recognized CMS 2026 measures

const CMS_2026_MEASURE_IDS = new Set([
  // CMS eCQM measure IDs for 2026 MIPS reporting (top measures)
  'CMS165v12', 'CMS122v12', 'CMS130v12', 'CMS127v12', 'CMS138v12',
  'CMS50v12', 'CMS56v12', 'CMS66v12', 'CMS68v12', 'CMS69v12',
  'CMS75v12', 'CMS90v12', 'CMS117v12', 'CMS128v12', 'CMS134v12',
  'CMS136v13', 'CMS137v12', 'CMS139v12', 'CMS142v12', 'CMS143v12',
  'CMS144v12', 'CMS145v12', 'CMS146v12', 'CMS147v13', 'CMS149v12',
  'CMS153v12', 'CMS154v12', 'CMS155v12', 'CMS156v12', 'CMS157v12',
  'CMS159v12', 'CMS161v12', 'CMS177v12', 'CMS249v6', 'CMS347v7',
  'CMS349v6', 'CMS645v7', 'CMS646v4', 'CMS771v5', 'CMS951v3',
]);

function validateMeasureIds(measures: PopulationData[]): CypressLayerResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const m of measures) {
    if (m.measureId === 'unknown') {
      errors.push('Measure organizer missing externalDocument/id/@extension');
      continue;
    }
    if (!CMS_2026_MEASURE_IDS.has(m.measureId)) {
      warnings.push(`Measure ID '${m.measureId}' not in CMS 2026 recognized measure list (may be valid but unrecognized)`);
    }
    if (seen.has(m.measureId)) {
      errors.push(`Duplicate measure entry for '${m.measureId}'`);
    }
    seen.add(m.measureId);
  }

  return { layer: 2, name: 'MeasureIdValidator', valid: errors.length === 0, errors, warnings };
}

// ─── Layer 3: Performance Rate Validator ───────────────────────────────────
// Recalculates performance rates from population counts

function validatePerformanceRates(measures: PopulationData[]): CypressLayerResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const m of measures) {
    if (m.reportedRate === null) continue;

    const numer = m.populations.get('NUMER') ?? 0;
    const numex = m.populations.get('NUMEX') ?? 0;
    const denom = m.populations.get('DENOM') ?? 0;
    const denex = m.populations.get('DENEX') ?? 0;
    const denexcep = m.populations.get('DENEXCEP') ?? 0;

    const effectiveDenom = denom - denex - denexcep;

    if (effectiveDenom <= 0) {
      if (m.reportedRate !== null && !isNaN(m.reportedRate)) {
        errors.push(`${m.measureId}: zero effective denominator but performance rate is ${m.reportedRate} (should be nullFlavor="NA")`);
      }
      continue;
    }

    const calculatedRate = (numer - numex) / effectiveDenom;
    const diff = Math.abs(calculatedRate - m.reportedRate);

    // Tolerance matches Cypress: reported rate is toFixed(6), so allow rounding tolerance
    if (diff > 0.000001) {
      errors.push(`${m.measureId}: reported rate ${m.reportedRate.toFixed(6)} != calculated ${calculatedRate.toFixed(6)} (NUMER=${numer}, NUMEX=${numex}, DENOM=${denom}, DENEX=${denex}, DENEXCEP=${denexcep})`);
    }

    // Check precision (no more than 6 decimal places)
    const rateStr = m.reportedRate.toString();
    const decimalPart = rateStr.includes('.') ? rateStr.split('.')[1] : '';
    if (decimalPart.length > 6) {
      warnings.push(`${m.measureId}: performance rate has ${decimalPart.length} decimal places (max 6 recommended)`);
    }
  }

  return { layer: 3, name: 'PerformanceRateValidator', valid: errors.length === 0, errors, warnings };
}

// ─── Layer 4: Population Logic Validator ───────────────────────────────────
// Validates population count constraints

function validatePopulationLogic(measures: PopulationData[]): CypressLayerResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const m of measures) {
    const ipp = m.populations.get('IPP') ?? 0;
    const denom = m.populations.get('DENOM') ?? 0;
    const numer = m.populations.get('NUMER') ?? 0;
    const denex = m.populations.get('DENEX') ?? 0;
    const denexcep = m.populations.get('DENEXCEP') ?? 0;
    const numex = m.populations.get('NUMEX') ?? 0;

    // For proportion measures: DENOM <= IPP
    if (denom > ipp) {
      errors.push(`${m.measureId}: DENOM (${denom}) > IPP (${ipp}) — denominator cannot exceed initial population`);
    }

    // NUMER + DENEX + DENEXCEP <= DENOM
    if (numer + denex + denexcep > denom) {
      errors.push(`${m.measureId}: NUMER(${numer}) + DENEX(${denex}) + DENEXCEP(${denexcep}) = ${numer + denex + denexcep} > DENOM(${denom})`);
    }

    // NUMEX <= NUMER
    if (numex > numer) {
      errors.push(`${m.measureId}: NUMEX (${numex}) > NUMER (${numer}) — numerator exclusions cannot exceed numerator`);
    }

    // All populations must be non-negative
    for (const [code, count] of m.populations) {
      if (count < 0) {
        errors.push(`${m.measureId}: ${code} count is negative (${count})`);
      }
    }
  }

  return { layer: 4, name: 'PopulationLogicValidator', valid: errors.length === 0, errors, warnings };
}

// ─── Layer 5: Program Validator ────────────────────────────────────────────
// Validates CMS program code in informationRecipient

const VALID_PROGRAMS = new Set([
  'MIPS_INDIV', 'MIPS_GROUP', 'MIPS_VIRTUALGROUP', 'MIPS_SUBGROUP', 'MIPS_APMGROUP',
  'CPCPLUS', 'PCF', 'MCP', 'APP1', 'HQR_PI', 'HQR_IQR', 'HQR_IQR_VOL',
]);

function validateProgram(xml: string): CypressLayerResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Extract program code from informationRecipient/intendedRecipient/id
  const programMatch = xml.match(/<intendedRecipient[\s\S]*?<id[^>]*?root="2\.16\.840\.1\.113883\.3\.249\.7"[^>]*?extension="([^"]*)"/) ||
                       xml.match(/<intendedRecipient[\s\S]*?<id[^>]*?extension="([^"]*)"[^>]*?root="2\.16\.840\.1\.113883\.3\.249\.7"/);

  if (!programMatch) {
    errors.push('Missing informationRecipient with CMS program code (root 2.16.840.1.113883.3.249.7)');
    return { layer: 5, name: 'ProgramValidator', valid: false, errors, warnings };
  }

  const program = programMatch[1];
  if (!VALID_PROGRAMS.has(program)) {
    warnings.push(`Program code '${program}' not in recognized CMS program list`);
  }

  return { layer: 5, name: 'ProgramValidator', valid: errors.length === 0, errors, warnings };
}

// ─── Layer 6: Measure Period Validator ─────────────────────────────────────
// Validates reporting period falls within the program year

function validateMeasurePeriod(xml: string): CypressLayerResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Extract reporting period from Reporting Parameters Act effectiveTime
  const lowMatch = xml.match(/<act[^>]*>[\s\S]*?2\.16\.840\.1\.113883\.10\.20\.17\.3\.8[\s\S]*?<low[^>]*?value="(\d{4})(\d{2})(\d{2})"/) ||
                   xml.match(/<low[^>]*?value="(\d{4})(\d{2})(\d{2})"/);
  const highMatch = xml.match(/<act[^>]*>[\s\S]*?2\.16\.840\.1\.113883\.10\.20\.17\.3\.8[\s\S]*?<high[^>]*?value="(\d{4})(\d{2})(\d{2})"/) ||
                    xml.match(/<high[^>]*?value="(\d{4})(\d{2})(\d{2})"/);

  if (!lowMatch || !highMatch) {
    errors.push('Missing reporting period low/high values in Reporting Parameters Act');
    return { layer: 6, name: 'MeasurePeriodValidator', valid: false, errors, warnings };
  }

  const lowYear = parseInt(lowMatch[1], 10);
  const highYear = parseInt(highMatch[1], 10);
  const lowMonth = parseInt(lowMatch[2], 10);
  const highMonth = parseInt(highMatch[2], 10);
  const lowDay = parseInt(lowMatch[3], 10);
  const highDay = parseInt(highMatch[3], 10);

  // Period must be at least 1 day
  const lowDate = new Date(lowYear, lowMonth - 1, lowDay);
  const highDate = new Date(highYear, highMonth - 1, highDay);
  if (highDate <= lowDate) {
    errors.push(`Reporting period end (${highMatch[0]}) must be after start (${lowMatch[0]})`);
  }

  // Period must fall within a single program year
  if (lowYear !== highYear) {
    warnings.push(`Reporting period spans multiple years (${lowYear}-${highYear})`);
  }

  // MIPS: must fall within Jan 1 - Dec 31 of the program year
  if (lowMonth < 1 || highMonth > 12) {
    errors.push('Reporting period months out of range');
  }

  return { layer: 6, name: 'MeasurePeriodValidator', valid: errors.length === 0, errors, warnings };
}

// ─── Main Validator ────────────────────────────────────────────────────────

/**
 * Run Cypress-equivalent validation layers 2-6 against QRDA III XML.
 *
 * This reimplements the validation logic from ONC Project Cypress's
 * cqm-validators Ruby gem in TypeScript. Layer 1 (Schematron) is
 * handled separately by validateCmsSchematron().
 *
 * Layer 7 (Value Set / VSAC) is not included in this local module.
 * Use the separate live VSAC client path when credentials are available.
 */
export function validateCypressLayers(xml: string): CypressValidationResult {
  const measures = extractMeasures(xml);

  const layers: CypressLayerResult[] = [
    validateMeasureIds(measures),          // Layer 2
    validatePerformanceRates(measures),    // Layer 3
    validatePopulationLogic(measures),     // Layer 4
    validateProgram(xml),                  // Layer 5
    validateMeasurePeriod(xml),            // Layer 6
  ];

  const totalErrors = layers.reduce((sum, l) => sum + l.errors.length, 0);
  const totalWarnings = layers.reduce((sum, l) => sum + l.warnings.length, 0);

  return {
    valid: totalErrors === 0,
    layers,
    totalErrors,
    totalWarnings,
    scope: 'cypress_validators',
  };
}
