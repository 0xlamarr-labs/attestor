import assert from 'node:assert/strict';
import { Hono, type Context } from 'hono';
import { generateKeyPair } from '../src/signing/keys.js';
import {
  createPolicyBundleEntry,
  createPolicyBundleManifest,
  createPolicyPackMetadata,
} from '../src/release-policy-control-plane/object-model.js';
import {
  computePolicyBundleEntryDigest,
  createSignablePolicyBundleArtifact,
} from '../src/release-policy-control-plane/bundle-format.js';
import { createPolicyBundleSigner } from '../src/release-policy-control-plane/bundle-signing.js';
import {
  createInMemoryPolicyControlPlaneStore,
  type PolicyControlPlaneStore,
} from '../src/release-policy-control-plane/store.js';
import {
  createInMemoryPolicyMutationAuditLogWriter,
  type PolicyMutationAuditLogWriter,
} from '../src/release-policy-control-plane/audit-log.js';
import { createPolicyActivationTarget } from '../src/release-policy-control-plane/types.js';
import { registerReleasePolicyControlRoutes } from '../src/service/http/routes/release-policy-control-routes.js';
import { policy } from '../src/release-layer/index.js';

type TestAppFixture = {
  app: Hono;
  store: PolicyControlPlaneStore;
  auditLog: PolicyMutationAuditLogWriter;
  adminAuditRecords: Array<Record<string, unknown>>;
};

function adminHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: 'Bearer admin-secret',
    'content-type': 'application/json',
    ...extra,
  };
}

function sampleBundleReference(bundleId = 'bundle_finance_core_2026_04_18') {
  return {
    packId: 'finance-core',
    bundleId,
    bundleVersion: bundleId.replace('bundle_', '').replaceAll('_', '.'),
    digest: `sha256:${bundleId}`,
  } as const;
}

function samplePackMetadata(bundleId = 'bundle_finance_core_2026_04_18') {
  return createPolicyPackMetadata({
    id: 'finance-core',
    name: 'Finance Core',
    description: 'Finance release policy pack.',
    lifecycleState: 'published',
    owners: ['risk-platform'],
    labels: ['finance', 'release-gateway'],
    createdAt: '2026-04-18T09:00:00.000Z',
    latestBundleRef: sampleBundleReference(bundleId),
  });
}

function createEntry() {
  const definition = policy.createFirstHardGatewayReleasePolicy();
  const target = createPolicyActivationTarget({
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
    accountId: 'account-major',
    domainId: 'finance',
    wedgeId: 'finance.record.release',
    consequenceType: 'record',
    riskClass: 'R4',
    planId: 'enterprise',
  });
  const provisional = createPolicyBundleEntry({
    id: 'entry-record-r4',
    scopeTarget: target,
    definition,
    policyHash: 'sha256:placeholder',
  });

  return createPolicyBundleEntry({
    id: 'entry-record-r4',
    scopeTarget: target,
    definition,
    policyHash: computePolicyBundleEntryDigest(provisional),
  });
}

function createSignedBundle(bundleId = 'bundle_finance_core_2026_04_18') {
  const pack = samplePackMetadata(bundleId);
  const manifest = createPolicyBundleManifest({
    bundle: sampleBundleReference(bundleId),
    pack,
    generatedAt: '2026-04-18T09:05:00.000Z',
    entries: [createEntry()],
  });
  const artifact = createSignablePolicyBundleArtifact(pack, manifest);
  const keyPair = generateKeyPair();
  const signer = createPolicyBundleSigner({
    issuer: 'attestor.policy-control-plane',
    privateKeyPem: keyPair.privateKeyPem,
    publicKeyPem: keyPair.publicKeyPem,
  });
  const signedBundle = signer.sign({
    artifact,
    signedAt: '2026-04-18T09:06:00.000Z',
  });

  return {
    pack,
    manifest,
    artifact,
    signedBundle,
    verificationKey: signer.exportVerificationKey(),
  };
}

function sampleTarget() {
  return {
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
    accountId: 'account-major',
    domainId: 'finance',
    wedgeId: 'finance.record.release',
    consequenceType: 'record',
    riskClass: 'R4',
    planId: 'enterprise',
  } as const;
}

function sampleResolverInput() {
  return {
    target: sampleTarget(),
    outputContract: {
      artifactType: 'financial-reporting.record-field',
      expectedShape: 'structured financial record payload',
      consequenceType: 'record',
      riskClass: 'R4',
    },
    capabilityBoundary: {
      allowedTools: ['record-commit'],
      allowedTargets: ['finance.reporting.record-store'],
      allowedDataDomains: ['financial-reporting'],
    },
    targetKind: 'record-store',
    rolloutContext: {
      requestId: 'req_policy_admin_route',
      outputHash: 'sha256:output',
      requesterId: 'user_policy_admin',
      targetId: 'finance.reporting.record-store',
    },
  } as const;
}

