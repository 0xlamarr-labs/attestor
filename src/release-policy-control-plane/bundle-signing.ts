import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from 'node:crypto';
import {
  createPolicyBundleSignatureRecord,
  type PolicyBundleSignatureAlgorithm,
  type PolicyBundleSignatureEnvelopeType,
  type PolicyBundleSignatureRecord,
} from './object-model.js';
import {
  POLICY_BUNDLE_PAYLOAD_TYPE,
  POLICY_BUNDLE_PREDICATE_TYPE,
  POLICY_BUNDLE_STATEMENT_TYPE,
  type SignablePolicyBundleArtifact,
} from './bundle-format.js';
import { derivePublicKeyIdentity } from '../signing/keys.js';

/**
 * Cryptographic signing and verification for policy bundles.
 *
 * Step 05 adds actual provenance enforcement on top of the frozen bundle
 * artifact shape from Step 04. The signer emits a DSSE envelope plus a
 * control-plane-native signature record, and verification checks both the
 * cryptographic signature and the internal coherence of the signed bundle.
 */

export const POLICY_BUNDLE_SIGNING_SPEC_VERSION =
  'attestor.policy-bundle-signing.v1';
export const POLICY_BUNDLE_VERIFICATION_KEY_SPEC_VERSION =
  'attestor.policy-bundle-verification-key.v1';
export const POLICY_BUNDLE_VERIFICATION_SPEC_VERSION =
  'attestor.policy-bundle-verification.v1';

export type PolicyBundleSigningAlgorithm = Extract<
  PolicyBundleSignatureAlgorithm,
  'EdDSA'
>;
export type PolicyBundleEnvelopeType = Extract<
  PolicyBundleSignatureEnvelopeType,
  'dsse'
>;

export interface PolicyBundleVerificationKey {
  readonly version: typeof POLICY_BUNDLE_VERIFICATION_KEY_SPEC_VERSION;
  readonly issuer: string;
  readonly algorithm: PolicyBundleSigningAlgorithm;
  readonly keyId: string;
  readonly publicKeyFingerprint: string;
  readonly publicKeyPem: string;
}

export interface PolicyBundleDsseSignature {
  readonly keyid: string;
  readonly sig: string;
}

export interface PolicyBundleDsseEnvelope {
  readonly payloadType: typeof POLICY_BUNDLE_PAYLOAD_TYPE;
  readonly payload: string;
  readonly signatures: readonly PolicyBundleDsseSignature[];
}

export interface IssuedPolicyBundleSignature {
  readonly version: typeof POLICY_BUNDLE_SIGNING_SPEC_VERSION;
  readonly artifact: SignablePolicyBundleArtifact;
  readonly envelope: PolicyBundleDsseEnvelope;
  readonly signatureRecord: PolicyBundleSignatureRecord;
  readonly verificationKey: PolicyBundleVerificationKey;
  readonly signedAt: string;
  readonly keyId: string;
  readonly publicKeyFingerprint: string;
}

export interface CreatePolicyBundleSignerInput {
  readonly issuer: string;
  readonly privateKeyPem: string;
  readonly publicKeyPem: string;
  readonly keyId?: string;
  readonly algorithm?: PolicyBundleSigningAlgorithm;
  readonly envelopeType?: PolicyBundleEnvelopeType;
}

export interface PolicyBundleSignInput {
  readonly artifact: SignablePolicyBundleArtifact;
  readonly signedAt?: string;
}

export interface PolicyBundleSigner {
  sign(input: PolicyBundleSignInput): IssuedPolicyBundleSignature;
  exportVerificationKey(): PolicyBundleVerificationKey;
}

export interface VerifyIssuedPolicyBundleInput {
  readonly issuedBundle: IssuedPolicyBundleSignature;
  readonly verificationKey?: PolicyBundleVerificationKey;
}

export interface PolicyBundleVerificationResult {
  readonly version: typeof POLICY_BUNDLE_VERIFICATION_SPEC_VERSION;
  readonly valid: true;
  readonly bundleId: string;
  readonly keyId: string;
  readonly publicKeyFingerprint: string;
  readonly payloadDigest: string;
  readonly predicateType: string;
}

function resolveSignedAt(value?: string): string {
  const timestamp = value ? new Date(value) : new Date();
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error('Policy bundle signing requires a valid signedAt timestamp.');
  }

  return timestamp.toISOString();
}

function dssePreAuthEncoding(payloadType: string, payload: Buffer): Buffer {
  const payloadTypeBuffer = Buffer.from(payloadType, 'utf-8');
  return Buffer.concat([
    Buffer.from('DSSEv1 ', 'utf-8'),
    Buffer.from(String(payloadTypeBuffer.length), 'utf-8'),
    Buffer.from(' ', 'utf-8'),
    payloadTypeBuffer,
    Buffer.from(' ', 'utf-8'),
    Buffer.from(String(payload.length), 'utf-8'),
    Buffer.from(' ', 'utf-8'),
    payload,
  ]);
}

function assertArtifactSignable(artifact: SignablePolicyBundleArtifact): void {
  if (artifact.payloadType !== POLICY_BUNDLE_PAYLOAD_TYPE) {
    throw new Error('Policy bundle signing requires the expected DSSE payload type.');
  }
  if (artifact.statement._type !== POLICY_BUNDLE_STATEMENT_TYPE) {
    throw new Error('Policy bundle signing requires the expected in-toto statement type.');
  }
  if (artifact.statement.predicateType !== POLICY_BUNDLE_PREDICATE_TYPE) {
    throw new Error('Policy bundle signing requires the expected policy-bundle predicate type.');
  }
}

