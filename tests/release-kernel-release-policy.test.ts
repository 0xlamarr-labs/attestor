import { strict as assert } from 'node:assert';
import {
  createFirstHardGatewayReleasePolicy,
  createReleasePolicyDefinition,
  matchesReleasePolicyScope,
  RELEASE_POLICY_SPEC_VERSION,
} from '../src/release-kernel/release-policy.js';
import type {
  CapabilityBoundaryDescriptor,
  OutputContractDescriptor,
} from '../src/release-kernel/types.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

async function main(): Promise<void> {
  const firstPolicy = createFirstHardGatewayReleasePolicy();

  equal(
    firstPolicy.version,
    RELEASE_POLICY_SPEC_VERSION,
    'Release policy: schema version is stable and stamped on created policies',
  );
  equal(
    firstPolicy.scope.wedgeId,
    'finance-structured-record-release',
    'Release policy: the first policy is anchored to the frozen first hard gateway wedge',
  );
  equal(
    firstPolicy.scope.consequenceType,
    'record',
    'Release policy: the first policy targets the record consequence type',
  );
  equal(
    firstPolicy.scope.riskClass,
    'R4',
    'Release policy: the first policy inherits the R4 default from the hard gateway wedge',
  );
  ok(
    firstPolicy.acceptance.requiredChecks.includes('provenance-binding') &&
      firstPolicy.acceptance.requiredChecks.includes('downstream-receipt-reconciliation'),
    'Release policy: the first policy requires the strongest R4 deterministic checks',
  );
  equal(
    firstPolicy.release.reviewMode,
    'dual-approval',
    'Release policy: the first policy requires dual approval',
  );
  equal(
    firstPolicy.release.tokenEnforcement,
    'required-with-introspection',
    'Release policy: the first policy requires introspectable token enforcement',
  );
  ok(
    firstPolicy.release.requireSignedEnvelope,
    'Release policy: the first policy requires signed record envelopes',
  );
  ok(
    firstPolicy.release.requireDurableEvidencePack,
    'Release policy: the first policy requires a durable evidence pack',
  );

  const matchingOutputContract: OutputContractDescriptor = {
    artifactType: 'financial-reporting.record-field',
    expectedShape: 'structured financial record payload',
    consequenceType: 'record',
    riskClass: 'R4',
  };

  const matchingCapabilityBoundary: CapabilityBoundaryDescriptor = {
    allowedTools: ['xbrl-export'],
    allowedTargets: ['sec.edgar.filing.prepare'],
    allowedDataDomains: ['financial-reporting'],
  };

  ok(
    matchesReleasePolicyScope(
      firstPolicy,
      matchingOutputContract,
      matchingCapabilityBoundary,
      'record-store',
    ),
    'Release policy: matching structured-record payloads fall inside the first policy scope',
  );

  const nonMatchingOutputContract: OutputContractDescriptor = {
    artifactType: 'financial-reporting.analyst-note',
    expectedShape: 'free-form note',
    consequenceType: 'decision-support',
    riskClass: 'R2',
  };

  ok(
    !matchesReleasePolicyScope(
      firstPolicy,
      nonMatchingOutputContract,
      matchingCapabilityBoundary,
      'queue',
    ),
    'Release policy: non-record advisory outputs do not match the first hard-gateway policy scope',
  );

  const customPolicy = createReleasePolicyDefinition({
    id: 'custom.communication.policy',
    name: 'Custom communication policy',
    status: 'draft',
    scope: {
      wedgeId: 'custom-communication',
      consequenceType: 'communication',
      riskClass: 'R2',
      targetKinds: ['endpoint'],
      dataDomains: ['customer-ops'],
    },
    outputContract: {
      allowedArtifactTypes: ['customer-support.reply'],
      expectedShape: 'approved outbound reply',
      consequenceType: 'communication',
      riskClass: 'R2',
    },
    capabilityBoundary: {
      allowedTools: ['send-email'],
      allowedTargets: ['customer.reply.send'],
      allowedDataDomains: ['customer-ops'],
      requiresSingleTargetBinding: true,
    },
    acceptance: {
      strategy: 'review-on-warning',
      requiredChecks: ['contract-shape', 'target-binding', 'capability-boundary'],
      requiredEvidenceKinds: ['trace', 'finding-log'],
      maxWarnings: 1,
      failureDisposition: 'hold',
    },
    release: {
      reviewMode: 'auto',
      minimumReviewerCount: 0,
      tokenEnforcement: 'required',
      requireSignedEnvelope: false,
      requireDurableEvidencePack: false,
      requireDownstreamReceipt: true,
      retentionClass: 'standard',
    },
  });

  equal(
    customPolicy.status,
    'draft',
    'Release policy: custom policies can stay draft while the language remains versioned',
  );
  equal(
    customPolicy.acceptance.strategy,
    'review-on-warning',
    'Release policy: the language supports strategy selection without becoming imperative',
  );
  equal(
    customPolicy.release.tokenEnforcement,
    'required',
    'Release policy: the language can express hard enforcement without introspection',
  );

  console.log(`\nRelease kernel release-policy tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease kernel release-policy tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
