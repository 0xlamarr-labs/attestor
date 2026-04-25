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

function testRecipesExplainWhereAttestorGoes(): void {
  const doc = readProjectFile('docs', '01-overview', 'customer-integration-recipes.md');

  includes(doc, 'put Attestor at the last customer-owned gate before a real side effect', 'Recipes: placement rule is explicit');
  includes(doc, 'prepare proposed consequence', 'Recipes: flow starts before consequence');
  includes(doc, 'call the relevant Attestor path', 'Recipes: Attestor call is explicit');
  includes(doc, 'project the result into admission', 'Recipes: admission projection is explicit');
  includes(doc, 'enforce the customer gate', 'Recipes: customer gate is explicit');
  includes(doc, 'only then run the downstream side effect', 'Recipes: downstream side effect is gated');
  includes(doc, 'Do not put Attestor after the consequence.', 'Recipes: bad placement is called out');
  includes(doc, 'AI or workflow output -> Attestor -> customer gate -> database write / message send / payment call', 'Recipes: good placement diagram is present');
  includes(doc, 'AI or workflow output -> database write / message send / payment call -> Attestor', 'Recipes: bad placement diagram is present');
}

function testRecipesCoverTheFirstUsefulIntegrations(): void {
  const doc = readProjectFile('docs', '01-overview', 'customer-integration-recipes.md');

  includes(doc, '## Recipe 1: AI-Assisted Finance Report', 'Recipes: finance report recipe is present');
  includes(doc, '## Recipe 2: Customer-Facing Message', 'Recipes: customer message recipe is present');
  includes(doc, '## Recipe 3: Refund, Payout, Or Operational Action', 'Recipes: action recipe is present');
  includes(doc, '## Recipe 4: Programmable-Money Execution', 'Recipes: programmable-money recipe is present');
  includes(doc, 'POST /api/v1/pipeline/run', 'Recipes: shipped hosted finance route is named');
  includes(doc, 'createConsequenceAdmissionFacadeResponse', 'Recipes: facade helper is named');
  includes(doc, 'evaluateConsequenceAdmissionGate', 'Recipes: gate helper is named');
  includes(doc, 'customer_reporting_store.write', 'Recipes: reporting gate label is concrete');
  includes(doc, 'customer_message_sender.send', 'Recipes: message gate label is concrete');
  includes(doc, 'customer_action_dispatch.execute', 'Recipes: action gate label is concrete');
  includes(doc, 'customer_bundler.submit', 'Recipes: crypto gate label is concrete');
}

function testRecipesStayHonestAboutBoundaries(): void {
  const doc = readProjectFile('docs', '01-overview', 'customer-integration-recipes.md');

  includes(doc, 'This is not a public hosted crypto route.', 'Recipes: hosted crypto overclaim is blocked');
  includes(doc, 'Do not put tenant API keys in browser or mobile client code.', 'Recipes: API-key placement is honest');
  includes(doc, 'Do not treat `review` as a soft allow.', 'Recipes: review remains fail-closed');
  includes(doc, 'Do not assume Attestor auto-detects packs from payload shape.', 'Recipes: automatic detection overclaim is blocked');
  excludes(doc, /POST\s+\/api\/v1\/admit/u, 'Recipes: universal admit route is not invented');
  excludes(doc, /public hosted crypto route is available/iu, 'Recipes: public hosted crypto route is not invented');
}

function testDocsPointToRecipes(): void {
  const readme = readProjectFile('README.md');
  const useCases = readProjectFile('docs', '01-overview', 'what-you-can-do.md');
  const customerGate = readProjectFile('docs', '01-overview', 'customer-admission-gate.md');
  const packageJson = JSON.parse(readProjectFile('package.json')) as {
    scripts: Record<string, string>;
  };

  includes(readme, 'docs/01-overview/customer-integration-recipes.md', 'Recipes: README links the placement guide');
  includes(readme, '[Customer integration recipes](docs/01-overview/customer-integration-recipes.md)', 'Recipes: README names the guide plainly');
  includes(useCases, '[Customer integration recipes](customer-integration-recipes.md)', 'Recipes: use-case bridge links the recipes');
  includes(customerGate, '[Customer integration recipes](customer-integration-recipes.md)', 'Recipes: customer gate doc links the recipes');
  includes(packageJson.scripts.test, 'scripts/run-suite.mjs test', 'Recipes: npm test delegates to the suite runner');
  includes(packageJson.scripts.verify, 'scripts/run-suite.mjs verify', 'Recipes: verify delegates to the suite runner');
}

testRecipesExplainWhereAttestorGoes();
testRecipesCoverTheFirstUsefulIntegrations();
testRecipesStayHonestAboutBoundaries();
testDocsPointToRecipes();

console.log(`Customer integration recipes docs tests: ${passed} passed, 0 failed`);
