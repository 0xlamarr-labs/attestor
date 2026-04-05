/**
 * Policy & Entitlement Engine v1 — Least-privilege data access governance.
 *
 * Evaluates every table/schema reference in the SQL against explicit
 * allow/deny policy. Produces a structured verdict per reference.
 *
 * This is NOT a generic RBAC or OPA engine.
 * It is a bounded, deterministic, bank-grade entitlement check for SQL queries.
 *
 * Principles:
 * - Explicit allow > implicit deny (if allowlist is configured)
 * - Forbidden schemas are always denied regardless of allowlist
 * - Unqualified references are flagged as restricted (ambiguous entitlement)
 * - Every decision is explained and auditable
 */

import type { SqlTableReference, FinancialQueryIntent, PolicyResult, PolicyDecision, PolicyVerdict } from './types.js';

/**
 * Evaluate data access policy for a set of table references.
 */
export function evaluatePolicy(
  references: SqlTableReference[],
  intent: FinancialQueryIntent,
): PolicyResult {
  const decisions: PolicyDecision[] = [];
  const allowedLower = intent.allowedSchemas.map((s) => s.toLowerCase());
  const forbiddenLower = intent.forbiddenSchemas.map((s) => s.toLowerCase());
  const hasAllowlist = allowedLower.length > 0;

  for (const ref of references) {
    let verdict: PolicyVerdict;
    let reason: string;

    if (ref.schema) {
      const schemaLower = ref.schema.toLowerCase();

      // Forbidden always wins
      if (forbiddenLower.includes(schemaLower)) {
        verdict = 'denied';
        reason = `Schema "${ref.schema}" is in the forbidden list. Access to sensitive domains is prohibited.`;
      }
      // Allowlist check
      else if (hasAllowlist && !allowedLower.includes(schemaLower)) {
        verdict = 'denied';
        reason = `Schema "${ref.schema}" is not in the allowed schemas [${intent.allowedSchemas.join(', ')}]. Least-privilege policy requires explicit authorization.`;
      }
      // Allowed
      else {
        verdict = 'allowed';
        reason = hasAllowlist
          ? `Schema "${ref.schema}" is explicitly allowed.`
          : `No allowlist configured; schema "${ref.schema}" is not forbidden.`;
      }
    } else {
      // Unqualified reference — ambiguous entitlement
      if (forbiddenLower.includes(ref.table.toLowerCase())) {
        verdict = 'denied';
        reason = `Unqualified reference "${ref.table}" matches a forbidden schema/table name.`;
      } else {
        verdict = 'restricted';
        reason = `Unqualified reference "${ref.table}" — cannot verify schema entitlement. Consider using schema-qualified references for least-privilege compliance.`;
      }
    }

    decisions.push({
      reference: ref.reference,
      schema: ref.schema,
      table: ref.table,
      verdict,
      reason,
    });
  }

  const denied = decisions.filter((d) => d.verdict === 'denied');
  const restricted = decisions.filter((d) => d.verdict === 'restricted');
  const leastPrivilegePreserved = denied.length === 0 && restricted.length === 0;

  return {
    result: denied.length > 0 ? 'fail' : 'pass',
    decisions,
    leastPrivilegePreserved,
    summary: denied.length > 0
      ? `Policy DENIED: ${denied.map((d) => d.reference).join(', ')}. ${denied[0].reason}`
      : restricted.length > 0
        ? `Policy PASSED with restrictions: ${restricted.map((d) => d.reference).join(', ')} have ambiguous entitlement.`
        : `Policy PASSED: all ${decisions.length} references within authorized boundaries.`,
  };
}
