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

function testReadmeLinksEvaluationPacket(): void {
  const readme = readProjectFile('README.md');

  includes(
    readme,
    'docs/00-evaluation/v0.1-evaluation-packet.md',
    'Evaluation packet docs: README links the outside-review packet',
  );
}

function testEvaluationPacketNamesRunnableProofPath(): void {
  const packet = readProjectFile('docs', '00-evaluation', 'v0.1-evaluation-packet.md');

  includes(packet, '# Attestor Evaluation Packet v0.1', 'Evaluation packet docs: packet title is stable');
  includes(packet, 'AI output -> structured financial record release', 'Evaluation packet docs: packet keeps the concrete proof wedge');
  includes(packet, 'npm run example:admission', 'Evaluation packet docs: packet includes the shortest admission demo');
  includes(packet, 'npm run example:customer-gate', 'Evaluation packet docs: packet includes the customer-side gate demo');
  includes(packet, 'npm run proof:surface', 'Evaluation packet docs: packet includes proof-surface rendering');
  includes(packet, '.attestor/proof-surface/latest/', 'Evaluation packet docs: packet says where local proof output is written');
  includes(packet, 'npm run verify', 'Evaluation packet docs: packet includes the full local repository gate');
}

function testEvaluationPacketNamesFailureAndProductionTruthGates(): void {
  const packet = readProjectFile('docs', '00-evaluation', 'v0.1-evaluation-packet.md');

  includes(packet, 'npm run test:first-useful-admission-demo', 'Evaluation packet docs: packet includes the first demo regression');
  includes(packet, 'npm run test:consequence-admission-customer-gate', 'Evaluation packet docs: packet includes the customer gate regression');
  includes(packet, 'npm run test:proof-surface-readiness', 'Evaluation packet docs: packet includes proof-surface readiness');
  includes(packet, 'npm run test:production-shared-request-path-cutover', 'Evaluation packet docs: packet includes shared request-path cutover test');
  includes(packet, 'npm run test:production-shared-multi-instance-recovery', 'Evaluation packet docs: packet includes multi-instance recovery test');
  includes(packet, 'npm run test:production-readiness-packet', 'Evaluation packet docs: packet includes production readiness packet test');
  includes(packet, 'ATTESTOR_RUNTIME_PROFILE=production-shared', 'Evaluation packet docs: packet names explicit production-shared profile');
  includes(packet, 'ATTESTOR_RELEASE_AUTHORITY_PG_URL', 'Evaluation packet docs: packet names required shared authority PG URL');
}

function testEvaluationPacketCommandsExistInPackageScripts(): void {
  const packet = readProjectFile('docs', '00-evaluation', 'v0.1-evaluation-packet.md');
  const packageJson = JSON.parse(readProjectFile('package.json')) as {
    readonly scripts?: Record<string, string>;
  };
  const scripts = packageJson.scripts ?? {};
  const commandNames = new Set(
    [...packet.matchAll(/\bnpm run ([a-z0-9:_-]+)/giu)].map((match) => match[1]),
  );

  assert.ok(commandNames.size > 0, 'Evaluation packet docs: packet lists npm run commands');
  passed += 1;

  for (const commandName of commandNames) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(scripts, commandName),
      `Evaluation packet docs: package.json must define script ${commandName}`,
    );
    passed += 1;
  }
}

function testEvaluationPacketKeepsClaimBoundaries(): void {
  const packet = readProjectFile('docs', '00-evaluation', 'v0.1-evaluation-packet.md');

  includes(packet, '## What This Proves', 'Evaluation packet docs: packet has explicit proven scope');
  includes(packet, '## What This Does Not Claim', 'Evaluation packet docs: packet has explicit non-claim scope');
  includes(packet, 'Not a hosted public SaaS launch.', 'Evaluation packet docs: packet avoids hosted SaaS overclaim');
  includes(packet, 'Not a completed customer-operated deployment.', 'Evaluation packet docs: packet avoids customer-operated overclaim');
  includes(packet, 'Not a public hosted crypto HTTP route.', 'Evaluation packet docs: packet avoids hosted crypto route overclaim');
  includes(packet, 'Not automatic pack detection.', 'Evaluation packet docs: packet avoids automatic detection overclaim');
  excludes(packet, /generally available through a public hosted route/iu, 'Evaluation packet docs: packet must not imply hosted crypto GA');
  excludes(packet, /magically guesses|automatically detects/iu, 'Evaluation packet docs: packet must not imply automatic routing');
}

function testEvaluationPacketDoesNotReintroduceTrackerNoise(): void {
  const packet = readProjectFile('docs', '00-evaluation', 'v0.1-evaluation-packet.md');

  excludes(packet, /\b\d+\s*\/\s*\d+\b/u, 'Evaluation packet docs: packet should not expose frozen step fractions');
  excludes(packet, /\bfirst[- ]slice\b/iu, 'Evaluation packet docs: packet should not use first-slice posture');
}

testReadmeLinksEvaluationPacket();
testEvaluationPacketNamesRunnableProofPath();
testEvaluationPacketNamesFailureAndProductionTruthGates();
testEvaluationPacketCommandsExistInPackageScripts();
testEvaluationPacketKeepsClaimBoundaries();
testEvaluationPacketDoesNotReintroduceTrackerNoise();

console.log(`Evaluation packet docs tests: ${passed} passed, 0 failed`);
