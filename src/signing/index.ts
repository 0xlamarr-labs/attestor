/**
 * Attestor Signing — Public API
 */
export { generateKeyPair, saveKeyPair, loadPrivateKey, loadPublicKey, derivePublicKeyIdentity } from './keys.js';
export type { AttestorKeyPair } from './keys.js';
export { signPayload, verifySignature, canonicalize } from './sign.js';
export { issueCertificate, verifyCertificate } from './certificate.js';
export type { AttestationCertificate, CertificateBody, CertificateInput, CertificateVerification } from './certificate.js';
export { buildAuthorityBundle, buildVerificationKit, buildVerificationSummary } from './bundle.js';
export type { AuthorityBundle, VerificationKit, VerificationSummary } from './bundle.js';
