import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyCertificate, type AttestationCertificate } from '../src/signing/certificate.js';
import { verifyTrustChain, type TrustChain } from '../src/signing/pki-chain.js';
import {
  loadCommittedFinancialReportingPacket,
  renderFinancialReportingLandingPage,
  renderFinancialReportingProofPage,
} from '../src/service/site.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

async function main(): Promise<void> {
  const evidenceRoot = resolve('docs', 'evidence', 'financial-reporting-acceptance-live-hybrid');
  const packet = loadCommittedFinancialReportingPacket();
  ok(packet !== null, 'Finance acceptance surface: committed packet is present');
  ok(packet?.title === 'Attestor Financial Reporting Acceptance Packet', 'Finance acceptance surface: packet title is finance-specific');
  ok(packet?.proofRun.label.includes('Counterparty exposure reporting acceptance'), 'Finance acceptance surface: packet label names the reporting workflow');
  ok(packet?.proofRun.sourceProofDir === null, 'Finance acceptance surface: committed packet hides the internal source proof directory');
  ok(packet?.proofRun.certificateId === null, 'Finance acceptance surface: committed packet hides the internal certificate identifier');
  ok(packet?.proofRun.reviewerName === null, 'Finance acceptance surface: committed packet hides reviewer identity');

  const landing = renderFinancialReportingLandingPage(packet);
  ok(landing.includes('AI-assisted financial reporting acceptance'), 'Finance acceptance surface: landing page leads with the finance wedge');
  ok(landing.includes('/proof/financial-reporting-acceptance'), 'Finance acceptance surface: landing page points at the proof surface');
  ok(landing.includes('Community') && landing.includes('Starter') && landing.includes('Pro') && landing.includes('Enterprise'), 'Finance acceptance surface: landing page includes the plan ladder');
  ok(landing.includes('Reviewer endorsement') && !landing.includes('Attestor Live Reviewer'), 'Finance acceptance surface: landing page keeps reviewer proof without exposing reviewer identity');

  const proofPage = renderFinancialReportingProofPage(packet);
  ok(proofPage.includes('shown as evidence instead of promise'), 'Finance acceptance surface: proof page frames the proof as evidence');
  ok(!proofPage.includes('.attestor-financial/runs/'), 'Finance acceptance surface: proof page does not expose internal source proof paths');
  ok(!proofPage.includes('cert_'), 'Finance acceptance surface: proof page does not expose internal certificate identifiers');
  ok(!proofPage.includes('Attestor Live Reviewer'), 'Finance acceptance surface: proof page does not expose reviewer identity');

  const certificate = JSON.parse(readFileSync(resolve(evidenceRoot, 'evidence', 'certificate.json'), 'utf8')) as AttestationCertificate;
  const publicKeyPem = readFileSync(resolve(evidenceRoot, 'evidence', 'public-key.pem'), 'utf8');
  const certificateVerification = verifyCertificate(certificate, publicKeyPem);
  ok(certificateVerification.overall === 'valid', 'Finance acceptance surface: committed certificate verifies against the committed signer public key');

  const trustChain = JSON.parse(readFileSync(resolve(evidenceRoot, 'evidence', 'trust-chain.json'), 'utf8')) as TrustChain;
  const caPublicKeyPem = readFileSync(resolve(evidenceRoot, 'evidence', 'ca-public.pem'), 'utf8');
  const chainVerification = verifyTrustChain(trustChain, caPublicKeyPem);
  ok(chainVerification.overall === 'valid', 'Finance acceptance surface: committed trust chain verifies against the committed CA public key');

  console.log(`\nFinancial reporting acceptance surface tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nFinancial reporting acceptance surface tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
