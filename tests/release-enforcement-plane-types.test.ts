import { strict as assert } from 'node:assert';
import {
  ENFORCEMENT_BOUNDARY_KINDS,
  ENFORCEMENT_BOUNDARY_PROFILES,
  ENFORCEMENT_BREAK_GLASS_REASONS,
  ENFORCEMENT_CACHE_STATES,
  ENFORCEMENT_DEGRADED_STATES,
  ENFORCEMENT_FAILURE_REASONS,
  ENFORCEMENT_OUTCOMES,
  ENFORCEMENT_POINT_KINDS,
  ENFORCEMENT_POINT_PROFILES,
  ENFORCEMENT_VERIFICATION_MODES,
  RELEASE_ENFORCEMENT_PLANE_SPEC_VERSION,
  RELEASE_PRESENTATION_MODES,
  createEnforcementPointReference,
  enforcementPointReferenceLabel,
  enforcementPointSupportsBoundary,
  isEnforcementBoundaryKind,
  isEnforcementBreakGlassReason,
  isEnforcementCacheState,
  isEnforcementDegradedState,
  isEnforcementFailureReason,
  isEnforcementPointKind,
  isEnforcementVerificationMode,
  isReleasePresentationMode,
  releaseEnforcementPlaneDescriptor,
} from '../src/release-enforcement-plane/types.js';

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

function testDescriptorVocabulary(): void {
  const descriptor = releaseEnforcementPlaneDescriptor();

  equal(descriptor.version, RELEASE_ENFORCEMENT_PLANE_SPEC_VERSION, 'Enforcement plane: descriptor exposes the spec version');
  deepEqual(descriptor.enforcementPointKinds, ENFORCEMENT_POINT_KINDS, 'Enforcement plane: descriptor exposes enforcement point kinds');
  deepEqual(descriptor.boundaryKinds, ENFORCEMENT_BOUNDARY_KINDS, 'Enforcement plane: descriptor exposes boundary kinds');
  deepEqual(descriptor.verificationModes, ENFORCEMENT_VERIFICATION_MODES, 'Enforcement plane: descriptor exposes verification modes');
  deepEqual(descriptor.presentationModes, RELEASE_PRESENTATION_MODES, 'Enforcement plane: descriptor exposes presentation modes');
  deepEqual(descriptor.cacheStates, ENFORCEMENT_CACHE_STATES, 'Enforcement plane: descriptor exposes cache states');
  deepEqual(descriptor.degradedStates, ENFORCEMENT_DEGRADED_STATES, 'Enforcement plane: descriptor exposes degraded states');
  deepEqual(descriptor.breakGlassReasons, ENFORCEMENT_BREAK_GLASS_REASONS, 'Enforcement plane: descriptor exposes break-glass reasons');
  deepEqual(descriptor.outcomes, ENFORCEMENT_OUTCOMES, 'Enforcement plane: descriptor exposes outcomes');
  deepEqual(descriptor.failureReasons, ENFORCEMENT_FAILURE_REASONS, 'Enforcement plane: descriptor exposes failure reasons');
}

function testPredicateVocabulary(): void {
  ok(isEnforcementPointKind('proxy-ext-authz'), 'Enforcement plane: proxy ext-authz is a valid enforcement point');
  ok(!isEnforcementPointKind('dashboard'), 'Enforcement plane: dashboards are not enforcement points');
  ok(isEnforcementBoundaryKind('record-write'), 'Enforcement plane: record-write is a valid boundary kind');
  ok(isEnforcementVerificationMode('hybrid-required'), 'Enforcement plane: hybrid-required is a valid verification mode');
  ok(isReleasePresentationMode('dpop-bound-token'), 'Enforcement plane: DPoP-bound tokens are a valid presentation mode');
  ok(isEnforcementCacheState('stale-denied'), 'Enforcement plane: stale-denied is a valid cache state');
  ok(isEnforcementDegradedState('fail-closed'), 'Enforcement plane: fail-closed is a valid degraded state');
  ok(isEnforcementBreakGlassReason('control-plane-recovery'), 'Enforcement plane: control-plane recovery is a valid break-glass reason');
  ok(isEnforcementFailureReason('wrong-audience'), 'Enforcement plane: wrong audience is a valid failure reason');
}

