/**
 * ONC Cypress QRDA Validation API Client
 *
 * Calls the real ONC Project Cypress validation endpoint to validate
 * QRDA Category III XML against the official CMS validation stack.
 *
 * ENDPOINT DISCOVERY:
 * - Queries GET /qrda_validation.json on the live demo server
 * - Selects the matching validator path returned by Cypress itself
 * - Uploads multipart/form-data to that resolved path
 *
 * AUTH:
 * - Basic Auth with a Cypress demo account email/password pair
 * - The Cypress web UI also asks for a UMLS API key when signing in, but the
 *   JSON API itself authenticates with the Cypress account credentials
 *
 * CREDENTIALS:
 * - CYPRESS_EMAIL: Cypress demo account email
 * - CYPRESS_PASSWORD: Cypress demo account password
 * - Legacy fallback: CYPRESS_UMLS_USER / CYPRESS_UMLS_PASS
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
  /** Cypress demo account email. Default: CYPRESS_EMAIL, then legacy CYPRESS_UMLS_USER */
  email?: string;
  /** Legacy alias for Cypress demo account email */
  user?: string;
  /** Cypress demo account password. Default: CYPRESS_PASSWORD, then legacy CYPRESS_UMLS_PASS */
  password?: string;
  /** Legacy alias for Cypress demo account password */
  pass?: string;
  /** Cypress server base URL. Default: cypressdemo.healthit.gov */
  baseUrl?: string;
  /** Reporting year. Default: '2026' */
  year?: string;
  /** Validator label. Default: 'CMS' */
  ig?: 'CMS' | 'HL7';
  /** QRDA type. Default: 'III' */
  qrdaType?: 'I' | 'III';
}

export interface CypressApiError {
  message: string;
  validator?: string;
  location?: string;
}

export interface CypressValidatorDescriptor {
  validator: string;
  path: string;
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
  /** Upload path chosen from the live validator index */
  uploadPath: string | null;
}

function configuredCypressEmail(config?: CypressApiConfig): string | null {
  return config?.email?.trim()
    || config?.user?.trim()
    || process.env.CYPRESS_EMAIL?.trim()
    || process.env.CYPRESS_UMLS_USER?.trim()
    || null;
}

function configuredCypressPassword(config?: CypressApiConfig): string | null {
  return config?.password?.trim()
    || config?.pass?.trim()
    || process.env.CYPRESS_PASSWORD?.trim()
    || process.env.CYPRESS_UMLS_PASS?.trim()
    || null;
}

/**
 * Check if ONC Cypress API credentials are configured.
 */
export function isCypressConfigured(config: CypressApiConfig = {}): boolean {
  return Boolean(configuredCypressEmail(config) && configuredCypressPassword(config));
}

function basicAuthHeader(email: string, password: string): string {
  return `Basic ${Buffer.from(`${email}:${password}`).toString('base64')}`;
}

export async function fetchCypressValidators(
  config: CypressApiConfig = {},
): Promise<{ httpStatus: number; validators: CypressValidatorDescriptor[]; error: string | null }> {
  const email = configuredCypressEmail(config);
  const password = configuredCypressPassword(config);
  const baseUrl = (config.baseUrl ?? CYPRESS_API_BASE).replace(/\/+$/u, '');

  if (!email || !password) {
    return {
      httpStatus: 0,
      validators: [],
      error: 'Cypress credentials not configured. Set CYPRESS_EMAIL and CYPRESS_PASSWORD (or legacy CYPRESS_UMLS_USER / CYPRESS_UMLS_PASS).',
    };
  }

  try {
    const response = await fetch(`${baseUrl}/qrda_validation.json`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: basicAuthHeader(email, password),
      },
    });

    let body: any = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (!response.ok) {
      return {
        httpStatus: response.status,
        validators: [],
        error: body?.error ?? `Validator index request failed (HTTP ${response.status}).`,
      };
    }

    const validators = Array.isArray(body)
      ? body
        .filter((entry: any) => typeof entry?.validator === 'string' && typeof entry?.path === 'string')
        .map((entry: any) => ({ validator: entry.validator as string, path: entry.path as string }))
      : [];

    return {
      httpStatus: response.status,
      validators,
      error: null,
    };
  } catch (err: any) {
    return {
      httpStatus: 0,
      validators: [],
      error: `Validator index request failed: ${err.message}`,
    };
  }
}

