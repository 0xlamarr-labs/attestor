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
  createInMemoryPolicyActivationApprovalStore,
  type PolicyActivationApprovalStore,
} from '../src/release-policy-control-plane/activation-approvals.js';
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
  approvalStore: PolicyActivationApprovalStore;
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
  const approvalStore = createInMemoryPolicyActivationApprovalStore();
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
    policyActivationApprovalStore: approvalStore,
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

  return { app, store, approvalStore, auditLog, adminAuditRecords };
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

async function requestAndApproveActivation(fixture: TestAppFixture): Promise<string> {
  const request = await requestJson(fixture.app, '/api/v1/admin/release-policy/activation-approvals', {
    method: 'POST',
    headers: adminHeaders({
      'x-attestor-admin-actor-id': 'requester_policy_admin',
      'x-attestor-admin-actor-role': 'policy-admin',
    }),
    body: {
      approvalRequestId: 'approval_prod_current',
      packId: 'finance-core',
      bundleId: 'bundle_finance_core_2026_04_18',
      target: sampleTarget(),
      rationale: 'Request policy activation approval.',
      requestedAt: '2026-04-18T09:08:00.000Z',
      expiresAt: '2026-04-19T09:08:00.000Z',
    },
  });
  assert.equal(request.status, 201);
  assert.equal(request.body.approvalRequest.state, 'pending');
  assert.equal(request.body.approvalRequest.requirement.requiredApprovals, 2);

  const first = await requestJson(
    fixture.app,
    '/api/v1/admin/release-policy/activation-approvals/approval_prod_current/approve',
    {
      method: 'POST',
      headers: adminHeaders({
        'x-attestor-admin-actor-id': 'risk_owner',
        'x-attestor-admin-actor-role': 'risk-owner',
      }),
      body: {
        rationale: 'Risk owner approves activation.',
        decidedAt: '2026-04-18T09:09:00.000Z',
      },
    },
  );
  assert.equal(first.status, 200);
  assert.equal(first.body.approvalRequest.state, 'pending');

  const second = await requestJson(
    fixture.app,
    '/api/v1/admin/release-policy/activation-approvals/approval_prod_current/approve',
    {
      method: 'POST',
      headers: adminHeaders({
        'x-attestor-admin-actor-id': 'compliance_officer',
        'x-attestor-admin-actor-role': 'compliance-officer',
      }),
      body: {
        rationale: 'Compliance approves activation.',
        decidedAt: '2026-04-18T09:10:00.000Z',
      },
    },
  );
  assert.equal(second.status, 200);
  assert.equal(second.body.approvalRequest.state, 'approved');

  return 'approval_prod_current';
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

async function testBundleDetailSupportsCacheHeadersAndConditionalRevalidation(): Promise<void> {
  const fixture = createFixture();
  const bundle = await publishBundleThroughRoutes(fixture);
  const path =
    `/api/v1/admin/release-policy/packs/finance-core/bundles/` +
    bundle.manifest.bundle.bundleId;
  const first = await requestJson(fixture.app, path);
  const etag = first.headers.get('etag');
  const second = await fixture.app.request(path, {
    method: 'GET',
    headers: adminHeaders({
      'if-none-match': etag ?? '',
    }),
  });

  assert.equal(first.status, 200);
  assert.ok(etag);
  assert.equal(first.headers.get('cache-control'), 'private, max-age=60, stale-if-error=300');
  assert.equal(first.headers.get('x-attestor-policy-bundle-freshness'), 'fresh');
  assert.equal(first.body.cache.etag, etag);
  assert.equal(second.status, 304);
  assert.equal(second.headers.get('etag'), etag);
}

async function testActivationRequiresApprovalForR4(): Promise<void> {
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

  assert.equal(activation.status, 409);
  assert.equal(activation.body.approval.status, 'approval-required');
  assert.equal(fixture.store.listActivations().length, 0);
}

async function testApprovalRoutesEnforceDualReview(): Promise<void> {
  const fixture = createFixture();
  await publishBundleThroughRoutes(fixture);
  const approvalRequestId = await requestAndApproveActivation(fixture);
  const listed = await requestJson(
    fixture.app,
    '/api/v1/admin/release-policy/activation-approvals?state=approved',
  );

  assert.equal(approvalRequestId, 'approval_prod_current');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.approvalRequests.length, 1);
  assert.deepEqual(
    listed.body.approvalRequests[0].approvedReviewerIds,
    ['compliance_officer', 'risk_owner'],
  );
}

