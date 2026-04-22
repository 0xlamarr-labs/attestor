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
    stripeBootstrap,
    'operator-facing and should not become a second public pricing page',
    'Hosted product flow docs: Stripe bootstrap stays operator-facing',
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
  includes(tracker, '| Completed | 4 |', 'Hosted product flow docs: tracker has four completed steps after billing convergence');
  includes(tracker, '| 01 | complete | Audit existing hosted API, account, billing, Stripe, and documentation surfaces |', 'Hosted product flow docs: Step 01 is complete');
  includes(tracker, '| 02 | complete | Define one canonical hosted journey contract |', 'Hosted product flow docs: Step 02 is complete');
  includes(tracker, '| 03 | complete | Harden signup-to-first-API-key verification |', 'Hosted product flow docs: Step 03 is complete');
  includes(tracker, '| 04 | complete | Harden Stripe checkout, portal, webhook, and entitlement convergence |', 'Hosted product flow docs: Step 04 is complete');
  includes(tracker, '| 05 | not_started | Add the first customer API-call quickstart |', 'Hosted product flow docs: Step 05 is the next step');
  includes(audit, 'The hosted API and billing pieces are real.', 'Hosted product flow docs: audit records the current conclusion');
  includes(audit, '**Focused hosted flow probe.** Addressed by `tests/hosted-signup-first-api-key-flow.test.ts`', 'Hosted product flow docs: audit records Step 03 evidence');
  includes(audit, '**Focused billing convergence probe.** Addressed by `tests/hosted-stripe-billing-convergence-flow.test.ts`', 'Hosted product flow docs: audit records Step 04 evidence');
  includes(systemOverview, 'Hosted product flow and adoption hardening', 'Hosted product flow docs: system overview names active hosted flow track');
}

async function main(): Promise<void> {
  testCommercialTruthSourcesStayLinked();
  testPricingAndTrialTruthsStayAnchored();
  testHostedJourneyRoutesMatchShippedRoutes();
  testRuntimeCoverageGatesAreNamed();
  testTrackerAndAuditStayInSync();

  ok(passed > 0, 'Hosted product flow docs: tests executed');
  console.log(`\nHosted product flow docs tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nHosted product flow docs tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
