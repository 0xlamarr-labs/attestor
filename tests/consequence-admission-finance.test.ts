import assert from 'node:assert/strict';
import {
  createFinancePipelineAdmissionRequest,
  createFinancePipelineAdmissionResponse,
  financePipelineAdmissionDescriptor,
  type ConsequenceAdmissionCheck,
  type ConsequenceAdmissionResponse,
  type FinancePipelineAdmissionRun,
} from '../src/consequence-admission/index.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function check(
  response: ConsequenceAdmissionResponse,
  kind: ConsequenceAdmissionCheck['kind'],
): ConsequenceAdmissionCheck {
  const match = response.checks.find((entry) => entry.kind === kind);
  assert.ok(match, `Expected ${kind} check to exist`);
  return match;
}

function requestFixture() {
  return createFinancePipelineAdmissionRequest({
    requestedAt: '2026-04-23T12:00:00.000Z',
    runId: 'run_finance_admission_001',
    tenantId: 'tenant_demo',
    environment: 'hosted',
    actorRef: 'actor:finance-agent',
    reviewerRef: 'reviewer:finance-controller',
    authorityMode: 'dual-approval',
    evidence: [
      {
        id: 'evidence:fixture:counterparty',
        kind: 'fixture',
        digest: 'sha256:fixture',
        uri: null,
      },
    ],
  });
}

function baseRun(overrides: Partial<FinancePipelineAdmissionRun> = {}): FinancePipelineAdmissionRun {
  return {
    runId: 'run_finance_admission_001',
    decision: 'pass',
    proofMode: 'fixture',
    warrant: 'issued',
    escrow: 'released',
    receipt: 'issued',
    capsule: 'closed',
    auditChainIntact: true,
    certificate: {
      certificateId: 'cert_finance_001',
      signing: {
        fingerprint: 'fingerprint_finance_001',
      },
    },
    verification: {
      path: '.attestor/verification/finance-kit.json',
      digest: 'sha256:verification',
    },
    signingMode: 'keyless',
    identitySource: 'operator_asserted',
    reviewerName: 'Finance Controller',
    tenantContext: {
      tenantId: 'tenant_demo',
      source: 'hosted',
      planId: 'community',
    },
    usage: {
      used: 1,
      remaining: 99,
      quota: 100,
      enforced: true,
    },
    rateLimit: {
      remaining: 49,
      resetAt: '2026-04-23T13:00:00.000Z',
      enforced: true,
    },
    ...overrides,
  };
}

function testDescriptorAndRequestStayOnTheExistingFinanceRoute(): void {
  const descriptor = financePipelineAdmissionDescriptor();
  const request = requestFixture();

  equal(descriptor.packFamily, 'finance', 'Finance admission: descriptor stays in the finance pack');
  equal(descriptor.route, '/api/v1/pipeline/run', 'Finance admission: existing hosted route is wrapped');
  equal(descriptor.hostedRouteBehavior, 'unchanged', 'Finance admission: hosted route behavior is unchanged');
  equal(request.packFamily, 'finance', 'Finance admission: request uses finance pack family');
  equal(request.entryPoint.kind, 'hosted-route', 'Finance admission: request entry point is a hosted route');
  equal(request.entryPoint.route, '/api/v1/pipeline/run', 'Finance admission: request points at the current pipeline route');
  equal(request.proposedConsequence.riskClass, 'R4', 'Finance admission: default risk class is high consequence');
  ok(request.nativeInputRefs.includes('candidateSql'), 'Finance admission: native pipeline input refs are preserved');
}

function testNativePipelinePassMapsToAdmitWithProof(): void {
  const response = createFinancePipelineAdmissionResponse({
    request: requestFixture(),
    run: baseRun(),
    decidedAt: '2026-04-23T12:00:01.000Z',
  });

  equal(response.decision, 'admit', 'Finance admission: pipeline pass maps to admit');
  equal(response.allowed, true, 'Finance admission: admitted finance response is allowed');
  equal(response.failClosed, false, 'Finance admission: admitted response is not fail closed');
  equal(response.nativeDecision?.value, 'pass', 'Finance admission: native decision is preserved');
  equal(response.nativeDecision?.surface, 'finance-pipeline', 'Finance admission: native surface is finance pipeline');
  equal(check(response, 'policy').outcome, 'pass', 'Finance admission: policy check passes on pass');
  equal(check(response, 'authority').outcome, 'pass', 'Finance admission: authority material is detected');
  equal(check(response, 'evidence').outcome, 'pass', 'Finance admission: certificate and verification material are detected');
  equal(check(response, 'enforcement').outcome, 'warn', 'Finance admission: no release token is explicit enforcement warning');
  equal(response.proof[0]?.kind, 'certificate', 'Finance admission: certificate proof is exposed');
  ok(response.proof.some((entry) => entry.kind === 'verification-kit'), 'Finance admission: verification proof is exposed');
  equal(response.operationalContext.tenantId, 'tenant_demo', 'Finance admission: tenant context is preserved');
}

