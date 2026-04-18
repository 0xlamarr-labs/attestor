import {
  previewCandidatePolicyImpact,
  type PolicyCandidateImpactPreview,
} from './impact-summary.js';
import type { ActivePolicyResolverInput, ActivePolicyResolutionStatus } from './resolver.js';
import type { DryRunPolicyActivationOverlay } from './simulation.js';
import type { PolicyControlPlaneStore, StoredPolicyBundleRecord } from './store.js';
import type { PolicyActivationTarget, PolicyBundleReference } from './types.js';
import type { ReleasePolicyRolloutMode } from '../release-layer/index.js';

/**
 * Policy test-pack format and runner.
 *
 * Step 12 turns policy activation into something that can be gated on explicit
 * executable expectations instead of only structural validity. Each test case
 * runs through the same control-plane preview path used for dry-run activation
 * so activation decisions can depend on reproducible preflight evidence.
 */

export const POLICY_TEST_PACK_SPEC_VERSION = 'attestor.policy-test-pack.v1';
export const POLICY_TEST_RUN_SPEC_VERSION = 'attestor.policy-test-run.v1';

export type PolicyTestCaseSeverity = 'required' | 'advisory';
export type PolicyTestCaseResultStatus = 'passed' | 'failed';
export type PolicyTestRunStatus = 'passed' | 'failed';

export interface PolicyTestCaseExpectation {
  readonly currentStatus?: ActivePolicyResolutionStatus;
  readonly simulatedStatus?: ActivePolicyResolutionStatus;
  readonly currentPolicyId?: string | null;
  readonly simulatedPolicyId?: string | null;
  readonly currentRolloutMode?: ReleasePolicyRolloutMode | null;
  readonly simulatedRolloutMode?: ReleasePolicyRolloutMode | null;
  readonly changed?: boolean;
  readonly statusChanged?: boolean;
  readonly bundleChanged?: boolean;
  readonly policyChanged?: boolean;
  readonly rolloutChanged?: boolean;
}

export interface PolicyTestCaseDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly severity: PolicyTestCaseSeverity;
  readonly resolverInput: ActivePolicyResolverInput;
  readonly activationTarget: PolicyActivationTarget;
  readonly activatedAt: string;
  readonly expectation: PolicyTestCaseExpectation;
}

export interface PolicyTestPackDefinition {
  readonly version: typeof POLICY_TEST_PACK_SPEC_VERSION;
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly candidateBundle: PolicyBundleReference;
  readonly cases: readonly PolicyTestCaseDefinition[];
}

export interface PolicyTestAssertionFailure {
  readonly field: string;
  readonly expected: string | boolean | null;
  readonly actual: string | boolean | null;
}

export interface PolicyTestCaseResult {
  readonly id: string;
  readonly severity: PolicyTestCaseSeverity;
  readonly status: PolicyTestCaseResultStatus;
  readonly failures: readonly PolicyTestAssertionFailure[];
  readonly preview: PolicyCandidateImpactPreview;
}

export interface PolicyTestRunResult {
  readonly version: typeof POLICY_TEST_RUN_SPEC_VERSION;
  readonly status: PolicyTestRunStatus;
  readonly candidateBundle: PolicyBundleReference;
  readonly counts: {
    readonly passed: number;
    readonly failed: number;
    readonly requiredFailed: number;
    readonly advisoryFailed: number;
  };
  readonly results: readonly PolicyTestCaseResult[];
}

export interface CreatePolicyTestCaseInput {
  readonly id: string;
  readonly name: string;
  readonly description?: string | null;
  readonly severity?: PolicyTestCaseSeverity;
  readonly resolverInput: ActivePolicyResolverInput;
  readonly activationTarget: PolicyActivationTarget;
  readonly activatedAt?: string;
  readonly expectation: PolicyTestCaseExpectation;
}

export interface CreatePolicyTestPackInput {
  readonly id: string;
  readonly name: string;
  readonly description?: string | null;
  readonly candidateBundle: PolicyBundleReference;
  readonly cases: readonly PolicyTestCaseDefinition[];
}

