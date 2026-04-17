import type {
  ReleaseReviewerQueueDetail,
  ReleaseReviewerQueueListResult,
} from '../release-kernel/reviewer-queue.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function badgeClass(riskClass: string): string {
  return riskClass === 'R4' ? 'risk-highest' : riskClass === 'R3' ? 'risk-high' : 'risk-base';
}

function renderInboxItems(items: readonly ReleaseReviewerQueueListResult['items'][number][]): string {
  if (items.length === 0) {
    return `
      <article class="empty">
        <h2>No pending release reviews.</h2>
        <p>The release layer currently has no queued human-authorization items.</p>
      </article>
    `;
  }

  return items
    .map(
      (item) => `
        <article class="card">
          <div class="card-top">
            <span class="badge ${badgeClass(item.riskClass)}">${escapeHtml(item.riskClass)} · ${escapeHtml(item.riskLabel)}</span>
            <span class="badge">${escapeHtml(item.consequenceLabel)}</span>
          </div>
          <h2>${escapeHtml(item.headline)}</h2>
          <p class="summary">${escapeHtml(item.summary)}</p>
          <dl class="meta">
            <div><dt>Requester</dt><dd>${escapeHtml(item.requesterLabel)}</dd></div>
            <div><dt>Target</dt><dd>${escapeHtml(item.targetDisplayName)}</dd></div>
            <div><dt>Authority</dt><dd>${escapeHtml(item.authorityMode)} / ${item.minimumReviewerCount}</dd></div>
            <div><dt>Decision</dt><dd>${escapeHtml(item.decisionId)}</dd></div>
          </dl>
          <p class="finding"><strong>Why it is waiting:</strong> ${escapeHtml(item.findingSummary)}</p>
          <p class="checklist"><strong>Next reviewer move:</strong> ${escapeHtml(item.checklistSummary)}</p>
          <a class="action" href="/api/v1/admin/release-reviews/${encodeURIComponent(item.id)}/view">Open review packet</a>
        </article>
      `,
    )
    .join('');
}

