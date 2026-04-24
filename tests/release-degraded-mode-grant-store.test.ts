import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { degradedMode } from '../src/release-enforcement-plane/index.js';
import {
  ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV,
  RELEASE_AUTHORITY_SCHEMA,
  getReleaseAuthorityComponent,
  withReleaseAuthorityTransaction,
} from '../src/service/release-authority-store.js';
import {
  SharedReleaseDegradedModeGrantStoreError,
  createSharedReleaseDegradedModeGrantStore,
  ensureSharedReleaseDegradedModeGrantStore,
  resetSharedReleaseDegradedModeGrantStoreForTests,
} from '../src/service/release-degraded-mode-grant-store.js';

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

function actor(id: string, role = 'incident-commander') {
  return {
    id,
    type: 'user',
    displayName: id.replaceAll('_', ' '),
    role,
  } as const;
}

function createGrant(id: string, maxUses = 2) {
  return degradedMode.createDegradedModeGrant({
    id,
    state: 'break-glass-open',
    reason: 'incident-response',
    scope: {
      environment: 'prod-eu',
      tenantId: 'tenant-finance',
      enforcementPointId: 'pep-api',
      consequenceType: 'record',
      riskClass: 'R4',
    },
    authorizedBy: actor('incident_commander'),
    approvedBy: [actor('risk_owner', 'risk-owner')],
    authorizedAt: '2026-04-24T19:00:00.000Z',
    startsAt: '2026-04-24T19:00:00.000Z',
    expiresAt: '2026-04-24T19:20:00.000Z',
    ticketId: `INC-${id}`,
    rationale: 'Permit bounded break-glass admission during authority-plane outage.',
    maxUses,
  });
}

async function run(): Promise<void> {
  mkdirSync('.attestor', { recursive: true });
  const tempRoot = mkdtempSync(join(tmpdir(), 'attestor-release-degraded-mode-store-'));
  const pgPort = await reservePort();
  const pg = new EmbeddedPostgres({
    databaseDir: join(tempRoot, 'pg'),
    user: 'release_degraded_mode',
    password: 'release_degraded_mode',
    port: pgPort,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  try {
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('attestor_release_authority');
    process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV] =
      `postgres://release_degraded_mode:release_degraded_mode@localhost:${pgPort}/attestor_release_authority`;

    const store = createSharedReleaseDegradedModeGrantStore();
    const bootSummary = await ensureSharedReleaseDegradedModeGrantStore();
    equal(bootSummary.grantCount, 0, 'Shared degraded-mode store: boot summary starts empty');
    equal(bootSummary.componentStatus, 'ready', 'Shared degraded-mode store: component is marked ready');

    const component = await getReleaseAuthorityComponent('release-degraded-mode-grants');
    equal(
      String(component?.metadata.trackerStep),
      '06',
      'Shared degraded-mode store: component registry records Step 06 ownership',
    );
    equal(
      String(component?.metadata.bootstrapWired),
      'false',
      'Shared degraded-mode store: component registry keeps runtime wiring truthful',
    );

    const grant = await store.registerGrant(createGrant('grant-shared-1'));
    equal(grant.remainingUses, 2, 'Shared degraded-mode store: grant registers with use budget');
    equal(
      (await store.listAuditRecords()).length,
      1,
      'Shared degraded-mode store: grant creation appends audit record',
    );

    const reloaded = await store.findGrant(grant.id);
    equal(reloaded?.auditDigest, grant.auditDigest, 'Shared degraded-mode store: grant reloads durably');

    const oneUseGrant = await store.registerGrant(createGrant('grant-shared-concurrent', 1));
    const consumes = await Promise.all([
      store.consumeGrant({
        id: oneUseGrant.id,
        checkedAt: '2026-04-24T19:05:00.000Z',
        actor: actor('resource_server', 'service'),
        failureReasons: ['introspection-unavailable'],
        outcome: 'break-glass-allow',
        metadata: { path: 'first' },
      }),
      store.consumeGrant({
        id: oneUseGrant.id,
        checkedAt: '2026-04-24T19:05:00.000Z',
        actor: actor('resource_server', 'service'),
        failureReasons: ['introspection-unavailable'],
        outcome: 'break-glass-allow',
        metadata: { path: 'second' },
      }),
    ]);
    equal(
      consumes.filter(Boolean).length,
      1,
      'Shared degraded-mode store: concurrent one-use grant consumption succeeds once',
    );
    equal(
      (await store.findGrant(oneUseGrant.id))?.remainingUses,
      0,
      'Shared degraded-mode store: row-locked consume exhausts the grant budget',
    );

    const revoked = await store.revokeGrant({
      id: grant.id,
      revokedAt: '2026-04-24T19:06:00.000Z',
      revokedBy: actor('incident_commander'),
      revocationReason: 'Authority plane recovered.',
    });
    equal(revoked?.revocationReason, 'Authority plane recovered.', 'Shared degraded-mode store: revocation persists');
    equal(
      (await store.listGrants({ status: 'revoked', checkedAt: '2026-04-24T19:07:00.000Z' })).length,
      1,
      'Shared degraded-mode store: status filtering uses persisted grant state',
    );

    const auditHead = await store.auditHead();
    ok(auditHead?.startsWith('sha256:'), 'Shared degraded-mode store: audit head is digest-addressed');

    await withReleaseAuthorityTransaction((client) =>
      client.query(
        `UPDATE ${RELEASE_AUTHORITY_SCHEMA}.release_degraded_mode_grants
            SET grant_json = jsonb_set(grant_json, '{remainingUses}', to_jsonb(99))
          WHERE grant_id = $1`,
        [grant.id],
      ),
    );
    await assert.rejects(
      () => store.findGrant(grant.id),
      SharedReleaseDegradedModeGrantStoreError,
      'Shared degraded-mode store: tampered projected grant JSON fails closed',
    );
    passed += 1;
  } finally {
    await resetSharedReleaseDegradedModeGrantStoreForTests();
    delete process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV];
    await pg.stop().catch(() => undefined);
    rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log(`release-degraded-mode-grant-store tests passed (${passed} assertions)`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
