/**
 * FHIR R4 MeasureReport Validator
 *
 * Validates MeasureReport JSON against the FHIR R4 StructureDefinition
 * using Zod schemas from @solarahealth/fhir-r4.
 *
 * BOUNDARY:
 * - Structural JSON Schema validation (type correctness, required fields)
 * - Does NOT validate terminology bindings (ValueSet membership)
 * - Does NOT validate FHIRPath invariants
 * - Does NOT validate cross-resource references
 * - For full FHIR conformance, use a FHIR server's $validate operation
 *
 * SCOPE: 'fhir_r4_schema' — structural schema validation, not full conformance
 */

import type { FhirMeasureReport } from './healthcare-measures.js';

export interface FhirValidationResult {
  valid: boolean;
  resourceType: string;
  errors: { path: string; message: string }[];
  /** Structural schema validation only, not full FHIR conformance */
  scope: 'fhir_r4_schema';
}

/**
 * Validate a MeasureReport against FHIR R4 structural schema.
 *
 * Uses Zod-based validation from @solarahealth/fhir-r4 when available,
 * falls back to manual structural checks if import fails.
 */
export async function validateFhirMeasureReport(report: FhirMeasureReport): Promise<FhirValidationResult> {
  const errors: FhirValidationResult['errors'] = [];

  // Attempt Zod-based FHIR R4 schema validation
  try {
    const fhirR4 = await import('@solarahealth/fhir-r4');
    const MeasureReportSchema = (fhirR4 as any).MeasureReportSchema
      ?? (fhirR4 as any).default?.MeasureReportSchema;

    if (MeasureReportSchema) {
      const result = MeasureReportSchema.safeParse(report);
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push({
            path: issue.path.join('.'),
            message: issue.message,
          });
        }
      }
      return { valid: errors.length === 0, resourceType: 'MeasureReport', errors, scope: 'fhir_r4_schema' };
    }
  } catch {
    // Package available but schema not found — fall through to manual checks
  }

  // Fallback: manual structural checks (package unavailable or schema not found)
  if (report.resourceType !== 'MeasureReport') {
    errors.push({ path: 'resourceType', message: `Expected 'MeasureReport', got '${report.resourceType}'` });
  }
  if (report.type !== 'summary') {
    errors.push({ path: 'type', message: `Expected 'summary', got '${report.type}'` });
  }
  if (!report.measure || typeof report.measure !== 'string') {
    errors.push({ path: 'measure', message: 'measure URL is required' });
  }
  if (!report.period?.start || !report.period?.end) {
    errors.push({ path: 'period', message: 'period.start and period.end are required' });
  }
  if (!Array.isArray(report.group) || report.group.length === 0) {
    errors.push({ path: 'group', message: 'At least one group is required' });
  } else {
    for (let gi = 0; gi < report.group.length; gi++) {
      const group = report.group[gi];
      if (!Array.isArray(group.population) || group.population.length === 0) {
        errors.push({ path: `group[${gi}].population`, message: 'At least one population is required' });
      } else {
        for (let pi = 0; pi < group.population.length; pi++) {
          const pop = group.population[pi];
          if (!pop.code || typeof pop.code !== 'string') {
            errors.push({ path: `group[${gi}].population[${pi}].code`, message: 'Population code is required' });
          }
          if (typeof pop.count !== 'number') {
            errors.push({ path: `group[${gi}].population[${pi}].count`, message: 'Population count must be a number' });
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, resourceType: 'MeasureReport', errors, scope: 'fhir_r4_schema' };
}
