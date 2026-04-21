import assert from 'node:assert/strict';
import { Hono, type Context } from 'hono';
import type { ReleaseActorReference } from '../src/release-layer/index.js';
import {
  createEnforcementRequest,
  createReleasePresentation,
  createVerificationResult,
} from '../src/release-enforcement-plane/object-model.js';
import {
  CACHE_ONLY_ACCEPTED_CACHE_STATES,
  DEFAULT_BREAK_GLASS_MAX_TTL_SECONDS,
  DEFAULT_CACHE_ONLY_MAX_TTL_SECONDS,
  DEFAULT_DEGRADED_MODE_ALLOWED_FAILURE_REASONS,
  RELEASE_DEGRADED_MODE_CONTROL_SPEC_VERSION,
  createDegradedModeGrant,
  createInMemoryDegradedModeGrantStore,
  degradedModeGrantStatus,
  degradedModeScopeFromRequest,
  degradedModeScopeMatches,
  evaluateDegradedMode,
  grantToBreakGlassGrant,
  type DegradedModeGrant,
} from '../src/release-enforcement-plane/degraded-mode.js';
import { registerAdminRoutes } from '../src/service/http/routes/admin-routes.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function deepEqual<T>(actual: T, expected: T, message: string): void {
  assert.deepEqual(actual, expected, message);
  passed += 1;
}

const CHECKED_AT = '2026-04-18T10:00:00.000Z';
const EXPIRES_AT = '2026-04-18T10:15:00.000Z';
const ADMIN_HEADERS = {
  authorization: 'Bearer admin-secret',
  'content-type': 'application/json',
};

function adminActor(id = 'user_release_admin'): ReleaseActorReference {
  return {
    id,
    type: 'user',
    displayName: 'Release Admin',
    role: 'release-enforcement-admin',
  };
}

function sampleScope() {
  return {
    environment: 'prod-eu',
    enforcementPointId: 'filing-record-gateway',
    pointKind: 'record-write-gateway',
    boundaryKind: 'record-write',
    tenantId: 'tenant-finance',
    accountId: 'acct-enterprise',
    workloadId: 'spiffe://attestor/prod/record-gateway',
    audience: 'finance-records',
    targetId: 'sec.edgar.filing.prepare',
    consequenceType: 'record',
    riskClass: 'R4',
  } as const;
}

function sampleRequest() {
  return createEnforcementRequest({
    id: 'erq_degraded_mode_1',
    receivedAt: CHECKED_AT,
    enforcementPoint: {
      environment: 'prod-eu',
      enforcementPointId: 'filing-record-gateway',
      pointKind: 'record-write-gateway',
      boundaryKind: 'record-write',
      consequenceType: 'record',
      riskClass: 'R4',
      tenantId: 'tenant-finance',
      accountId: 'acct-enterprise',
      workloadId: 'spiffe://attestor/prod/record-gateway',
      audience: 'finance-records',
    },
    targetId: 'sec.edgar.filing.prepare',
    outputHash: 'sha256:output',
    consequenceHash: 'sha256:consequence',
    releaseTokenId: 'rt_degraded_1',
    releaseDecisionId: 'rd_degraded_1',
  });
}

function sampleVerification(options?: {
  status?: 'valid' | 'invalid' | 'indeterminate';
  cacheState?: 'fresh' | 'stale-allowed' | 'stale-denied' | 'miss' | 'negative-hit';
  failureReasons?: readonly ('introspection-unavailable' | 'fresh-introspection-required' | 'invalid-signature')[];
}) {
  const presentation = createReleasePresentation({
    mode: 'bearer-release-token',
    presentedAt: CHECKED_AT,
    releaseTokenId: 'rt_degraded_1',
    issuer: 'attestor',
    subject: 'releaseDecision:rd_degraded_1',
    audience: 'finance-records',
  });

  return createVerificationResult({
    id: 'vr_degraded_1',
    checkedAt: CHECKED_AT,
    mode: 'hybrid-required',
    status: options?.status ?? 'indeterminate',
    cacheState: options?.cacheState ?? 'stale-allowed',
    degradedState: options?.status === 'valid' ? 'normal' : 'introspection-unavailable',
    presentation,
    releaseDecisionId: 'rd_degraded_1',
    outputHash: 'sha256:output',
    consequenceHash: 'sha256:consequence',
    failureReasons: options?.failureReasons ?? ['introspection-unavailable'],
  });
}

