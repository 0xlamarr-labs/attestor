import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runFirstUsefulAdmissionDemo } from '../examples/first-useful-admission-demo.js';

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

function testDemoExplainsTheFirstUsefulAdmissionFlow(): void {
  const demo = runFirstUsefulAdmissionDemo();

  equal(demo.descriptor.publicSubpath, 'attestor/consequence-admission', 'Demo: public facade is named');
  equal(demo.descriptor.explicitSurfaceRequired, true, 'Demo: explicit surface is required');
  equal(demo.descriptor.automaticPackDetection, false, 'Demo: automatic pack detection is disabled');
  equal(demo.scenarios.length, 2, 'Demo: shows allowed and blocked scenarios');

  const [allowed, blocked] = demo.scenarios;
  equal(allowed.admission.decision, 'admit', 'Demo: allowed scenario maps to admit');
  equal(allowed.gate, 'proceed', 'Demo: allowed scenario proceeds');
  equal(allowed.admission.request.entryPoint.route, '/api/v1/pipeline/run', 'Demo: allowed scenario uses finance route');
  equal(blocked.admission.decision, 'block', 'Demo: blocked scenario maps to block');
  equal(blocked.gate, 'hold', 'Demo: blocked scenario holds');
  equal(blocked.admission.failClosed, true, 'Demo: blocked scenario fails closed');

  includes(demo.output, 'Attestor first useful admission demo', 'Demo: output has title');
  includes(demo.output, 'public facade: attestor/consequence-admission', 'Demo: output names public facade');
  includes(demo.output, 'automatic pack detection: false', 'Demo: output rejects automatic routing');
  includes(demo.output, 'canonical decision: admit', 'Demo: output shows admit');
  includes(demo.output, 'canonical decision: block', 'Demo: output shows block');
  includes(demo.output, 'downstream gate: PROCEED', 'Demo: output shows proceed gate');
  includes(demo.output, 'downstream gate: HOLD', 'Demo: output shows hold gate');
  includes(demo.output, 'Proof first. Action second.', 'Demo: output has the core takeaway');
  excludes(demo.output, /POST\s+\/api\/v1\/admit/u, 'Demo: output does not invent a universal admission route');
}

function testDemoIsReachableFromPackageScriptsAndDocs(): void {
  const packageJson = JSON.parse(readProjectFile('package.json')) as {
    scripts: Record<string, string>;
  };
  const readme = readProjectFile('README.md');
  const quickstart = readProjectFile('docs', '01-overview', 'consequence-admission-quickstart.md');

  equal(packageJson.scripts['example:admission'], 'tsx examples/first-useful-admission-demo.ts', 'Demo: example script is exported');
  equal(packageJson.scripts['test:first-useful-admission-demo'], 'tsx tests/first-useful-admission-demo.test.ts', 'Demo: test script is exported');
  includes(packageJson.scripts.test, 'tsx tests/first-useful-admission-demo.test.ts', 'Demo: npm test runs demo guard');
  includes(packageJson.scripts.verify, 'npm run test:first-useful-admission-demo', 'Demo: verify runs demo guard');

  includes(readme, 'npm run example:admission', 'Demo: README quick start includes demo command');
  includes(readme, 'First useful admission demo', 'Demo: README names the demo');
  includes(quickstart, 'npm run example:admission', 'Demo: consequence admission quickstart links demo command');
  includes(quickstart, 'first useful admission demo', 'Demo: consequence admission quickstart explains demo');
}

testDemoExplainsTheFirstUsefulAdmissionFlow();
testDemoIsReachableFromPackageScriptsAndDocs();

console.log(`First useful admission demo tests: ${passed} passed, 0 failed`);

