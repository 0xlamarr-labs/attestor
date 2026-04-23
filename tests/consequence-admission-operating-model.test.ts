import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

function testOperatingModelDefinesCanonicalDecisionVocabulary(): void {
  const operatingModel = readProjectFile('docs', '01-overview', 'operating-model.md');

  includes(operatingModel, '# Attestor Operating Model', 'Admission operating model: document exists');
  includes(operatingModel, 'proposed consequence', 'Admission operating model: proposed consequence is the starting point');
  includes(operatingModel, 'canonical admission decision', 'Admission operating model: canonical decision is named');
  includes(operatingModel, 'Attestor does not auto-detect finance, crypto, or future packs from magic input.', 'Admission operating model: automatic pack routing is rejected');

  for (const decision of ['`admit`', '`narrow`', '`review`', '`block`']) {
    includes(operatingModel, decision, `Admission operating model: ${decision} is documented`);
  }

  includes(operatingModel, '`pass` is the finance allow branch and maps to `admit`', 'Admission operating model: finance pass maps to admit');
  includes(operatingModel, 'The finance projection lives in `src/consequence-admission/finance.ts`.', 'Admission operating model: finance projection is documented');
  includes(operatingModel, '`needs-evidence` maps to fail-closed `review`', 'Admission operating model: crypto needs-evidence maps to review');
  includes(operatingModel, '`deny` maps to fail-closed `block`', 'Admission operating model: crypto deny maps to block');
  includes(operatingModel, 'The crypto projection lives in `src/consequence-admission/crypto.ts`.', 'Admission operating model: crypto projection is documented');
  includes(operatingModel, 'The first customer-facing facade is exported through `attestor/consequence-admission`.', 'Admission operating model: facade package is documented');
  includes(operatingModel, 'Callers must choose `finance-pipeline-run` or `crypto-execution-plan` explicitly.', 'Admission operating model: facade requires explicit surface');
  includes(operatingModel, 'No public hosted crypto HTTP route is claimed', 'Admission operating model: hosted crypto route overclaim is blocked');
  includes(operatingModel, 'No universal hosted `admit` route is claimed', 'Admission operating model: universal route overclaim is blocked');
}

function testTopLevelDocsLinkTheOperatingModel(): void {
  const readme = readProjectFile('README.md');
  const purpose = readProjectFile('docs', '01-overview', 'purpose.md');
  const systemOverview = readProjectFile('docs', '02-architecture', 'system-overview.md');
  const hostedContract = readProjectFile('docs', '01-overview', 'hosted-journey-contract.md');

  includes(readme, 'docs/01-overview/operating-model.md', 'Admission operating model: README links operating model');
  includes(purpose, 'Operating model](operating-model.md)', 'Admission operating model: purpose links operating model');
  includes(systemOverview, 'Operating model](../01-overview/operating-model.md)', 'Admission operating model: system overview links operating model');
  includes(hostedContract, 'Operating model](operating-model.md)', 'Admission operating model: hosted journey contract links operating model');
}

function testFirstIntegrationDocsExplainNativeDecisionMapping(): void {
  const firstApiCall = readProjectFile('docs', '01-overview', 'hosted-first-api-call.md');
  const firstIntegrations = readProjectFile('docs', '01-overview', 'finance-and-crypto-first-integrations.md');

  includes(firstApiCall, '"decision": "pass"', 'Admission operating model: first hosted call keeps shipped finance response shape');
  includes(firstApiCall, 'domain-native finance decision', 'Admission operating model: first hosted call names domain-native finance decision');
  includes(firstApiCall, '`pass` is the finance allow branch and maps to canonical `admit`', 'Admission operating model: first hosted call maps pass to admit');
  includes(firstApiCall, 'Operating model](operating-model.md)', 'Admission operating model: first hosted call links canonical vocabulary');

  includes(firstIntegrations, 'Canonical admission vocabulary', 'Admission operating model: first integrations name canonical vocabulary');
  includes(firstIntegrations, '`pass` maps to canonical `admit`', 'Admission operating model: finance first integration maps pass to admit');
  includes(firstIntegrations, '`needs-evidence` maps to fail-closed `review`', 'Admission operating model: crypto first integration maps needs-evidence to review');
  includes(firstIntegrations, '`deny` maps to fail-closed `block`', 'Admission operating model: crypto first integration maps deny to block');
  includes(firstIntegrations, 'The shared package facade is `attestor/consequence-admission`.', 'Admission operating model: first integrations document facade package');
  includes(firstIntegrations, 'the caller must choose `finance-pipeline-run` or `crypto-execution-plan` explicitly', 'Admission operating model: first integrations reject automatic facade routing');
  includes(firstIntegrations, 'Do not describe crypto as generally available through a public hosted route', 'Admission operating model: crypto hosted-route guardrail remains');
}

