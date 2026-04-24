import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import EmbeddedPostgres from 'embedded-postgres';
import {
  buildFinanceFilingReleaseMaterial,
  buildFinanceFilingReleaseObservation,
  createFinanceFilingReleaseCandidateFromReport,
  finalizeFinanceFilingReleaseDecision,
} from '../src/release-kernel/finance-record-release.js';
import { createReleaseDecisionEngine } from '../src/release-kernel/release-decision-engine.js';
import { createInMemoryReleaseDecisionLogWriter } from '../src/release-kernel/release-decision-log.js';
import { createReleaseDecisionSkeleton } from '../src/release-kernel/object-model.js';
import {
  createFinanceReviewerQueueItem,
} from '../src/release-kernel/reviewer-queue.js';
import {
  ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV,
  closeReleaseAuthorityStorePoolForTests,
  listReleaseAuthorityComponents,
  resetReleaseAuthorityStoreForTests,
} from '../src/service/release-authority-store.js';
import { createSharedPolicyControlPlaneStore } from '../src/service/release-policy-authority-store.js';
import { createSharedReleaseReviewerQueueStore } from '../src/service/release-reviewer-queue-store.js';
import { createSharedReleaseTokenIntrospectionStore } from '../src/service/release-token-introspection-store.js';
import { createApiHttpRouteRuntime } from '../src/service/bootstrap/api-route-runtime.js';
import { createRegistries } from '../src/service/bootstrap/registries.js';
import { registerAllRoutes } from '../src/service/bootstrap/routes.js';
import {
  ATTESTOR_RUNTIME_PROFILE_ENV,
} from '../src/service/bootstrap/runtime-profile.js';
import { shutdownTenantRuntimeBackends } from '../src/service/runtime/tenant-runtime.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a TCP port.'));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

type RuntimeWithApp = Awaited<ReturnType<typeof createRuntimeWithApp>>;
interface SharedRuntimeSecurity {
  releaseRuntimeDurability: { ready: boolean };
  releaseRuntimeRequestPathDiagnostics: {
    usesSharedAuthorityStores: boolean;
    contract: string;
    blockers: readonly string[];
  };
}

async function createRuntimeWithApp(instanceId: string) {
  const runtime = await createApiHttpRouteRuntime({
    registries: createRegistries(),
    serviceInstanceId: instanceId,
    startTime: Date.now(),
  });
  const app = new Hono();
  registerAllRoutes(app, runtime);
  return { runtime, app };
}

function runtimeSecurity(runtime: RuntimeWithApp['runtime']): SharedRuntimeSecurity {
  return runtime.infra.security as SharedRuntimeSecurity;
}

function adminHeaders(): HeadersInit {
  return { authorization: 'Bearer step08-admin' };
}

function jsonAdminHeaders(): HeadersInit {
  return {
    ...adminHeaders(),
    'content-type': 'application/json',
  };
}

async function postJson(app: Hono, path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: jsonAdminHeaders(),
    body: JSON.stringify(body),
  });
}

function makePackBody(packId: string, owner: string): Record<string, unknown> {
  return {
    pack: {
      id: packId,
      name: `Step 08 ${owner} shared policy pack`,
      description: 'Multi-instance shared authority policy mutation proof.',
      lifecycleState: 'draft',
      owners: [owner],
      labels: ['production-shared', 'step-08', owner],
    },
    reasonCode: 'step-08-multi-instance',
    rationale: `Prove shared policy mutation from ${owner}.`,
  };
}

function makeFinanceReport(runId: string, exposureUsd: number) {
  return {
    runId,
    decision: 'pending_approval',
    certificate: { certificateId: `cert_${runId}` },
    evidenceChain: { terminalHash: `chain_${runId}`, intact: true },
    execution: {
      success: true,
      rows: [
        {
          counterparty_name: 'Bank of Nova Scotia',
          exposure_usd: exposureUsd,
          credit_rating: 'AA-',
          sector: 'Banking',
        },
      ],
    },
    liveProof: { mode: 'live_runtime', consistent: true },
    receipt: { receiptStatus: 'withheld' },
    oversight: { status: 'pending' },
    escrow: { state: 'held' },
    filingReadiness: { status: 'internal_report_ready' },
    audit: { chainIntact: true },
    attestation: { manifestHash: `manifest_${runId}` },
  } as any;
}

