import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ATTESTOR_RUNTIME_PROFILE_ENV,
  CURRENT_RELEASE_RUNTIME_STORE_MODES,
  RuntimeProfileConfigurationError,
  RuntimeProfileDurabilityError,
  assertReleaseRuntimeDurability,
  evaluateReleaseRuntimeDurability,
  findRuntimeProfile,
  releaseRuntimeDurabilitySummary,
  resolveRuntimeProfile,
  runtimeProfileIds,
  type ReleaseRuntimeStoreModes,
} from '../src/service/bootstrap/runtime-profile.js';
import { createReleaseRuntimeBootstrap } from '../src/service/bootstrap/release-runtime.js';

let passed = 0;

function readProjectFile(...segments: string[]): string {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

function includes(content: string, expected: string, message: string): void {
  assert.ok(
    content.includes(expected),
    `${message}\nExpected to find: ${expected}`,
  );
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
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

function testProfileCatalog(): void {
  assert.deepEqual(
    runtimeProfileIds(),
    ['local-dev', 'single-node-durable', 'production-shared'],
    'Runtime profile: profile ids stay stable',
  );
  passed += 1;

  const localDev = findRuntimeProfile('local-dev');
  const singleNode = findRuntimeProfile('single-node-durable');
  const production = findRuntimeProfile('production-shared');

  ok(localDev, 'Runtime profile: local-dev exists');
  ok(singleNode, 'Runtime profile: single-node-durable exists');
  ok(production, 'Runtime profile: production-shared exists');
  equal(localDev?.production, false, 'Runtime profile: local-dev is not production');
  equal(singleNode?.production, false, 'Runtime profile: single-node-durable is not production');
  equal(production?.production, true, 'Runtime profile: production-shared is production');
  equal(localDev?.releaseStoreRequirements.length, 8, 'Runtime profile: local-dev covers all release stores');
  equal(singleNode?.releaseStoreRequirements.length, 8, 'Runtime profile: single-node covers all release stores');
  equal(production?.releaseStoreRequirements.length, 8, 'Runtime profile: production covers all release stores');
}

function testProfileResolution(): void {
  equal(
    resolveRuntimeProfile({ env: {} }).id,
    'local-dev',
    'Runtime profile: defaults to local-dev',
  );
  equal(
    resolveRuntimeProfile({
      env: { [ATTESTOR_RUNTIME_PROFILE_ENV]: ' single-node-durable ' },
    }).id,
    'single-node-durable',
    'Runtime profile: trims environment profile',
  );
  equal(
    resolveRuntimeProfile({
      env: {},
      defaultProfile: 'production-shared',
    }).id,
    'production-shared',
    'Runtime profile: explicit default profile is honored',
  );

  assert.throws(
    () => resolveRuntimeProfile({ env: { [ATTESTOR_RUNTIME_PROFILE_ENV]: 'prod' } }),
    RuntimeProfileConfigurationError,
    'Runtime profile: unsupported profile fails closed',
  );
  passed += 1;
}

function testCurrentStoreInventoryIsExplicit(): void {
  equal(
    CURRENT_RELEASE_RUNTIME_STORE_MODES['release-decision-log'],
    'file',
    'Runtime profile: durable decision log mode is explicit',
  );
  equal(
    CURRENT_RELEASE_RUNTIME_STORE_MODES['release-reviewer-queue'],
    'file',
    'Runtime profile: durable reviewer queue mode is explicit',
  );
  equal(
    CURRENT_RELEASE_RUNTIME_STORE_MODES['release-token-introspection'],
    'file',
    'Runtime profile: durable token introspection mode is explicit',
  );
  equal(
    CURRENT_RELEASE_RUNTIME_STORE_MODES['release-evidence-pack-store'],
    'file',
    'Runtime profile: durable evidence pack store mode is explicit',
  );
  equal(
    CURRENT_RELEASE_RUNTIME_STORE_MODES['release-degraded-mode-grants'],
    'file',
    'Runtime profile: degraded grants are file-backed',
  );
  equal(
    CURRENT_RELEASE_RUNTIME_STORE_MODES['policy-control-plane-store'],
    'file',
    'Runtime profile: policy store is file-backed',
  );
}

function testDurabilityEvaluation(): void {
  const localDev = resolveRuntimeProfile({ env: {} });
  const singleNode = resolveRuntimeProfile({
    env: { [ATTESTOR_RUNTIME_PROFILE_ENV]: 'single-node-durable' },
  });
  const production = resolveRuntimeProfile({
    env: { [ATTESTOR_RUNTIME_PROFILE_ENV]: 'production-shared' },
  });

  const localEvaluation = evaluateReleaseRuntimeDurability(localDev);
  equal(localEvaluation.ready, true, 'Runtime profile: current stores satisfy local-dev');
  equal(localEvaluation.violations.length, 0, 'Runtime profile: local-dev has no violations');
  includes(
    releaseRuntimeDurabilitySummary(localEvaluation),
    'requirements satisfied',
    'Runtime profile: summary names satisfied local profile',
  );

  const singleNodeEvaluation = evaluateReleaseRuntimeDurability(singleNode);
  equal(singleNodeEvaluation.ready, true, 'Runtime profile: current stores satisfy durable profile');
  equal(singleNodeEvaluation.violations.length, 0, 'Runtime profile: durable profile has no in-memory release authority stores');
  includes(
    releaseRuntimeDurabilitySummary(singleNodeEvaluation),
    'requirements satisfied',
    'Runtime profile: summary names satisfied durable profile',
  );

  const productionEvaluation = evaluateReleaseRuntimeDurability(production);
  equal(productionEvaluation.ready, false, 'Runtime profile: current stores do not satisfy production profile');
  equal(productionEvaluation.violations.length, 8, 'Runtime profile: production requires all shared stores');

  const sharedEvaluation = evaluateReleaseRuntimeDurability(production, allSharedModes());
  equal(sharedEvaluation.ready, true, 'Runtime profile: shared stores satisfy production profile');
}

function testDurabilityAssertionAndBootstrap(): void {
  const localDev = resolveRuntimeProfile({ env: {} });
  const production = resolveRuntimeProfile({
    env: { [ATTESTOR_RUNTIME_PROFILE_ENV]: 'production-shared' },
  });

  const localBootstrap = createReleaseRuntimeBootstrap({ runtimeProfile: localDev });
  equal(localBootstrap.runtimeProfile.id, 'local-dev', 'Runtime bootstrap: carries runtime profile');
  equal(localBootstrap.releaseRuntimeDurability.ready, true, 'Runtime bootstrap: local-dev starts');
  equal(
    localBootstrap.releaseRuntimeStoreModes['release-decision-log'],
    'memory',
    'Runtime bootstrap: local-dev keeps the decision log in memory for fast tests',
  );
  equal(
    localBootstrap.releaseRuntimeStoreModes['release-reviewer-queue'],
    'memory',
    'Runtime bootstrap: local-dev keeps the reviewer queue in memory for fast tests',
  );
  equal(
    localBootstrap.releaseRuntimeStoreModes['release-token-introspection'],
    'memory',
    'Runtime bootstrap: local-dev keeps token introspection in memory for fast tests',
  );
  equal(
    localBootstrap.releaseRuntimeStoreModes['release-evidence-pack-store'],
    'memory',
    'Runtime bootstrap: exposes current store mode inventory',
  );

  assert.throws(
    () => assertReleaseRuntimeDurability(production),
    RuntimeProfileDurabilityError,
    'Runtime profile: production assertion fails until shared stores exist',
  );
  passed += 1;

  assert.throws(
    () => createReleaseRuntimeBootstrap({ runtimeProfile: production }),
    RuntimeProfileDurabilityError,
    'Runtime bootstrap: production profile fails closed with current stores',
  );
  passed += 1;
}

function testDocsAndApiRuntimeAreWired(): void {
  const tracker = readProjectFile(
    'docs',
    '02-architecture',
    'production-runtime-hardening-buildout.md',
  );
  const readme = readProjectFile('README.md');
  const apiRouteRuntime = readProjectFile('src', 'service', 'bootstrap', 'api-route-runtime.ts');
  const releaseRuntime = readProjectFile('src', 'service', 'bootstrap', 'release-runtime.ts');
  const packageJson = JSON.parse(readProjectFile('package.json')) as {
    scripts: Record<string, string>;
  };

  includes(tracker, '# Production Runtime Hardening Buildout Tracker', 'Runtime docs: tracker exists');
  includes(tracker, '`local-dev`', 'Runtime docs: local-dev profile is documented');
  includes(tracker, '`single-node-durable`', 'Runtime docs: single-node profile is documented');
  includes(tracker, '`production-shared`', 'Runtime docs: production profile is documented');
  includes(tracker, '| 01 | complete | Add the runtime profile contract |', 'Runtime docs: Step 01 is complete');
  includes(readme, 'production-runtime-hardening-buildout.md', 'Runtime docs: README links hardening tracker');
  includes(apiRouteRuntime, 'resolveRuntimeProfile()', 'Runtime docs: API route runtime resolves profile');
  includes(apiRouteRuntime, 'releaseRuntimeDurabilitySummary', 'Runtime docs: API route runtime exposes summary');
  includes(releaseRuntime, 'assertReleaseRuntimeDurability', 'Runtime docs: release runtime asserts profile');
  includes(releaseRuntime, 'createFileBackedReleaseDecisionLogWriter', 'Runtime docs: release runtime can construct the durable decision log');
  includes(releaseRuntime, 'createFileBackedReleaseReviewerQueueStore', 'Runtime docs: release runtime can construct the durable reviewer queue');
  includes(releaseRuntime, 'createFileBackedReleaseTokenIntrospectionStore', 'Runtime docs: release runtime can construct durable token introspection');
  includes(packageJson.scripts.test, 'tsx tests/production-runtime-profile.test.ts', 'Runtime docs: npm test runs profile guard');
  includes(packageJson.scripts.verify, 'npm run test:production-runtime-profile', 'Runtime docs: verify runs profile guard');
}

testProfileCatalog();
testProfileResolution();
testCurrentStoreInventoryIsExplicit();
testDurabilityEvaluation();
testDurabilityAssertionAndBootstrap();
testDocsAndApiRuntimeAreWired();

console.log(`Production runtime profile tests: ${passed} passed, 0 failed`);
