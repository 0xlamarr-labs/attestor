import type { VerificationKit } from '../signing/bundle.js';

export interface SchemaAttestationLike {
  schemaFingerprint: string;
  sentinelFingerprint?: string | null;
  tables: string[];
  sentinels?: Array<unknown>;
  executionContextHash?: string | null;
  attestationHash?: string;
}

export interface ProofShowcasePacket {
  title: string;
  headline: string;
  generatedAt: string;
  summary: string;
  proofRun: {
    label: string;
    source: string;
    decision: string;
    decisionSummary: string;
    verificationOverall: string;
    issuedAt: string;
    certificateId: string;
    runId: string;
    signerFingerprint: string;
    reviewerName: string | null;
    reviewerVerified: boolean;
    reviewRequired: boolean;
    executionProvider: string | null;
    executionLive: boolean;
    upstreamLive: boolean;
    executionMode: string;
    dbContextEvidence: boolean;
    auditEntryCount: number;
    proofGaps: string[];
    sourceProofDir: string;
  };
  verificationChecks: Array<{
    label: string;
    status: 'pass' | 'warn' | 'fail';
    detail: string;
  }>;
  keyTakeaways: string[];
  limitations: string[];
  schemaAttestation: {
    present: boolean;
    tableCount: number;
    tables: string[];
    sentinelCount: number;
    schemaFingerprint: string | null;
    attestationHash: string | null;
  };
  artifactFiles: Array<{
    label: string;
    relativePath: string;
    description: string;
  }>;
  commands: {
    rerun: string;
    verifyKit: string;
    verifyCertificate: string;
  };
}

export interface BuildProofShowcasePacketInput {
  proofDir: string;
  latestPacketDir: string;
  kit: VerificationKit;
  generatedAt?: string;
  proofLabel?: string;
  rerunCommand?: string;
  schemaAttestation?: SchemaAttestationLike | null;
}

function normalizeProofSourcePath(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  const cwd = process.cwd().replaceAll('\\', '/').replace(/\/+$/u, '');
  return normalized.startsWith(`${cwd}/`) ? normalized.slice(cwd.length + 1) : normalized;
}

function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

function humanizeVerificationOverall(value: string): string {
  return titleCase(value.replace(/_/gu, ' '));
}

function isFinancialReportingContext(input: BuildProofShowcasePacketInput): boolean {
  const corpus = [
    input.proofDir,
    input.proofLabel ?? '',
    input.rerunCommand ?? '',
    input.kit.bundle.runId ?? '',
  ].join(' ').toLowerCase();
  return corpus.includes('financial')
    || corpus.includes('counterparty')
    || corpus.includes('liquidity')
    || corpus.includes('reconciliation')
    || corpus.includes('real-db-proof')
    || corpus.includes('real-pg-proof');
}

function headlineFor(kit: VerificationKit): string {
  const { decision } = kit.bundle;
  const { overall } = kit.verification;
  if (decision === 'pass' && overall === 'verified') return 'Accepted with fully verifiable proof';
  if (decision === 'pass' && overall === 'proof_degraded') return 'Accepted with partial proof coverage';
  if (decision === 'pass' && overall === 'authority_incomplete') return 'Accepted with authority closure still pending';
  if (decision === 'pass' && overall === 'governance_insufficient') return 'Accepted result with governance issues still visible';
  return `${titleCase(decision)} result with ${overall.replace(/_/gu, ' ')} verification`;
}

function summaryFor(kit: VerificationKit, financialReportingContext: boolean): string {
  const executionProvider = kit.bundle.proof.executionProvider ?? 'unknown execution provider';
  const proofMode = kit.bundle.proof.mode.replace(/_/gu, ' ');
  const verificationState = humanizeVerificationOverall(kit.verification.overall).toLowerCase();
  if (financialReportingContext) {
    return [
      `Attestor produced a ${kit.bundle.decision.toUpperCase()} decision for an AI-assisted financial reporting workflow and issued a portable proof kit.`,
      `The packet can be re-verified outside the platform, and this run shows ${proofMode} with ${executionProvider}.`,
      `The current verification verdict is ${verificationState}.`,
    ].join(' ');
  }
  return [
    `Attestor produced a ${kit.bundle.decision.toUpperCase()} decision for a governed workflow and issued a portable proof kit.`,
    `The packet can be re-verified outside the platform, and this run shows ${proofMode} with ${executionProvider}.`,
    `The current verification verdict is ${verificationState}.`,
  ].join(' ');
}