function makeQueueItem(runId: string, exposureUsd: number) {
  const report = makeFinanceReport(runId, exposureUsd);
  const candidate = createFinanceFilingReleaseCandidateFromReport(report);
  assert.ok(candidate, 'expected finance filing candidate');
  const material = buildFinanceFilingReleaseMaterial(candidate);
  const decisionLog = createInMemoryReleaseDecisionLogWriter();
  const engine = createReleaseDecisionEngine({ decisionLog });
  const evaluation = engine.evaluateWithDeterministicChecks(
    {
      id: `decision-${runId}`,
      createdAt: new Date().toISOString(),
      outputHash: material.hashBundle.outputHash,
      consequenceHash: material.hashBundle.consequenceHash,
      outputContract: material.outputContract,
      capabilityBoundary: material.capabilityBoundary,
      requester: {
        id: 'svc.attestor.api',
        type: 'service',
        displayName: 'Attestor API',
      },
      target: material.target,
    },
    buildFinanceFilingReleaseObservation(material, report),
  );
  const finalized = finalizeFinanceFilingReleaseDecision(evaluation.decision, report);
  return createFinanceReviewerQueueItem({
    decision: finalized,
    candidate,
    report,
    logEntries: decisionLog.entries(),
  });
}

function makeAcceptedDecision(id: string) {
  return createReleaseDecisionSkeleton({
    id,
    createdAt: new Date().toISOString(),
    status: 'accepted',
    policyVersion: 'finance.structured-record-release.v1',
    policyHash: 'finance.structured-record-release.v1',
    outputHash: `sha256:output-${id}`,
    consequenceHash: `sha256:consequence-${id}`,
    outputContract: {
      artifactType: 'financial-reporting.record-field',
      expectedShape: 'structured financial record payload',
      consequenceType: 'record',
      riskClass: 'R4',
    },
    capabilityBoundary: {
      allowedTools: ['xbrl-export'],
      allowedTargets: ['sec.edgar.filing.prepare'],
      allowedDataDomains: ['financial-reporting'],
    },
    requester: {
      id: 'svc.reporting-bot',
      type: 'service',
    },
    target: {
      kind: 'record-store',
      id: 'finance.reporting.record-store',
    },
  });
}

async function assertRuntimeCutover(
  label: string,
  runtime: RuntimeWithApp['runtime'],
): Promise<void> {
  const security = runtimeSecurity(runtime);
  equal(
    security.releaseRuntimeDurability.ready,
    true,
    `${label}: production-shared durability is ready`,
  );
  equal(
    security.releaseRuntimeRequestPathDiagnostics.contract,
    'async-shared-authority-stores',
    `${label}: request path advertises the async shared-store contract`,
  );
  equal(
    security.releaseRuntimeRequestPathDiagnostics.usesSharedAuthorityStores,
    true,
    `${label}: request path uses shared authority stores`,
  );
  equal(
    security.releaseRuntimeRequestPathDiagnostics.blockers.length,
    0,
    `${label}: request path has no cutover blockers`,
  );
  const components = await listReleaseAuthorityComponents();
  ok(
    components.every((component) => component.metadata.bootstrapWired === true),
    `${label}: all authority components are marked bootstrap-wired`,
  );
}

async function assertPolicyRouteReadsPack(
  label: string,
  app: Hono,
  packId: string,
): Promise<void> {
  const response = await app.request(`/api/v1/admin/release-policy/packs/${packId}`, {
    headers: adminHeaders(),
  });
  equal(response.status, 200, `${label}: policy pack is readable through the HTTP route`);
  const body = await response.json() as { pack?: { id?: string } };
  equal(body.pack?.id, packId, `${label}: policy route returns the expected pack id`);
}

