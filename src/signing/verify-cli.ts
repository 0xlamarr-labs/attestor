/**
 * Attestor Verify CLI — Multi-Dimensional Certificate + Kit Verification
 *
 * Verifies attestation certificates beyond signature validity:
 * 1. Cryptographic validity (Ed25519 signature)
 * 2. Structural validity (certificate schema)
 * 3. Authority state (warrant/escrow/receipt closure)
 * 4. Governance sufficiency (did enough gates pass?)
 * 5. Proof completeness (live vs fixture, gaps)
 *
 * Usage:
 *   npx tsx src/signing/verify-cli.ts <certificate.json> <public-key.pem>
 *   npx tsx src/signing/verify-cli.ts <kit.json>
 */

import { readFileSync } from 'node:fs';
import { verifyCertificate, type AttestationCertificate } from './certificate.js';
import { buildVerificationSummary, type VerificationKit, type AuthorityBundle } from './bundle.js';
import { derivePublicKeyIdentity } from './keys.js';

function main(): void {
  const args = process.argv.slice(2);

  if (args.length < 1 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
  Attestor Verify — Multi-Dimensional Attestation Verification

  Usage:
    npx tsx src/signing/verify-cli.ts <certificate.json> <public-key.pem>
    npx tsx src/signing/verify-cli.ts <kit.json>

  Verifies cryptographic integrity, authority state, governance sufficiency,
  and proof completeness. No platform access required.

  Exit codes:
    0  Fully verified
    1  Verification failed or degraded
    2  Usage error
`);
    process.exit(args.length < 1 ? 2 : 0);
  }

  try {
    const firstFile = JSON.parse(readFileSync(args[0], 'utf-8'));

    // Detect whether this is a kit or a standalone certificate
    if (firstFile.type === 'attestor.verification_kit.v1') {
      verifyKit(firstFile as VerificationKit);
    } else if (firstFile.type === 'attestor.certificate.v1') {
      if (!args[1]) {
        console.error('  ✗ Certificate verification requires a public key PEM file as second argument.');
        process.exit(2);
      }
      const publicKeyPem = readFileSync(args[1], 'utf-8');
      verifyCertificateStandalone(firstFile as AttestationCertificate, publicKeyPem);
    } else {
      console.error(`  ✗ Unknown artifact type: ${firstFile.type ?? 'none'}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`  ✗ Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

function verifyCertificateStandalone(cert: AttestationCertificate, publicKeyPem: string): void {
  console.log(`\n  Attestor Verify — Certificate`);
  console.log(`  ID:       ${cert.certificateId}`);
  console.log(`  Run:      ${cert.runIdentity}`);
  console.log(`  Decision: ${cert.decision}`);
  console.log(`  Issued:   ${cert.issuedAt}`);
  console.log(`  Signer:   ${cert.signing?.fingerprint ?? 'unknown'}`);

  const crypto = verifyCertificate(cert, publicKeyPem);

  // Build a minimal authority bundle from certificate fields for summary
  const minimalBundle: AuthorityBundle = {
    version: '1.0', type: 'attestor.authority_bundle.v1',
    runId: cert.runIdentity, timestamp: cert.issuedAt, decision: cert.decision,
    authority: {
      warrant: { id: 'from-cert', status: cert.authority.warrantStatus, trustLevel: 'unknown', obligationsFulfilled: cert.authority.obligationsFulfilled, obligationsTotal: cert.authority.obligationsTotal },
      escrow: { state: cert.authority.escrowState, releasedCount: 0, totalObligations: 0, reviewHeld: false },
      receipt: { id: null, status: cert.authority.receiptStatus, signatureMode: 'unknown' },
      capsule: { id: null, authorityState: cert.authority.capsuleAuthority, factCount: 0 },
    },
    evidence: { chainRoot: cert.evidence.evidenceChainRoot, chainTerminal: cert.evidence.evidenceChainTerminal, auditEntryCount: cert.evidence.auditEntryCount, auditChainIntact: cert.evidence.auditChainIntact, sqlHash: cert.evidence.sqlHash, snapshotHash: cert.evidence.snapshotHash },
    governance: {
      sqlGovernance: { result: cert.governance.sqlGovernance, gatesPassed: 0, gatesTotal: 0 },
      policy: { result: cert.governance.policy, leastPrivilegePreserved: true },
      guardrails: { result: cert.governance.guardrails, checksRun: 0 },
      dataContracts: { result: cert.governance.dataContracts, checksRun: 0, failedCount: 0 },
      scoring: { decision: cert.decision, scorersRun: cert.governance.scorersRun, passCount: 0, failCount: 0, warnCount: 0 },
      review: { required: cert.governance.reviewRequired, triggeredBy: [], endorsement: null },
    },
    proof: { mode: cert.liveProof.mode, upstreamLive: cert.liveProof.upstreamLive, executionLive: cert.liveProof.executionLive, consistent: cert.liveProof.consistent, gapCategories: [] },
    filing: { status: 'unknown', blockingGapCount: 0 },
  };

  const summary = buildVerificationSummary(cert, minimalBundle, crypto);
  printSummary(summary);
  process.exit(summary.overall === 'verified' ? 0 : 1);
}

function verifyKit(kit: VerificationKit): void {
  console.log(`\n  Attestor Verify — Verification Kit`);
  console.log(`  Run:      ${kit.bundle.runId}`);
  console.log(`  Decision: ${kit.bundle.decision}`);

  const crypto = verifyCertificate(kit.certificate, kit.signerPublicKeyPem);
  const summary = buildVerificationSummary(kit.certificate, kit.bundle, crypto);
  printSummary(summary);
  process.exit(summary.overall === 'verified' ? 0 : 1);
}

function printSummary(s: VerificationSummary): void {
  const icon = (ok: boolean) => ok ? '✓' : '✗';

  console.log(`\n  ── Cryptographic ──`);
  console.log(`  ${icon(s.cryptographic.valid)} Signature:   ${s.cryptographic.valid ? 'valid' : 'INVALID'} (${s.cryptographic.algorithm}, ${s.cryptographic.fingerprint})`);

  console.log(`\n  ── Structural ──`);
  console.log(`  ${icon(s.structural.valid)} Schema:      ${s.structural.valid ? 'valid' : 'INVALID'} (${s.structural.version} ${s.structural.type})`);

  console.log(`\n  ── Authority ──`);
  console.log(`  ${icon(s.authority.warrantFulfilled)} Warrant:     ${s.authority.warrantFulfilled ? 'fulfilled' : 'incomplete'}`);
  console.log(`  ${icon(s.authority.escrowReleased)} Escrow:      ${s.authority.escrowReleased ? 'released' : 'held'}`);
  console.log(`  ${icon(s.authority.receiptIssued)} Receipt:     ${s.authority.receiptIssued ? 'issued' : 'pending'}`);
  console.log(`    State:       ${s.authority.state}`);

  console.log(`\n  ── Governance Sufficiency ──`);
  console.log(`  ${icon(s.governanceSufficiency.sqlPass)} SQL:         ${s.governanceSufficiency.sqlPass ? 'pass' : 'FAIL'}`);
  console.log(`  ${icon(s.governanceSufficiency.policyPass)} Policy:      ${s.governanceSufficiency.policyPass ? 'pass' : 'FAIL'}`);
  console.log(`  ${icon(s.governanceSufficiency.guardrailsPass)} Guardrails:  ${s.governanceSufficiency.guardrailsPass ? 'pass' : 'FAIL'}`);
  console.log(`  ${icon(s.governanceSufficiency.sufficient)} Sufficient:  ${s.governanceSufficiency.sufficient ? 'yes' : 'NO'}`);
  console.log(`    Scoring:     ${s.governanceSufficiency.scoringDecision}`);

  console.log(`\n  ── Proof Completeness ──`);
  console.log(`    Mode:        ${s.proofCompleteness.mode}`);
  console.log(`    Upstream:    ${s.proofCompleteness.upstreamLive ? 'live' : 'fixture'}`);
  console.log(`    Execution:   ${s.proofCompleteness.executionLive ? 'live' : 'fixture'}`);
  console.log(`    Gaps:        ${s.proofCompleteness.gapCount > 0 ? s.proofCompleteness.gaps.join(', ') : 'none'}`);

  console.log(`\n  ══ Overall: ${s.overall.toUpperCase()} ══\n`);
}

type VerificationSummary = import('./bundle.js').VerificationSummary;

main();
