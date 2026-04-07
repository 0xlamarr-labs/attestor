/**
 * VSAC FHIR API Client - live Layer 7 value set expansion for the Attestor healthcare demo.
 *
 * Official NLM VSAC FHIR docs:
 * - Base URI: https://cts.nlm.nih.gov/fhir/
 * - Auth: Basic Auth with username "apikey" and password = UMLS API key
 * - ValueSet expansions: GET /ValueSet/{oid}/$expand?manifest=...
 *
 * BOUNDARY:
 * - Validates a curated set of value sets for the current CMS165/CMS122/CMS130 demo slice
 * - Verifies that the official VSAC endpoint can expand those OIDs under the selected manifest
 * - Does not claim full patient-level terminology validation for arbitrary QRDA payloads
 */

import type { QualityMeasure, VsacValueSetBinding } from '../domains/healthcare-measures.js';

const VSAC_FHIR_BASE = 'https://cts.nlm.nih.gov/fhir';
const VSAC_DEFAULT_MANIFEST = 'http://cts.nlm.nih.gov/fhir/Library/latest-active';

export interface VsacApiConfig {
  apiKey?: string;
  baseUrl?: string;
  manifestUrl?: string | null;
}

export interface VsacCapabilityResult {
  reachable: boolean;
  httpStatus: number;
  resourceType: string | null;
  fhirVersion: string | null;
  url: string;
  error: string | null;
}

export interface VsacLayer7Target {
  oid: string;
  name: string;
  category: VsacValueSetBinding['category'];
  measureIds: string[];
}

export interface VsacExpansionResult extends VsacLayer7Target {
  valid: boolean;
  httpStatus: number;
  expansionUrl: string;
  codeCount: number;
  title: string | null;
  error: string | null;
}

export interface VsacLayer7Result {
  valid: boolean;
  scope: 'vsac_layer7_live';
  manifestUrl: string | null;
  totalTargets: number;
  expandedTargets: number;
  totalCodes: number;
  targets: VsacExpansionResult[];
}

function configuredApiKey(config?: VsacApiConfig): string | null {
  return config?.apiKey?.trim()
    || process.env.VSAC_UMLS_API_KEY?.trim()
    || process.env.UMLS_API_KEY?.trim()
    || null;
}

function configuredBaseUrl(config?: VsacApiConfig): string {
  return config?.baseUrl?.trim() || process.env.VSAC_FHIR_BASE_URL?.trim() || VSAC_FHIR_BASE;
}

function configuredManifestUrl(config?: VsacApiConfig): string | null {
  if (config && Object.prototype.hasOwnProperty.call(config, 'manifestUrl')) {
    return config.manifestUrl?.trim() || null;
  }
  return process.env.ATTESTOR_VSAC_MANIFEST_URL?.trim() || VSAC_DEFAULT_MANIFEST;
}

function basicAuthHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`apikey:${apiKey}`).toString('base64')}`;
}

function countExpansionContains(contains: any[] | undefined): number {
  if (!Array.isArray(contains) || contains.length === 0) return 0;
  let total = 0;
  for (const item of contains) {
    total += 1;
    total += countExpansionContains(item?.contains);
  }
  return total;
}

function operationOutcomeMessage(body: any): string | null {
  const issues = Array.isArray(body?.issue) ? body.issue : [];
  const messages = issues
    .map((issue: any) => issue?.details?.text ?? issue?.diagnostics ?? issue?.code)
    .filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0);
  return messages.length > 0 ? messages.join(' | ') : null;
}

export function isVsacConfigured(config?: VsacApiConfig): boolean {
  return Boolean(configuredApiKey(config));
}

export function collectVsacLayer7Targets(
  measures: Array<Pick<QualityMeasure, 'measureId' | 'vsacValueSets'>>,
): VsacLayer7Target[] {
  const targets = new Map<string, VsacLayer7Target>();
  for (const measure of measures) {
    for (const binding of measure.vsacValueSets ?? []) {
      const existing = targets.get(binding.oid);
      if (existing) {
        if (!existing.measureIds.includes(measure.measureId)) existing.measureIds.push(measure.measureId);
        continue;
      }
      targets.set(binding.oid, {
        oid: binding.oid,
        name: binding.name,
        category: binding.category,
        measureIds: [measure.measureId],
      });
    }
  }

  return [...targets.values()].sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.name.localeCompare(b.name);
  });
}

export async function fetchVsacCapabilityStatement(config: VsacApiConfig = {}): Promise<VsacCapabilityResult> {
  const baseUrl = configuredBaseUrl(config).replace(/\/+$/, '');
  const url = `${baseUrl}/metadata`;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/fhir+json' },
    });
    const body: any = await response.json().catch(() => ({}));
    return {
      reachable: response.ok,
      httpStatus: response.status,
      resourceType: typeof body?.resourceType === 'string' ? body.resourceType : null,
      fhirVersion: typeof body?.fhirVersion === 'string' ? body.fhirVersion : null,
      url,
      error: response.ok ? null : operationOutcomeMessage(body) ?? `HTTP ${response.status}`,
    };
  } catch (err: any) {
    return {
      reachable: false,
      httpStatus: 0,
      resourceType: null,
      fhirVersion: null,
      url,
      error: `VSAC capability request failed: ${err.message}`,
    };
  }
}

export async function expandVsacValueSet(
  target: VsacLayer7Target,
  config: VsacApiConfig = {},
): Promise<VsacExpansionResult> {
  const apiKey = configuredApiKey(config);
  const baseUrl = configuredBaseUrl(config).replace(/\/+$/, '');
  const manifestUrl = configuredManifestUrl(config);
  const url = new URL(`${baseUrl}/ValueSet/${encodeURIComponent(target.oid)}/$expand`);
  if (manifestUrl) url.searchParams.set('manifest', manifestUrl);

  if (!apiKey) {
    return {
      ...target,
      valid: false,
      httpStatus: 0,
      expansionUrl: url.toString(),
      codeCount: 0,
      title: null,
      error: 'VSAC_UMLS_API_KEY not configured.',
    };
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/fhir+json',
        Authorization: basicAuthHeader(apiKey),
      },
    });
    const body: any = await response.json().catch(() => ({}));
    const codeCount = typeof body?.expansion?.total === 'number'
      ? body.expansion.total
      : countExpansionContains(body?.expansion?.contains);

    const error = response.ok
      ? (codeCount > 0 ? null : 'VSAC returned zero expanded codes.')
      : operationOutcomeMessage(body) ?? `HTTP ${response.status}`;

    return {
      ...target,
      valid: response.ok && codeCount > 0,
      httpStatus: response.status,
      expansionUrl: url.toString(),
      codeCount,
      title: typeof body?.title === 'string' ? body.title : (typeof body?.name === 'string' ? body.name : null),
      error,
    };
  } catch (err: any) {
    return {
      ...target,
      valid: false,
      httpStatus: 0,
      expansionUrl: url.toString(),
      codeCount: 0,
      title: null,
      error: `VSAC expansion failed: ${err.message}`,
    };
  }
}

export async function validateVsacLayer7ForMeasures(
  measures: Array<Pick<QualityMeasure, 'measureId' | 'vsacValueSets'>>,
  config: VsacApiConfig = {},
): Promise<VsacLayer7Result> {
  const targets = collectVsacLayer7Targets(measures);
  const results: VsacExpansionResult[] = [];
  for (const target of targets) {
    results.push(await expandVsacValueSet(target, config));
  }
  return {
    valid: results.every(result => result.valid),
    scope: 'vsac_layer7_live',
    manifestUrl: configuredManifestUrl(config),
    totalTargets: results.length,
    expandedTargets: results.filter(result => result.valid).length,
    totalCodes: results.reduce((sum, result) => sum + result.codeCount, 0),
    targets: results,
  };
}
