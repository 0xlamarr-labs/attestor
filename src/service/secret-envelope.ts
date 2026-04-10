import { stableJsonStringify } from './json-stable.js';

export type SecretEnvelopeProvider = 'vault_transit';

export interface SecretEnvelopeRecord {
  provider: SecretEnvelopeProvider;
  keyName: string;
  ciphertext: string;
  contextBase64: string;
  sealedAt: string;
}

export interface SecretEnvelopeStatus {
  configured: boolean;
  provider: SecretEnvelopeProvider | null;
  recoveryEnabled: boolean;
  backend: 'external' | 'disabled';
  vaultBaseUrl: string | null;
  keyName: string | null;
}

export class SecretEnvelopeError extends Error {
  constructor(
    public readonly code: 'MISCONFIGURED' | 'PROVIDER_ERROR' | 'DISABLED',
    message: string,
  ) {
    super(message);
    this.name = 'SecretEnvelopeError';
  }
}

function configuredProvider(): SecretEnvelopeProvider | null {
  const raw = process.env.ATTESTOR_SECRET_ENVELOPE_PROVIDER?.trim().toLowerCase() ?? '';
  if (!raw) return null;
  if (raw === 'vault_transit') return 'vault_transit';
  throw new SecretEnvelopeError(
    'MISCONFIGURED',
    `Unsupported ATTESTOR_SECRET_ENVELOPE_PROVIDER '${raw}'. Supported providers: vault_transit.`,
  );
}

function recoveryEnabled(): boolean {
  return process.env.ATTESTOR_TENANT_KEY_RECOVERY_ENABLED?.trim().toLowerCase() === 'true';
}

function vaultConfig(): {
  baseUrl: string;
  token: string;
  keyName: string;
  mountPath: string;
  namespace: string | null;
} {
  const baseUrl = process.env.ATTESTOR_VAULT_TRANSIT_BASE_URL?.trim() ?? '';
  const token = process.env.ATTESTOR_VAULT_TRANSIT_TOKEN?.trim() ?? '';
  const keyName = process.env.ATTESTOR_VAULT_TRANSIT_KEY_NAME?.trim() ?? '';
  const mountPath = process.env.ATTESTOR_VAULT_TRANSIT_MOUNT_PATH?.trim() || 'transit';
  const namespace = process.env.ATTESTOR_VAULT_NAMESPACE?.trim() || null;
  if (!baseUrl || !token || !keyName) {
    throw new SecretEnvelopeError(
      'MISCONFIGURED',
      'Vault Transit requires ATTESTOR_VAULT_TRANSIT_BASE_URL, ATTESTOR_VAULT_TRANSIT_TOKEN, and ATTESTOR_VAULT_TRANSIT_KEY_NAME.',
    );
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ''), token, keyName, mountPath, namespace };
}

function encodeContext(context: Record<string, unknown>): string {
  return Buffer.from(stableJsonStringify(context), 'utf8').toString('base64');
}

async function vaultTransitRequest<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const config = vaultConfig();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-vault-token': config.token,
  };
  if (config.namespace) headers['x-vault-namespace'] = config.namespace;

  const response = await fetch(`${config.baseUrl}/v1/${config.mountPath}/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok) {
    const errors = Array.isArray((body as { errors?: unknown }).errors)
      ? (body as { errors: unknown[] }).errors
      : [];
    const message = typeof errors[0] === 'string'
      ? String(errors[0])
      : `Vault Transit request failed with status ${response.status}.`;
    throw new SecretEnvelopeError('PROVIDER_ERROR', message);
  }
  return body as T;
}

export function getSecretEnvelopeStatus(): SecretEnvelopeStatus {
  const provider = configuredProvider();
  if (!provider) {
    return {
      configured: false,
      provider: null,
      recoveryEnabled: recoveryEnabled(),
      backend: 'disabled',
      vaultBaseUrl: null,
      keyName: null,
    };
  }
  if (provider === 'vault_transit') {
    const baseUrl = process.env.ATTESTOR_VAULT_TRANSIT_BASE_URL?.trim() || null;
    const keyName = process.env.ATTESTOR_VAULT_TRANSIT_KEY_NAME?.trim() || null;
    return {
      configured: Boolean(baseUrl && keyName),
      provider,
      recoveryEnabled: recoveryEnabled(),
      backend: 'external',
      vaultBaseUrl: baseUrl,
      keyName,
    };
  }
  return {
    configured: false,
    provider: null,
    recoveryEnabled: recoveryEnabled(),
    backend: 'disabled',
    vaultBaseUrl: null,
    keyName: null,
  };
}

export async function sealSecretEnvelope(
  plaintext: string,
  context: Record<string, unknown>,
): Promise<SecretEnvelopeRecord | null> {
  const provider = configuredProvider();
  if (!provider) return null;
  if (provider === 'vault_transit') {
    const config = vaultConfig();
    const contextBase64 = encodeContext(context);
    const response = await vaultTransitRequest<{ data?: { ciphertext?: string } }>(
      `encrypt/${config.keyName}`,
      {
        plaintext: Buffer.from(plaintext, 'utf8').toString('base64'),
        context: contextBase64,
      },
    );
    const ciphertext = response.data?.ciphertext?.trim();
    if (!ciphertext) {
      throw new SecretEnvelopeError('PROVIDER_ERROR', 'Vault Transit encrypt response did not include ciphertext.');
    }
    return {
      provider,
      keyName: config.keyName,
      ciphertext,
      contextBase64,
      sealedAt: new Date().toISOString(),
    };
  }
  return null;
}

export async function recoverSecretEnvelope(record: SecretEnvelopeRecord): Promise<string> {
  const provider = configuredProvider();
  if (!provider) {
    throw new SecretEnvelopeError(
      'DISABLED',
      'Secret envelope provider is not configured. Set ATTESTOR_SECRET_ENVELOPE_PROVIDER before attempting recovery.',
    );
  }
  if (provider !== record.provider) {
    throw new SecretEnvelopeError(
      'MISCONFIGURED',
      `Configured secret envelope provider '${provider}' does not match record provider '${record.provider}'.`,
    );
  }
  if (provider === 'vault_transit') {
    const response = await vaultTransitRequest<{ data?: { plaintext?: string } }>(
      `decrypt/${record.keyName}`,
      {
        ciphertext: record.ciphertext,
        context: record.contextBase64,
      },
    );
    const plaintext = response.data?.plaintext?.trim();
    if (!plaintext) {
      throw new SecretEnvelopeError('PROVIDER_ERROR', 'Vault Transit decrypt response did not include plaintext.');
    }
    return Buffer.from(plaintext, 'base64').toString('utf8');
  }
  throw new SecretEnvelopeError('MISCONFIGURED', `Unsupported provider '${record.provider}'.`);
}

export function assertTenantKeyRecoveryEnabled(): void {
  if (!recoveryEnabled()) {
    throw new SecretEnvelopeError(
      'DISABLED',
      'Tenant key recovery is disabled. Set ATTESTOR_TENANT_KEY_RECOVERY_ENABLED=true to allow break-glass recovery.',
    );
  }
}
