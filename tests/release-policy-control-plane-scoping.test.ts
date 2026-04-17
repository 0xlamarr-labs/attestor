import assert from 'node:assert/strict';
import { policy } from '../src/release-layer/index.js';
import {
  createPolicyActivationRecord,
  createPolicyBundleEntry,
  createPolicyBundleManifest,
  createPolicyPackMetadata,
} from '../src/release-policy-control-plane/object-model.js';
import {
  POLICY_SCOPE_PRECEDENCE_ORDER,
  comparePolicyScopeMatches,
  matchPolicyScope,
  policyScopePrecedenceDescriptor,
  resolvePolicyActivationPrecedence,
} from '../src/release-policy-control-plane/scoping.js';
import { createPolicyActivationTarget } from '../src/release-policy-control-plane/types.js';

function sampleBundleReference(bundleId = 'bundle_finance_core_2026_04_17') {
  return {
    packId: 'finance-core',
    bundleId,
    bundleVersion: '2026.04.17',
    digest: `sha256:${bundleId}`,
  } as const;
}

function samplePolicyDefinition() {
  return policy.createFirstHardGatewayReleasePolicy();
}

function sampleRequestTarget() {
  return createPolicyActivationTarget({
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
    accountId: 'account-major',
    domainId: 'finance',
    wedgeId: 'finance.record.release',
    consequenceType: 'record',
    riskClass: 'R4',
    planId: 'enterprise',
  });
}

function sampleActivationRecord(
  id: string,
  targetInput: Parameters<typeof createPolicyActivationTarget>[0],
  bundleId = id,
) {
  return createPolicyActivationRecord({
    id,
    state: 'active',
    target: createPolicyActivationTarget(targetInput),
    bundle: sampleBundleReference(bundleId),
    activatedBy: {
      id: 'user_policy_admin',
      type: 'user',
      displayName: 'Policy Admin',
      role: 'policy-admin',
    },
    activatedAt: '2026-04-17T11:00:00.000Z',
    rationale: `Activate ${id}`,
  });
}

function testTargetHierarchyValidation(): void {
  assert.throws(
    () =>
      createPolicyActivationTarget({
        environment: 'prod-eu',
        wedgeId: 'finance.record.release',
      }),
    /domain scope/i,
  );
}

function testEnvironmentBoundary(): void {
  const request = sampleRequestTarget();
  const selector = createPolicyActivationTarget({
    environment: 'stage-eu',
    tenantId: 'tenant-finance',
  });
  const match = matchPolicyScope(request, selector);

  assert.equal(match.matches, false);
  assert.equal(match.mismatchDimension, 'environment');
}

function testWildcardMatching(): void {
  const request = sampleRequestTarget();
  const selector = createPolicyActivationTarget({
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
  });
  const match = matchPolicyScope(request, selector);

  assert.equal(match.matches, true);
  assert.deepEqual(match.matchedDimensions, ['environment', 'tenant']);
}

function testMismatchDetection(): void {
  const request = sampleRequestTarget();
  const domainMismatch = matchPolicyScope(
    request,
    createPolicyActivationTarget({
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      domainId: 'treasury',
    }),
  );
  const riskMismatch = matchPolicyScope(
    request,
    createPolicyActivationTarget({
      environment: 'prod-eu',
      consequenceType: 'record',
      riskClass: 'R3',
    }),
  );

  assert.equal(domainMismatch.matches, false);
  assert.equal(domainMismatch.mismatchDimension, 'domain');
  assert.equal(riskMismatch.matches, false);
  assert.equal(riskMismatch.mismatchDimension, 'risk-class');
}

function testIdentityPrecedenceBeatsBroaderOperationalScope(): void {
  const request = sampleRequestTarget();
  const accountScoped = matchPolicyScope(
    request,
    createPolicyActivationTarget({
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      accountId: 'account-major',
    }),
  );
  const tenantWedgeScoped = matchPolicyScope(
    request,
    createPolicyActivationTarget({
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      domainId: 'finance',
      wedgeId: 'finance.record.release',
    }),
  );

  assert.equal(comparePolicyScopeMatches(accountScoped, tenantWedgeScoped) < 0, true);
  assert.equal(accountScoped.precedenceVector[0], 1);
}

function testWedgePrecedenceBeatsDomain(): void {
  const request = sampleRequestTarget();
  const domainScoped = matchPolicyScope(
    request,
    createPolicyActivationTarget({
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      domainId: 'finance',
    }),
  );
  const wedgeScoped = matchPolicyScope(
    request,
    createPolicyActivationTarget({
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      domainId: 'finance',
      wedgeId: 'finance.record.release',
    }),
  );

  assert.equal(comparePolicyScopeMatches(wedgeScoped, domainScoped) < 0, true);
  assert.equal(wedgeScoped.precedenceVector[2], 1);
}

