/**
 * Financial Fixture Scenarios — Concrete test cases for the financial reference implementation.
 *
 * Three scenarios:
 * 1. Counterparty Exposure Summary (pass case)
 * 2. Liquidity Risk Exception Report (fail case — data contract violation)
 * 3. Reconciliation Variance Report (fail case — reconciliation mismatch)
 *
 * Plus SQL governance edge cases:
 * 4. Unsafe SQL (write operation blocked)
 * 5. Schema violation SQL (forbidden schema blocked)
 * 6. SQL injection attempt (blocked)
 */

import { computeSqlHash, type FixtureDatabase, type FixtureQueryMapping } from '../execution.js';
import type { FinancialQueryIntent, ReportContract, GeneratedReport } from '../types.js';

// ─── Scenario 1: Counterparty Exposure Summary (PASS) ────────────────────────

export const COUNTERPARTY_SQL = `SELECT
  counterparty_name,
  exposure_usd,
  credit_rating,
  sector
FROM risk.counterparty_exposures
WHERE reporting_date = '2026-03-28'
ORDER BY exposure_usd DESC`;

export const COUNTERPARTY_INTENT: FinancialQueryIntent = {
  queryType: 'counterparty_exposure',
  description: 'Summarize top counterparty exposures by credit rating and sector for the current reporting date.',
  allowedSchemas: ['risk'],
  forbiddenSchemas: ['pii', 'hr', 'auth'],
  executionClass: 'bounded_detail',
  executionBudget: { maxJoins: 2, maxProjectedColumns: 10, allowWildcard: false, requireLimit: false },
  expectedColumns: [
    { name: 'counterparty_name', type: 'string', required: true, notNull: true },
    { name: 'exposure_usd', type: 'number', required: true, notNull: true },
    { name: 'credit_rating', type: 'string', required: true, notNull: true },
    { name: 'sector', type: 'string', required: true },
  ],
  businessConstraints: [
    { description: 'Result must not be empty', column: '*', check: 'not_empty' },
    { description: 'Exposure must be non-negative', column: 'exposure_usd', check: 'non_negative' },
    { description: 'At least 3 counterparties', column: '*', check: 'row_count_min', value: 3 },
    { description: 'Total exposure should equal 850M', column: 'exposure_usd', check: 'sum_equals', value: 850_000_000 },
  ],
};

export const COUNTERPARTY_FIXTURE: FixtureQueryMapping = {
  sqlHash: computeSqlHash(COUNTERPARTY_SQL),
  description: 'Counterparty exposure summary — 5 rows, valid data',
  result: {
    success: true,
    columns: ['counterparty_name', 'exposure_usd', 'credit_rating', 'sector'],
    columnTypes: ['string', 'number', 'string', 'string'],
    rows: [
      { counterparty_name: 'Bank of Nova Scotia', exposure_usd: 250_000_000, credit_rating: 'AA-', sector: 'Banking' },
      { counterparty_name: 'Deutsche Bank AG', exposure_usd: 200_000_000, credit_rating: 'A-', sector: 'Banking' },
      { counterparty_name: 'Toyota Motor Corp', exposure_usd: 180_000_000, credit_rating: 'A+', sector: 'Automotive' },
      { counterparty_name: 'Shell plc', exposure_usd: 120_000_000, credit_rating: 'A', sector: 'Energy' },
      { counterparty_name: 'Tesco plc', exposure_usd: 100_000_000, credit_rating: 'BBB+', sector: 'Retail' },
    ],
  },
};

export const COUNTERPARTY_REPORT_CONTRACT: ReportContract = {
  reportType: 'counterparty_exposure',
  sections: [
    { id: 'summary', title: 'Executive Summary', required: true, contentType: 'narrative' },
    { id: 'exposure_table', title: 'Exposure by Counterparty', required: true, contentType: 'table' },
    { id: 'total_exposure', title: 'Total Exposure', required: true, contentType: 'metric', numericReference: 'exposure_usd', expectedAggregation: 'sum' },
    { id: 'disclaimer', title: 'Regulatory Disclaimer', required: true, contentType: 'disclaimer' },
  ],
  requiredMetadata: ['report_date', 'prepared_by', 'reporting_entity', 'version'],
};

