import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ProofShowcasePacket } from '../showcase/proof-showcase.js';

const FINANCIAL_PROOF_PACKET_PATH = resolve(
  process.cwd(),
  'docs',
  'evidence',
  'financial-reporting-acceptance-live-hybrid',
  'packet.json',
);

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function loadCommittedFinancialReportingPacket(): ProofShowcasePacket | null {
  if (!existsSync(FINANCIAL_PROOF_PACKET_PATH)) return null;
  try {
    return JSON.parse(readFileSync(FINANCIAL_PROOF_PACKET_PATH, 'utf8')) as ProofShowcasePacket;
  } catch {
    return null;
  }
}

export function financialReportingEvidenceRoot(): string {
  return resolve(
    process.cwd(),
    'docs',
    'evidence',
    'financial-reporting-acceptance-live-hybrid',
  );
}

export function renderHostedReturnPage(options: {
  title: string;
  eyebrow: string;
  message: string;
  bullets?: string[];
  note?: string;
  actions: Array<{ href: string; label: string }>;
}): string {
  const bulletMarkup = (options.bullets ?? []).length > 0
    ? `<ul>${(options.bullets ?? [])
      .map((entry) => `<li>${escapeHtml(entry)}</li>`)
      .join('')}</ul>`
    : '';
  const noteMarkup = options.note
    ? `<p class="note">${escapeHtml(options.note)}</p>`
    : '';
  const actions = options.actions
    .map((action) => `<a class="action" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>`)
    .join('');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(options.title)}</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Segoe UI", sans-serif;
        background: #f5f7fb;
        color: #132238;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top left, rgba(44, 123, 229, 0.12), transparent 36%),
          radial-gradient(circle at bottom right, rgba(18, 184, 134, 0.14), transparent 38%),
          #f5f7fb;
      }
      main {
        width: min(640px, calc(100vw - 32px));
        border-radius: 24px;
        background: rgba(255, 255, 255, 0.94);
        box-shadow: 0 24px 80px rgba(15, 23, 42, 0.12);
        padding: 32px;
      }
      .eyebrow {
        margin: 0 0 12px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #2c7be5;
      }
      h1 {
        margin: 0 0 12px;
        font-size: clamp(28px, 4vw, 40px);
        line-height: 1.05;
      }
      p {
        margin: 0;
        font-size: 16px;
        line-height: 1.6;
        color: #40556f;
      }
      ul {
        margin: 18px 0 0;
        padding-left: 20px;
        color: #29415e;
        line-height: 1.7;
      }
      li + li {
        margin-top: 8px;
      }
      .note {
        margin-top: 18px;
        font-size: 14px;
        color: #5c728d;
      }
      nav {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 24px;
      }
      .action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        padding: 11px 18px;
        font-weight: 600;
        text-decoration: none;
        background: #132238;
        color: #ffffff;
      }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">${escapeHtml(options.eyebrow)}</p>
      <h1>${escapeHtml(options.title)}</h1>
      <p>${escapeHtml(options.message)}</p>
      ${bulletMarkup}
      ${noteMarkup}
      <nav>${actions}</nav>
    </main>
  </body>
