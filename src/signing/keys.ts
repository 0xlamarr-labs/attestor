/**
 * Attestor Signing — Ed25519 Key Management
 *
 * Ed25519 is chosen because:
 * - 32-byte keys, 64-byte signatures (compact for certificates)
 * - Deterministic signatures (same input → same output, important for replay)
 * - Fast verification (~76μs on modern hardware)
 * - Available natively in Node.js 22+ (no npm dependencies)
 * - Used by Sigstore, SLSA, SSH, and many attestation systems
 *
 * Trust model upgrade:
 * - HMAC-SHA256 (old): proves integrity to anyone with the shared key.
 *   Anyone with the key can forge signatures. No identity.
 * - Ed25519 (new): proves integrity AND signer identity. Only the
 *   private key holder can sign. Anyone with the public key can verify.
 *   The public key IS the signer identity.
 */

import { generateKeyPairSync, createHash, createPublicKey } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AttestorKeyPair {
  /** PEM-encoded Ed25519 private key */
  privateKeyPem: string;
  /** PEM-encoded Ed25519 public key */
  publicKeyPem: string;
  /** Raw 32-byte public key as hex (compact identity) */
  publicKeyHex: string;
  /** Key fingerprint: truncated SHA-256 of the public key (16 hex chars) */
  fingerprint: string;
}

/**
 * Generate a new Ed25519 key pair for Attestor signing.
 */
export function generateKeyPair(): AttestorKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');

  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  const publicKeyRaw = publicKey.export({ type: 'spki', format: 'der' });
  // Ed25519 SPKI DER is 44 bytes: 12 bytes header + 32 bytes key
  const publicKeyHex = publicKeyRaw.subarray(12).toString('hex');
  const fingerprint = createHash('sha256').update(publicKeyRaw).digest('hex').slice(0, 16);

  return { privateKeyPem, publicKeyPem, publicKeyHex, fingerprint };
}

/**
 * Save a key pair to disk.
 */
export function saveKeyPair(keyPair: AttestorKeyPair, privateKeyPath: string, publicKeyPath: string): void {
  mkdirSync(dirname(privateKeyPath), { recursive: true });
  mkdirSync(dirname(publicKeyPath), { recursive: true });
  writeFileSync(privateKeyPath, keyPair.privateKeyPem, { mode: 0o600 });
  writeFileSync(publicKeyPath, keyPair.publicKeyPem, { mode: 0o644 });
}

/**
 * Load a private key from PEM file.
 */
export function loadPrivateKey(path: string): string {
  return readFileSync(path, 'utf-8');
}

/**
 * Load a public key from PEM file.
 */
export function loadPublicKey(path: string): string {
  return readFileSync(path, 'utf-8');
}

/**
 * Derive public key hex and fingerprint from a PEM public key.
 */
export function derivePublicKeyIdentity(publicKeyPem: string): { publicKeyHex: string; fingerprint: string } {
  const key = createPublicKey(publicKeyPem);
  const der = key.export({ type: 'spki', format: 'der' });
  const publicKeyHex = der.subarray(12).toString('hex');
  const fingerprint = createHash('sha256').update(der).digest('hex').slice(0, 16);

  return { publicKeyHex, fingerprint };
}
