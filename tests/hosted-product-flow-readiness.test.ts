import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  HOSTED_PRODUCT_FLOW_READINESS_GATES,
  hostedJourneyContract,
} from '../src/service/hosted-journey-contract.js';

let passed = 0;

function readProjectFile(...segments: string[]): string {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function includes(content: string, expected: string, message: string): void {
  assert.ok(
    content.includes(expected),
    `${message}\nExpected to find: ${expected}`,
  );
  passed += 1;
}

function testMachineReadableReadinessGatesStayExported(): void {
  const contract = hostedJourneyContract();

  assert.deepEqual(contract.readinessGates, HOSTED_PRODUCT_FLOW_READINESS_GATES);
  passed += 1;
  equal(contract.readinessGates.docsGuard, 'test:hosted-product-flow-docs', 'Hosted readiness: docs gate export is stable');
  equal(contract.readinessGates.contractGuard, 'test:hosted-product-flow-contract', 'Hosted readiness: contract gate export is stable');
  equal(contract.readinessGates.readinessGuard, 'test:hosted-product-flow-readiness', 'Hosted readiness: readiness gate export is stable');
  equal(contract.readinessGates.signupFlowGate, 'test:hosted-signup-first-api-key-flow', 'Hosted readiness: signup flow gate export is stable');
  equal(contract.readinessGates.billingConvergenceGate, 'test:hosted-stripe-billing-convergence-flow', 'Hosted readiness: billing convergence gate export is stable');
  equal(contract.readinessGates.productionProbe, 'probe:production-hosted-flow', 'Hosted readiness: production probe export is stable');
}

function testPackageScriptsMatchReadinessGates(): void {
  const packageJson = JSON.parse(readProjectFile('package.json')) as {
    scripts: Record<string, string>;
  };

  for (const scriptName of Object.values(HOSTED_PRODUCT_FLOW_READINESS_GATES)) {
    ok(typeof packageJson.scripts[scriptName] === 'string', `Hosted readiness: package.json exposes ${scriptName}`);
  }

  includes(packageJson.scripts.test, 'tsx tests/hosted-product-flow-readiness.test.ts', 'Hosted readiness: main test script includes readiness test');
  includes(packageJson.scripts.verify, 'npm run test:hosted-product-flow-readiness', 'Hosted readiness: verify script includes readiness test');
}

function testProductionProbeCoversSaleReadyHostedSurface(): void {
  const probe = readProjectFile('scripts', 'probe-production-hosted-flow.ts');

  includes(probe, '/api/v1/account', 'Hosted readiness: production probe covers account summary');
  includes(probe, '/api/v1/account/usage', 'Hosted readiness: production probe covers usage');
  includes(probe, '/api/v1/account/entitlement', 'Hosted readiness: production probe covers entitlement');
  includes(probe, '/api/v1/account/features', 'Hosted readiness: production probe covers features');
  includes(probe, '/api/v1/account/billing/export?limit=5', 'Hosted readiness: production probe covers billing export');
  includes(probe, '/api/v1/account/billing/reconciliation?limit=5', 'Hosted readiness: production probe covers billing reconciliation');
  includes(probe, '/api/v1/account/billing/checkout', 'Hosted readiness: production probe covers checkout');
  includes(probe, '/api/v1/account/billing/portal', 'Hosted readiness: production probe covers billing portal');
  includes(probe, '/api/v1/billing/stripe/webhook', 'Hosted readiness: production probe covers Stripe webhook convergence');
}

function testSaleReadyTruthSourcesRemainSeparated(): void {
  const packaging = readProjectFile('docs', '01-overview', 'product-packaging.md');
  const journey = readProjectFile('docs', '01-overview', 'hosted-customer-journey.md');
  const visibility = readProjectFile('docs', '01-overview', 'hosted-account-visibility.md');
  const bootstrap = readProjectFile('docs', '01-overview', 'stripe-commercial-bootstrap.md');

  includes(packaging, 'This document is the commercial truth source', 'Hosted readiness: packaging remains the commercial truth source');
  includes(journey, 'use [Commercial packaging, pricing, and evaluation](product-packaging.md) as the source of truth', 'Hosted readiness: journey defers pricing to packaging');
  includes(visibility, 'use [Stripe commercial bootstrap](stripe-commercial-bootstrap.md) only for operator setup, not as a customer pricing page', 'Hosted readiness: visibility guide keeps operator truth separate');
  includes(bootstrap, 'operator-facing and should not become a second public pricing page', 'Hosted readiness: Stripe bootstrap stays operator-facing');
}

function testCompletionSourcesAgree(): void {
  const tracker = readProjectFile('docs', '02-architecture', 'hosted-product-flow-buildout.md');
  const audit = readProjectFile('docs', '01-overview', 'hosted-product-flow-audit.md');
  const systemOverview = readProjectFile('docs', '02-architecture', 'system-overview.md');
  const liveApi = readProjectFile('tests', 'live-api.test.ts');

  includes(tracker, '| Completed | 8 |', 'Hosted readiness: tracker records eight completed steps');
  includes(tracker, '| 08 | complete | Add final docs truth-source and readiness gate |', 'Hosted readiness: tracker records Step 08 completion');
  includes(audit, 'The hosted product path is sale-ready for its current scope.', 'Hosted readiness: audit records sale-ready conclusion');
  includes(audit, '**Final truth-source gate.** Addressed by `tests/hosted-product-flow-readiness.test.ts`', 'Hosted readiness: audit records final gate evidence');
  includes(systemOverview, 'hosted product flow hardening track is complete at `8 / 8`', 'Hosted readiness: system overview records completion');
  includes(systemOverview, 'Future hosted product-flow changes should preserve the docs, contract, readiness, and probe gates', 'Hosted readiness: system overview records future guardrail');
  includes(liveApi, '/api/v1/account/features', 'Hosted readiness: live API covers features');
  includes(liveApi, '/api/v1/account/billing/export?limit=5', 'Hosted readiness: live API covers billing export');
  includes(liveApi, '/api/v1/account/billing/reconciliation?limit=5', 'Hosted readiness: live API covers billing reconciliation');
}

async function main(): Promise<void> {
  testMachineReadableReadinessGatesStayExported();
  testPackageScriptsMatchReadinessGates();
  testProductionProbeCoversSaleReadyHostedSurface();
  testSaleReadyTruthSourcesRemainSeparated();
  testCompletionSourcesAgree();

  ok(passed > 0, 'Hosted readiness: tests executed');
  console.log(`\nHosted product flow readiness tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nHosted product flow readiness tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
