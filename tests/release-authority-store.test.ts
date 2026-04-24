import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import {
  ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV,
  ensureReleaseAuthorityStore,
  getReleaseAuthorityComponent,
  isReleaseAuthorityStoreConfigured,
  listReleaseAuthorityComponents,
  recordReleaseAuthorityComponentState,
  releaseAuthorityStoreMode,
  resetReleaseAuthorityStoreForTests,
  withReleaseAuthorityAdvisoryLock,
  withReleaseAuthorityTransaction,
} from '../src/service/release-authority-store.js';

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
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(): Promise<void> {
  equal(releaseAuthorityStoreMode(), 'disabled', 'Release authority store: disabled by default');
  equal(
    isReleaseAuthorityStoreConfigured(),
    false,
    'Release authority store: not configured by default',
  );

  mkdirSync('.attestor', { recursive: true });
  const tempRoot = mkdtempSync(join(process.cwd(), '.attestor', 'release-authority-store-'));
  const pgPort = await reservePort();
  const pg = new EmbeddedPostgres({
    databaseDir: join(tempRoot, 'pg'),
    user: 'release_authority',
    password: 'release_authority',
    port: pgPort,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  try {
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('attestor_release_authority');
    process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV] =
      `postgres://release_authority:release_authority@localhost:${pgPort}/attestor_release_authority`;

    equal(releaseAuthorityStoreMode(), 'postgres', 'Release authority store: postgres mode when env set');
    equal(
      isReleaseAuthorityStoreConfigured(),
      true,
      'Release authority store: configured when env set',
    );

    const summary = await ensureReleaseAuthorityStore();
    equal(summary.mode, 'postgres', 'Release authority store: summary reports postgres mode');
    equal(summary.configured, true, 'Release authority store: summary reports configured=true');
    equal(summary.schema, 'attestor_release_authority', 'Release authority store: schema name is explicit');
    equal(summary.schemaVersion, 1, 'Release authority store: schema version is explicit');
    equal(summary.componentCount, 8, 'Release authority store: all authority components are seeded');
    equal(summary.readyComponentCount, 0, 'Release authority store: seeded components start pending');

    const components = await listReleaseAuthorityComponents();
    equal(components.length, 8, 'Release authority store: component registry lists all 8 components');
    ok(
      components.every((component) => component.desiredMode === 'shared'),
      'Release authority store: every component targets shared mode',
    );
    ok(
      components.every((component) => component.status === 'pending'),
      'Release authority store: every component starts pending',
    );

    await assert.rejects(
      withReleaseAuthorityTransaction(async (client) => {
        await client.query(
          `UPDATE attestor_release_authority.shared_store_components
              SET status = 'ready',
                  migrated_at = NOW(),
                  updated_at = NOW(),
                  metadata_json = '{"path":"rollback"}'::jsonb
            WHERE component_id = 'release-decision-log'`,
        );
        throw new Error('rollback-sentinel');
      }),
      /rollback-sentinel/u,
      'Release authority store: failed transaction should bubble out',
    );
    passed += 1;

    const afterRollback = await getReleaseAuthorityComponent('release-decision-log');
    equal(
      afterRollback?.status,
      'pending',
      'Release authority store: failed transaction rolls component state back',
    );

    const readyRecord = await recordReleaseAuthorityComponentState({
      component: 'release-decision-log',
      status: 'ready',
      metadata: { substrate: 'postgres', phase: 'step-02' },
    });
    equal(
      readyRecord.status,
      'ready',
      'Release authority store: component readiness can be recorded durably',
    );
    ok(
      readyRecord.migratedAt !== null,
      'Release authority store: ready state records migration timestamp',
    );
    equal(
      String(readyRecord.metadata.phase),
      'step-02',
      'Release authority store: component metadata is preserved',
    );

    const updatedSummary = await ensureReleaseAuthorityStore();
    equal(
      updatedSummary.readyComponentCount,
      1,
      'Release authority store: ready component count advances after update',
    );

    let releaseFirstLock!: () => void;
    let firstLockEntered = false;

    const firstLock = withReleaseAuthorityAdvisoryLock(
      'release-reviewer-queue-claim',
      async () => {
        firstLockEntered = true;
        await new Promise<void>((resolve) => {
          releaseFirstLock = resolve;
        });
        return 'first-lock';
      },
    );

    while (!firstLockEntered) {
      await delay(25);
    }

    const secondLock = withReleaseAuthorityAdvisoryLock(
      'release-reviewer-queue-claim',
      async () => 'second-lock',
    );

    const lockRace = await Promise.race([
      secondLock.then(() => 'resolved'),
      delay(100).then(() => 'pending'),
    ]);
    equal(
      lockRace,
      'pending',
      'Release authority store: advisory lock serializes concurrent work on the same key',
    );

    releaseFirstLock();
    equal(await firstLock, 'first-lock', 'Release authority store: first lock completes');
    equal(await secondLock, 'second-lock', 'Release authority store: second lock resumes after release');

    await resetReleaseAuthorityStoreForTests();
    const resetSummary = await ensureReleaseAuthorityStore();
    equal(
      resetSummary.readyComponentCount,
      0,
      'Release authority store: reset drops schema and reboots with pending components',
    );
  } finally {
    await resetReleaseAuthorityStoreForTests();
    delete process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV];
    try {
      await pg.stop();
    } catch {}
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  }

  console.log(`Release authority store tests: ${passed} passed, 0 failed`);
}

run().catch((error) => {
  console.error('Release authority store tests failed:', error);
  process.exit(1);
});
