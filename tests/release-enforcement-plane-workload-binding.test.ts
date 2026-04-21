import assert from 'node:assert/strict';
import { generateKeyPair } from '../src/signing/keys.js';
import { createReleaseDecisionSkeleton } from '../src/release-kernel/object-model.js';
import {
  createReleaseTokenIssuer,
  type IssuedReleaseToken,
  type ReleaseTokenVerificationKey,
} from '../src/release-kernel/release-token.js';
import type {
  ReleaseDecision,
  ReleaseTokenConfirmationClaim,
} from '../src/release-kernel/object-model.js';
import {
  createEnforcementRequest,
  createReleasePresentation,
  type EnforcementRequest,
} from '../src/release-enforcement-plane/object-model.js';
import { verifyOfflineReleaseAuthorization } from '../src/release-enforcement-plane/offline-verifier.js';
import {
  exchangeReleaseToken,
  type ReleaseTokenExchangePolicy,
} from '../src/release-enforcement-plane/token-exchange.js';
import {
  MTLS_CERTIFICATE_CONFIRMATION_CLAIM,
  WORKLOAD_BINDING_PRESENTATION_SPEC_VERSION,
  certificateThumbprintFromDer,
  certificateThumbprintFromPem,
  createMtlsBoundPresentationFromIssuedToken,
  createMtlsReleaseTokenConfirmation,
  createSpiffeBoundPresentationFromIssuedToken,
  createSpiffeReleaseTokenConfirmation,
  normalizeSpiffeId,
  trustDomainFromSpiffeId,
  verifyWorkloadBoundPresentation,
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

const CERT_DER = Buffer.from('attestor-workload-certificate-fixture');
const CERT_THUMBPRINT = certificateThumbprintFromDer(CERT_DER);
const SPIFFE_ID = 'spiffe://attestor.test/ns/finance/sa/writer';
const TARGET_ID = 'finance.reporting.record-store';

function makeDecision(input: {
  readonly id: string;
  readonly consequenceType?: 'record' | 'action';
  readonly riskClass?: 'R2' | 'R4';
  readonly targetId?: string;
}) {
  const consequenceType = input.consequenceType ?? 'record';
  const targetId = input.targetId ?? TARGET_ID;
  return createReleaseDecisionSkeleton({
    id: input.id,
    createdAt: '2026-04-18T12:00:00.000Z',
    status: 'accepted',
    policyVersion: 'policy.release-workload-binding-test.v1',
    policyHash: 'sha256:policy',
    outputHash: 'sha256:output',
    consequenceHash: 'sha256:consequence',
    outputContract: {
      artifactType: 'release-workload-binding-test.artifact',
      expectedShape: 'deterministic test artifact',
      consequenceType,
      riskClass: input.riskClass ?? 'R4',
    },
    capabilityBoundary: {
      allowedTools: ['release-workload-binding-test-tool'],
      allowedTargets: [targetId],
      allowedDataDomains: ['release-workload-binding-test'],
    },
    requester: {
      id: 'svc.release-workload-binding-test',
      type: 'service',
    },
    target: {
      kind: consequenceType === 'record' ? 'record-store' : 'workflow',
      id: targetId,
    },
  });
}

function makeRequest(input: {
  readonly id: string;
  readonly targetId?: string;
  readonly consequenceType?: 'record' | 'action';
  readonly boundaryKind?: 'record-write' | 'action-dispatch';
  readonly pointKind?: 'record-write-gateway' | 'action-dispatch-gateway';
  readonly riskClass?: 'R2' | 'R4';
  readonly releaseTokenId: string;
  readonly releaseDecisionId: string;
}): EnforcementRequest {
  const consequenceType = input.consequenceType ?? 'record';
  return createEnforcementRequest({
    id: input.id,
    receivedAt: '2026-04-18T12:01:00.000Z',
    enforcementPoint: {
      environment: 'test',
      enforcementPointId: `${input.id}-pep`,
      pointKind:
        input.pointKind ??
        (consequenceType === 'record' ? 'record-write-gateway' : 'action-dispatch-gateway'),
      boundaryKind:
        input.boundaryKind ??
        (consequenceType === 'record' ? 'record-write' : 'action-dispatch'),
      consequenceType,
      riskClass: input.riskClass ?? 'R4',
      tenantId: 'tenant-test',
      accountId: 'acct-test',
      workloadId: SPIFFE_ID,
      audience: input.targetId ?? TARGET_ID,
    },
    targetId: input.targetId ?? TARGET_ID,
    outputHash: 'sha256:output',
    consequenceHash: 'sha256:consequence',
    releaseTokenId: input.releaseTokenId,
    releaseDecisionId: input.releaseDecisionId,
    transport: {
      kind: 'http',
      method: 'POST',
      uri: `https://attestor.test/${input.id}`,
      headersDigest: 'sha256:headers',
      bodyDigest: 'sha256:body',
    },
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

async function issueWorkloadToken(input: {
  readonly tokenId: string;
  readonly decisionId: string;
  readonly confirmation?: ReleaseTokenConfirmationClaim;
  readonly consequenceType?: 'record' | 'action';
  readonly targetId?: string;
}): Promise<{
  readonly issued: IssuedReleaseToken;
  readonly verificationKey: ReleaseTokenVerificationKey;
  readonly decision: ReleaseDecision;
  readonly issuer: Awaited<ReturnType<typeof setupIssuer>>['issuer'];
}> {
  const { issuer, verificationKey } = await setupIssuer();
  const decision = makeDecision({
    id: input.decisionId,
    consequenceType: input.consequenceType,
    targetId: input.targetId,
  });
  const issued = await issuer.issue({
    decision,
    issuedAt: '2026-04-18T12:00:00.000Z',
    tokenId: input.tokenId,
    confirmation: input.confirmation,
  });

  return {
    issuer,
    verificationKey,
    decision,
    issued,
  };
}

function testCertificateThumbprintHelpers(): void {
  const pem = [
    '-----BEGIN CERTIFICATE-----',
    CERT_DER.toString('base64'),
    '-----END CERTIFICATE-----',
  ].join('\n');

  equal(
    certificateThumbprintFromPem(pem),
    CERT_THUMBPRINT,
    'Workload binding: PEM and DER certificate thumbprints match',
  );
  ok(!CERT_THUMBPRINT.includes('='), 'Workload binding: certificate thumbprint uses unpadded base64url');
}

function testSpiffeNormalization(): void {
  equal(
    normalizeSpiffeId('spiffe://ATTESTOR.TEST/ns/Finance/sa/writer'),
    SPIFFE_ID.replace('/finance/', '/Finance/'),
    'Workload binding: SPIFFE scheme and trust domain normalize while path stays case-sensitive',
  );
  equal(
    trustDomainFromSpiffeId(SPIFFE_ID),
    'attestor.test',
    'Workload binding: trust domain is derived from SPIFFE ID',
  );

  assert.throws(
    () => normalizeSpiffeId('https://attestor.test/ns/finance/sa/writer'),
    /spiffe scheme/i,
  );
  passed += 1;
}

function testConfirmationClaims(): void {
  const mtls = createMtlsReleaseTokenConfirmation({
    certificateThumbprint: CERT_THUMBPRINT,
    spiffeId: SPIFFE_ID,
  });
  const spiffe = createSpiffeReleaseTokenConfirmation({
    certificateThumbprint: CERT_THUMBPRINT,
    spiffeId: SPIFFE_ID,
  });

  equal(
    mtls[MTLS_CERTIFICATE_CONFIRMATION_CLAIM],
    CERT_THUMBPRINT,
    'Workload binding: mTLS confirmation carries x5t#S256 certificate thumbprint',
  );
  equal(mtls.spiffe_id, SPIFFE_ID, 'Workload binding: mTLS confirmation can also pin SPIFFE ID');
  equal(spiffe.spiffe_trust_domain, 'attestor.test', 'Workload binding: SPIFFE confirmation pins trust domain');

  assert.throws(
    () =>
      createSpiffeReleaseTokenConfirmation({
        spiffeId: SPIFFE_ID,
        trustDomain: 'other.test',
      }),
    /trust domain must match/i,
  );
  passed += 1;
}

async function testMtlsPresentationAndOfflineVerifier(): Promise<void> {
  const { issued, verificationKey, decision } = await issueWorkloadToken({
    tokenId: 'rt_mtls_workload',
    decisionId: 'decision-mtls-workload',
    confirmation: createMtlsReleaseTokenConfirmation({
      certificateThumbprint: CERT_THUMBPRINT,
      spiffeId: SPIFFE_ID,
    }),
  });
  const request = makeRequest({
    id: 'erq-mtls-workload',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });
  const presentation = createMtlsBoundPresentationFromIssuedToken({
    issuedToken: issued,
    certificateThumbprint: CERT_THUMBPRINT,
    subjectDn: 'CN=finance-writer',
    spiffeId: SPIFFE_ID,
    presentedAt: '2026-04-18T12:01:00.000Z',
  });
  const binding = verifyWorkloadBoundPresentation({
    presentation,
    claims: issued.claims,
    expectedSpiffeId: SPIFFE_ID,
    expectedCertificateThumbprint: CERT_THUMBPRINT,
    checkedAt: '2026-04-18T12:01:00.000Z',
  });

  equal(binding.version, WORKLOAD_BINDING_PRESENTATION_SPEC_VERSION, 'Workload binding: verification stamps stable spec version');
  equal(binding.status, 'valid', 'Workload binding: matching mTLS proof validates');
  deepEqual(binding.failureReasons, [], 'Workload binding: matching mTLS proof has no failures');

  const verified = await verifyOfflineReleaseAuthorization({
    request,
    presentation,
    verificationKey,
    now: '2026-04-18T12:01:00.000Z',
  });

  equal(verified.status, 'indeterminate', 'Workload binding: R4 mTLS authorization still requires online liveness');
  equal(verified.offlineVerified, true, 'Workload binding: mTLS token binding passes local verifier');
  deepEqual(verified.failureReasons, ['fresh-introspection-required'], 'Workload binding: only online liveness remains for R4');
}

async function testMtlsRejectsWrongCertificate(): Promise<void> {
  const { issued, verificationKey, decision } = await issueWorkloadToken({
    tokenId: 'rt_mtls_wrong_cert',
    decisionId: 'decision-mtls-wrong-cert',
    confirmation: createMtlsReleaseTokenConfirmation({
      certificateThumbprint: CERT_THUMBPRINT,
      spiffeId: SPIFFE_ID,
    }),
  });
  const request = makeRequest({
    id: 'erq-mtls-wrong-cert',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });

  const verified = await verifyOfflineReleaseAuthorization({
    request,
    presentation: createMtlsBoundPresentationFromIssuedToken({
      issuedToken: issued,
      certificateThumbprint: certificateThumbprintFromDer(Buffer.from('wrong-certificate')),
      spiffeId: SPIFFE_ID,
      presentedAt: '2026-04-18T12:01:00.000Z',
    }),
    verificationKey,
    now: '2026-04-18T12:01:00.000Z',
  });

  equal(verified.status, 'invalid', 'Workload binding: wrong certificate thumbprint fails closed');
  deepEqual(verified.failureReasons, ['fresh-introspection-required', 'binding-mismatch'], 'Workload binding: certificate mismatch is explicit');
}

async function testMtlsRejectsUnboundToken(): Promise<void> {
  const { issued, verificationKey, decision } = await issueWorkloadToken({
    tokenId: 'rt_mtls_unbound',
    decisionId: 'decision-mtls-unbound',
  });
  const request = makeRequest({
    id: 'erq-mtls-unbound',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });

  const verified = await verifyOfflineReleaseAuthorization({
    request,
    presentation: createMtlsBoundPresentationFromIssuedToken({
      issuedToken: issued,
      certificateThumbprint: CERT_THUMBPRINT,
      spiffeId: SPIFFE_ID,
      presentedAt: '2026-04-18T12:01:00.000Z',
    }),
    verificationKey,
    now: '2026-04-18T12:01:00.000Z',
  });

  equal(verified.status, 'invalid', 'Workload binding: mTLS presentation requires a cert-bound token');
  deepEqual(verified.failureReasons, ['fresh-introspection-required', 'binding-mismatch'], 'Workload binding: unbound mTLS token fails as binding mismatch');
}

async function testSpiffePresentationAndOfflineVerifier(): Promise<void> {
  const { issued, verificationKey, decision } = await issueWorkloadToken({
    tokenId: 'rt_spiffe_workload',
    decisionId: 'decision-spiffe-workload',
    consequenceType: 'action',
    targetId: 'workflow.finance-close.dispatch',
    confirmation: createSpiffeReleaseTokenConfirmation({
      certificateThumbprint: CERT_THUMBPRINT,
      spiffeId: SPIFFE_ID,
    }),
  });
  const request = makeRequest({
    id: 'erq-spiffe-workload',
    consequenceType: 'action',
    boundaryKind: 'action-dispatch',
    pointKind: 'action-dispatch-gateway',
    targetId: 'workflow.finance-close.dispatch',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });
  const presentation = createSpiffeBoundPresentationFromIssuedToken({
    issuedToken: issued,
    spiffeId: SPIFFE_ID,
    svidThumbprint: CERT_THUMBPRINT,
    presentedAt: '2026-04-18T12:01:00.000Z',
  });
  const binding = verifyWorkloadBoundPresentation({
    presentation,
    claims: issued.claims,
    expectedTrustDomain: 'attestor.test',
    checkedAt: '2026-04-18T12:01:00.000Z',
  });

  equal(binding.status, 'valid', 'Workload binding: matching SPIFFE proof validates');
  equal(binding.trustDomain, 'attestor.test', 'Workload binding: SPIFFE proof exposes trust domain');

  const verified = await verifyOfflineReleaseAuthorization({
    request,
    presentation,
    verificationKey,
    now: '2026-04-18T12:01:00.000Z',
  });

  equal(verified.status, 'indeterminate', 'Workload binding: R4 SPIFFE authorization still requires online liveness');
  equal(verified.offlineVerified, true, 'Workload binding: SPIFFE token binding passes local verifier');
}

async function testSpiffeRejectsWrongIdentity(): Promise<void> {
  const { issued, verificationKey, decision } = await issueWorkloadToken({
    tokenId: 'rt_spiffe_wrong_id',
    decisionId: 'decision-spiffe-wrong-id',
    consequenceType: 'action',
    targetId: 'workflow.finance-close.dispatch',
    confirmation: createSpiffeReleaseTokenConfirmation({
      spiffeId: SPIFFE_ID,
    }),
  });
  const request = makeRequest({
    id: 'erq-spiffe-wrong-id',
    consequenceType: 'action',
    boundaryKind: 'action-dispatch',
    pointKind: 'action-dispatch-gateway',
    targetId: 'workflow.finance-close.dispatch',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });

  const verified = await verifyOfflineReleaseAuthorization({
    request,
    presentation: createSpiffeBoundPresentationFromIssuedToken({
      issuedToken: issued,
      spiffeId: 'spiffe://attestor.test/ns/finance/sa/other',
      presentedAt: '2026-04-18T12:01:00.000Z',
    }),
    verificationKey,
    now: '2026-04-18T12:01:00.000Z',
  });

  equal(verified.status, 'invalid', 'Workload binding: wrong SPIFFE ID fails closed');
  deepEqual(verified.failureReasons, ['fresh-introspection-required', 'binding-mismatch'], 'Workload binding: SPIFFE mismatch is explicit');
}

async function testSpiffeRejectsWrongSvidThumbprint(): Promise<void> {
  const { issued, verificationKey, decision } = await issueWorkloadToken({
    tokenId: 'rt_spiffe_wrong_svid',
    decisionId: 'decision-spiffe-wrong-svid',
    consequenceType: 'action',
    targetId: 'workflow.finance-close.dispatch',
    confirmation: createSpiffeReleaseTokenConfirmation({
      certificateThumbprint: CERT_THUMBPRINT,
      spiffeId: SPIFFE_ID,
    }),
  });
  const request = makeRequest({
    id: 'erq-spiffe-wrong-svid',
    consequenceType: 'action',
    boundaryKind: 'action-dispatch',
    pointKind: 'action-dispatch-gateway',
    targetId: 'workflow.finance-close.dispatch',
    releaseTokenId: issued.tokenId,
    releaseDecisionId: decision.id,
  });

  const verified = await verifyOfflineReleaseAuthorization({
    request,
    presentation: createSpiffeBoundPresentationFromIssuedToken({
      issuedToken: issued,
      spiffeId: SPIFFE_ID,
      svidThumbprint: certificateThumbprintFromDer(Buffer.from('wrong-svid')),
      presentedAt: '2026-04-18T12:01:00.000Z',
    }),
    verificationKey,
    now: '2026-04-18T12:01:00.000Z',
  });

  equal(verified.status, 'invalid', 'Workload binding: wrong SVID thumbprint fails closed');
  deepEqual(verified.failureReasons, ['fresh-introspection-required', 'binding-mismatch'], 'Workload binding: SVID thumbprint mismatch is explicit');
}

async function testTokenExchangePreservesWorkloadBinding(): Promise<void> {
  const { issuer, verificationKey, decision, issued } = await issueWorkloadToken({
    tokenId: 'rt_exchange_source',
    decisionId: 'decision-exchange-source',
    confirmation: createMtlsReleaseTokenConfirmation({
      certificateThumbprint: CERT_THUMBPRINT,
      spiffeId: SPIFFE_ID,
    }),
  });
  const policy: ReleaseTokenExchangePolicy = {
    allowedAudiences: ['finance.reporting.downstream'],
    allowedScopes: ['release:record'],
    maxTtlSeconds: 120,
    maxUses: 1,
  };
  const exchange = await exchangeReleaseToken({
    request: {
      id: 'exchange-workload-binding',
      requestedAt: '2026-04-18T12:01:00.000Z',
      subjectToken: issued.token,
      audience: 'finance.reporting.downstream',
      scope: 'release:record',
      tokenId: 'rt_exchange_child',
    },
    issuer,
    verificationKey,
    policy,
    sourceAudience: TARGET_ID,
  });

  equal(exchange.status, 'issued', 'Workload binding: token exchange still issues valid downstream token');
  if (exchange.status !== 'issued') {
    throw new Error('Expected issued token exchange in workload-binding test.');
  }
  equal(
    exchange.issuedToken.claims.cnf?.[MTLS_CERTIFICATE_CONFIRMATION_CLAIM],
    CERT_THUMBPRINT,
    'Workload binding: token exchange preserves certificate-bound confirmation',
  );
  equal(exchange.issuedToken.claims.cnf?.spiffe_id, SPIFFE_ID, 'Workload binding: token exchange preserves SPIFFE confirmation');

  const request = makeRequest({
    id: 'erq-exchange-workload-binding',
    targetId: 'finance.reporting.downstream',
    releaseTokenId: exchange.issuedToken.tokenId,
    releaseDecisionId: decision.id,
  });
  const verified = await verifyOfflineReleaseAuthorization({
    request,
    presentation: createMtlsBoundPresentationFromIssuedToken({
      issuedToken: exchange.issuedToken,
      certificateThumbprint: CERT_THUMBPRINT,
      spiffeId: SPIFFE_ID,
      presentedAt: '2026-04-18T12:01:30.000Z',
    }),
    verificationKey,
    now: '2026-04-18T12:01:30.000Z',
  });

  equal(verified.offlineVerified, true, 'Workload binding: exchanged token remains workload-bound at downstream PEP');
}

function testPresentationMetadataTamperingFails(): void {
  const claims = {
    cnf: createSpiffeReleaseTokenConfirmation({
      spiffeId: SPIFFE_ID,
    }),
  } as const;
  const presentation = createReleasePresentation({
    mode: 'spiffe-bound-token',
    presentedAt: '2026-04-18T12:01:00.000Z',
    proof: {
      kind: 'spiffe',
      spiffeId: SPIFFE_ID,
      trustDomain: 'other.test',
      svidThumbprint: null,
    },
  });
  const verified = verifyWorkloadBoundPresentation({
    presentation,
    claims: {
      ...claims,
      version: 'attestor.release-token.v1',
      iss: 'attestor.release.local',
      sub: 'releaseDecision:decision-spiffe',
      aud: TARGET_ID,
      jti: 'rt_spiffe_tamper',
      iat: 1776513600,
      nbf: 1776513600,
      exp: 1776513900,
      decision_id: 'decision-spiffe',
      decision: 'accepted',
      consequence_type: 'action',
      risk_class: 'R4',
      output_hash: 'sha256:output',
      consequence_hash: 'sha256:consequence',
      policy_hash: 'sha256:policy',
      override: false,
      introspection_required: true,
      authority_mode: 'dual-approval',
    },
    checkedAt: '2026-04-18T12:01:00.000Z',
  });

  equal(verified.status, 'invalid', 'Workload binding: tampered SPIFFE trust-domain metadata is invalid');
  deepEqual(verified.failureReasons, ['binding-mismatch'], 'Workload binding: metadata tampering maps to binding mismatch');
}

async function main(): Promise<void> {
  testCertificateThumbprintHelpers();
  testSpiffeNormalization();
  testConfirmationClaims();
  await testMtlsPresentationAndOfflineVerifier();
  await testMtlsRejectsWrongCertificate();
  await testMtlsRejectsUnboundToken();
  await testSpiffePresentationAndOfflineVerifier();
  await testSpiffeRejectsWrongIdentity();
  await testSpiffeRejectsWrongSvidThumbprint();
  await testTokenExchangePreservesWorkloadBinding();
  testPresentationMetadataTamperingFails();

  console.log(`Release enforcement-plane workload-binding tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease enforcement-plane workload-binding tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
