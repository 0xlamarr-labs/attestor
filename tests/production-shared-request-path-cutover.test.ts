import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { Hono } from 'hono';
import EmbeddedPostgres from 'embedded-postgres';
import {
  ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV,
  listReleaseAuthorityComponents,
  resetReleaseAuthorityStoreForTests,
} from '../src/service/release-authority-store.js';
import { createSharedPolicyControlPlaneStore } from '../src/service/release-policy-authority-store.js';
import {
  ATTESTOR_RUNTIME_PROFILE_ENV,
  type ReleaseRuntimeStoreModes,
} from '../src/service/bootstrap/runtime-profile.js';
import {
  buildReleaseRuntimeRequestPathDiagnostics,
} from '../src/service/bootstrap/release-runtime.js';
import { createApiHttpRouteRuntime } from '../src/service/bootstrap/api-route-runtime.js';
import { createRegistries } from '../src/service/bootstrap/registries.js';
import { registerAllRoutes } from '../src/service/bootstrap/routes.js';
import { shutdownTenantRuntimeBackends } from '../src/service/runtime/tenant-runtime.js';

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

function allSharedModes(): ReleaseRuntimeStoreModes {
  return {
    'release-decision-log': 'shared',
    'release-reviewer-queue': 'shared',
    'release-token-introspection': 'shared',
    'release-evidence-pack-store': 'shared',
    'release-degraded-mode-grants': 'shared',
    'policy-control-plane-store': 'shared',
    'policy-activation-approval-store': 'shared',
    'policy-mutation-audit-log': 'shared',
  };
}

async function requestPathResponse(path: string, init?: RequestInit): Promise<Response> {
  const runtime = await createApiHttpRouteRuntime({
    registries: createRegistries(),
    serviceInstanceId: 'production-shared-request-path-cutover-test',
    startTime: Date.now(),
  });
  const app = new Hono();
  registerAllRoutes(app, runtime);
  return app.request(path, init);
}

async function testMissingSharedStoreFailsClosed(): Promise<void> {
  delete process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV];
  process.env[ATTESTOR_RUNTIME_PROFILE_ENV] = 'production-shared';

  const response = await requestPathResponse('/api/v1/admin/release-policy/packs', {
    headers: { authorization: 'Bearer step07-admin' },
  });
  equal(response.status, 503, 'Production-shared cutover: missing shared store keeps request path closed');
  const body = await response.json() as { error: string };
  equal(
    body.error,
    'production_shared_request_path_not_ready',
    'Production-shared cutover: missing shared store names the request-path guard',
  );
}

async function testUnreachableSharedStoreFailsClosed(): Promise<void> {
  const closedPort = await reservePort();
  process.env[ATTESTOR_RUNTIME_PROFILE_ENV] = 'production-shared';
  process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV] =
    `postgres://release_authority:release_authority@127.0.0.1:${closedPort}/attestor_release_authority`;

  const response = await requestPathResponse('/api/v1/admin/release-policy/packs', {
    headers: { authorization: 'Bearer step07-admin' },
  });
  equal(response.status, 503, 'Production-shared cutover: unreachable shared store keeps request path closed');
}

function testContractMismatchFailsClosed(): void {
  const diagnostics = buildReleaseRuntimeRequestPathDiagnostics(allSharedModes());
  equal(
    diagnostics.usesSharedAuthorityStores,
    false,
    'Production-shared cutover: all shared modes alone do not claim request-path cutover',
  );
  ok(
    diagnostics.blockers.some((blocker) => blocker.includes('synchronous release-layer authority store contracts')),
    'Production-shared cutover: contract mismatch remains an explicit blocker',
  );
}