function createFixture(options?: { idempotency?: boolean }): TestAppFixture {
  const app = new Hono();
  const store = createInMemoryPolicyControlPlaneStore();
  const auditLog = createInMemoryPolicyMutationAuditLogWriter();
  const adminAuditRecords: Array<Record<string, unknown>> = [];
  const idempotency = new Map<string, {
    routeId: string;
    requestHash: string;
    statusCode: number;
    responseBody: Record<string, unknown>;
  }>();

  registerReleasePolicyControlRoutes(app, {
    currentAdminAuthorized(c: Context): Response | null {
      const token = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
      return token === 'admin-secret'
        ? null
        : c.json({ error: 'Valid admin API key required.' }, 401);
    },
    policyControlPlaneStore: store,
    policyMutationAuditLog: auditLog,
    adminMutationRequest: options?.idempotency
      ? async (c, routeId, requestPayload) => {
          const idempotencyKey = c.req.header('Idempotency-Key')?.trim() ?? null;
          const requestHash = JSON.stringify({ routeId, requestPayload });
          if (!idempotencyKey) {
            return { idempotencyKey, requestHash };
          }
          const existing = idempotency.get(idempotencyKey);
          if (!existing) {
            return { idempotencyKey, requestHash };
          }
          if (existing.routeId !== routeId || existing.requestHash !== requestHash) {
            return c.json({ error: 'idempotency conflict' }, 409);
          }
          return new Response(JSON.stringify(existing.responseBody), {
            status: existing.statusCode,
            headers: {
              'content-type': 'application/json; charset=UTF-8',
              'x-attestor-idempotent-replay': 'true',
            },
          });
        }
      : undefined,
    finalizeAdminMutation: options?.idempotency
      ? async (input) => {
          if (input.idempotencyKey) {
            idempotency.set(input.idempotencyKey, {
              routeId: input.routeId,
              requestHash: input.audit.requestHash ?? '',
              statusCode: input.statusCode,
              responseBody: input.responseBody,
            });
          }
          adminAuditRecords.push(input.audit);
          return input.responseBody;
        }
      : undefined,
  });

  return { app, store, auditLog, adminAuditRecords };
}

async function requestJson(
  app: Hono,
  path: string,
  options?: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  },
): Promise<{ status: number; headers: Headers; body: any }> {
  const response = await app.request(path, {
    method: options?.method ?? 'GET',
    headers: options?.headers ?? adminHeaders(),
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  };
}

async function publishBundleThroughRoutes(fixture: TestAppFixture) {
  const bundle = createSignedBundle();
  await requestJson(fixture.app, '/api/v1/admin/release-policy/packs', {
    method: 'POST',
    body: { pack: bundle.pack },
  });
  await requestJson(fixture.app, '/api/v1/admin/release-policy/bundles', {
    method: 'POST',
    body: {
      manifest: bundle.manifest,
      artifact: bundle.artifact,
      signedBundle: bundle.signedBundle,
      verificationKey: bundle.verificationKey,
      storedAt: '2026-04-18T09:07:00.000Z',
    },
  });
  return bundle;
}

async function testAdminAuthIsRequired(): Promise<void> {
  const fixture = createFixture();
  const response = await requestJson(fixture.app, '/api/v1/admin/release-policy/packs', {
    headers: { Authorization: 'Bearer wrong' },
  });

  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'Valid admin API key required.');
}

async function testPackAndBundleSurfaces(): Promise<void> {
  const fixture = createFixture();
  const bundle = await publishBundleThroughRoutes(fixture);

  const packs = await requestJson(fixture.app, '/api/v1/admin/release-policy/packs');
  const versions = await requestJson(
    fixture.app,
    '/api/v1/admin/release-policy/packs/finance-core/versions',
  );
  const detail = await requestJson(
    fixture.app,
    `/api/v1/admin/release-policy/packs/finance-core/bundles/${bundle.manifest.bundle.bundleId}`,
  );

  assert.equal(packs.status, 200);
  assert.equal(packs.body.packs.length, 1);
  assert.equal(versions.body.versions.length, 1);
  assert.equal(versions.body.versions[0].signed, true);
  assert.equal(detail.body.bundle.signedBundle, null);
  assert.equal(detail.body.bundle.artifact.payloadDigest, bundle.artifact.payloadDigest);
}