function buildVerificationChecks(kit: VerificationKit): ProofShowcasePacket['verificationChecks'] {
  const checks: ProofShowcasePacket['verificationChecks'] = [];
  checks.push({
    label: 'Certificate signature',
    status: kit.verification.cryptographic.valid ? 'pass' : 'fail',
    detail: kit.verification.cryptographic.valid
      ? `Ed25519 signature valid for signer ${kit.verification.cryptographic.fingerprint}.`
      : 'Certificate signature or signer fingerprint did not verify.',
  });
  checks.push({
    label: 'Governance sufficiency',
    status: kit.verification.governanceSufficiency.sufficient ? 'pass' : 'fail',
    detail: kit.verification.governanceSufficiency.sufficient
      ? `SQL, policy, and guardrails all passed for decision ${kit.verification.governanceSufficiency.scoringDecision}.`
      : `One or more governance gates failed for decision ${kit.verification.governanceSufficiency.scoringDecision}.`,
  });
  checks.push({
    label: 'Authority closure',
    status: kit.verification.authority.state === 'authorized' ? 'pass' : 'warn',
    detail: kit.verification.authority.state === 'authorized'
      ? 'Warrant, escrow, and receipt reached an authorized state.'
      : `Authority state is ${kit.verification.authority.state}.`,
  });
  checks.push({
    label: 'Reviewer endorsement',
    status: kit.verification.reviewerEndorsement.verified ? 'pass' : 'warn',
    detail: kit.verification.reviewerEndorsement.verified
      ? `Reviewer endorsement verified for ${kit.verification.reviewerEndorsement.reviewerName ?? 'unknown reviewer'}.`
      : (kit.verification.reviewerEndorsement.present
        ? 'A reviewer endorsed the run, but independent verification is incomplete or missing.'
        : 'No reviewer endorsement is present in this packet.'),
  });
  checks.push({
    label: 'Live execution evidence',
    status: kit.verification.proofCompleteness.executionLive ? 'pass' : 'warn',
    detail: kit.verification.proofCompleteness.executionLive
      ? `Execution ran live against ${kit.verification.proofCompleteness.executionProvider ?? 'the configured runtime'}.`
      : 'Execution was not live; this packet proves a governed flow but not live execution.',
  });
  checks.push({
    label: 'Execution context evidence',
    status: kit.verification.proofCompleteness.hasDbContextEvidence ? 'pass' : 'warn',
    detail: kit.verification.proofCompleteness.hasDbContextEvidence
      ? 'A database execution-context hash is present in the proof bundle.'
      : 'No database execution-context hash is present in the proof bundle.',
  });
  return checks;
}

function buildKeyTakeaways(
  kit: VerificationKit,
  schemaAttestation: SchemaAttestationLike | null | undefined,
  financialReportingContext: boolean,
): string[] {
  const takeaways = [
    financialReportingContext
      ? `The run shows an AI-assisted financial reporting acceptance flow, not just a raw model response.`
      : `The run emitted certificate ${kit.certificate.certificateId} and a portable verification kit that can be checked without API access.`,
    `The run emitted certificate ${kit.certificate.certificateId} and a portable verification kit that can be checked without API access.`,
    `The evidence chain contains ${kit.bundle.evidence.auditEntryCount} audit entries and is ${kit.bundle.evidence.auditChainIntact ? 'intact' : 'not intact'}.`,
  ];
  if (kit.verification.proofCompleteness.executionLive) {
    takeaways.push(`Execution was live and recorded against ${kit.verification.proofCompleteness.executionProvider ?? 'the configured runtime'}.`);
  }
  if (kit.verification.reviewerEndorsement.verified) {
    takeaways.push(`The packet includes a verified reviewer endorsement for ${kit.verification.reviewerEndorsement.reviewerName ?? 'the assigned reviewer'}.`);
  }
  if (schemaAttestation) {
    takeaways.push(`Schema attestation was captured for ${schemaAttestation.tables.length} table(s): ${schemaAttestation.tables.join(', ')}.`);
  }
  return takeaways;
}

