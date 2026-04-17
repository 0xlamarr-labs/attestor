import assert from 'node:assert/strict';
import {
  POLICY_ACTIVATION_STATES,
  POLICY_CONTROL_PLANE_SPEC_VERSION,
  POLICY_DISCOVERY_MODES,
  POLICY_MUTATION_ACTIONS,
  POLICY_PACK_LIFECYCLE_STATES,
  POLICY_SCOPE_DIMENSIONS,
  POLICY_STORE_KINDS,
  createPolicyActivationTarget,
  createPolicyScopeSelector,
  policyActivationTargetLabel,
  policyControlPlaneDescriptor,
  policyScopeDimensionsForTarget,
} from '../src/release-policy-control-plane/types.js';

function testDescriptorVocabulary(): void {
  const descriptor = policyControlPlaneDescriptor();

  assert.equal(descriptor.version, POLICY_CONTROL_PLANE_SPEC_VERSION);
  assert.deepEqual(descriptor.storeKinds, POLICY_STORE_KINDS);
  assert.deepEqual(descriptor.lifecycleStates, POLICY_PACK_LIFECYCLE_STATES);
  assert.deepEqual(descriptor.activationStates, POLICY_ACTIVATION_STATES);
  assert.deepEqual(descriptor.discoveryModes, POLICY_DISCOVERY_MODES);
  assert.deepEqual(descriptor.scopeDimensions, POLICY_SCOPE_DIMENSIONS);
  assert.deepEqual(descriptor.mutationActions, POLICY_MUTATION_ACTIONS);
}

function testActivationTargetNormalization(): void {
  const target = createPolicyActivationTarget({
    environment: 'prod-eu ',
    tenantId: ' tenant-finance ',
    accountId: ' acct-enterprise ',
    domainId: 'finance',
    wedgeId: 'finance.record.release',
    consequenceType: 'record',
    riskClass: 'R4',
    planId: 'enterprise',
  });

  assert.deepEqual(target, {
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
    accountId: 'acct-enterprise',
    domainId: 'finance',
    wedgeId: 'finance.record.release',
    consequenceType: 'record',
    riskClass: 'R4',
    planId: 'enterprise',
  });
}

function testScopeDimensionsAndLabels(): void {
  const target = createPolicyActivationTarget({
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
    domainId: 'finance',
    consequenceType: 'record',
    riskClass: 'R4',
  });

  assert.deepEqual(policyScopeDimensionsForTarget(target), [
    'environment',
    'tenant',
    'domain',
    'consequence-type',
    'risk-class',
  ]);

  const selector = createPolicyScopeSelector(target);
  assert.deepEqual(selector.dimensions, [
    'environment',
    'tenant',
    'domain',
    'consequence-type',
    'risk-class',
  ]);

  assert.equal(
    policyActivationTargetLabel(target),
    'env:prod-eu / tenant:tenant-finance / domain:finance / consequence:record / risk:R4',
  );
}

function testInvalidTargetsReject(): void {
  assert.throws(
    () =>
      createPolicyActivationTarget({
        environment: 'prod-eu',
        accountId: 'acct-1',
      }),
    /requires tenant scope/i,
  );

  assert.throws(
    () =>
      createPolicyActivationTarget({
        environment: 'prod-eu',
        riskClass: 'R3',
      }),
    /requires a consequence type/i,
  );

  assert.throws(
    () =>
      createPolicyActivationTarget({
        environment: '   ',
      }),
    /requires a non-empty environment/i,
  );
}

testDescriptorVocabulary();
testActivationTargetNormalization();
testScopeDimensionsAndLabels();
testInvalidTargetsReject();

console.log('Release policy control-plane type tests: 22 passed, 0 failed');