function testRiskPrecedenceBeatsConsequence(): void {
  const request = sampleRequestTarget();
  const consequenceScoped = matchPolicyScope(
    request,
    createPolicyActivationTarget({
      environment: 'prod-eu',
      consequenceType: 'record',
    }),
  );
  const riskScoped = matchPolicyScope(
    request,
    createPolicyActivationTarget({
      environment: 'prod-eu',
      consequenceType: 'record',
      riskClass: 'R4',
    }),
  );

  assert.equal(comparePolicyScopeMatches(riskScoped, consequenceScoped) < 0, true);
  assert.equal(riskScoped.precedenceVector[4], 1);
}

function testPlanIsLowestOptionalPrecedence(): void {
  const request = sampleRequestTarget();
  const consequenceScoped = matchPolicyScope(
    request,
    createPolicyActivationTarget({
      environment: 'prod-eu',
      consequenceType: 'record',
    }),
  );
  const planScoped = matchPolicyScope(
    request,
    createPolicyActivationTarget({
      environment: 'prod-eu',
      planId: 'enterprise',
    }),
  );

  assert.equal(comparePolicyScopeMatches(consequenceScoped, planScoped) < 0, true);
  assert.equal(planScoped.precedenceVector[6], 1);
}

function testResolutionNoMatch(): void {
  const resolution = resolvePolicyActivationPrecedence(sampleRequestTarget(), [
    sampleActivationRecord('activation_stage_only', {
      environment: 'stage-eu',
      tenantId: 'tenant-finance',
    }),
  ]);

  assert.equal(resolution.winner, null);
  assert.equal(resolution.matchedCandidates.length, 0);
}

function testResolutionPicksMostSpecificWinner(): void {
  const resolution = resolvePolicyActivationPrecedence(sampleRequestTarget(), [
    sampleActivationRecord('activation_domain', {
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      domainId: 'finance',
    }),
    sampleActivationRecord('activation_account', {
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      accountId: 'account-major',
    }),
    sampleActivationRecord('activation_consequence', {
      environment: 'prod-eu',
      consequenceType: 'record',
    }),
  ]);

  assert.equal(resolution.winner?.activation.id, 'activation_account');
  assert.equal(resolution.ambiguousTopCandidates.length, 0);
  assert.equal(resolution.matchedCandidates.length, 3);
}

function testResolutionDetectsAmbiguousSameSelector(): void {
  const resolution = resolvePolicyActivationPrecedence(sampleRequestTarget(), [
    sampleActivationRecord(
      'activation_account_bundle_a',
      {
        environment: 'prod-eu',
        tenantId: 'tenant-finance',
        accountId: 'account-major',
      },
      'bundle_account_a',
    ),
    sampleActivationRecord(
      'activation_account_bundle_b',
      {
        environment: 'prod-eu',
        tenantId: 'tenant-finance',
        accountId: 'account-major',
      },
      'bundle_account_b',
    ),
  ]);

  assert.equal(resolution.winner, null);
  assert.equal(resolution.ambiguousTopCandidates.length, 2);
}

function testDescriptorAndManifestAlignment(): void {
  const descriptor = policyScopePrecedenceDescriptor();
  const pack = createPolicyPackMetadata({
    id: 'finance-core',
    name: 'Finance Core',
    createdAt: '2026-04-17T11:05:00.000Z',
  });
  const entry = createPolicyBundleEntry({
    id: 'entry_record_r4',
    scopeTarget: createPolicyActivationTarget({
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      domainId: 'finance',
      wedgeId: 'finance.record.release',
      consequenceType: 'record',
      riskClass: 'R4',
    }),
    definition: samplePolicyDefinition(),
    policyHash: 'sha256:entry_record_r4',
  });
  const manifest = createPolicyBundleManifest({
    bundle: sampleBundleReference('bundle_alignment'),
    pack,
    generatedAt: '2026-04-17T11:06:00.000Z',
    entries: [entry],
  });

  assert.equal(descriptor.version, 'attestor.policy-scope-precedence.v1');
  assert.deepEqual(descriptor.precedenceOrder, POLICY_SCOPE_PRECEDENCE_ORDER);
  assert.equal(descriptor.mandatoryExactBoundary[0], 'environment');
  assert.equal(manifest.entries[0]?.scope.wedgeId, 'finance.record.release');
}

testTargetHierarchyValidation();
testEnvironmentBoundary();
testWildcardMatching();
testMismatchDetection();
testIdentityPrecedenceBeatsBroaderOperationalScope();
testWedgePrecedenceBeatsDomain();
testRiskPrecedenceBeatsConsequence();
testPlanIsLowestOptionalPrecedence();
testResolutionNoMatch();
testResolutionPicksMostSpecificWinner();
testResolutionDetectsAmbiguousSameSelector();
testDescriptorAndManifestAlignment();

console.log('Release policy control-plane scoping tests: 24 passed, 0 failed');
