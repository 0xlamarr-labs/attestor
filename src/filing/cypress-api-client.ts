/**
 * ONC Cypress QRDA Validation API Client
 *
 * Calls the real ONC Project Cypress validation endpoint to validate
 * QRDA Category III XML against the official CMS validation stack.
 *
 * ENDPOINT: POST /qrda_validation/{year}/{qrda_type}/{implementation_guide}
 * HOST: cypressdemo.healthit.gov (official ONC demo server)
 * AUTH: Basic Auth with UMLS credentials (free NLM account required)
 *
 * ARCHITECTURE:
 * - Single HTTP POST with multipart/form-data body
 * - Returns structured execution_errors array
 * - This is the REAL ONC Cypress validator — not a reimplementation
 *
 * CREDENTIALS:
 * - CYPRESS_UMLS_USER: UMLS username (from uts.nlm.nih.gov/uts/signup-login)
 * - CYPRESS_UMLS_PASS: UMLS password
 * - Free account, ~5 business day approval
 *
 * BOUNDARY:
 * - Uses the ONC demo server (data wiped weekly)
 * - Requires network access to cypressdemo.healthit.gov
 * - Not a local/offline validation — depends on ONC infrastructure
 *
 * SCOPE: 'onc_cypress_api' — real ONC Cypress server execution
 */

const CYPRESS_API_BASE = 'https://cypressdemo.healthit.gov';

export interface CypressApiConfig {
  /** UMLS username. Default: process.env.CYPRESS_UMLS_USER */
  user?: string;
  /** UMLS password. Default: process.env.CYPRESS_UMLS_PASS */
  pass?: string;
  /** Cypress server base URL. Default: cypressdemo.healthit.gov */
  baseUrl?: string;
  /** Reporting year. Default: '2025' (use the latest year supported by the demo server) */
  year?: string;
  /** Implementation guide. Default: 'CMS' */
  ig?: 'CMS' | 'HL7';
}

export interface CypressApiError {
  message: string;
  validator?: string;
  location?: string;
}

export interface CypressApiResult {
  /** True when zero execution errors */
  valid: boolean;
  errors: CypressApiError[];
  errorCount: number;
  /** Raw API response fields */
  validator: string | null;
  path: string | null;
  /** Real ONC Cypress server execution, not local reimplementation */
  scope: 'onc_cypress_api';
  /** HTTP status code from the API */
  httpStatus: number;
}

/**
 * Check if ONC Cypress API credentials are configured.
 */
export function isCypressConfigured(): boolean {
  return !!(process.env.CYPRESS_UMLS_USER && process.env.CYPRESS_UMLS_PASS);
}

/**
 * Validate QRDA III XML against the real ONC Cypress server.
 *
 * Requires UMLS credentials (free NLM account).
 * Set CYPRESS_UMLS_USER and CYPRESS_UMLS_PASS environment variables.
 */
export async function validateViaCypressApi(
  xml: string,
  config: CypressApiConfig = {},
): Promise<CypressApiResult> {
  const user = config.user ?? process.env.CYPRESS_UMLS_USER;
  const pass = config.pass ?? process.env.CYPRESS_UMLS_PASS;

  if (!user || !pass) {
    return {
      valid: false,
      errors: [{ message: 'UMLS credentials not configured. Set CYPRESS_UMLS_USER and CYPRESS_UMLS_PASS.' }],
      errorCount: 1,
      validator: null, path: null,
      scope: 'onc_cypress_api',
      httpStatus: 0,
    };
  }

  const baseUrl = config.baseUrl ?? CYPRESS_API_BASE;
  const year = config.year ?? '2025';
  const ig = config.ig ?? 'CMS';
  const url = `${baseUrl}/qrda_validation/${year}/III/${ig}`;

  const auth = Buffer.from(`${user}:${pass}`).toString('base64');

  // Build multipart form data using native FormData (Node.js 18+)
  const formData = new FormData();
  formData.append('file', new Blob([xml], { type: 'application/xml' }), 'attestor-qrda3.xml');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
      },
      body: formData,
    });

    const httpStatus = response.status;

    let responseBody: any;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = { execution_errors: [] };
    }

    if (httpStatus === 401) {
      return {
        valid: false,
        errors: [{ message: responseBody?.error ?? 'UMLS authentication failed (HTTP 401). Check CYPRESS_UMLS_USER and CYPRESS_UMLS_PASS.' }],
        errorCount: 1,
        validator: null, path: null,
        scope: 'onc_cypress_api',
        httpStatus,
      };
    }

    if (httpStatus === 422) {
      return {
        valid: false,
        errors: [{ message: responseBody?.error ?? `Server returned 422 — the reporting year or IG may not be available on the demo server.` }],
        errorCount: 1,
        validator: null, path: null,
        scope: 'onc_cypress_api',
        httpStatus,
      };
    }

    const result = responseBody;
    const executionErrors: CypressApiError[] = (result.execution_errors ?? []).map((e: any) => ({
      message: e.message ?? e.msg ?? JSON.stringify(e),
      validator: e.validator,
      location: e.location,
    }));

    return {
      valid: executionErrors.length === 0,
      errors: executionErrors,
      errorCount: executionErrors.length,
      validator: result.validator ?? null,
      path: result.path ?? null,
      scope: 'onc_cypress_api',
      httpStatus,
    };
  } catch (err: any) {
    return {
      valid: false,
      errors: [{ message: `Cypress API connection failed: ${err.message}` }],
      errorCount: 1,
      validator: null, path: null,
      scope: 'onc_cypress_api',
      httpStatus: 0,
    };
  }
}