function sampleGrant(overrides?: Partial<Parameters<typeof createDegradedModeGrant>[0]>): DegradedModeGrant {
  return createDegradedModeGrant({
    id: 'dmg_degraded_1',
    state: 'break-glass-open',
    reason: 'availability-restore',
    scope: sampleScope(),
    authorizedBy: adminActor(),
    approvedBy: [adminActor('user_release_approver')],
    authorizedAt: CHECKED_AT,
    startsAt: CHECKED_AT,
    expiresAt: EXPIRES_AT,
    ticketId: 'INC-2026-0418',
    rationale: 'Restore release enforcement during a verified introspection outage.',
    allowedFailureReasons: ['introspection-unavailable', 'fresh-introspection-required'],
    maxUses: 2,
    ...overrides,
  });
}

function testSpecConstants(): void {
  equal(RELEASE_DEGRADED_MODE_CONTROL_SPEC_VERSION, 'attestor.release-enforcement-degraded-mode.v1', 'Degraded mode: schema version is stable');
  deepEqual([...DEFAULT_DEGRADED_MODE_ALLOWED_FAILURE_REASONS], ['introspection-unavailable', 'fresh-introspection-required'], 'Degraded mode: default outage failures are narrow');
  deepEqual([...CACHE_ONLY_ACCEPTED_CACHE_STATES], ['fresh', 'stale-allowed'], 'Degraded mode: cache-only uses non-negative cache states');
  ok(DEFAULT_CACHE_ONLY_MAX_TTL_SECONDS < DEFAULT_BREAK_GLASS_MAX_TTL_SECONDS, 'Degraded mode: cache-only grants have the shorter default TTL');
}

function testGrantCreation(): void {
  const grant = sampleGrant({ id: ' dmg_normalized ' });
  equal(grant.id, 'dmg_normalized', 'Degraded mode: grant id is normalized');
  equal(grant.state, 'break-glass-open', 'Degraded mode: grant records emergency state');
  equal(grant.ticketId, 'INC-2026-0418', 'Degraded mode: grant records incident ticket');
  equal(grant.remainingUses, 2, 'Degraded mode: remaining use budget defaults to maxUses when omitted');
  ok(grant.auditDigest.startsWith('sha256:'), 'Degraded mode: grant carries a stable audit digest');

  const breakGlass = grantToBreakGlassGrant(grant);
  equal(breakGlass.reason, 'availability-restore', 'Degraded mode: grant projects into enforcement break-glass grant');
  equal(breakGlass.authorizedBy.id, 'user_release_admin', 'Degraded mode: projected grant preserves authorizer');
  equal(degradedModeGrantStatus(grant, CHECKED_AT), 'active', 'Degraded mode: grant is active inside its window');
}

function testGrantValidation(): void {
  assert.throws(
    () => sampleGrant({ expiresAt: '2026-04-18T12:00:00.000Z' }),
    /ttl cannot exceed/i,
  );
  passed += 1;

  assert.throws(
    () => sampleGrant({ ticketId: ' ' }),
    /ticketId requires/i,
  );
  passed += 1;

  assert.throws(
    () => sampleGrant({ maxUses: 1, remainingUses: 2 }),
    /remainingUses cannot exceed maxUses/i,
  );
  passed += 1;
}

function testScopeMatching(): void {
  const request = sampleRequest();
  const requestScope = degradedModeScopeFromRequest(request);
  ok(degradedModeScopeMatches(sampleScope(), requestScope), 'Degraded mode: exact request scope matches grant scope');
  ok(degradedModeScopeMatches({ environment: 'prod-eu' }, requestScope), 'Degraded mode: partial scope acts as a narrow wildcard');
  ok(!degradedModeScopeMatches({ targetId: 'other-target' }, requestScope), 'Degraded mode: target mismatches fail closed');
  equal(requestScope.workloadId, 'spiffe://attestor/prod/record-gateway', 'Degraded mode: request scope includes workload identity');
}