function testTrackerDefinesTheStepwisePathWithoutSplittingTheProduct(): void {
  const tracker = readProjectFile('docs', '02-architecture', 'consequence-admission-buildout.md');

  includes(tracker, '# Consequence Admission Buildout Tracker', 'Admission tracker: tracker exists');
  includes(tracker, 'The goal is not to add a second product, a crypto-only track, or another broad surface.', 'Admission tracker: no product split');
  includes(tracker, 'Keep Attestor as one product with one platform core and modular packs.', 'Admission tracker: one-product guardrail');
  includes(tracker, 'Do not claim a public hosted crypto HTTP route', 'Admission tracker: public crypto route overclaim blocked');
  includes(tracker, 'Do not claim a universal hosted admission route', 'Admission tracker: universal route overclaim blocked');
  includes(tracker, '| Total frozen steps | 6 |', 'Admission tracker: frozen step count is explicit');
  includes(tracker, '| Completed | 5 |', 'Admission tracker: Step 05 is complete');
  includes(tracker, '| 01 | complete | Codify the operating model and canonical admission vocabulary |', 'Admission tracker: Step 01 row is complete');
  includes(tracker, '| 02 | complete | Add the typed canonical admission contract |', 'Admission tracker: Step 02 row is complete');
  includes(tracker, '| 03 | complete | Add finance decision mapping into the admission contract |', 'Admission tracker: Step 03 row is complete');
  includes(tracker, '| 04 | complete | Add crypto package outcome mapping into the admission contract |', 'Admission tracker: Step 04 row is complete');
  includes(tracker, '| 05 | complete | Add the first customer-facing admission facade |', 'Admission tracker: Step 05 row is complete');
  includes(tracker, '| 06 | not started | Add admission readiness and quickstart gates |', 'Admission tracker: Step 06 is next');
  includes(tracker, '`attestor/consequence-admission` now exposes the first customer-facing admission facade', 'Admission tracker: facade posture is documented');
  includes(tracker, 'Implement Step 06 before widening the public admission quickstart or route story.', 'Admission tracker: next step blocks premature API widening');
  excludes(tracker, /\bfirst[- ]slice\b/iu, 'Admission tracker: no stale first-slice language');
}

function testPackageScriptsExposeTheGuard(): void {
  const packageJson = JSON.parse(readProjectFile('package.json')) as {
    scripts: Record<string, string>;
  };

  includes(JSON.stringify(packageJson.scripts), 'test:consequence-admission-operating-model', 'Admission operating model: script is exported');
  includes(JSON.stringify(packageJson.scripts), 'test:consequence-admission-finance', 'Admission operating model: finance script is exported');
  includes(JSON.stringify(packageJson.scripts), 'test:consequence-admission-crypto', 'Admission operating model: crypto script is exported');
  includes(JSON.stringify(packageJson.scripts), 'test:consequence-admission-facade', 'Admission operating model: facade script is exported');
  includes(JSON.stringify(packageJson.scripts), 'test:consequence-admission-package-surface', 'Admission operating model: package surface script is exported');
  includes(packageJson.scripts.test, 'tsx tests/consequence-admission-operating-model.test.ts', 'Admission operating model: npm test runs the guard');
  includes(packageJson.scripts.test, 'tsx tests/consequence-admission-finance.test.ts', 'Admission operating model: npm test runs finance projection');
  includes(packageJson.scripts.test, 'tsx tests/consequence-admission-crypto.test.ts', 'Admission operating model: npm test runs crypto projection');
  includes(packageJson.scripts.test, 'tsx tests/consequence-admission-facade.test.ts', 'Admission operating model: npm test runs facade projection');
  includes(packageJson.scripts.verify, 'npm run test:consequence-admission-operating-model', 'Admission operating model: npm run verify runs the guard');
  includes(packageJson.scripts.verify, 'npm run test:consequence-admission-finance', 'Admission operating model: npm run verify runs finance projection');
  includes(packageJson.scripts.verify, 'npm run test:consequence-admission-crypto', 'Admission operating model: npm run verify runs crypto projection');
  includes(packageJson.scripts.verify, 'npm run test:consequence-admission-facade', 'Admission operating model: npm run verify runs facade projection');
  includes(packageJson.scripts.verify, 'npm run test:consequence-admission-package-surface', 'Admission operating model: npm run verify runs package surface probe');
}

testOperatingModelDefinesCanonicalDecisionVocabulary();
testTopLevelDocsLinkTheOperatingModel();
testFirstIntegrationDocsExplainNativeDecisionMapping();
testTrackerDefinesTheStepwisePathWithoutSplittingTheProduct();
testPackageScriptsExposeTheGuard();

console.log(`Consequence admission operating model tests: ${passed} passed, 0 failed`);
