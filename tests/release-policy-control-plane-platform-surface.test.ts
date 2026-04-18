import assert from 'node:assert/strict';
import {
  RELEASE_POLICY_CONTROL_PLANE_EXTRACTION_CRITERIA,
  RELEASE_POLICY_CONTROL_PLANE_PLATFORM_SURFACE_SPEC_VERSION,
  RELEASE_POLICY_CONTROL_PLANE_PUBLIC_SUBPATH,
  releasePolicyControlPlane,
  releasePolicyControlPlanePublicSurface,
} from '../src/release-policy-control-plane/index.js';

function testReleasePolicyControlPlanePublicSurfaceDescriptor(): void {
  const descriptor = releasePolicyControlPlanePublicSurface();

  assert.equal(
    descriptor.version,
    RELEASE_POLICY_CONTROL_PLANE_PLATFORM_SURFACE_SPEC_VERSION,
  );
  assert.equal(descriptor.packageName, 'attestor');
  assert.equal(descriptor.subpath, RELEASE_POLICY_CONTROL_PLANE_PUBLIC_SUBPATH);
  assert.deepEqual(descriptor.namespaceExports, [
    'types',
    'objectModel',
    'scoping',
    'bundleFormat',
    'bundleSigning',
    'bundleCache',
    'store',
    'activationRecords',
    'activationApprovals',
    'discovery',
    'resolver',
    'simulation',
    'impactSummary',
    'testPack',
    'auditLog',
    'runtime',
    'financeProving',
  ]);
  assert.ok(
    descriptor.extractionCriteria.some((criterion) => criterion.status === 'pending'),
    'expected at least one extraction criterion to remain pending',
  );
  assert.equal(
    RELEASE_POLICY_CONTROL_PLANE_EXTRACTION_CRITERIA.filter(
      (criterion) => criterion.status === 'ready',
    ).length,
    4,
  );
  assert.equal(RELEASE_POLICY_CONTROL_PLANE_EXTRACTION_CRITERIA.length, 5);
}

function testReleasePolicyControlPlaneNamespaceBindings(): void {
  assert.equal(
    releasePolicyControlPlane.types.POLICY_CONTROL_PLANE_SPEC_VERSION,
    'attestor.release-policy-control-plane.v1',
  );
  assert.equal(
    releasePolicyControlPlane.objectModel.POLICY_PACK_SPEC_VERSION,
    'attestor.policy-pack.v1',
  );
  assert.equal(
    releasePolicyControlPlane.scoping.POLICY_SCOPE_PRECEDENCE_SPEC_VERSION,
    'attestor.policy-scope-precedence.v1',
  );
  assert.equal(
    releasePolicyControlPlane.bundleFormat.POLICY_BUNDLE_FORMAT_SPEC_VERSION,
    'attestor.policy-bundle-format.v1',
  );
  assert.equal(
    releasePolicyControlPlane.bundleSigning.POLICY_BUNDLE_SIGNING_SPEC_VERSION,
    'attestor.policy-bundle-signing.v1',
  );
  assert.equal(
    releasePolicyControlPlane.store.POLICY_STORE_SNAPSHOT_SPEC_VERSION,
    'attestor.policy-store-snapshot.v1',
  );
  assert.equal(
    releasePolicyControlPlane.discovery.POLICY_DISCOVERY_DOCUMENT_SPEC_VERSION,
    'attestor.policy-discovery-document.v1',
  );
  assert.equal(
    releasePolicyControlPlane.resolver.ACTIVE_POLICY_RESOLVER_SPEC_VERSION,
    'attestor.active-policy-resolver.v1',
  );
  assert.equal(
    releasePolicyControlPlane.runtime.CONTROL_PLANE_RUNTIME_ENGINE_SPEC_VERSION,
    'attestor.policy-control-plane-runtime.v1',
  );
  assert.equal(
    releasePolicyControlPlane.financeProving.FINANCE_PROVING_POLICY_CONTROL_PLANE_SPEC_VERSION,
    'attestor.finance-proving-policy-control-plane.v1',
  );
  assert.equal(
    typeof releasePolicyControlPlane.store.createFileBackedPolicyControlPlaneStore,
    'function',
  );
}

function testFinanceProvingHelperSurvivesThroughPublicSurface(): void {
  const target = releasePolicyControlPlane.financeProving.createFinancePolicyActivationTarget(
    'record',
    'api-runtime',
    {
      tenantId: 'tenant-pilot',
      cohortId: 'wave-a',
      planId: 'enterprise',
    },
  );

  assert.equal(target.environment, 'api-runtime');
  assert.equal(target.tenantId, 'tenant-pilot');
  assert.equal(target.domainId, 'finance');
  assert.equal(target.consequenceType, 'record');
  assert.equal(target.riskClass, 'R4');
  assert.equal(target.cohortId, 'wave-a');
  assert.equal(target.planId, 'enterprise');
}

testReleasePolicyControlPlanePublicSurfaceDescriptor();
testReleasePolicyControlPlaneNamespaceBindings();
testFinanceProvingHelperSurvivesThroughPublicSurface();

console.log('Release policy control-plane platform surface tests: 18 passed, 0 failed');
