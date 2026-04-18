import assert from 'node:assert/strict';
import {
  BOUNDARY_VERIFICATION_BASELINES,
  RISK_VERIFICATION_BASELINES,
  SENDER_CONSTRAINED_PRESENTATION_MODES,
  VERIFICATION_PROFILE_MATRIX_SPEC_VERSION,
  resolveVerificationProfile,
  verificationProfileMatrixDescriptor,
} from '../src/release-enforcement-plane/verification-profiles.js';

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

function testDescriptor(): void {
  const descriptor = verificationProfileMatrixDescriptor();

  equal(descriptor.version, VERIFICATION_PROFILE_MATRIX_SPEC_VERSION, 'Verification profiles: descriptor exposes stable matrix version');
  deepEqual(descriptor.riskBaselines, ['R0', 'R1', 'R2', 'R3', 'R4'], 'Verification profiles: descriptor exposes all risk baselines');
  ok(descriptor.boundaryBaselines.includes('record-write'), 'Verification profiles: descriptor exposes record-write boundary baseline');
  ok(descriptor.boundaryBaselines.includes('proxy-admission'), 'Verification profiles: descriptor exposes proxy-admission boundary baseline');
  deepEqual(descriptor.senderConstrainedPresentationModes, SENDER_CONSTRAINED_PRESENTATION_MODES, 'Verification profiles: descriptor exposes sender-constrained presentation modes');
}

function testRiskBaselines(): void {
  equal(RISK_VERIFICATION_BASELINES.R0.verificationModes[0], 'shadow-observe', 'Verification profiles: R0 remains shadow-first');
  equal(RISK_VERIFICATION_BASELINES.R1.onlineIntrospectionRequired, false, 'Verification profiles: R1 does not require online introspection by default');
  equal(RISK_VERIFICATION_BASELINES.R2.onlineIntrospectionRequired, true, 'Verification profiles: R2 requires online liveness by default');
  equal(RISK_VERIFICATION_BASELINES.R3.senderConstraint, 'required', 'Verification profiles: R3 requires sender constraint');
  equal(RISK_VERIFICATION_BASELINES.R4.overridePosture, 'dual-break-glass', 'Verification profiles: R4 requires dual break-glass posture');
  equal(RISK_VERIFICATION_BASELINES.R4.cacheBudget.positiveTtlSeconds, 0, 'Verification profiles: R4 does not allow positive introspection caching');
}

function testBoundaryBaselines(): void {
  deepEqual(BOUNDARY_VERIFICATION_BASELINES['record-write'].supportedConsequenceTypes, ['record'], 'Verification profiles: record-write only supports record consequence');
  ok(BOUNDARY_VERIFICATION_BASELINES.webhook.verificationModes.includes('hybrid-required'), 'Verification profiles: webhook boundaries require hybrid verification');
  ok(BOUNDARY_VERIFICATION_BASELINES['action-dispatch'].allowedPresentationModes.includes('spiffe-bound-token'), 'Verification profiles: action dispatch supports workload-bound presentation');
  equal(BOUNDARY_VERIFICATION_BASELINES['artifact-export'].senderConstraint, 'not-applicable', 'Verification profiles: artifact export is not a live sender-bound boundary');
  equal(BOUNDARY_VERIFICATION_BASELINES['proxy-admission'].cacheBudget.requireFreshOnlineCheck, true, 'Verification profiles: proxy admission requires fresh online checks');
}

function testRecordWriteR4Profile(): void {
  const profile = resolveVerificationProfile({
    consequenceType: 'record',
    riskClass: 'R4',
    boundaryKind: 'record-write',
  });

  equal(profile.version, VERIFICATION_PROFILE_MATRIX_SPEC_VERSION, 'Verification profiles: profile stamps matrix version');
  equal(profile.id, 'verification-profile:record:R4:record-write', 'Verification profiles: profile id is deterministic');
  deepEqual(profile.verificationModes, ['hybrid-required'], 'Verification profiles: R4 record-write uses hybrid verification');
  equal(profile.onlineIntrospectionRequired, true, 'Verification profiles: R4 record-write requires online introspection');
  equal(profile.senderConstraint, 'required', 'Verification profiles: R4 record-write requires sender constraint');
  deepEqual(profile.allowedPresentationModes, ['bearer-release-token', 'dpop-bound-token', 'mtls-bound-token', 'spiffe-bound-token'], 'Verification profiles: R4 record-write keeps compatible presentation modes');
  deepEqual(profile.senderConstrainedPresentationModes, ['dpop-bound-token', 'mtls-bound-token', 'spiffe-bound-token'], 'Verification profiles: R4 record-write exposes only sender-constrained modes separately');
  equal(profile.replayProtectionRequired, true, 'Verification profiles: R4 record-write requires replay protection');
  equal(profile.cacheBudget.positiveTtlSeconds, 0, 'Verification profiles: R4 record-write requires live positive state');
  equal(profile.cacheBudget.requireFreshOnlineCheck, true, 'Verification profiles: R4 record-write requires fresh online check');
  equal(profile.overridePosture, 'dual-break-glass', 'Verification profiles: R4 record-write requires dual break-glass');
  equal(profile.failClosed, true, 'Verification profiles: R4 record-write fails closed');
}

