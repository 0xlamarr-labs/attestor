import { strict as assert } from 'node:assert';
import { Hono } from 'hono';
import { generateKeyPair } from '../src/signing/keys.js';
import { createReleaseDecisionSkeleton } from '../src/release-kernel/object-model.js';
import { createReleaseTokenIssuer } from '../src/release-kernel/release-token.js';
import {
  createInMemoryReleaseTokenIntrospectionStore,
  createReleaseTokenIntrospector,
  introspectReleaseToken,
} from '../src/release-kernel/release-introspection.js';
import {
  createReleaseVerificationMiddleware,
  DEFAULT_RELEASE_CONTEXT_KEY,
  resolveReleaseTokenFromRequest,
  verifyReleaseAuthorization,
} from '../src/release-kernel/release-verification.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

async function main(): Promise<void> {
  const keyPair = generateKeyPair();
  const issuer = createReleaseTokenIssuer({
    issuer: 'attestor.release.local',
    privateKeyPem: keyPair.privateKeyPem,
    publicKeyPem: keyPair.publicKeyPem,
  });
  const verificationKey = await issuer.exportVerificationKey();
  const introspectionStore = createInMemoryReleaseTokenIntrospectionStore();
  const introspector = createReleaseTokenIntrospector(introspectionStore);

  const decision = createReleaseDecisionSkeleton({
    id: 'decision-release-verifier',
    createdAt: '2026-04-17T21:00:00.000Z',
    status: 'accepted',
    policyVersion: 'finance.structured-record-release.v1',
    policyHash: 'finance.structured-record-release.v1',
    outputHash: 'sha256:output',
    consequenceHash: 'sha256:consequence',
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

  const issued = await issuer.issue({
    decision,
    issuedAt: '2026-04-17T21:00:00.000Z',
  });
  introspectionStore.registerIssuedToken({
    issuedToken: issued,
    decision,
  });

  const verified = await verifyReleaseAuthorization({
    token: issued.token,
    verificationKey,
    audience: 'finance.reporting.record-store',
    expectedTargetId: 'finance.reporting.record-store',
    expectedOutputHash: 'sha256:output',
    expectedConsequenceHash: 'sha256:consequence',
    currentDate: '2026-04-17T21:01:00.000Z',
    introspector,
    tokenTypeHint: 'attestor_release_token',
    resourceServerId: 'attestor.tests.release-verification',
  });

  equal(
    verified.verification.claims.decision_id,
    decision.id,
    'Release verification: the verifier preserves the original decision id from the token claims',
  );
  equal(
    verified.expectedOutputHash,
    'sha256:output',
    'Release verification: downstream expected output hash is bound into the verification context',
  );
  ok(
    verified.introspection?.active === true,
    'Release verification: high-risk release tokens require and preserve an active introspection result',
  );

  const inactiveIntrospection = await introspectReleaseToken({
    token: issued.token,
    verificationKey,
    audience: 'some.other.target',
    currentDate: '2026-04-17T21:01:00.000Z',
    store: introspectionStore,
    tokenTypeHint: 'access_token',
    resourceServerId: 'attestor.tests.release-verification',
  });
  ok(
    inactiveIntrospection.active === false,
    'Release introspection: audience-mismatched high-risk tokens are reported inactive instead of being treated as reusable authorization',
  );

  await assert.rejects(
    () =>
      verifyReleaseAuthorization({
        token: issued.token,
        verificationKey,
        audience: 'finance.reporting.record-store',
        expectedTargetId: 'finance.reporting.record-store',
        expectedOutputHash: 'sha256:wrong',
        expectedConsequenceHash: 'sha256:consequence',
        currentDate: '2026-04-17T21:01:00.000Z',
        introspector,
      }),
    /output hash does not match/,
    'Release verification: output hash mismatch is rejected instead of silently trusting the token',
  );
  passed += 1;

  const unregisteredIssued = await issuer.issue({
    decision,
    issuedAt: '2026-04-17T21:00:00.000Z',
    tokenId: 'rt_unregistered',
  });
  await assert.rejects(
    () =>
      verifyReleaseAuthorization({
        token: unregisteredIssued.token,
        verificationKey,
        audience: 'finance.reporting.record-store',
        expectedTargetId: 'finance.reporting.record-store',
        expectedOutputHash: 'sha256:output',
        expectedConsequenceHash: 'sha256:consequence',
        currentDate: '2026-04-17T21:01:00.000Z',
        introspector,
      }),
    /not active according to the Attestor introspection registry/,
    'Release verification: a cryptographically valid but unregistered high-risk token is rejected by active introspection',
  );
  passed += 1;

  const authorizationToken = resolveReleaseTokenFromRequest(
    new Request('https://attestor.local/release', {
      headers: {
        Authorization: `Bearer ${issued.token}`,
      },
    }),
  );
  equal(
    authorizationToken,
    issued.token,
    'Release verification: standard Authorization Bearer syntax is supported',
  );

  const dedicatedHeaderToken = resolveReleaseTokenFromRequest(
    new Request('https://attestor.local/release', {
      headers: {
        'X-Attestor-Release-Token': issued.token,
      },
    }),
  );
  equal(
    dedicatedHeaderToken,
    issued.token,
    'Release verification: dedicated Attestor release-token header is supported as a fallback transport',
  );

  const app = new Hono();
  app.use(
    '/release',
    createReleaseVerificationMiddleware({
      verificationKey,
      audience: 'finance.reporting.record-store',
      expectedTargetId: 'finance.reporting.record-store',
      expectedOutputHash: 'sha256:output',
      expectedConsequenceHash: 'sha256:consequence',
      currentDate: '2026-04-17T21:01:00.000Z',
      introspector,
      tokenTypeHint: 'attestor_release_token',
      resourceServerId: 'attestor.tests.release-verification',
    }),
  );
  app.post('/release', (context) => {
    const verificationContext = context.get(DEFAULT_RELEASE_CONTEXT_KEY);
    return context.json({
      ok: true,
      decisionId: verificationContext.verification.claims.decision_id,
      introspectionActive: verificationContext.introspection?.active ?? false,
    });
  });

  const successResponse = await app.request('https://attestor.local/release', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${issued.token}`,
    },
  });
  equal(
    successResponse.status,
    200,
    'Release verification middleware: valid release tokens allow the downstream path to proceed',
  );
  const successBody = await successResponse.json();
  equal(
    successBody.decisionId,
    decision.id,
    'Release verification middleware: downstream handlers receive the verified release context',
  );
  ok(
    successBody.introspectionActive === true,
    'Release verification middleware: downstream handlers can see that high-risk introspection succeeded',
  );

  const missingTokenResponse = await app.request('https://attestor.local/release', {
    method: 'POST',
  });
  equal(
    missingTokenResponse.status,
    401,
    'Release verification middleware: missing release token fails closed',
  );
  ok(
    (missingTokenResponse.headers.get('WWW-Authenticate') ?? '').includes('invalid_token'),
    'Release verification middleware: missing-token failures return an RFC6750-style WWW-Authenticate challenge',
  );

  const mismatchApp = new Hono();
  mismatchApp.use(
    '/release',
    createReleaseVerificationMiddleware({
      verificationKey,
      audience: 'finance.reporting.record-store',
      expectedTargetId: 'finance.reporting.record-store',
      expectedOutputHash: 'sha256:output',
      expectedConsequenceHash: 'sha256:wrong-consequence',
      currentDate: '2026-04-17T21:01:00.000Z',
      introspector,
    }),
  );
  mismatchApp.post('/release', (context) => context.json({ ok: true }));

  const mismatchResponse = await mismatchApp.request('https://attestor.local/release', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${issued.token}`,
    },
  });
  equal(
    mismatchResponse.status,
    403,
    'Release verification middleware: binding mismatches fail with insufficient scope rather than allowing unintended release',
  );

  console.log(`\nRelease kernel release-verification tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease kernel release-verification tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
