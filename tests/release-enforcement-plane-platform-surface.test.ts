import assert from 'node:assert/strict';
import {
  RELEASE_ENFORCEMENT_PLANE_EXTRACTION_CRITERIA,
  RELEASE_ENFORCEMENT_PLANE_PLATFORM_SURFACE_SPEC_VERSION,
  RELEASE_ENFORCEMENT_PLANE_PUBLIC_SUBPATH,
  releaseEnforcementPlane,
  releaseEnforcementPlanePublicSurface,
} from '../src/release-enforcement-plane/index.js';

function testReleaseEnforcementPlanePublicSurfaceDescriptor(): void {
  const descriptor = releaseEnforcementPlanePublicSurface();

  assert.equal(
    descriptor.version,
    RELEASE_ENFORCEMENT_PLANE_PLATFORM_SURFACE_SPEC_VERSION,
  );
  assert.equal(descriptor.packageName, 'attestor');
  assert.equal(descriptor.subpath, RELEASE_ENFORCEMENT_PLANE_PUBLIC_SUBPATH);
  assert.deepEqual(descriptor.namespaceExports, [
    'types',
    'objectModel',
    'verificationProfiles',
    'freshness',
    'offlineVerifier',
    'onlineVerifier',
    'tokenExchange',
    'dpop',
    'workloadBinding',
    'httpMessageSignatures',
    'asyncEnvelope',
    'middleware',
    'webhookReceiver',
    'recordWrite',
    'communicationSend',
    'actionDispatch',
    'envoyExtAuthz',
    'degradedMode',
    'telemetry',
    'conformance',
  ]);
  assert.ok(
    descriptor.extractionCriteria.some((criterion) => criterion.status === 'pending'),
    'expected at least one extraction criterion to remain pending',
  );
  assert.equal(
    RELEASE_ENFORCEMENT_PLANE_EXTRACTION_CRITERIA.filter(
      (criterion) => criterion.status === 'ready',
    ).length,
    4,
  );
  assert.equal(RELEASE_ENFORCEMENT_PLANE_EXTRACTION_CRITERIA.length, 5);
}

function testReleaseEnforcementPlaneNamespaceBindings(): void {
  assert.equal(
    releaseEnforcementPlane.types.RELEASE_ENFORCEMENT_PLANE_SPEC_VERSION,
    'attestor.release-enforcement-plane.v1',
  );
  assert.equal(
    releaseEnforcementPlane.objectModel.RELEASE_ENFORCEMENT_OBJECT_MODEL_SPEC_VERSION,
    'attestor.release-enforcement-object-model.v1',
  );
  assert.equal(
    releaseEnforcementPlane.verificationProfiles.VERIFICATION_PROFILE_MATRIX_SPEC_VERSION,
    'attestor.verification-profile-matrix.v1',
  );
  assert.equal(
    releaseEnforcementPlane.freshness.RELEASE_FRESHNESS_RULES_SPEC_VERSION,
    'attestor.release-enforcement-freshness-rules.v1',
  );
  assert.equal(
    releaseEnforcementPlane.offlineVerifier.OFFLINE_RELEASE_VERIFIER_SPEC_VERSION,
    'attestor.release-enforcement-offline-verifier.v1',
  );
  assert.equal(
    releaseEnforcementPlane.onlineVerifier.ONLINE_RELEASE_VERIFIER_SPEC_VERSION,
    'attestor.release-enforcement-online-verifier.v1',
  );
  assert.equal(
    releaseEnforcementPlane.tokenExchange.RELEASE_TOKEN_EXCHANGE_SPEC_VERSION,
    'attestor.release-enforcement-token-exchange.v1',
  );
  assert.equal(
    releaseEnforcementPlane.dpop.DPOP_PRESENTATION_SPEC_VERSION,
    'attestor.release-enforcement-dpop.v1',
  );
  assert.equal(
    releaseEnforcementPlane.workloadBinding.WORKLOAD_BINDING_PRESENTATION_SPEC_VERSION,
    'attestor.release-enforcement-workload-binding.v1',
  );
  assert.equal(
    releaseEnforcementPlane.httpMessageSignatures.HTTP_MESSAGE_SIGNATURE_PRESENTATION_SPEC_VERSION,
    'attestor.release-enforcement-http-message-signatures.v1',
  );
  assert.equal(
    releaseEnforcementPlane.asyncEnvelope.ASYNC_CONSEQUENCE_ENVELOPE_SPEC_VERSION,
    'attestor.release-enforcement-async-envelope.v1',
  );
  assert.equal(
    releaseEnforcementPlane.middleware.RELEASE_ENFORCEMENT_MIDDLEWARE_SPEC_VERSION,
    'attestor.release-enforcement-middleware.v1',
  );
  assert.equal(
    releaseEnforcementPlane.webhookReceiver.RELEASE_WEBHOOK_RECEIVER_SPEC_VERSION,
    'attestor.release-enforcement-webhook-receiver.v1',
  );
}

function testReleaseEnforcementPlaneOperationalBindings(): void {
  assert.equal(
    releaseEnforcementPlane.recordWrite.RELEASE_RECORD_WRITE_GATEWAY_SPEC_VERSION,
    'attestor.release-enforcement-record-write.v1',
  );
  assert.equal(
    releaseEnforcementPlane.communicationSend.RELEASE_COMMUNICATION_SEND_GATEWAY_SPEC_VERSION,
    'attestor.release-enforcement-communication-send.v1',
  );
  assert.equal(
    releaseEnforcementPlane.actionDispatch.RELEASE_ACTION_DISPATCH_GATEWAY_SPEC_VERSION,
    'attestor.release-enforcement-action-dispatch.v1',
  );
  assert.equal(
    releaseEnforcementPlane.envoyExtAuthz.RELEASE_ENVOY_EXT_AUTHZ_BRIDGE_SPEC_VERSION,
    'attestor.release-enforcement-envoy-ext-authz.v1',
  );
  assert.equal(
    releaseEnforcementPlane.degradedMode.RELEASE_DEGRADED_MODE_CONTROL_SPEC_VERSION,
    'attestor.release-enforcement-degraded-mode.v1',
  );
  assert.equal(
    typeof releaseEnforcementPlane.degradedMode.createFileBackedDegradedModeGrantStore,
    'function',
  );
  assert.equal(
    typeof releaseEnforcementPlane.degradedMode.resetFileBackedDegradedModeGrantStoreForTests,
    'function',
  );
  assert.equal(
    releaseEnforcementPlane.telemetry.RELEASE_ENFORCEMENT_TELEMETRY_SPEC_VERSION,
    'attestor.release-enforcement-telemetry.v1',
  );
  assert.equal(
    releaseEnforcementPlane.conformance.RELEASE_ENFORCEMENT_CONFORMANCE_SPEC_VERSION,
    'attestor.release-enforcement-conformance.v1',
  );
}

testReleaseEnforcementPlanePublicSurfaceDescriptor();
testReleaseEnforcementPlaneNamespaceBindings();
testReleaseEnforcementPlaneOperationalBindings();

console.log('Release enforcement-plane platform surface tests: 29 passed, 0 failed');
