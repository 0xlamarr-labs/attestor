import assert from 'node:assert/strict';
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
  type ReleaseTokenIntrospectionStore,
  type ReleaseTokenIntrospector,
} from '../src/release-kernel/release-introspection.js';
import {
  buildRecordWriteCanonicalBinding,
  enforceRecordWrite,
  RELEASE_RECORD_WRITE_GATEWAY_SPEC_VERSION,
  type RecordWriteMutation,
} from '../src/release-enforcement-plane/record-write.js';
import {
  createMtlsBoundPresentationFromIssuedToken,
  createMtlsReleaseTokenConfirmation,
} from '../src/release-enforcement-plane/workload-binding.js';

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

const WORKLOAD_CERT_THUMBPRINT = 'cert-thumbprint-record-write';
const WORKLOAD_SPIFFE_ID = 'spiffe://attestor/tests/record-write-gateway';
const MUTATION: RecordWriteMutation = Object.freeze({
  storeId: 'finance.reporting',
  collection: 'counterparty_exposures',
  recordId: 'exposure-001',
  operation: 'upsert',
  after: {
    counterparty_name: 'Bank of Nova Scotia',
    exposure_usd: 250000000,
    credit_rating: 'AA-',
    sector: 'Banking',
  },
  idempotencyKey: 'idem-record-write-1',
  actorId: 'svc.finance-writer',
  schemaVersion: 'counterparty-exposure.v1',
  reason: 'release-authorized filing preparation update',
});

function makeDecision(input: {
  readonly id: string;
  readonly binding: ReturnType<typeof buildRecordWriteCanonicalBinding>;
  readonly riskClass?: 'R4';
}): ReleaseDecision {
  return createReleaseDecisionSkeleton({
    id: input.id,
    createdAt: '2026-04-18T17:00:00.000Z',
    status: 'accepted',
    policyVersion: 'policy.release-record-write-test.v1',
    policyHash: 'sha256:policy',
    outputHash: input.binding.hashBundle.outputHash,
    consequenceHash: input.binding.hashBundle.consequenceHash,
    outputContract: input.binding.outputContract,
    capabilityBoundary: {
      allowedTools: ['record-write-gateway'],
      allowedTargets: [input.binding.target.id],
      allowedDataDomains: ['financial-reporting'],
    },
    requester: {
      id: 'svc.release-record-write-test',
      type: 'service',
    },
    target: input.binding.target,
  });
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

async function issueRecordToken(input: {
  readonly tokenId: string;
  readonly decisionId: string;
  readonly mutation?: RecordWriteMutation;
}): Promise<{
  readonly issued: IssuedReleaseToken;
  readonly verificationKey: ReleaseTokenVerificationKey;
  readonly decision: ReleaseDecision;
  readonly binding: ReturnType<typeof buildRecordWriteCanonicalBinding>;
}> {
  const binding = buildRecordWriteCanonicalBinding(input.mutation ?? MUTATION);
  const { issuer, verificationKey } = await setupIssuer();
  const decision = makeDecision({
    id: input.decisionId,
    binding,
  });
  const issued = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T17:00:00.000Z',
    tokenId: input.tokenId,
    confirmation: createMtlsReleaseTokenConfirmation({
      certificateThumbprint: WORKLOAD_CERT_THUMBPRINT,
      spiffeId: WORKLOAD_SPIFFE_ID,
    }),
  });

  return { issued, verificationKey, decision, binding };
}

function register(
  issued: IssuedReleaseToken,
  decision: ReleaseDecision,
): {
  readonly store: ReleaseTokenIntrospectionStore;
  readonly introspector: ReleaseTokenIntrospector;
} {
  const store = createInMemoryReleaseTokenIntrospectionStore();
  const introspector = createReleaseTokenIntrospector(store);
  store.registerIssuedToken({ issuedToken: issued, decision });
  return { store, introspector };
}

