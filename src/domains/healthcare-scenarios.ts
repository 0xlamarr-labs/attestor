/**
 * Healthcare Scenario Library — End-to-End Governed Scenarios
 *
 * Concrete healthcare quality measure scenarios that exercise the
 * healthcare domain pack clauses through the governance engine.
 * These are the healthcare equivalents of the financial fixture scenarios.
 */

import type { FinancialQueryIntent } from '../financial/types.js';
import { computeSqlHash, type FixtureQueryMapping } from '../financial/execution.js';

// ─── Scenario 1: Readmission Rate Quality Measure (PASS) ───────────────────

export const READMISSION_SQL = `SELECT
  facility_id,
  facility_name,
  numerator,
  excluded,
  denominator,
  readmission_rate,
  reporting_period
FROM quality.readmission_measures
WHERE reporting_period = '2026-Q1'
ORDER BY readmission_rate DESC`;

export const READMISSION_INTENT: FinancialQueryIntent = {
  queryType: 'counterparty_exposure', // reuse type for now
  description: 'Hospital readmission rate quality measure for CMS reporting.',
  allowedSchemas: ['quality'],
  forbiddenSchemas: ['pii', 'hr'],
  expectedColumns: [
    { name: 'facility_id', type: 'string', required: true, notNull: true },
    { name: 'facility_name', type: 'string', required: true, notNull: true },
    { name: 'numerator', type: 'number', required: true, notNull: true },
    { name: 'excluded', type: 'number', required: true, notNull: true },
    { name: 'denominator', type: 'number', required: true, notNull: true },
    { name: 'readmission_rate', type: 'number', required: true, notNull: true },
  ],
  businessConstraints: [
    { description: 'Result must not be empty', column: '*', check: 'not_empty' },
    { description: 'Readmission rates must be non-negative', column: 'readmission_rate', check: 'non_negative' },
    { description: 'At least 2 facilities', column: '*', check: 'row_count_min', value: 2 },
  ],
};

export const READMISSION_FIXTURE: FixtureQueryMapping = {
  sqlHash: computeSqlHash(READMISSION_SQL),
  description: 'Readmission rate measure — 3 facilities, valid data, consistent populations',
  result: {
    success: true,
    columns: ['facility_id', 'facility_name', 'numerator', 'excluded', 'denominator', 'readmission_rate', 'reporting_period'],
    columnTypes: ['string', 'string', 'number', 'number', 'number', 'number', 'string'],
    rows: [
      { facility_id: 'FAC-001', facility_name: 'Central Hospital', numerator: 45, excluded: 5, denominator: 50, readmission_rate: 0.15, reporting_period: '2026-Q1' },
      { facility_id: 'FAC-002', facility_name: 'County Medical', numerator: 80, excluded: 20, denominator: 100, readmission_rate: 0.12, reporting_period: '2026-Q1' },
      { facility_id: 'FAC-003', facility_name: 'Regional Health', numerator: 150, excluded: 50, denominator: 200, readmission_rate: 0.08, reporting_period: '2026-Q1' },
    ],
  },
};

// ─── Scenario 2: Small Cell Suppression Violation (FAIL) ────────────────────

export const SMALL_CELL_SQL = `SELECT
  condition,
  patient_count,
  avg_los
FROM quality.condition_summary
WHERE reporting_period = '2026-Q1'`;

export const SMALL_CELL_INTENT: FinancialQueryIntent = {
  queryType: 'counterparty_exposure',
  description: 'Condition-level patient summary — requires small cell suppression check.',
  allowedSchemas: ['quality'],
  forbiddenSchemas: ['pii'],
  expectedColumns: [
    { name: 'condition', type: 'string', required: true, notNull: true },
    { name: 'patient_count', type: 'number', required: true, notNull: true },
    { name: 'avg_los', type: 'number', required: true },
  ],
  businessConstraints: [
    { description: 'Result must not be empty', column: '*', check: 'not_empty' },
  ],
};

export const SMALL_CELL_FIXTURE: FixtureQueryMapping = {
  sqlHash: computeSqlHash(SMALL_CELL_SQL),
  description: 'Condition summary — contains small cell (5 patients) that violates suppression threshold',
  result: {
    success: true,
    columns: ['condition', 'patient_count', 'avg_los'],
    columnTypes: ['string', 'number', 'number'],
    rows: [
      { condition: 'Heart Failure', patient_count: 150, avg_los: 5.2 },
      { condition: 'Pneumonia', patient_count: 89, avg_los: 4.1 },
      { condition: 'Rare Condition X', patient_count: 5, avg_los: 12.0 }, // VIOLATION: < 11
      { condition: 'Hip Fracture', patient_count: 42, avg_los: 6.8 },
    ],
  },
};

// ─── Scenario 3: Temporal Inconsistency (FAIL) ─────────────────────────────

export const TEMPORAL_SQL = `SELECT
  encounter_id,
  patient_id,
  admission_date,
  discharge_date,
  los_days
FROM quality.encounters
WHERE admission_date >= '2026-01-01'`;

export const TEMPORAL_INTENT: FinancialQueryIntent = {
  queryType: 'counterparty_exposure',
  description: 'Encounter-level temporal consistency check.',
  allowedSchemas: ['quality'],
  forbiddenSchemas: ['pii'],
  expectedColumns: [
    { name: 'encounter_id', type: 'string', required: true, notNull: true },
    { name: 'patient_id', type: 'string', required: true, notNull: true },
    { name: 'admission_date', type: 'string', required: true, notNull: true },
    { name: 'discharge_date', type: 'string', required: true, notNull: true },
    { name: 'los_days', type: 'number', required: true },
  ],
  businessConstraints: [
    { description: 'Result must not be empty', column: '*', check: 'not_empty' },
    { description: 'LOS must be non-negative', column: 'los_days', check: 'non_negative' },
  ],
};

export const TEMPORAL_FIXTURE: FixtureQueryMapping = {
  sqlHash: computeSqlHash(TEMPORAL_SQL),
  description: 'Encounters — contains temporal inconsistency (admission > discharge)',
  result: {
    success: true,
    columns: ['encounter_id', 'patient_id', 'admission_date', 'discharge_date', 'los_days'],
    columnTypes: ['string', 'string', 'string', 'string', 'number'],
    rows: [
      { encounter_id: 'ENC-001', patient_id: 'P-100', admission_date: '2026-01-05', discharge_date: '2026-01-10', los_days: 5 },
      { encounter_id: 'ENC-002', patient_id: 'P-101', admission_date: '2026-01-15', discharge_date: '2026-01-12', los_days: -3 }, // VIOLATION: admit > discharge
      { encounter_id: 'ENC-003', patient_id: 'P-102', admission_date: '2026-02-01', discharge_date: '2026-02-08', los_days: 7 },
    ],
  },
};
