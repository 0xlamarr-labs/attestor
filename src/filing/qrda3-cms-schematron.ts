/**
 * CMS QRDA III Schematron Validation — Real CMS 2026 .sch Rules
 *
 * Validates QRDA Category III XML against the OFFICIAL CMS 2026
 * Schematron rules (2026_CMS_QRDA_Category_III-v1.0.sch) using
 * the cda-schematron-validator engine.
 *
 * ARCHITECTURE:
 * - Vendored CMS 2026 .sch file from esacinc/qrda GitHub mirror
 * - cda-schematron-validator (ISO Schematron engine for CDA, XPath 1.0)
 * - Rules are the real CMS IG conformance rules, not custom assertions
 *
 * BOUNDARY:
 * - Official CMS 2026 QRDA III Schematron rules (1311 lines, XPath 1.0)
 * - cda-schematron-validator engine (XPath 1.0, no XSLT2 features)
 * - Not ONC Cypress (which adds additional program-level validation)
 * - Some CMS assertions may require XPath 2.0 — those are skipped by the engine
 *
 * SCOPE: 'cms_schematron_2026' — real CMS .sch file execution
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CmsSchematronResult {
  /** True when zero error-severity assertion failures */
  valid: boolean;
  errors: CmsSchematronAssertion[];
  warnings: CmsSchematronAssertion[];
  errorCount: number;
  warningCount: number;
  /** Real CMS 2026 .sch file execution via cda-schematron-validator */
  scope: 'cms_schematron_2026';
  /** Path to the vendored .sch file */
  schematronFile: string;
}

export interface CmsSchematronAssertion {
  description: string;
  test: string;
  context?: string;
}

/**
 * Validate QRDA III XML against the official CMS 2026 Schematron rules.
 *
 * Loads the vendored .sch file from vendor/schematron/2026-CMS-QRDA-III/
 * and runs it through cda-schematron-validator.
 */
export async function validateCmsSchematron(xml: string): Promise<CmsSchematronResult> {
  // Locate vendored .sch file relative to project root
  const schPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '..', '..', 'vendor', 'schematron', '2026-CMS-QRDA-III',
    '2026_CMS_QRDA_Category_III-v1.0.sch',
  );

  let schContent: string;
  try {
    schContent = readFileSync(schPath, 'utf8');
  } catch {
    return {
      valid: false,
      errors: [{ description: `CMS Schematron file not found at ${schPath}`, test: 'file_exists' }],
      warnings: [],
      errorCount: 1, warningCount: 0,
      scope: 'cms_schematron_2026',
      schematronFile: schPath,
    };
  }

  // Run validation (cda-schematron-validator is CJS — use createRequire for ESM compat)
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const validator = require('cda-schematron-validator');
  const result = validator.validate(xml, schContent);

  const errors: CmsSchematronAssertion[] = (result.errors ?? []).map((e: any) => ({
    description: e.description ?? e.message ?? '',
    test: e.test ?? '',
    context: e.context,
  }));

  const warnings: CmsSchematronAssertion[] = (result.warnings ?? []).map((w: any) => ({
    description: w.description ?? w.message ?? '',
    test: w.test ?? '',
    context: w.context,
  }));

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    errorCount: errors.length,
    warningCount: warnings.length,
    scope: 'cms_schematron_2026',
    schematronFile: schPath,
  };
}
