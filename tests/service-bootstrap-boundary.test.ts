import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const API_SERVER = join(process.cwd(), 'src', 'service', 'api-server.ts');
const BOOTSTRAP_ROOT = join(process.cwd(), 'src', 'service', 'bootstrap');
const SERVICE_ROOT = join(process.cwd(), 'src', 'service');

function readProjectFile(...segments: string[]): string {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

function testApiServerUsesBootstrapComposition(): void {
  const apiServer = readFileSync(API_SERVER, 'utf8');
  const apiRouteRuntime = readFileSync(join(BOOTSTRAP_ROOT, 'api-route-runtime.ts'), 'utf8');

  assert.match(apiServer, /from '\.\/bootstrap\/registries\.js'/u);
  assert.match(apiServer, /from '\.\/bootstrap\/api-route-runtime\.js'/u);
  assert.doesNotMatch(apiServer, /from '\.\/bootstrap\/runtime\.js'/u);
  assert.match(apiRouteRuntime, /from '\.\/runtime\.js'/u);
  assert.match(apiServer, /from '\.\/bootstrap\/routes\.js'/u);
  assert.match(apiServer, /from '\.\/bootstrap\/server\.js'/u);
  assert.match(apiServer, /registerAllRoutes\(app, runtime\);/u);
}

function testApiServerDoesNotOwnNodeServerLifecycle(): void {
  const apiServer = readFileSync(API_SERVER, 'utf8');

  assert.doesNotMatch(apiServer, /from ['"]@hono\/node-server['"]/u);
  assert.doesNotMatch(apiServer, /serve\(\{\s*fetch:\s*app\.fetch/u);
  assert.doesNotMatch(apiServer, /configureTenantRuntimeBackends\(/u);
  assert.doesNotMatch(apiServer, /shutdownTenantRuntimeBackends\(/u);
}

function testApiServerStaysThinCompositionRoot(): void {
  const apiServer = readFileSync(API_SERVER, 'utf8');
  const lineCount = apiServer.split(/\r?\n/u).length;

  assert.ok(
    lineCount <= 120,
    `api-server.ts should stay a thin composition root; current line count is ${lineCount}`,
  );
  assert.doesNotMatch(apiServer, /build[A-Z][A-Za-z]+RouteDeps\(/u);
  assert.doesNotMatch(apiServer, /const [a-zA-Z]+RouteDeps\s*=/u);
}

function testApiServerDoesNotRegisterRoutesDirectly(): void {
  const apiServer = readFileSync(API_SERVER, 'utf8');

  for (const directRegistration of [
    'registerPublicSiteRoutes(app,',
    'registerCoreRoutes(app,',
    'registerAccountRoutes(app,',
    'registerAdminRoutes(app,',
    'registerReleaseReviewRoutes(app,',
    'registerReleasePolicyControlRoutes(app,',
    'registerWebhookRoutes(app,',
    'registerPipelineRoutes(app,',
  ]) {
    assert.equal(
      apiServer.includes(directRegistration),
      false,
      `api-server.ts should delegate ${directRegistration} through bootstrap/routes.ts`,
    );
  }
}

function testBootstrapModulesOwnTheirBoundaries(): void {
  const registries = readFileSync(join(BOOTSTRAP_ROOT, 'registries.ts'), 'utf8');
  const releaseRuntime = readFileSync(join(BOOTSTRAP_ROOT, 'release-runtime.ts'), 'utf8');
  const routes = readFileSync(join(BOOTSTRAP_ROOT, 'routes.ts'), 'utf8');
  const server = readFileSync(join(BOOTSTRAP_ROOT, 'server.ts'), 'utf8');
  const runtime = readFileSync(join(BOOTSTRAP_ROOT, 'runtime.ts'), 'utf8');
  const httpRouteBuilders = readFileSync(join(BOOTSTRAP_ROOT, 'http-route-builders.ts'), 'utf8');
  const apiRouteRuntime = readFileSync(join(BOOTSTRAP_ROOT, 'api-route-runtime.ts'), 'utf8');

  assert.match(registries, /export function createRegistries\(\): AppRegistries/u);
  assert.match(
    releaseRuntime,
    /export function createReleaseRuntimeBootstrap\(\s*input: CreateReleaseRuntimeBootstrapInput = \{\},\s*\): ReleaseRuntimeBootstrap/u,
  );
  assert.match(releaseRuntime, /export interface CreateReleaseRuntimeBootstrapInput/u);
  assert.match(routes, /export function registerAllRoutes<Packet>\(app: Hono, runtime: AppRuntime<Packet>\): void/u);
  assert.match(server, /export function startHttpServer\(app: Hono, port: number = 3700\): HttpServerHandle/u);
  assert.match(server, /export function installGracefulShutdown\(handle: HttpServerHandle\): void/u);
  assert.match(runtime, /export interface AppRuntime<Packet = unknown>/u);
  assert.match(runtime, /export function createRuntimeInfra\(input: CreateRuntimeInfraInput\): AppRuntimeInfra/u);
  assert.match(runtime, /export function createHttpRouteRuntime<Packet>/u);
  assert.match(httpRouteBuilders, /export function buildAccountRouteDeps/u);
  assert.match(httpRouteBuilders, /export function buildAdminRouteDeps/u);
  assert.match(httpRouteBuilders, /export function buildPipelineRouteDeps/u);
  assert.match(httpRouteBuilders, /export function buildWebhookRouteDeps/u);
  assert.match(apiRouteRuntime, /export function createApiHttpRouteRuntime/u);
}

function testRuntimeUsesStructuredComposition(): void {
  const apiServer = readFileSync(API_SERVER, 'utf8');
  const apiRouteRuntime = readFileSync(join(BOOTSTRAP_ROOT, 'api-route-runtime.ts'), 'utf8');
  const routes = readFileSync(join(BOOTSTRAP_ROOT, 'routes.ts'), 'utf8');
  const runtime = readFileSync(join(BOOTSTRAP_ROOT, 'runtime.ts'), 'utf8');

  assert.match(runtime, /export interface AppRuntimeInfra/u);
  assert.match(runtime, /export interface AppRuntimeServices<Packet = unknown>/u);
  assert.match(runtime, /infra: AppRuntimeInfra/u);
  assert.match(runtime, /stores: AppRuntimeStores/u);
  assert.match(runtime, /services: AppRuntimeServices<Packet>/u);
  assert.doesNotMatch(runtime, /routeDeps: AppRouteDeps/u);

  assert.match(routes, /runtime\.services\.httpRoutes\.publicSite/u);
  assert.match(routes, /runtime\.services\.httpRoutes\.account/u);
  assert.doesNotMatch(routes, /runtime\.routeDeps/u);

  assert.match(apiServer, /createApiHttpRouteRuntime\(\{/u);
  assert.doesNotMatch(apiServer, /createRuntimeInfra\(\{/u);
  assert.doesNotMatch(apiServer, /createHttpRouteRuntime\(\{/u);
  assert.doesNotMatch(apiServer, /httpRoutes:\s*\{/u);
  assert.match(apiRouteRuntime, /createRuntimeInfra\(\{/u);
  assert.match(apiRouteRuntime, /createHttpRouteRuntime\(\{/u);
  assert.match(apiRouteRuntime, /httpRoutes:\s*\{/u);
  assert.doesNotMatch(apiServer, /routeDeps:\s*\{/u);
}

function testRegistriesOwnStaticPlatformRegistration(): void {
  const apiServer = readFileSync(API_SERVER, 'utf8');
  const registries = readProjectFile('src', 'service', 'bootstrap', 'registries.ts');

  for (const platformRegistration of [
    'financeDomainPack',
    'healthcareDomainPack',
    'snowflakeConnector',
    'xbrlUsGaapAdapter',
    'xbrlCsvEbaAdapter',
  ]) {
    assert.equal(
      apiServer.includes(platformRegistration),
      false,
      `api-server.ts should not own ${platformRegistration} static registration`,
    );
    assert.equal(
      registries.includes(platformRegistration),
      true,
      `bootstrap/registries.ts should own ${platformRegistration} static registration`,
    );
  }
}

function testHttpRouteBuildersOwnApplicationServiceConstruction(): void {
  const apiServer = readFileSync(API_SERVER, 'utf8');
  const apiRouteRuntime = readProjectFile('src', 'service', 'bootstrap', 'api-route-runtime.ts');
  const httpRouteBuilders = readProjectFile('src', 'service', 'bootstrap', 'http-route-builders.ts');

  assert.doesNotMatch(apiServer, /from '\.\/bootstrap\/http-route-builders\.js'/u);
  assert.match(apiRouteRuntime, /from '\.\/http-route-builders\.js'/u);

  for (const serviceFactory of [
    'createAccountAuthService',
    'createAccountApiKeyService',
    'createAccountUserManagementService',
    'createAccountStateService',
    'createAdminMutationService',
    'createAdminControlService',
    'createAdminQueryService',
    'createPipelineUsageService',
    'createPipelineDeadLetterService',
    'createStripeWebhookService',
    'createStripeWebhookBillingProcessor',
    'createEmailWebhookService',
  ]) {
    assert.equal(
      apiServer.includes(`${serviceFactory}(`),
      false,
      `api-server.ts should delegate ${serviceFactory} wiring through bootstrap/http-route-builders.ts`,
    );
    assert.equal(
      httpRouteBuilders.includes(`${serviceFactory}(`),
      true,
      `bootstrap/http-route-builders.ts should own ${serviceFactory} wiring`,
    );
  }

  for (const routeDepsConstant of [
    'const publicSiteRouteDeps =',
    'const coreRouteDeps =',
    'const accountRouteDeps =',
    'const adminRouteDeps =',
    'const releaseReviewRouteDeps =',
    'const releasePolicyControlRouteDeps =',
    'const pipelineRouteDeps =',
    'const webhookRouteDeps =',
  ]) {
    assert.equal(
      apiServer.includes(routeDepsConstant),
      false,
      `api-server.ts should not build ${routeDepsConstant} directly`,
    );
  }
}

function testReleaseRuntimeBootstrapOwnsReleaseSetup(): void {
  const apiServer = readFileSync(API_SERVER, 'utf8');
  const apiRouteRuntime = readProjectFile('src', 'service', 'bootstrap', 'api-route-runtime.ts');
  const releaseRuntime = readProjectFile('src', 'service', 'bootstrap', 'release-runtime.ts');

  assert.doesNotMatch(apiServer, /from '\.\/bootstrap\/release-runtime\.js'/u);
  assert.doesNotMatch(apiServer, /createReleaseRuntimeBootstrap\(\)/u);
  assert.match(apiRouteRuntime, /from '\.\/release-runtime\.js'/u);
  assert.match(apiRouteRuntime, /createReleaseRuntimeBootstrap\(\{ runtimeProfile \}\)/u);
  assert.match(apiRouteRuntime, /resolveRuntimeProfile\(\)/u);
  assert.match(apiRouteRuntime, /releaseRuntimeDurabilitySummary/u);

  for (const releaseFactory of [
    'generatePkiHierarchy(',
    'createInMemoryReleaseDecisionLogWriter(',
    'createInMemoryReleaseReviewerQueueStore(',
    'createInMemoryReleaseTokenIntrospectionStore(',
    'createReleaseTokenIntrospector(',
    'createReleaseTokenIssuer(',
    'createInMemoryReleaseEvidencePackStore(',
    'createReleaseEvidencePackIssuer(',
    'createFileBackedDegradedModeGrantStore(',
    'createFileBackedPolicyControlPlaneStore(',
    'createFileBackedPolicyActivationApprovalStore(',
    'createFileBackedPolicyMutationAuditLogWriter(',
    'createFinanceControlPlaneReleaseDecisionEngine(',
    'createShadowModeReleaseEvaluator(',
    'ensureFinanceProvingPolicies(',
  ]) {
    assert.equal(
      apiServer.includes(releaseFactory),
      false,
      `api-server.ts should delegate ${releaseFactory} through bootstrap/release-runtime.ts`,
    );
    assert.equal(
      releaseRuntime.includes(releaseFactory),
      true,
      `bootstrap/release-runtime.ts should own ${releaseFactory}`,
    );
  }
}

function testApiServerUsesExtractedRouteSupport(): void {
  const apiServer = readFileSync(API_SERVER, 'utf8');
  const apiRouteRuntime = readProjectFile('src', 'service', 'bootstrap', 'api-route-runtime.ts');
  const accountRouteSupport = readFileSync(
    join(SERVICE_ROOT, 'account-route-support.ts'),
    'utf8',
  );
  const hostedSurfaceSupport = readFileSync(
    join(SERVICE_ROOT, 'hosted-surface-support.ts'),
    'utf8',
  );
  const hostedAccountSupport = readFileSync(
    join(SERVICE_ROOT, 'hosted-account-support.ts'),
    'utf8',
  );
  const financeReleaseRouteSupport = readFileSync(
    join(SERVICE_ROOT, 'finance-release-route-support.ts'),
    'utf8',
  );
  const pipelineRouteSupport = readFileSync(
    join(SERVICE_ROOT, 'pipeline-route-support.ts'),
    'utf8',
  );
  const requestContext = readFileSync(join(SERVICE_ROOT, 'request-context.ts'), 'utf8');
  const requestObservabilityMiddleware = readFileSync(
    join(SERVICE_ROOT, 'request-observability-middleware.ts'),
    'utf8',
  );
  const siteSupport = readFileSync(join(SERVICE_ROOT, 'site-support.ts'), 'utf8');
  const stripeWebhookSupport = readFileSync(
    join(SERVICE_ROOT, 'stripe-webhook-support.ts'),
    'utf8',
  );

  assert.match(apiRouteRuntime, /from '\.\.\/account-route-support\.js'/u);
  assert.match(apiRouteRuntime, /from '\.\.\/hosted-surface-support\.js'/u);
  assert.match(apiRouteRuntime, /from '\.\.\/hosted-account-support\.js'/u);
  assert.match(apiRouteRuntime, /from '\.\.\/finance-release-route-support\.js'/u);
  assert.match(apiRouteRuntime, /from '\.\.\/pipeline-route-support\.js'/u);
  assert.match(apiRouteRuntime, /from '\.\.\/request-context\.js'/u);
  assert.match(apiServer, /from '\.\/request-observability-middleware\.js'/u);
  assert.match(apiRouteRuntime, /from '\.\.\/site-support\.js'/u);
  assert.match(apiRouteRuntime, /from '\.\.\/stripe-webhook-support\.js'/u);

  for (const helperName of [
    'function accountStoreErrorResponse(',
    'function accountUserView(',
    'function accountUserDetailedMfaView(',
    'function accountUserDetailedOidcView(',
    'function accountUserDetailedSamlView(',
    'function accountUserDetailedPasskeyView(',
    'function accountPasskeyCredentialView(',
    'function accountUserActionTokenView(',
    'function parsePasskeyRegistrationChallenge(',
    'function parsePasskeyAuthenticationChallenge(',
    'function normalizePasskeyAuthenticatorHint(',
    'function asRegistrationResponse(',
    'function asAuthenticationResponse(',
    'function deriveSignupTenantId(',
    'function adminTenantKeyView(',
    'function accountApiKeyView(',
    'function adminAccountView(',
    'function adminPlanView(',
    'function billingEntitlementView(',
    'function schemaAttestationSummaryFromFull(',
    'function schemaAttestationSummaryFromConnector(',
    'function applyRateLimitHeaders(',
    'function adminAuditView(',
    'function billingEventView(',
    'function createRequestSigners(',
    'function currentTenant(',
    'function currentAccountAccess(',
    'function currentAccountRole(',
    'function currentReleaseRequester(',
    'function currentReleaseEvaluationContext(',
    'function setSessionCookieForRecord(',
    'function requireAccountSession(',
    'function currentAdminAuthorized(',
    'function currentMetricsAuthorized(',
    'function constantTimeSecretEquals(',
    "app.use('/api/*', async (",
    'beginRequestTrace(',
    'observeRequestStart(',
    'observeRequestComplete(',
    'completeRequestTrace(',
    'appendStructuredRequestLog(',
    'function accountMfaErrorResponse(',
    'function stripeBillingErrorResponse(',
    'function committedEvidenceContentType(',
    'function readCommittedEvidence(',
    'loadCommittedFinancialReportingPacket(',
    'financialReportingEvidenceRoot(',
    "from '../release-layer/index.js'",
    "from '../release-layer/finance.js'",
    '} = financeCommunicationRelease;',
    '} = financeActionRelease;',
    '} = financeRecordRelease;',
    'async function currentHostedAccount(',
    'async function projectBillingEntitlementForAccount(',
    'async function readHostedBillingEntitlement(',
    'async function syncHostedBillingEntitlement(',
    'async function syncHostedBillingEntitlementForTenant(',
    'async function findHostedAccountByStripeRefs(',
    'async function revokeAccountSessionsForLifecycleChange(',
    'function stripeClient(',
    'function parseStripeInvoiceStatus(',
    'function parseStripeChargeStatus(',
    'function metadataStringValue(',
    'function stripeReferenceId(',
    'function unixSecondsToIso(',
    'function stripeInvoicePriceId(',
  ]) {
    assert.equal(
      apiServer.includes(helperName),
      false,
      `api-server.ts should not define ${helperName} inline`,
    );
  }

  for (const accountHelper of [
    'export function accountUserView(',
    'export function accountUserDetailedMfaView(',
    'export function accountUserDetailedOidcView(',
    'export function accountUserDetailedSamlView(',
    'export function accountUserDetailedPasskeyView(',
    'export function accountPasskeyCredentialView(',
    'export function accountUserActionTokenView(',
    'export function parsePasskeyRegistrationChallenge(',
    'export function parsePasskeyAuthenticationChallenge(',
    'export function normalizePasskeyAuthenticatorHint(',
    'export function asRegistrationResponse(',
    'export function asAuthenticationResponse(',
    'export function deriveSignupTenantId(',
  ]) {
    assert.equal(
      accountRouteSupport.includes(accountHelper),
      true,
      `account-route-support.ts should own ${accountHelper}`,
    );
  }

  for (const hostedHelper of [
    'export function adminTenantKeyView(',
    'export function accountApiKeyView(',
    'export function adminAccountView(',
    'export function adminPlanView(',
    'export function billingEntitlementView(',
    'export function adminAuditView(',
    'export function billingEventView(',
  ]) {
    assert.equal(
      hostedSurfaceSupport.includes(hostedHelper),
      true,
      `hosted-surface-support.ts should own ${hostedHelper}`,
    );
  }

  for (const hostedAccountHelper of [
    'export function accountMfaErrorResponse(',
    'export function stripeBillingErrorResponse(',
    'export function createHostedAccountSupport(',
    'async function currentHostedAccount(',
    'async function projectBillingEntitlementForAccount(',
    'async function readHostedBillingEntitlement(',
    'async function syncHostedBillingEntitlement(',
    'async function syncHostedBillingEntitlementForTenant(',
    'async function findHostedAccountByStripeRefs(',
    'async function revokeAccountSessionsForLifecycleChange(',
  ]) {
    assert.equal(
      hostedAccountSupport.includes(hostedAccountHelper),
      true,
      `hosted-account-support.ts should own ${hostedAccountHelper}`,
    );
  }

  for (const financeReleaseHelper of [
    'export const {',
    'buildFinanceCommunicationReleaseMaterial',
    'buildFinanceActionReleaseMaterial',
    'buildFinanceFilingReleaseMaterial',
    'createFinanceReviewerQueueItem',
    'resolveReleaseTokenFromRequest',
    'verifyReleaseAuthorization',
  ]) {
    assert.equal(
      financeReleaseRouteSupport.includes(financeReleaseHelper),
      true,
      `finance-release-route-support.ts should own ${financeReleaseHelper}`,
    );
  }

  for (const pipelineHelper of [
    'export function schemaAttestationSummaryFromFull(',
    'export function schemaAttestationSummaryFromConnector(',
    'export function applyRateLimitHeaders(',
  ]) {
    assert.equal(
      pipelineRouteSupport.includes(pipelineHelper),
      true,
      `pipeline-route-support.ts should own ${pipelineHelper}`,
    );
  }

  for (const requestHelper of [
    'export function createRequestSigners(',
    'export function currentTenant(',
    'export function currentAccountAccess(',
    'export function currentAccountRole(',
    'export function currentReleaseRequester(',
    'export function currentReleaseEvaluationContext(',
    'export function setSessionCookieForRecord(',
    'export function requireAccountSession(',
    'export function currentAdminAuthorized(',
    'export function currentMetricsAuthorized(',
    'export function constantTimeSecretEquals(',
  ]) {
    assert.equal(
      requestContext.includes(requestHelper),
      true,
      `request-context.ts should own ${requestHelper}`,
    );
  }

  for (const requestObservabilityHelper of [
    'export function createRequestObservabilityMiddleware(',
    'function remoteAddressFromHeaders(',
    'beginRequestTrace(',
    'observeRequestStart(',
    'observeRequestComplete(',
    'completeRequestTrace(',
    'appendStructuredRequestLog(',
  ]) {
    assert.equal(
      requestObservabilityMiddleware.includes(requestObservabilityHelper),
      true,
      `request-observability-middleware.ts should own ${requestObservabilityHelper}`,
    );
  }

  for (const siteHelper of [
    'export function committedEvidenceContentType(',
    'export function readCommittedEvidence(',
    'export const committedFinancialPacket = loadCommittedFinancialReportingPacket();',
  ]) {
    assert.equal(
      siteSupport.includes(siteHelper),
      true,
      `site-support.ts should own ${siteHelper}`,
    );
  }

  for (const stripeHelper of [
    'export function stripeClient(',
    'export function parseStripeInvoiceStatus(',
    'export function parseStripeChargeStatus(',
    'export function metadataStringValue(',
    'export function stripeReferenceId(',
    'export function unixSecondsToIso(',
    'export function stripeInvoicePriceId(',
  ]) {
    assert.equal(
      stripeWebhookSupport.includes(stripeHelper),
      true,
      `stripe-webhook-support.ts should own ${stripeHelper}`,
    );
  }
}

testApiServerUsesBootstrapComposition();
testApiServerDoesNotOwnNodeServerLifecycle();
testApiServerStaysThinCompositionRoot();
testApiServerDoesNotRegisterRoutesDirectly();
testBootstrapModulesOwnTheirBoundaries();
testRuntimeUsesStructuredComposition();
testRegistriesOwnStaticPlatformRegistration();
testHttpRouteBuildersOwnApplicationServiceConstruction();
testReleaseRuntimeBootstrapOwnsReleaseSetup();
testApiServerUsesExtractedRouteSupport();

console.log('Service bootstrap boundary tests: 10 passed, 0 failed');
