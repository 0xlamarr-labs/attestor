import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { createReleaseDecisionSkeleton } from '../src/release-kernel/object-model.js';
import { createReleaseTokenIssuer } from '../src/release-kernel/release-token.js';
import { generateKeyPair } from '../src/signing/keys.js';
import {
  ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV,
  getReleaseAuthorityComponent,
  withReleaseAuthorityTransaction,
} from '../src/service/release-authority-store.js';
import {
  SharedReleaseTokenIntrospectionStoreError,
  createSharedReleaseTokenIntrospectionStore,
  ensureSharedReleaseTokenIntrospectionStore,
  resetSharedReleaseTokenIntrospectionStoreForTests,
} from '../src/service/release-token-introspection-store.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a TCP port.'));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function makeDecision(id: string) {
  return createReleaseDecisionSkeleton({
    id,
    createdAt: '2026-04-24T19:00:00.000Z',
    status: 'accepted',
    policyVersion: 'finance.structured-record-release.v1',
    policyHash: 'finance.structured-record-release.v1',
    outputHash: `sha256:output-${id}`,
    consequenceHash: `sha256:consequence-${id}`,
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

async function run(): Promise<void> {
  mkdirSync('.attestor', { recursive: true });
  const tempRoot = mkdtempSync(join(tmpdir(), 'attestor-release-token-introspection-store-'));
  const pgPort = await reservePort();
  const pg = new EmbeddedPostgres({
    databaseDir: join(tempRoot, 'pg'),
    user: 'release_token_introspection',
    password: 'release_token_introspection',
    port: pgPort,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  try {
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('attestor_release_authority');
    process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV] =
      `postgres://release_token_introspection:release_token_introspection@localhost:${pgPort}/attestor_release_authority`;

    const keys = generateKeyPair();
    const issuer = createReleaseTokenIssuer({
      issuer: 'attestor.release.shared',
      privateKeyPem: keys.privateKeyPem,
      publicKeyPem: keys.publicKeyPem,
    });
    const store = createSharedReleaseTokenIntrospectionStore();
    const bootSummary = await ensureSharedReleaseTokenIntrospectionStore();
    equal(
      bootSummary.totalRecords,
      0,
      'Shared token introspection: boot summary starts empty',
    );
    equal(
      bootSummary.componentStatus,
      'ready',
      'Shared token introspection: component is ready after bootstrap',
    );

    const component = await getReleaseAuthorityComponent('release-token-introspection');
    equal(
      String(component?.metadata.lifecycleDiscipline),
      'row-lock-token-use-and-revocation',
      'Shared token introspection: component registry records lifecycle discipline',
    );
    equal(
      String(component?.metadata.bootstrapWired),
      'false',
      'Shared token introspection: component metadata truthfully records runtime wiring as pending',
    );

    const decision = makeDecision('decision-shared-token-1');
    const issued = await issuer.issue({
      decision,
      issuedAt: '2026-04-24T19:00:00.000Z',
      tokenId: 'rt_shared_introspection_single_use',
    });
    const registered = await store.registerIssuedToken({ issuedToken: issued, decision });
    equal(
      registered.status,
      'issued',
      'Shared token introspection: issued token registers as active authority state',
    );
    equal(
      (await store.findToken(issued.tokenId))?.decisionId,
      decision.id,
      'Shared token introspection: lookup reloads token authority state from PostgreSQL',
    );

    const [firstUse, secondUse] = await Promise.all([
      store.recordTokenUse({
        tokenId: issued.tokenId,
        usedAt: '2026-04-24T19:01:00.000Z',
        resourceServerId: 'resource-a',
      }),
      store.recordTokenUse({
        tokenId: issued.tokenId,
        usedAt: '2026-04-24T19:01:00.000Z',
        resourceServerId: 'resource-b',
      }),
    ]);
    const acceptedUses = [firstUse, secondUse].filter((result) => result.accepted);
    equal(
      acceptedUses.length,
      1,
      'Shared token introspection: concurrent replay attempts only consume a single-use token once',
    );
    equal(
      (await store.findToken(issued.tokenId))?.status,
      'consumed',
      'Shared token introspection: consumed token state persists after concurrent use',
    );

    const revocableDecision = makeDecision('decision-shared-token-revoke');
    const revocableToken = await issuer.issue({
      decision: revocableDecision,
      issuedAt: '2026-04-24T19:00:00.000Z',
      tokenId: 'rt_shared_introspection_revoked',
    });
    await store.registerIssuedToken({
      issuedToken: revocableToken,
      decision: revocableDecision,
    });
    await store.revokeToken({
      tokenId: revocableToken.tokenId,
      revokedAt: '2026-04-24T19:01:30.000Z',
      reason: 'operator revoke test',
      revokedBy: 'release-token-introspection-store-test',
    });
    equal(
      (await store.findToken(revocableToken.tokenId))?.status,
      'revoked',
      'Shared token introspection: revocation state persists in the shared store',
    );

    const expiringDecision = makeDecision('decision-shared-token-expired');
    const expiringToken = await issuer.issue({
      decision: expiringDecision,
      issuedAt: '2026-04-24T19:00:00.000Z',
      tokenId: 'rt_shared_introspection_expired',
      ttlSeconds: 60,
    });
    await store.registerIssuedToken({
      issuedToken: expiringToken,
      decision: expiringDecision,
    });
    const expired = await store.syncLifecycle('2026-04-24T19:02:00.000Z');
    ok(
      expired.some((record) => record.tokenId === expiringToken.tokenId),
      'Shared token introspection: lifecycle sync expires stale issued tokens',
    );
    equal(
      (await store.summary()).expiredRecords,
      1,
      'Shared token introspection: summary counts expired tokens',
    );

    await withReleaseAuthorityTransaction(async (client) => {
      await client.query(
        `UPDATE attestor_release_authority.release_token_introspection_records
            SET record_json = jsonb_set(record_json, '{status}', '"issued"'::jsonb)
          WHERE token_id = $1`,
        [revocableToken.tokenId],
      );
    });

    await assert.rejects(
      store.findToken(revocableToken.tokenId),
      SharedReleaseTokenIntrospectionStoreError,
      'Shared token introspection: tampered projected state fails closed on reload',
    );
    passed += 1;
  } finally {
    await resetSharedReleaseTokenIntrospectionStoreForTests();
    delete process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV];
    try {
      await pg.stop();
    } catch {}
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  }

  console.log(`Shared release token introspection store tests: ${passed} passed, 0 failed`);
}

run().catch((error) => {
  console.error('Shared release token introspection store tests failed:', error);
  process.exit(1);
});