export function renderReleaseReviewerQueueInboxPage(
  result: ReleaseReviewerQueueListResult,
): string {
  const cards = renderInboxItems(result.items);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Attestor reviewer inbox</title>
    <style>
      :root {
        color-scheme: light;
        --ink: #1c160f;
        --muted: #6e6659;
        --paper: #fbf6e8;
        --card: rgba(255, 252, 244, 0.92);
        --line: rgba(123, 103, 54, 0.16);
        --accent: #9c7331;
        --accent-soft: rgba(156, 115, 49, 0.14);
        --alert: #9e2f2f;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(255,255,255,0.85), transparent 32%),
          linear-gradient(180deg, #faf6ea 0%, #f3ead2 100%);
      }
      main {
        max-width: 1240px;
        margin: 0 auto;
        padding: 54px 28px 72px;
      }
      .eyebrow {
        margin: 0 0 14px;
        font-size: 12px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--accent);
        font-weight: 700;
      }
      h1 {
        margin: 0;
        font-size: clamp(36px, 5vw, 62px);
        line-height: 0.96;
        letter-spacing: -0.04em;
      }
      .lede {
        max-width: 760px;
        margin: 18px 0 0;
        color: var(--muted);
        line-height: 1.7;
        font-size: 17px;
      }
      .stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 14px;
        margin: 28px 0 32px;
      }
      .stat {
        padding: 18px;
        border-radius: 20px;
        background: var(--card);
        border: 1px solid var(--line);
      }
      .stat span {
        display: block;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: var(--muted);
      }
      .stat strong {
        display: block;
        margin-top: 8px;
        font-size: 28px;
      }
      .cards {
        display: grid;
        gap: 18px;
      }
      .card, .empty {
        border-radius: 26px;
        background: var(--card);
        border: 1px solid var(--line);
        padding: 26px;
        box-shadow: 0 16px 40px rgba(60, 46, 17, 0.08);
      }
      .card-top {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-bottom: 14px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 7px 12px;
        border-radius: 999px;
        background: rgba(255,255,255,0.75);
        border: 1px solid var(--line);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .risk-highest { background: rgba(158, 47, 47, 0.14); color: var(--alert); }
      .risk-high { background: rgba(156, 115, 49, 0.16); color: var(--accent); }
      .risk-base { background: var(--accent-soft); color: var(--accent); }
      h2 {
        margin: 0;
        font-size: 30px;
        line-height: 1.05;
      }
      .summary, .finding, .checklist {
        color: var(--muted);
        line-height: 1.7;
      }
      .meta {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 14px;
        margin: 18px 0;
      }
      dt {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--muted);
      }
      dd {
        margin: 6px 0 0;
        font-weight: 600;
      }
      .action {
        display: inline-flex;
        margin-top: 12px;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: 0 18px;
        border-radius: 999px;
        background: #1c160f;
        color: #fff;
        text-decoration: none;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">Attestor reviewer inbox</p>
      <h1>Human authority before consequence.</h1>
      <p class="lede">This inbox only shows release candidates that are genuinely waiting on reviewer authority. Deterministic checks are already attached; the reviewer should be deciding whether the candidate has earned consequence, not reconstructing the run from scratch.</p>
      <section class="stats">
        <article class="stat"><span>Total pending</span><strong>${result.totalPending}</strong></article>
        <article class="stat"><span>R4 regulated</span><strong>${result.countsByRiskClass.R4}</strong></article>
        <article class="stat"><span>R3 high consequence</span><strong>${result.countsByRiskClass.R3}</strong></article>
        <article class="stat"><span>Generated</span><strong>${escapeHtml(result.generatedAt.slice(11, 19))}</strong></article>
      </section>
      <section class="cards">${cards}</section>
    </main>
  </body>
</html>`;
}

function renderFindingList(detail: ReleaseReviewerQueueDetail): string {
  if (detail.findings.length === 0) {
    return '<li>No findings were attached to this release decision.</li>';
  }

  return detail.findings
    .map(
      (finding) =>
        `<li><strong>${escapeHtml(finding.code)}</strong> · ${escapeHtml(finding.result)} · ${escapeHtml(finding.message)}</li>`,
    )
    .join('');
}

function renderTimeline(detail: ReleaseReviewerQueueDetail): string {
  if (detail.timeline.length === 0) {
    return '<li>No decision-log timeline is available yet.</li>';
  }

  return detail.timeline
    .map(
      (entry) =>
        `<li><strong>${escapeHtml(entry.phase)}</strong> at ${escapeHtml(entry.occurredAt)} · status ${escapeHtml(entry.decisionStatus)}${entry.requiresReview ? ' · review required' : ''}${entry.deterministicChecksCompleted ? ' · deterministic checks complete' : ''}</li>`,
    )
    .join('');
}

function renderChecklist(detail: ReleaseReviewerQueueDetail): string {
  return detail.checklist
    .map(
      (entry) =>
        `<li><strong>${escapeHtml(entry.emphasis === 'primary' ? 'Primary' : 'Support')}:</strong> ${escapeHtml(entry.label)}</li>`,
    )
    .join('');
}

function renderRowPreview(detail: ReleaseReviewerQueueDetail): string {
  if (detail.candidate.previewRows.length === 0) {
    return '<p class="mono">No row preview available.</p>';
  }

  return `<pre class="mono">${escapeHtml(JSON.stringify(detail.candidate.previewRows, null, 2))}</pre>`;
}

export function renderReleaseReviewerQueueDetailPage(
  detail: ReleaseReviewerQueueDetail,
): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(detail.headline)}</title>
    <style>
      :root {
        color-scheme: light;
        --ink: #201a12;
        --muted: #6d6657;
        --paper: #fbf7ea;
        --card: rgba(255, 253, 247, 0.94);
        --line: rgba(116, 98, 56, 0.16);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top right, rgba(255,255,255,0.84), transparent 30%),
          linear-gradient(180deg, #fbf6e8 0%, #efe4c5 100%);
      }
      main {
        max-width: 1180px;
        margin: 0 auto;
        padding: 46px 28px 68px;
      }
      .eyebrow {
        margin: 0 0 12px;
        font-size: 12px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: #9a742e;
        font-weight: 700;
      }
      h1 {
        margin: 0;
        font-size: clamp(34px, 4.6vw, 58px);
        line-height: 0.98;
        letter-spacing: -0.04em;
      }
      .lede {
        max-width: 840px;
        color: var(--muted);
        line-height: 1.7;
        margin-top: 16px;
      }
      .grid {
        display: grid;
        grid-template-columns: 1.2fr 0.8fr;
        gap: 20px;
        margin-top: 28px;
      }
      .panel {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 24px;
        padding: 22px;
        box-shadow: 0 16px 40px rgba(60, 46, 17, 0.08);
      }
      h2 {
        margin: 0 0 14px;
        font-size: 24px;
      }
      ul {
        margin: 0;
        padding-left: 20px;
        line-height: 1.7;
        color: var(--muted);
      }
      .meta {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 14px;
      }
      dt {
        font-size: 12px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--muted);
      }
      dd {
        margin: 8px 0 0;
        font-weight: 600;
      }
      .mono {
        margin: 0;
        padding: 16px;
        overflow: auto;
        border-radius: 18px;
        background: #17130d;
        color: #f4efe0;
        font-family: Consolas, "SFMono-Regular", monospace;
        font-size: 13px;
        line-height: 1.55;
      }
      @media (max-width: 920px) {
        .grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">Release review packet</p>
      <h1>${escapeHtml(detail.headline)}</h1>
      <p class="lede">${escapeHtml(detail.summary)}</p>
      <section class="grid">
        <article class="panel">
          <h2>Candidate preview</h2>
          <dl class="meta">
            <div><dt>Run</dt><dd>${escapeHtml(detail.candidate.runId)}</dd></div>
            <div><dt>Adapter</dt><dd>${escapeHtml(detail.candidate.adapterId)}</dd></div>
            <div><dt>Proof mode</dt><dd>${escapeHtml(detail.candidate.proofMode)}</dd></div>
            <div><dt>Receipt</dt><dd>${escapeHtml(detail.candidate.receiptStatus ?? 'none')}</dd></div>
            <div><dt>Oversight</dt><dd>${escapeHtml(detail.candidate.oversightStatus ?? 'unknown')}</dd></div>
            <div><dt>Rows</dt><dd>${detail.candidate.rowCount}</dd></div>
          </dl>
          ${renderRowPreview(detail)}
        </article>
        <article class="panel">
          <h2>Reviewer checklist</h2>
          <ul>${renderChecklist(detail)}</ul>
        </article>
        <article class="panel">
          <h2>Decision findings</h2>
          <ul>${renderFindingList(detail)}</ul>
        </article>
        <article class="panel">
          <h2>Decision timeline</h2>
          <ul>${renderTimeline(detail)}</ul>
        </article>
      </section>
    </main>
  </body>
</html>`;
}