function testCacheOnlyDecision(): void {
  const grant = sampleGrant({
    id: 'dmg_cache_only',
    state: 'cache-only',
    maxUses: 1,
    expiresAt: '2026-04-18T10:05:00.000Z',
  });
  const decision = evaluateDegradedMode({
    checkedAt: CHECKED_AT,
    grant,
    request: sampleRequest(),
    verification: sampleVerification(),
  });

  equal(decision.status, 'cache-only-allow', 'Degraded mode: cache-only grants can allow during introspection outage');
  equal(decision.degradedState, 'cache-only', 'Degraded mode: decision records cache-only state');
  equal(decision.outcome, 'allow', 'Degraded mode: cache-only outcome is an explicit allow');
  equal(decision.breakGlass, null, 'Degraded mode: cache-only does not masquerade as break-glass');
}

function testCacheOnlyHardFailureDenial(): void {
  const grant = sampleGrant({
    id: 'dmg_cache_denied',
    state: 'cache-only',
    expiresAt: '2026-04-18T10:05:00.000Z',
    allowedFailureReasons: ['introspection-unavailable', 'fresh-introspection-required', 'invalid-signature'],
  });
  const decision = evaluateDegradedMode({
    checkedAt: CHECKED_AT,
    grant,
    request: sampleRequest(),
    verification: sampleVerification({
      status: 'invalid',
      cacheState: 'fresh',
      failureReasons: ['invalid-signature'],
    }),
  });

  equal(decision.status, 'fail-closed', 'Degraded mode: cache-only denies invalid verification');
  equal(decision.outcome, 'deny', 'Degraded mode: hard failures deny');
  ok(decision.failureReasons.includes('break-glass-required'), 'Degraded mode: denied emergency path marks break-glass requirement');
}

function testBreakGlassDecision(): void {
  const decision = evaluateDegradedMode({
    checkedAt: CHECKED_AT,
    grant: sampleGrant(),
    request: sampleRequest(),
    verification: sampleVerification({
      failureReasons: ['fresh-introspection-required'],
    }),
  });

  equal(decision.status, 'break-glass-allow', 'Degraded mode: active emergency grant allows eligible outage failure');
  equal(decision.outcome, 'break-glass-allow', 'Degraded mode: emergency path emits break-glass outcome');
  equal(decision.breakGlass?.ticketId, 'INC-2026-0418', 'Degraded mode: break-glass decision carries ticket evidence');
  equal(decision.grantStatus, 'active', 'Degraded mode: decision exposes active grant status');
}

function testFailClosedStates(): void {
  const noGrant = evaluateDegradedMode({
    checkedAt: CHECKED_AT,
    request: sampleRequest(),
    verification: sampleVerification(),
  });
  equal(noGrant.status, 'break-glass-required', 'Degraded mode: missing grant fails closed with break-glass requirement');

  const expired = evaluateDegradedMode({
    checkedAt: CHECKED_AT,
    grant: sampleGrant({
      id: 'dmg_expired',
      startsAt: '2026-04-18T09:00:00.000Z',
      expiresAt: '2026-04-18T09:05:00.000Z',
    }),
    request: sampleRequest(),
    verification: sampleVerification(),
  });
  equal(expired.grantStatus, 'expired', 'Degraded mode: expired grants are not usable');
  equal(expired.status, 'fail-closed', 'Degraded mode: expired grants fail closed');
}

function testGrantStoreAuditAndUseBudget(): void {
  const store = createInMemoryDegradedModeGrantStore();
  const grant = sampleGrant({ id: 'dmg_store', maxUses: 1 });
  store.registerGrant(grant);
  equal(store.listGrants().length, 1, 'Degraded mode store: grant registration is visible');
  equal(store.listAuditRecords().length, 1, 'Degraded mode store: registration creates an audit record');

  const consumed = store.consumeGrant({
    id: grant.id,
    checkedAt: CHECKED_AT,
    actor: adminActor('svc_enforcement_gateway'),
    failureReasons: ['introspection-unavailable'],
    outcome: 'break-glass-allow',
    metadata: { requestId: 'erq_degraded_mode_1' },
  });
  equal(consumed?.remainingUses, 0, 'Degraded mode store: consuming a grant spends one use');
  equal(degradedModeGrantStatus(consumed!, CHECKED_AT), 'exhausted', 'Degraded mode store: zero budget is exhausted');
  equal(store.consumeGrant({ id: grant.id, checkedAt: CHECKED_AT }), null, 'Degraded mode store: exhausted grants cannot be consumed twice');

  const audits = store.listAuditRecords();
  equal(audits.length, 2, 'Degraded mode store: grant use is audited');
  equal(audits[1].previousDigest, audits[0].digest, 'Degraded mode store: audit records are hash chained');
}

