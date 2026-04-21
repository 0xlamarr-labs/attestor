import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { Hono } from 'hono';
import { generateKeyPair } from '../src/signing/keys.js';
import { createReleaseDecisionSkeleton } from '../src/release-kernel/object-model.js';
import {
  createReleaseTokenIssuer,
  type IssuedReleaseToken,
  type ReleaseTokenVerificationKey,
} from '../src/release-kernel/release-token.js';
import type { ReleaseDecision } from '../src/release-kernel/object-model.js';
import {
  createInMemoryReleaseTokenIntrospectionStore,
  createReleaseTokenIntrospector,
} from '../src/release-kernel/release-introspection.js';
import type { CreateEnforcementPointReferenceInput } from '../src/release-enforcement-plane/types.js';
import {
  ATTESTOR_CONSEQUENCE_HASH_HEADER,
  ATTESTOR_OUTPUT_HASH_HEADER,
  ATTESTOR_RELEASE_DECISION_ID_HEADER,
  ATTESTOR_RELEASE_TOKEN_ID_HEADER,
  ATTESTOR_TARGET_ID_HEADER,
} from '../src/release-enforcement-plane/http-message-signatures.js';
import {
  ATTESTOR_ENFORCEMENT_STATUS_HEADER,
  ATTESTOR_IDEMPOTENCY_KEY_HEADER,
  HONO_RELEASE_ENFORCEMENT_CONTEXT_KEY,
  RELEASE_ENFORCEMENT_MIDDLEWARE_SPEC_VERSION,
  createHonoReleaseEnforcementMiddleware,
  createNodeReleaseEnforcementMiddleware,
  evaluateReleaseEnforcementHttpRequest,
  type HonoReleaseEnforcementEnv,
  type ReleaseEnforcementMiddlewareOptions,
  type ReleaseEnforcementMiddlewareResult,
} from '../src/release-enforcement-plane/middleware.js';

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
  assert.deepEqual(actual, expected);
  passed += 1;
}

const TARGET_ID = 'middleware.release.target';
const OUTPUT_HASH = 'sha256:output';
const CONSEQUENCE_HASH = 'sha256:consequence';
const POLICY_HASH = 'sha256:policy';

function makeDecision(input: {
  readonly id: string;
  readonly targetId?: string;
  readonly consequenceType?: 'decision-support' | 'communication' | 'action';
  readonly riskClass?: 'R1' | 'R3';
}) {
  const consequenceType = input.consequenceType ?? 'decision-support';
  return createReleaseDecisionSkeleton({
    id: input.id,
    createdAt: '2026-04-18T15:00:00.000Z',
    status: 'accepted',
    policyVersion: 'policy.release-middleware-test.v1',
    policyHash: POLICY_HASH,
    outputHash: OUTPUT_HASH,
    consequenceHash: CONSEQUENCE_HASH,
    outputContract: {
      artifactType: 'release-middleware-test.artifact',
      expectedShape: 'deterministic middleware test artifact',
      consequenceType,
      riskClass: input.riskClass ?? 'R1',
    },
    capabilityBoundary: {
      allowedTools: ['release-middleware-test-tool'],
      allowedTargets: [input.targetId ?? TARGET_ID],
      allowedDataDomains: ['release-middleware-test'],
    },
    requester: {
      id: 'svc.release-middleware-test',
      type: 'service',
    },
    target: {
      kind: consequenceType === 'action' ? 'workflow' : 'endpoint',
      id: input.targetId ?? TARGET_ID,
    },
  });
}

function enforcementPoint(input: {
  readonly riskClass?: 'R1' | 'R3';
  readonly consequenceType?: 'decision-support' | 'communication' | 'action';
} = {}): CreateEnforcementPointReferenceInput {
  return {
    environment: 'test',
    enforcementPointId: 'middleware-pep',
    pointKind: 'application-middleware',
    boundaryKind: 'http-request',
    consequenceType: input.consequenceType ?? 'decision-support',
    riskClass: input.riskClass ?? 'R1',
    tenantId: 'tenant-test',
    accountId: 'acct-test',
    workloadId: 'spiffe://attestor/tests/middleware',
    audience: TARGET_ID,
  };
}

