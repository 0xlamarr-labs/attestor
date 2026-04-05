/**
 * Attestor Signing — Ed25519 Sign & Verify
 *
 * Signs and verifies arbitrary payloads using Ed25519.
 * Used by the certificate module to sign attestation certificates.
 */

import { sign, verify, createPrivateKey, createPublicKey } from 'node:crypto';

/**
 * Sign a payload with an Ed25519 private key.
 * Returns the signature as a hex string.
 */
export function signPayload(payload: string, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  const signature = sign(null, Buffer.from(payload, 'utf-8'), key);
  return signature.toString('hex');
}

/**
 * Verify a payload signature with an Ed25519 public key.
 * Returns true if the signature is valid.
 */
export function verifySignature(payload: string, signatureHex: string, publicKeyPem: string): boolean {
  try {
    const key = createPublicKey(publicKeyPem);
    return verify(null, Buffer.from(payload, 'utf-8'), key, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Canonicalize an object for signing.
 * Produces deterministic JSON by sorting keys recursively.
 */
export function canonicalize(obj: unknown): string {
  return JSON.stringify(obj, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.keys(value).sort().reduce<Record<string, unknown>>((sorted, k) => {
        sorted[k] = value[k as keyof typeof value];
        return sorted;
      }, {});
    }
    return value;
  });
}