function testCommunicationProfile(): void {
  const profile = resolveVerificationProfile({
    consequenceType: 'communication',
    riskClass: 'R3',
    boundaryKind: 'communication-send',
  });

  deepEqual(profile.verificationModes, ['hybrid-required'], 'Verification profiles: R3 communication-send uses hybrid verification');
  equal(profile.senderConstraint, 'required', 'Verification profiles: R3 communication-send requires sender constraint');
  ok(profile.allowedPresentationModes.includes('http-message-signature'), 'Verification profiles: communication-send supports HTTP message signatures');
  equal(profile.overridePosture, 'named-break-glass', 'Verification profiles: R3 communication-send uses named break-glass posture');
}

function testProxyAndLowRiskProfiles(): void {
  const proxy = resolveVerificationProfile({
    consequenceType: 'decision-support',
    riskClass: 'R2',
    boundaryKind: 'proxy-admission',
  });

  deepEqual(proxy.verificationModes, ['hybrid-required'], 'Verification profiles: proxy admission upgrades R2 to hybrid verification');
  equal(proxy.onlineIntrospectionRequired, true, 'Verification profiles: proxy admission requires online introspection');
  equal(proxy.cacheBudget.positiveTtlSeconds, 10, 'Verification profiles: proxy admission tightens positive cache budget');
  equal(proxy.senderConstraint, 'recommended', 'Verification profiles: R2 proxy admission recommends sender constraint');

  const lowRiskHttp = resolveVerificationProfile({
    consequenceType: 'decision-support',
    riskClass: 'R1',
    boundaryKind: 'http-request',
  });

  deepEqual(lowRiskHttp.verificationModes, ['offline-signature'], 'Verification profiles: R1 HTTP request can verify offline');
  equal(lowRiskHttp.onlineIntrospectionRequired, false, 'Verification profiles: R1 HTTP request does not require introspection');
  equal(lowRiskHttp.cacheBudget.positiveTtlSeconds, 60, 'Verification profiles: HTTP boundary tightens R1 cache budget');
}

function testArtifactProfile(): void {
  const profile = resolveVerificationProfile({
    consequenceType: 'record',
    riskClass: 'R4',
    boundaryKind: 'artifact-export',
  });

  deepEqual(profile.verificationModes, ['hybrid-required'], 'Verification profiles: R4 still requires hybrid semantics even for exported artifacts');
  equal(profile.senderConstraint, 'not-applicable', 'Verification profiles: artifact export does not pretend to be a live sender-bound boundary');
  deepEqual(profile.allowedPresentationModes, ['http-message-signature', 'signed-json-envelope'], 'Verification profiles: artifact export allows signed envelopes and HTTP signatures');
  equal(profile.cacheBudget.positiveTtlSeconds, 0, 'Verification profiles: R4 artifact export inherits no positive cache budget');
  equal(profile.overridePosture, 'dual-break-glass', 'Verification profiles: R4 artifact export keeps dual break-glass posture');
}

function testInvalidBoundaryConsequencePairsReject(): void {
  assert.throws(
    () =>
      resolveVerificationProfile({
        consequenceType: 'communication',
        riskClass: 'R2',
        boundaryKind: 'record-write',
      }),
    /does not support communication consequence/i,
  );
  passed += 1;

  assert.throws(
    () =>
      resolveVerificationProfile({
        consequenceType: 'decision-support',
        riskClass: 'R1',
        boundaryKind: 'webhook',
      }),
    /does not support decision-support consequence/i,
  );
  passed += 1;
}

testDescriptor();
testRiskBaselines();
testBoundaryBaselines();
testRecordWriteR4Profile();
testCommunicationProfile();
testProxyAndLowRiskProfiles();
testArtifactProfile();
testInvalidBoundaryConsequencePairsReject();

console.log(`Release enforcement-plane verification-profile tests: ${passed} passed, 0 failed`);
