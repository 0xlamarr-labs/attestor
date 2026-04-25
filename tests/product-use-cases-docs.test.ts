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

function testUseCaseBridgeStaysConcrete(): void {
  const doc = readProjectFile('docs', '01-overview', 'what-you-can-do.md');

  includes(doc, 'proposed consequence -> Attestor decision and proof -> customer gate -> downstream action', 'Use cases: core operating shape is explicit');
  includes(doc, '| AI-assisted finance report |', 'Use cases: finance report use case is present');
  includes(doc, '| Customer-facing message |', 'Use cases: communication use case is present');
  includes(doc, '| Financial action |', 'Use cases: action dispatch use case is present');
  includes(doc, '| Programmable-money path |', 'Use cases: crypto execution use case is present');
  includes(doc, '| Hosted API workflow |', 'Use cases: hosted API use case is present');
  includes(doc, '| Audit and verification |', 'Use cases: verification use case is present');
  includes(doc, 'The customer still owns the model, workflow, wallet, database, message system, filing tool, or payment rail.', 'Use cases: customer ownership boundary is explicit');
  includes(doc, 'Attestor owns the control point before consequence:', 'Use cases: Attestor role is explicit');
  includes(doc, 'npm run example:admission', 'Use cases: local first-run command is present');
  includes(doc, 'npm run example:customer-gate', 'Use cases: customer gate command is present');
  includes(doc, 'POST /api/v1/pipeline/run', 'Use cases: hosted finance route is present');
  includes(doc, 'attestor/consequence-admission', 'Use cases: package facade is present');
  includes(doc, '[First hosted API call](hosted-first-api-call.md)', 'Use cases: hosted next step is linked');
  includes(doc, '[Customer admission gate](customer-admission-gate.md)', 'Use cases: customer gate next step is linked');
}

function testUseCaseBridgeDoesNotOverclaim(): void {
  const doc = readProjectFile('docs', '01-overview', 'what-you-can-do.md');

  includes(doc, 'Not a claim that every pack has the same hosted route.', 'Use cases: hosted route overclaim is blocked');
  includes(doc, 'Not automatic pack detection.', 'Use cases: automatic pack detection overclaim is blocked');
  includes(doc, 'Not a wallet, custody platform, database, message system, model runtime, or orchestration tool.', 'Use cases: role overclaim is blocked');
  excludes(doc, /POST\s+\/api\/v1\/admit/u, 'Use cases: universal admit route is not invented');
  excludes(doc, /public hosted crypto route is available/iu, 'Use cases: hosted crypto route is not invented');
}

function testReadmeAndDocsPointToUseCaseBridge(): void {
  const readme = readProjectFile('README.md');
  const productPositioningTest = readProjectFile('tests', 'product-positioning-docs.test.ts');
  const packageJson = JSON.parse(readProjectFile('package.json')) as {
    scripts: Record<string, string>;
  };

  includes(readme, 'docs/01-overview/what-you-can-do.md', 'Use cases: README links the use-case bridge');
  includes(readme, '[What you can do with Attestor](docs/01-overview/what-you-can-do.md)', 'Use cases: README names the bridge plainly');
  includes(productPositioningTest, 'what-you-can-do.md', 'Use cases: product positioning guard tracks the bridge');
  includes(packageJson.scripts.test, 'scripts/run-suite.mjs test', 'Use cases: npm test delegates to the suite runner');
  includes(packageJson.scripts.verify, 'scripts/run-suite.mjs verify', 'Use cases: verify delegates to the suite runner');
}

testUseCaseBridgeStaysConcrete();
testUseCaseBridgeDoesNotOverclaim();
testReadmeAndDocsPointToUseCaseBridge();

console.log(`Product use-case docs tests: ${passed} passed, 0 failed`);
