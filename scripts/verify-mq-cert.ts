/**
 * Independent multi-query certificate verification from saved files.
 */
import { verifyMultiQueryCertificate } from '../src/signing/multi-query-certificate.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Find the latest multi-query proof directory
const mqDir = '.attestor/multi-query';
const dirs = readdirSync(mqDir).filter(d => d.startsWith('mq-demo-')).sort();
const latest = dirs[dirs.length - 1];
if (!latest) { console.log('No multi-query proof found.'); process.exit(1); }

const dir = join(mqDir, latest);
console.log(`\nVerifying: ${dir}\n`);

const cert = JSON.parse(readFileSync(join(dir, 'certificate.json'), 'utf8'));
const pubKey = readFileSync(join(dir, 'public-key.pem'), 'utf8');

// 1. Independent verification
const result = verifyMultiQueryCertificate(cert, pubKey);
console.log(`  Signature valid:      ${result.signatureValid}`);
console.log(`  Fingerprint match:    ${result.fingerprintConsistent}`);
console.log(`  Schema valid:         ${result.schemaValid}`);
console.log(`  Overall:              ${result.overall}`);
console.log(`  Explanation:          ${result.explanation}`);
console.log('');

// 2. Tamper detection
const tampered = JSON.parse(JSON.stringify(cert));
tampered.aggregateDecision = 'pass';
const tamperResult = verifyMultiQueryCertificate(tampered, pubKey);
console.log(`  Tamper detection:     ${tamperResult.signatureValid ? 'FAILED — NOT DETECTED' : 'DETECTED (signature invalid after modification)'}`);
console.log('');

// 3. Unit anchors
console.log(`  Certificate ID:       ${cert.certificateId}`);
console.log(`  Run ID:               ${cert.runId}`);
console.log(`  Aggregate decision:   ${cert.aggregateDecision}`);
console.log(`  Unit count:           ${cert.unitCount}`);
for (const anchor of cert.unitAnchors) {
  console.log(`    ${anchor.unitId}: ${anchor.decision} (terminal: ${anchor.evidenceChainTerminal.slice(0, 12)}...)`);
}
console.log(`  MultiQuery hash:      ${cert.evidence.multiQueryHash}`);
console.log(`  Algorithm:            ${cert.signing.algorithm}`);
console.log(`  Signer fingerprint:   ${cert.signing.fingerprint}`);
console.log('');