function resolveValidatorPath(
  validators: CypressValidatorDescriptor[],
  year: string,
  qrdaType: 'I' | 'III',
  ig: 'CMS' | 'HL7',
): CypressValidatorDescriptor | null {
  const exactLabel = `${ig} QRDA Category ${qrdaType} validator for ${year}`;
  const exactMatch = validators.find((entry) => entry.validator.includes(exactLabel));
  if (exactMatch) return exactMatch;

  const normalizedType = `qrda${qrdaType}`;
  const normalizedIg = ig.toLowerCase();
  const exactPath = `/qrda_validation/${year}/${normalizedType}/${normalizedIg}`;
  const pathMatch = validators.find((entry) => entry.path.toLowerCase() === exactPath);
  if (pathMatch) return pathMatch;

  return validators.find((entry) => entry.path.toLowerCase().includes(`/qrda_validation/${year}/${normalizedType}/`)) ?? null;
}

/**
 * Validate QRDA XML against the real ONC Cypress server.
 *
 * Requires Cypress demo account credentials.
 * Set CYPRESS_EMAIL and CYPRESS_PASSWORD (legacy fallback: CYPRESS_UMLS_USER / CYPRESS_UMLS_PASS).
 */
export async function validateViaCypressApi(
  xml: string,
  config: CypressApiConfig = {},
): Promise<CypressApiResult> {
  const email = configuredCypressEmail(config);
  const password = configuredCypressPassword(config);

  if (!email || !password) {
    return {
      valid: false,
      errors: [{ message: 'Cypress credentials not configured. Set CYPRESS_EMAIL and CYPRESS_PASSWORD (or legacy CYPRESS_UMLS_USER / CYPRESS_UMLS_PASS).' }],
      errorCount: 1,
      validator: null,
      path: null,
      scope: 'onc_cypress_api',
      httpStatus: 0,
      uploadPath: null,
    };
  }

  const baseUrl = (config.baseUrl ?? CYPRESS_API_BASE).replace(/\/+$/u, '');
  const year = config.year ?? '2026';
  const ig = config.ig ?? 'CMS';
  const qrdaType = config.qrdaType ?? 'III';

  const validatorIndex = await fetchCypressValidators({
    ...config,
    email,
    password,
    baseUrl,
  });
  if (validatorIndex.error) {
    return {
      valid: false,
      errors: [{ message: validatorIndex.error }],
      errorCount: 1,
      validator: null,
      path: null,
      scope: 'onc_cypress_api',
      httpStatus: validatorIndex.httpStatus,
      uploadPath: null,
    };
  }

  const selectedValidator = resolveValidatorPath(validatorIndex.validators, year, qrdaType, ig);
  if (!selectedValidator) {
    return {
      valid: false,
      errors: [{ message: `No Cypress validator found for ${ig} QRDA Category ${qrdaType} ${year}.` }],
      errorCount: 1,
      validator: null,
      path: null,
      scope: 'onc_cypress_api',
      httpStatus: validatorIndex.httpStatus,
      uploadPath: null,
    };
  }

  const formData = new FormData();
  formData.append('file', new Blob([xml], { type: 'application/xml' }), 'attestor-qrda3.xml');

  try {
    const response = await fetch(`${baseUrl}${selectedValidator.path}`, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(email, password),
        Accept: 'application/json',
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
        errors: [{ message: responseBody?.error ?? 'Cypress authentication failed (HTTP 401). Check CYPRESS_EMAIL and CYPRESS_PASSWORD.' }],
        errorCount: 1,
        validator: null,
        path: null,
        scope: 'onc_cypress_api',
        httpStatus,
        uploadPath: selectedValidator.path,
      };
    }

    if (httpStatus === 404) {
      return {
        valid: false,
        errors: [{ message: responseBody?.error ?? `Validator upload path not found (${selectedValidator.path}).` }],
        errorCount: 1,
        validator: null,
        path: null,
        scope: 'onc_cypress_api',
        httpStatus,
        uploadPath: selectedValidator.path,
      };
    }

    if (httpStatus === 422) {
      return {
        valid: false,
        errors: [{ message: responseBody?.error ?? 'Server returned 422 — the uploaded file was not processable by the selected validator.' }],
        errorCount: 1,
        validator: null,
        path: null,
        scope: 'onc_cypress_api',
        httpStatus,
        uploadPath: selectedValidator.path,
      };
    }

    const executionErrors: CypressApiError[] = (responseBody?.execution_errors ?? []).map((entry: any) => ({
      message: entry.message ?? entry.msg ?? JSON.stringify(entry),
      validator: entry.validator,
      location: entry.location,
    }));

    return {
      valid: executionErrors.length === 0,
      errors: executionErrors,
      errorCount: executionErrors.length,
      validator: responseBody?.validator ?? null,
      path: responseBody?.path ?? null,
      scope: 'onc_cypress_api',
      httpStatus,
      uploadPath: selectedValidator.path,
    };
  } catch (err: any) {
    return {
      valid: false,
      errors: [{ message: `Cypress API connection failed: ${err.message}` }],
      errorCount: 1,
      validator: null,
      path: null,
      scope: 'onc_cypress_api',
      httpStatus: 0,
      uploadPath: selectedValidator.path,
    };
  }
}
