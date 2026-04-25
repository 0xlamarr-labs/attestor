import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type SuiteItem = {
  readonly label: string;
  readonly command: string;
};

const { resolveSuite } = await import('../scripts/run-suite.mjs') as {
  readonly resolveSuite: (suiteName: 'test' | 'verify') => readonly SuiteItem[];
};

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

function excludes(content: string, unexpected: string, message: string): void {
  assert.ok(
    !content.includes(unexpected),
    `${message}\nDid not expect to find: ${unexpected}`,
  );
  passed += 1;
}

function packageJson(): {
  readonly private: boolean;
  readonly scripts: Readonly<Record<string, string>>;
} {
  return JSON.parse(readProjectFile('package.json')) as {
    readonly private: boolean;
    readonly scripts: Readonly<Record<string, string>>;
  };
}

function suiteText(suiteName: 'test' | 'verify'): string {
  return resolveSuite(suiteName)
    .map((item) => `${item.label}\n${item.command}`)
    .join('\n');
}

function suiteCommands(suiteName: 'test' | 'verify'): readonly string[] {
  return resolveSuite(suiteName).map((item) => item.command);
}

function testPackageJsonDelegatesLargeSuitesToRunner(): void {
  const pkg = packageJson();

  equal(pkg.scripts.test, 'node scripts/run-suite.mjs test', 'Package runner: npm test delegates to suite runner');
  equal(pkg.scripts.verify, 'node scripts/run-suite.mjs verify', 'Package runner: npm run verify delegates to suite runner');
  equal(pkg.scripts['typecheck:hygiene'], 'tsc --noEmit --noUnusedLocals --noUnusedParameters', 'Package runner: strict unused-code hygiene is available as an explicit check');
  equal(pkg.scripts['test:package-script-runner'], 'tsx tests/package-script-runner.test.ts', 'Package runner: runner contract test is exposed');
}

function testFastSuiteKeepsCriticalCoverage(): void {
  const text = suiteText('test');

  for (const expected of [
    'test:financial',
    'test:signing',
    'test:consequence-admission-customer-gate',
    'test:first-impression-path',
    'test:proof-surface-readiness',
    'test:evaluation-packet-docs',
    'test:package-script-runner',
    'tsx tests/account-session-cookie-security.test.ts',
    'tsx tests/release-kernel-release-decision-engine.test.ts',
    'tsx tests/release-layer-platform-surface.test.ts',
    'tsx tests/release-policy-control-plane-platform-surface.test.ts',
    'tsx tests/release-enforcement-plane-middleware.test.ts',
    'tsx tests/crypto-authorization-core-eip712-envelope.test.ts',
  ]) {
    includes(text, expected, `Package runner: fast suite includes ${expected}`);
  }
}

function testVerifySuiteKeepsGateOrdering(): void {
  const commands = suiteCommands('verify');
  const text = commands.join('\n');

  equal(commands[0], 'npm run typecheck', 'Package runner: verify starts with typecheck');
  includes(text, 'npm run test:service-bootstrap-boundary', 'Package runner: verify includes service bootstrap boundary');
  includes(text, 'npm run test:service-route-boundary', 'Package runner: verify includes service route boundary');
  includes(text, 'npm run build', 'Package runner: verify includes build before package probes');
  includes(text, 'npm run test:release-layer-package-surface', 'Package runner: verify includes release layer package probe');
  includes(text, 'npm run test:release-policy-control-plane-package-surface', 'Package runner: verify includes policy control-plane package probe');
  includes(text, 'npm run test:release-enforcement-plane-package-surface', 'Package runner: verify includes enforcement-plane package probe');
  includes(text, 'npm run test:crypto-authorization-core-package-surface', 'Package runner: verify includes crypto authorization package probe');
  includes(text, 'npm run test:crypto-execution-admission-package-surface', 'Package runner: verify includes crypto execution-admission package probe');
  includes(text, 'npm run test:consequence-admission-package-surface', 'Package runner: verify includes consequence-admission package probe');

  const buildIndex = commands.indexOf('npm run build');
  for (const probeCommand of commands.filter((command) => command.includes('-package-surface'))) {
    ok(buildIndex >= 0 && commands.indexOf(probeCommand) > buildIndex, `Package runner: ${probeCommand} runs after build`);
  }
}

function testDefaultSuitesExcludeLiveAndOpsGates(): void {
  const testText = suiteText('test');
  const verifyText = suiteText('verify');

  for (const excluded of [
    'test:live-api',
    'test:live-postgres',
    'test:live-snowflake',
    'test:observability-bundle',
    'test:kubernetes-ha-bundle',
    'test:production-readiness-packet',
    'test:secret-manager-bootstrap-render',
  ]) {
    excludes(testText, excluded, `Package runner: npm test excludes live/ops gate ${excluded}`);
    excludes(verifyText, excluded, `Package runner: npm run verify excludes live/ops gate ${excluded}`);
  }
}

function testPrivatePackageBoundaryIsDocumented(): void {
  const pkg = packageJson();
  const purpose = readProjectFile('docs', '01-overview', 'purpose.md');
  const systemOverview = readProjectFile('docs', '02-architecture', 'system-overview.md');

  equal(pkg.private, true, 'Package boundary: repository package remains private');
  includes(purpose, 'not a public npm publication claim', 'Package boundary: purpose clarifies private package posture');
  includes(systemOverview, 'not a public npm availability claim', 'Package boundary: system overview clarifies private package posture');
}

testPackageJsonDelegatesLargeSuitesToRunner();
testFastSuiteKeepsCriticalCoverage();
testVerifySuiteKeepsGateOrdering();
testDefaultSuitesExcludeLiveAndOpsGates();
testPrivatePackageBoundaryIsDocumented();

console.log(`Package script runner tests: ${passed} passed, 0 failed`);
