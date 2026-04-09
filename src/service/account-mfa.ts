/**
 * Account MFA Helpers -- TOTP-first hosted customer MFA utilities.
 *
 * Implements RFC 6238-compatible TOTP with secrets encrypted at rest and
 * password-style hashed recovery codes.
 *
 * BOUNDARY:
 * - TOTP only (RFC 6238 SHA-1, 6 digits, 30-second period)
 * - No WebAuthn/passkeys yet
 * - Secret encryption requires ATTESTOR_ACCOUNT_MFA_ENCRYPTION_KEY or
 *   falls back to ATTESTOR_ADMIN_API_KEY for hosted deployments
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import {
  createPasswordHashState,
  verifyAccountUserPasswordRecord,
  type AccountUserPasswordState,
  type AccountUserRecoveryCodeRecord,
  type AccountUserTotpState,
} from './account-user-store.js';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_DIGITS = 6;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_WINDOW = 1;

export interface EncryptedTotpSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
}

function encryptionKey(): Buffer {
  const raw = process.env.ATTESTOR_ACCOUNT_MFA_ENCRYPTION_KEY?.trim()
    || process.env.ATTESTOR_ADMIN_API_KEY?.trim();
  if (!raw) {
    throw new Error(
      'ATTESTOR_ACCOUNT_MFA_ENCRYPTION_KEY or ATTESTOR_ADMIN_API_KEY must be set before enabling account MFA.',
    );
  }
  return createHash('sha256').update(`attestor.account.mfa:${raw}`).digest();
}

function normalizeBase32(value: string): string {
  return value.toUpperCase().replace(/[^A-Z2-7]/g, '');
}

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(value: string): Buffer {
  const normalized = normalizeBase32(value);
  let bits = 0;
  let current = 0;
  const output: number[] = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error(`Unsupported base32 character '${char}'.`);
    }
    current = (current << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((current >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function formatTotpCode(value: number): string {
  return value.toString().padStart(TOTP_DIGITS, '0');
}

function sanitizeTotpCode(code: string): string {
  return code.replace(/\s+/g, '').replace(/-/g, '');
}

function hotp(secret: Buffer, counter: bigint): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter);
  const hmac = createHmac('sha1', secret).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = (
    ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff)
  );
  return formatTotpCode(binary % (10 ** TOTP_DIGITS));
}

function currentTotpStep(nowMs = Date.now()): bigint {
  return BigInt(Math.floor(nowMs / (TOTP_PERIOD_SECONDS * 1000)));
}

function countRemainingRecoveryCodes(codes: AccountUserRecoveryCodeRecord[]): number {
  return codes.filter((entry) => !entry.consumedAt).length;
}

export function generateTotpSecretBase32(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

export function encryptTotpSecret(secretBase32: string): EncryptedTotpSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(normalizeBase32(secretBase32), 'utf8'),
    cipher.final(),
  ]);
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptTotpSecret(secret: Pick<EncryptedTotpSecret, 'ciphertext' | 'iv' | 'authTag'>): string {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(secret.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(secret.authTag, 'base64'));
  return normalizeBase32(Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8'));
}

export function buildTotpOtpAuthUrl(options: {
  issuer?: string | null;
  accountName: string;
  secretBase32: string;
}): string {
  const issuer = options.issuer?.trim() || 'Attestor';
  const label = `${issuer}:${options.accountName.trim()}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(normalizeBase32(options.secretBase32))}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
}

export function verifyTotpCode(options: {
  secretBase32: string;
  code: string;
  nowMs?: number;
}): boolean {
  const normalizedCode = sanitizeTotpCode(options.code);
  if (!/^\d{6}$/.test(normalizedCode)) return false;
  const expected = Buffer.from(normalizedCode, 'utf8');
  const secret = base32Decode(options.secretBase32);
  const step = currentTotpStep(options.nowMs);
  for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset += 1) {
    const candidate = hotp(secret, step + BigInt(offset));
    const candidateBuffer = Buffer.from(candidate, 'utf8');
    if (candidateBuffer.length === expected.length && timingSafeEqual(candidateBuffer, expected)) {
      return true;
    }
  }
  return false;
}

export function generateCurrentTotpCode(secretBase32: string, nowMs = Date.now()): string {
  return hotp(base32Decode(secretBase32), currentTotpStep(nowMs));
}

function normalizeRecoveryCode(code: string): string {
  return sanitizeTotpCode(code).toUpperCase();
}

function formatRecoveryCode(normalized: string): string {
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

export function generateRecoveryCodes(count = 8): {
  codes: string[];
  hashedCodes: AccountUserRecoveryCodeRecord[];
} {
  const issuedAt = new Date().toISOString();
  const codes: string[] = [];
  const hashedCodes: AccountUserRecoveryCodeRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    const normalized = normalizeRecoveryCode(base32Encode(randomBytes(5)).slice(0, 8));
    codes.push(formatRecoveryCode(normalized));
    hashedCodes.push({
      id: `mfarec_${createHash('sha256').update(`${normalized}:${issuedAt}:${index}`).digest('hex').slice(0, 12)}`,
      hash: createPasswordHashState(normalized),
      consumedAt: null,
    });
  }
  return { codes, hashedCodes };
}

export function verifyAndConsumeRecoveryCode(
  totp: AccountUserTotpState,
  candidateCode: string,
): { ok: boolean; nextTotp: AccountUserTotpState; usedRecoveryCodeId: string | null } {
  const normalized = normalizeRecoveryCode(candidateCode);
  const nextTotp: AccountUserTotpState = structuredClone(totp);
  for (const entry of nextTotp.recoveryCodes) {
    if (entry.consumedAt) continue;
    if (verifyAccountUserPasswordRecord(entry.hash, normalized)) {
      entry.consumedAt = new Date().toISOString();
      nextTotp.lastVerifiedAt = entry.consumedAt;
      nextTotp.updatedAt = entry.consumedAt;
      return { ok: true, nextTotp, usedRecoveryCodeId: entry.id };
    }
  }
  return { ok: false, nextTotp: totp, usedRecoveryCodeId: null };
}

export function totpSummary(totp: AccountUserTotpState): {
  enabled: boolean;
  method: 'totp' | null;
  enrolledAt: string | null;
  pendingEnrollment: boolean;
  recoveryCodesRemaining: number;
  lastVerifiedAt: string | null;
  updatedAt: string | null;
} {
  const enabled = Boolean(totp.enabledAt && totp.secretCiphertext && totp.secretIv && totp.secretAuthTag);
  return {
    enabled,
    method: enabled ? 'totp' : null,
    enrolledAt: enabled ? totp.enabledAt : null,
    pendingEnrollment: Boolean(totp.pendingSecretCiphertext && totp.pendingIssuedAt),
    recoveryCodesRemaining: countRemainingRecoveryCodes(totp.recoveryCodes),
    lastVerifiedAt: totp.lastVerifiedAt,
    updatedAt: totp.updatedAt,
  };
}