async function setupIssuer() {
  const keyPair = generateKeyPair();
  const issuer = createReleaseTokenIssuer({
    issuer: 'attestor.release.local',
    privateKeyPem: keyPair.privateKeyPem,
    publicKeyPem: keyPair.publicKeyPem,
  });
  return {
    issuer,
    verificationKey: await issuer.exportVerificationKey(),
  };
}

async function issueToken(input: {
  readonly tokenId: string;
  readonly decisionId: string;
  readonly targetId?: string;
  readonly consequenceType?: 'decision-support' | 'communication' | 'action';
  readonly riskClass?: 'R1' | 'R3';
}): Promise<{
  readonly issued: IssuedReleaseToken;
  readonly verificationKey: ReleaseTokenVerificationKey;
  readonly decision: ReleaseDecision;
}> {
  const { issuer, verificationKey } = await setupIssuer();
  const decision = makeDecision({
    id: input.decisionId,
    targetId: input.targetId,
    consequenceType: input.consequenceType,
    riskClass: input.riskClass,
  });
  const issued = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T15:00:00.000Z',
    tokenId: input.tokenId,
  });
  return { issued, verificationKey, decision };
}

function releaseHeaders(
  issued: IssuedReleaseToken,
  decision: ReleaseDecision,
  overrides: Record<string, string> = {},
): Headers {
  return new Headers({
    authorization: `Bearer ${issued.token}`,
    [ATTESTOR_RELEASE_TOKEN_ID_HEADER]: issued.tokenId,
    [ATTESTOR_RELEASE_DECISION_ID_HEADER]: decision.id,
    [ATTESTOR_TARGET_ID_HEADER]: decision.target.id,
    [ATTESTOR_OUTPUT_HASH_HEADER]: decision.outputHash,
    [ATTESTOR_CONSEQUENCE_HASH_HEADER]: decision.consequenceHash,
    [ATTESTOR_IDEMPOTENCY_KEY_HEADER]: 'idem-middleware-1',
    ...overrides,
  });
}

function baseOptions(input: {
  readonly verificationKey: ReleaseTokenVerificationKey;
  readonly riskClass?: 'R1' | 'R3';
  readonly consequenceType?: 'decision-support' | 'communication' | 'action';
}): ReleaseEnforcementMiddlewareOptions {
  return {
    verificationKey: input.verificationKey,
    enforcementPoint: enforcementPoint({
      riskClass: input.riskClass,
      consequenceType: input.consequenceType,
    }),
    now: () => '2026-04-18T15:01:00.000Z',
  };
}

async function testHonoMiddlewareAllowsValidReleaseAuthorization(): Promise<void> {
  const { issued, verificationKey, decision } = await issueToken({
    tokenId: 'rt_middleware_hono_allow',
    decisionId: 'decision-middleware-hono-allow',
  });
  const app = new Hono<HonoReleaseEnforcementEnv>();
  let handlerReached = 0;

  app.use('/mutate/*', createHonoReleaseEnforcementMiddleware(baseOptions({ verificationKey })));
  app.post('/mutate/report', (context) => {
    handlerReached += 1;
    const result = context.get(HONO_RELEASE_ENFORCEMENT_CONTEXT_KEY);
    return context.json({
      status: result.status,
      verificationStatus: result.verificationResult?.status,
      releaseTokenId: result.verificationResult?.releaseTokenId,
      idempotencyKey: result.request?.idempotencyKey,
    }, 201);
  });

  const response = await app.request('/mutate/report', {
    method: 'POST',
    headers: releaseHeaders(issued, decision),
  });
  const body = await response.json() as {
    readonly status: string;
    readonly verificationStatus: string;
    readonly releaseTokenId: string;
    readonly idempotencyKey: string;
  };

  equal(response.status, 201, 'Middleware: Hono allows valid release authorization');
  equal(response.headers.get(ATTESTOR_ENFORCEMENT_STATUS_HEADER), 'allowed', 'Middleware: Hono stamps allowed status header');
  equal(handlerReached, 1, 'Middleware: Hono calls mutation handler after allow');
  equal(body.status, 'allowed', 'Middleware: Hono exposes allow result to handler context');
  equal(body.verificationStatus, 'valid', 'Middleware: Hono exposes valid verification result');
  equal(body.releaseTokenId, issued.tokenId, 'Middleware: Hono binds release token id');
  equal(body.idempotencyKey, 'idem-middleware-1', 'Middleware: Hono carries idempotency key into enforcement request');
}