</html>`;
}

function renderProofStrip(packet: ProofShowcasePacket | null): string {
  if (!packet) {
    return `
      <section class="proof">
        <p class="eyebrow">Current evidence</p>
        <h2>Run the proof packet locally.</h2>
        <p>The committed packet is not present in this checkout, but the canonical proof path is still the same: generate the financial reporting acceptance packet, then verify it outside Attestor.</p>
        <div class="commands">
          <code>npm run showcase:proof:hybrid</code>
          <code>npm run verify:cert -- .attestor/showcase/latest/evidence/kit.json</code>
        </div>
      </section>
    `;
  }

  const verificationChecks = packet.verificationChecks
    .slice(0, 4)
    .map((check) => `<li><strong>${escapeHtml(check.label)}:</strong> ${escapeHtml(check.detail)}</li>`)
    .join('');

  return `
    <section class="proof" id="proof">
      <p class="eyebrow">Current evidence</p>
      <h2>${escapeHtml(packet.headline)}</h2>
      <p>${escapeHtml(packet.summary)}</p>
      <p class="detail" style="margin-top: 14px;">Canonical scenario: <strong>${escapeHtml(packet.proofRun.label)}</strong>.</p>
      <div class="proof-metrics">
        <div><span>Decision</span><strong>${escapeHtml(packet.proofRun.decision.toUpperCase())}</strong></div>
        <div><span>Verification</span><strong>${escapeHtml(packet.proofRun.verificationOverall.replaceAll('_', ' '))}</strong></div>
        <div><span>Proof mode</span><strong>${escapeHtml(packet.proofRun.executionMode.replaceAll('_', ' '))}</strong></div>
        <div><span>Execution</span><strong>${escapeHtml(packet.proofRun.executionLive ? 'live' : 'fixture')}${packet.proofRun.executionProvider ? ` (${escapeHtml(packet.proofRun.executionProvider)})` : ''}</strong></div>
        <div><span>Reviewer endorsement</span><strong>${escapeHtml(packet.proofRun.reviewerVerified ? 'verified' : (packet.proofRun.reviewRequired ? 'required' : 'not required'))}</strong></div>
      </div>
      <ul class="evidence-list">${verificationChecks}</ul>
      <nav class="cta-row">
        <a class="button primary" href="/proof/financial-reporting-acceptance">Open proof surface</a>
        <a class="button secondary" href="/proof/financial-reporting-acceptance/evidence/kit.json">View kit.json</a>
      </nav>
    </section>
  `;
}

export function renderFinancialReportingLandingPage(packet: ProofShowcasePacket | null): string {
  const proofStrip = renderProofStrip(packet);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Attestor | AI-assisted financial reporting acceptance</title>
    <style>
      :root {
        color-scheme: light;
        --ink: #26231c;
        --muted: #6d6756;
        --line: rgba(108, 93, 52, 0.18);
        --accent: #b99347;
        --accent-deep: #8f6c2d;
        --paper: #fbf6e8;
        --panel: rgba(255, 252, 243, 0.88);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top, rgba(255,255,255,0.86), transparent 34%),
          linear-gradient(180deg, #fdfaf2 0%, #f7f0dd 58%, #efe5c8 100%);
      }
      main {
        min-height: 100vh;
      }
      .hero {
        padding: 88px 44px 56px;
      }
      .hero-grid {
        max-width: 1220px;
        margin: 0 auto;
        display: grid;
        grid-template-columns: minmax(320px, 1.1fr) minmax(420px, 1fr);
        gap: 54px;
        align-items: center;
      }
      .eyebrow {
        margin: 0 0 16px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--accent-deep);
      }
      .brand {
        margin: 0 0 10px;
        font-size: 15px;
        letter-spacing: 0.35em;
        text-transform: uppercase;
        color: rgba(51, 45, 31, 0.58);
      }
      h1 {
        margin: 0;
        max-width: 760px;
        font-size: clamp(42px, 6vw, 82px);
        line-height: 0.96;
        letter-spacing: -0.04em;
      }
      .hero-copy p {
        margin: 20px 0 0;
        max-width: 600px;
        font-size: 19px;
        line-height: 1.7;
        color: var(--muted);
      }
      .cta-row, .mini-nav {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
      }
      .cta-row {
        margin-top: 28px;
      }
      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        padding: 12px 18px;
        text-decoration: none;
        font-weight: 600;
      }
      .button.primary {
        background: var(--ink);
        color: #fffdfa;
      }
      .button.secondary {
        border: 1px solid var(--line);
        color: var(--ink);
        background: rgba(255,255,255,0.55);
      }
      .workflow {
        border-radius: 28px;
        border: 1px solid var(--line);
        background:
          radial-gradient(circle at center, rgba(236, 213, 159, 0.28), transparent 46%),
          linear-gradient(180deg, rgba(255,255,255,0.72), rgba(249,241,223,0.84));
        padding: 34px 28px;
        box-shadow: 0 28px 80px rgba(76, 60, 22, 0.08);
      }
      .workflow-line {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        align-items: center;
        gap: 18px;
      }
      .node {
        text-align: center;
      }
      .glyph {
        width: 118px;
        height: 118px;
        margin: 0 auto 14px;
        display: grid;
        place-items: center;
        border-radius: 30px;
        border: 1px solid rgba(181, 149, 75, 0.45);
        background: rgba(255,255,255,0.68);
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.52);
      }
      .glyph svg {
        width: 64px;
        height: 64px;
        stroke: #7a5a20;
        fill: none;
        stroke-width: 1.9;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .node strong {
        display: block;
        font-size: 28px;
        letter-spacing: -0.03em;
      }
      .node span {
        display: block;
        margin-top: 8px;
        font-size: 15px;
        line-height: 1.6;
        color: var(--muted);
      }
      .beam {
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(168, 132, 51, 0.8), transparent);
        transform: translateY(-52px);
      }
      section {
        padding: 0 44px 56px;
      }
      .section-inner {
        max-width: 1220px;
        margin: 0 auto;
      }
      .support-grid {
        display: grid;
        grid-template-columns: 1.05fr 0.95fr;
        gap: 40px;
        align-items: start;
      }
      .support-copy h2,
      .proof h2,
      .plans h2 {
        margin: 0;
        font-size: clamp(30px, 4vw, 46px);
        line-height: 1.04;
        letter-spacing: -0.03em;
      }
      .support-copy p,
      .proof p,
      .plans p {
        margin: 16px 0 0;
        max-width: 720px;
        font-size: 17px;
        line-height: 1.7;
        color: var(--muted);
      }
      .support-list {
        margin: 22px 0 0;
        padding: 0;
        list-style: none;
      }
      .support-list li {
        padding: 14px 0;
        border-top: 1px solid var(--line);
        font-size: 16px;
        line-height: 1.7;
      }
      .support-list li strong {
        color: var(--ink);
      }
      .reference-box {
        border: 1px solid var(--line);
        border-radius: 26px;
        background: var(--panel);
        padding: 26px;
      }
      .reference-box ol {
        margin: 18px 0 0;
        padding-left: 20px;
        color: var(--muted);
      }
      .reference-box li {
        margin-bottom: 14px;
        line-height: 1.6;
      }
      .reference-box a {
        color: var(--accent-deep);
      }
      .proof {
        margin-top: 8px;
        border-top: 1px solid var(--line);
        padding-top: 44px;
      }
      .proof-metrics {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 14px;
        margin-top: 22px;
      }
      .proof-metrics div {
        border-top: 1px solid var(--line);
        padding-top: 12px;
      }
      .proof-metrics span {
        display: block;
        font-size: 12px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: rgba(73, 61, 35, 0.58);
      }
      .proof-metrics strong {
        display: block;
        margin-top: 8px;
        font-size: 18px;
        line-height: 1.5;
      }
      .evidence-list {
        margin: 24px 0 0;
        padding-left: 18px;
        color: var(--muted);
      }
      .evidence-list li {
        margin-bottom: 12px;
        line-height: 1.6;
      }
      .commands {
        display: grid;
        gap: 10px;
        margin-top: 20px;
      }
      code {
        display: block;
        font-family: "Consolas", "SFMono-Regular", monospace;
        font-size: 13px;
        padding: 14px 16px;
        border-radius: 16px;
        background: rgba(61, 46, 17, 0.06);
        overflow-x: auto;
      }
      .plans {
        border-top: 1px solid var(--line);
        padding-top: 44px;
      }
      .plans-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 16px;
        margin-top: 26px;
      }
      .plan {
        padding-top: 16px;
        border-top: 1px solid var(--line);
      }
      .plan h3 {
        margin: 0;
        font-size: 22px;
      }
      .plan .price {
        margin-top: 10px;
        font-size: 28px;
        letter-spacing: -0.04em;
      }
      .plan .meta {
        margin-top: 10px;
        font-size: 15px;
        line-height: 1.65;
        color: var(--muted);
      }
      .plan ul {
        margin: 14px 0 0;
        padding-left: 18px;
        color: var(--muted);
      }
      .footer-note {
        margin-top: 26px;
        color: var(--muted);
      }
      @media (max-width: 1024px) {
        .hero-grid,
        .support-grid,
        .plans-grid,
        .workflow-line,
        .proof-metrics {
          grid-template-columns: 1fr;
        }
        .beam {
          display: none;
        }
      }
      @media (max-width: 720px) {
        .hero,
        section {
          padding-left: 22px;
          padding-right: 22px;
        }
        h1 {
          font-size: 42px;
        }
        .glyph {
          width: 96px;
          height: 96px;
        }
        .node strong {
          font-size: 24px;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <div class="hero-grid">
          <div class="hero-copy">
            <p class="brand">ATTESTOR</p>
            <p class="eyebrow">AI-assisted financial reporting acceptance</p>
            <h1>Between generated output and a reporting consequence.</h1>
            <p>Attestor is built first for the moment where AI-assisted reporting work stops being a draft and becomes something a finance, risk, or reporting team may actually accept, sign, export, or hold behind.</p>
            <div class="cta-row">
              <a class="button primary" href="/proof/financial-reporting-acceptance">Open the proof surface</a>
              <a class="button secondary" href="#plans">See plans and run budgets</a>
            </div>
          </div>
          <div class="workflow" aria-label="Output acceptance flow">
            <div class="workflow-line">
              <div class="node">
                <div class="glyph" aria-hidden="true">
                  <svg viewBox="0 0 64 64">
                    <path d="M14 19h24" />
                    <path d="M14 31h24" />
                    <path d="M14 43h18" />
                    <circle cx="46" cy="43" r="6" />
                  </svg>
                </div>
                <strong>Output</strong>
                <span>Draft report section, SQL-derived metric, reconciliation summary, or filing-oriented narrative.</span>
              </div>
              <div class="beam" aria-hidden="true"></div>
              <div class="node">
                <div class="glyph" aria-hidden="true" style="box-shadow: 0 0 0 1px rgba(255,255,255,0.8), 0 0 0 20px rgba(201,167,86,0.08);">
                  <svg viewBox="0 0 64 64">
                    <path d="M32 8 50 16v14c0 12-8 20-18 26-10-6-18-14-18-26V16Z" />
                    <path d="m24 33 6 6 12-14" />
                  </svg>
                </div>
                <strong>Acceptance</strong>
                <span>Bounded execution, reviewer authority, signed proof, verification kit, and an explicit decision boundary.</span>
              </div>
              <div class="beam" aria-hidden="true"></div>
              <div class="node">
                <div class="glyph" aria-hidden="true">
                  <svg viewBox="0 0 64 64">
                    <path d="M18 14h18l10 10v26H18Z" />
                    <path d="M36 14v10h10" />
                    <path d="m23 39 6 6 12-12" />
                  </svg>
                </div>
                <strong>Consequence</strong>
                <span>Internal reporting, review closure, export, filing preparation, or a documented handoff into a real control process.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div class="section-inner support-grid">
          <div class="support-copy">
            <p class="eyebrow">Why this wedge is real</p>
            <h2>Financial reporting already has identity, validation, and audit boundaries. AI has to meet them.</h2>
            <p>This is not an invented category. The reporting world already expects authenticated filers, bounded submission flows, structured taxonomies, validation rules, and evidence that survives after the first person clicks "looks good."</p>
            <ul class="support-list">
              <li><strong>EDGAR Next</strong> moves SEC filing access toward stronger identity, role, and API-token discipline.</li>
              <li><strong>ESEF</strong> and <strong>EBA</strong> reporting frameworks keep tightening structured tagging, validation, and filing-packaging expectations.</li>
              <li><strong>NIST's Generative AI Profile</strong> reinforces documentation, monitoring, and human-governed risk controls around GenAI systems.</li>
            </ul>
          </div>
          <aside class="reference-box">
            <p class="eyebrow">Current external anchors</p>
            <h2>Official references</h2>
            <ol>
              <li><a href="https://www.sec.gov/submit-filings/improving-edgar/edgar-next-improving-filer-access-account-management">SEC: EDGAR Next</a></li>
              <li><a href="https://www.sec.gov/submit-filings/edgar-filer-manual">SEC: EDGAR Filer Manual</a></li>
              <li><a href="https://www.esma.europa.eu/document/esef-reporting-manual">ESMA: ESEF Reporting Manual</a></li>
              <li><a href="https://www.eba.europa.eu/risk-and-data-analysis/reporting-frameworks">EBA: Reporting Frameworks</a></li>
              <li><a href="https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf">NIST AI 600-1: Generative AI Profile</a></li>
              <li><a href="https://specifications.xbrl.org/work-product-index-report-package-report-package-1.0-report-package-1.0.html">XBRL Report Package specification</a></li>
            </ol>
          </aside>
        </div>

        <div class="section-inner">
          ${proofStrip}
        </div>

        <div class="section-inner plans" id="plans">
          <p class="eyebrow">Buying shape</p>
          <h2>Simple plan ladder, one reporting-acceptance budget.</h2>
          <p>One run means one governed acceptance pass for one reporting input. Community is for first validation, Starter is for the first live reporting workflow, Pro is for recurring departmental use, and Enterprise is for the point where fixed public quotas stop matching the governance boundary.</p>
          <div class="plans-grid">
            <div class="plan">
              <h3>Community</h3>
              <div class="price">Free</div>
              <div class="meta">Zero-cost evaluation path and the first <strong>10</strong> hosted runs.</div>
              <ul>
                <li>Try the counterparty reporting proof path</li>
                <li>Issue the first tenant API key</li>
                <li>Validate before paying</li>
              </ul>
            </div>
            <div class="plan">
              <h3>Starter</h3>
              <div class="price">EUR 499</div>
              <div class="meta">The first paid hosted plan, with <strong>100</strong> runs/month and a 14-day trial.</div>
              <ul>
                <li>One serious reporting workflow</li>
                <li>Usage, billing, and API key management</li>
                <li>Governed pilot moving into production</li>
              </ul>
            </div>
            <div class="plan">
              <h3>Pro</h3>
              <div class="price">EUR 1,999</div>
              <div class="meta"><strong>1,000</strong> runs/month for several recurring reporting or control workflows.</div>
              <ul>
                <li>Department-level usage</li>
                <li>Higher rate limits and stronger runtime headroom</li>
                <li>Multiple review or reporting cycles</li>
              </ul>
            </div>
            <div class="plan">
              <h3>Enterprise</h3>
              <div class="price">Negotiated</div>
              <div class="meta">Customer-operated deployment boundary or hosted enterprise scale where fixed public quotas stop being the right contract.</div>
              <ul>
                <li>Multiple teams or entities</li>
                <li>Negotiated limits and rollout boundary</li>
                <li>Commercial onboarding and compliance path</li>
              </ul>
            </div>
          </div>
          <p class="footer-note">The shortest hosted flow is: sign up, receive the first key, run the reporting-acceptance path, upgrade the same account only when the free budget is gone.</p>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

export function renderFinancialReportingProofPage(packet: ProofShowcasePacket | null): string {
  const evidenceLinks = packet
    ? packet.artifactFiles
      .map((file) => `<li><a href="/proof/financial-reporting-acceptance/${escapeHtml(file.relativePath)}">${escapeHtml(file.label)}</a><div class="detail">${escapeHtml(file.description)}</div></li>`)
      .join('')
    : '';
  const checks = packet
    ? packet.verificationChecks
      .map((check) => `<li><strong>${escapeHtml(check.label)}</strong><span class="status">${escapeHtml(check.status.toUpperCase())}</span><div class="detail">${escapeHtml(check.detail)}</div></li>`)
      .join('')
    : '';
  const limitations = packet
    ? packet.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
    : '';
  const commands = packet
    ? `${packet.commands.rerun}\n${packet.commands.verifyKit}\n${packet.commands.verifyCertificate}`
    : 'npm run showcase:proof:hybrid\nnpm run verify:cert -- .attestor/showcase/latest/evidence/kit.json';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Attestor proof | Financial reporting acceptance</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f8f2df;
        --panel: rgba(255, 252, 243, 0.9);
        --line: rgba(95, 75, 34, 0.18);
        --ink: #27231a;
        --muted: #69614d;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top, rgba(255,255,255,0.82), transparent 34%),
          linear-gradient(180deg, #fdfaf1 0%, var(--bg) 62%, #eee1be 100%);
      }
      main {
        max-width: 1120px;
        margin: 0 auto;
        padding: 56px 28px 80px;
      }
      .hero {
        border-bottom: 1px solid var(--line);
        padding-bottom: 28px;
      }
      .eyebrow {
        margin: 0 0 14px;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        color: #8a6a2b;
      }
      h1 {
        margin: 0;
        font-size: clamp(34px, 5vw, 62px);
        line-height: 0.98;
        letter-spacing: -0.04em;
      }
      p {
        margin: 16px 0 0;
        max-width: 760px;
        font-size: 18px;
        line-height: 1.7;
        color: var(--muted);
      }
      .grid {
        display: grid;
        grid-template-columns: 1.1fr 0.9fr;
        gap: 20px;
        margin-top: 28px;
      }
      .panel {
        border: 1px solid var(--line);
        border-radius: 24px;
        background: var(--panel);
        padding: 24px;
        box-shadow: 0 18px 48px rgba(69, 50, 18, 0.06);
      }
      h2 {
        margin: 0 0 12px;
        font-size: 28px;
        line-height: 1.1;
      }
      ul {
        margin: 0;
        padding-left: 18px;
      }
      li {
        margin-bottom: 14px;
        line-height: 1.6;
      }
      .detail {
        color: var(--muted);
        font-size: 15px;
        margin-top: 4px;
      }
      .status {
        display: inline-block;
        margin-left: 10px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        color: #7b5b20;
      }
      .metrics {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .metric {
        border-top: 1px solid var(--line);
        padding-top: 12px;
      }
      .metric span {
        display: block;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: rgba(78, 62, 29, 0.56);
      }
      .metric strong {
        display: block;
        margin-top: 8px;
        font-size: 18px;
        line-height: 1.5;
      }
      a {
        color: #77571b;
      }
      pre {
        margin: 0;
        padding: 16px;
        border-radius: 16px;
        background: rgba(59, 44, 14, 0.06);
        overflow: auto;
        font-size: 13px;
      }
      @media (max-width: 900px) {
        .grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <p class="eyebrow">Committed proof sample</p>
        <h1>AI-assisted financial reporting acceptance, shown as evidence instead of promise.</h1>
        <p>This page is the finance-first proof surface for Attestor. It is anchored to a committed hybrid packet for a counterparty exposure reporting workflow, plus the exact commands needed to rerun and independently verify the same shape on another machine.</p>
      </section>

      <div class="grid">
        <section class="panel">
          <p class="eyebrow">Packet summary</p>
          <h2>${escapeHtml(packet?.headline ?? 'Packet not available in this checkout')}</h2>
          <p>${escapeHtml(packet?.summary ?? 'Generate the packet locally with the canonical showcase command, then verify it with the CLI.')}</p>
          <div class="metrics">
            <div class="metric"><span>Decision</span><strong>${escapeHtml(packet?.proofRun.decision.toUpperCase() ?? 'n/a')}</strong></div>
            <div class="metric"><span>Verification</span><strong>${escapeHtml(packet?.proofRun.verificationOverall.replaceAll('_', ' ') ?? 'n/a')}</strong></div>
            <div class="metric"><span>Proof mode</span><strong>${escapeHtml(packet?.proofRun.executionMode.replaceAll('_', ' ') ?? 'n/a')}</strong></div>
            <div class="metric"><span>Execution</span><strong>${escapeHtml(packet?.proofRun.executionLive ? 'live' : 'fixture')}${packet?.proofRun.executionProvider ? ` (${escapeHtml(packet.proofRun.executionProvider)})` : ''}</strong></div>
            <div class="metric"><span>Reviewer endorsement</span><strong>${escapeHtml(packet?.proofRun.reviewerVerified ? 'verified' : (packet?.proofRun.reviewRequired ? 'required' : 'not required'))}</strong></div>
            <div class="metric"><span>Audit entries</span><strong>${escapeHtml(String(packet?.proofRun.auditEntryCount ?? 'n/a'))}</strong></div>
          </div>
        </section>

        <section class="panel">
          <p class="eyebrow">Rerun and verify</p>
          <h2>Canonical demonstration path</h2>
          <pre>${escapeHtml(commands)}</pre>
          <p class="detail">The committed packet is a sample. The primary truth remains reproducible generation plus independent verification.</p>
        </section>
      </div>

      <div class="grid">
        <section class="panel">
          <p class="eyebrow">Verification checks</p>
          <h2>What passed</h2>
          <ul>${checks || '<li>No packet checks are available in this checkout.</li>'}</ul>
        </section>
        <section class="panel">
          <p class="eyebrow">Included evidence</p>
          <h2>What you can inspect directly</h2>
          <ul>${evidenceLinks || '<li>No committed evidence files are available in this checkout.</li>'}</ul>
        </section>
      </div>

      <section class="panel" style="margin-top: 20px;">
        <p class="eyebrow">Truthful limits</p>
        <h2>What this sample does not hide</h2>
        <ul>${limitations || '<li>No packet-specific limitations are available in this checkout.</li>'}</ul>
      </section>
    </main>
  </body>
</html>`;
}