export const COUNTERPARTY_REPORT: GeneratedReport = {
  reportType: 'counterparty_exposure',
  metadata: {
    report_date: '2026-03-28',
    prepared_by: 'Attestor Financial Pipeline',
    reporting_entity: 'Test Bank Holdings Ltd',
    version: '1.0',
  },
  sections: [
    {
      id: 'summary',
      title: 'Executive Summary',
      contentType: 'narrative',
      content: 'As of 2026-03-28, total counterparty exposure stands at USD 850M across 5 counterparties. The largest single exposure is Bank of Nova Scotia at USD 250M (AA-). No counterparty exceeds the internal concentration limit.',
    },
    {
      id: 'exposure_table',
      title: 'Exposure by Counterparty',
      contentType: 'table',
      content: 'Bank of Nova Scotia: $250M (AA-) | Deutsche Bank AG: $200M (A-) | Toyota Motor Corp: $180M (A+) | Shell plc: $120M (A) | Tesco plc: $100M (BBB+)',
    },
    {
      id: 'total_exposure',
      title: 'Total Exposure',
      contentType: 'metric',
      content: 'Total counterparty exposure: USD 850,000,000',
      numericValues: { exposure_usd: 850_000_000 },
    },
    {
      id: 'disclaimer',
      title: 'Regulatory Disclaimer',
      contentType: 'disclaimer',
      content: 'This report is generated for internal risk management purposes only and does not constitute a regulatory filing. Data is sourced from the internal risk warehouse as of the reporting date.',
    },
  ],
};

export const COUNTERPARTY_LIVE_DATABASES: FixtureDatabase[] = [
  {
    schema: 'risk',
    tables: [
      {
        name: 'counterparty_exposures',
        columns: [
          { name: 'counterparty_name', type: 'string' },
          { name: 'exposure_usd', type: 'number' },
          { name: 'credit_rating', type: 'string' },
          { name: 'sector', type: 'string' },
          { name: 'reporting_date', type: 'date' },
        ],
        rows: [
          { counterparty_name: 'Bank of Nova Scotia', exposure_usd: 250_000_000, credit_rating: 'AA-', sector: 'Banking', reporting_date: '2026-03-28' },
          { counterparty_name: 'Deutsche Bank AG', exposure_usd: 200_000_000, credit_rating: 'A-', sector: 'Banking', reporting_date: '2026-03-28' },
          { counterparty_name: 'Toyota Motor Corp', exposure_usd: 180_000_000, credit_rating: 'A+', sector: 'Automotive', reporting_date: '2026-03-28' },
          { counterparty_name: 'Shell plc', exposure_usd: 120_000_000, credit_rating: 'A', sector: 'Energy', reporting_date: '2026-03-28' },
          { counterparty_name: 'Tesco plc', exposure_usd: 100_000_000, credit_rating: 'BBB+', sector: 'Retail', reporting_date: '2026-03-28' },
          { counterparty_name: 'Legacy Counterparty', exposure_usd: 90_000_000, credit_rating: 'BBB', sector: 'Industrial', reporting_date: '2026-03-21' },
        ],
      },
    ],
  },
];

// ─── Scenario 2: Liquidity Risk — Data Contract Violation (FAIL) ─────────────

export const LIQUIDITY_SQL = `SELECT
  asset_class,
  liquidity_value,
  days_to_maturity,
  is_encumbered
FROM risk.liquidity_buffer
WHERE reporting_date = '2026-03-28'`;

export const LIQUIDITY_INTENT: FinancialQueryIntent = {
  queryType: 'liquidity_risk',
  description: 'Retrieve liquidity buffer composition for LCR reporting.',
  allowedSchemas: ['risk'],
  forbiddenSchemas: ['pii', 'hr'],
  expectedColumns: [
    { name: 'asset_class', type: 'string', required: true, notNull: true },
    { name: 'liquidity_value', type: 'number', required: true, notNull: true },
    { name: 'days_to_maturity', type: 'number', required: true },
    { name: 'is_encumbered', type: 'boolean', required: true },
  ],
  businessConstraints: [
    { description: 'Result must not be empty', column: '*', check: 'not_empty' },
    { description: 'Liquidity values must be non-negative', column: 'liquidity_value', check: 'non_negative' },
    { description: 'Days to maturity in valid range', column: 'days_to_maturity', check: 'range', min: 0, max: 3650 },
  ],
};