function createAdminFixture(options?: { authorized?: boolean }) {
  const app = new Hono();
  const store = createInMemoryDegradedModeGrantStore();
  const adminAuditRecords: Array<Record<string, unknown>> = [];

  registerAdminRoutes(app, {
    releaseDegradedModeGrantStore: store,
    currentAdminAuthorized(c: Context): Response | null {
      const token = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
      if (options?.authorized === false || token !== 'admin-secret') {
        return c.json({ error: 'Valid admin API key required.' }, 401);
      }
      return null;
    },
    adminMutationService: {
      async begin({ routeId, requestPayload }) {
        return {
          kind: 'ready',
          idempotencyKey: null,
          requestHash: JSON.stringify({ routeId, requestPayload }),
        };
      },
      async finalize(input) {
        adminAuditRecords.push(input.audit);
        return input.responseBody;
      },
    },
  });

  return { app, store, adminAuditRecords };
}

async function requestJson(
  app: Hono,
  path: string,
  options?: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  },
): Promise<{ status: number; body: any }> {
  const response = await app.request(path, {
    method: options?.method ?? 'GET',
    headers: options?.headers ?? ADMIN_HEADERS,
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function testAdminRoutes(): Promise<void> {
  const fixture = createAdminFixture();
  const created = await requestJson(fixture.app, '/api/v1/admin/release-enforcement/degraded-mode/grants', {
    method: 'POST',
    body: {
      id: 'dmg_admin_1',
      state: 'break-glass-open',
      reason: 'control-plane-recovery',
      scope: sampleScope(),
      authorizedBy: adminActor(),
      approvedBy: [adminActor('user_second_admin')],
      authorizedAt: CHECKED_AT,
      startsAt: CHECKED_AT,
      expiresAt: EXPIRES_AT,
      ticketId: 'INC-ADMIN-1',
      rationale: 'Restore policy enforcement during a confirmed control-plane outage.',
      allowedFailureReasons: ['introspection-unavailable'],
      maxUses: 1,
    },
  });

  equal(created.status, 201, 'Degraded mode admin routes: grant creation returns 201');
  equal(created.body.grant.id, 'dmg_admin_1', 'Degraded mode admin routes: created grant is returned');
  equal(fixture.store.findGrant('dmg_admin_1')?.reason, 'control-plane-recovery', 'Degraded mode admin routes: created grant is stored');

  const listed = await requestJson(fixture.app, '/api/v1/admin/release-enforcement/degraded-mode/grants');
  equal(listed.status, 200, 'Degraded mode admin routes: list returns 200');
  equal(listed.body.grants.length, 1, 'Degraded mode admin routes: list returns stored grant');
  ok(typeof listed.body.summary.auditHead === 'string', 'Degraded mode admin routes: list exposes audit head');

  const revoked = await requestJson(
    fixture.app,
    '/api/v1/admin/release-enforcement/degraded-mode/grants/dmg_admin_1/revoke',
    {
      method: 'POST',
      body: {
        reason: 'control plane recovered',
        actor: adminActor(),
      },
    },
  );
  equal(revoked.status, 200, 'Degraded mode admin routes: revoke returns 200');
  equal(revoked.body.grant.revocationReason, 'control plane recovered', 'Degraded mode admin routes: revoke reason is returned');
  equal(fixture.adminAuditRecords.length, 2, 'Degraded mode admin routes: create and revoke are admin-audited');

  const unauthorizedFixture = createAdminFixture({ authorized: false });
  const unauthorized = await requestJson(
    unauthorizedFixture.app,
    '/api/v1/admin/release-enforcement/degraded-mode/grants',
    { method: 'GET', headers: { authorization: 'Bearer wrong' } },
  );
  equal(unauthorized.status, 401, 'Degraded mode admin routes: unauthorized access is rejected');
}

async function main(): Promise<void> {
  testSpecConstants();
  testGrantCreation();
  testGrantValidation();
  testScopeMatching();
  testCacheOnlyDecision();
  testCacheOnlyHardFailureDenial();
  testBreakGlassDecision();
  testFailClosedStates();
  testGrantStoreAuditAndUseBudget();
  await testAdminRoutes();
  console.log(`Release enforcement-plane degraded mode tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
