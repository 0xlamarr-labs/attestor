import { strict as assert } from 'node:assert';
import {
  buildProofShowcasePacket,
  renderProofShowcaseHtml,
  renderProofShowcaseMarkdown,
} from '../src/showcase/proof-showcase.js';
import type { VerificationKit } from '../src/signing/bundle.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

async function main(): Promise<void> {
  const kit = {
    certificate: {
      certificateId: 'cert_demo123',
      issuedAt: '2026-04-15T09:30:00.000Z',
      decisionSummary: 'Governed pass for real PostgreSQL-backed proof run',
      signing: {
        fingerprint: 'fp_demo',
      },
    },
    bundle: {
      runId: 'real-pg-proof-demo',
      decision: 'pass',
      evidence: {
        auditEntryCount: 8,
        auditChainIntact: true,
      },
      governance: {
        review: {
          required: true,
        },
      },
      proof: {
        executionProvider: 'postgres',
        executionLive: true,
        upstreamLive: false,
        mode: 'live_db',
      },
    },
    verification: {
      overall: 'proof_degraded',
      cryptographic: {
        valid: true,
        fingerprint: 'fp_demo',
      },
      governanceSufficiency: {
        sufficient: true,
        scoringDecision: 'pass',
      },
      authority: {
        state: 'authorized',
      },
      reviewerEndorsement: {
        present: true,
        verified: true,
        reviewerName: 'Attestor Operator',
      },
      proofCompleteness: {
        executionLive: true,
        upstreamLive: false,
        executionProvider: 'postgres',
        hasDbContextEvidence: true,
        gapCount: 1,
        gaps: ['upstream'],
      },
    },
  } as unknown as VerificationKit;

  const packet = buildProofShowcasePacket({
    proofDir: 'C:/Users/thedi/attestor/.attestor/proofs/real-pg-proof_demo',
    latestPacketDir: '.attestor/showcase/latest',
    kit,
    schemaAttestation: {
      schemaFingerprint: 'schema_fp_demo',
      attestationHash: 'att_hash_demo',
      tables: ['attestor_demo.counterparty_exposures'],
      sentinels: [{ tableName: 'attestor_demo.counterparty_exposures' }],
    },
  });

  ok(packet.headline === 'Accepted with partial proof coverage', 'Proof showcase: headline stays truthful when proof is degraded');
  ok(packet.limitations.some((item) => item.includes('does not prove a live upstream model call')), 'Proof showcase: limitations call out missing upstream proof');
  ok(packet.limitations.some((item) => item.includes('does not include PKI chain material yet')), 'Proof showcase: limitations call out missing PKI chain material');
  ok(packet.schemaAttestation.present, 'Proof showcase: schema attestation presence is reflected');
  ok(packet.commands.verifyKit.includes('--allow-legacy-verify'), 'Proof showcase: kit verify command includes legacy override when PKI chain is absent');

  const markdown = renderProofShowcaseMarkdown(packet);
  ok(markdown.includes('## Truthful limitations'), 'Proof showcase markdown: includes truthful limitations section');
  ok(markdown.includes('Attestor Operator'), 'Proof showcase markdown: includes reviewer identity when verified');
  ok(markdown.includes('[Verification kit](evidence/kit.json)'), 'Proof showcase markdown: links to copied evidence');

  const html = renderProofShowcaseHtml(packet);
  ok(html.includes('Accepted with partial proof coverage'), 'Proof showcase HTML: includes headline');
  ok(html.includes('evidence/certificate.json'), 'Proof showcase HTML: links to evidence certificate');
  ok(!html.includes('PROOF_DEGRADED'), 'Proof showcase HTML: avoids raw status-code shouting');

  console.log(`\nProof showcase tests: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error('\nProof showcase tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
