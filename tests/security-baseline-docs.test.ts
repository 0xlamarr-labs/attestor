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

function testReleaseProvenanceWorkflowKeepsElevatedPermissionsScoped(): void {
  const workflow = readProjectFile('.github', 'workflows', 'release-provenance.yml');

  includes(workflow, 'name: Release Provenance', 'Security baseline: release provenance workflow title is stable');
  includes(workflow, 'workflow_dispatch:', 'Security baseline: release provenance supports manual dispatch');
  includes(workflow, 'tags:', 'Security baseline: release provenance is tag-triggered');
  includes(workflow, '- "v*-evaluation"', 'Security baseline: release provenance only targets evaluation tags');
  includes(workflow, 'contents: read', 'Security baseline: release provenance keeps contents read-only');
  includes(workflow, 'attestations: write', 'Security baseline: release provenance has attestation permission');
  includes(workflow, 'id-token: write', 'Security baseline: release provenance has OIDC permission');
  includes(workflow, 'uses: actions/attest@v4', 'Security baseline: release provenance uses the current attest action');
  includes(workflow, 'npm run proof:surface', 'Security baseline: release provenance renders proof surface');
  includes(workflow, 'npm run showcase:proof', 'Security baseline: release provenance renders the offline-capable proof showcase');
  excludes(workflow, /showcase:proof:hybrid/iu, 'Security baseline: release provenance must not depend on live-upstream hybrid proof');
}

function testAttestationPlanKeepsPermissionsAndClaimsScoped(): void {
  const plan = readProjectFile('docs', '08-deployment', 'artifact-attestation-plan.md');

  includes(plan, '# Artifact Attestation Plan', 'Security baseline: attestation plan title is stable');
  includes(plan, 'Evaluation Smoke', 'Security baseline: plan names the current smoke workflow');
  includes(plan, 'Full Verify', 'Security baseline: plan names the current full verify workflow');
  includes(plan, 'Release Provenance', 'Security baseline: plan names the dedicated provenance workflow');
  includes(plan, 'permissions:\n  contents: read', 'Security baseline: plan captures the current read-only baseline');
  includes(plan, 'attestations: write', 'Security baseline: plan scopes future attestation permission');
  includes(plan, 'id-token: write', 'Security baseline: plan scopes future OIDC permission');
  includes(plan, 'release-provenance.yml', 'Security baseline: plan points at the concrete workflow file');
  includes(plan, 'gh attestation verify evaluation-artifacts.tar.gz -R 0xlamarr-labs/attestor', 'Security baseline: plan documents reviewer verification');
  includes(plan, 'does not claim full production supply-chain provenance', 'Security baseline: plan stays honest about scope');
  excludes(plan, /\bfull production supply-chain provenance is complete\b/iu, 'Security baseline: plan must not overclaim provenance scope');
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
testReleaseProvenanceWorkflowKeepsElevatedPermissionsScoped();
testAttestationPlanKeepsPermissionsAndClaimsScoped();
testPackageExposesSecurityDocsGuard();

console.log(`Security baseline docs tests: ${passed} passed, 0 failed`);
