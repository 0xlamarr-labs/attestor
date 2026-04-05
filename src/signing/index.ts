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
export { signReviewerEndorsement, verifyReviewerEndorsement } from './reviewer-endorsement.js';

// Multi-query signing
export { issueMultiQueryCertificate, verifyMultiQueryCertificate } from './multi-query-certificate.js';
export type { MultiQueryCertificate, MultiQueryCertificateBody, MultiQueryCertificateVerification } from './multi-query-certificate.js';
export { signMultiQueryReviewerEndorsement, verifyMultiQueryReviewerEndorsement, buildMultiQueryReviewerEndorsement } from './multi-query-reviewer.js';
export type { MultiQueryReviewerEndorsement, MultiQueryReviewerVerification } from './multi-query-reviewer.js';

// PKI trust chain
export { createCaCertificate, issueLeafCertificate, buildTrustChain, verifyTrustChain, generatePkiHierarchy } from './pki-chain.js';
export type { CaCertificate, LeafCertificate, TrustChain, ChainVerification } from './pki-chain.js';