async function testActivationAndRollbackSurfaces(): Promise<void> {
  const fixture = createFixture();
  await publishBundleThroughRoutes(fixture);
  const approvalRequestId = await requestAndApproveActivation(fixture);

  const activation = await requestJson(fixture.app, '/api/v1/admin/release-policy/activations', {
    method: 'POST',
    body: {
      activationId: 'activation_prod_current',
      packId: 'finance-core',
      bundleId: 'bundle_finance_core_2026_04_18',
      approvalRequestId,
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
    [
      'create-pack',
      'publish-bundle',
      'request-activation-approval',
      'approve-activation',
      'approve-activation',
      'activate-bundle',
      'rollback-activation',
    ],
  );
}

async function testEmergencyFreezeAndRollbackRequireBreakGlassAndFailClosed(): Promise<void> {
  const fixture = createFixture({ idempotency: true });
  await publishBundleThroughRoutes(fixture);
  const approvalRequestId = await requestAndApproveActivation(fixture);
  await requestJson(fixture.app, '/api/v1/admin/release-policy/activations', {
    method: 'POST',
    body: {
      activationId: 'activation_prod_current',
      packId: 'finance-core',
      bundleId: 'bundle_finance_core_2026_04_18',
      approvalRequestId,
      target: sampleTarget(),
      rationale: 'Promote finance record release policy.',
    },
  });

  const blockedFreeze = await requestJson(fixture.app, '/api/v1/admin/release-policy/emergency/freeze', {
    method: 'POST',
    headers: adminHeaders({
      'x-attestor-admin-actor-id': 'ordinary_policy_admin',
      'x-attestor-admin-actor-role': 'policy-admin',
    }),
    body: {
      activationId: 'freeze_blocked',
      target: sampleTarget(),
      breakGlass: true,
      reasonCode: 'incident-freeze',
      rationale: 'Attempt emergency freeze with the wrong role.',
    },
  });
  const freeze = await requestJson(fixture.app, '/api/v1/admin/release-policy/emergency/freeze', {
    method: 'POST',
    headers: adminHeaders({
      'x-attestor-admin-actor-id': 'incident_commander',
      'x-attestor-admin-actor-role': 'policy-break-glass',
      'x-attestor-break-glass': 'true',
    }),
    body: {
      activationId: 'freeze_prod_current',
      target: sampleTarget(),
      breakGlass: true,
      reasonCode: 'incident-freeze',
      rationale: 'Freeze policy resolution while the rollout is investigated.',
      freezeReason: 'Suspected bad policy rollout.',
      incidentId: 'INC-2026-04-18-001',
    },
  });
  const frozenResolution = await requestJson(fixture.app, '/api/v1/admin/release-policy/resolve', {
    method: 'POST',
    body: { resolverInput: sampleResolverInput() },
  });
  const rollback = await requestJson(fixture.app, '/api/v1/admin/release-policy/emergency/rollback', {
    method: 'POST',
    headers: adminHeaders({
      'x-attestor-admin-actor-id': 'incident_commander',
      'x-attestor-admin-actor-role': 'policy-break-glass',
      'x-attestor-break-glass': 'true',
    }),
    body: {
      activationId: 'activation_prod_emergency_rollback',
      rollbackTargetActivationId: 'activation_prod_current',
      breakGlass: true,
      reasonCode: 'incident-rollback',
      rationale: 'Restore last known good policy after emergency freeze.',
      incidentId: 'INC-2026-04-18-001',
    },
  });
  const restoredResolution = await requestJson(fixture.app, '/api/v1/admin/release-policy/resolve', {
    method: 'POST',
    body: { resolverInput: sampleResolverInput() },
  });

  assert.equal(blockedFreeze.status, 403);
  assert.equal(freeze.status, 201);
  assert.equal(freeze.body.activation.state, 'frozen');
  assert.equal(freeze.body.activation.operationType, 'freeze-scope');
  assert.equal(frozenResolution.body.resolution.status, 'policy-scope-frozen');
  assert.equal(rollback.status, 201);
  assert.equal(rollback.body.activation.operationType, 'rollback-activation');
  assert.equal(fixture.store.getActivation('freeze_prod_current')?.state, 'rolled-back');
  assert.equal(restoredResolution.body.resolution.status, 'resolved');
  assert.equal(
    fixture.adminAuditRecords.some((record) => record.action === 'policy_activation.emergency_frozen'),
    true,
  );
  assert.equal(
    fixture.adminAuditRecords.some((record) => record.action === 'policy_activation.emergency_rolled_back'),
    true,
  );
  assert.equal(
    fixture.auditLog.entries().some((entry) => entry.action === 'freeze-scope'),
    true,
  );
}

async function testResolveAndSimulationSurfaces(): Promise<void> {
  const fixture = createFixture();
  await publishBundleThroughRoutes(fixture);
  const approvalRequestId = await requestAndApproveActivation(fixture);
  await requestJson(fixture.app, '/api/v1/admin/release-policy/activations', {
    method: 'POST',
    body: {
      activationId: 'activation_prod_current',
      packId: 'finance-core',
      bundleId: 'bundle_finance_core_2026_04_18',
      approvalRequestId,
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
  await testBundleDetailSupportsCacheHeadersAndConditionalRevalidation();
  await testActivationRequiresApprovalForR4();
  await testApprovalRoutesEnforceDualReview();
  await testActivationAndRollbackSurfaces();
  await testEmergencyFreezeAndRollbackRequireBreakGlassAndFailClosed();
  await testResolveAndSimulationSurfaces();
  await testAuditSurfaceFiltersAndSnapshotDisclosure();
  await testIdempotentMutationReplayDoesNotAppendAuditTwice();
  console.log('Release policy control-plane admin-route tests: 10 passed, 0 failed');
}

await run();
