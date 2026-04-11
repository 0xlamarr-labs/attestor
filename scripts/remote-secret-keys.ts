export type RemoteSecretProvider = 'generic' | 'aws' | 'gke';

function collapseHyphens(value: string): string {
  return value.replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function normalizeGkeSecretId(value: string): string {
  const normalized = collapseHyphens(value.replace(/[^A-Za-z0-9_-]+/g, '-'));
  if (!normalized) {
    throw new Error('Secret id normalization produced an empty value.');
  }
  return normalized.slice(0, 255);
}

export function remoteSecretKey(provider: RemoteSecretProvider, logicalName: string): string {
  if (provider === 'gke') return normalizeGkeSecretId(logicalName);
  return logicalName;
}

export function inferObservabilityRemoteSecretProvider(): RemoteSecretProvider {
  const explicit = process.env.ATTESTOR_OBSERVABILITY_REMOTE_SECRET_PROVIDER?.trim();
  if (explicit === 'gke' || explicit === 'aws' || explicit === 'generic') return explicit;
  if (process.env.ATTESTOR_SECRET_BOOTSTRAP_PROVIDER?.trim() === 'gke') return 'gke';
  if (process.env.ATTESTOR_GCP_SECRET_PROJECT_ID?.trim()) return 'gke';
  if (process.env.ATTESTOR_SECRET_BOOTSTRAP_PROVIDER?.trim() === 'aws') return 'aws';
  return 'generic';
}
