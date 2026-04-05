/**
 * Independent multi-query verification kit check from saved files.
 * Verifies: certificate signature + manifest hash consistency + kit summary truth.
 */
import { verifyMultiQueryCertificate } from '../src/signing/multi-query-certificate.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const mqDir = '.attestor/multi-query';
const dirs = readdirSync(mqDir).filter(d => d.startsWith('mq-demo-')).sort();
const latest = dirs[dirs.length - 1];
if (!latest) { console.log('No multi-query proof found.'); process.exit(1); }

const dir = join(mqDir, latest);
console.log(`\n  Verifying kit: ${dir}\n`);

const kit = JSON.parse(readFileSync(join(dir, 'kit.json'), 'utf8'));
const pubKey = readFileSync(join(dir, 'public-key.pem'), 'utf8');

// 1. Certificate verification
const certResult = verifyMultiQueryCertificate(kit.certificate, pubKey);
console.log(`  ── Certificate ──`);
console.log(`  ${certResult.signatureValid ? '✓' : '✗'} Signature:      ${certResult.signatureValid ? 'valid' : 'INVALID'}`);
console.log(`  ${certResult.fingerprintConsistent ? '✓' : '✗'} Fingerprint:    ${certResult.fingerprintConsistent ? 'consistent' : 'MISMATCH'}`);
console.log(`  ${certResult.overall === 'valid' ? '✓' : '✗'} Overall:        ${certResult.overall}`);

// 2. Manifest hash consistency
const manifest = kit.manifest;
const recomputedManifest = createHash('sha256')
  .update([
    manifest.multiQueryHash,
    manifest.aggregateDecision,
    ...manifest.unitAnchors.map((a: any) => `${a.unitId}:${a.decision}:${a.evidenceChainTerminal}`),
  ].join('|'))
  .digest('hex')
  .slice(0, 32);
const manifestMatch = recomputedManifest === manifest.manifestHash;
console.log(`\n  ── Manifest ──`);
console.log(`  ${manifestMatch ? '✓' : '✗'} Hash:           ${manifestMatch ? 'consistent' : 'MISMATCH'} (${manifest.manifestHash.slice(0, 16)}...)`);
console.log(`    Units:          ${manifest.unitCount}`);
for (const a of manifest.unitAnchors) {
  console.log(`    ${a.unitId}: ${a.decision} (${a.evidenceChainTerminal.slice(0, 12)}...)`);
}

// 3. Cross-check: certificate multiQueryHash === manifest multiQueryHash
const hashMatch = kit.certificate.evidence.multiQueryHash === manifest.multiQueryHash;
console.log(`\n  ── Cross-Check ──`);
console.log(`  ${hashMatch ? '✓' : '✗'} Cert-Manifest hash: ${hashMatch ? 'consistent' : 'MISMATCH'}`);

// 4. Public key in kit matches
const keyMatch = kit.signerPublicKeyPem === pubKey;
console.log(`  ${keyMatch ? '✓' : '✗'} Public key:     ${keyMatch ? 'matches saved PEM' : 'MISMATCH'}`);

// 5. Summary
const v = kit.verification;
console.log(`\n  ── Verification Summary ──`);
console.log(`  Crypto:      ${v.cryptographic.valid ? '✓' : '✗'}`);
console.log(`  Structural:  ${v.structural.valid ? '✓' : '✗'}`);
console.log(`  Governance:  ${v.governanceSufficiency.sufficient ? 'sufficient' : 'INSUFFICIENT'}`);
console.log(`  Proof:       ${v.proofCompleteness.aggregateMode}`);
console.log(`  Units:       ${v.unitCount}`);
console.log(`  Decision:    ${v.aggregateDecision}`);
console.log(`  Overall:     ${v.overall.toUpperCase()}`);

// Verdict
const allOk = certResult.overall === 'valid' && manifestMatch && hashMatch && keyMatch;
console.log(`\n  ${allOk ? '✓' : '✗'} KIT VERIFICATION: ${allOk ? 'PASSED' : 'FAILED'}\n`);
