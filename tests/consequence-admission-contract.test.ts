import assert from 'node:assert/strict';
import {
  CONSEQUENCE_ADMISSION_CONTRACT_VERSION,
  consequenceAdmissionAllowsConsequence,
  consequenceAdmissionDescriptor,
  createConsequenceAdmissionCheck,
  createConsequenceAdmissionProblem,
  createConsequenceAdmissionRequest,
  createConsequenceAdmissionResponse,
  isConsequenceAdmissionDecision,
  mapCryptoAdmissionOutcomeToAdmission,
  mapFinancePipelineDecisionToAdmission,
  type ConsequenceAdmissionCheck,
  type ConsequenceAdmissionRequest,
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

function deepEqual<T>(actual: T, expected: T, message: string): void {
  assert.deepEqual(actual, expected);
  passed += 1;
}

function requestFixture(): ConsequenceAdmissionRequest {
  return createConsequenceAdmissionRequest({
    requestedAt: '2026-04-23T10:00:00.000Z',
    packFamily: 'finance',
    entryPoint: {
      kind: 'hosted-route',
      id: 'first-finance-pipeline-call',
      route: '/api/v1/pipeline/run',
      packageSubpath: null,
      sourceRef: 'src/service/http/routes/pipeline-execution-routes.ts',
    },
    proposedConsequence: {
      actor: 'AI-assisted finance workflow',
      action: 'prepare governed counterparty exposure record',
      downstreamSystem: 'financial reporting workflow',
      consequenceKind: 'record',
      riskClass: 'R4',
      summary: 'Finance workflow wants to write a regulated reporting-preparation record.',
    },
    policyScope: {
      policyRef: 'policy:finance:first-hard-gateway',
      tenantId: 'tenant_demo',
      environment: 'production',
      dimensions: {
        domain: 'finance',
        consequence: 'record',
      },
    },
    authority: {
      actorRef: 'actor:finance-agent',
      reviewerRef: 'reviewer:jane',
      authorityMode: 'dual-approval',
    },
    evidence: [
      {
        id: 'evidence:fixture:counterparty',
        kind: 'fixture',
        digest: 'sha256:fixture',
        uri: null,
      },
    ],
    nativeInputRefs: ['candidateSql', 'intent', 'fixtures'],
  });
}

function checkFixture(kind: ConsequenceAdmissionCheck['kind']): ConsequenceAdmissionCheck {
  return createConsequenceAdmissionCheck({
    kind,
    label: `${kind} check`,
    outcome: 'pass',
    required: true,
    summary: `${kind} passed for the proposed consequence.`,
    reasonCodes: [`${kind}-passed`],
    evidenceRefs: [`evidence:${kind}`],
  });
}

function testDescriptorAndDecisionHelpers(): void {
  const descriptor = consequenceAdmissionDescriptor();

  equal(descriptor.version, CONSEQUENCE_ADMISSION_CONTRACT_VERSION, 'Admission contract: version is stable');
  deepEqual(
    [...descriptor.decisions],
    ['admit', 'narrow', 'review', 'block'],
    'Admission contract: canonical decisions are stable',
  );
  ok(descriptor.packFamilies.includes('finance'), 'Admission contract: finance pack family is present');
  ok(descriptor.packFamilies.includes('crypto'), 'Admission contract: crypto pack family is present');
  ok(descriptor.checkKinds.includes('freshness'), 'Admission contract: freshness is a first-class check');
  ok(descriptor.checkKinds.includes('enforcement'), 'Admission contract: enforcement is a first-class check');
  ok(isConsequenceAdmissionDecision('admit'), 'Admission contract: admit is recognized');
  ok(!isConsequenceAdmissionDecision('pass'), 'Admission contract: finance pass stays native, not canonical');
  equal(consequenceAdmissionAllowsConsequence('admit'), true, 'Admission contract: admit allows consequence');
  equal(consequenceAdmissionAllowsConsequence('narrow'), true, 'Admission contract: narrow allows constrained consequence');
  equal(consequenceAdmissionAllowsConsequence('review'), false, 'Admission contract: review does not allow automatic consequence');
  equal(consequenceAdmissionAllowsConsequence('block'), false, 'Admission contract: block does not allow consequence');
}

function testNativeDecisionMappingsFailClosed(): void {
  const financePass = mapFinancePipelineDecisionToAdmission('pass');
  const financeReview = mapFinancePipelineDecisionToAdmission('review-required');
  const financeFail = mapFinancePipelineDecisionToAdmission('fail');
  const financeUnknown = mapFinancePipelineDecisionToAdmission('mystery');
  const cryptoAdmit = mapCryptoAdmissionOutcomeToAdmission('admit');
  const cryptoNeedsEvidence = mapCryptoAdmissionOutcomeToAdmission('needs-evidence');
  const cryptoDeny = mapCryptoAdmissionOutcomeToAdmission('deny');
  const cryptoUnknown = mapCryptoAdmissionOutcomeToAdmission('maybe');

  equal(financePass.mappedDecision, 'admit', 'Admission contract: finance pass maps to admit');
  equal(financeReview.mappedDecision, 'review', 'Admission contract: finance review maps to review');
  equal(financeFail.mappedDecision, 'block', 'Admission contract: finance fail maps to block');
  equal(financeUnknown.mappedDecision, 'block', 'Admission contract: unknown finance values fail closed');
  equal(cryptoAdmit.mappedDecision, 'admit', 'Admission contract: crypto admit maps to admit');
  equal(cryptoNeedsEvidence.mappedDecision, 'review', 'Admission contract: crypto needs-evidence maps to review');
  equal(cryptoDeny.mappedDecision, 'block', 'Admission contract: crypto deny maps to block');
  equal(cryptoUnknown.mappedDecision, 'block', 'Admission contract: unknown crypto values fail closed');
}

function testRequestAndResponseAreCanonicalAndProofBearing(): void {
  const request = requestFixture();
  const nativeDecision = mapFinancePipelineDecisionToAdmission('pass');
  const response = createConsequenceAdmissionResponse({
    request,
    decidedAt: '2026-04-23T10:00:01.000Z',
    decision: nativeDecision.mappedDecision,
    reason: 'Finance pipeline passed the policy, authority, and evidence gate.',
    reasonCodes: ['finance-pass'],
    checks: [
      checkFixture('policy'),
      checkFixture('authority'),
      checkFixture('evidence'),
      checkFixture('freshness'),
      checkFixture('enforcement'),
    ],
    nativeDecision,
    proof: [
      {
        kind: 'verification-kit',
        id: 'kit:finance:counterparty',
        digest: 'sha256:kit',
        uri: '.attestor/showcase/latest/evidence/kit.json',
        verifyHint: 'Run npm run verify:cert with the generated kit.',
      },
    ],
    operationalContext: {
      tenantId: 'tenant_demo',
      planId: 'community',
    },
  });

  equal(request.version, CONSEQUENCE_ADMISSION_CONTRACT_VERSION, 'Admission contract: request version is stable');
  ok(request.requestId.startsWith('sha256:'), 'Admission contract: request id is digest-shaped');
  equal(response.decision, 'admit', 'Admission contract: response decision is canonical');
  equal(response.allowed, true, 'Admission contract: admitted response is allowed');
  equal(response.failClosed, false, 'Admission contract: admitted response is not fail-closed');
  equal(response.nativeDecision?.value, 'pass', 'Admission contract: native finance value is preserved');
  equal(response.proof[0]?.kind, 'verification-kit', 'Admission contract: proof refs are preserved');
  ok(response.admissionId.startsWith('sha256:'), 'Admission contract: admission id is digest-shaped');
  ok(response.digest.startsWith('sha256:'), 'Admission contract: response digest is canonical');
  equal(JSON.parse(response.canonical).decision, 'admit', 'Admission contract: canonical JSON is parseable');
}

function testReviewAndBlockPosturesFailClosed(): void {
  const request = requestFixture();
  const reviewDecision = mapCryptoAdmissionOutcomeToAdmission('needs-evidence');
  const review = createConsequenceAdmissionResponse({
    request: {
      ...request,
      packFamily: 'crypto',
    },
    decidedAt: '2026-04-23T10:00:02.000Z',
    decision: reviewDecision.mappedDecision,
    reason: 'Crypto admission needs more evidence before execution.',
    reasonCodes: ['crypto-needs-evidence'],
    nativeDecision: reviewDecision,
  });
  const blockDecision = mapCryptoAdmissionOutcomeToAdmission('deny');
  const block = createConsequenceAdmissionResponse({
    request: {
      ...request,
      packFamily: 'crypto',
    },
    decidedAt: '2026-04-23T10:00:03.000Z',
    decision: blockDecision.mappedDecision,
    reason: 'Crypto admission denied the execution path.',
    reasonCodes: ['crypto-deny'],
    nativeDecision: blockDecision,
  });

  equal(review.allowed, false, 'Admission contract: review does not allow automatic consequence');
  equal(review.failClosed, true, 'Admission contract: review fails closed by default');
  equal(block.allowed, false, 'Admission contract: block does not allow consequence');
  equal(block.failClosed, true, 'Admission contract: block fails closed');
}

function testNarrowRequiresExplicitConstraints(): void {
  const request = requestFixture();

  assert.throws(
    () =>
      createConsequenceAdmissionResponse({
        request,
        decidedAt: '2026-04-23T10:00:04.000Z',
        decision: 'narrow',
        reason: 'Narrow needs constraints.',
      }),
    /narrow decisions require at least one explicit constraint/u,
  );
  passed += 1;

  const narrow = createConsequenceAdmissionResponse({
    request,
    decidedAt: '2026-04-23T10:00:05.000Z',
    decision: 'narrow',
    reason: 'Proceed only with a lower payment amount.',
    constraints: [
      {
        id: 'constraint:max-amount',
        summary: 'Maximum amount is reduced to the policy budget.',
        enforcedBy: 'customer payment service',
      },
    ],
  });

  equal(narrow.allowed, true, 'Admission contract: narrow allows only constrained consequence');
  equal(narrow.constraints.length, 1, 'Admission contract: narrow carries explicit constraints');
}

function testProblemShapeIsFailClosed(): void {
  const problem = createConsequenceAdmissionProblem({
    type: 'https://attestor.dev/problems/admission-input-invalid',
    title: 'Invalid admission input',
    status: 400,
    detail: 'The proposed consequence is missing required evidence.',
    instance: '/api/v1/consequence/admit',
    reasonCodes: ['missing-evidence'],
  });

  equal(problem.decision, 'block', 'Admission contract: problem shape blocks by default');
  equal(problem.failClosed, true, 'Admission contract: problem shape is fail closed');
  equal(problem.reasonCodes[0], 'missing-evidence', 'Admission contract: problem shape carries reason codes');
}

testDescriptorAndDecisionHelpers();
testNativeDecisionMappingsFailClosed();
testRequestAndResponseAreCanonicalAndProofBearing();
testReviewAndBlockPosturesFailClosed();
testNarrowRequiresExplicitConstraints();
testProblemShapeIsFailClosed();

console.log(`Consequence admission contract tests: ${passed} passed, 0 failed`);