async function testActivationAndRollbackSurfaces(): Promise<void> {
  const fixture = createFixture();
  await publishBundleThroughRoutes(fixture);

  const activation = await requestJson(fixture.app, '/api/v1/admin/release-policy/activations', {
    method: 'POST',
    body: {
      activationId: 'activation_prod_current',
      packId: 'finance-core',
      bundleId: 'bundle_finance_core_2026_04_18',
      target: sampleTarget(),
      rationale: 'Promote finance record release policy.',
    },
  });
  const rollback = await requestJson(
    fixture.app,
    '/api/v1/admin/release-policy/activations/activation_prod_current/rollback',
    {
      method: 'POST',
      body: {
        activationId: 'activation_prod_rollback',
        rationale: 'Exercise rollback route.',
      },
    },
  );
  const activations = await requestJson(fixture.app, '/api/v1/admin/release-policy/activations');

  assert.equal(activation.status, 201);
  assert.equal(activation.body.activation.state, 'active');
  assert.equal(rollback.status, 201);
  assert.equal(rollback.body.activation.operationType, 'rollback-activation');
  assert.equal(activations.body.activations.length, 2);
  assert.deepEqual(
    fixture.auditLog.entries().map((entry) => entry.action),
    ['create-pack', 'publish-bundle', 'activate-bundle', 'rollback-activation'],
  );
}

async function testResolveAndSimulationSurfaces(): Promise<void> {
  const fixture = createFixture();
  await publishBundleThroughRoutes(fixture);
  await requestJson(fixture.app, '/api/v1/admin/release-policy/activations', {
    method: 'POST',
    body: {
      activationId: 'activation_prod_current',
      packId: 'finance-core',
      bundleId: 'bundle_finance_core_2026_04_18',
      target: sampleTarget(),
      rationale: 'Promote finance record release policy.',
    },
  });

  const resolution = await requestJson(fixture.app, '/api/v1/admin/release-policy/resolve', {
    method: 'POST',
    body: { resolverInput: sampleResolverInput() },
  });
  const simulation = await requestJson(fixture.app, '/api/v1/admin/release-policy/simulations', {
    method: 'POST',
    body: {
      resolverInput: sampleResolverInput(),
      overlay: {
        packId: 'finance-core',
        bundleId: 'bundle_finance_core_2026_04_18',
        target: sampleTarget(),
        activationId: 'activation_simulated',
      },
    },
  });

  assert.equal(resolution.status, 200);
  assert.equal(resolution.body.resolution.status, 'resolved');
  assert.equal(simulation.status, 200);
  assert.equal(simulation.body.preview.dryRun.simulated.status, 'resolved');
  assert.equal(simulation.body.preview.bundleImpact.candidateBundleId, 'bundle_finance_core_2026_04_18');
}

async function testAuditSurfaceFiltersAndSnapshotDisclosure(): Promise<void> {
  const fixture = createFixture();
  await publishBundleThroughRoutes(fixture);

  const filtered = await requestJson(
    fixture.app,
    '/api/v1/admin/release-policy/audit?action=publish-bundle',
  );
  const withSnapshot = await requestJson(
    fixture.app,
    '/api/v1/admin/release-policy/audit?action=publish-bundle&includeSnapshots=true',
  );
  const verification = await requestJson(fixture.app, '/api/v1/admin/release-policy/audit/verify');

  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.entries.length, 1);
  assert.equal(filtered.body.entries[0].mutationSnapshot, undefined);
  assert.equal(withSnapshot.body.entries[0].mutationSnapshot.bundleId, 'bundle_finance_core_2026_04_18');
  assert.equal(verification.body.verification.valid, true);
}

async function testIdempotentMutationReplayDoesNotAppendAuditTwice(): Promise<void> {
  const fixture = createFixture({ idempotency: true });
  const bundle = createSignedBundle();
  const body = { pack: bundle.pack };

  const first = await requestJson(fixture.app, '/api/v1/admin/release-policy/packs', {
    method: 'POST',
    headers: adminHeaders({ 'Idempotency-Key': 'idem-policy-pack' }),
    body,
  });
  const second = await requestJson(fixture.app, '/api/v1/admin/release-policy/packs', {
    method: 'POST',
    headers: adminHeaders({ 'Idempotency-Key': 'idem-policy-pack' }),
    body,
  });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.headers.get('x-attestor-idempotent-replay'), 'true');
  assert.equal(fixture.auditLog.entries().length, 1);
  assert.equal(fixture.adminAuditRecords.length, 1);
}

async function run(): Promise<void> {
  await testAdminAuthIsRequired();
  await testPackAndBundleSurfaces();
  await testActivationAndRollbackSurfaces();
  await testResolveAndSimulationSurfaces();
  await testAuditSurfaceFiltersAndSnapshotDisclosure();
  await testIdempotentMutationReplayDoesNotAppendAuditTwice();
  console.log('Release policy control-plane admin-route tests: 6 passed, 0 failed');
}

await run();