async function testHonoMiddlewareDeniesMissingAuthorization(): Promise<void> {
  const { verificationKey } = await issueToken({
    tokenId: 'rt_middleware_hono_missing',
    decisionId: 'decision-middleware-hono-missing',
  });
  const app = new Hono<HonoReleaseEnforcementEnv>();
  let handlerReached = 0;

  app.use('/mutate/*', createHonoReleaseEnforcementMiddleware(baseOptions({ verificationKey })));
  app.post('/mutate/report', (context) => {
    handlerReached += 1;
    return context.text('should not run');
  });

  const response = await app.request('/mutate/report', {
    method: 'POST',
    headers: new Headers({
      [ATTESTOR_TARGET_ID_HEADER]: TARGET_ID,
      [ATTESTOR_OUTPUT_HASH_HEADER]: OUTPUT_HASH,
      [ATTESTOR_CONSEQUENCE_HASH_HEADER]: CONSEQUENCE_HASH,
    }),
  });
  const body = await response.json() as { readonly failureReasons: readonly string[] };

  equal(response.status, 401, 'Middleware: Hono denies missing release authorization');
  equal(response.headers.get(ATTESTOR_ENFORCEMENT_STATUS_HEADER), 'denied', 'Middleware: denied response stamps status');
  ok(response.headers.get('www-authenticate')?.includes('attestor-release'), 'Middleware: missing auth returns release authorization challenge');
  equal(handlerReached, 0, 'Middleware: denied Hono request does not reach mutation handler');
  deepEqual(body.failureReasons, ['missing-release-authorization'], 'Middleware: missing authorization failure is explicit');
}

async function testHonoMiddlewareDeniesBindingMismatch(): Promise<void> {
  const { issued, verificationKey, decision } = await issueToken({
    tokenId: 'rt_middleware_hono_binding',
    decisionId: 'decision-middleware-hono-binding',
  });
  const app = new Hono<HonoReleaseEnforcementEnv>();
  let handlerReached = 0;

  app.use('/mutate/*', createHonoReleaseEnforcementMiddleware(baseOptions({ verificationKey })));
  app.post('/mutate/report', (context) => {
    handlerReached += 1;
    return context.text('should not run');
  });

  const response = await app.request('/mutate/report', {
    method: 'POST',
    headers: releaseHeaders(issued, decision, {
      [ATTESTOR_OUTPUT_HASH_HEADER]: 'sha256:wrong-output',
    }),
  });
  const body = await response.json() as {
    readonly failureReasons: readonly string[];
    readonly verificationStatus: string;
    readonly requestId: string | null;
  };

  equal(response.status, 403, 'Middleware: Hono denies output hash binding mismatch');
  equal(handlerReached, 0, 'Middleware: binding mismatch does not reach handler');
  deepEqual(body.failureReasons, ['binding-mismatch'], 'Middleware: binding mismatch reason is explicit');
  equal(body.verificationStatus, 'invalid', 'Middleware: invalid verification status is exposed');
  ok(typeof body.requestId === 'string' && body.requestId.length > 0, 'Middleware: denied body carries enforcement request id');
}

async function testHonoMiddlewareSkipsSafeMethods(): Promise<void> {
  const { verificationKey } = await issueToken({
    tokenId: 'rt_middleware_hono_skip',
    decisionId: 'decision-middleware-hono-skip',
  });
  const app = new Hono<HonoReleaseEnforcementEnv>();

  app.use('/mutate/*', createHonoReleaseEnforcementMiddleware(baseOptions({ verificationKey })));
  app.get('/mutate/report', (context) => {
    const result = context.get(HONO_RELEASE_ENFORCEMENT_CONTEXT_KEY);
    return context.json({ status: result.status });
  });

  const response = await app.request('/mutate/report', { method: 'GET' });
  const body = await response.json() as { readonly status: string };

  equal(response.status, 200, 'Middleware: Hono allows safe GET without release authorization');
  equal(response.headers.get(ATTESTOR_ENFORCEMENT_STATUS_HEADER), 'skipped', 'Middleware: skipped request is observable');
  equal(body.status, 'skipped', 'Middleware: skipped status is available in Hono context');
}

