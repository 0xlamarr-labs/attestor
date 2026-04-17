import assert from 'node:assert/strict';
import { generateKeyPair } from '../src/signing/keys.js';
import {
  createPolicyBundleEntry,
  createPolicyBundleManifest,
  createPolicyPackMetadata,
} from '../src/release-policy-control-plane/object-model.js';
import {
  createPolicyBundleSigner,
  verifyIssuedPolicyBundle,
} from '../src/release-policy-control-plane/bundle-signing.js';
import {
  computePolicyBundleEntryDigest,
  createSignablePolicyBundleArtifact,
} from '../src/release-policy-control-plane/bundle-format.js';
import { createPolicyActivationTarget } from '../src/release-policy-control-plane/types.js';
import { policy } from '../src/release-layer/index.js';

function sampleBundleReference(bundleId = 'bundle_finance_core_2026_04_17') {
  return {
    packId: 'finance-core',
    bundleId,
    bundleVersion: '2026.04.17',
    digest: `sha256:${bundleId}`,
  } as const;
}

function sampleArtifact() {
  const pack = createPolicyPackMetadata({
    id: 'finance-core',
    name: 'Finance Core',
    lifecycleState: 'published',
    createdAt: '2026-04-17T13:00:00.000Z',
    latestBundleRef: sampleBundleReference(),
  });
  const definition = policy.createFirstHardGatewayReleasePolicy();
  const target = createPolicyActivationTarget({
    environment: 'prod-eu',
    tenantId: 'tenant-finance',
    domainId: 'finance',
    wedgeId: 'finance.record.release',
    consequenceType: 'record',
    riskClass: 'R4',
  });
  const provisionalEntry = createPolicyBundleEntry({
    id: 'entry-record-r4',
    scopeTarget: target,
    definition,
    policyHash: 'sha256:placeholder',
  });
  const entry = createPolicyBundleEntry({
    id: 'entry-record-r4',
    scopeTarget: target,
    definition,
    policyHash: computePolicyBundleEntryDigest(provisionalEntry),
  });
  const manifest = createPolicyBundleManifest({
    bundle: sampleBundleReference(),
    pack,
    generatedAt: '2026-04-17T13:05:00.000Z',
    entries: [entry],
  });

  return createSignablePolicyBundleArtifact(pack, manifest);
}

function testSignAndVerifyRoundTrip(): void {
  const keyPair = generateKeyPair();
  const signer = createPolicyBundleSigner({
    issuer: 'attestor.policy-control-plane',
    privateKeyPem: keyPair.privateKeyPem,
    publicKeyPem: keyPair.publicKeyPem,
  });
  const issued = signer.sign({
    artifact: sampleArtifact(),
    signedAt: '2026-04-17T13:10:00.000Z',
  });
  const verification = verifyIssuedPolicyBundle({ issuedBundle: issued });

  assert.equal(verification.valid, true);
  assert.equal(verification.bundleId, issued.artifact.bundleId);
  assert.equal(issued.signatureRecord.algorithm, 'EdDSA');
  assert.equal(issued.signatureRecord.envelopeType, 'dsse');
}

function testWrongKeyFails(): void {
  const signerKey = generateKeyPair();
  const wrongKey = generateKeyPair();
  const signer = createPolicyBundleSigner({
    issuer: 'attestor.policy-control-plane',
    privateKeyPem: signerKey.privateKeyPem,
    publicKeyPem: signerKey.publicKeyPem,
  });
  const issued = signer.sign({
    artifact: sampleArtifact(),
  });

  assert.throws(
    () =>
      verifyIssuedPolicyBundle({
        issuedBundle: issued,
        verificationKey: {
          ...signer.exportVerificationKey(),
          publicKeyPem: wrongKey.publicKeyPem,
          publicKeyFingerprint: wrongKey.fingerprint,
        },
      }),
    /fingerprint|invalid/i,
  );
}

function testPayloadTamperFails(): void {
  const keyPair = generateKeyPair();
  const signer = createPolicyBundleSigner({
    issuer: 'attestor.policy-control-plane',
    privateKeyPem: keyPair.privateKeyPem,
    publicKeyPem: keyPair.publicKeyPem,
  });
  const issued = signer.sign({
    artifact: sampleArtifact(),
  });

  const payload = Buffer.from(issued.envelope.payload, 'base64').toString('utf-8');
  const tamperedPayload = payload.replace('finance-core', 'finance-core-tampered');
  const tampered = {
    ...issued,
    envelope: {
      ...issued.envelope,
      payload: Buffer.from(tamperedPayload, 'utf-8').toString('base64'),
    },
  } as const;

  assert.throws(
    () => verifyIssuedPolicyBundle({ issuedBundle: tampered }),
    /invalid|does not match/i,
  );
}

function testSignatureRecordPayloadDigestMismatchFails(): void {
  const keyPair = generateKeyPair();
  const signer = createPolicyBundleSigner({
    issuer: 'attestor.policy-control-plane',
    privateKeyPem: keyPair.privateKeyPem,
    publicKeyPem: keyPair.publicKeyPem,
  });
  const issued = signer.sign({
    artifact: sampleArtifact(),
  });

  const tampered = {
    ...issued,
    signatureRecord: {
      ...issued.signatureRecord,
      payloadDigest: 'sha256:not-the-real-digest',
    },
  } as const;

  assert.throws(
    () => verifyIssuedPolicyBundle({ issuedBundle: tampered }),
    /payload digest/i,
  );
}

function testSignatureRecordBundleMismatchFails(): void {
  const keyPair = generateKeyPair();
  const signer = createPolicyBundleSigner({
    issuer: 'attestor.policy-control-plane',
    privateKeyPem: keyPair.privateKeyPem,
    publicKeyPem: keyPair.publicKeyPem,
  });
  const issued = signer.sign({
    artifact: sampleArtifact(),
  });

  const tampered = {
    ...issued,
    signatureRecord: {
      ...issued.signatureRecord,
      bundle: {
        ...issued.signatureRecord.bundle,
        bundleId: 'bundle_tampered',
      },
    },
  } as const;

  assert.throws(
    () => verifyIssuedPolicyBundle({ issuedBundle: tampered }),
    /bundle reference/i,
  );
}

testSignAndVerifyRoundTrip();
testWrongKeyFails();
testPayloadTamperFails();
testSignatureRecordPayloadDigestMismatchFails();
testSignatureRecordBundleMismatchFails();

console.log('Release policy control-plane bundle-signing tests: 22 passed, 0 failed');