async function testActualRequestPathWritesSharedStore(): Promise<void> {
  mkdirSync('.attestor', { recursive: true });
  const tempRoot = mkdtempSync(join(process.cwd(), '.attestor', 'production-shared-cutover-'));
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
    process.env[ATTESTOR_RUNTIME_PROFILE_ENV] = 'production-shared';
    process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV] =
      `postgres://release_authority:release_authority@localhost:${pgPort}/attestor_release_authority`;

    const runtime = await createApiHttpRouteRuntime({
      registries: createRegistries(),
      serviceInstanceId: 'production-shared-request-path-cutover-test',
      startTime: Date.now(),
    });
    const security = runtime.infra.security as {
      releaseRuntimeDurability: { ready: boolean };
      releaseRuntimeRequestPathDiagnostics: {
        usesSharedAuthorityStores: boolean;
        contract: string;
        blockers: readonly string[];
      };
    };
    equal(
      security.releaseRuntimeDurability.ready,
      true,
      'Production-shared cutover: shared authority stores satisfy runtime durability',
    );
    equal(
      security.releaseRuntimeRequestPathDiagnostics.contract,
      'async-shared-authority-stores',
      'Production-shared cutover: runtime advertises the async shared-store contract only after bootstrap wiring',
    );
    equal(
      security.releaseRuntimeRequestPathDiagnostics.usesSharedAuthorityStores,
      true,
      'Production-shared cutover: request path reports shared only after actual shared bootstrap',
    );
    equal(
      security.releaseRuntimeRequestPathDiagnostics.blockers.length,
      0,
      'Production-shared cutover: actual shared request path has no cutover blockers',
    );

    const components = await listReleaseAuthorityComponents();
    ok(
      components.every((component) => component.metadata.bootstrapWired === true),
      'Production-shared cutover: every shared authority component is marked bootstrap-wired',
    );

    const app = new Hono();
    registerAllRoutes(app, runtime);
    const controlPlane = await app.request('/api/v1/admin/release-policy/control-plane', {
      headers: { authorization: 'Bearer step07-admin' },
    });
    equal(controlPlane.status, 200, 'Production-shared cutover: guarded release-policy route opens after cutover');
    const controlPlaneBody = await controlPlane.json() as { storeKind: string };
    equal(
      controlPlaneBody.storeKind,
      'postgres',
      'Production-shared cutover: release-policy route exposes the shared PostgreSQL store kind',
    );

    const packId = `step07-shared-pack-${Date.now().toString(36)}`;
    const upsert = await app.request('/api/v1/admin/release-policy/packs', {
      method: 'POST',
      headers: {
        authorization: 'Bearer step07-admin',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        pack: {
          id: packId,
          name: 'Step 07 shared request path pack',
          description: 'Proves the HTTP request path writes through the shared authority store.',
          lifecycleState: 'draft',
          owners: ['attestor-test'],
          labels: ['production-shared', 'step-07'],
        },
        reasonCode: 'step-07-cutover-test',
      }),
    });
    equal(upsert.status, 200, 'Production-shared cutover: release-policy write route succeeds after cutover');

    const sharedStorePack = await createSharedPolicyControlPlaneStore().getPack(packId);
    equal(
      sharedStorePack?.id,
      packId,
      'Production-shared cutover: HTTP request path persists policy pack into the shared store',
    );
  } finally {
    delete process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV];
    await resetReleaseAuthorityStoreForTests();
    try {
      await pg.stop();
    } catch {}
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  }
}

async function run(): Promise<void> {
  const previousProfile = process.env[ATTESTOR_RUNTIME_PROFILE_ENV];
  const previousAuthorityUrl = process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV];
  const previousAdminKey = process.env.ATTESTOR_ADMIN_API_KEY;
  process.env.ATTESTOR_ADMIN_API_KEY = 'step07-admin';

  try {
    await testMissingSharedStoreFailsClosed();
    await resetReleaseAuthorityStoreForTests();
    await testUnreachableSharedStoreFailsClosed();
    delete process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV];
    await resetReleaseAuthorityStoreForTests();
    testContractMismatchFailsClosed();
    await testActualRequestPathWritesSharedStore();
  } finally {
    await shutdownTenantRuntimeBackends();
    if (process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV] !== previousAuthorityUrl) {
      delete process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV];
    }
    await resetReleaseAuthorityStoreForTests();
    if (previousProfile === undefined) {
      delete process.env[ATTESTOR_RUNTIME_PROFILE_ENV];
    } else {
      process.env[ATTESTOR_RUNTIME_PROFILE_ENV] = previousProfile;
    }
    if (previousAuthorityUrl === undefined) {
      delete process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV];
    } else {
      process.env[ATTESTOR_RELEASE_AUTHORITY_PG_URL_ENV] = previousAuthorityUrl;
    }
    if (previousAdminKey === undefined) {
      delete process.env.ATTESTOR_ADMIN_API_KEY;
    } else {
      process.env.ATTESTOR_ADMIN_API_KEY = previousAdminKey;
    }
  }

  console.log(`Production-shared request path cutover tests: ${passed} passed, 0 failed`);
}

run().catch((error) => {
  console.error('Production-shared request path cutover tests failed:', error);
  process.exit(1);
});
