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

function testSecurityPolicyExplainsEvaluationBoundary(): void {
  const security = readProjectFile('SECURITY.md');

  includes(security, '# Security Policy', 'Security baseline: policy title is stable');
  includes(security, 'v0.1.1-evaluation', 'Security baseline: current evaluation release is named');
  includes(security, 'evaluation pre-release', 'Security baseline: evaluation status is explicit');
  includes(security, 'not a production-use guarantee', 'Security baseline: production guarantee is not overstated');
  includes(security, 'release decisions, tokens, and enforcement behavior in this repository', 'Security baseline: in-scope surface is explicit');
  includes(security, 'hosted service availability or SLA claims', 'Security baseline: out-of-scope surface is explicit');
}

function testSecurityPolicyKeepsReportingPathHonest(): void {
  const security = readProjectFile('SECURITY.md');

  includes(security, 'Use GitHub private vulnerability reporting for this repository if it is enabled in repository settings.', 'Security baseline: preferred private reporting route is documented honestly');
  includes(security, 'Do not post exploit details, secrets, proof-of-concept payloads, or reproduction steps in a public GitHub issue.', 'Security baseline: public disclosure guard is explicit');
  includes(security, 'Open a minimal public issue only to request a private reporting path', 'Security baseline: fallback reporting path does not overclaim a private inbox');
}

function testReadmePinsReviewerAndSecurityEntry(): void {
  const readme = readProjectFile('README.md');

  includes(readme, 'Start reviewer evaluation with the [Attestor Evaluation Packet v0.1]', 'Security baseline: README pins reviewer entry near the top');
  includes(readme, '[Security Policy](SECURITY.md)', 'Security baseline: README links the security policy');
  includes(readme, '[Evaluation Smoke workflow](.github/workflows/evaluation-smoke.yml)', 'Security baseline: README links the current CI reviewer path');
  includes(readme, '[Artifact attestation plan](docs/08-deployment/artifact-attestation-plan.md)', 'Security baseline: README links the provenance plan');
}

function testCurrentReviewerWorkflowsStayReadOnly(): void {
  const smoke = readProjectFile('.github', 'workflows', 'evaluation-smoke.yml');
  const verify = readProjectFile('.github', 'workflows', 'full-verify.yml');

  includes(smoke, 'permissions:\n  contents: read', 'Security baseline: evaluation smoke stays read-only');
  includes(verify, 'permissions:\n  contents: read', 'Security baseline: full verify stays read-only');
  excludes(smoke, /attestations:\s*write/iu, 'Security baseline: evaluation smoke must not yet request attestation write');
  excludes(smoke, /id-token:\s*write/iu, 'Security baseline: evaluation smoke must not yet request id-token write');
  excludes(verify, /attestations:\s*write/iu, 'Security baseline: full verify must not yet request attestation write');
  excludes(verify, /id-token:\s*write/iu, 'Security baseline: full verify must not yet request id-token write');
}

function testAttestationPlanKeepsFuturePermissionsScoped(): void {
  const plan = readProjectFile('docs', '08-deployment', 'artifact-attestation-plan.md');

  includes(plan, '# Artifact Attestation Plan', 'Security baseline: attestation plan title is stable');
  includes(plan, 'Evaluation Smoke', 'Security baseline: plan names the current smoke workflow');
  includes(plan, 'Full Verify', 'Security baseline: plan names the current full verify workflow');
  includes(plan, 'permissions:\n  contents: read', 'Security baseline: plan captures the current read-only baseline');
  includes(plan, 'attestations: write', 'Security baseline: plan scopes future attestation permission');
  includes(plan, 'id-token: write', 'Security baseline: plan scopes future OIDC permission');
  includes(plan, 'separate release-only workflow', 'Security baseline: plan keeps provenance off the smoke path');
  includes(plan, 'does not claim that Attestor already publishes artifact attestations today', 'Security baseline: plan stays honest about current state');
  excludes(plan, /\bartifact attestations are already available for this release\b/iu, 'Security baseline: plan must not claim existing provenance publication');
}

function testPackageExposesSecurityDocsGuard(): void {
  const packageJson = JSON.parse(readProjectFile('package.json')) as {
    readonly scripts: Readonly<Record<string, string>>;
  };

  assert.equal(
    packageJson.scripts['test:security-baseline-docs'],
    'tsx tests/security-baseline-docs.test.ts',
    'Security baseline: package.json exposes the security docs guard',
  );
  passed += 1;
}

testSecurityPolicyExplainsEvaluationBoundary();
testSecurityPolicyKeepsReportingPathHonest();
testReadmePinsReviewerAndSecurityEntry();
testCurrentReviewerWorkflowsStayReadOnly();
testAttestationPlanKeepsFuturePermissionsScoped();
testPackageExposesSecurityDocsGuard();

console.log(`Security baseline docs tests: ${passed} passed, 0 failed`);
