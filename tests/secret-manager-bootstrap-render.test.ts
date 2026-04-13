import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { renderSecretManagerBootstrap } from '../scripts/render-secret-manager-bootstrap.ts';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function main(): void {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'attestor-secret-bootstrap-'));
  const previous = {
    ATTESTOR_AWS_REGION: process.env.ATTESTOR_AWS_REGION,
    ATTESTOR_AWS_EXTERNAL_SECRETS_ROLE_ARN: process.env.ATTESTOR_AWS_EXTERNAL_SECRETS_ROLE_ARN,
    ATTESTOR_HA_SECRET_PREFIX: process.env.ATTESTOR_HA_SECRET_PREFIX,
    ATTESTOR_OBSERVABILITY_EXTERNAL_SECRET_STORE: process.env.ATTESTOR_OBSERVABILITY_EXTERNAL_SECRET_STORE,
    ATTESTOR_HA_SECRET_STORE: process.env.ATTESTOR_HA_SECRET_STORE,
    ATTESTOR_GCP_SECRET_PROJECT_ID: process.env.ATTESTOR_GCP_SECRET_PROJECT_ID,
    ATTESTOR_GCP_WI_CLUSTER_PROJECT_ID: process.env.ATTESTOR_GCP_WI_CLUSTER_PROJECT_ID,
    ATTESTOR_GCP_WI_CLUSTER_LOCATION: process.env.ATTESTOR_GCP_WI_CLUSTER_LOCATION,
    ATTESTOR_GCP_WI_CLUSTER_NAME: process.env.ATTESTOR_GCP_WI_CLUSTER_NAME,
  };

  try {
    process.env.ATTESTOR_AWS_REGION = 'us-east-2';
    process.env.ATTESTOR_AWS_EXTERNAL_SECRETS_ROLE_ARN = 'arn:aws:iam::123456789012:role/attestor-external-secrets';
    process.env.ATTESTOR_HA_SECRET_PREFIX = 'corp/attestor';
    process.env.ATTESTOR_OBSERVABILITY_EXTERNAL_SECRET_STORE = 'attestor-observability-secrets';
    process.env.ATTESTOR_HA_SECRET_STORE = 'attestor-platform-secrets';
    process.env.ATTESTOR_GCP_SECRET_PROJECT_ID = 'regulated-prod';
    process.env.ATTESTOR_GCP_WI_CLUSTER_PROJECT_ID = 'regulated-cluster';
    process.env.ATTESTOR_GCP_WI_CLUSTER_LOCATION = 'europe-west4';
    process.env.ATTESTOR_GCP_WI_CLUSTER_NAME = 'attestor-prod';

    const summary = renderSecretManagerBootstrap({ provider: 'all', outputDir: tempDir });
    ok(summary.providers.length === 2, 'Secret manager bootstrap: renders both providers in all mode');

    const awsStore = readFileSync(resolve(tempDir, 'aws', 'observability-clustersecretstore.yaml'), 'utf8');
    ok(awsStore.includes('service: SecretsManager'), 'Secret manager bootstrap: AWS store uses Secrets Manager');
    ok(awsStore.includes('arn:aws:iam::123456789012:role/attestor-external-secrets'), 'Secret manager bootstrap: AWS role ARN is rendered');

    const gkeStore = readFileSync(resolve(tempDir, 'gke', 'ha-clustersecretstore.yaml'), 'utf8');
    ok(gkeStore.includes('gcpsm:'), 'Secret manager bootstrap: GKE store uses Google Secret Manager');
    ok(gkeStore.includes('clusterProjectID: regulated-cluster'), 'Secret manager bootstrap: GKE WI cluster project is rendered');

    const catalog = readFileSync(resolve(tempDir, 'gke', 'catalog.json'), 'utf8');
    ok(catalog.includes('"logicalName": "observability/grafana-cloud"'), 'Secret manager bootstrap: observability logical catalog entry is emitted');
    ok(catalog.includes('"logicalName": "corp/attestor/control-plane-pg-url"'), 'Secret manager bootstrap: HA runtime logical path uses the configured prefix');
    ok(catalog.includes('"remoteName": "corp-attestor-control-plane-pg-url"'), 'Secret manager bootstrap: GKE catalog normalizes remote secret ids for Google Secret Manager');

    const seed = readFileSync(resolve(tempDir, 'gke', 'seed.json'), 'utf8');
    ok(seed.includes('REPLACE_ME_OTLP_ENDPOINT'), 'Secret manager bootstrap: structured seed contains Grafana placeholder data');
    ok(seed.includes('REPLACE_ME_FOR_ATTESTOR_ADMIN_API_KEY'), 'Secret manager bootstrap: runtime seed contains admin API key placeholder');
    ok(seed.includes('REPLACE_ME_FOR_ATTESTOR_ACCOUNT_MFA_ENCRYPTION_KEY'), 'Secret manager bootstrap: runtime seed contains MFA encryption key placeholder');
    ok(seed.includes('REPLACE_ME_FOR_ATTESTOR_HOSTED_OIDC_STATE_KEY'), 'Secret manager bootstrap: runtime seed contains hosted OIDC state key placeholder');
    ok(seed.includes('"corp-attestor-admin-api-key"'), 'Secret manager bootstrap: GKE seed uses normalized remote secret ids');

    const readme = readFileSync(resolve(tempDir, 'aws', 'README.md'), 'utf8');
    ok(readme.includes('External Secrets Operator'), 'Secret manager bootstrap: README explains the managed-secret path');
    ok(readme.includes('render:production-readiness-packet'), 'Secret manager bootstrap: README points to the final readiness handoff');

    console.log(`\nSecret manager bootstrap render tests: ${passed} passed, 0 failed`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main();
