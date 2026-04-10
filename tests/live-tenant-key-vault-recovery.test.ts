import { strict as assert } from 'node:assert';
import { createServer as createHttpServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import {
  resetBillingEventLedgerForTests,
} from '../src/service/billing-event-ledger.js';
import {
  resetSharedControlPlaneStoreForTests,
} from '../src/service/control-plane-store.js';
import { resetObservabilityForTests } from '../src/service/observability.js';
import { resetStripeWebhookStoreForTests } from '../src/service/stripe-webhook-store.js';
import { resetHostedBillingEntitlementStoreForTests } from '../src/service/billing-entitlement-store.js';
import { resetAdminAuditLogForTests } from '../src/service/admin-audit-log.js';
import { resetAdminIdempotencyStoreForTests } from '../src/service/admin-idempotency-store.js';

let passed = 0;

function ok(condition: boolean, message: string): void {
  assert(condition, message);
  passed += 1;
}

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve TCP port.'));
        return;
      }
      const { port } = address;
      server.close((err) => err ? reject(err) : resolve(port));
    });
  });
}

async function readJson(req: import('node:http').IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function run(): Promise<void> {
  mkdirSync('.attestor', { recursive: true });
  const tempRoot = mkdtempSync(join(process.cwd(), '.attestor', 'live-tenant-key-vault-'));
  const pgDataDir = join(tempRoot, 'pg');
  const pgPort = await reservePort();
  const apiPort = await reservePort();
  const vaultPort = await reservePort();
  const tenantKeyStorePath = join(tempRoot, 'tenant-keys.json');
  const ciphertextMap = new Map<string, { plaintext: string; context: string }>();

  const pg = new EmbeddedPostgres({
    databaseDir: pgDataDir,
    user: 'tenant_key_vault',
    password: 'tenant_key_vault',
    port: pgPort,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  process.env.ATTESTOR_CONTROL_PLANE_PG_URL = `postgres://tenant_key_vault:tenant_key_vault@localhost:${pgPort}/attestor_control_plane`;
  process.env.ATTESTOR_BILLING_LEDGER_PG_URL = `postgres://tenant_key_vault:tenant_key_vault@localhost:${pgPort}/attestor_billing`;
  process.env.ATTESTOR_ACCOUNT_STORE_PATH = join(tempRoot, 'accounts.json');
  process.env.ATTESTOR_ACCOUNT_USER_STORE_PATH = join(tempRoot, 'account-users.json');
  process.env.ATTESTOR_ACCOUNT_USER_TOKEN_STORE_PATH = join(tempRoot, 'account-user-tokens.json');
  process.env.ATTESTOR_ACCOUNT_SESSION_STORE_PATH = join(tempRoot, 'account-sessions.json');
  process.env.ATTESTOR_TENANT_KEY_STORE_PATH = tenantKeyStorePath;
  process.env.ATTESTOR_USAGE_LEDGER_PATH = join(tempRoot, 'usage-ledger.json');
  process.env.ATTESTOR_ADMIN_AUDIT_LOG_PATH = join(tempRoot, 'admin-audit.json');
  process.env.ATTESTOR_ADMIN_IDEMPOTENCY_STORE_PATH = join(tempRoot, 'admin-idempotency.json');
  process.env.ATTESTOR_ASYNC_DLQ_STORE_PATH = join(tempRoot, 'async-dlq.json');
  process.env.ATTESTOR_STRIPE_WEBHOOK_STORE_PATH = join(tempRoot, 'stripe-webhooks.json');
  process.env.ATTESTOR_BILLING_ENTITLEMENT_STORE_PATH = join(tempRoot, 'billing-entitlements.json');
  process.env.ATTESTOR_OBSERVABILITY_LOG_PATH = join(tempRoot, 'observability.jsonl');
  process.env.ATTESTOR_ADMIN_API_KEY = 'admin-tenant-key-vault';
  process.env.ATTESTOR_STRIPE_USE_MOCK = 'true';
  process.env.STRIPE_API_KEY = 'sk_test_tenant_key_vault_mock';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_tenant_key_vault';
  process.env.ATTESTOR_BILLING_SUCCESS_URL = 'https://attestor.dev/billing/success';
  process.env.ATTESTOR_BILLING_CANCEL_URL = 'https://attestor.dev/billing/cancel';
  process.env.ATTESTOR_BILLING_PORTAL_RETURN_URL = 'https://attestor.dev/app';
  process.env.ATTESTOR_SECRET_ENVELOPE_PROVIDER = 'vault_transit';
  process.env.ATTESTOR_VAULT_TRANSIT_BASE_URL = `http://127.0.0.1:${vaultPort}`;
  process.env.ATTESTOR_VAULT_TRANSIT_TOKEN = 'vault-test-token';
  process.env.ATTESTOR_VAULT_TRANSIT_KEY_NAME = 'attestor-tenant-keys';
  process.env.ATTESTOR_TENANT_KEY_RECOVERY_ENABLED = 'true';

  const vaultServer = createHttpServer(async (req, res) => {
    if (req.headers['x-vault-token'] !== 'vault-test-token') {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ errors: ['forbidden'] }));
      return;
    }
    const body = await readJson(req);
    const path = req.url ?? '';
    if (req.method === 'POST' && path === '/v1/transit/encrypt/attestor-tenant-keys') {
      const plaintext = Buffer.from(String(body.plaintext ?? ''), 'base64').toString('utf8');
      const context = String(body.context ?? '');
      const token = `vault:v1:${Buffer.from(`${plaintext}:${context}`).toString('base64url')}`;
      ciphertextMap.set(token, { plaintext, context });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: { ciphertext: token } }));
      return;
    }
    if (req.method === 'POST' && path === '/v1/transit/decrypt/attestor-tenant-keys') {
      const ciphertext = String(body.ciphertext ?? '');
      const context = String(body.context ?? '');
      const entry = ciphertextMap.get(ciphertext);
      if (!entry || entry.context !== context) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ errors: ['ciphertext not found'] }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        data: {
          plaintext: Buffer.from(entry.plaintext, 'utf8').toString('base64'),
        },
      }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ errors: ['not found'] }));
  });

  await new Promise<void>((resolve, reject) => {
    vaultServer.once('error', reject);
    vaultServer.listen(vaultPort, '127.0.0.1', () => resolve());
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase('attestor_control_plane');
  await pg.createDatabase('attestor_billing');
  await resetSharedControlPlaneStoreForTests();
  await resetBillingEventLedgerForTests();
  resetHostedBillingEntitlementStoreForTests();
  resetStripeWebhookStoreForTests();
  resetAdminAuditLogForTests();
  resetAdminIdempotencyStoreForTests();
  resetObservabilityForTests();

  const { startServer } = await import('../src/service/api-server.js');
  const base = `http://127.0.0.1:${apiPort}`;
  const server = startServer(apiPort);
  await new Promise((resolve) => setTimeout(resolve, 500));

  try {
    console.log('\n[Live tenant key recovery via Vault Transit]');

    const createAccountRes = await fetch(`${base}/api/v1/admin/accounts`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer admin-tenant-key-vault',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'tenant-key-vault-account-1',
      },
      body: JSON.stringify({
        accountName: 'Vault Hosted Co',
        contactEmail: 'ops@vault-hosted.example',
        tenantId: 'tenant-vault-live',
        tenantName: 'Vault Live Tenant',
        planId: 'starter',
      }),
    });
    ok(createAccountRes.status === 201, 'Admin account create with Vault seal: 201');
    const createAccountBody = await createAccountRes.json() as any;
    ok(createAccountBody.initialKey.apiKey.startsWith('atk_'), 'Admin account create with Vault seal: plaintext key returned once');
    ok(createAccountBody.initialKey.sealedStorage.enabled === true, 'Admin account create with Vault seal: sealed metadata present');
    ok(createAccountBody.initialKey.sealedStorage.provider === 'vault_transit', 'Admin account create with Vault seal: provider is vault_transit');
    ok(!existsSync(tenantKeyStorePath), 'Shared control-plane: no local tenant key store file created');

    const listKeysRes = await fetch(`${base}/api/v1/admin/tenant-keys`, {
      headers: { Authorization: 'Bearer admin-tenant-key-vault' },
    });
    ok(listKeysRes.status === 200, 'Admin tenant key list: 200');
    const listKeysBody = await listKeysRes.json() as any;
    ok(listKeysBody.keys.length === 1, 'Admin tenant key list: one key present');
    ok(listKeysBody.keys[0].sealedStorage.enabled === true, 'Admin tenant key list: sealed storage visible');
    ok(listKeysBody.keys[0].sealedStorage.keyName === 'attestor-tenant-keys', 'Admin tenant key list: key name visible');

    const telemetryRes = await fetch(`${base}/api/v1/admin/telemetry`, {
      headers: { Authorization: 'Bearer admin-tenant-key-vault' },
    });
    ok(telemetryRes.status === 200, 'Admin telemetry: 200');
    const telemetryBody = await telemetryRes.json() as any;
    ok(telemetryBody.secretEnvelope.configured === true, 'Admin telemetry: secret envelope configured');
    ok(telemetryBody.secretEnvelope.recoveryEnabled === true, 'Admin telemetry: recovery enabled');

    const recoverRes = await fetch(`${base}/api/v1/admin/tenant-keys/${createAccountBody.initialKey.id}/recover`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer admin-tenant-key-vault',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'tenant-key-vault-recover-1',
      },
      body: JSON.stringify({ reason: 'drill' }),
    });
    ok(recoverRes.status === 200, 'Tenant key recover: 200');
    const recoverBody = await recoverRes.json() as any;
    ok(recoverBody.key.apiKey === createAccountBody.initialKey.apiKey, 'Tenant key recover: plaintext matches original issued key');
    ok(recoverBody.key.sealedStorage.enabled === true, 'Tenant key recover: sealed metadata preserved');

    const recoverReplayRes = await fetch(`${base}/api/v1/admin/tenant-keys/${createAccountBody.initialKey.id}/recover`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer admin-tenant-key-vault',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'tenant-key-vault-recover-1',
      },
      body: JSON.stringify({ reason: 'drill' }),
    });
    ok(recoverReplayRes.status === 200, 'Tenant key recover replay: 200');
    ok(recoverReplayRes.headers.get('x-attestor-idempotent-replay') === 'true', 'Tenant key recover replay: replay header set');

    const accountRes = await fetch(`${base}/api/v1/account`, {
      headers: { Authorization: `Bearer ${recoverBody.key.apiKey}` },
    });
    ok(accountRes.status === 200, 'Recovered tenant key: account summary still accessible');

    const auditRes = await fetch(`${base}/api/v1/admin/audit?action=tenant_key.recovered`, {
      headers: { Authorization: 'Bearer admin-tenant-key-vault' },
    });
    ok(auditRes.status === 200, 'Admin audit recovered filter: 200');
    const auditBody = await auditRes.json() as any;
    ok(auditBody.records.length >= 1, 'Admin audit recovered filter: record present');
    ok(auditBody.records[0].metadata.provider === 'vault_transit', 'Admin audit recovered filter: provider metadata present');

    process.env.ATTESTOR_TENANT_KEY_RECOVERY_ENABLED = 'false';
    const disabledRecoverRes = await fetch(`${base}/api/v1/admin/tenant-keys/${createAccountBody.initialKey.id}/recover`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer admin-tenant-key-vault',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'tenant-key-vault-recover-disabled',
      },
      body: JSON.stringify({ reason: 'disabled-check' }),
    });
    ok(disabledRecoverRes.status === 409, 'Tenant key recover disabled: 409');
    process.env.ATTESTOR_TENANT_KEY_RECOVERY_ENABLED = 'true';

    const revokeRes = await fetch(`${base}/api/v1/admin/tenant-keys/${createAccountBody.initialKey.id}/revoke`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer admin-tenant-key-vault',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'tenant-key-vault-revoke-1',
      },
      body: JSON.stringify({}),
    });
    ok(revokeRes.status === 200, 'Tenant key revoke after recovery: 200');

    const revokedRecoverRes = await fetch(`${base}/api/v1/admin/tenant-keys/${createAccountBody.initialKey.id}/recover`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer admin-tenant-key-vault',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'tenant-key-vault-recover-revoked',
      },
      body: JSON.stringify({ reason: 'revoked-check' }),
    });
    ok(revokedRecoverRes.status === 409, 'Tenant key recover revoked: 409');

    console.log(`  Live tenant key Vault recovery: ${passed} passed, 0 failed`);
  } finally {
    server.close();
    await new Promise((resolve) => vaultServer.close(() => resolve(undefined)));
    await resetSharedControlPlaneStoreForTests();
    await pg.stop();
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
