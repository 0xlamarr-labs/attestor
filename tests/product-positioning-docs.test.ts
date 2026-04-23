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

function testTopLevelPositioningStaysAligned(): void {
  const readme = readProjectFile('README.md');
  const purpose = readProjectFile('docs', '01-overview', 'purpose.md');
  const systemOverview = readProjectFile('docs', '02-architecture', 'system-overview.md');
  const packaging = readProjectFile('docs', '01-overview', 'product-packaging.md');
  const useCases = readProjectFile('docs', '01-overview', 'what-you-can-do.md');

  includes(readme, 'One product. One platform core.', 'Product docs: README keeps one-product framing');
  includes(purpose, 'Attestor is one product:', 'Product docs: purpose keeps one-product framing');
  includes(systemOverview, 'Attestor should be understood as one product:', 'Product docs: system overview keeps one-product framing');
  includes(packaging, 'Attestor is one product:', 'Product docs: packaging keeps one-product framing');
  includes(useCases, 'Attestor owns the control point before consequence:', 'Product docs: use-case bridge keeps control-point framing');
  includes(readme, 'docs/01-overview/what-you-can-do.md', 'Product docs: README links the use-case bridge');
  includes(readme, 'Attestor does not magically guess what to run.', 'Product docs: README blocks automatic-pack overclaim');
  includes(purpose, 'not a magical router that guesses the correct pack automatically', 'Product docs: purpose blocks automatic-pack overclaim');
  includes(useCases, 'Not automatic pack detection.', 'Product docs: use-case bridge blocks automatic-pack overclaim');
}

function testCoreAndPackStatusStayConsistent(): void {
  const readme = readProjectFile('README.md');
  const purpose = readProjectFile('docs', '01-overview', 'purpose.md');
  const systemOverview = readProjectFile('docs', '02-architecture', 'system-overview.md');
  const firstIntegrations = readProjectFile('docs', '01-overview', 'finance-and-crypto-first-integrations.md');

  for (const packageSurface of [
    'attestor/release-layer',
    'attestor/release-layer/finance',
    'attestor/release-policy-control-plane',
    'attestor/release-enforcement-plane',
    'attestor/crypto-authorization-core',
    'attestor/crypto-execution-admission',
  ]) {
    includes(purpose, packageSurface, `Product docs: purpose names ${packageSurface}`);
    includes(systemOverview, packageSurface, `Product docs: system overview names ${packageSurface}`);
  }

  includes(readme, '| Release layer | consequence decisions, deterministic checks, tokens, reviewer queue, evidence packs | complete, packaged |', 'Product docs: README release layer status is compact');
  includes(readme, '| Policy control plane | signed policy bundles, activation, rollback, scoping, simulation, audit trail | complete, packaged |', 'Product docs: README policy control-plane status is compact');
  includes(readme, '| Enforcement plane | offline/online verification, gateways, DPoP, mTLS/SPIFFE, HTTP message signatures | complete, packaged |', 'Product docs: README enforcement plane status is compact');
  includes(readme, '| Crypto authorization core | programmable-money authorization vocabulary, bindings, simulation, adapter preflight | complete, packaged |', 'Product docs: README crypto core status is compact');
  includes(purpose, 'The finance pack remains the deepest proven wedge today.', 'Product docs: purpose keeps finance as strongest wedge');
  includes(purpose, 'not a public hosted crypto HTTP route', 'Product docs: purpose keeps crypto hosted-route guardrail');
  includes(firstIntegrations, 'Do not describe crypto as generally available through a public hosted route', 'Product docs: first integrations keep crypto hosted-route guardrail');
}

function testReadmeDoesNotReintroduceFrozenStepFractions(): void {
  const readme = readProjectFile('README.md');

  excludes(readme, /\b\d+\s*\/\s*\d+\b/u, 'Product docs: README should not expose frozen step fractions');
  excludes(readme, /\bfirst[- ]slice\b/iu, 'Product docs: README should not use first-slice posture');
}

function testPurposeDoesNotCarryStaleSnapshotLanguage(): void {
  const purpose = readProjectFile('docs', '01-overview', 'purpose.md');

  excludes(purpose, /\bfirst[- ]slice\b/iu, 'Product docs: purpose should not describe current shipped surfaces as first-slice');
  excludes(purpose, /not yet imply release-layer completeness/iu, 'Product docs: purpose should not carry old release-layer caveat');
  excludes(purpose, /financial reference path/iu, 'Product docs: purpose should not reduce platform truth to the old finance-only snapshot');
}

function testServiceRefactorStatusStaysVisible(): void {
  const purpose = readProjectFile('docs', '01-overview', 'purpose.md');
  const serviceRefactor = readProjectFile('docs', '02-architecture', 'service-api-refactor-buildout.md');

  includes(purpose, '`api-server.ts` is now a small Hono composition root', 'Product docs: purpose records thin API server');
  includes(serviceRefactor, '| API route runtime composition | Complete |', 'Product docs: service refactor tracker records route runtime completion');
  includes(serviceRefactor, '| Thin API server | Complete |', 'Product docs: service refactor tracker records thin API server completion');
  includes(serviceRefactor, 'the boundary test caps it at 120 lines', 'Product docs: service refactor tracker records anti-regression guard');
}

testTopLevelPositioningStaysAligned();
testCoreAndPackStatusStayConsistent();
testReadmeDoesNotReintroduceFrozenStepFractions();
testPurposeDoesNotCarryStaleSnapshotLanguage();
testServiceRefactorStatusStaysVisible();

console.log(`Product positioning docs tests: ${passed} passed, 0 failed`);
