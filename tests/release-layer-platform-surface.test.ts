import assert from 'node:assert/strict';
import {
  RELEASE_LAYER_EXTRACTION_CRITERIA,
  RELEASE_LAYER_FINANCE_PUBLIC_SUBPATH,
  RELEASE_LAYER_PLATFORM_SURFACE_SPEC_VERSION,
  RELEASE_LAYER_PUBLIC_SUBPATH,
  releaseLayer,
  releaseLayerPublicSurface,
} from '../src/release-layer/index.js';
import {
  RELEASE_LAYER_FINANCE_SURFACE_SPEC_VERSION,
  financeReleaseLayer,
  financeReleaseLayerPublicSurface,
} from '../src/release-layer/finance.js';

function testReleaseLayerPublicSurfaceDescriptor(): void {
  const descriptor = releaseLayerPublicSurface();

  assert.equal(descriptor.version, RELEASE_LAYER_PLATFORM_SURFACE_SPEC_VERSION);
  assert.equal(descriptor.packageName, 'attestor');
  assert.equal(descriptor.subpaths.core, RELEASE_LAYER_PUBLIC_SUBPATH);
  assert.equal(descriptor.subpaths.finance, RELEASE_LAYER_FINANCE_PUBLIC_SUBPATH);
  assert.deepEqual(descriptor.namespaceExports, [
    'vocabulary',
    'model',
    'consequences',
    'risk',
    'wedge',
    'policyRollout',
    'policy',
    'decision',
    'decisionLog',
    'deterministicChecks',
    'shadow',
    'canonicalization',
    'token',
    'verification',
    'introspection',
    'evidence',
    'review',
  ]);
  assert.ok(
    descriptor.extractionCriteria.some((criterion) => criterion.status === 'pending'),
    'expected at least one extraction criterion to remain pending',
  );
  assert.equal(
    RELEASE_LAYER_EXTRACTION_CRITERIA.filter((criterion) => criterion.status === 'ready').length,
    4,
  );
}

function testReleaseLayerNamespaceBindings(): void {
  assert.equal(
    releaseLayer.token.RELEASE_TOKEN_ISSUANCE_SPEC_VERSION,
    'attestor.release-token-issuance.v1',
  );
  assert.equal(
    releaseLayer.verification.RELEASE_VERIFICATION_SPEC_VERSION,
    'attestor.release-verification.v1',
  );
  assert.equal(
    releaseLayer.evidence.RELEASE_EVIDENCE_PACK_ISSUANCE_SPEC_VERSION,
    'attestor.release-evidence-pack-issuance.v1',
  );
  assert.equal(
    releaseLayer.review.RELEASE_REVIEWER_QUEUE_SPEC_VERSION,
    'attestor.release-reviewer-queue.v2',
  );
}

function testFinanceReleaseLayerSurface(): void {
  const descriptor = financeReleaseLayerPublicSurface();

  assert.equal(descriptor.version, RELEASE_LAYER_FINANCE_SURFACE_SPEC_VERSION);
  assert.equal(descriptor.subpath, RELEASE_LAYER_FINANCE_PUBLIC_SUBPATH);
  assert.deepEqual(descriptor.wedges, ['record', 'communication', 'action']);
  assert.equal(
    financeReleaseLayer.record.FINANCE_RECORD_RELEASE_SPEC_VERSION,
    'attestor.finance-record-release.v1',
  );
  assert.equal(
    financeReleaseLayer.communication.FINANCE_COMMUNICATION_RELEASE_SPEC_VERSION,
    'attestor.finance-communication-release.v1',
  );
  assert.equal(
    financeReleaseLayer.action.FINANCE_ACTION_RELEASE_SPEC_VERSION,
    'attestor.finance-action-release.v1',
  );
  assert.equal(
    financeReleaseLayer.policies
      .createRecordReleasePolicy()
      .capabilityBoundary.allowedTargets.includes(
        financeReleaseLayer.record.FINANCE_FILING_PREPARE_TARGET_ID,
      ),
    true,
  );
}

testReleaseLayerPublicSurfaceDescriptor();
testReleaseLayerNamespaceBindings();
testFinanceReleaseLayerSurface();

console.log('Release layer platform surface tests: 18 passed, 0 failed');
