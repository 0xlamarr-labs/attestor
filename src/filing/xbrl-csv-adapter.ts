/**
 * xBRL-CSV Filing Adapter — EBA DPM 2.0 Format
 *
 * Generates xBRL-CSV format (OIM-based) as required by the European
 * Banking Authority's DPM 2.0 reporting framework.
 *
 * xBRL-CSV is simpler than XML XBRL:
 * - CSV files for data
 * - JSON metadata descriptor
 * - Versioned taxonomy reference
 *
 * BOUNDARY:
 * - Structure and format generation only
 * - No direct EBA submission API integration
 * - No DPM taxonomy validation (requires EBA validation rules)
 * - Filing-ready package for import into submission tools
 */

import type { FilingAdapter, FilingFormat, DecisionEnvelope, TaxonomyMapping, MappedField, UnmappedField, FilingPackage } from './filing-adapter.js';

// ─── xBRL-CSV Metadata ──────────────────────────────────────────────────────

export interface XbrlCsvMetadata {
  /** DPM taxonomy version. */
  taxonomyVersion: string;
  /** Report template identifier. */
  templateId: string;
  /** Reporting entity identifier. */
  entityId: string;
  /** Reporting period. */
  period: { start: string; end: string };
  /** Currency. */
  currency: string;
  /** Table definitions. */
  tables: XbrlCsvTable[];
}

export interface XbrlCsvTable {
  /** Table code (e.g., C_01.00). */
  tableCode: string;
  /** Table title. */
  title: string;
  /** Column definitions. */
  columns: { name: string; dataType: 'string' | 'number' | 'date' | 'boolean'; dpmConcept: string }[];
  /** CSV data rows. */
  rows: Record<string, unknown>[];
}

// ─── EBA DPM Concept Mapping ────────────────────────────────────────────────

const EBA_DPM_MAPPING: Record<string, { concept: string; label: string; table: string }> = {
  'counterparty_name': { concept: 'eba_met:mi15', label: 'Counterparty name', table: 'C_26.00' },
  'exposure_usd': { concept: 'eba_met:mi135', label: 'Exposure value', table: 'C_26.00' },
  'credit_rating': { concept: 'eba_met:mi12', label: 'Credit quality step', table: 'C_26.00' },
  'sector': { concept: 'eba_dim:SEC', label: 'Sector', table: 'C_26.00' },
  'total_exposure': { concept: 'eba_met:mi200', label: 'Total exposure amount', table: 'C_04.00' },
  'decision': { concept: 'attestor:governance_decision', label: 'Governance decision', table: 'attestor' },
  'proof_mode': { concept: 'attestor:proof_mode', label: 'Proof mode', table: 'attestor' },
};

// ─── Adapter ────────────────────────────────────────────────────────────────

export const xbrlCsvEbaAdapter: FilingAdapter = {
  id: 'xbrl-csv-eba-dpm2',
  format: 'xbrl-csv' as FilingFormat,
  taxonomyVersion: 'EBA DPM 2.0 (Framework 4.2)',
  description: 'Maps governed financial decision output to EBA DPM 2.0 xBRL-CSV format.',

  mapToTaxonomy(envelope: DecisionEnvelope): TaxonomyMapping {
    const mapped: MappedField[] = [];
    const unmapped: UnmappedField[] = [];

    for (const [fieldName, field] of Object.entries(envelope.fields)) {
      const mapping = EBA_DPM_MAPPING[fieldName];
      if (mapping) {
        mapped.push({
          sourceField: fieldName,
          taxonomyConcept: mapping.concept,
          conceptLabel: mapping.label,
          value: field.value,
          unit: field.unit,
        });
      } else {
        unmapped.push({
          sourceField: fieldName,
          reason: `No EBA DPM 2.0 mapping for '${fieldName}'`,
        });
      }
    }

    const totalFields = mapped.length + unmapped.length;
    return {
      adapterId: this.id,
      format: this.format,
      taxonomyVersion: this.taxonomyVersion,
      mapped,
      unmapped,
      coveragePercent: totalFields > 0 ? Math.round((mapped.length / totalFields) * 100) : 0,
    };
  },

  generatePackage(mapping: TaxonomyMapping): FilingPackage {
    // Generate xBRL-CSV structure
    const csvContent: Record<string, unknown> = {
      format: 'xbrl-csv',
      taxonomyVersion: mapping.taxonomyVersion,
      metadata: {
        reportType: 'COREP',
        templateId: 'C_26.00',
        currency: 'USD',
      },
      tables: [{
        tableCode: 'C_26.00',
        title: 'Credit risk: Large exposures',
        columns: mapping.mapped.map(m => ({
          name: m.sourceField,
          dpmConcept: m.taxonomyConcept,
          value: m.value,
          unit: m.unit ?? null,
        })),
      }],
      unmapped: mapping.unmapped,
    };

    return {
      adapterId: mapping.adapterId,
      format: mapping.format,
      generatedAt: new Date().toISOString(),
      content: csvContent,
      validation: {
        valid: mapping.unmapped.length === 0,
        errors: [],
        warnings: mapping.unmapped.length > 0 ? [`${mapping.unmapped.length} unmapped fields`] : [],
        coveragePercent: mapping.coveragePercent,
      },
      evidenceLink: { runId: '', certificateId: null, evidenceChainTerminal: '' },
    };
  },
};