function normalizeIdentifier(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`Policy test-pack ${fieldName} cannot be blank.`);
  }
  return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeIsoTimestamp(value: string | undefined): string {
  const timestamp = value ? new Date(value) : new Date('2026-04-18T00:00:00.000Z');
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error('Policy test-pack activatedAt must be a valid ISO timestamp.');
  }
  return timestamp.toISOString();
}

function assertBundleReference(bundle: PolicyBundleReference): void {
  normalizeIdentifier(bundle.packId, 'candidateBundle.packId');
  normalizeIdentifier(bundle.bundleId, 'candidateBundle.bundleId');
  normalizeIdentifier(bundle.bundleVersion, 'candidateBundle.bundleVersion');
  normalizeIdentifier(bundle.digest, 'candidateBundle.digest');
}

function assertPolicyTestCaseExpectation(
  expectation: PolicyTestCaseExpectation,
): PolicyTestCaseExpectation {
  return Object.freeze({
    currentStatus: expectation.currentStatus,
    simulatedStatus: expectation.simulatedStatus,
    currentPolicyId:
      expectation.currentPolicyId === undefined ? undefined : expectation.currentPolicyId,
    simulatedPolicyId:
      expectation.simulatedPolicyId === undefined ? undefined : expectation.simulatedPolicyId,
    currentRolloutMode:
      expectation.currentRolloutMode === undefined ? undefined : expectation.currentRolloutMode,
    simulatedRolloutMode:
      expectation.simulatedRolloutMode === undefined ? undefined : expectation.simulatedRolloutMode,
    changed: expectation.changed,
    statusChanged: expectation.statusChanged,
    bundleChanged: expectation.bundleChanged,
    policyChanged: expectation.policyChanged,
    rolloutChanged: expectation.rolloutChanged,
  });
}

function compareExpectedValue(
  failures: PolicyTestAssertionFailure[],
  field: string,
  expected: string | boolean | null | undefined,
  actual: string | boolean | null,
): void {
  if (expected === undefined) {
    return;
  }
  if (expected !== actual) {
    failures.push(
      Object.freeze({
        field,
        expected,
        actual,
      }),
    );
  }
}

function previewForCase(
  store: PolicyControlPlaneStore,
  bundleRecord: StoredPolicyBundleRecord,
  testCase: PolicyTestCaseDefinition,
): PolicyCandidateImpactPreview {
  const overlay: DryRunPolicyActivationOverlay = {
    bundleRecord,
    target: testCase.activationTarget,
    activatedAt: testCase.activatedAt,
    reasonCode: 'policy-test-pack',
    rationale: `Run policy test case '${testCase.id}' before activation.`,
  };

  return previewCandidatePolicyImpact(store, testCase.resolverInput, overlay);
}

function evaluateCase(
  store: PolicyControlPlaneStore,
  bundleRecord: StoredPolicyBundleRecord,
  testCase: PolicyTestCaseDefinition,
): PolicyTestCaseResult {
  const preview = previewForCase(store, bundleRecord, testCase);
  const failures: PolicyTestAssertionFailure[] = [];

  compareExpectedValue(
    failures,
    'currentStatus',
    testCase.expectation.currentStatus,
    preview.dryRun.current.status,
  );
  compareExpectedValue(
    failures,
    'simulatedStatus',
    testCase.expectation.simulatedStatus,
    preview.dryRun.simulated.status,
  );
  compareExpectedValue(
    failures,
    'currentPolicyId',
    testCase.expectation.currentPolicyId,
    preview.dryRunImpact.currentPolicyId,
  );
  compareExpectedValue(
    failures,
    'simulatedPolicyId',
    testCase.expectation.simulatedPolicyId,
    preview.dryRunImpact.simulatedPolicyId,
  );
  compareExpectedValue(
    failures,
    'currentRolloutMode',
    testCase.expectation.currentRolloutMode,
    preview.dryRunImpact.currentRolloutMode,
  );
  compareExpectedValue(
    failures,
    'simulatedRolloutMode',
    testCase.expectation.simulatedRolloutMode,
    preview.dryRunImpact.simulatedRolloutMode,
  );
  compareExpectedValue(
    failures,
    'changed',
    testCase.expectation.changed,
    preview.dryRun.delta.changed,
  );
  compareExpectedValue(
    failures,
    'statusChanged',
    testCase.expectation.statusChanged,
    preview.dryRun.delta.statusChanged,
  );
  compareExpectedValue(
    failures,
    'bundleChanged',
    testCase.expectation.bundleChanged,
    preview.dryRun.delta.bundleChanged,
  );
  compareExpectedValue(
    failures,
    'policyChanged',
    testCase.expectation.policyChanged,
    preview.dryRun.delta.policyChanged,
  );
  compareExpectedValue(
    failures,
    'rolloutChanged',
    testCase.expectation.rolloutChanged,
    preview.dryRun.delta.rolloutChanged,
  );

  return Object.freeze({
    id: testCase.id,
    severity: testCase.severity,
    status: failures.length > 0 ? 'failed' : 'passed',
    failures: Object.freeze(failures),
    preview,
  });
}