function testProfilesAndBoundarySupport(): void {
  ok(enforcementPointSupportsBoundary('proxy-ext-authz', 'proxy-admission'), 'Enforcement plane: proxy ext-authz supports proxy admission');
  ok(!enforcementPointSupportsBoundary('webhook-receiver', 'record-write'), 'Enforcement plane: webhook receivers cannot silently enforce record writes');
  equal(ENFORCEMENT_POINT_PROFILES['proxy-ext-authz'].defaultPosture, 'fail-closed', 'Enforcement plane: proxy ext-authz defaults to fail-closed');
  ok(ENFORCEMENT_POINT_PROFILES['action-dispatch-gateway'].defaultPresentationModes.includes('spiffe-bound-token'), 'Enforcement plane: action dispatch can be workload-bound');
  equal(ENFORCEMENT_BOUNDARY_PROFILES['record-write'].defaultConsequenceType, 'record', 'Enforcement plane: record-write boundaries default to record consequence');
  ok(ENFORCEMENT_BOUNDARY_PROFILES['communication-send'].supportedPointKinds.includes('communication-send-gateway'), 'Enforcement plane: communication sends have a dedicated gateway');
  ok(ENFORCEMENT_BOUNDARY_PROFILES['artifact-export'].defaultVerificationModes.includes('offline-signature'), 'Enforcement plane: artifact export can be verified offline');
}

function testReferenceNormalizationAndLabels(): void {
  const reference = createEnforcementPointReference({
    environment: ' prod-eu ',
    enforcementPointId: ' filing-export-pep ',
    pointKind: 'record-write-gateway',
    boundaryKind: 'record-write',
    consequenceType: 'record',
    riskClass: 'R4',
    tenantId: ' tenant-finance ',
    accountId: ' acct-enterprise ',
    workloadId: ' spiffe://attestor/api ',
    audience: ' filing-export ',
  });

  equal(reference.environment, 'prod-eu', 'Enforcement plane: environment is normalized');
  equal(reference.enforcementPointId, 'filing-export-pep', 'Enforcement plane: enforcement point id is normalized');
  equal(reference.tenantId, 'tenant-finance', 'Enforcement plane: tenant id is normalized');
  equal(reference.accountId, 'acct-enterprise', 'Enforcement plane: account id is normalized');
  equal(reference.workloadId, 'spiffe://attestor/api', 'Enforcement plane: workload id is normalized');
  equal(reference.audience, 'filing-export', 'Enforcement plane: audience is normalized');
  equal(
    enforcementPointReferenceLabel(reference),
    'env:prod-eu / point:filing-export-pep / kind:record-write-gateway / boundary:record-write / consequence:record / risk:R4 / tenant:tenant-finance / account:acct-enterprise / workload:spiffe://attestor/api / aud:filing-export',
    'Enforcement plane: reference labels carry all enforcement binding dimensions',
  );
}

function testInvalidReferencesReject(): void {
  assert.throws(
    () =>
      createEnforcementPointReference({
        environment: 'prod-eu',
        enforcementPointId: 'bad-pep',
        pointKind: 'webhook-receiver',
        boundaryKind: 'record-write',
        consequenceType: 'record',
        riskClass: 'R4',
      }),
    /does not support record-write/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createEnforcementPointReference({
        environment: '   ',
        enforcementPointId: 'record-pep',
        pointKind: 'record-write-gateway',
        boundaryKind: 'record-write',
        consequenceType: 'record',
        riskClass: 'R4',
      }),
    /environment requires a non-empty value/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createEnforcementPointReference({
        environment: 'prod-eu',
        enforcementPointId: 'record-pep',
        pointKind: 'record-write-gateway',
        boundaryKind: 'record-write',
        consequenceType: 'record',
        riskClass: 'R4',
        tenantId: '   ',
      }),
    /tenantId cannot be blank/i,
  );
  passed += 1;

  assert.throws(
    () =>
      createEnforcementPointReference({
        environment: 'prod-eu',
        enforcementPointId: 'record-pep',
        pointKind: 'record-write-gateway',
        boundaryKind: 'record-write',
        consequenceType: 'record',
        riskClass: 'R4',
        tenantId: null,
        accountId: 'acct-1',
      }),
    /requires tenant scope/i,
  );
  passed += 1;
}

async function main(): Promise<void> {
  testDescriptorVocabulary();
  testPredicateVocabulary();
  testProfilesAndBoundarySupport();
  testReferenceNormalizationAndLabels();
  testInvalidReferencesReject();

  console.log(`\nRelease enforcement-plane type tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease enforcement-plane type tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
