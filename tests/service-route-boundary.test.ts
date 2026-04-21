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
    'src/service/http/routes/stripe-webhook-routes.ts',
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

function testWebhookRoutesAreSplitByProviderBoundary(): void {
  const webhookRoute = readFileSync(join(ROUTE_ROOT, 'webhook-routes.ts'), 'utf8');
  const emailWebhookRoute = readFileSync(join(ROUTE_ROOT, 'email-webhook-routes.ts'), 'utf8');
  const stripeWebhookRoute = readFileSync(join(ROUTE_ROOT, 'stripe-webhook-routes.ts'), 'utf8');

  assert.match(webhookRoute, /registerEmailWebhookRoutes\(app, deps\);/u);
  assert.match(webhookRoute, /registerStripeWebhookRoutes\(app, deps\);/u);
  assert.doesNotMatch(webhookRoute, /type RouteDependency = any/u);

  assert.match(emailWebhookRoute, /export interface EmailWebhookRouteDeps/u);
  assert.doesNotMatch(emailWebhookRoute, /type RouteDependency = any/u);
  assert.doesNotMatch(emailWebhookRoute, /:\s*any\b/u);
  assert.doesNotMatch(emailWebhookRoute, /\bas any\b/u);

  assert.match(stripeWebhookRoute, /export interface StripeWebhookRouteDeps/u);
}

function testPipelineRoutesAreSplitByUseCaseBoundary(): void {
  const pipelineRoute = readFileSync(join(ROUTE_ROOT, 'pipeline-routes.ts'), 'utf8');

  assert.match(pipelineRoute, /registerPipelineExecutionRoutes\(app, deps\);/u);
  assert.match(pipelineRoute, /registerPipelineVerificationRoutes\(app, deps\);/u);
  assert.match(pipelineRoute, /registerPipelineFilingRoutes\(app, deps\);/u);
  assert.match(pipelineRoute, /registerPipelineAsyncRoutes\(app, deps\);/u);
  assert.doesNotMatch(pipelineRoute, /type RouteDependency = any/u);

  const verificationRoute = readFileSync(
    join(ROUTE_ROOT, 'pipeline-verification-routes.ts'),
    'utf8',
  );
  assert.match(verificationRoute, /export interface PipelineVerificationRoutesDeps/u);
  assert.doesNotMatch(verificationRoute, /type RouteDependency = any/u);
  assert.doesNotMatch(verificationRoute, /:\s*any\b/u);
  assert.doesNotMatch(verificationRoute, /\bas any\b/u);

  const filingRoute = readFileSync(join(ROUTE_ROOT, 'pipeline-filing-routes.ts'), 'utf8');
  assert.match(filingRoute, /export interface PipelineFilingRoutesDeps/u);
  assert.doesNotMatch(filingRoute, /type RouteDependency = any/u);
  assert.doesNotMatch(filingRoute, /:\s*any\b/u);
  assert.doesNotMatch(filingRoute, /\bas any\b/u);

  const asyncRoute = readFileSync(join(ROUTE_ROOT, 'pipeline-async-routes.ts'), 'utf8');
  assert.match(asyncRoute, /export interface PipelineAsyncRoutesDeps/u);
  assert.doesNotMatch(asyncRoute, /type RouteDependency = any/u);
  assert.doesNotMatch(asyncRoute, /:\s*any\b/u);
  assert.doesNotMatch(asyncRoute, /\bas any\b/u);

  const executionRoute = readFileSync(join(ROUTE_ROOT, 'pipeline-execution-routes.ts'), 'utf8');
  assert.match(executionRoute, /export interface PipelineExecutionRoutesDeps/u);
  assert.doesNotMatch(executionRoute, /type RouteDependency = any/u);
  assert.doesNotMatch(executionRoute, /:\s*any\b/u);
  assert.doesNotMatch(executionRoute, /\bas any\b/u);
}

testReleaseReviewRouteIsStronglyTyped();
testRemainingRouteAnyDebtIsExplicit();
testReleaseReviewRouteUsesPublicReleaseLayerTypes();
testWebhookRoutesAreSplitByProviderBoundary();
testPipelineRoutesAreSplitByUseCaseBoundary();

console.log('Service route boundary tests: 5 passed, 0 failed');
