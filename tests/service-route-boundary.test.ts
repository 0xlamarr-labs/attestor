import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROUTE_ROOT = join(process.cwd(), 'src', 'service', 'http', 'routes');

function collectRouteFiles(root: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(root)) {
    const fullPath = join(root, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      results.push(...collectRouteFiles(fullPath));
      continue;
    }
    if (fullPath.endsWith('.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll('\\', '/').replace(`${process.cwd().replaceAll('\\', '/')}/`, '');
}

function testReleaseReviewRouteIsStronglyTyped(): void {
  const releaseReviewRoute = readFileSync(
    join(ROUTE_ROOT, 'release-review-routes.ts'),
    'utf8',
  );

  assert.doesNotMatch(releaseReviewRoute, /type RouteDependency = any/u);
  assert.doesNotMatch(releaseReviewRoute, /:\s*any\b/u);
  assert.doesNotMatch(releaseReviewRoute, /\bas any\b/u);
  assert.match(releaseReviewRoute, /ReleaseReviewRouteDeps/u);
  assert.match(releaseReviewRoute, /ReleaseReviewerQueueStore/u);
  assert.match(releaseReviewRoute, /ReleaseDecisionLogWriter/u);
}

function testRemainingRouteAnyDebtIsExplicit(): void {
  const offenders = collectRouteFiles(ROUTE_ROOT)
    .filter((filePath) => readFileSync(filePath, 'utf8').includes('type RouteDependency = any'))
    .map(normalizePath)
    .sort();

  assert.deepEqual(offenders, [
    'src/service/http/routes/account-routes.ts',
    'src/service/http/routes/admin-routes.ts',
    'src/service/http/routes/pipeline-routes.ts',
    'src/service/http/routes/webhook-routes.ts',
  ]);
}

function testReleaseReviewRouteUsesPublicReleaseLayerTypes(): void {
  const releaseReviewRoute = readFileSync(
    join(ROUTE_ROOT, 'release-review-routes.ts'),
    'utf8',
  );

  assert.match(releaseReviewRoute, /from '..\/..\/..\/release-layer\/index\.js'/u);
  assert.doesNotMatch(releaseReviewRoute, /release-kernel\//u);
}

testReleaseReviewRouteIsStronglyTyped();
testRemainingRouteAnyDebtIsExplicit();
testReleaseReviewRouteUsesPublicReleaseLayerTypes();

console.log('Service route boundary tests: 3 passed, 0 failed');
