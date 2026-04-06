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
  /** Reporting year. Default: '2026' */
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
  const year = config.year ?? '2026';
  const ig = config.ig ?? 'CMS';
  const url = `${baseUrl}/qrda_validation/${year}/III/${ig}`;

  const auth = Buffer.from(`${user}:${pass}`).toString('base64');

  // Build multipart form data with the XML file
  const boundary = '----AttestorCypressBoundary' + Date.now();
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="attestor-qrda3.xml"',
    'Content-Type: application/xml',
    '',
    xml,
    `--${boundary}--`,
    '',
  ].join('\r\n');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    const httpStatus = response.status;

    if (httpStatus === 401) {
      return {
        valid: false,
        errors: [{ message: 'UMLS authentication failed (HTTP 401). Check CYPRESS_UMLS_USER and CYPRESS_UMLS_PASS.' }],
        errorCount: 1,
        validator: null, path: null,
        scope: 'onc_cypress_api',
        httpStatus,
      };
    }

    const result = await response.json() as any;
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
