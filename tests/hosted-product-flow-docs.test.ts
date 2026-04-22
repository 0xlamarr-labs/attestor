import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0;

function readProjectFile(...segments: string[]): string {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function includes(content: string, expected: string, message: string): void {
  assert.ok(
    content.includes(expected),
    `${message}\nExpected to find: ${expected}`,
  );
  passed += 1;
}

function testCommercialTruthSourcesStayLinked(): void {
  const readme = readProjectFile('README.md');
  const packaging = readProjectFile('docs', '01-overview', 'product-packaging.md');
  const journey = readProjectFile('docs', '01-overview', 'hosted-customer-journey.md');
  const contract = readProjectFile('docs', '01-overview', 'hosted-journey-contract.md');
  const firstApiCall = readProjectFile('docs', '01-overview', 'hosted-first-api-call.md');
  const firstIntegrations = readProjectFile('docs', '01-overview', 'finance-and-crypto-first-integrations.md');
  const stripeBootstrap = readProjectFile('docs', '01-overview', 'stripe-commercial-bootstrap.md');

  includes(
    readme,
    'docs/01-overview/product-packaging.md',
    'Hosted product flow docs: README links to pricing truth source',
  );
  includes(
    readme,
    'docs/01-overview/hosted-customer-journey.md',
    'Hosted product flow docs: README links to hosted customer journey',
  );
  includes(
    readme,
    'docs/01-overview/hosted-first-api-call.md',
    'Hosted product flow docs: README links to first hosted API-call quickstart',
  );
  includes(
    readme,
    'docs/01-overview/finance-and-crypto-first-integrations.md',
    'Hosted product flow docs: README links to first finance/crypto integration examples',
  );
  includes(
    packaging,
    'This document is the commercial truth source',
    'Hosted product flow docs: product packaging owns commercial truth',
  );
  includes(
    journey,
    'use [Commercial packaging, pricing, and evaluation](product-packaging.md) as the source of truth',
    'Hosted product flow docs: hosted journey points pricing back to product packaging',
  );
  includes(
    journey,
    'Hosted journey contract](hosted-journey-contract.md)',
    'Hosted product flow docs: hosted journey links to canonical journey contract',
  );
  includes(
    journey,
    'First hosted API call](hosted-first-api-call.md)',
    'Hosted product flow docs: hosted journey links to first API-call quickstart',
  );
  includes(
    journey,
    'Finance and crypto first integrations](finance-and-crypto-first-integrations.md)',
    'Hosted product flow docs: hosted journey links to first integration examples',
  );
  includes(
    packaging,
    'Hosted journey contract](hosted-journey-contract.md)',
    'Hosted product flow docs: product packaging links to canonical journey contract',
  );
  includes(
    contract,
    'This is the canonical customer journey contract',
    'Hosted product flow docs: contract doc declares canonical role',
  );
  includes(
    contract,
    'First hosted API call](hosted-first-api-call.md)',
    'Hosted product flow docs: contract doc links first API-call quickstart',
  );
  includes(
    contract,
    'Finance and crypto first integrations](finance-and-crypto-first-integrations.md)',
    'Hosted product flow docs: contract doc links first integration examples',
  );
  includes(
    firstApiCall,
    'This quickstart shows the first customer-owned API call after hosted signup.',
    'Hosted product flow docs: first API-call quickstart declares its scope',
  );
  includes(
    firstIntegrations,
    'Finance and crypto are modular packs on the same Attestor platform core.',
    'Hosted product flow docs: first integration examples preserve one-product pack framing',
  );
  includes(
    stripeBootstrap,
    'operator-facing and should not become a second public pricing page',
    'Hosted product flow docs: Stripe bootstrap stays operator-facing',
  );
}

function testFinanceAndCryptoFirstIntegrationsStayGrounded(): void {
  const examples = readProjectFile('docs', '01-overview', 'finance-and-crypto-first-integrations.md');
  const contract = readProjectFile('src', 'service', 'hosted-journey-contract.ts');
  const packageJson = readProjectFile('package.json');
  const pipelineRoute = readProjectFile('src', 'service', 'http', 'routes', 'pipeline-execution-routes.ts');
  const cryptoAdmission = readProjectFile('src', 'crypto-execution-admission', 'index.ts');
  const cryptoAuthorization = readProjectFile('src', 'crypto-authorization-core', 'index.ts');

  includes(examples, 'same Attestor adoption model', 'Hosted first integrations: shared model is explicit');
  includes(examples, 'Finance is the deepest proven path today.', 'Hosted first integrations: finance proof wedge is explicit');
  includes(examples, '`POST /api/v1/pipeline/run`', 'Hosted first integrations: finance uses shipped hosted pipeline route');
  includes(examples, '`Authorization: Bearer <tenant_api_key>`', 'Hosted first integrations: finance auth boundary is explicit');
  includes(examples, '`attestor/crypto-authorization-core`', 'Hosted first integrations: crypto authorization package is named');
  includes(examples, '`attestor/crypto-execution-admission`', 'Hosted first integrations: crypto admission package is named');
  includes(examples, 'not a new hosted HTTP route', 'Hosted first integrations: crypto route overclaim is blocked');
  includes(examples, 'Do not describe crypto as generally available through a public hosted route', 'Hosted first integrations: public crypto HTTP route guardrail is explicit');
  includes(examples, 'createCryptoExecutionAdmissionPlan', 'Hosted first integrations: crypto admission planner function is named');
  includes(examples, 'cryptoExecutionAdmissionAdapterProfile', 'Hosted first integrations: crypto adapter profile function is named');
  includes(examples, 'admit', 'Hosted first integrations: crypto admit outcome is documented');
  includes(examples, 'needs-evidence', 'Hosted first integrations: crypto needs-evidence outcome is documented');
  includes(examples, 'deny', 'Hosted first integrations: crypto deny outcome is documented');
  includes(examples, 'wallet RPC admission', 'Hosted first integrations: wallet RPC surface is documented');
  includes(examples, 'Safe guard admission receipt', 'Hosted first integrations: Safe guard surface is documented');
  includes(examples, 'bundler admission handoff', 'Hosted first integrations: ERC-4337 surface is documented');
  includes(examples, 'x402 resource-server admission middleware', 'Hosted first integrations: x402 surface is documented');
  includes(examples, 'custody policy callback contract', 'Hosted first integrations: custody surface is documented');
  includes(examples, 'intent-solver admission handoff', 'Hosted first integrations: intent solver surface is documented');
  includes(examples, 'Attestor is not doing:', 'Hosted first integrations: non-goals are documented');
  includes(
    contract,
    "firstIntegrationExamples: 'docs/01-overview/finance-and-crypto-first-integrations.md'",
    'Hosted first integrations: machine-readable truth source is exported',
  );
  includes(pipelineRoute, "app.post('/api/v1/pipeline/run'", 'Hosted first integrations: finance route exists');
  includes(packageJson, '"./crypto-authorization-core"', 'Hosted first integrations: crypto authorization export exists');
  includes(packageJson, '"./crypto-execution-admission"', 'Hosted first integrations: crypto admission export exists');
  includes(cryptoAuthorization, 'cryptoAuthorizationCorePublicSurface', 'Hosted first integrations: crypto authorization public surface exists');
  includes(cryptoAdmission, 'createCryptoExecutionAdmissionPlan', 'Hosted first integrations: crypto admission planner exists');
}

function testFirstApiCallQuickstartStaysGrounded(): void {
  const firstApiCall = readProjectFile('docs', '01-overview', 'hosted-first-api-call.md');
  const contract = readProjectFile('src', 'service', 'hosted-journey-contract.ts');
  const pipelineRoute = readProjectFile('src', 'service', 'http', 'routes', 'pipeline-execution-routes.ts');
  const accountRoutes = readProjectFile('src', 'service', 'http', 'routes', 'account-routes.ts');

  includes(firstApiCall, 'Authorization: Bearer $ATTESTOR_API_KEY', 'Hosted first API-call docs: Bearer header is used');
  includes(firstApiCall, 'Do not put it in URLs', 'Hosted first API-call docs: API key is not documented as a URL parameter');
  includes(firstApiCall, 'GET /api/v1/account/usage', 'Hosted first API-call docs: usage preflight route is documented');
  includes(firstApiCall, 'POST /api/v1/pipeline/run', 'Hosted first API-call docs: first consequence route is documented');
  includes(firstApiCall, '"candidateSql"', 'Hosted first API-call docs: pipeline request uses shipped candidateSql field');
  includes(firstApiCall, '"intent"', 'Hosted first API-call docs: pipeline request uses shipped intent field');
  includes(firstApiCall, '"fixtures"', 'Hosted first API-call docs: reference payload uses fixture evidence explicitly');
  includes(firstApiCall, '"decision": "pass"', 'Hosted first API-call docs: expected decision shape is shown');
  includes(firstApiCall, '"tenantContext"', 'Hosted first API-call docs: tenant context response shape is shown');
  includes(firstApiCall, '"usage"', 'Hosted first API-call docs: usage response shape is shown');
  includes(firstApiCall, '`401`', 'Hosted first API-call docs: invalid key failure is documented');
  includes(firstApiCall, '`429`', 'Hosted first API-call docs: quota/rate-limit failure is documented');
  includes(
    firstApiCall,
    'The downstream system should gate on the returned decision.',
    'Hosted first API-call docs: downstream gating responsibility is explicit',
  );
  includes(
    firstApiCall,
    'Attestor does not auto-detect packs from magic input.',
    'Hosted first API-call docs: no auto-detect promise is made',
  );
  includes(
    contract,
    "firstApiCallQuickstart: 'docs/01-overview/hosted-first-api-call.md'",
    'Hosted first API-call docs: quickstart is a machine-readable truth source',
  );
  includes(
    pipelineRoute,
    "app.post('/api/v1/pipeline/run'",
    'Hosted first API-call docs: pipeline route exists',
  );
  includes(
    accountRoutes,
    "app.get('/api/v1/account/usage'",
    'Hosted first API-call docs: usage route exists',
  );
}

function testPricingAndTrialTruthsStayAnchored(): void {
  const packaging = readProjectFile('docs', '01-overview', 'product-packaging.md');
  const stripeBootstrap = readProjectFile('docs', '01-overview', 'stripe-commercial-bootstrap.md');

  includes(packaging, '| `community` | free |', 'Hosted product flow docs: community plan remains free');
  includes(packaging, 'first `10` hosted runs', 'Hosted product flow docs: community hosted run quota is documented');
  includes(packaging, '| `starter` | EUR `499` / month |', 'Hosted product flow docs: starter pricing is documented');
  includes(packaging, 'with `14` days as the default bootstrap value', 'Hosted product flow docs: starter trial posture is documented');
  includes(packaging, '| `pro` | EUR `1,999` / month |', 'Hosted product flow docs: pro pricing is documented');
  includes(packaging, '| `enterprise` | from EUR `7,500` / month |', 'Hosted product flow docs: enterprise pricing posture is documented');
  includes(stripeBootstrap, 'ATTESTOR_STRIPE_STARTER_TRIAL_DAYS=14', 'Hosted product flow docs: operator trial env var is documented');
  includes(stripeBootstrap, 'POST /api/v1/billing/stripe/webhook', 'Hosted product flow docs: operator webhook route is documented');
}

function testHostedJourneyRoutesMatchShippedRoutes(): void {
  const journey = readProjectFile('docs', '01-overview', 'hosted-customer-journey.md');
  const accountRoutes = readProjectFile('src', 'service', 'http', 'routes', 'account-routes.ts');
  const stripeWebhookRoutes = readProjectFile('src', 'service', 'http', 'routes', 'stripe-webhook-routes.ts');

  const accountRouteContracts = [
    'POST /api/v1/auth/signup',
    'POST /api/v1/auth/login',
    'GET /api/v1/auth/me',
    'GET /api/v1/account',
    'GET /api/v1/account/usage',
    'GET /api/v1/account/entitlement',
    'GET /api/v1/account/api-keys',
    'POST /api/v1/account/api-keys',
    'POST /api/v1/account/api-keys/:id/rotate',
    'POST /api/v1/account/api-keys/:id/deactivate',
    'POST /api/v1/account/api-keys/:id/reactivate',
    'POST /api/v1/account/api-keys/:id/revoke',
    'POST /api/v1/account/billing/checkout',
    'POST /api/v1/account/billing/portal',
  ];

  for (const routeContract of accountRouteContracts) {
    includes(journey, routeContract, `Hosted product flow docs: journey documents ${routeContract}`);
    includes(
      accountRoutes,
      routeContract
        .replace('GET ', "app.get('")
        .replace('POST ', "app.post('")
        .replace(/:id/u, ':id'),
      `Hosted product flow docs: shipped account route exists for ${routeContract}`,
    );
  }

  includes(journey, 'POST /api/v1/billing/stripe/webhook', 'Hosted product flow docs: journey documents Stripe webhook route');
  includes(stripeWebhookRoutes, "app.post('/api/v1/billing/stripe/webhook'", 'Hosted product flow docs: shipped Stripe webhook route exists');
}

function testRuntimeCoverageGatesAreNamed(): void {
  const packageJson = readProjectFile('package.json');
  const liveApi = readProjectFile('tests', 'live-api.test.ts');
  const productionProbe = readProjectFile('scripts', 'probe-production-hosted-flow.ts');

  includes(packageJson, '"test:hosted-product-flow-docs"', 'Hosted product flow docs: package script exposes docs guard');
  includes(packageJson, '"test:hosted-signup-first-api-key-flow"', 'Hosted product flow docs: package script exposes signup-to-first-key gate');
  includes(packageJson, '"test:hosted-stripe-billing-convergence-flow"', 'Hosted product flow docs: package script exposes Stripe billing convergence gate');
  includes(packageJson, '"probe:production-hosted-flow"', 'Hosted product flow docs: production hosted flow probe is exposed');
  includes(liveApi, '/api/v1/auth/signup', 'Hosted product flow docs: live API suite covers hosted signup');
  includes(liveApi, '/api/v1/account/billing/checkout', 'Hosted product flow docs: live API suite covers checkout');
  includes(liveApi, '/api/v1/billing/stripe/webhook', 'Hosted product flow docs: live API suite covers Stripe webhook');
  includes(liveApi, 'entitlements.active_entitlement_summary.updated', 'Hosted product flow docs: live API suite covers Stripe entitlement summary updates');
  includes(productionProbe, '/api/v1/account/billing/checkout', 'Hosted product flow docs: production probe covers checkout');
  includes(productionProbe, '/api/v1/account/billing/portal', 'Hosted product flow docs: production probe covers portal');
  includes(productionProbe, 'generateTestHeaderString', 'Hosted product flow docs: production probe signs Stripe webhook payloads');
}

function testTrackerAndAuditStayInSync(): void {
  const tracker = readProjectFile('docs', '02-architecture', 'hosted-product-flow-buildout.md');
  const audit = readProjectFile('docs', '01-overview', 'hosted-product-flow-audit.md');
  const systemOverview = readProjectFile('docs', '02-architecture', 'system-overview.md');

  includes(tracker, 'Total frozen steps | 8', 'Hosted product flow docs: tracker declares eight frozen steps');
  includes(tracker, '| Completed | 6 |', 'Hosted product flow docs: tracker has six completed steps after first integration examples');
  includes(tracker, '| 01 | complete | Audit existing hosted API, account, billing, Stripe, and documentation surfaces |', 'Hosted product flow docs: Step 01 is complete');
  includes(tracker, '| 02 | complete | Define one canonical hosted journey contract |', 'Hosted product flow docs: Step 02 is complete');
  includes(tracker, '| 03 | complete | Harden signup-to-first-API-key verification |', 'Hosted product flow docs: Step 03 is complete');
  includes(tracker, '| 04 | complete | Harden Stripe checkout, portal, webhook, and entitlement convergence |', 'Hosted product flow docs: Step 04 is complete');
  includes(tracker, '| 05 | complete | Add the first customer API-call quickstart |', 'Hosted product flow docs: Step 05 is complete');
  includes(tracker, '| 06 | complete | Add finance and crypto first-integration examples |', 'Hosted product flow docs: Step 06 is complete');
  includes(tracker, '| 07 | not_started | Add usage, quota, billing, and entitlement visibility guide |', 'Hosted product flow docs: Step 07 is the next step');
  includes(audit, 'The hosted API and billing pieces are real.', 'Hosted product flow docs: audit records the current conclusion');
  includes(audit, '**Focused hosted flow probe.** Addressed by `tests/hosted-signup-first-api-key-flow.test.ts`', 'Hosted product flow docs: audit records Step 03 evidence');
  includes(audit, '**Focused billing convergence probe.** Addressed by `tests/hosted-stripe-billing-convergence-flow.test.ts`', 'Hosted product flow docs: audit records Step 04 evidence');
  includes(audit, '**Customer first-call quickstart.** Addressed by `docs/01-overview/hosted-first-api-call.md`', 'Hosted product flow docs: audit records Step 05 evidence');
  includes(audit, '**Finance and crypto adoption examples.** Addressed by `docs/01-overview/finance-and-crypto-first-integrations.md`', 'Hosted product flow docs: audit records Step 06 evidence');
  includes(systemOverview, 'Hosted product flow and adoption hardening', 'Hosted product flow docs: system overview names active hosted flow track');
}

async function main(): Promise<void> {
  testCommercialTruthSourcesStayLinked();
  testPricingAndTrialTruthsStayAnchored();
  testHostedJourneyRoutesMatchShippedRoutes();
  testRuntimeCoverageGatesAreNamed();
  testFirstApiCallQuickstartStaysGrounded();
  testFinanceAndCryptoFirstIntegrationsStayGrounded();
  testTrackerAndAuditStayInSync();

  ok(passed > 0, 'Hosted product flow docs: tests executed');
  console.log(`\nHosted product flow docs tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nHosted product flow docs tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