function options(input: {
  readonly verificationKey: ReleaseTokenVerificationKey;
  readonly introspector?: ReleaseTokenIntrospector;
  readonly store?: ReleaseTokenIntrospectionStore;
  readonly verifierMode?: 'offline' | 'online';
}) {
  return {
    verificationKey: input.verificationKey,
    enforcementPointId: 'record-write-gateway-pep',
    environment: 'test',
    tenantId: 'tenant-test',
    accountId: 'acct-test',
    workloadId: WORKLOAD_SPIFFE_ID,
    introspector: input.introspector,
    usageStore: input.store,
    verifierMode: input.verifierMode,
    requestId: 'erq-record-write-test',
    now: () => '2026-04-18T17:01:00.000Z',
  };
}

function authorization(issued: IssuedReleaseToken) {
  const presentation = createMtlsBoundPresentationFromIssuedToken({
    issuedToken: issued,
    certificateThumbprint: WORKLOAD_CERT_THUMBPRINT,
    spiffeId: WORKLOAD_SPIFFE_ID,
    subjectDn: 'CN=record-writer',
    presentedAt: '2026-04-18T17:01:00.000Z',
  });
  return {
    releaseToken: issued.token,
    releaseTokenId: issued.tokenId,
    releaseDecisionId: issued.claims.decision_id,
    mode: presentation.mode,
    proof: presentation.proof,
    issuer: presentation.issuer,
    subject: presentation.subject,
    audience: presentation.audience,
    expiresAt: presentation.expiresAt,
    scope: presentation.scope,
  } as const;
}

async function testCanonicalBindingIsStable(): Promise<void> {
  const left = buildRecordWriteCanonicalBinding(MUTATION);
  const reordered = buildRecordWriteCanonicalBinding({
    ...MUTATION,
    after: {
      sector: 'Banking',
      credit_rating: 'AA-',
      exposure_usd: 250000000,
      counterparty_name: 'Bank of Nova Scotia',
    },
  });

  equal(left.version, RELEASE_RECORD_WRITE_GATEWAY_SPEC_VERSION, 'Record-write gateway: binding stamps stable spec version');
  equal(left.target.id, 'finance.reporting/counterparty_exposures/exposure-001', 'Record-write gateway: target binds store, collection, and record id');
  equal(left.outputContract.consequenceType, 'record', 'Record-write gateway: output contract is record consequence');
  ok(left.hashBundle.outputHash.startsWith('sha256:'), 'Record-write gateway: output hash is canonicalized');
  ok(left.hashBundle.consequenceHash.startsWith('sha256:'), 'Record-write gateway: consequence hash is canonicalized');
  equal(left.mutationHash, reordered.mutationHash, 'Record-write gateway: field ordering does not change mutation hash');
  equal(left.hashBundle.outputHash, reordered.hashBundle.outputHash, 'Record-write gateway: field ordering does not change output binding');
}

async function testValidRecordWriteAllowsAndConsumesToken(): Promise<void> {
  const { issued, verificationKey, decision } = await issueRecordToken({
    tokenId: 'rt_record_write_allow',
    decisionId: 'decision-record-write-allow',
  });
  const { store, introspector } = register(issued, decision);
  const result = await enforceRecordWrite({
    mutation: MUTATION,
    authorization: authorization(issued),
    options: options({
      verificationKey,
      introspector,
      store,
    }),
  });

  equal(result.status, 'allowed', 'Record-write gateway: valid record write is allowed');
  equal(result.responseStatus, 200, 'Record-write gateway: allowed result is admission-ready');
  equal(result.decision?.outcome, 'allow', 'Record-write gateway: valid record write emits allow decision');
  ok(result.receipt?.receiptDigest?.startsWith('sha256:'), 'Record-write gateway: allowed record write emits receipt digest');
  equal(result.request?.targetId, result.binding.target.id, 'Record-write gateway: request target matches record binding');
  equal(result.request?.outputHash, result.binding.hashBundle.outputHash, 'Record-write gateway: request output hash matches binding');
  equal(result.request?.consequenceHash, result.binding.hashBundle.consequenceHash, 'Record-write gateway: request consequence hash matches binding');
  equal(result.request?.transport?.kind, 'artifact', 'Record-write gateway: record write transport binds canonical mutation artifact');
  equal(result.online?.onlineChecked, true, 'Record-write gateway: high-risk record write performs online introspection');
  equal(result.online?.consumed, true, 'Record-write gateway: successful admission consumes token use');
  deepEqual(result.failureReasons, [], 'Record-write gateway: valid record write has no failures');
}

