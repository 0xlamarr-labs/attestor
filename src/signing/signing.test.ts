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

  // ═══ PKI TRUST CHAIN ═══
  console.log('\n  [PKI Trust Chain]');
  {
    const { createCaCertificate, issueLeafCertificate, buildTrustChain, verifyTrustChain, generatePkiHierarchy } = await import('./pki-chain.js');

    // Generate full PKI hierarchy
    const pki = generatePkiHierarchy('Test CA', 'Test Signer', 'Test Reviewer');

    // CA certificate
    assert(pki.ca.certificate.type === 'attestor.ca_certificate.v1', 'PKI: CA type correct');
    assert(pki.ca.certificate.isCA === true, 'PKI: CA flag set');
    assert(pki.ca.certificate.name === 'Test CA', 'PKI: CA name');
    assert(pki.ca.certificate.fingerprint === pki.ca.keyPair.fingerprint, 'PKI: CA fingerprint matches key');
    passed += 4;

    // Leaf certificates
    assert(pki.signer.certificate.type === 'attestor.leaf_certificate.v1', 'PKI: signer leaf type');
    assert(pki.signer.certificate.subject === 'Test Signer', 'PKI: signer subject');
    assert(pki.signer.certificate.role === 'runtime_signer', 'PKI: signer role');
    assert(pki.signer.certificate.issuerFingerprint === pki.ca.certificate.fingerprint, 'PKI: signer issued by CA');
    assert(pki.reviewer.certificate.role === 'reviewer', 'PKI: reviewer role');
    assert(pki.reviewer.certificate.issuerFingerprint === pki.ca.certificate.fingerprint, 'PKI: reviewer issued by CA');
    passed += 6;

    // Verify signer chain
    const signerVerify = verifyTrustChain(pki.chains.signer, pki.ca.keyPair.publicKeyPem);
    assert(signerVerify.caValid, 'PKI: CA self-signature valid');
    assert(signerVerify.leafValid, 'PKI: signer leaf signature valid');
    assert(signerVerify.chainIntact, 'PKI: signer chain intact');
    assert(signerVerify.issuerMatch, 'PKI: signer issuer matches CA');
    assert(!signerVerify.caExpired, 'PKI: CA not expired');
    assert(!signerVerify.leafExpired, 'PKI: leaf not expired');
    assert(signerVerify.overall === 'valid', 'PKI: signer chain overall valid');
    passed += 7;

    // Verify reviewer chain
    const reviewerVerify = verifyTrustChain(pki.chains.reviewer, pki.ca.keyPair.publicKeyPem);
    assert(reviewerVerify.overall === 'valid', 'PKI: reviewer chain valid');
    passed += 1;

    // Wrong CA key fails verification
    const wrongCa = generateKeyPair();
    const wrongVerify = verifyTrustChain(pki.chains.signer, wrongCa.publicKeyPem);
    assert(!wrongVerify.caValid, 'PKI: wrong CA key fails CA verification');
    assert(!wrongVerify.leafValid, 'PKI: wrong CA key fails leaf verification');
    assert(wrongVerify.overall === 'invalid', 'PKI: wrong CA → invalid');
    passed += 3;

    // Tamper detection: modify leaf subject
    const tamperedChain = {
      ...pki.chains.signer,
      leaf: { ...pki.chains.signer.leaf, subject: 'TAMPERED' },
    };
    const tamperResult = verifyTrustChain(tamperedChain, pki.ca.keyPair.publicKeyPem);
    assert(!tamperResult.leafValid, 'PKI: tampered leaf fails verification');
    assert(tamperResult.overall === 'invalid', 'PKI: tampered chain invalid');
    passed += 2;

    // Tamper detection: modify CA name
    const tamperedCaChain = {
      ...pki.chains.signer,
      ca: { ...pki.chains.signer.ca, name: 'FAKE CA' },
    };
    const caResult = verifyTrustChain(tamperedCaChain, pki.ca.keyPair.publicKeyPem);
    assert(!caResult.caValid, 'PKI: tampered CA fails self-signature');
    passed += 1;

    console.log(`    PKI: CA=${pki.ca.certificate.name}, signer=${signerVerify.overall}, reviewer=${reviewerVerify.overall}`);
    console.log(`    Tamper: leaf=${!tamperResult.leafValid}, ca=${!caResult.caValid}, wrongKey=${wrongVerify.overall}`);
  }

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
