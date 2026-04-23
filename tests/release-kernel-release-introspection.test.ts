import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair } from '../src/signing/keys.js';
import { createReleaseDecisionSkeleton } from '../src/release-kernel/object-model.js';
import { createReleaseTokenIssuer } from '../src/release-kernel/release-token.js';
import {
  createFileBackedReleaseTokenIntrospectionStore,
  createInMemoryReleaseTokenIntrospectionStore,
  createReleaseTokenIntrospector,
  resetFileBackedReleaseTokenIntrospectionStoreForTests,
  ReleaseTokenIntrospectionStoreError,
} from '../src/release-kernel/release-introspection.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function makeDecision() {
  return createReleaseDecisionSkeleton({
    id: 'decision-release-introspection',
    createdAt: '2026-04-17T23:00:00.000Z',
    status: 'accepted',
    policyVersion: 'finance.structured-record-release.v1',
    policyHash: 'finance.structured-record-release.v1',
    outputHash: 'sha256:output',
    consequenceHash: 'sha256:consequence',
    outputContract: {
      artifactType: 'financial-reporting.record-field',
      expectedShape: 'structured financial record payload',
      consequenceType: 'record',
      riskClass: 'R4',
    },
    capabilityBoundary: {
      allowedTools: ['xbrl-export'],
      allowedTargets: ['sec.edgar.filing.prepare'],
      allowedDataDomains: ['financial-reporting'],
    },
    requester: {
      id: 'svc.reporting-bot',
      type: 'service',
    },
    target: {
      kind: 'record-store',
      id: 'finance.reporting.record-store',
    },
  });
}

