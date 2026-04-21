import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROUTE_ROOT = join(process.cwd(), 'src', 'service', 'http', 'routes');

function readProjectFile(...segments: string[]): string {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

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

function testAllServiceRoutesHaveClosedAnyDebt(): void {
  const offenders = collectRouteFiles(ROUTE_ROOT)
    .filter((filePath) => readFileSync(filePath, 'utf8').includes('type RouteDependency = any'))
    .map(normalizePath)
    .sort();

  assert.deepEqual(offenders, []);
}

function testDirectStoreRouteDebtIsExplicitlyBounded(): void {
  const offenders = collectRouteFiles(ROUTE_ROOT)
    .filter((filePath) => readFileSync(filePath, 'utf8').includes("control-plane-store.js"))
    .map(normalizePath)
    .sort();

  assert.deepEqual(offenders, [
    'src/service/http/routes/account-routes.ts',
    'src/service/http/routes/admin-routes.ts',
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
  assert.doesNotMatch(stripeWebhookRoute, /type RouteDependency = any/u);
  assert.doesNotMatch(stripeWebhookRoute, /:\s*any\b/u);
  assert.doesNotMatch(stripeWebhookRoute, /\bas any\b/u);
}

function testStripeWebhookRouteDelegatesIngressUseCase(): void {
  const stripeWebhookRoute = readFileSync(join(ROUTE_ROOT, 'stripe-webhook-routes.ts'), 'utf8');
  const stripeWebhookService = readProjectFile('src', 'service', 'application', 'stripe-webhook-service.ts');
  const stripeWebhookBillingProcessor = readProjectFile(
    'src',
    'service',
    'application',
    'stripe-webhook-billing-processor.ts',
  );

  assert.match(stripeWebhookRoute, /stripeWebhookService: StripeWebhookService/u);
  assert.match(stripeWebhookRoute, /stripeWebhookBillingProcessor: StripeWebhookBillingProcessor/u);
  assert.match(stripeWebhookRoute, /stripeWebhookService\.begin/u);
  assert.match(stripeWebhookRoute, /stripeWebhookBillingProcessor\.process/u);
  assert.doesNotMatch(stripeWebhookRoute, /claimStripeBillingEvent/u);
  assert.doesNotMatch(stripeWebhookRoute, /claimProcessedStripeWebhookState/u);
  assert.doesNotMatch(stripeWebhookRoute, /lookupProcessedStripeWebhookState/u);
  assert.doesNotMatch(stripeWebhookRoute, /finalizeProcessedStripeWebhookState/u);
  assert.doesNotMatch(stripeWebhookRoute, /recordProcessedStripeWebhookState/u);
  assert.doesNotMatch(stripeWebhookRoute, /releaseProcessedStripeWebhookClaimState/u);
  assert.doesNotMatch(stripeWebhookRoute, /applyStripeSubscriptionStateState/u);
  assert.doesNotMatch(stripeWebhookRoute, /appendAdminAuditRecordState/u);
  assert.doesNotMatch(stripeWebhookRoute, /billing-event-ledger/u);
  assert.doesNotMatch(stripeWebhookRoute, /control-plane-store/u);

  assert.match(stripeWebhookService, /export interface StripeWebhookService/u);
  assert.match(stripeWebhookService, /begin\(input: StripeWebhookBeginInput\)/u);
  assert.match(stripeWebhookService, /releaseClaim\(\)/u);
  assert.match(stripeWebhookBillingProcessor, /export interface StripeWebhookBillingProcessor/u);
  assert.match(stripeWebhookBillingProcessor, /process\(stripeWebhook: StripeWebhookProcessingHandle\)/u);
  assert.match(stripeWebhookBillingProcessor, /accountStoreErrorResponse/u);
}

function testStripeWebhookBillingProcessorUsesNamedEventProcessors(): void {
  const stripeWebhookBillingProcessor = readProjectFile(
    'src',
    'service',
    'application',
    'stripe-webhook-billing-processor.ts',
  );

  assert.match(stripeWebhookBillingProcessor, /async function processUnsupportedEvent/u);
  assert.match(stripeWebhookBillingProcessor, /async function processSubscriptionEvent/u);
  assert.match(stripeWebhookBillingProcessor, /async function processCheckoutCompletedEvent/u);
  assert.match(stripeWebhookBillingProcessor, /async function processChargeEvent/u);
  assert.match(stripeWebhookBillingProcessor, /async function processEntitlementSummaryEvent/u);
  assert.match(stripeWebhookBillingProcessor, /async function processInvoiceEvent/u);
  assert.match(stripeWebhookBillingProcessor, /return processSubscriptionEvent\(stripeWebhook, c\);/u);
  assert.match(stripeWebhookBillingProcessor, /return processCheckoutCompletedEvent\(stripeWebhook, c\);/u);
  assert.match(stripeWebhookBillingProcessor, /return processChargeEvent\(stripeWebhook, c\);/u);
  assert.match(stripeWebhookBillingProcessor, /return processEntitlementSummaryEvent\(stripeWebhook, c\);/u);
  assert.match(stripeWebhookBillingProcessor, /return processInvoiceEvent\(stripeWebhook, c\);/u);
}

function testAdminRouteIsStronglyTyped(): void {
  const adminRoute = readFileSync(join(ROUTE_ROOT, 'admin-routes.ts'), 'utf8');

  assert.match(adminRoute, /export interface AdminRouteDeps/u);
  assert.doesNotMatch(adminRoute, /type RouteDependency = any/u);
  assert.doesNotMatch(adminRoute, /:\s*any\b/u);
  assert.doesNotMatch(adminRoute, /\bas any\b/u);
}

function testAdminRouteDelegatesMutationUseCase(): void {
  const adminRoute = readFileSync(join(ROUTE_ROOT, 'admin-routes.ts'), 'utf8');
  const adminMutationService = readProjectFile('src', 'service', 'application', 'admin-mutation-service.ts');

  assert.match(adminRoute, /adminMutationService: AdminMutationService/u);
  assert.match(adminRoute, /adminMutationService\.begin/u);
  assert.match(adminRoute, /adminMutationService\.finalize/u);
  assert.doesNotMatch(adminRoute, /adminMutationRequest/u);
  assert.doesNotMatch(adminRoute, /finalizeAdminMutation/u);

  assert.match(adminMutationService, /export interface AdminMutationService/u);
  assert.match(adminMutationService, /begin\(input: AdminMutationBeginInput\)/u);
  assert.match(adminMutationService, /finalize\(input: AdminMutationFinalizationInput\)/u);
}

function testAccountRouteIsStronglyTyped(): void {
  const accountRoute = readFileSync(join(ROUTE_ROOT, 'account-routes.ts'), 'utf8');

  assert.match(accountRoute, /export interface AccountRouteDeps/u);
  assert.doesNotMatch(accountRoute, /type RouteDependency = any/u);
  assert.doesNotMatch(accountRoute, /:\s*any\b/u);
  assert.doesNotMatch(accountRoute, /\bas any\b/u);
}

function testAccountRouteDelegatesAuthUseCases(): void {
  const accountRoute = readFileSync(join(ROUTE_ROOT, 'account-routes.ts'), 'utf8');
  const accountAuthService = readProjectFile('src', 'service', 'application', 'account-auth-service.ts');

  assert.match(accountRoute, /authService: AccountAuthService/u);
  assert.match(accountRoute, /authService\.bootstrapFirstUser/u);
  assert.match(accountRoute, /authService\.signup/u);
  assert.match(accountRoute, /authService\.login/u);
  assert.doesNotMatch(accountRoute, /countAccountUsersForAccountState/u);
  assert.doesNotMatch(accountRoute, /provisionHostedAccountState/u);
  assert.doesNotMatch(accountRoute, /deriveSignupTenantId/u);

  assert.match(accountAuthService, /export interface AccountAuthService/u);
  assert.match(accountAuthService, /bootstrapFirstUser/u);
  assert.match(accountAuthService, /signup/u);
  assert.match(accountAuthService, /login/u);
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
testAllServiceRoutesHaveClosedAnyDebt();
testDirectStoreRouteDebtIsExplicitlyBounded();
testReleaseReviewRouteUsesPublicReleaseLayerTypes();
testWebhookRoutesAreSplitByProviderBoundary();
testStripeWebhookRouteDelegatesIngressUseCase();
testStripeWebhookBillingProcessorUsesNamedEventProcessors();
testAdminRouteIsStronglyTyped();
testAdminRouteDelegatesMutationUseCase();
testAccountRouteIsStronglyTyped();
testAccountRouteDelegatesAuthUseCases();
testPipelineRoutesAreSplitByUseCaseBoundary();

console.log('Service route boundary tests: 12 passed, 0 failed');
