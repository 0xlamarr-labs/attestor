import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import {
  ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV,
  resetReleaseAuthorityStoreForTests,
} from '../src/service/release-authority-store.js';
import {
  evaluateSharedAuthorityRuntimeReadiness,
} from '../src/service/bootstrap/shared-authority-readiness.js';

let passed = 0;

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
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

async function run(): Promise<void> {
  delete process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV];
  await resetReleaseAuthorityStoreForTests();

  const disabled = await evaluateSharedAuthorityRuntimeReadiness({
    runtimeProfileId: 'production-shared',
  });
  equal(disabled.ready, false, 'Shared authority readiness: disabled store is not ready');
  equal(disabled.configured, false, 'Shared authority readiness: disabled store reports configured=false');
  equal(
    disabled.blockers[0]?.code,
    'release_authority_store_disabled',
    'Shared authority readiness: disabled store names env blocker',
  );

  mkdirSync('.attestor', { recursive: true });
  const tempRoot = mkdtempSync(join(process.cwd(), '.attestor', 'shared-authority-readiness-'));
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

    const readiness = await evaluateSharedAuthorityRuntimeReadiness({
      runtimeProfileId: 'production-shared',
    });

    equal(readiness.configured, true, 'Shared authority readiness: configured store reports configured=true');
    equal(readiness.mode, 'postgres', 'Shared authority readiness: configured store reports postgres mode');
    equal(
      readiness.checks.storeSummariesReadable,
      true,
      'Shared authority readiness: probes all shared store summaries',
    );
    equal(
      readiness.checks.allComponentsSeeded,
      true,
      'Shared authority readiness: all authority components are seeded',
    );
    equal(
      readiness.checks.allComponentsReady,
      true,
      'Shared authority readiness: shared store probes mark all components ready',
    );
    equal(
      readiness.checks.allComponentsBootstrapWired,
      false,
      'Shared authority readiness: runtime bootstrap wiring is not overclaimed',
    );
    equal(
      readiness.checks.requestPathUsesSharedStores,
      false,
      'Shared authority readiness: request path shared-store cutover is not overclaimed',
    );
    equal(
      readiness.ready,
      false,
      'Shared authority readiness: production-shared stays fail-closed until bootstrap metadata is wired',
    );
    ok(
      readiness.blockers.some((blocker) => blocker.code === 'release_authority_bootstrap_not_wired'),
      'Shared authority readiness: missing bootstrap wiring is an explicit blocker',
    );
    ok(
      readiness.blockers.some((blocker) => blocker.code === 'release_authority_request_path_not_shared'),
      'Shared authority readiness: production-shared request-path cutover is an explicit blocker',
    );
    equal(
      readiness.components.length,
      8,
      'Shared authority readiness: diagnostic returns all 8 authority components',
    );
    ok(
      readiness.components.every((component) => component.bootstrapWired === false),
      'Shared authority readiness: current shared stores preserve bootstrapWired=false',
    );

    const requestPathReady = await evaluateSharedAuthorityRuntimeReadiness({
      runtimeProfileId: 'production-shared',
      requestPathUsesSharedStores: true,
    });
    equal(
      requestPathReady.checks.requestPathUsesSharedStores,
      true,
      'Shared authority readiness: request-path cutover signal is caller-owned',
    );
    ok(
      !requestPathReady.blockers.some(
        (blocker) => blocker.code === 'release_authority_request_path_not_shared',
      ),
      'Shared authority readiness: request-path blocker clears only when runtime reports shared-store cutover',
    );
    equal(
      requestPathReady.ready,
      false,
      'Shared authority readiness: bootstrap metadata still keeps production-shared fail-closed',
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

  console.log(`Shared authority runtime readiness tests: ${passed} passed, 0 failed`);
}

run().catch((error) => {
  console.error('Shared authority runtime readiness tests failed:', error);
  process.exit(1);
});