function testAcceptedFilingReleaseMapsToAdmitWithTokenAndEvidencePack(): void {
  const response = createFinancePipelineAdmissionResponse({
    request: requestFixture(),
    run: baseRun({
      release: {
        filingExport: {
          targetId: 'filing_target_001',
          decisionId: 'release_decision_001',
          decisionStatus: 'accepted',
          policyVersion: 'finance-policy-v1',
          introspectionRequired: true,
          outputHash: 'sha256:output',
          consequenceHash: 'sha256:consequence',
          tokenId: 'release_token_001',
          token: 'token',
          expiresAt: '2026-04-23T13:00:00.000Z',
          evidencePackId: 'evidence_pack_001',
          evidencePackPath: '/api/v1/admin/release-evidence/evidence_pack_001',
          evidencePackDigest: 'sha256:evidencepack',
        },
      },
    }),
    decidedAt: '2026-04-23T12:00:01.000Z',
  });

  equal(response.decision, 'admit', 'Finance admission: accepted filing release maps to admit');
  equal(response.reason, 'Finance filing release status accepted maps to canonical admit.', 'Finance admission: release status is the decision source');
  equal(check(response, 'freshness').outcome, 'pass', 'Finance admission: unexpired release token is fresh');
  equal(check(response, 'enforcement').outcome, 'pass', 'Finance admission: release token satisfies enforcement check');
  ok(response.proof.some((entry) => entry.kind === 'release-token'), 'Finance admission: release token proof is exposed');
  ok(response.proof.some((entry) => entry.kind === 'release-evidence-pack'), 'Finance admission: release evidence pack proof is exposed');
  equal(response.operationalContext.releaseDecisionId, 'release_decision_001', 'Finance admission: release decision context is preserved');
  equal(response.operationalContext.releaseIntrospectionRequired, true, 'Finance admission: introspection requirement is preserved');
}

function testReviewRequiredFilingReleaseFailsClosed(): void {
  const response = createFinancePipelineAdmissionResponse({
    request: requestFixture(),
    run: baseRun({
      release: {
        filingExport: {
          decisionId: 'release_decision_review',
          decisionStatus: 'review-required',
          policyVersion: 'finance-policy-v1',
          reviewQueueId: 'review_queue_001',
          reviewQueuePath: '/api/v1/admin/release-reviews/review_queue_001',
        },
      },
    }),
    decidedAt: '2026-04-23T12:00:01.000Z',
  });

  equal(response.decision, 'review', 'Finance admission: review-required maps to review');
  equal(response.allowed, false, 'Finance admission: review does not allow automatic consequence');
  equal(response.failClosed, true, 'Finance admission: review is fail closed');
  equal(check(response, 'policy').outcome, 'warn', 'Finance admission: review policy branch warns');
  equal(check(response, 'enforcement').outcome, 'warn', 'Finance admission: review queue warns enforcement');
  ok(response.proof.some((entry) => entry.id === 'review_queue_001'), 'Finance admission: review queue proof is exposed');
}

function testDeniedOrUnknownFinanceValuesBlock(): void {
  const denied = createFinancePipelineAdmissionResponse({
    request: requestFixture(),
    run: baseRun({
      release: {
        filingExport: {
          decisionId: 'release_decision_denied',
          decisionStatus: 'denied',
          policyVersion: 'finance-policy-v1',
        },
      },
    }),
    decidedAt: '2026-04-23T12:00:01.000Z',
  });
  const unknown = createFinancePipelineAdmissionResponse({
    request: requestFixture(),
    run: baseRun({
      decision: 'mystery',
      proofMode: null,
      warrant: null,
      escrow: null,
      receipt: null,
      capsule: null,
      certificate: null,
      verification: null,
      auditChainIntact: false,
    }),
    decidedAt: '2026-04-23T12:00:01.000Z',
  });

  equal(denied.decision, 'block', 'Finance admission: denied release status maps to block');
  equal(denied.allowed, false, 'Finance admission: denied release status is not allowed');
  equal(denied.failClosed, true, 'Finance admission: denied release status fails closed');
  equal(check(denied, 'policy').outcome, 'fail', 'Finance admission: denied release status fails policy');
  equal(unknown.decision, 'block', 'Finance admission: unknown pipeline values map to block');
  equal(unknown.failClosed, true, 'Finance admission: unknown pipeline values fail closed');
  equal(check(unknown, 'evidence').outcome, 'fail', 'Finance admission: missing proof fails evidence on unknown value');
}

testDescriptorAndRequestStayOnTheExistingFinanceRoute();
testNativePipelinePassMapsToAdmitWithProof();
testAcceptedFilingReleaseMapsToAdmitWithTokenAndEvidencePack();
testReviewRequiredFilingReleaseFailsClosed();
testDeniedOrUnknownFinanceValuesBlock();

console.log(`Consequence admission finance tests: ${passed} passed, 0 failed`);
