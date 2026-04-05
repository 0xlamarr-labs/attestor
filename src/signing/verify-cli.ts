/**
 * Attestor Verify CLI
 *
 * Standalone verification of attestation certificates.
 * Requires only the certificate JSON and the signer's public key.
 * No database, no API, no platform access needed.
 *
 * Usage:
 *   npx tsx src/signing/verify-cli.ts <certificate.json> <public-key.pem>
 */

import { readFileSync } from 'node:fs';
import { verifyCertificate, type AttestationCertificate } from './certificate.js';

function main(): void {
  const args = process.argv.slice(2);

  if (args.length < 2 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
  Attestor Verify — Independent Certificate Verification

  Usage:
    npx tsx src/signing/verify-cli.ts <certificate.json> <public-key.pem>

  Verifies an attestation certificate against the signer's public key.
  No platform access or database connection required.

  Exit codes:
    0  Certificate is valid
    1  Certificate is invalid or verification failed
    2  Usage error
`);
    process.exit(args.length < 2 ? 2 : 0);
  }

  const [certPath, keyPath] = args;

  try {
    const certJson = readFileSync(certPath, 'utf-8');
    const publicKeyPem = readFileSync(keyPath, 'utf-8');

    let certificate: AttestationCertificate;
    try {
      certificate = JSON.parse(certJson);
    } catch {
      console.error(`  ✗ Failed to parse certificate JSON: ${certPath}`);
      process.exit(1);
    }

    console.log(`\n  Attestor Verify — Certificate Verification`);
    console.log(`  Certificate: ${certificate.certificateId ?? 'unknown'}`);
    console.log(`  Run:         ${certificate.runIdentity ?? 'unknown'}`);
    console.log(`  Decision:    ${certificate.decision ?? 'unknown'}`);
    console.log(`  Issued:      ${certificate.issuedAt ?? 'unknown'}`);
    console.log(`  Signer:      ${certificate.signing?.fingerprint ?? 'unknown'}`);
    console.log('');

    const result = verifyCertificate(certificate, publicKeyPem);

    console.log(`  Signature:     ${result.signatureValid ? '✓ valid' : '✗ INVALID'}`);
    console.log(`  Fingerprint:   ${result.fingerprintConsistent ? '✓ consistent' : '✗ MISMATCH'}`);
    console.log(`  Schema:        ${result.schemaValid ? '✓ valid' : '✗ INVALID'}`);
    console.log(`  Overall:       ${result.overall === 'valid' ? '✓ VALID' : '✗ ' + result.overall.toUpperCase()}`);
    console.log('');
    console.log(`  ${result.explanation}`);
    console.log('');

    if (result.overall === 'valid') {
      console.log(`  Authority chain:`);
      console.log(`    Warrant:  ${certificate.authority.warrantStatus} (${certificate.authority.obligationsFulfilled}/${certificate.authority.obligationsTotal} obligations)`);
      console.log(`    Escrow:   ${certificate.authority.escrowState}`);
      console.log(`    Receipt:  ${certificate.authority.receiptStatus}`);
      console.log(`    Capsule:  ${certificate.authority.capsuleAuthority}`);
      console.log('');
      console.log(`  Evidence:`);
      console.log(`    Chain:    ${certificate.evidence.evidenceChainRoot.slice(0, 8)}...${certificate.evidence.evidenceChainTerminal.slice(0, 8)}`);
      console.log(`    Audit:    ${certificate.evidence.auditEntryCount} entries, chain ${certificate.evidence.auditChainIntact ? 'intact' : 'BROKEN'}`);
      console.log(`    SQL:      ${certificate.evidence.sqlHash.slice(0, 16)}`);
      console.log(`    Snapshot: ${certificate.evidence.snapshotHash.slice(0, 16)}`);
      console.log('');
      console.log(`  Governance:`);
      console.log(`    SQL:      ${certificate.governance.sqlGovernance}`);
      console.log(`    Policy:   ${certificate.governance.policy}`);
      console.log(`    Guards:   ${certificate.governance.guardrails}`);
      console.log(`    Data:     ${certificate.governance.dataContracts}`);
      console.log(`    Scorers:  ${certificate.governance.scorersRun}`);
      console.log(`    Review:   ${certificate.governance.reviewRequired ? 'required' : 'not required'}`);
      console.log('');
      console.log(`  Live Proof:`);
      console.log(`    Mode:     ${certificate.liveProof.mode}`);
      console.log(`    Upstream: ${certificate.liveProof.upstreamLive ? 'live' : 'fixture'}`);
      console.log(`    Execution:${certificate.liveProof.executionLive ? 'live' : 'fixture'}`);
      console.log(`    Consistent:${certificate.liveProof.consistent ? 'yes' : 'NO'}`);
      console.log('');
    }

    process.exit(result.overall === 'valid' ? 0 : 1);
  } catch (err) {
    console.error(`  ✗ Verification error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
