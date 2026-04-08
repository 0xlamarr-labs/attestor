import {
  CMS122_DIABETES_A1C,
  CMS130_COLORECTAL_SCREENING,
  CMS165_BLOOD_PRESSURE,
  evaluateMeasure,
  type MeasureEvaluation,
  type QualityMeasure,
} from '../domains/healthcare-measures.js';
import {
  collectVsacLayer7Targets,
  isVsacConfigured,
  validateVsacLayer7ForMeasures,
  type VsacApiConfig,
  type VsacLayer7Result,
  type VsacLayer7Target,
} from './vsac-api-client.js';
import {
  isCypressConfigured,
  validateViaCypressApi,
  type CypressApiConfig,
  type CypressApiResult,
} from './cypress-api-client.js';
import { validateCypressLayers, type CypressValidationResult } from './qrda3-cypress-validators.js';
import { generateQrda3 } from './qrda3-generator.js';

const CANONICAL_CLOSEOUT_MEASURES: Array<{ measure: QualityMeasure; counts: Record<string, number> }> = [
  {
    measure: CMS165_BLOOD_PRESSURE,
    counts: { initial_population: 1200, denominator: 1100, denominator_exclusion: 100, numerator: 825 },
  },
  {
    measure: CMS122_DIABETES_A1C,
    counts: { initial_population: 800, denominator: 750, denominator_exclusion: 50, numerator: 60 },
  },
  {
    measure: CMS130_COLORECTAL_SCREENING,
    counts: { initial_population: 1000, denominator: 950, denominator_exclusion: 50, numerator: 760 },
  },
];

export interface HealthcareLiveCloseoutBundle {
  reportingYear: string;
  performerName: string;
  measures: QualityMeasure[];
  evaluations: MeasureEvaluation[];
  qrdaXml: string;
  cypressEquivalent: CypressValidationResult;
  vsacTargets: VsacLayer7Target[];
}

export interface HealthcareLiveCloseoutResult {
  closureAchieved: boolean;
  blockers: string[];
  credentials: {
    cypressConfigured: boolean;
    vsacConfigured: boolean;
    missingEnvVars: string[];
  };
  localPreflight: {
    qrdaXmlChars: number;
    cypressEquivalentValid: boolean;
    cypressEquivalentErrors: number;
    cypressEquivalentWarnings: number;
    curatedVsacTargets: number;
  };
  vsac: VsacLayer7Result | null;
  oncCypress: CypressApiResult | null;
}

export function buildHealthcareLiveCloseoutBundle(
  options: { reportingYear?: string; performerName?: string } = {},
): HealthcareLiveCloseoutBundle {
  const reportingYear = options.reportingYear ?? '2026';
  const performerName = options.performerName ?? 'Attestor Healthcare Closeout';
  const evaluations = CANONICAL_CLOSEOUT_MEASURES.map(({ measure, counts }) => evaluateMeasure(measure, counts));
  const measures = CANONICAL_CLOSEOUT_MEASURES.map(({ measure }) => measure);
  const qrdaXml = generateQrda3(evaluations, { reportingYear, performerName });
  const cypressEquivalent = validateCypressLayers(qrdaXml);
  const vsacTargets = collectVsacLayer7Targets(measures);

  return {
    reportingYear,
    performerName,
    measures,
    evaluations,
    qrdaXml,
    cypressEquivalent,
    vsacTargets,
  };
}

function missingCredentialNames(cypressConfigured: boolean, vsacConfigured: boolean): string[] {
  const missing: string[] = [];
  if (!cypressConfigured) {
    missing.push('CYPRESS_EMAIL or CYPRESS_UMLS_USER');
    missing.push('CYPRESS_PASSWORD or CYPRESS_UMLS_PASS');
  }
  if (!vsacConfigured) {
    missing.push('VSAC_UMLS_API_KEY or UMLS_API_KEY');
  }
  return missing;
}

export async function runHealthcareLiveCloseout(
  config: { cypress?: CypressApiConfig; vsac?: VsacApiConfig; reportingYear?: string; performerName?: string } = {},
): Promise<HealthcareLiveCloseoutResult> {
  const bundle = buildHealthcareLiveCloseoutBundle({
    reportingYear: config.reportingYear,
    performerName: config.performerName,
  });
  const cypressConfigured = isCypressConfigured(config.cypress);
  const vsacConfigured = isVsacConfigured(config.vsac);
  const blockers: string[] = [];

  if (!bundle.cypressEquivalent.valid) {
    blockers.push(`Local Cypress-equivalent preflight failed with ${bundle.cypressEquivalent.totalErrors} errors.`);
  }
  if (!cypressConfigured) {
    blockers.push('Missing ONC Cypress credentials.');
  }
  if (!vsacConfigured) {
    blockers.push('Missing VSAC UMLS API key.');
  }

  let vsac: VsacLayer7Result | null = null;
  if (vsacConfigured) {
    vsac = await validateVsacLayer7ForMeasures(bundle.measures, config.vsac);
    if (!vsac.valid) {
      blockers.push(`VSAC Layer 7 expansion failed for ${vsac.totalTargets - vsac.expandedTargets}/${vsac.totalTargets} targets.`);
    }
  }

  let oncCypress: CypressApiResult | null = null;
  if (cypressConfigured) {
    oncCypress = await validateViaCypressApi(bundle.qrdaXml, {
      ...config.cypress,
      year: config.cypress?.year ?? '2026',
    });
    if (!oncCypress.valid) {
      blockers.push(`ONC Cypress returned ${oncCypress.errorCount} execution errors (HTTP ${oncCypress.httpStatus}).`);
    }
  }

  return {
    closureAchieved: blockers.length === 0,
    blockers,
    credentials: {
      cypressConfigured,
      vsacConfigured,
      missingEnvVars: missingCredentialNames(cypressConfigured, vsacConfigured),
    },
    localPreflight: {
      qrdaXmlChars: bundle.qrdaXml.length,
      cypressEquivalentValid: bundle.cypressEquivalent.valid,
      cypressEquivalentErrors: bundle.cypressEquivalent.totalErrors,
      cypressEquivalentWarnings: bundle.cypressEquivalent.totalWarnings,
      curatedVsacTargets: bundle.vsacTargets.length,
    },
    vsac,
    oncCypress,
  };
}
