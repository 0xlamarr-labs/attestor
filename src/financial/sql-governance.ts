/**
 * SQL Governance v2 — Pre-execution deterministic gates with structured analysis.
 *
 * Validates LLM-generated SQL before it touches any database.
 * No dependencies beyond Node.js built-ins.
 *
 * v2 improvements over v1:
 * - Structured table reference extraction (schema, table, context)
 * - Explicit referenced-tables list in evidence
 * - Schema allowlist uses extracted references, not substring matching
 * - Forbidden schemas use extracted references, not substring matching
 * - Clearer false-positive/false-negative behavior
 *
 * Gates:
 * 1. Read-only enforcement (no INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/CREATE)
 * 2. Forbidden clause detection (no GRANT/REVOKE/EXEC/CALL/INTO)
 * 3. Schema allowlist enforcement (from structured table references)
 * 4. Forbidden schema blocking (from structured table references)
 * 5. SQL injection pattern detection
 * 6. Required structure validation (must be SELECT/WITH)
 *
 * Architecture inspiration: ThalesGroup/sql-data-guard, DoorDash zero-data validation.
 */

import { createHash } from 'node:crypto';
import type { SqlGovernanceResult, SqlGateResult, SqlTableReference, FinancialQueryIntent } from './types.js';

/** Normalize SQL for analysis: collapse whitespace, remove comments, lowercase. */
function normalizeSql(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, '')           // remove single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')   // remove block comments
    .replace(/\s+/g, ' ')              // collapse whitespace
    .trim()
    .toLowerCase();
}

/** Truncated SHA-256 hash (16 hex chars). */
function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// ─── Structured Table Extraction ─────────────────────────────────────────────

/**
 * Extract structured table references from normalized SQL.
 * Identifies FROM and JOIN references with schema/table decomposition.
 * This is a bounded heuristic — not a full SQL parser — but produces
 * structured evidence rather than substring matches.
 */
function extractTableReferences(normalized: string): SqlTableReference[] {
  const refs: SqlTableReference[] = [];
  const seen = new Set<string>();

  // FROM references
  const fromPattern = /\bfrom\s+([a-z_][a-z0-9_.]*)/g;
  let match;
  while ((match = fromPattern.exec(normalized)) !== null) {
    const ref = match[1];
    if (!seen.has(ref)) {
      seen.add(ref);
      refs.push(parseTableRef(ref, 'from'));
    }
  }

  // JOIN references
  const joinPattern = /\bjoin\s+([a-z_][a-z0-9_.]*)/g;
  while ((match = joinPattern.exec(normalized)) !== null) {
    const ref = match[1];
    if (!seen.has(ref)) {
      seen.add(ref);
      refs.push(parseTableRef(ref, 'join'));
    }
  }

  return refs;
}

function parseTableRef(ref: string, context: 'from' | 'join' | 'subquery'): SqlTableReference {
  if (ref.includes('.')) {
    const parts = ref.split('.');
    return {
      reference: ref,
      schema: parts[0],
      table: parts.slice(1).join('.'),
      context,
    };
  }
  return { reference: ref, schema: null, table: ref, context };
}

// ─── Gate: Read-Only Enforcement ─────────────────────────────────────────────

const WRITE_KEYWORDS = [
  'insert', 'update', 'delete', 'drop', 'alter', 'truncate',
  'create', 'replace', 'merge', 'upsert',
];

function gateReadOnly(normalized: string): SqlGateResult {
  for (const kw of WRITE_KEYWORDS) {
    const regex = new RegExp(`\\b${kw}\\b`);
    if (regex.test(normalized)) {
      return { gate: 'read_only', passed: false, detail: `Write operation detected: ${kw.toUpperCase()}` };
    }
  }
  return { gate: 'read_only', passed: true, detail: 'No write operations detected' };
}

// ─── Gate: Forbidden Clauses ─────────────────────────────────────────────────

const FORBIDDEN_CLAUSES = [
  'grant', 'revoke', 'exec', 'execute', 'call', 'into outfile',
  'into dumpfile', 'load data', 'load_file', 'pg_sleep', 'waitfor',
  'xp_cmdshell', 'sp_executesql',
];

function gateForbiddenClauses(normalized: string): SqlGateResult {
  for (const clause of FORBIDDEN_CLAUSES) {
    if (normalized.includes(clause)) {
      return { gate: 'forbidden_clauses', passed: false, detail: `Forbidden clause detected: ${clause}` };
    }
  }
  return { gate: 'forbidden_clauses', passed: true, detail: 'No forbidden clauses detected' };
}

// ─── Gate: Schema Allowlist (v2 — uses structured references) ────────────────