async function testHonoMiddlewareOnlineVerifierAllowsHighRisk(): Promise<void> {
  const { issued, verificationKey, decision } = await issueToken({
    tokenId: 'rt_middleware_hono_online',
    decisionId: 'decision-middleware-hono-online',
    consequenceType: 'communication',
    riskClass: 'R3',
  });
  const store = createInMemoryReleaseTokenIntrospectionStore();
  const introspector = createReleaseTokenIntrospector(store);
  store.registerIssuedToken({ issuedToken: issued, decision });
  const app = new Hono<HonoReleaseEnforcementEnv>();

  app.use('/mutate/*', createHonoReleaseEnforcementMiddleware({
    ...baseOptions({
      verificationKey,
      riskClass: 'R3',
      consequenceType: 'communication',
    }),
    verifierMode: 'online',
    introspector,
  }));
  app.post('/mutate/send', (context) => {
    const result = context.get(HONO_RELEASE_ENFORCEMENT_CONTEXT_KEY);
    return context.json({
      status: result.status,
      onlineChecked: result.online?.onlineChecked,
      offlineStatus: result.online?.offline.status,
    }, 202);
  });

  const response = await app.request('/mutate/send', {
    method: 'POST',
    headers: releaseHeaders(issued, decision),
  });
  const body = await response.json() as {
    readonly status: string;
    readonly onlineChecked: boolean;
    readonly offlineStatus: string;
  };

  equal(response.status, 202, 'Middleware: Hono online verifier allows active high-risk release');
  equal(body.status, 'allowed', 'Middleware: online path exposes allowed status');
  equal(body.onlineChecked, true, 'Middleware: online path performs introspection');
  equal(body.offlineStatus, 'indeterminate', 'Middleware: high-risk offline component remains indeterminate before liveness');
}

async function testHonoMiddlewareOfflineHighRiskFailsClosed(): Promise<void> {
  const { issued, verificationKey, decision } = await issueToken({
    tokenId: 'rt_middleware_hono_indeterminate',
    decisionId: 'decision-middleware-hono-indeterminate',
    consequenceType: 'communication',
    riskClass: 'R3',
  });
  const app = new Hono<HonoReleaseEnforcementEnv>();

  app.use('/mutate/*', createHonoReleaseEnforcementMiddleware(baseOptions({
    verificationKey,
    riskClass: 'R3',
    consequenceType: 'communication',
  })));
  app.post('/mutate/send', (context) => context.text('should not run'));

  const response = await app.request('/mutate/send', {
    method: 'POST',
    headers: releaseHeaders(issued, decision),
  });
  const body = await response.json() as {
    readonly failureReasons: readonly string[];
    readonly verificationStatus: string;
  };

  equal(response.status, 428, 'Middleware: offline high-risk path fails closed when liveness is required');
  equal(body.verificationStatus, 'indeterminate', 'Middleware: indeterminate verification is exposed');
  deepEqual(body.failureReasons, ['fresh-introspection-required'], 'Middleware: missing live introspection is explicit');
}

