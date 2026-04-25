import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createConsequenceAdmissionFacadeResponse,
  consequenceAdmissionFacadeDescriptor,
  cryptoExecutionPlanAdmissionDescriptor,
  financePipelineAdmissionDescriptor,
  isConsequenceAdmissionFacadeSurface,
  mapCryptoAdmissionOutcomeToAdmission,
  mapFinancePipelineDecisionToAdmission,
  type FinancePipelineAdmissionRun,
} from '../src/consequence-admission/index.js';

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

function excludes(content: string, unexpected: RegExp, message: string): void {
  assert.doesNotMatch(content, unexpected, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function financeRunFixture(): FinancePipelineAdmissionRun {
  return {
    runId: 'run_readiness_finance_001',
    decision: 'pass',
    proofMode: 'offline_fixture',
    warrant: 'issued',
    escrow: 'released',
    receipt: 'issued',
    capsule: 'closed',
    auditChainIntact: true,
    tenantContext: {
      tenantId: 'tenant_readiness',
      source: 'api_key',
      planId: 'community',
    },
  };
}

function testDocsPointToOneAdmissionStory(): void {
  const readme = readProjectFile('README.md');
  const operatingModel = readProjectFile('docs', '01-overview', 'operating-model.md');
  const quickstart = readProjectFile('docs', '01-overview', 'consequence-admission-quickstart.md');
  const firstCall = readProjectFile('docs', '01-overview', 'hosted-first-api-call.md');
  const firstIntegrations = readProjectFile('docs', '01-overview', 'finance-and-crypto-first-integrations.md');
  const systemOverview = readProjectFile('docs', '02-architecture', 'system-overview.md');
  const tracker = readProjectFile('docs', '02-architecture', 'consequence-admission-buildout.md');

  includes(readme, 'docs/01-overview/consequence-admission-quickstart.md', 'Admission readiness: README links quickstart');
  includes(readme, 'docs/01-overview/operating-model.md', 'Admission readiness: README links operating model');
  includes(readme, 'docs/01-overview/hosted-first-api-call.md', 'Admission readiness: README links first hosted call');
  includes(readme, 'docs/01-overview/finance-and-crypto-first-integrations.md', 'Admission readiness: README links first integrations');

  includes(operatingModel, 'Consequence admission quickstart](consequence-admission-quickstart.md)', 'Admission readiness: operating model links quickstart');
  includes(operatingModel, 'The first customer-facing facade is exported through `attestor/consequence-admission`.', 'Admission readiness: operating model names facade package');
  includes(operatingModel, 'Callers must choose `finance-pipeline-run` or `crypto-execution-plan` explicitly.', 'Admission readiness: operating model requires explicit surface');

  includes(quickstart, '# Consequence Admission Quickstart', 'Admission readiness: quickstart exists');
  includes(quickstart, "from 'attestor/consequence-admission'", 'Admission readiness: quickstart imports public facade');
  includes(quickstart, '`finance-pipeline-run`', 'Admission readiness: quickstart names finance surface');
  includes(quickstart, '`crypto-execution-plan`', 'Admission readiness: quickstart names crypto surface');
  includes(quickstart, '`POST /api/v1/pipeline/run`', 'Admission readiness: quickstart preserves finance route');
  includes(quickstart, 'route: null', 'Admission readiness: quickstart preserves crypto package boundary');
  includes(quickstart, 'npm run test:consequence-admission-readiness', 'Admission readiness: quickstart names readiness gate');
  includes(quickstart, 'npm run test:consequence-admission-package-surface', 'Admission readiness: quickstart names package surface gate');
  includes(quickstart, 'npm run verify', 'Admission readiness: quickstart names full verification gate');
  excludes(quickstart, /POST\s+\/api\/v1\/admit/u, 'Admission readiness: quickstart does not invent a universal hosted admit route');
  excludes(quickstart, /public hosted crypto route is available/iu, 'Admission readiness: quickstart does not claim hosted crypto availability');

  includes(firstCall, 'Consequence admission quickstart](consequence-admission-quickstart.md)', 'Admission readiness: first hosted call links quickstart');
  includes(firstCall, '`pass` is the finance allow branch and maps to canonical `admit`', 'Admission readiness: first hosted call keeps native mapping');

  includes(firstIntegrations, 'Consequence admission quickstart](consequence-admission-quickstart.md)', 'Admission readiness: first integrations link quickstart');
  includes(firstIntegrations, 'The shared package facade is `attestor/consequence-admission`.', 'Admission readiness: first integrations name facade package');

  includes(systemOverview, '`attestor/consequence-admission`', 'Admission readiness: system overview lists package surface');
  includes(systemOverview, 'is complete', 'Admission readiness: system overview uses completed track posture');

  includes(tracker, '| Completed | 6 |', 'Admission readiness: tracker records all steps complete');
  includes(tracker, '| Not started | 0 |', 'Admission readiness: tracker has no remaining frozen step');
  includes(tracker, '| 06 | complete | Add admission readiness and quickstart gates |', 'Admission readiness: Step 06 row is complete');
  includes(tracker, 'No frozen consequence-admission step remains.', 'Admission readiness: tracker closes the frozen track');
}

function testPackageAndDescriptorStayAligned(): void {
  const packageJson = JSON.parse(readProjectFile('package.json')) as {
    exports: Record<string, unknown>;
    scripts: Record<string, string>;
  };
  const facade = consequenceAdmissionFacadeDescriptor();
  const finance = financePipelineAdmissionDescriptor();
  const crypto = cryptoExecutionPlanAdmissionDescriptor();

  equal(Boolean(packageJson.exports['./consequence-admission']), true, 'Admission readiness: package export exists');
  equal(facade.publicSubpath, 'attestor/consequence-admission', 'Admission readiness: facade public subpath is stable');
  equal(facade.explicitSurfaceRequired, true, 'Admission readiness: explicit surface is required');
  equal(facade.automaticPackDetection, false, 'Admission readiness: automatic pack detection is disabled');
  equal(facade.entryPoints.financePipelineRun.route, finance.route, 'Admission readiness: finance route descriptor matches facade');
  equal(finance.route, '/api/v1/pipeline/run', 'Admission readiness: finance route remains hosted pipeline run');
  equal(facade.entryPoints.cryptoExecutionPlan.route, null, 'Admission readiness: facade does not claim crypto hosted route');
  equal(facade.entryPoints.cryptoExecutionPlan.packageSubpath, crypto.packageSubpath, 'Admission readiness: crypto package descriptor matches facade');
  equal(crypto.hostedRouteClaimed, false, 'Admission readiness: crypto descriptor rejects hosted route claim');
  equal(isConsequenceAdmissionFacadeSurface('finance-pipeline-run'), true, 'Admission readiness: finance surface is recognized');
  equal(isConsequenceAdmissionFacadeSurface('crypto-execution-plan'), true, 'Admission readiness: crypto surface is recognized');
  equal(isConsequenceAdmissionFacadeSurface('auto'), false, 'Admission readiness: auto surface is rejected');
  equal(mapFinancePipelineDecisionToAdmission('pass').mappedDecision, 'admit', 'Admission readiness: finance pass maps to admit');
  equal(mapCryptoAdmissionOutcomeToAdmission('needs-evidence').mappedDecision, 'review', 'Admission readiness: crypto needs-evidence maps to review');
  equal(mapCryptoAdmissionOutcomeToAdmission('deny').mappedDecision, 'block', 'Admission readiness: crypto deny maps to block');

  includes(packageJson.scripts.test, 'scripts/run-suite.mjs test', 'Admission readiness: npm test delegates to the suite runner');
  includes(packageJson.scripts.verify, 'scripts/run-suite.mjs verify', 'Admission readiness: verify delegates to the suite runner');
}

function testFacadeBehaviorMatchesTheDocs(): void {
  const response = createConsequenceAdmissionFacadeResponse({
    surface: 'finance-pipeline-run',
    run: financeRunFixture(),
    decidedAt: '2026-04-23T16:00:00.000Z',
  });

  equal(response.decision, 'admit', 'Admission readiness: finance facade returns canonical admit');
  equal(response.request.packFamily, 'finance', 'Admission readiness: finance facade keeps finance pack');
  equal(response.request.entryPoint.route, '/api/v1/pipeline/run', 'Admission readiness: finance facade keeps hosted route');
  equal(response.request.entryPoint.packageSubpath, null, 'Admission readiness: finance facade does not use package boundary');
  equal(response.nativeDecision?.value, 'pass', 'Admission readiness: finance native decision is preserved');

  assert.throws(
    () =>
      createConsequenceAdmissionFacadeResponse({
        surface: 'auto',
        decidedAt: '2026-04-23T16:00:00.000Z',
        run: financeRunFixture(),
      } as unknown as Parameters<typeof createConsequenceAdmissionFacadeResponse>[0]),
    /requires an explicit supported surface/u,
  );
  passed += 1;
}

testDocsPointToOneAdmissionStory();
testPackageAndDescriptorStayAligned();
testFacadeBehaviorMatchesTheDocs();

console.log(`Consequence admission readiness tests: ${passed} passed, 0 failed`);