async function run(): Promise<void> {
  const previousProfile = process.env[ATTESTOR_RUNTIME_PROFILE_ENV];
  const previousAuthorityUrl = process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV];
  const previousAdminKey = process.env.ATTESTOR_ADMIN_API_KEY;
  const tempRoot = mkdtempSync(join(tmpdir(), 'attestor-production-shared-step08-'));
  const pgPort = await reservePort();
  const pg = new EmbeddedPostgres({
    databaseDir: join(tempRoot, 'pg'),
    user: 'release_authority_step08',
    password: 'release_authority_step08',
    port: pgPort,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  try {
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('attestor_release_authority');
    process.env[ATTESTOR_RUNTIME_PROFILE_ENV] = 'production-shared';
    process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV] =
      `postgres://release_authority_step08:release_authority_step08@localhost:${pgPort}/attestor_release_authority`;
    process.env.ATTESTOR_ADMIN_API_KEY = 'step08-admin';

    const runtimeA = await createRuntimeWithApp('production-shared-step08-a');
    const runtimeB = await createRuntimeWithApp('production-shared-step08-b');
    await assertRuntimeCutover('Runtime A', runtimeA.runtime);
    await assertRuntimeCutover('Runtime B', runtimeB.runtime);

    const controlPlaneA = await runtimeA.app.request('/api/v1/admin/release-policy/control-plane', {
      headers: adminHeaders(),
    });
    const controlPlaneB = await runtimeB.app.request('/api/v1/admin/release-policy/control-plane', {
      headers: adminHeaders(),
    });
    equal(controlPlaneA.status, 200, 'Step 08: runtime A opens the guarded policy route');
    equal(controlPlaneB.status, 200, 'Step 08: runtime B opens the guarded policy route');
    equal(
      ((await controlPlaneA.json()) as { storeKind: string }).storeKind,
      'postgres',
      'Step 08: runtime A policy route is backed by PostgreSQL',
    );
    equal(
      ((await controlPlaneB.json()) as { storeKind: string }).storeKind,
      'postgres',
      'Step 08: runtime B policy route is backed by PostgreSQL',
    );

    const packA = `step08-pack-a-${Date.now().toString(36)}`;
    const packB = `step08-pack-b-${Date.now().toString(36)}`;
    const [packAResponse, packBResponse] = await Promise.all([
      postJson(runtimeA.app, '/api/v1/admin/release-policy/packs', makePackBody(packA, 'runtime-a')),
      postJson(runtimeB.app, '/api/v1/admin/release-policy/packs', makePackBody(packB, 'runtime-b')),
    ]);
    equal(packAResponse.status, 200, 'Step 08: runtime A policy mutation succeeds');
    equal(packBResponse.status, 200, 'Step 08: runtime B policy mutation succeeds');
    await assertPolicyRouteReadsPack('Step 08: runtime B sees runtime A mutation', runtimeB.app, packA);
    await assertPolicyRouteReadsPack('Step 08: runtime A sees runtime B mutation', runtimeA.app, packB);

    const sharedPolicyStore = createSharedPolicyControlPlaneStore();
    equal(
      (await sharedPolicyStore.getPack(packA))?.id,
      packA,
      'Step 08: runtime A policy mutation persists in the shared authority store',
    );
    equal(
      (await sharedPolicyStore.getPack(packB))?.id,
      packB,
      'Step 08: runtime B policy mutation persists in the shared authority store',
    );

    const auditVerify = await runtimeA.app.request('/api/v1/admin/release-policy/audit/verify', {
      headers: adminHeaders(),
    });
    equal(auditVerify.status, 200, 'Step 08: policy mutation audit verification route succeeds');
    const auditVerifyBody = await auditVerify.json() as {
      verification?: { valid?: boolean };
      latestEntryDigest?: string | null;
    };
    equal(
      auditVerifyBody.verification?.valid,
      true,
      'Step 08: policy mutation audit chain remains valid after concurrent writes',
    );
    ok(
      typeof auditVerifyBody.latestEntryDigest === 'string',
      'Step 08: policy mutation audit chain records a durable head digest',
    );

    const queueA = createSharedReleaseReviewerQueueStore();
    const queueB = createSharedReleaseReviewerQueueStore();
    await queueA.upsert(makeQueueItem('step08-queue-a', 250000000));
    await queueB.upsert(makeQueueItem('step08-queue-b', 260000000));
    equal(
      (await queueA.summary()).pendingRecords,
      2,
      'Step 08: reviewer-queue fixtures are both pending before concurrent claims',
    );
    const claimTime = new Date(Date.now() + 60_000).toISOString();
    const [claimA, claimB, claimC] = await Promise.all([
      queueA.claimNextPending({ claimedBy: 'runtime-a', claimedAt: claimTime, leaseMs: 120_000 }),
      queueB.claimNextPending({ claimedBy: 'runtime-b', claimedAt: claimTime, leaseMs: 120_000 }),
      queueA.claimNextPending({ claimedBy: 'runtime-c', claimedAt: claimTime, leaseMs: 120_000 }),
    ]);
    ok(claimA, 'Step 08: first reviewer-queue consumer claims an item');
    ok(claimB, 'Step 08: second reviewer-queue consumer claims an item');
    equal(claimC, null, 'Step 08: third reviewer-queue consumer gets no duplicate claim');
    ok(
      claimA!.record.detail.id !== claimB!.record.detail.id,
      'Step 08: concurrent reviewer-queue claims select distinct records',
    );
    equal(
      (await queueA.summary()).activeClaims,
      2,
      'Step 08: reviewer-queue active claims survive shared-store accounting',
    );

    const tokenDecision = makeAcceptedDecision('decision-step08-token-use');
    const issuedToken = await runtimeA.runtime.services.httpRoutes.releaseReview.apiReleaseTokenIssuer.issue({
      decision: tokenDecision,
      issuedAt: new Date().toISOString(),
      tokenId: 'rt_step08_shared_use',
      ttlSeconds: 3600,
    });
    await runtimeA.runtime.services.httpRoutes.releaseReview.apiReleaseIntrospectionStore.registerIssuedToken({
      issuedToken,
      decision: tokenDecision,
    });
    const [firstUse, secondUse] = await Promise.all([
      runtimeA.runtime.services.httpRoutes.releaseReview.apiReleaseIntrospectionStore.recordTokenUse({
        tokenId: issuedToken.tokenId,
        usedAt: new Date().toISOString(),
        resourceServerId: 'runtime-a',
      }),
      runtimeB.runtime.services.httpRoutes.releaseReview.apiReleaseIntrospectionStore.recordTokenUse({
        tokenId: issuedToken.tokenId,
        usedAt: new Date().toISOString(),
        resourceServerId: 'runtime-b',
      }),
    ]);
    equal(
      [firstUse, secondUse].filter((result) => result.accepted).length,
      1,
      'Step 08: concurrent token use consumes a single-use release token once',
    );
    equal(
      (await runtimeB.runtime.services.httpRoutes.admin.apiReleaseIntrospectionStore.findToken(
        issuedToken.tokenId,
      ))?.status,
      'consumed',
      'Step 08: token consumption is visible through the second runtime',
    );

    const revocableDecision = makeAcceptedDecision('decision-step08-token-revoke');
    const revocableToken = await runtimeA.runtime.services.httpRoutes.releaseReview.apiReleaseTokenIssuer.issue({
      decision: revocableDecision,
      issuedAt: new Date().toISOString(),
      tokenId: 'rt_step08_shared_revoke',
      ttlSeconds: 3600,
    });
    await runtimeA.runtime.services.httpRoutes.releaseReview.apiReleaseIntrospectionStore.registerIssuedToken({
      issuedToken: revocableToken,
      decision: revocableDecision,
    });
    const revokeResponse = await postJson(
      runtimeB.app,
      `/api/v1/admin/release-tokens/${revocableToken.tokenId}/revoke`,
      { reason: 'step-08 multi-instance revocation' },
    );
    equal(revokeResponse.status, 200, 'Step 08: runtime B revokes a token issued by runtime A');
    equal(
      (await createSharedReleaseTokenIntrospectionStore().findToken(revocableToken.tokenId))?.status,
      'revoked',
      'Step 08: token revocation persists in the shared authority store',
    );

    await closeReleaseAuthorityStorePoolForTests();
    const runtimeC = await createRuntimeWithApp('production-shared-step08-reconnect');
    await assertRuntimeCutover('Runtime C after reconnect', runtimeC.runtime);
    await assertPolicyRouteReadsPack('Step 08: reconnect runtime sees runtime A mutation', runtimeC.app, packA);
    await assertPolicyRouteReadsPack('Step 08: reconnect runtime sees runtime B mutation', runtimeC.app, packB);
    equal(
      (await createSharedReleaseReviewerQueueStore().summary()).activeClaims,
      2,
      'Step 08: reviewer-queue claims remain visible after pool reconnect',
    );
    equal(
      (await createSharedReleaseTokenIntrospectionStore().findToken(issuedToken.tokenId))?.status,
      'consumed',
      'Step 08: consumed token state survives pool reconnect',
    );
    equal(
      (await createSharedReleaseTokenIntrospectionStore().findToken(revocableToken.tokenId))?.status,
      'revoked',
      'Step 08: revoked token state survives pool reconnect',
    );
  } finally {
    try {
      await shutdownTenantRuntimeBackends();
    } catch {}
    try {
      await resetReleaseAuthorityStoreForTests();
    } catch {}
    if (previousProfile === undefined) {
      delete process.env[ATTESTOR_RUNTIME_PROFILE_ENV];
    } else {
      process.env[ATTESTOR_RUNTIME_PROFILE_ENV] = previousProfile;
    }
    if (previousAuthorityUrl === undefined) {
      delete process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV];
    } else {
      process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV] = previousAuthorityUrl;
    }
    if (previousAdminKey === undefined) {
      delete process.env.ATTESTOR_ADMIN_API_KEY;
    } else {
      process.env.ATTESTOR_ADMIN_API_KEY = previousAdminKey;
    }
    try {
      await pg.stop();
    } catch {}
    rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log(`Production-shared multi-instance recovery tests: ${passed} passed, 0 failed`);
}

run().catch((error) => {
  console.error('Production-shared multi-instance recovery tests failed:', error);
  process.exit(1);
});