async function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'object' && address !== null) {
        resolve(address.port);
      }
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function testNodeMiddlewareAllowsValidReleaseAuthorization(): Promise<void> {
  const { issued, verificationKey, decision } = await issueToken({
    tokenId: 'rt_middleware_node_allow',
    decisionId: 'decision-middleware-node-allow',
  });
  const middleware = createNodeReleaseEnforcementMiddleware(baseOptions({ verificationKey }));
  let handlerReached = 0;
  const server = createServer((request, response) => {
    void middleware(request, response, () => {
      handlerReached += 1;
      const result = request.releaseEnforcement as ReleaseEnforcementMiddlewareResult;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        status: result.status,
        tokenId: result.verificationResult?.releaseTokenId,
      }));
    });
  });
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/mutate`, {
      method: 'POST',
      headers: releaseHeaders(issued, decision),
    });
    const body = await response.json() as { readonly status: string; readonly tokenId: string };

    equal(response.status, 200, 'Middleware: Node adapter allows valid release authorization');
    equal(response.headers.get(ATTESTOR_ENFORCEMENT_STATUS_HEADER), 'allowed', 'Middleware: Node adapter stamps allowed status');
    equal(handlerReached, 1, 'Middleware: Node adapter calls next after allow');
    equal(body.status, 'allowed', 'Middleware: Node adapter exposes result on request');
    equal(body.tokenId, issued.tokenId, 'Middleware: Node adapter binds release token id');
  } finally {
    await closeServer(server);
  }
}

async function testNodeMiddlewareDeniesMissingAuthorization(): Promise<void> {
  const { verificationKey } = await issueToken({
    tokenId: 'rt_middleware_node_missing',
    decisionId: 'decision-middleware-node-missing',
  });
  const middleware = createNodeReleaseEnforcementMiddleware(baseOptions({ verificationKey }));
  let handlerReached = 0;
  const server = createServer((request, response) => {
    void middleware(request, response, () => {
      handlerReached += 1;
      response.end('should not run');
    });
  });
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/mutate`, {
      method: 'POST',
      headers: new Headers({
        [ATTESTOR_TARGET_ID_HEADER]: TARGET_ID,
        [ATTESTOR_OUTPUT_HASH_HEADER]: OUTPUT_HASH,
        [ATTESTOR_CONSEQUENCE_HASH_HEADER]: CONSEQUENCE_HASH,
      }),
    });
    const body = await response.json() as { readonly failureReasons: readonly string[] };

    equal(response.status, 401, 'Middleware: Node adapter denies missing authorization');
    equal(response.headers.get(ATTESTOR_ENFORCEMENT_STATUS_HEADER), 'denied', 'Middleware: Node denied response stamps status');
    equal(handlerReached, 0, 'Middleware: Node denied request does not call next');
    deepEqual(body.failureReasons, ['missing-release-authorization'], 'Middleware: Node missing auth reason is explicit');
  } finally {
    await closeServer(server);
  }
}

async function testCoreEvaluatorDeniesMissingBindingHeaders(): Promise<void> {
  const { issued, verificationKey } = await issueToken({
    tokenId: 'rt_middleware_core_binding',
    decisionId: 'decision-middleware-core-binding',
  });
  const result = await evaluateReleaseEnforcementHttpRequest(
    {
      method: 'POST',
      url: 'https://middleware.attestor.test/mutate',
      headers: new Headers({
        authorization: `Bearer ${issued.token}`,
      }),
    },
    baseOptions({ verificationKey }),
  );

  equal(result.version, RELEASE_ENFORCEMENT_MIDDLEWARE_SPEC_VERSION, 'Middleware: core evaluator stamps stable spec version');
  equal(result.status, 'denied', 'Middleware: core evaluator fails closed without binding headers');
  equal(result.responseStatus, 403, 'Middleware: missing binding headers map to forbidden');
  deepEqual(result.failureReasons, ['binding-mismatch'], 'Middleware: missing binding headers map to binding mismatch');
}

async function main(): Promise<void> {
  await testHonoMiddlewareAllowsValidReleaseAuthorization();
  await testHonoMiddlewareDeniesMissingAuthorization();
  await testHonoMiddlewareDeniesBindingMismatch();
  await testHonoMiddlewareSkipsSafeMethods();
  await testHonoMiddlewareOnlineVerifierAllowsHighRisk();
  await testHonoMiddlewareOfflineHighRiskFailsClosed();
  await testNodeMiddlewareAllowsValidReleaseAuthorization();
  await testNodeMiddlewareDeniesMissingAuthorization();
  await testCoreEvaluatorDeniesMissingBindingHeaders();

  console.log(`Release enforcement-plane middleware tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease enforcement-plane middleware tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
