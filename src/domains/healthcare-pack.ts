/**
 * Healthcare Domain Pack — Second domain, demonstrating cross-domain capability.
 *
 * Governance components for healthcare quality measures, clinical data analytics,
 * and population health reporting — where AI-assisted output needs governed
 * acceptance before operational use.
 *
 * This is a minimal first pack proving the domain pack architecture works.
 * It defines clause types, guardrails, and evidence obligations that are
 * structurally identical to the financial pack but domain-specific in semantics.
 */

import type { DomainPack } from './domain-pack.js';

export const healthcareDomainPack: DomainPack = {
  id: 'healthcare',
  version: '1.0.0',
  displayName: 'Healthcare Quality Analytics',
  description: 'Clinical quality measures, population health analytics, and healthcare reporting governance.',

  clauses: [
    {
      id: 'patient_count_consistency',
      type: 'patient_count_consistency',
      description: 'Patient counts in numerator + excluded must equal denominator',
      severity: 'blocking',
      domain: 'healthcare',
    },
    {
      id: 'rate_bound',
      type: 'rate_bound',
      description: 'Calculated clinical rates (readmission, mortality, infection) must fall within clinically plausible ranges',
      severity: 'warning',
      domain: 'healthcare',
    },
    {
      id: 'small_cell_suppression',
      type: 'small_cell_suppression',
      description: 'No output cell may contain fewer than the minimum patient count (default: 11) to prevent re-identification',
      severity: 'blocking',
      domain: 'healthcare',
    },
    {
      id: 'phi_completeness_check',
      type: 'phi_completeness_check',
      description: 'All required PHI fields must be present or properly marked as redacted',
      severity: 'blocking',
      domain: 'healthcare',
    },
    {
      id: 'temporal_consistency',
      type: 'temporal_consistency',
      description: 'Encounter dates, admission/discharge sequences must be logically ordered',
      severity: 'blocking',
      domain: 'healthcare',
    },
  ],

  guardrails: [
    { id: 'phi_exposure_prevention', description: 'Queries must not expose unmasked PHI in output', domain: 'healthcare' },
    { id: 'minimum_cell_size', description: 'Output cells must meet minimum patient count threshold', domain: 'healthcare' },
    { id: 'date_range_bound', description: 'Query date ranges must be bounded and reasonable', domain: 'healthcare' },
    { id: 'schema_allowlist', description: 'Schema references restricted to allowed clinical schemas', domain: 'healthcare' },
  ],

  evidenceObligations: [
    { id: 'data_use_attestation', description: 'Data use agreement must be attested before query execution', required: true, domain: 'healthcare' },
    { id: 'deidentification_proof', description: 'Output must be verified as de-identified per HIPAA Safe Harbor or Expert Determination', required: true, domain: 'healthcare' },
    { id: 'measure_specification', description: 'Clinical measure specification (NQF, CMS eCQM) must be referenced', required: false, domain: 'healthcare' },
    { id: 'audit_trail', description: 'Hash-linked audit trail must be intact', required: true, domain: 'healthcare' },
  ],
};