export function createPolicyBundleSigner(
  input: CreatePolicyBundleSignerInput,
): PolicyBundleSigner {
  const algorithm = input.algorithm ?? 'EdDSA';
  const envelopeType = input.envelopeType ?? 'dsse';
  const keyIdentity = derivePublicKeyIdentity(input.publicKeyPem);
  const keyId = input.keyId ?? keyIdentity.fingerprint;
  const verificationKey: PolicyBundleVerificationKey = Object.freeze({
    version: POLICY_BUNDLE_VERIFICATION_KEY_SPEC_VERSION,
    issuer: input.issuer,
    algorithm,
    keyId,
    publicKeyFingerprint: keyIdentity.fingerprint,
    publicKeyPem: input.publicKeyPem,
  });

  return {
    sign(signInput: PolicyBundleSignInput): IssuedPolicyBundleSignature {
      assertArtifactSignable(signInput.artifact);
      const signedAt = resolveSignedAt(signInput.signedAt);
      const payload = Buffer.from(signInput.artifact.canonicalPayload, 'utf-8');
      const pae = dssePreAuthEncoding(signInput.artifact.payloadType, payload);
      const signature = sign(null, pae, createPrivateKey(input.privateKeyPem));
      const envelope: PolicyBundleDsseEnvelope = Object.freeze({
        payloadType: signInput.artifact.payloadType,
        payload: payload.toString('base64'),
        signatures: Object.freeze([
          Object.freeze({
            keyid: keyId,
            sig: signature.toString('base64'),
          }),
        ]),
      });
      const signatureRecord = createPolicyBundleSignatureRecord({
        bundle: signInput.artifact.statement.predicate.manifest.bundle,
        envelopeType,
        algorithm,
        keyId,
        signerFingerprint: keyIdentity.fingerprint,
        signedAt,
        payloadDigest: signInput.artifact.payloadDigest,
        signature: signature.toString('base64'),
      });

      return Object.freeze({
        version: POLICY_BUNDLE_SIGNING_SPEC_VERSION,
        artifact: signInput.artifact,
        envelope,
        signatureRecord,
        verificationKey,
        signedAt,
        keyId,
        publicKeyFingerprint: keyIdentity.fingerprint,
      });
    },

    exportVerificationKey(): PolicyBundleVerificationKey {
      return verificationKey;
    },
  };
}

export function verifyIssuedPolicyBundle(
  input: VerifyIssuedPolicyBundleInput,
): PolicyBundleVerificationResult {
  const issuedBundle = input.issuedBundle;
  const verificationKey = input.verificationKey ?? issuedBundle.verificationKey;
  const payload = Buffer.from(issuedBundle.envelope.payload, 'base64');
  const pae = dssePreAuthEncoding(issuedBundle.envelope.payloadType, payload);
  const dsseSignature = issuedBundle.envelope.signatures[0];
  if (!dsseSignature) {
    throw new Error('Policy bundle envelope is missing DSSE signatures.');
  }

  if (issuedBundle.signatureRecord.keyId !== verificationKey.keyId) {
    throw new Error('Policy bundle signature record keyId does not match the verification key.');
  }
  if (
    issuedBundle.signatureRecord.signerFingerprint !==
    verificationKey.publicKeyFingerprint
  ) {
    throw new Error(
      'Policy bundle signature record fingerprint does not match the verification key.',
    );
  }
  if (issuedBundle.signatureRecord.signature !== dsseSignature.sig) {
    throw new Error(
      'Policy bundle signature record does not match the DSSE envelope signature.',
    );
  }
  if (issuedBundle.signatureRecord.payloadDigest !== issuedBundle.artifact.payloadDigest) {
    throw new Error(
      'Policy bundle signature record payload digest does not match the bundle artifact.',
    );
  }
  if (
    issuedBundle.signatureRecord.bundle.bundleId !==
      issuedBundle.artifact.statement.predicate.manifest.bundle.bundleId ||
    issuedBundle.signatureRecord.bundle.packId !==
      issuedBundle.artifact.statement.predicate.manifest.bundle.packId
  ) {
    throw new Error(
      'Policy bundle signature record bundle reference does not match the artifact manifest.',
    );
  }

  const valid = verify(
    null,
    pae,
    createPublicKey(verificationKey.publicKeyPem),
    Buffer.from(dsseSignature.sig, 'base64'),
  );
  if (!valid) {
    throw new Error('Policy bundle DSSE signature is invalid.');
  }

  const payloadText = payload.toString('utf-8');
  if (payloadText !== issuedBundle.artifact.canonicalPayload) {
    throw new Error('Policy bundle DSSE payload does not match the canonical bundle payload.');
  }

  return {
    version: POLICY_BUNDLE_VERIFICATION_SPEC_VERSION,
    valid: true,
    bundleId: issuedBundle.artifact.bundleId,
    keyId: verificationKey.keyId,
    publicKeyFingerprint: verificationKey.publicKeyFingerprint,
    payloadDigest: issuedBundle.artifact.payloadDigest,
    predicateType: issuedBundle.artifact.statement.predicateType,
  };
}