export function createPolicyTestCase(
  input: CreatePolicyTestCaseInput,
): PolicyTestCaseDefinition {
  return Object.freeze({
    id: normalizeIdentifier(input.id, 'case id'),
    name: normalizeIdentifier(input.name, 'case name'),
    description: normalizeOptionalText(input.description),
    severity: input.severity ?? 'required',
    resolverInput: input.resolverInput,
    activationTarget: input.activationTarget,
    activatedAt: normalizeIsoTimestamp(input.activatedAt),
    expectation: assertPolicyTestCaseExpectation(input.expectation),
  });
}

export function createPolicyTestPack(
  input: CreatePolicyTestPackInput,
): PolicyTestPackDefinition {
  assertBundleReference(input.candidateBundle);
  if (input.cases.length === 0) {
    throw new Error('Policy test-pack requires at least one test case.');
  }

  const caseIds = new Set<string>();
  for (const testCase of input.cases) {
    if (caseIds.has(testCase.id)) {
      throw new Error(`Policy test-pack contains duplicate case id '${testCase.id}'.`);
    }
    caseIds.add(testCase.id);
  }

  return Object.freeze({
    version: POLICY_TEST_PACK_SPEC_VERSION,
    id: normalizeIdentifier(input.id, 'test-pack id'),
    name: normalizeIdentifier(input.name, 'test-pack name'),
    description: normalizeOptionalText(input.description),
    candidateBundle: input.candidateBundle,
    cases: Object.freeze([...input.cases]),
  });
}

export function runPolicyTestPack(
  store: PolicyControlPlaneStore,
  testPack: PolicyTestPackDefinition,
  bundleRecord: StoredPolicyBundleRecord,
): PolicyTestRunResult {
  if (
    bundleRecord.bundleId !== testPack.candidateBundle.bundleId ||
    bundleRecord.packId !== testPack.candidateBundle.packId ||
    bundleRecord.bundleVersion !== testPack.candidateBundle.bundleVersion ||
    bundleRecord.manifest.bundle.digest !== testPack.candidateBundle.digest
  ) {
    throw new Error(
      'Policy test-pack candidate bundle reference must match the bundle record being tested.',
    );
  }

  const results = Object.freeze(
    testPack.cases.map((testCase) => evaluateCase(store, bundleRecord, testCase)),
  );
  const counts = Object.freeze({
    passed: results.filter((result) => result.status === 'passed').length,
    failed: results.filter((result) => result.status === 'failed').length,
    requiredFailed: results.filter(
      (result) => result.status === 'failed' && result.severity === 'required',
    ).length,
    advisoryFailed: results.filter(
      (result) => result.status === 'failed' && result.severity === 'advisory',
    ).length,
  });

  return Object.freeze({
    version: POLICY_TEST_RUN_SPEC_VERSION,
    status: counts.requiredFailed > 0 ? 'failed' : 'passed',
    candidateBundle: testPack.candidateBundle,
    counts,
    results,
  });
}