function buildLimitations(
  kit: VerificationKit,
  schemaAttestation: SchemaAttestationLike | null | undefined,
): string[] {
  const limitations: string[] = [];
  if (!kit.verification.proofCompleteness.upstreamLive) {
    limitations.push('This packet does not prove a live upstream model call. It proves governed acceptance, signing, and execution evidence for the resulting workflow.');
  }
  if (kit.verification.proofCompleteness.gapCount > 0) {
    limitations.push(`The proof still carries gap categories: ${kit.verification.proofCompleteness.gaps.join(', ')}.`);
  }
  if (kit.verification.authority.state !== 'authorized') {
    limitations.push(`Authority closure is not complete yet; current state is ${kit.verification.authority.state}.`);
  }
  if (!kit.trustChain || !kit.caPublicKeyPem) {
    limitations.push('This kit does not include PKI chain material yet. Full kit verification currently requires the legacy override flag or certificate-only verification.');
  }
  if (!schemaAttestation) {
    limitations.push('No schema attestation file was captured for this run.');
  }
  if (limitations.length === 0) {
    limitations.push('No additional proof caveats were recorded for this run.');
  }
  return limitations;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildProofShowcasePacket(input: BuildProofShowcasePacketInput): ProofShowcasePacket {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const schemaAttestation = input.schemaAttestation ?? null;
  const financialReportingContext = isFinancialReportingContext(input);
  const latestPrefix = input.latestPacketDir.replaceAll('\\', '/');
  const artifactFiles: ProofShowcasePacket['artifactFiles'] = [
    { label: 'Verification kit', relativePath: 'evidence/kit.json', description: 'Portable proof bundle with certificate, authority bundle, and verification summary.' },
    { label: 'Certificate', relativePath: 'evidence/certificate.json', description: 'Ed25519-signed attestation certificate for the governed run.' },
    { label: 'Signer public key', relativePath: 'evidence/public-key.pem', description: 'Public key needed to independently verify the certificate signature.' },
    { label: 'Reviewer public key', relativePath: 'evidence/reviewer-public.pem', description: 'Public key needed to independently verify the reviewer endorsement.' },
    { label: 'Verification summary', relativePath: 'evidence/verification-summary.json', description: 'The six-dimensional verification verdict emitted for this packet.' },
  ];
  if (schemaAttestation) {
    artifactFiles.push({
      label: 'Schema attestation',
      relativePath: 'evidence/schema-attestation.json',
      description: 'Point-in-time schema and sentinel evidence captured around execution.',
    });
  }
  if (input.kit.trustChain && input.kit.caPublicKeyPem) {
    artifactFiles.push({
      label: 'Trust chain',
      relativePath: 'evidence/trust-chain.json',
      description: 'PKI trust chain for the runtime signer used by this proof packet.',
    });
    artifactFiles.push({
      label: 'CA public key',
      relativePath: 'evidence/ca-public.pem',
      description: 'CA public key used to verify the runtime signer leaf certificate.',
    });
  }

  return {
    title: financialReportingContext
      ? 'Attestor Financial Reporting Acceptance Packet'
      : 'Attestor Proof Packet',
    headline: headlineFor(input.kit),
    generatedAt,
    summary: summaryFor(input.kit, financialReportingContext),
    proofRun: {
      label: input.proofLabel ?? 'Real PostgreSQL-backed proof run',
      source: input.kit.bundle.proof.executionLive ? 'real_execution' : 'fixture_execution',
      decision: input.kit.bundle.decision,
      decisionSummary: input.kit.certificate.decisionSummary,
      verificationOverall: input.kit.verification.overall,
      issuedAt: input.kit.certificate.issuedAt,
      certificateId: input.kit.certificate.certificateId,
      runId: input.kit.bundle.runId,
      signerFingerprint: input.kit.certificate.signing.fingerprint,
      reviewerName: input.kit.verification.reviewerEndorsement.reviewerName,
      reviewerVerified: input.kit.verification.reviewerEndorsement.verified,
      reviewRequired: input.kit.bundle.governance.review.required,
      executionProvider: input.kit.bundle.proof.executionProvider ?? null,
      executionLive: input.kit.bundle.proof.executionLive,
      upstreamLive: input.kit.bundle.proof.upstreamLive,
      executionMode: input.kit.bundle.proof.mode,
      dbContextEvidence: input.kit.verification.proofCompleteness.hasDbContextEvidence,
      auditEntryCount: input.kit.bundle.evidence.auditEntryCount,
      proofGaps: input.kit.verification.proofCompleteness.gaps,
      sourceProofDir: normalizeProofSourcePath(input.proofDir),
    },
    verificationChecks: buildVerificationChecks(input.kit),
    keyTakeaways: buildKeyTakeaways(input.kit, schemaAttestation, financialReportingContext),
    limitations: buildLimitations(input.kit, schemaAttestation),
    schemaAttestation: {
      present: !!schemaAttestation,
      tableCount: schemaAttestation?.tables.length ?? 0,
      tables: schemaAttestation?.tables ?? [],
      sentinelCount: schemaAttestation?.sentinels?.length ?? 0,
      schemaFingerprint: schemaAttestation?.schemaFingerprint ?? null,
      attestationHash: schemaAttestation?.attestationHash ?? null,
    },
    artifactFiles,
    commands: {
      rerun: input.rerunCommand ?? 'npx tsx scripts/real-db-proof.ts',
      verifyKit: input.kit.trustChain && input.kit.caPublicKeyPem
        ? `npm run verify:cert -- ${latestPrefix}/evidence/kit.json`
        : `npm run verify:cert -- ${latestPrefix}/evidence/kit.json --allow-legacy-verify`,
      verifyCertificate: `npm run verify:cert -- ${latestPrefix}/evidence/certificate.json ${latestPrefix}/evidence/public-key.pem`,
    },
  };
}

export function renderProofShowcaseMarkdown(packet: ProofShowcasePacket): string {
  const lines: string[] = [];
  lines.push(`# ${packet.title}`);
  lines.push('');
  lines.push(`## ${packet.headline}`);
  lines.push('');
  lines.push(packet.summary);
  lines.push('');
  lines.push('## At a glance');
  lines.push('');
  lines.push(`- **Workflow:** ${packet.proofRun.label}`);
  lines.push(`- **Decision:** ${packet.proofRun.decision.toUpperCase()}`);
  lines.push(`- **Verification:** ${humanizeVerificationOverall(packet.proofRun.verificationOverall)}`);
  lines.push(`- **Certificate:** ${packet.proofRun.certificateId}`);
  lines.push(`- **Issued:** ${packet.proofRun.issuedAt}`);
  lines.push(`- **Signer fingerprint:** ${packet.proofRun.signerFingerprint}`);
  lines.push(`- **Execution:** ${packet.proofRun.executionLive ? 'live' : 'fixture'}${packet.proofRun.executionProvider ? ` (${packet.proofRun.executionProvider})` : ''}`);
  lines.push(`- **DB context evidence:** ${packet.proofRun.dbContextEvidence ? 'present' : 'not present'}`);
  lines.push(`- **Audit entries:** ${packet.proofRun.auditEntryCount}`);
  lines.push(`- **Source proof directory:** \`${packet.proofRun.sourceProofDir}\``);
  lines.push('');
  lines.push('## What this run shows');
  lines.push('');
  for (const takeaway of packet.keyTakeaways) {
    lines.push(`- ${takeaway}`);
  }
  lines.push('');
  lines.push('## Verification checks');
  lines.push('');
  for (const check of packet.verificationChecks) {
    lines.push(`- **${check.label}:** ${check.status.toUpperCase()} - ${check.detail}`);
  }
  lines.push('');
  lines.push('## Truthful limitations');
  lines.push('');
  for (const limitation of packet.limitations) {
    lines.push(`- ${limitation}`);
  }
  lines.push('');
  if (packet.schemaAttestation.present) {
    lines.push('## Schema attestation');
    lines.push('');
    lines.push(`- **Tables:** ${packet.schemaAttestation.tables.join(', ')}`);
    lines.push(`- **Sentinels:** ${packet.schemaAttestation.sentinelCount}`);
    lines.push(`- **Schema fingerprint:** ${packet.schemaAttestation.schemaFingerprint}`);
    lines.push(`- **Attestation hash:** ${packet.schemaAttestation.attestationHash}`);
    lines.push('');
  }
  lines.push('## Included evidence');
  lines.push('');
  for (const file of packet.artifactFiles) {
    lines.push(`- [${file.label}](${file.relativePath}) - ${file.description}`);
  }
  lines.push('');
  lines.push('## Re-run and verify');
  lines.push('');
  lines.push('```bash');
  lines.push(packet.commands.rerun);
  lines.push(packet.commands.verifyKit);
  lines.push(packet.commands.verifyCertificate);
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

export function renderProofShowcaseHtml(packet: ProofShowcasePacket): string {
  const checks = packet.verificationChecks
    .map((check) => {
      const badgeClass = `status-${check.status}`;
      return `<li><strong>${escapeHtml(check.label)}</strong><span class="badge ${badgeClass}">${escapeHtml(check.status.toUpperCase())}</span><div class="detail">${escapeHtml(check.detail)}</div></li>`;
    })
    .join('');
  const takeaways = packet.keyTakeaways
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('');
  const limitations = packet.limitations
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('');
  const artifacts = packet.artifactFiles
    .map((file) => `<li><a href="${escapeHtml(file.relativePath)}">${escapeHtml(file.label)}</a><div class="detail">${escapeHtml(file.description)}</div></li>`)
    .join('');
  const schemaSection = packet.schemaAttestation.present ? `
    <section class="panel">
      <h2>Schema attestation</h2>
      <p><strong>Tables:</strong> ${escapeHtml(packet.schemaAttestation.tables.join(', '))}</p>
      <p><strong>Sentinels:</strong> ${packet.schemaAttestation.sentinelCount}</p>
      <p><strong>Schema fingerprint:</strong> <code>${escapeHtml(packet.schemaAttestation.schemaFingerprint ?? '')}</code></p>
      <p><strong>Attestation hash:</strong> <code>${escapeHtml(packet.schemaAttestation.attestationHash ?? '')}</code></p>
    </section>
  ` : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(packet.title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f7f3e4;
        --panel: rgba(255, 252, 244, 0.92);
        --ink: #2c2a24;
        --muted: #655f52;
        --line: rgba(70, 62, 41, 0.14);
        --accent: #b99a4d;
        --pass: #2f7d55;
        --warn: #9a6c17;
        --fail: #a23b32;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        background:
          radial-gradient(circle at top, rgba(255,255,255,0.75), transparent 48%),
          linear-gradient(180deg, #fbf8ef 0%, var(--bg) 55%, #f0e7cf 100%);
        color: var(--ink);
      }
      main {
        max-width: 1080px;
        margin: 0 auto;
        padding: 48px 28px 64px;
      }
      .hero {
        background: linear-gradient(135deg, rgba(255,255,255,0.9), rgba(249,244,228,0.88));
        border: 1px solid var(--line);
        border-radius: 24px;
        padding: 32px;
        box-shadow: 0 24px 60px rgba(62, 49, 19, 0.08);
      }
      .eyebrow {
        text-transform: uppercase;
        letter-spacing: 0.12em;
        font-size: 12px;
        color: var(--accent);
        margin-bottom: 12px;
      }
      h1 {
        font-size: clamp(34px, 5vw, 56px);
        line-height: 1.02;
        margin: 0 0 12px;
      }
      .summary {
        font-size: 18px;
        line-height: 1.6;
        max-width: 760px;
        color: var(--muted);
      }
      .glance {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 14px;
        margin-top: 28px;
      }
      .metric {
        background: rgba(255,255,255,0.76);
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 16px;
      }
      .metric .label {
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
        margin-bottom: 8px;
      }
      .metric .value {
        font-size: 20px;
        font-weight: 700;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 18px;
        margin-top: 24px;
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 20px;
        padding: 24px;
        box-shadow: 0 16px 42px rgba(62, 49, 19, 0.06);
      }
      h2 {
        margin-top: 0;
        margin-bottom: 14px;
        font-size: 22px;
      }
      ul {
        margin: 0;
        padding-left: 18px;
      }
      li {
        margin-bottom: 14px;
        line-height: 1.5;
      }
      .detail {
        color: var(--muted);
        font-size: 15px;
        margin-top: 4px;
      }
      .badge {
        display: inline-block;
        margin-left: 10px;
        border-radius: 999px;
        padding: 4px 10px;
        font-size: 12px;
        letter-spacing: 0.08em;
        font-weight: 700;
      }
      .status-pass { background: rgba(47,125,85,0.12); color: var(--pass); }
      .status-warn { background: rgba(154,108,23,0.14); color: var(--warn); }
      .status-fail { background: rgba(162,59,50,0.12); color: var(--fail); }
      code {
        font-family: "Consolas", "SFMono-Regular", monospace;
        font-size: 13px;
        background: rgba(46, 38, 24, 0.06);
        padding: 2px 6px;
        border-radius: 6px;
      }
      pre {
        white-space: pre-wrap;
        word-break: break-word;
        background: rgba(46, 38, 24, 0.06);
        border-radius: 14px;
        padding: 16px;
        overflow: auto;
      }
      a { color: #6f5310; }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <div class="eyebrow">Attestor proof packet</div>
        <h1>${escapeHtml(packet.headline)}</h1>
        <p class="summary">${escapeHtml(packet.summary)}</p>
        <div class="glance">
          <div class="metric"><div class="label">Decision</div><div class="value">${escapeHtml(packet.proofRun.decision.toUpperCase())}</div></div>
          <div class="metric"><div class="label">Verification</div><div class="value">${escapeHtml(humanizeVerificationOverall(packet.proofRun.verificationOverall))}</div></div>
          <div class="metric"><div class="label">Certificate</div><div class="value">${escapeHtml(packet.proofRun.certificateId)}</div></div>
          <div class="metric"><div class="label">Execution</div><div class="value">${escapeHtml(packet.proofRun.executionLive ? 'Live' : 'Fixture')}${packet.proofRun.executionProvider ? ` (${escapeHtml(packet.proofRun.executionProvider)})` : ''}</div></div>
        </div>
      </section>

      <div class="grid">
        <section class="panel">
          <h2>What this run shows</h2>
          <ul>${takeaways}</ul>
        </section>
        <section class="panel">
          <h2>Verification checks</h2>
          <ul>${checks}</ul>
        </section>
      </div>

      <div class="grid">
        <section class="panel">
          <h2>Truthful limitations</h2>
          <ul>${limitations}</ul>
        </section>
        <section class="panel">
          <h2>Included evidence</h2>
          <ul>${artifacts}</ul>
        </section>
      </div>

      ${schemaSection}

      <section class="panel">
        <h2>Re-run and verify</h2>
        <pre>${escapeHtml(`${packet.commands.rerun}\n${packet.commands.verifyKit}\n${packet.commands.verifyCertificate}`)}</pre>
        <p class="detail">Source proof directory: <code>${escapeHtml(packet.proofRun.sourceProofDir)}</code></p>
      </section>
    </main>
  </body>
</html>
`;
}