// This fixture has a NEGATIVE liquidity value (data contract violation)
export const LIQUIDITY_FIXTURE: FixtureQueryMapping = {
  sqlHash: computeSqlHash(LIQUIDITY_SQL),
  description: 'Liquidity buffer — contains a negative value (contract violation)',
  result: {
    success: true,
    columns: ['asset_class', 'liquidity_value', 'days_to_maturity', 'is_encumbered'],
    columnTypes: ['string', 'number', 'number', 'boolean'],
    rows: [
      { asset_class: 'Government Bonds', liquidity_value: 500_000_000, days_to_maturity: 365, is_encumbered: false },
      { asset_class: 'Corporate Bonds', liquidity_value: -50_000_000, days_to_maturity: 180, is_encumbered: false }, // NEGATIVE
      { asset_class: 'Cash', liquidity_value: 200_000_000, days_to_maturity: 0, is_encumbered: false },
    ],
  },
};

// ─── Scenario 3: Reconciliation Variance — Sum Mismatch (FAIL) ───────────────

export const RECON_SQL = `SELECT
  account_id,
  book_value,
  market_value,
  variance
FROM risk.position_reconciliation
WHERE reporting_date = '2026-03-28'`;

export const RECON_INTENT: FinancialQueryIntent = {
  queryType: 'reconciliation_variance',
  description: 'Position reconciliation report: book vs market values with variance.',
  allowedSchemas: ['risk'],
  forbiddenSchemas: ['pii'],
  expectedColumns: [
    { name: 'account_id', type: 'string', required: true, notNull: true },
    { name: 'book_value', type: 'number', required: true, notNull: true },
    { name: 'market_value', type: 'number', required: true, notNull: true },
    { name: 'variance', type: 'number', required: true },
  ],
  businessConstraints: [
    { description: 'Result must not be empty', column: '*', check: 'not_empty' },
    { description: 'Variances should sum to zero for balanced reconciliation', column: 'variance', check: 'sum_equals', value: 0 },
    { description: 'At least 2 accounts', column: '*', check: 'row_count_min', value: 2 },
  ],
};

// Variance does NOT sum to zero (reconciliation mismatch)
export const RECON_FIXTURE: FixtureQueryMapping = {
  sqlHash: computeSqlHash(RECON_SQL),
  description: 'Position reconciliation — variance sum ≠ 0 (recon mismatch)',
  result: {
    success: true,
    columns: ['account_id', 'book_value', 'market_value', 'variance'],
    columnTypes: ['string', 'number', 'number', 'number'],
    rows: [
      { account_id: 'ACC-001', book_value: 1_000_000, market_value: 1_010_000, variance: 10_000 },
      { account_id: 'ACC-002', book_value: 500_000, market_value: 495_000, variance: -5_000 },
      { account_id: 'ACC-003', book_value: 750_000, market_value: 760_000, variance: 10_000 },
    ],
  },
};

// ─── SQL Governance Edge Cases ───────────────────────────────────────────────

/** Unsafe SQL: contains DELETE (write operation). */
export const UNSAFE_SQL_WRITE = `DELETE FROM risk.counterparty_exposures WHERE reporting_date < '2025-01-01'`;

/** Unsafe SQL: accesses forbidden schema. */
export const UNSAFE_SQL_SCHEMA = `SELECT name, ssn FROM pii.customer_data WHERE active = true`;

/** Unsafe SQL: injection pattern. */
export const UNSAFE_SQL_INJECTION = `SELECT * FROM risk.positions WHERE account_id = '' OR '1'='1'`;

/** Unsafe SQL: stacked query with DROP. */
export const UNSAFE_SQL_STACKED = `SELECT * FROM risk.positions; DROP TABLE risk.positions`;

// ─── Scenario 4: High-Materiality Counterparty (requires approval) ───────────

export const HIGH_MAT_INTENT: FinancialQueryIntent = {
  ...COUNTERPARTY_INTENT,
  queryType: 'counterparty_exposure',
  description: 'High-materiality counterparty exposure review requiring risk officer approval.',
  materialityTier: 'high',
};

// ─── Scenario 5: Concentration Limit Breach (row-count anomaly) ──────────────

export const CONCENTRATION_SQL = `SELECT
  counterparty_name,
  exposure_usd,
  concentration_pct
FROM risk.concentration_limits
WHERE reporting_date = '2026-03-28'
  AND concentration_pct > 10.0`;

export const CONCENTRATION_INTENT: FinancialQueryIntent = {
  queryType: 'concentration_limit',
  description: 'Identify counterparties exceeding the 10% concentration limit.',
  allowedSchemas: ['risk'],
  forbiddenSchemas: ['pii', 'hr'],
  expectedColumns: [
    { name: 'counterparty_name', type: 'string', required: true, notNull: true },
    { name: 'exposure_usd', type: 'number', required: true, notNull: true },
    { name: 'concentration_pct', type: 'number', required: true, notNull: true },
  ],
  businessConstraints: [
    { description: 'Result must not be empty (we expect breaches)', column: '*', check: 'not_empty' },
    { description: 'Concentration must be above 10%', column: 'concentration_pct', check: 'min', value: 10.0 },
    { description: 'Max 10 breaching counterparties expected', column: '*', check: 'row_count_max', value: 10 },
  ],
  materialityTier: 'high',
};

