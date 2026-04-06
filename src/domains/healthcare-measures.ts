/**
 * Healthcare Quality Measures — eCQM/HEDIS Structure
 *
 * Defines the structure for electronic Clinical Quality Measures (eCQMs)
 * as governed by CMS. These measures follow the FHIR-based quality
 * reporting framework.
 *
 * ARCHITECTURE:
 * - Measure definitions with population criteria
 * - Evaluation against patient-level data
 * - QRDA Category I/III-compatible output structure
 *
 * BOUNDARY:
 * - Measure DEFINITION and EVALUATION structure
 * - Not a full CQL (Clinical Quality Language) engine
 * - Not a FHIR R4 server
 * - Structural compatibility, not full certification
 */

// ─── Measure Definition ─────────────────────────────────────────────────────

export interface QualityMeasure {
  /** Measure identifier (e.g., CMS30v12). */
  measureId: string;
  /** NQF number if applicable. */
  nqfNumber?: string;
  /** Human-readable title. */
  title: string;
  /** Measure type. */
  type: 'process' | 'outcome' | 'structure' | 'composite';
  /** Reporting period. */
  reportingPeriod: { start: string; end: string };
  /** Population criteria. */
  populations: MeasurePopulation[];
  /** Stratification dimensions. */
  stratifiers?: MeasureStratifier[];
  /** Supplemental data elements. */
  supplementalData?: string[];
}

export interface MeasurePopulation {
  /** Population type (CMS standard). */
  type: 'initial_population' | 'denominator' | 'denominator_exclusion' |
        'denominator_exception' | 'numerator' | 'numerator_exclusion' |
        'measure_population' | 'measure_observation';
  /** Human-readable description. */
  description: string;
  /** SQL or CQL expression (simplified for Attestor governance). */
  criteria: string;
}

export interface MeasureStratifier {
  id: string;
  description: string;
  criteria: string;
}

// ─── Measure Evaluation ─────────────────────────────────────────────────────

export interface MeasureEvaluation {
  measureId: string;
  title: string;
  reportingPeriod: { start: string; end: string };
  evaluatedAt: string;
  /** Population counts. */
  populations: PopulationCount[];
  /** Calculated rate (numerator / denominator). */
  rate: number | null;
  /** Performance met threshold. */
  performanceMet: boolean;
  /** Stratified results if applicable. */
  stratifications?: StratifiedResult[];
  /** Governance checks applied. */
  governanceChecks: GovernanceCheck[];
}

export interface PopulationCount {
  type: MeasurePopulation['type'];
  count: number;
}

export interface StratifiedResult {
  stratifierId: string;
  populations: PopulationCount[];
  rate: number | null;
}

export interface GovernanceCheck {
  checkId: string;
  passed: boolean;
  description: string;
  evidence: Record<string, unknown>;
}

// ─── Example Measures ───────────────────────────────────────────────────────

/** CMS Hospital-Wide All-Cause Readmission (HWR) measure structure. */
export const CMS_READMISSION_MEASURE: QualityMeasure = {
  measureId: 'CMS-HWR',
  title: 'Hospital-Wide All-Cause Unplanned Readmission',
  type: 'outcome',
  reportingPeriod: { start: '2026-01-01', end: '2026-03-31' },
  populations: [
    { type: 'initial_population', description: 'All eligible discharges', criteria: 'discharge_date BETWEEN ? AND ?' },
    { type: 'denominator', description: 'Eligible discharges excluding planned readmissions', criteria: 'eligible = true AND planned_readmission = false' },
    { type: 'denominator_exclusion', description: 'Discharges with planned readmission', criteria: 'planned_readmission = true' },
    { type: 'numerator', description: 'Unplanned readmissions within 30 days', criteria: 'readmitted_30day = true AND planned_readmission = false' },
  ],
};

/**
 * Evaluate a quality measure against population data.
 */
