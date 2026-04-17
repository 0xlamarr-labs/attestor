import { strict as assert } from 'node:assert';
import {
  buildReleaseTokenClaims,
  createReleaseDecisionSkeleton,
  EVIDENCE_PACK_SPEC_VERSION,
  isTerminalReleaseDecisionStatus,
  RELEASE_DECISION_SPEC_VERSION,
  RELEASE_KERNEL_SPEC_VERSION,
  RELEASE_TOKEN_SPEC_VERSION,
  releaseDecisionExpiresAt,
  releaseDecisionRequiresIntrospection,
  retentionClassForRiskClass,
  type EvidencePack,
} from '../src/release-kernel/object-model.js';
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
  equal(RELEASE_KERNEL_SPEC_VERSION, 'attestor.release-kernel.v1', 'Release object model: shared schema version is stable');
  equal(RELEASE_DECISION_SPEC_VERSION, 'attestor.release-decision.v1', 'Release object model: decision schema version is stable');
  equal(RELEASE_TOKEN_SPEC_VERSION, 'attestor.release-token.v1', 'Release object model: token schema version is stable');
  equal(EVIDENCE_PACK_SPEC_VERSION, 'attestor.evidence-pack.v1', 'Release object model: evidence schema version is stable');

  const outputContract: OutputContractDescriptor = {
    artifactType: 'financial-reporting.record-field',
    expectedShape: 'single structured field update',
    consequenceType: 'record',
    riskClass: 'R4',
  };

  const capabilityBoundary: CapabilityBoundaryDescriptor = {
    allowedTools: ['xbrl-export'],
    allowedTargets: ['sec.edgar.filing.prepare'],
    allowedDataDomains: ['financial-reporting'],
  };

  const decision = createReleaseDecisionSkeleton({
    id: 'rd_001',
    createdAt: '2026-04-17T12:00:00.000Z',
    status: 'accepted',
    policyVersion: 'finance-record-release.v1',
    policyHash: 'sha256:policy',
    outputHash: 'sha256:output',
    consequenceHash: 'sha256:consequence',
    outputContract,
    capabilityBoundary,
    requester: {
      id: 'svc.reporting-bot',
      type: 'service',
      displayName: 'Reporting Bot',
      role: 'reporting-automation',
    },
    target: {
      kind: 'record-store',
      id: 'sec.edgar.filing.prepare',
      displayName: 'EDGAR Filing Preparation',
    },
    findings: [
      {
        code: 'schema_valid',
        result: 'pass',
        message: 'Output matches the expected record shape.',
        source: 'deterministic-check',
      },
    ],
  });

  equal(decision.version, RELEASE_DECISION_SPEC_VERSION, 'Release object model: decision skeleton stamps the decision version');
  equal(decision.reviewAuthority.mode, 'dual-approval', 'Release object model: R4 defaults to dual approval');
  equal(decision.reviewAuthority.minimumReviewerCount, 2, 'Release object model: R4 defaults to two reviewers');
  ok(releaseDecisionRequiresIntrospection(decision), 'Release object model: R4 decisions require introspection by default');
  equal(retentionClassForRiskClass('R4'), 'regulated', 'Release object model: R4 maps to regulated retention');
  equal(
    releaseDecisionExpiresAt(decision),
    '2026-04-17T12:03:00.000Z',
    'Release object model: R4 default expiry is short and deterministic',
  );

  const token = buildReleaseTokenClaims({
    issuer: 'attestor',
    subject: 'releaseDecision:rd_001',
    tokenId: 'rt_001',
    issuedAtEpochSeconds: 1_776_424_000,
    ttlSeconds: 180,
    decision,
  });

  equal(token.version, RELEASE_TOKEN_SPEC_VERSION, 'Release object model: token builder stamps the token version');
  equal(token.aud, 'sec.edgar.filing.prepare', 'Release object model: token audience binds to the downstream target');
  equal(token.decision_id, decision.id, 'Release object model: token claims bind back to the release decision');
  equal(token.risk_class, 'R4', 'Release object model: token claims preserve risk class');
  ok(token.introspection_required, 'Release object model: token claims expose introspection requirements');
  equal(token.exp - token.iat, 180, 'Release object model: token TTL is preserved exactly');

  const evidencePack: EvidencePack = {
    version: EVIDENCE_PACK_SPEC_VERSION,
    id: 'ep_001',
    outputHash: decision.outputHash,
    consequenceHash: decision.consequenceHash,
    policyVersion: decision.policyVersion,
    policyHash: decision.policyHash,
    retentionClass: 'regulated',
    findings: decision.findings,
    artifacts: [
      {
        kind: 'verification-kit',
        path: 'docs/evidence/sample-kit.json',
        digest: 'sha256:kit',
      },
    ],
  };

  equal(evidencePack.version, EVIDENCE_PACK_SPEC_VERSION, 'Release object model: evidence packs carry their own schema version');
  equal(evidencePack.retentionClass, 'regulated', 'Release object model: evidence packs encode retention class explicitly');

  ok(isTerminalReleaseDecisionStatus('accepted'), 'Release object model: accepted is terminal');
  ok(!isTerminalReleaseDecisionStatus('hold'), 'Release object model: hold is not terminal');

  console.log(`\nRelease kernel object-model tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease kernel object-model tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