async function testMissingAuthorizationFailsClosed(): Promise<void> {
  const { verificationKey } = await issueRecordToken({
    tokenId: 'rt_record_write_missing',
    decisionId: 'decision-record-write-missing',
  });
  const result = await enforceRecordWrite({
    mutation: MUTATION,
    authorization: null,
    options: options({ verificationKey }),
  });

  equal(result.status, 'denied', 'Record-write gateway: missing authorization is denied');
  equal(result.responseStatus, 401, 'Record-write gateway: missing authorization maps to challenge status');
  deepEqual(result.failureReasons, ['missing-release-authorization'], 'Record-write gateway: missing authorization failure is explicit');
  equal(result.request, null, 'Record-write gateway: missing authorization does not build verifier request');
}

async function testDifferentRecordMutationFailsBinding(): Promise<void> {
  const { issued, verificationKey, decision } = await issueRecordToken({
    tokenId: 'rt_record_write_binding',
    decisionId: 'decision-record-write-binding',
  });
  const { store, introspector } = register(issued, decision);
  const tamperedMutation: RecordWriteMutation = {
    ...MUTATION,
    after: {
      counterparty_name: 'Bank of Nova Scotia',
      exposure_usd: 999999999,
      credit_rating: 'AA-',
      sector: 'Banking',
    },
  };
  const result = await enforceRecordWrite({
    mutation: tamperedMutation,
    authorization: authorization(issued),
    options: options({
      verificationKey,
      introspector,
      store,
    }),
  });

  equal(result.status, 'denied', 'Record-write gateway: changed record payload is denied');
  equal(result.responseStatus, 403, 'Record-write gateway: binding mismatch is non-retryable');
  equal(result.decision?.outcome, 'deny', 'Record-write gateway: changed payload emits deny decision');
  ok(result.failureReasons.includes('binding-mismatch'), 'Record-write gateway: changed payload reports binding mismatch');
}

async function testWrongRecordTargetFailsAudience(): Promise<void> {
  const { issued, verificationKey, decision } = await issueRecordToken({
    tokenId: 'rt_record_write_target',
    decisionId: 'decision-record-write-target',
  });
  const { store, introspector } = register(issued, decision);
  const wrongTargetMutation: RecordWriteMutation = {
    ...MUTATION,
    recordId: 'exposure-002',
  };
  const result = await enforceRecordWrite({
    mutation: wrongTargetMutation,
    authorization: authorization(issued),
    options: options({
      verificationKey,
      introspector,
      store,
    }),
  });

  equal(result.status, 'denied', 'Record-write gateway: wrong record id is denied');
  ok(result.failureReasons.includes('wrong-audience'), 'Record-write gateway: wrong record target reports wrong audience');
  ok(result.failureReasons.includes('binding-mismatch'), 'Record-write gateway: wrong record target also reports binding mismatch');
}

async function testBearerTokenDeniedForRecordWriteProfile(): Promise<void> {
  const { issued, verificationKey, decision } = await issueRecordToken({
    tokenId: 'rt_record_write_bearer',
    decisionId: 'decision-record-write-bearer',
  });
  const { store, introspector } = register(issued, decision);
  const result = await enforceRecordWrite({
    mutation: MUTATION,
    authorization: {
      releaseToken: issued.token,
      releaseTokenId: issued.tokenId,
      releaseDecisionId: decision.id,
      mode: 'bearer-release-token',
    },
    options: options({
      verificationKey,
      introspector,
      store,
    }),
  });

  equal(result.status, 'denied', 'Record-write gateway: bearer token is denied on sender-constrained record-write profile');
  deepEqual(result.failureReasons, ['binding-mismatch'], 'Record-write gateway: bearer downgrade maps to binding mismatch');
}

