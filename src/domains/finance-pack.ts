/**
 * Finance Domain Pack — The reference implementation domain.
 *
 * Registers the financial analytics governance components that are
 * already implemented in the repository as a formal domain pack.
 */

import type { DomainPack } from './domain-pack.js';

export const financeDomainPack: DomainPack = {
  id: 'finance',
  version: '1.0.0',
  displayName: 'Financial Analytics',
  description: 'Bank-grade internal financial reporting, treasury, risk, reconciliation, and regulatory-reporting analytics.',

  clauses: [
    { id: 'balance_identity', type: 'balance_identity', description: 'Net = gross_long - gross_short (additive identity must hold)', severity: 'blocking', domain: 'finance' },
    { id: 'control_total', type: 'control_total', description: 'Total must equal sum of parts (reconciliation)', severity: 'blocking', domain: 'finance' },
    { id: 'ratio_bound', type: 'ratio_bound', description: 'Ratio must be within acceptable range', severity: 'warning', domain: 'finance' },
    { id: 'sign_constraint', type: 'sign_constraint', description: 'Column values must satisfy sign rules (non-negative, positive)', severity: 'blocking', domain: 'finance' },
    { id: 'completeness_check', type: 'completeness_check', description: 'Required columns must have no nulls', severity: 'blocking', domain: 'finance' },
  ],

  guardrails: [
    { id: 'sql_read_only', description: 'Only SELECT/WITH queries allowed', domain: 'finance' },
    { id: 'row_limit', description: 'Maximum result rows enforced', domain: 'finance' },
    { id: 'join_depth', description: 'Maximum join depth enforced', domain: 'finance' },
    { id: 'schema_allowlist', description: 'Schema references restricted to allowed schemas', domain: 'finance' },
    { id: 'cost_limit', description: 'Query cost bounded by guardrails', domain: 'finance' },
  ],

  evidenceObligations: [
    { id: 'sql_governance', description: 'SQL governance gates must pass', required: true, domain: 'finance' },
    { id: 'data_contracts', description: 'Data contracts must be evaluated', required: true, domain: 'finance' },
    { id: 'policy_check', description: 'Policy and entitlement checks must pass', required: true, domain: 'finance' },
    { id: 'audit_trail', description: 'Hash-linked audit trail must be intact', required: true, domain: 'finance' },
    { id: 'filing_readiness', description: 'Filing readiness must be assessed', required: false, domain: 'finance' },
  ],
};