async function main(): Promise<void> {
  const keyPair = generateKeyPair();
  const issuer = createReleaseTokenIssuer({
    issuer: 'attestor.release.local',
    privateKeyPem: keyPair.privateKeyPem,
    publicKeyPem: keyPair.publicKeyPem,
  });
  const verificationKey = await issuer.exportVerificationKey();
  const store = createInMemoryReleaseTokenIntrospectionStore();
  const introspector = createReleaseTokenIntrospector(store);
  const decision = makeDecision();

  const issued = await issuer.issue({
    decision,
    issuedAt: '2026-04-17T23:00:00.000Z',
  });
  store.registerIssuedToken({
    issuedToken: issued,
    decision,
  });

  const active = await introspector.introspect({
    token: issued.token,
    verificationKey,
    audience: 'finance.reporting.record-store',
    currentDate: '2026-04-17T23:01:00.000Z',
    tokenTypeHint: 'attestor_release_token',
    resourceServerId: 'attestor.tests.release-introspection',
  });

  ok(active.active, 'Release introspection: registered high-risk token is active');
  if (active.active) {
    equal(
      active.scope,
      'release:record',
      'Release introspection: active response carries a consequence-specific scope view',
    );
    equal(
      active.decision_id,
      decision.id,
      'Release introspection: active response preserves the decision id',
    );
    equal(
      active.output_hash,
      decision.outputHash,
      'Release introspection: active response preserves the bound output hash',
    );
    equal(
      active.resource_server_id,
      'attestor.tests.release-introspection',
      'Release introspection: resource server id is echoed for audit correlation',
    );
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'attestor-release-token-introspection-'));
  const filePath = join(tempDir, 'release-token-introspection-store.json');
  try {
    const fileStore = createFileBackedReleaseTokenIntrospectionStore(filePath);
    fileStore.registerIssuedToken({
      issuedToken: issued,
      decision,
    });

    const reloadedStore = createFileBackedReleaseTokenIntrospectionStore(filePath);
    equal(
      reloadedStore.findToken(issued.tokenId)?.status ?? null,
      'issued',
      'Release introspection: file-backed store reloads issued token state after restart',
    );

    const fileBackedIntrospector = createReleaseTokenIntrospector(reloadedStore);
    const activeAfterRestart = await fileBackedIntrospector.introspect({
      token: issued.token,
      verificationKey,
      audience: 'finance.reporting.record-store',
      currentDate: '2026-04-17T23:01:00.000Z',
      resourceServerId: 'attestor.tests.release-introspection.file-backed',
    });
    ok(
      activeAfterRestart.active,
      'Release introspection: file-backed store keeps registered tokens active after restart',
    );

    reloadedStore.revokeToken({
      tokenId: issued.tokenId,
      revokedAt: '2026-04-17T23:01:20.000Z',
      reason: 'restart-safe revocation test',
      revokedBy: 'release-introspection-test',
    });
    const revokedReload = createFileBackedReleaseTokenIntrospectionStore(filePath);
    equal(
      revokedReload.findToken(issued.tokenId)?.status ?? null,
      'revoked',
      'Release introspection: file-backed store preserves revoked token state after restart',
    );

    const durableSingleUse = await issuer.issue({
      decision,
      issuedAt: '2026-04-17T23:00:00.000Z',
      tokenId: 'rt_file_backed_single_use_introspection',
    });
    revokedReload.registerIssuedToken({
      issuedToken: durableSingleUse,
      decision,
    });
    revokedReload.recordTokenUse({
      tokenId: durableSingleUse.tokenId,
      usedAt: '2026-04-17T23:01:30.000Z',
      resourceServerId: 'attestor.tests.release-introspection.file-backed',
    });
    const consumedReload = createFileBackedReleaseTokenIntrospectionStore(filePath);
    equal(
      consumedReload.findToken(durableSingleUse.tokenId)?.status ?? null,
      'consumed',
      'Release introspection: file-backed store preserves consumed token state after restart',
    );

    writeFileSync(filePath, '{bad json', 'utf8');
    assert.throws(
      () => createFileBackedReleaseTokenIntrospectionStore(filePath),
      ReleaseTokenIntrospectionStoreError,
      'Release introspection: file-backed store fails closed on corrupt persisted token state',
    );
    passed += 1;
  } finally {
    resetFileBackedReleaseTokenIntrospectionStoreForTests(filePath);
    rmSync(tempDir, { recursive: true, force: true });
  }

  const unregistered = await issuer.issue({
    decision,
    issuedAt: '2026-04-17T23:00:00.000Z',
    tokenId: 'rt_unregistered_introspection',
  });
  const inactiveUnregistered = await introspector.introspect({
    token: unregistered.token,
    verificationKey,
    audience: 'finance.reporting.record-store',
    currentDate: '2026-04-17T23:01:00.000Z',
  });
  ok(
    inactiveUnregistered.active === false,
    'Release introspection: cryptographically valid but unknown tokens are inactive',
  );

  const singleUseIssued = await issuer.issue({
    decision,
    issuedAt: '2026-04-17T23:00:00.000Z',
    tokenId: 'rt_single_use_introspection',
  });
  store.registerIssuedToken({
    issuedToken: singleUseIssued,
    decision,
  });
  const firstUse = store.recordTokenUse({
    tokenId: singleUseIssued.tokenId,
    usedAt: '2026-04-17T23:01:30.000Z',
    resourceServerId: 'attestor.tests.release-introspection',
  });
  ok(
    firstUse.accepted === true,
    'Release introspection: first token use is accepted into the replay ledger',
  );
  equal(
    firstUse.record?.status ?? null,
    'consumed',
    'Release introspection: single-use tokens become consumed after the first successful use',
  );
  const secondUse = store.recordTokenUse({
    tokenId: singleUseIssued.tokenId,
    usedAt: '2026-04-17T23:01:40.000Z',
    resourceServerId: 'attestor.tests.release-introspection',
  });
  ok(
    secondUse.accepted === false,
    'Release introspection: second use is rejected as replay instead of silently reauthorizing consequence',
  );
  equal(
    secondUse.inactiveReason,
    'usage_exhausted',
    'Release introspection: replay ledger reports usage exhaustion for already-consumed tokens',
  );
  const inactiveConsumed = await introspector.introspect({
    token: singleUseIssued.token,
    verificationKey,
    audience: 'finance.reporting.record-store',
    currentDate: '2026-04-17T23:01:45.000Z',
    resourceServerId: 'attestor.tests.release-introspection',
  });
  ok(
    inactiveConsumed.active === false,
    'Release introspection: already-consumed tokens are inactive before expiry',
  );
  if (!inactiveConsumed.active) {
    equal(
      inactiveConsumed.inactive_reason,
      'usage_exhausted',
      'Release introspection: consumed tokens report usage exhaustion as the inactive reason',
    );
  }

  const inactiveExpired = await introspector.introspect({
    token: issued.token,
    verificationKey,
    audience: 'finance.reporting.record-store',
    currentDate: '2026-04-17T23:10:00.000Z',
  });
  ok(
    inactiveExpired.active === false,
    'Release introspection: expired tokens are inactive even if they were once registered',
  );
  if (!inactiveExpired.active) {
    equal(
      inactiveExpired.inactive_reason,
      'expired',
      'Release introspection: expired inactive responses explain that expiry, not revocation, ended authorization',
    );
  }
  const expiredRecord = store.findToken(issued.tokenId);
  equal(
    expiredRecord?.status ?? null,
    'expired',
    'Release introspection: lifecycle sync persists an explicit expired registry status',
  );

  const revokedIssued = await issuer.issue({
    decision,
    issuedAt: '2026-04-17T23:00:00.000Z',
    tokenId: 'rt_revoked_introspection',
  });
  store.registerIssuedToken({
    issuedToken: revokedIssued,
    decision,
  });
  const revokedRecord = store.revokeToken({
    tokenId: revokedIssued.tokenId,
    revokedAt: '2026-04-17T23:02:00.000Z',
    reason: 'operator cancelled filing release',
    revokedBy: 'admin_api_key',
  });
  equal(
    revokedRecord?.status ?? null,
    'revoked',
    'Release introspection: explicit revoke transitions the registry record to revoked',
  );
  equal(
    revokedRecord?.revocationReason ?? null,
    'operator cancelled filing release',
    'Release introspection: revoke reason is preserved on the registry record',
  );
  const inactiveRevoked = await introspector.introspect({
    token: revokedIssued.token,
    verificationKey,
    audience: 'finance.reporting.record-store',
    currentDate: '2026-04-17T23:02:30.000Z',
    resourceServerId: 'attestor.tests.release-introspection',
  });
  ok(
    inactiveRevoked.active === false,
    'Release introspection: explicitly revoked tokens are inactive even before natural expiry',
  );
  if (!inactiveRevoked.active) {
    equal(
      inactiveRevoked.inactive_reason,
      'revoked',
      'Release introspection: revoked tokens report revocation as the inactive reason',
    );
  }

  const inactiveAudienceMismatch = await introspector.introspect({
    token: issued.token,
    verificationKey,
    audience: 'other.resource',
    currentDate: '2026-04-17T23:01:00.000Z',
    tokenTypeHint: 'access_token',
  });
  ok(
    inactiveAudienceMismatch.active === false,
    'Release introspection: audience mismatch is treated as inactive instead of reusable authorization',
  );

  console.log(`\nRelease kernel release-introspection tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nRelease kernel release-introspection tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
