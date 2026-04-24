import assert from 'node:assert/strict';
import { Hono } from 'hono';
import {
  evaluateProductionSharedRequestGuard,
  installProductionSharedRequestGuard,
} from '../src/service/bootstrap/production-shared-request-guard.js';
import type { AppRuntime } from '../src/service/bootstrap/runtime.js';

let passed = 0;

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function runtimeFor(input: {
  runtimeProfile: string;
  requestPathUsesSharedStores: boolean;
  blockers?: readonly string[];
}): AppRuntime<unknown> {
  return {
    registries: {},
    infra: {
      service: {
        instanceId: 'test',
        startedAtEpochMs: Date.now(),
      },
      security: {
        runtimeProfile: input.runtimeProfile,
        releaseRuntimeRequestPathDiagnostics: {
          version: 'attestor.release-runtime-request-path-diagnostics.v1',
          usesSharedAuthorityStores: input.requestPathUsesSharedStores,
          blockers: input.blockers ?? [],
        },
      },
    },
    stores: {},
    services: {
      httpRoutes: {},
    },
  } as AppRuntime<unknown>;
}

async function appResponseFor(
  runtime: AppRuntime<unknown>,
  path: string,
  method: 'GET' | 'POST',
): Promise<Response> {
  const app = new Hono();
  installProductionSharedRequestGuard(app, runtime);
  app.get('/api/v1/health', (c) => c.json({ status: 'healthy' }));
  app.get('/api/v1/ready', (c) => c.json({ ready: false }));
  app.post('/api/v1/pipeline/run', (c) => c.json({ ran: true }));
  app.get('/api/v1/domains', (c) => c.json({ domains: ['finance'] }));
  return app.request(path, { method });
}

async function run(): Promise<void> {
  const blockedRuntime = runtimeFor({
    runtimeProfile: 'production-shared',
    requestPathUsesSharedStores: false,
    blockers: ['release/policy request handlers still consume synchronous release-layer authority store contracts'],
  });
  const blockedDecision = evaluateProductionSharedRequestGuard(blockedRuntime);
  equal(
    blockedDecision.blocked,
    true,
    'Production-shared guard: blocks when request path does not use shared authority stores',
  );
  equal(
    blockedDecision.requestPathUsesSharedStores,
    false,
    'Production-shared guard: exposes request-path cutover truth',
  );

  const health = await appResponseFor(blockedRuntime, '/api/v1/health', 'GET');
  equal(health.status, 200, 'Production-shared guard: health remains available');
  const ready = await appResponseFor(blockedRuntime, '/api/v1/ready', 'GET');
  equal(ready.status, 200, 'Production-shared guard: readiness remains available');

  const blocked = await appResponseFor(blockedRuntime, '/api/v1/pipeline/run', 'POST');
  equal(blocked.status, 503, 'Production-shared guard: protected request path fails closed');
  const blockedBody = await blocked.json() as {
    error: string;
    guard: { blockers: readonly string[] };
  };
  equal(
    blockedBody.error,
    'production_shared_request_path_not_ready',
    'Production-shared guard: response names request-path readiness failure',
  );
  ok(
    blockedBody.guard.blockers.some((blocker) =>
      blocker.includes('synchronous release-layer authority store contracts'),
    ),
    'Production-shared guard: response carries runtime request-path blocker detail',
  );

  const singleNode = await appResponseFor(
    runtimeFor({
      runtimeProfile: 'single-node-durable',
      requestPathUsesSharedStores: false,
    }),
    '/api/v1/pipeline/run',
    'POST',
  );
  equal(singleNode.status, 200, 'Production-shared guard: single-node durable path is not blocked');

  const sharedReady = await appResponseFor(
    runtimeFor({
      runtimeProfile: 'production-shared',
      requestPathUsesSharedStores: true,
    }),
    '/api/v1/pipeline/run',
    'POST',
  );
  equal(sharedReady.status, 200, 'Production-shared guard: shared cutover signal allows request path');

  const readOnlyButNonPreflight = await appResponseFor(
    blockedRuntime,
    '/api/v1/domains',
    'GET',
  );
  equal(
    readOnlyButNonPreflight.status,
    503,
    'Production-shared guard: only explicit health/readiness preflight paths remain open',
  );

  console.log(`Production-shared request guard tests: ${passed} passed, 0 failed`);
}

run().catch((error) => {
  console.error('Production-shared request guard tests failed:', error);
  process.exit(1);
});
