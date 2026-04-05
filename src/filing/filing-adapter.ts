/**
 * Attestor Filing Adapter Interface
 *
 * Defines the contract for regulatory filing export adapters.
 * These adapters bridge governed analytics output to regulatory filing formats.
 *
 * DESIGN:
 * - Filing adapters are separate from the governance engine
 * - They consume governed decision envelopes (certificates, evidence)
 * - They produce filing-ready structured output in regulatory formats
 * - They do NOT submit to regulators — only prepare the filing package
 *
 * SUPPORTED FORMAT TARGETS (future):
 * - XBRL / iXBRL (SEC, ESEF, EBA)
 * - ISO 20022 (payments reporting)
 * - SDMX (statistical data exchange)
 * - CCAR/DFAST templates (Fed stress testing)
 *
 * BOUNDARY:
 * - Types and interfaces only in this first slice
 * - No actual XBRL generation (requires Python tooling: xBRL-Forge, Arelle)
 * - No regulatory API integration
 * - No taxonomy authoring
 */

// ─── Filing Adapter Interface ───────────────────────────────────────────────

export interface FilingAdapter {
  /** Adapter identifier (e.g., 'xbrl-us-gaap', 'iso20022-pain'). */
  readonly id: string;
  /** Target regulatory format. */
  readonly format: FilingFormat;
  /** Target taxonomy or specification version. */
  readonly taxonomyVersion: string;
  /** Human-readable description. */
  readonly description: string;

  /** Map governed decision fields to regulatory taxonomy concepts. */
  mapToTaxonomy(envelope: DecisionEnvelope): TaxonomyMapping;

  /** Generate a filing-ready export package. */
  generatePackage(mapping: TaxonomyMapping): FilingPackage;
}

export type FilingFormat = 'xbrl' | 'ixbrl' | 'xbrl-csv' | 'iso20022' | 'sdmx' | 'custom';

// ─── Decision Envelope ──────────────────────────────────────────────────────

/** The governed decision output that filing adapters consume. */
export interface DecisionEnvelope {
  runId: string;
  decision: string;
  certificateId: string | null;
  evidenceChainTerminal: string;
  /** Structured decision fields to map. */
  fields: Record<string, DecisionField>;
  /** Domain of the governed run. */
  domain: string;
}

export interface DecisionField {
  name: string;
  value: string | number | boolean | null;
  /** Field path in the Attestor report structure. */
  sourcePath: string;
  /** Data type for taxonomy mapping. */
  dataType: 'string' | 'number' | 'boolean' | 'date' | 'monetary';
  /** Unit (e.g., 'USD', 'percent', 'count'). */
  unit?: string;
}

// ─── Taxonomy Mapping ───────────────────────────────────────────────────────

export interface TaxonomyMapping {
  adapterId: string;
  format: FilingFormat;
  taxonomyVersion: string;
  /** Successfully mapped fields. */
  mapped: MappedField[];
  /** Fields that could not be mapped (flagged for human review). */
  unmapped: UnmappedField[];
  /** Mapping coverage as a percentage. */
  coveragePercent: number;
}

export interface MappedField {
  /** Attestor field name. */
  sourceField: string;
  /** Taxonomy concept identifier (e.g., XBRL element ID). */
  taxonomyConcept: string;
  /** Taxonomy concept label. */
  conceptLabel: string;
  value: string | number | boolean | null;
  unit?: string;
}

export interface UnmappedField {
  sourceField: string;
  reason: string;
  /** Suggested taxonomy concept (if any). */
  suggestion?: string;
}

// ─── Filing Package ─────────────────────────────────────────────────────────

export interface FilingPackage {
  adapterId: string;
  format: FilingFormat;
  generatedAt: string;
  /** Filing-ready content (JSON structure, ready for format-specific tooling). */
  content: Record<string, unknown>;
  /** Validation results. */
  validation: FilingValidation;
  /** Link back to Attestor evidence. */
  evidenceLink: {
    runId: string;
    certificateId: string | null;
    evidenceChainTerminal: string;
  };
}

export interface FilingValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  coveragePercent: number;
}

// ─── Filing Adapter Registry ────────────────────────────────────────────────

export class FilingAdapterRegistry {
  private adapters = new Map<string, FilingAdapter>();

  register(adapter: FilingAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Filing adapter "${adapter.id}" already registered`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): FilingAdapter | undefined {
    return this.adapters.get(id);
  }

  list(): FilingAdapter[] {
    return [...this.adapters.values()];
  }

  listByFormat(format: FilingFormat): FilingAdapter[] {
    return this.list().filter(a => a.format === format);
  }
}

export const filingRegistry = new FilingAdapterRegistry();