function gateSchemaAllowlist(refs: SqlTableReference[], allowedSchemas: string[]): SqlGateResult {
  if (allowedSchemas.length === 0) {
    return { gate: 'schema_allowlist', passed: true, detail: 'No schema allowlist configured (open)' };
  }

  const allowedLower = allowedSchemas.map((s) => s.toLowerCase());
  const schemaQualified = refs.filter((r) => r.schema !== null);

  for (const ref of schemaQualified) {
    if (!allowedLower.includes(ref.schema!)) {
      return {
        gate: 'schema_allowlist',
        passed: false,
        detail: `Table "${ref.reference}" uses schema "${ref.schema}" which is not in allowed schemas: [${allowedSchemas.join(', ')}]`,
      };
    }
  }

  return {
    gate: 'schema_allowlist',
    passed: true,
    detail: `${schemaQualified.length} schema-qualified references checked against allowlist [${allowedSchemas.join(', ')}]`,
  };
}

// ─── Gate: Forbidden Schema Blocking (v2 — uses structured references) ───────

function gateForbiddenSchemas(refs: SqlTableReference[], forbiddenSchemas: string[]): SqlGateResult {
  if (forbiddenSchemas.length === 0) {
    return { gate: 'forbidden_schemas', passed: true, detail: 'No forbidden schemas configured' };
  }

  const forbiddenLower = forbiddenSchemas.map((s) => s.toLowerCase());

  for (const ref of refs) {
    // Check schema-qualified references
    if (ref.schema && forbiddenLower.includes(ref.schema)) {
      return {
        gate: 'forbidden_schemas',
        passed: false,
        detail: `Table "${ref.reference}" references forbidden schema "${ref.schema}"`,
      };
    }
    // Also check unqualified table names against forbidden list (table might be a schema name)
    if (!ref.schema && forbiddenLower.includes(ref.table)) {
      return {
        gate: 'forbidden_schemas',
        passed: false,
        detail: `Unqualified reference "${ref.table}" matches a forbidden schema name`,
      };
    }
  }

  return { gate: 'forbidden_schemas', passed: true, detail: `No references to forbidden schemas [${forbiddenSchemas.join(', ')}]` };
}

// ─── Gate: SQL Injection Patterns ────────────────────────────────────────────

const INJECTION_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /;\s*(drop|delete|update|insert|alter|create|truncate)/, description: 'stacked query with write operation' },
  { pattern: /union\s+all\s+select.*from\s+information_schema/, description: 'information_schema probe via UNION' },
  { pattern: /'\s*or\s+'?\d*'?\s*=\s*'?\d*'?/, description: 'classic OR-based injection' },
  { pattern: /'\s*;\s*--/, description: 'comment-terminated injection' },
  { pattern: /\bsleep\s*\(/, description: 'time-based blind injection (SLEEP)' },
  { pattern: /\bbenchmark\s*\(/, description: 'time-based blind injection (BENCHMARK)' },
];

function gateInjectionPatterns(normalized: string): SqlGateResult {
  for (const { pattern, description } of INJECTION_PATTERNS) {
    if (pattern.test(normalized)) {
      return { gate: 'injection_patterns', passed: false, detail: `SQL injection pattern detected: ${description}` };
    }
  }
  return { gate: 'injection_patterns', passed: true, detail: 'No injection patterns detected' };
}

// ─── Gate: Required Structure ────────────────────────────────────────────────

function gateRequiredStructure(normalized: string): SqlGateResult {
  if (!normalized.startsWith('select') && !normalized.startsWith('with')) {
    return { gate: 'required_structure', passed: false, detail: 'Query must start with SELECT or WITH (CTE)' };
  }
  let depth = 0;
  for (const ch of normalized) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth < 0) {
      return { gate: 'required_structure', passed: false, detail: 'Unbalanced parentheses detected' };
    }
  }
  if (depth !== 0) {
    return { gate: 'required_structure', passed: false, detail: 'Unbalanced parentheses detected' };
  }
  return { gate: 'required_structure', passed: true, detail: 'Valid SELECT/WITH structure with balanced parentheses' };
}

// ─── Main Governance Function ────────────────────────────────────────────────

/**
 * Run all SQL governance gates against a candidate SQL string.
 *
 * v2: structured table extraction feeds into schema/forbidden gates.
 * The referencedTables list is included in the evidence for audit review.
 *
 * All gates are deterministic — no LLM calls, no external services.
 */
export function governSql(sql: string, intent: FinancialQueryIntent): SqlGovernanceResult {
  const normalized = normalizeSql(sql);
  const referencedTables = extractTableReferences(normalized);

  const gates: SqlGateResult[] = [
    gateReadOnly(normalized),
    gateForbiddenClauses(normalized),
    gateSchemaAllowlist(referencedTables, intent.allowedSchemas),
    gateForbiddenSchemas(referencedTables, intent.forbiddenSchemas),
    gateInjectionPatterns(normalized),
    gateRequiredStructure(normalized),
  ];

  const allPassed = gates.every((g) => g.passed);

  return {
    result: allPassed ? 'pass' : 'fail',
    gates,
    sqlText: sql,
    sqlHash: hashText(sql),
    referencedTables,
  };
}
