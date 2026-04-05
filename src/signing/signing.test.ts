/**
 * Attestor Signing — Test Suite
 *
 * Verifies Ed25519 key generation, signing, verification,
 * certificate issuance, and certificate verification.
 */

import { strict as assert } from 'node:assert';
import { generateKeyPair, derivePublicKeyIdentity } from './keys.js';
import { signPayload, verifySignature, canonicalize } from './sign.js';
import { issueCertificate, verifyCertificate, type CertificateInput } from './certificate.js';

function makeCertInput(): CertificateInput {
  return {
    runIdentity: 'test-run-001',
    decision: 'pass',
    decisionSummary: 'All governance gates passed. 8 scorers: pass.',
    warrant: { status: 'fulfilled', obligationsFulfilled: 7, obligationsTotal: 7 },
    escrow: { state: 'released' },
    receipt: { status: 'issued' },
    capsule: { authority: 'authorized' },
    evidenceChainRoot: 'abc123root',
    evidenceChainTerminal: 'def456terminal',
    auditChainIntact: true,
    auditEntryCount: 14,
    sqlHash: 'sql_hash_001',
    snapshotHash: 'snap_hash_001',
    sqlGovernance: 'pass',
    policy: 'pass',
    guardrails: 'pass',
    dataContracts: 'pass',
    scorersRun: 8,
    reviewRequired: false,
    liveProofMode: 'offline_fixture',
    upstreamLive: false,
    executionLive: false,
    liveProofConsistent: true,
  };
}

async function runSigningTests(): Promise<number> {
  let passed = 0;

  console.log('\n  [Ed25519 Key Generation]');

  const kp = generateKeyPair();
  assert(kp.privateKeyPem.includes('BEGIN PRIVATE KEY'), 'Private key is PEM');
  assert(kp.publicKeyPem.includes('BEGIN PUBLIC KEY'), 'Public key is PEM');
  assert(kp.publicKeyHex.length === 64, 'Public key hex is 32 bytes (64 hex chars)');
  assert(kp.fingerprint.length === 16, 'Fingerprint is 16 hex chars');
  passed += 4;
  console.log(`    KeyGen: pub=${kp.publicKeyHex.slice(0, 8)}... fp=${kp.fingerprint}`);

  // Derived identity matches
  const derived = derivePublicKeyIdentity(kp.publicKeyPem);
  assert(derived.publicKeyHex === kp.publicKeyHex, 'Derived public key matches');
  assert(derived.fingerprint === kp.fingerprint, 'Derived fingerprint matches');
  passed += 2;

  console.log('\n  [Ed25519 Sign & Verify]');

  const payload = 'test payload for signing';
  const sig = signPayload(payload, kp.privateKeyPem);
  assert(sig.length === 128, 'Signature is 64 bytes (128 hex chars)');
  passed++;

  const valid = verifySignature(payload, sig, kp.publicKeyPem);
  assert(valid === true, 'Valid signature verifies');
  passed++;

  const tampered = verifySignature(payload + 'x', sig, kp.publicKeyPem);
  assert(tampered === false, 'Tampered payload fails verification');
  passed++;

  const wrongKey = generateKeyPair();
  const wrongKeyVerify = verifySignature(payload, sig, wrongKey.publicKeyPem);
  assert(wrongKeyVerify === false, 'Wrong key fails verification');
  passed++;

  console.log('    Sign/Verify: all correct');

  console.log('\n  [Canonicalization]');

  const obj = { b: 2, a: 1, c: { z: 3, y: 4 } };
  const canon = canonicalize(obj);
  assert(canon === '{"a":1,"b":2,"c":{"y":4,"z":3}}', 'Keys sorted recursively');
  passed++;

  // Deterministic
  assert(canonicalize(obj) === canonicalize({ c: { y: 4, z: 3 }, a: 1, b: 2 }), 'Different key order → same canonical');
  passed++;
  console.log('    Canonical: deterministic');

  console.log('\n  [Certificate Issuance]');

  const input = makeCertInput();
  const cert = issueCertificate(input, kp);

  assert(cert.version === '1.0', 'Certificate version is 1.0');
  assert(cert.type === 'attestor.certificate.v1', 'Certificate type is correct');
  assert(cert.certificateId.startsWith('cert_'), 'Certificate ID has cert_ prefix');
  assert(cert.decision === 'pass', 'Decision preserved');
  assert(cert.authority.warrantStatus === 'fulfilled', 'Warrant status preserved');
  assert(cert.evidence.evidenceChainRoot === 'abc123root', 'Evidence chain root preserved');
  assert(cert.signing.algorithm === 'ed25519', 'Signing algorithm is ed25519');
  assert(cert.signing.publicKey === kp.publicKeyHex, 'Signing public key matches');
  assert(cert.signing.fingerprint === kp.fingerprint, 'Signing fingerprint matches');
  assert(cert.signing.signature.length === 128, 'Certificate signature is 64 bytes');
  passed += 10;
  console.log(`    Certificate: ${cert.certificateId} issued`);

  console.log('\n  [Certificate Verification]');

  const verification = verifyCertificate(cert, kp.publicKeyPem);
  assert(verification.signatureValid === true, 'Certificate signature valid');
  assert(verification.fingerprintConsistent === true, 'Fingerprint consistent');
  assert(verification.schemaValid === true, 'Schema valid');
  assert(verification.overall === 'valid', 'Overall: valid');
  passed += 4;
  console.log(`    Verification: ${verification.overall}`);

  // Tamper detection
  const tamperCert = { ...cert, decision: 'fail' as const };
  const tamperVerify = verifyCertificate(tamperCert, kp.publicKeyPem);
  assert(tamperVerify.signatureValid === false, 'Tampered certificate fails signature');
  assert(tamperVerify.overall === 'invalid', 'Tampered overall: invalid');
  passed += 2;

  // Wrong key
  const wrongKeyVerify2 = verifyCertificate(cert, wrongKey.publicKeyPem);
  assert(wrongKeyVerify2.signatureValid === false, 'Wrong key fails certificate verification');
  assert(wrongKeyVerify2.overall === 'invalid', 'Wrong key overall: invalid');
  passed += 2;

  // Fail decision certificate
  const failInput = { ...input, decision: 'fail' as const, decisionSummary: 'Data contract failure' };
  const failCert = issueCertificate(failInput, kp);
  assert(failCert.decision === 'fail', 'Fail decision preserved in certificate');
  const failVerify = verifyCertificate(failCert, kp.publicKeyPem);
  assert(failVerify.overall === 'valid', 'Fail-decision certificate still has valid signature');
  passed += 2;
  console.log('    Tamper detection + wrong-key rejection: correct');

  console.log(`\n  Signing Tests: ${passed} passed, 0 failed\n`);
  return passed;
}

// Auto-run
runSigningTests().then((passed) => {
  process.exit(passed > 0 ? 0 : 1);
}).catch((err) => {
  console.error('  Signing test suite crashed:', err);
  process.exit(1);
});