export function evaluateMeasure(
  measure: QualityMeasure,
  populationData: Record<string, number>,
): MeasureEvaluation {
  const populations: PopulationCount[] = measure.populations.map(p => ({
    type: p.type,
    count: populationData[p.type] ?? 0,
  }));

  const denominator = populationData['denominator'] ?? 0;
  const numerator = populationData['numerator'] ?? 0;
  const rate = denominator > 0 ? numerator / denominator : null;

  // Governance checks
  const checks: GovernanceCheck[] = [
    {
      checkId: 'population_consistency',
      passed: (populationData['numerator'] ?? 0) <= (populationData['denominator'] ?? 0),
      description: 'Numerator must not exceed denominator',
      evidence: { numerator, denominator },
    },
    {
      checkId: 'minimum_sample',
      passed: denominator >= 25,
      description: 'Minimum 25 patients in denominator for reportable measure',
      evidence: { denominator, threshold: 25 },
    },
    {
      checkId: 'small_cell_suppression',
      passed: populations.every(p => p.count === 0 || p.count >= 11),
      description: 'All non-zero populations must meet minimum cell size (11)',
      evidence: { populations: populations.filter(p => p.count > 0 && p.count < 11) },
    },
  ];

  return {
    measureId: measure.measureId,
    title: measure.title,
    reportingPeriod: measure.reportingPeriod,
    evaluatedAt: new Date().toISOString(),
    populations,
    rate,
    performanceMet: rate !== null && rate < 0.15, // example threshold
    governanceChecks: checks,
  };
}

// ─── CMS Top 3 Quality Measures ─────────────────────────────────────────────

/** CMS165v12 — Controlling High Blood Pressure (largest population, MIPS/MSSP/HEDIS). */
export const CMS165_BLOOD_PRESSURE: QualityMeasure = {
  measureId: 'CMS165v12',
  nqfNumber: '0018',
  title: 'Controlling High Blood Pressure',
  type: 'outcome',
  reportingPeriod: { start: '2026-01-01', end: '2026-12-31' },
  populations: [
    { type: 'initial_population', description: 'Patients 18-85 with hypertension', criteria: 'age BETWEEN 18 AND 85 AND has_hypertension = true' },
    { type: 'denominator', description: 'Initial population', criteria: 'initial_population' },
    { type: 'denominator_exclusion', description: 'ESRD, dialysis, kidney transplant, pregnancy', criteria: 'has_exclusion = true' },
    { type: 'numerator', description: 'Most recent BP < 140/90', criteria: 'systolic < 140 AND diastolic < 90' },
  ],
};

/** CMS122v12 — Diabetes: Hemoglobin A1c Poor Control (inverse: lower numerator = better). */
export const CMS122_DIABETES_A1C: QualityMeasure = {
  measureId: 'CMS122v12',
  nqfNumber: '0059',
  title: 'Diabetes: Hemoglobin A1c Poor Control (>9%)',
  type: 'outcome',
  reportingPeriod: { start: '2026-01-01', end: '2026-12-31' },
  populations: [
    { type: 'initial_population', description: 'Patients 18-75 with diabetes', criteria: 'age BETWEEN 18 AND 75 AND has_diabetes = true' },
    { type: 'denominator', description: 'Initial population', criteria: 'initial_population' },
    { type: 'denominator_exclusion', description: 'Hospice, advanced illness', criteria: 'has_exclusion = true' },
    { type: 'numerator', description: 'Most recent HbA1c > 9%', criteria: 'hba1c > 9.0' },
  ],
};

/** CMS130v12 — Colorectal Cancer Screening (multi-pathway). */
export const CMS130_COLORECTAL_SCREENING: QualityMeasure = {
  measureId: 'CMS130v12',
  nqfNumber: '0034',
  title: 'Colorectal Cancer Screening',
  type: 'process',
  reportingPeriod: { start: '2026-01-01', end: '2026-12-31' },
  populations: [
    { type: 'initial_population', description: 'Patients 45-75', criteria: 'age BETWEEN 45 AND 75' },
    { type: 'denominator', description: 'Initial population', criteria: 'initial_population' },
    { type: 'denominator_exclusion', description: 'Colorectal cancer, total colectomy', criteria: 'has_exclusion = true' },
    { type: 'numerator', description: 'Appropriate screening', criteria: 'colonoscopy_10yr OR fit_dna_3yr OR fobt_1yr' },
  ],
};

// ─── FHIR MeasureReport ─────────────────────────────────────────────────────

export interface FhirMeasureReport {
  resourceType: 'MeasureReport';
  type: 'summary';
  measure: string;
  period: { start: string; end: string };
  group: { population: { code: string; count: number }[]; measureScore: { value: number | null } }[];
}

/** Generate FHIR-compatible MeasureReport from an evaluation. */
export function toFhirMeasureReport(evaluation: MeasureEvaluation): FhirMeasureReport {
  return {
    resourceType: 'MeasureReport',
    type: 'summary',
    measure: `http://hl7.org/fhir/us/cqfmeasures/${evaluation.measureId}`,
    period: evaluation.reportingPeriod,
    group: [{
      population: evaluation.populations.map(p => ({ code: p.type, count: p.count })),
      measureScore: { value: evaluation.rate },
    }],
  };
}