export const CONCENTRATION_FIXTURE: FixtureQueryMapping = {
  sqlHash: computeSqlHash(CONCENTRATION_SQL),
  description: 'Concentration limit breach — 2 counterparties above 10%',
  result: {
    success: true,
    columns: ['counterparty_name', 'exposure_usd', 'concentration_pct'],
    columnTypes: ['string', 'number', 'number'],
    rows: [
      { counterparty_name: 'Bank of Nova Scotia', exposure_usd: 250_000_000, concentration_pct: 15.2 },
      { counterparty_name: 'Deutsche Bank AG', exposure_usd: 200_000_000, concentration_pct: 12.1 },
    ],
  },
};

// ─── Scenario 6: Report with wrong provenance (mismatch) ─────────────────────

export const WRONG_PROVENANCE_REPORT: GeneratedReport = {
  ...COUNTERPARTY_REPORT,
  sections: COUNTERPARTY_REPORT.sections.map((s) =>
    s.id === 'total_exposure'
      ? { ...s, numericValues: { exposure_usd: 999_000_000 } }  // wrong number
      : s,
  ),
};

// ─── Scenario 7: Missing required column in result ───────────────────────────

export const MISSING_COL_SQL = `SELECT
  counterparty_name,
  exposure_usd
FROM risk.counterparty_exposures
WHERE reporting_date = '2026-03-28'`;

export const MISSING_COL_FIXTURE: FixtureQueryMapping = {
  sqlHash: computeSqlHash(MISSING_COL_SQL),
  description: 'Missing credit_rating column',
  result: {
    success: true,
    columns: ['counterparty_name', 'exposure_usd'],
    columnTypes: ['string', 'number'],
    rows: [
      { counterparty_name: 'Bank of Nova Scotia', exposure_usd: 250_000_000 },
    ],
  },
};

// ─── Scenario 8: Control total breach (otherwise valid) ──────────────────────

export const CONTROL_TOTAL_INTENT: FinancialQueryIntent = {
  ...COUNTERPARTY_INTENT,
  description: 'Counterparty exposure with mandatory control total check.',
  controlTotals: [
    { description: 'Total exposure must equal 900M (control total)', column: 'exposure_usd', expectedTotal: 900_000_000, tolerance: 0 },
  ],
  // Also add a review trigger for control total breach
  reviewTriggers: [
    { id: 'ct_breach', description: 'Control total mismatch', condition: 'control_total_breach' },
  ],
};

// ─── Scenario 9: Approved after review-policy escalation ─────────────────────

export const POLICY_ESCALATED_INTENT: FinancialQueryIntent = {
  ...COUNTERPARTY_INTENT,
  description: 'Medium-materiality but with reconciliation failure trigger.',
  materialityTier: 'medium',
  reviewTriggers: [
    { id: 'recon_fail', description: 'Reconciliation failure triggers review', condition: 'reconciliation_failure' },
  ],
};

// ─── Challenge: Exact balance (passes — sum equals expected) ─────────────────

export const EXACT_BALANCE_INTENT: FinancialQueryIntent = {
  ...COUNTERPARTY_INTENT,
  reconciliationClass: 'exact_balance',
};

// ─── Challenge: Tolerance balance (within tolerance — 850M ± 100M) ───────────

export const TOLERANCE_INTENT: FinancialQueryIntent = {
  ...COUNTERPARTY_INTENT,
  reconciliationClass: 'tolerance_balance',
  controlTotals: [
    { description: 'Approx total within 100M', column: 'exposure_usd', expectedTotal: 900_000_000, tolerance: 100_000_000 },
  ],
};

// ─── Challenge: Above tolerance (850M vs 900M, tolerance 10M — FAIL) ─────────

export const ABOVE_TOLERANCE_INTENT: FinancialQueryIntent = {
  ...COUNTERPARTY_INTENT,
  reconciliationClass: 'exact_balance',
  controlTotals: [
    { description: 'Strict total', column: 'exposure_usd', expectedTotal: 900_000_000, tolerance: 10_000_000 },
  ],
};