async function testOfflineHighRiskRemainsDeniedUntilIntrospection(): Promise<void> {
  const { issued, verificationKey } = await issueRecordToken({
    tokenId: 'rt_record_write_offline',
    decisionId: 'decision-record-write-offline',
  });
  const result = await enforceRecordWrite({
    mutation: MUTATION,
    authorization: authorization(issued),
    options: options({
      verificationKey,
      verifierMode: 'offline',
    }),
  });

  equal(result.status, 'denied', 'Record-write gateway: high-risk offline-only path is denied');
  equal(result.responseStatus, 428, 'Record-write gateway: offline high-risk path requires fresh introspection');
  equal(result.offline?.status, 'indeterminate', 'Record-write gateway: offline verifier records indeterminate high-risk posture');
  deepEqual(result.failureReasons, ['fresh-introspection-required'], 'Record-write gateway: fresh introspection requirement is explicit');
}

async function testRevokedTokenFailsClosed(): Promise<void> {
  const { issued, verificationKey, decision } = await issueRecordToken({
    tokenId: 'rt_record_write_revoked',
    decisionId: 'decision-record-write-revoked',
  });
  const { store, introspector } = register(issued, decision);
  store.revokeToken({
    tokenId: issued.tokenId,
    revokedAt: '2026-04-18T17:00:30.000Z',
    reason: 'test revocation',
  });
  const result = await enforceRecordWrite({
    mutation: MUTATION,
    authorization: authorization(issued),
    options: options({
      verificationKey,
      introspector,
      store,
    }),
  });

  equal(result.status, 'denied', 'Record-write gateway: revoked token is denied');
  ok(result.failureReasons.includes('revoked-authorization'), 'Record-write gateway: revoked reason is explicit');
  equal(result.decision?.outcome, 'deny', 'Record-write gateway: revoked token emits deny decision');
}

async function testIntrospectionUnavailableFailsClosed(): Promise<void> {
  const { issued, verificationKey } = await issueRecordToken({
    tokenId: 'rt_record_write_unavailable',
    decisionId: 'decision-record-write-unavailable',
  });
  const introspector: ReleaseTokenIntrospector = {
    async introspect() {
      throw new Error('introspection unavailable');
    },
  };
  const result = await enforceRecordWrite({
    mutation: MUTATION,
    authorization: authorization(issued),
    options: options({
      verificationKey,
      introspector,
    }),
  });

  equal(result.status, 'denied', 'Record-write gateway: introspection outage fails closed');
  equal(result.responseStatus, 503, 'Record-write gateway: introspection outage maps to retryable service failure');
  deepEqual(result.failureReasons, ['introspection-unavailable'], 'Record-write gateway: outage reason is explicit');
  equal(result.verificationResult?.degradedState, 'fail-closed', 'Record-write gateway: degraded state remains fail-closed');
}

async function testCanonicalizationRejectsAmbiguousValues(): Promise<void> {
  assert.throws(
    () => buildRecordWriteCanonicalBinding({
      ...MUTATION,
      after: {
        exposure_usd: Number.POSITIVE_INFINITY,
      },
    }),
    /non-finite number/u,
  );
  passed += 1;

  assert.throws(
    () => buildRecordWriteCanonicalBinding({
      ...MUTATION,
      operation: 'delete',
      before: null,
      after: null,
    }),
    /delete mutations require the prior record state/u,
  );
  passed += 1;
}

async function main(): Promise<void> {
  await testCanonicalBindingIsStable();
  await testValidRecordWriteAllowsAndConsumesToken();
  await testMissingAuthorizationFailsClosed();
  await testDifferentRecordMutationFailsBinding();
  await testWrongRecordTargetFailsAudience();
  await testBearerTokenDeniedForRecordWriteProfile();
  await testOfflineHighRiskRemainsDeniedUntilIntrospection();
  await testRevokedTokenFailsClosed();
  await testIntrospectionUnavailableFailsClosed();
  await testCanonicalizationRejectsAmbiguousValues();

  console.log(`Release enforcement-plane record-write tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease enforcement-plane record-write tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
