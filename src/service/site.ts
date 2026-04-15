import {
  DEFAULT_HOSTED_PLAN_ID,
  type HostedPlanId,
  listHostedPlans,
  resolvePlanStripeTrialDays,
} from './plan-catalog.js';

interface SitePlanView {
  id: HostedPlanId;
  displayName: string;
  description: string;
  audience: string;
  price: string;
  cadence: string;
  ctaLabel: string;
  note: string;
  quotaLabel: string;
  trialLabel: string | null;
  intendedFor: 'self_host' | 'hosted' | 'enterprise';
  includes: string[];
}

const SITE_PLAN_COPY: Record<HostedPlanId, Omit<SitePlanView, 'id' | 'displayName' | 'description' | 'quotaLabel' | 'trialLabel' | 'intendedFor'>> = {
  community: {
    audience: 'Local proof runs, self-hosted evaluation, first account setup.',
    price: 'Free',
    cadence: '',
    ctaLabel: 'Start with Community',
    note: 'Zero-cost path. Use the repo locally or create the account you will keep later.',
    includes: [
      'Local proof and verification path',
      'Hosted account signup',
      'First tenant API key',
      'No included hosted pipeline runs',
    ],
  },
  starter: {
    audience: 'First production team that wants governed hosted access quickly.',
    price: 'EUR 499',
    cadence: '/ month',
    ctaLabel: 'Start Starter',
    note: 'The first hosted paid plan. Best for the first live workflow.',
    includes: [
      'Hosted account and tenant boundary',
      '100 governed runs each month',
      'Usage, entitlement, and billing surface',
      'Stripe-managed billing and invoices',
    ],
  },
  pro: {
    audience: 'Repeated operational use across multiple workflows or internal teams.',
    price: 'EUR 1,999',
    cadence: '/ month',
    ctaLabel: 'Choose Pro',
    note: 'Higher throughput and stronger runtime headroom for real internal adoption.',
    includes: [
      '1,000 governed runs each month',
      'Higher rate limits and queue capacity',
      'Same account, upgraded entitlement',
      'Hosted billing and account operations',
    ],
  },
  enterprise: {
    audience: 'Banks, hospitals, insurers, and teams needing stricter boundaries.',
    price: 'From EUR 7,500',
    cadence: '/ month',
    ctaLabel: 'Choose Enterprise',
    note: 'Hosted or private deployment path with negotiated rollout boundary.',
    includes: [
      'Negotiated limits and commercial path',
      'Hosted or private deployment',
      'Security and compliance onboarding',
      'Operational rollout support',
    ],
  },
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}

function quotaLabel(monthlyRunQuota: number | null, intendedFor: SitePlanView['intendedFor']): string {
  if (intendedFor === 'self_host') return 'No included hosted pipeline runs';
  if (monthlyRunQuota === null) return 'Negotiated run capacity';
  return `${monthlyRunQuota.toLocaleString('en-US')} governed runs / month`;
}

function buildSitePlans(): SitePlanView[] {
  return listHostedPlans().map((plan) => {
    const copy = SITE_PLAN_COPY[plan.id];
    const trialDays = resolvePlanStripeTrialDays(plan.id).trialDays;
    return {
      id: plan.id,
      displayName: plan.displayName,
      description: plan.description,
      audience: copy.audience,
      price: copy.price,
      cadence: copy.cadence,
      ctaLabel: copy.ctaLabel,
      note: copy.note,
      quotaLabel: quotaLabel(plan.defaultMonthlyRunQuota, plan.intendedFor),
      trialLabel: trialDays ? `${trialDays}-day free trial` : null,
      intendedFor: plan.intendedFor,
      includes: copy.includes,
    };
  });
}

function renderPlanRails(plans: SitePlanView[]): string {
  return plans.map((plan) => {
    const trialMarkup = plan.trialLabel
      ? `<div><span>Trial</span><strong>${escapeHtml(plan.trialLabel)}</strong></div>`
      : `<div><span>Trial</span><strong>No default trial</strong></div>`;
    return `<article class="plan-rail${plan.id === DEFAULT_HOSTED_PLAN_ID ? ' is-selected' : ''}" data-plan-card="${escapeHtml(plan.id)}" data-plan="${escapeHtml(plan.id)}" data-reveal>
      <div class="plan-top">
        <small>${escapeHtml(plan.intendedFor === 'enterprise' ? 'Deployment path' : plan.intendedFor === 'hosted' ? 'Hosted API' : 'Evaluation')}</small>
        <h3>${escapeHtml(plan.displayName)}</h3>
        <p class="plan-audience">${escapeHtml(plan.audience)}</p>
      </div>
      <div class="plan-price">
        <strong>${escapeHtml(plan.price)}</strong>
        <span>${escapeHtml(plan.cadence)}</span>
      </div>
      <p class="plan-note">${escapeHtml(plan.note)}</p>
      <div class="plan-meta">
        <div><span>Volume</span><strong>${escapeHtml(plan.quotaLabel)}</strong></div>
        ${trialMarkup}
      </div>
      <ul>
        ${plan.includes.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
      </ul>
      <button class="button button-secondary" type="button" data-plan-start="${escapeHtml(plan.id)}">${escapeHtml(plan.ctaLabel)}</button>
    </article>`;
  }).join('');
}

function renderPlanToggles(plans: SitePlanView[]): string {
  return plans.map((plan) => `<button class="plan-toggle${plan.id === DEFAULT_HOSTED_PLAN_ID ? ' is-selected' : ''}" type="button" data-plan-toggle="${escapeHtml(plan.id)}">${escapeHtml(plan.displayName)}</button>`).join('');
}

function renderPlanComparison(): string {
  const rows = [
    {
      label: 'Hosted account signup',
      values: ['Yes', 'Yes', 'Yes', 'Yes'],
    },
    {
      label: 'Included hosted runs / month',
      values: ['0 included', '100', '1,000', 'Negotiated'],
    },
    {
      label: 'Stripe billing / portal',
      values: ['Upgrade path only', 'Included', 'Included', 'Included'],
    },
    {
      label: 'Trial',
      values: ['No', '14 days', 'No default', 'Negotiated'],
    },
    {
      label: 'API key management',
      values: ['Yes', 'Yes', 'Yes', 'Yes'],
    },
    {
      label: 'Rate limit + async headroom',
      values: ['Evaluation only', 'Standard', 'Higher', 'Negotiated'],
    },
    {
      label: 'Private deployment path',
      values: ['Self-host evaluation', 'No', 'No', 'Yes'],
    },
  ];

  return `<div class="matrix-wrap" data-reveal>
    <table class="plan-matrix">
      <thead>
        <tr>
          <th>Included by plan</th>
          <th>Community</th>
          <th>Starter</th>
          <th>Pro</th>
          <th>Enterprise</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `<tr>
          <th>${escapeHtml(row.label)}</th>
          ${row.values.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

const SITE_STYLES = String.raw`
  :root {
    color-scheme: light;
    --ink: #0d1827;
    --ink-soft: #32455c;
    --muted: #68798d;
    --line: rgba(19, 46, 78, 0.12);
    --surface: #f6f0e8;
    --surface-2: #eef4fb;
    --panel: rgba(255, 255, 255, 0.82);
    --panel-strong: rgba(255, 255, 255, 0.94);
    --accent: #0a78d1;
    --accent-strong: #07529b;
    --gold: #be7a20;
    --success: #0f8e64;
    --warning: #b96d05;
    --danger: #b54936;
    --shadow: 0 28px 80px rgba(13, 24, 39, 0.14);
    font-family: "Space Grotesk", "Aptos", sans-serif;
  }

  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }

  body {
    margin: 0;
    min-height: 100vh;
    color: var(--ink);
    background:
      radial-gradient(circle at 16% 16%, rgba(10, 120, 209, 0.16), transparent 22%),
      radial-gradient(circle at 86% 18%, rgba(190, 122, 32, 0.12), transparent 20%),
      linear-gradient(180deg, #fcf7f1 0%, #eef4fb 52%, #f7f1e8 100%);
  }

  a { color: inherit; }
  button, input, textarea, select { font: inherit; }

  .site-shell { position: relative; overflow: clip; }

  .topbar {
    position: sticky;
    top: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    padding: 18px 28px;
    backdrop-filter: blur(22px);
    background: rgba(250, 247, 241, 0.78);
    border-bottom: 1px solid rgba(19, 46, 78, 0.08);
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 14px;
    text-decoration: none;
    font-weight: 700;
    letter-spacing: -0.03em;
  }

  .brand-mark {
    width: 38px;
    height: 38px;
    border-radius: 12px;
    background: linear-gradient(135deg, rgba(10, 120, 209, 0.95), rgba(7, 82, 155, 0.98));
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.3);
    position: relative;
  }

  .brand-mark::before,
  .brand-mark::after {
    content: '';
    position: absolute;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.34);
  }

  .brand-mark::before { inset: 8px; }
  .brand-mark::after { inset: 13px; border-radius: 5px; background: rgba(255, 255, 255, 0.14); }

  .brand-copy { display: grid; gap: 2px; }
  .brand-subtitle { font-size: 0.72rem; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase; }

  .topnav {
    display: flex;
    align-items: center;
    gap: 18px;
    flex-wrap: wrap;
  }

  .topnav a { text-decoration: none; font-size: 0.92rem; color: var(--ink-soft); }
  .topbar-actions { display: inline-flex; gap: 10px; align-items: center; }

  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 46px;
    padding: 0 18px;
    border-radius: 999px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--ink);
    text-decoration: none;
    font-weight: 600;
    cursor: pointer;
    transition: transform 180ms ease, box-shadow 180ms ease, background-color 180ms ease, border-color 180ms ease, color 180ms ease;
  }

  .button:hover, .button:focus-visible { transform: translateY(-1px); }
  .button:focus-visible, .field input:focus-visible, .field textarea:focus-visible {
    outline: 2px solid rgba(10, 120, 209, 0.38);
    outline-offset: 3px;
  }

  .button-primary { background: linear-gradient(135deg, var(--accent), var(--accent-strong)); color: #fff; box-shadow: 0 16px 28px rgba(10, 120, 209, 0.24); }
  .button-secondary { border-color: rgba(19, 46, 78, 0.12); background: rgba(255,255,255,0.72); }
  .button-ghost { border-color: rgba(19, 46, 78, 0.12); color: var(--ink-soft); }
  .button-small { min-height: 38px; padding: 0 14px; font-size: 0.9rem; }

  .hero {
    min-height: calc(100svh - 76px);
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
    gap: 44px;
    align-items: center;
    padding: 40px 28px 76px;
  }

  .hero-copy { width: min(620px, 100%); margin-left: clamp(0px, 4vw, 44px); }
  .eyebrow { display: inline-flex; align-items: center; gap: 10px; margin-bottom: 20px; font-size: 0.82rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent-strong); }
  .eyebrow::before { content: ''; width: 34px; height: 1px; background: currentColor; }

  .hero h1 {
    margin: 0;
    max-width: 10ch;
    font-size: clamp(3.2rem, 7vw, 6.2rem);
    line-height: 0.92;
    letter-spacing: -0.07em;
  }

  .hero p, .section-head p, .rail p, .rail li, .path-band p, .path-band li, .console-panel p, .fine-print {
    color: var(--ink-soft);
    line-height: 1.66;
  }

  .hero p { margin: 24px 0 0; max-width: 34rem; font-size: clamp(1rem, 1.35vw, 1.16rem); }
  .hero-actions { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 30px; }

  .hero-notes {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px 24px;
    margin-top: 34px;
    padding-top: 26px;
    border-top: 1px solid var(--line);
  }

  .hero-notes div { display: grid; gap: 6px; }
  .hero-notes dt { font-size: 0.76rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
  .hero-notes dd { margin: 0; font-size: 1rem; line-height: 1.4; }

  .hero-visual { position: relative; min-height: 620px; display: grid; place-items: center; }
  .hero-map {
    position: relative;
    width: min(620px, calc(100vw - 56px));
    aspect-ratio: 1 / 1;
    border-radius: 50%;
    border: 1px solid rgba(19, 46, 78, 0.1);
    background: radial-gradient(circle at center, rgba(255,255,255,0.88), rgba(255,255,255,0.28) 48%, rgba(255,255,255,0.06) 72%, transparent 74%), radial-gradient(circle at center, rgba(10,120,209,0.05), transparent 60%);
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.55), var(--shadow);
    overflow: hidden;
  }

  .hero-ring, .hero-ring::before, .hero-ring::after { position: absolute; inset: 0; border-radius: 50%; }
  .hero-ring { inset: 9%; border: 1px solid rgba(10, 120, 209, 0.16); }
  .hero-ring::before, .hero-ring::after { content: ''; inset: 12%; border: 1px solid rgba(19, 46, 78, 0.08); }
  .hero-ring::after { inset: 26%; border-color: rgba(190, 122, 32, 0.18); }

  .hero-node {
    position: absolute;
    display: grid;
    gap: 8px;
    width: 180px;
    padding: 18px;
    border-radius: 24px;
    background: rgba(255,255,255,0.82);
    box-shadow: 0 18px 36px rgba(13,24,39,0.1);
    border: 1px solid rgba(19, 46, 78, 0.08);
    backdrop-filter: blur(18px);
  }

  .hero-node small { font-size: 0.74rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
  .hero-node strong { font-size: 1.1rem; letter-spacing: -0.03em; }
  .hero-node span { color: var(--ink-soft); font-size: 0.94rem; line-height: 1.45; }
  .hero-node-left { top: 16%; left: 7%; }
  .hero-node-core { inset: 50%; transform: translate(-50%, -50%); width: 250px; text-align: center; align-items: center; background: linear-gradient(180deg, rgba(255,255,255,0.96), rgba(244,251,255,0.92)); }
  .hero-node-core strong { font-size: 1.45rem; }
  .hero-node-right { right: 7%; bottom: 16%; }

  .hero-trace {
    position: absolute;
    border-radius: 999px;
    background: linear-gradient(90deg, rgba(10,120,209,0), rgba(10,120,209,0.28), rgba(10,120,209,0));
    animation: tracePulse 4.5s ease-in-out infinite;
  }
  .hero-trace.trace-one { top: 36%; left: 20%; width: 270px; height: 2px; transform: rotate(12deg); }
  .hero-trace.trace-two { right: 21%; bottom: 36%; width: 250px; height: 2px; transform: rotate(12deg); animation-delay: 1.2s; }
  .hero-trace.trace-three { inset: 50% auto auto 50%; width: 160px; height: 1px; transform: translate(-50%, -50%) rotate(90deg); animation-delay: 2s; }
  .hero-pulse { position: absolute; width: 14px; height: 14px; border-radius: 50%; background: linear-gradient(135deg, rgba(10,120,209,0.95), rgba(190,122,32,0.9)); box-shadow: 0 0 0 12px rgba(10,120,209,0.08); animation: orbitPulse 4s ease-in-out infinite; }
  .hero-pulse.one { top: 32%; left: 43%; }
  .hero-pulse.two { right: 35%; bottom: 32%; animation-delay: 1.5s; }

  .section { padding: 96px 28px; }
  .section-inner { width: min(1220px, 100%); margin: 0 auto; }
  .section-head { display: grid; gap: 14px; margin-bottom: 42px; }
  .section-head h2 { margin: 0; max-width: 14ch; font-size: clamp(2.1rem, 4vw, 3.6rem); line-height: 0.98; letter-spacing: -0.06em; }

  .rail-grid, .path-band, .pricing-grid, .console-layout { display: grid; gap: 20px; }
  .rail-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .rail { padding-top: 28px; border-top: 1px solid var(--line); }
  .rail span { display: block; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent-strong); }
  .rail h3, .path-band h3, .console-panel h3 { margin: 14px 0 12px; letter-spacing: -0.04em; }
  .rail h3 { font-size: 1.48rem; }

  .path-band {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    padding: 30px;
    border-radius: 30px;
    background: linear-gradient(135deg, rgba(255,255,255,0.86), rgba(255,255,255,0.62));
    border: 1px solid rgba(19, 46, 78, 0.08);
    box-shadow: var(--shadow);
  }

  .path-band article { display: grid; gap: 12px; padding-right: 20px; border-right: 1px solid var(--line); }
  .path-band article:last-child { border-right: none; padding-right: 0; }
  .path-band ul, .plan-rail ul { margin: 4px 0 0; padding-left: 18px; }

  .pricing-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .plan-rail {
    position: relative;
    display: grid;
    gap: 18px;
    min-height: 100%;
    padding: 26px 24px 24px;
    border-radius: 28px;
    border: 1px solid rgba(19, 46, 78, 0.08);
    background: rgba(255,255,255,0.8);
    box-shadow: 0 14px 34px rgba(13,24,39,0.08);
    transition: transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease;
  }

  .plan-rail::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 6px; border-radius: 28px 0 0 28px; background: rgba(10,120,209,0.12); }
  .plan-rail[data-plan="starter"]::before { background: linear-gradient(180deg, rgba(10,120,209,0.84), rgba(10,120,209,0.28)); }
  .plan-rail[data-plan="enterprise"]::before { background: linear-gradient(180deg, rgba(190,122,32,0.84), rgba(190,122,32,0.28)); }
  .plan-rail.is-selected, .plan-rail:hover { transform: translateY(-4px); border-color: rgba(10,120,209,0.22); box-shadow: 0 24px 50px rgba(13,24,39,0.12); }
  .plan-top { display: grid; gap: 10px; }
  .plan-top small { font-size: 0.75rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
  .plan-top h3 { margin: 0; font-size: 1.55rem; letter-spacing: -0.05em; }
  .plan-price { display: flex; align-items: baseline; gap: 8px; font-weight: 700; letter-spacing: -0.06em; }
  .plan-price strong { font-size: 2rem; }
  .plan-price span { font-size: 0.95rem; color: var(--muted); }
  .plan-meta { display: grid; gap: 8px; padding-top: 8px; border-top: 1px solid var(--line); }
  .plan-meta div { display: flex; justify-content: space-between; gap: 14px; font-size: 0.95rem; color: var(--ink-soft); }
  .plan-meta strong { color: var(--ink); letter-spacing: -0.02em; }

  .matrix-wrap {
    margin-top: 28px;
    overflow-x: auto;
    border-radius: 28px;
    border: 1px solid rgba(19, 46, 78, 0.08);
    background: rgba(255,255,255,0.82);
    box-shadow: 0 16px 40px rgba(13,24,39,0.08);
  }

  .plan-matrix {
    width: 100%;
    min-width: 860px;
    border-collapse: collapse;
  }

  .plan-matrix th,
  .plan-matrix td {
    padding: 16px 18px;
    text-align: left;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }

  .plan-matrix thead th {
    font-size: 0.76rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
    background: rgba(247, 250, 255, 0.9);
  }

  .plan-matrix tbody th {
    width: 24%;
    font-size: 0.95rem;
    color: var(--ink);
  }

  .plan-matrix tbody td {
    color: var(--ink-soft);
    line-height: 1.55;
  }

  .console-section { padding-top: 90px; }
  .console-shell { border-radius: 34px; border: 1px solid rgba(19, 46, 78, 0.08); background: linear-gradient(180deg, rgba(255,255,255,0.96), rgba(244,249,255,0.88)); box-shadow: var(--shadow); overflow: hidden; }
  .console-head { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 18px 24px; border-bottom: 1px solid var(--line); background: rgba(13,24,39,0.96); color: #f6f8fb; }
  .session-pill { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 999px; background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.92); font-size: 0.88rem; }
  .session-pill::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: #90a5be; }
  .session-pill.is-live::before { background: #38c69a; box-shadow: 0 0 0 6px rgba(56,198,154,0.15); }
  .console-layout { grid-template-columns: minmax(320px, 0.42fr) minmax(0, 0.58fr); gap: 0; }
  .console-aside { padding: 28px 24px 30px; border-right: 1px solid var(--line); background: rgba(248,250,253,0.84); }
  .console-main { padding: 28px 24px 30px; }
  .console-stack, .field-grid { display: grid; gap: 22px; }
  .field-grid.two, .summary-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
  .console-panel { display: grid; gap: 18px; padding: 22px 20px; border-radius: 24px; background: rgba(255,255,255,0.86); border: 1px solid rgba(19, 46, 78, 0.08); }
  .field { display: grid; gap: 8px; }
  .field label { font-size: 0.84rem; font-weight: 600; color: var(--ink-soft); }
  .field input, .field textarea {
    width: 100%;
    min-height: 46px;
    padding: 12px 14px;
    border-radius: 16px;
    border: 1px solid rgba(19, 46, 78, 0.12);
    background: rgba(255,255,255,0.92);
    color: var(--ink);
  }
  .plan-selector, .panel-actions, .key-actions { display: flex; flex-wrap: wrap; gap: 10px; }
  .plan-toggle { min-height: 40px; padding: 0 14px; border-radius: 999px; border: 1px solid rgba(19, 46, 78, 0.12); background: rgba(255,255,255,0.78); color: var(--ink-soft); cursor: pointer; }
  .plan-toggle.is-selected { background: rgba(10,120,209,0.12); border-color: rgba(10,120,209,0.24); color: var(--accent-strong); }

  .status-banner { display: none; gap: 12px; align-items: flex-start; padding: 16px 18px; border-radius: 18px; border: 1px solid rgba(19, 46, 78, 0.08); background: rgba(255,255,255,0.74); }
  .status-banner.is-visible { display: grid; }
  .status-banner.is-success { background: rgba(15,142,100,0.08); border-color: rgba(15,142,100,0.14); }
  .status-banner.is-warning { background: rgba(185,109,5,0.08); border-color: rgba(185,109,5,0.14); }
  .status-banner.is-danger { background: rgba(181,73,54,0.08); border-color: rgba(181,73,54,0.14); }
  .status-banner strong { font-size: 0.82rem; letter-spacing: 0.12em; text-transform: uppercase; }

  .summary-item { padding: 14px 16px; border-radius: 18px; background: rgba(250,252,255,0.94); border: 1px solid rgba(19,46,78,0.08); }
  .summary-item span { display: block; margin-bottom: 8px; font-size: 0.76rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
  .summary-item strong { font-size: 1.06rem; letter-spacing: -0.03em; }

  .key-table-wrap { overflow-x: auto; }
  .key-table { width: 100%; min-width: 700px; border-collapse: collapse; }
  .key-table th, .key-table td { padding: 14px 12px; text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; }
  .key-table th { font-size: 0.76rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
  .pill { display: inline-flex; align-items: center; gap: 8px; min-height: 32px; padding: 0 12px; border-radius: 999px; background: rgba(10,120,209,0.08); color: var(--accent-strong); font-size: 0.86rem; font-weight: 600; }
  .pill.status-active { background: rgba(15,142,100,0.12); color: var(--success); }
  .pill.status-inactive { background: rgba(185,109,5,0.12); color: var(--warning); }
  .pill.status-revoked { background: rgba(181,73,54,0.12); color: var(--danger); }

  .secret-box, .code-box {
    border-radius: 24px;
    padding: 18px;
    background: rgba(12,20,34,0.96);
    color: #eaf3ff;
    border: 1px solid rgba(255,255,255,0.08);
    overflow: hidden;
  }
  .secret-box pre, .code-box pre { margin: 0; font-family: "IBM Plex Mono", "Cascadia Code", monospace; font-size: 0.86rem; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
  .site-footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 18px; padding: 28px; color: var(--muted); font-size: 0.92rem; }

  [data-reveal] { opacity: 1; transform: translateY(0); transition: opacity 600ms ease, transform 600ms ease; }
  [data-reveal].is-visible { opacity: 1; transform: translateY(0); }

  @keyframes tracePulse {
    0%, 100% { opacity: 0.2; }
    50% { opacity: 1; }
  }

  @keyframes orbitPulse {
    0%, 100% { transform: scale(0.92); opacity: 0.66; }
    50% { transform: scale(1.12); opacity: 1; }
  }

  @media (max-width: 1180px) {
    .hero { grid-template-columns: 1fr; gap: 28px; min-height: auto; padding-top: 30px; }
    .hero-copy { margin-left: 0; }
    .hero-visual { min-height: 520px; }
    .rail-grid, .path-band, .pricing-grid, .console-layout { grid-template-columns: 1fr; }
    .path-band article { padding-right: 0; border-right: none; border-bottom: 1px solid var(--line); padding-bottom: 20px; }
    .path-band article:last-child { border-bottom: none; padding-bottom: 0; }
    .console-aside { border-right: none; border-bottom: 1px solid var(--line); }
  }

  @media (max-width: 760px) {
    .topbar { align-items: flex-start; flex-direction: column; }
    .topnav { width: 100%; justify-content: space-between; }
    .hero { padding: 30px 20px 56px; }
    .section { padding: 72px 20px; }
    .hero h1 { max-width: 11ch; font-size: clamp(2.7rem, 14vw, 4.2rem); }
    .hero-notes, .field-grid.two, .summary-grid { grid-template-columns: 1fr; }
    .hero-map { width: min(100%, 560px); }
    .hero-node { width: 150px; padding: 16px; }
    .hero-node-core { width: 220px; }
    .site-footer { padding: 24px 20px 34px; }
  }
`;

const SITE_SCRIPT = String.raw`
(() => {
  const bootstrapNode = document.getElementById('attestor-site-bootstrap');
  const bootstrap = bootstrapNode ? JSON.parse(bootstrapNode.textContent || '{}') : {};
  const state = {
    selectedPlanId: bootstrap.defaultHostedPlanId || 'starter',
    session: null,
    accountSummary: null,
    apiKeys: [],
    lastSecret: '',
    keyAccess: 'pending'
  };

  const els = {
    statusBanner: document.getElementById('status-banner'),
    statusTitle: document.getElementById('status-title'),
    statusText: document.getElementById('status-text'),
    sessionPill: document.getElementById('session-pill'),
    sessionTitle: document.getElementById('session-title'),
    sessionText: document.getElementById('session-text'),
    selectedPlanName: document.getElementById('selected-plan-name'),
    selectedPlanMeta: document.getElementById('selected-plan-meta'),
    primaryAction: document.getElementById('primary-action'),
    portalAction: document.getElementById('portal-action'),
    exportAction: document.getElementById('export-action'),
    accountJsonAction: document.getElementById('account-json-action'),
    refreshAction: document.getElementById('refresh-action'),
    logoutAction: document.getElementById('logout-action'),
    issueKeyAction: document.getElementById('issue-key-action'),
    accountSummary: document.getElementById('account-summary'),
    keyTableBody: document.getElementById('key-table-body'),
    keyEmptyState: document.getElementById('key-empty-state'),
    secretBox: document.getElementById('secret-box'),
    secretValue: document.getElementById('secret-value'),
    secretCopy: document.getElementById('secret-copy'),
    curlSnippet: document.getElementById('curl-snippet'),
    signupForm: document.getElementById('signup-form'),
    loginForm: document.getElementById('login-form'),
  };

  const revealNodes = Array.from(document.querySelectorAll('[data-reveal]'));
  const planCards = Array.from(document.querySelectorAll('[data-plan-card]'));
  const planToggles = Array.from(document.querySelectorAll('[data-plan-toggle]'));

  function planById(planId) {
    return (bootstrap.plans || []).find((plan) => plan.id === planId) || null;
  }

  function planLabel(planId) {
    const plan = planById(planId);
    return plan ? plan.displayName : planId;
  }

  function formatNumber(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'Negotiated';
    return new Intl.NumberFormat('en-US').format(value);
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function setStatus(kind, title, message) {
    if (!els.statusBanner || !els.statusTitle || !els.statusText) return;
    els.statusBanner.className = 'status-banner is-visible is-' + kind;
    els.statusTitle.textContent = title;
    els.statusText.textContent = message;
  }

  function clearStatus() {
    if (!els.statusBanner || !els.statusTitle || !els.statusText) return;
    els.statusBanner.className = 'status-banner';
    els.statusTitle.textContent = '';
    els.statusText.textContent = '';
  }

  function requestJson(pathname, options) {
    const baseHeaders = { Accept: 'application/json' };
    const requestOptions = Object.assign({
      credentials: 'same-origin',
      headers: baseHeaders
    }, options || {});
    requestOptions.headers = Object.assign({}, baseHeaders, (options && options.headers) || {});

    return fetch(pathname, requestOptions).then(async (response) => {
      const contentType = response.headers.get('content-type') || '';
      const payload = contentType.includes('application/json') ? await response.json() : await response.text();
      if (!response.ok) {
        const message = payload && typeof payload === 'object' && payload.error
          ? payload.error
          : (typeof payload === 'string' && payload ? payload : 'Request failed.');
        throw new Error(message);
      }
      return payload;
    });
  }

  function makeIdempotencyKey() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return 'attestor-web-' + window.crypto.randomUUID();
    }
    return 'attestor-web-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function updatePlanSelection(planId) {
    state.selectedPlanId = planId;
    const plan = planById(planId);
    const trial = plan && plan.trialLabel ? ' • ' + plan.trialLabel : '';
    if (els.selectedPlanName) els.selectedPlanName.textContent = plan ? plan.displayName : planId;
    if (els.selectedPlanMeta) {
      els.selectedPlanMeta.textContent = plan
        ? plan.price + (plan.cadence ? ' ' + plan.cadence : '') + ' • ' + plan.quotaLabel + trial
        : '';
    }
    planCards.forEach((node) => {
      node.classList.toggle('is-selected', node.getAttribute('data-plan-card') === planId);
    });
    planToggles.forEach((node) => {
      node.classList.toggle('is-selected', node.getAttribute('data-plan-toggle') === planId);
    });
    if (els.primaryAction) {
      if (!state.session) {
        els.primaryAction.textContent = planId === 'community'
          ? 'Create Community account'
          : 'Create account for ' + planLabel(planId);
      } else {
        els.primaryAction.textContent = planId === 'community'
          ? 'Stay on Community'
          : 'Continue with ' + planLabel(planId);
      }
    }
  }

  function renderSession() {
    const signedIn = Boolean(state.session);
    if (els.sessionPill) {
      els.sessionPill.classList.toggle('is-live', signedIn);
      els.sessionPill.textContent = signedIn ? 'Signed in' : 'Signed out';
    }
    if (els.sessionTitle) {
      els.sessionTitle.textContent = signedIn
        ? state.session.user.displayName + ' • ' + state.session.account.accountName
        : 'Use one account from signup through billing';
    }
    if (els.sessionText) {
      if (signedIn) {
        const plan = state.accountSummary ? state.accountSummary.entitlement.effectivePlanId : state.selectedPlanId;
        els.sessionText.textContent = 'Current plan: ' + planLabel(plan) + '. You can change or manage it from here.';
      } else if (state.selectedPlanId === 'community') {
        els.sessionText.textContent = 'Create the account first. Community is active immediately after signup.';
      } else {
        els.sessionText.textContent = 'Create the account first, then continue into ' + planLabel(state.selectedPlanId) + ' on the same tenant.';
      }
    }
    if (els.portalAction) els.portalAction.disabled = !signedIn;
    if (els.exportAction) els.exportAction.disabled = !signedIn;
    if (els.accountJsonAction) els.accountJsonAction.disabled = !signedIn;
    if (els.logoutAction) els.logoutAction.disabled = !signedIn;
    if (els.issueKeyAction) els.issueKeyAction.disabled = !signedIn;
  }

  function renderAccountSummary() {
    if (!els.accountSummary) return;
    if (!state.accountSummary) {
      els.accountSummary.innerHTML = [
        ['Account', 'Sign up or sign in to load the hosted account state.'],
        ['Plan', 'The selected plan will activate on this same account.'],
        ['Usage', 'Usage and rate limit appear here after login.'],
        ['API keys', 'Key management is available from the same console.']
      ].map((item) => '<div class="summary-item"><span>' + item[0] + '</span><strong>' + item[1] + '</strong></div>').join('');
      return;
    }

    const entitlement = state.accountSummary.entitlement || {};
    const usage = state.accountSummary.usage || {};
    const rateLimit = state.accountSummary.rateLimit || {};
    const account = state.accountSummary.account || {};
    const items = [
      ['Account', account.accountName + ' • ' + account.status],
      ['Tenant', state.accountSummary.tenantContext ? state.accountSummary.tenantContext.tenantId : '—'],
      ['Plan', planLabel(entitlement.effectivePlanId || state.selectedPlanId)],
      ['Entitlement', entitlement.status || '—'],
      ['Monthly runs', usage.monthlyRunQuota === null ? 'Negotiated' : (formatNumber(usage.monthlyRunsUsed || 0) + ' / ' + formatNumber(usage.monthlyRunQuota))],
      ['Rate limit', rateLimit.requestsPerWindow === null ? 'Negotiated' : (formatNumber(rateLimit.requestsPerWindow) + ' requests / ' + formatNumber(rateLimit.windowSeconds || 60) + 's')],
      ['Stripe state', entitlement.stripeSubscriptionStatus || (account.billing && account.billing.stripeSubscriptionStatus) || 'Not started'],
      ['Last billing event', entitlement.lastEventType || 'No billing event yet']
    ];
    els.accountSummary.innerHTML = items.map((item) => '<div class="summary-item"><span>' + item[0] + '</span><strong>' + item[1] + '</strong></div>').join('');
  }

  function renderKeys() {
    if (!els.keyTableBody || !els.keyEmptyState) return;
    const rows = Array.isArray(state.apiKeys) ? state.apiKeys : [];
    if (!rows.length) {
      els.keyTableBody.innerHTML = '';
      els.keyEmptyState.textContent = state.keyAccess === 'forbidden'
        ? 'This signed-in user cannot manage API keys from the current role.'
        : 'No API keys yet. Use "Issue API key" to mint one.';
      return;
    }
    els.keyEmptyState.textContent = '';
    els.keyTableBody.innerHTML = rows.map((record) => {
      const actions = ['<button class="button button-small button-ghost" type="button" data-key-action="rotate" data-key-id="' + record.id + '">Rotate</button>'];
      if (record.status === 'active') actions.push('<button class="button button-small button-ghost" type="button" data-key-action="deactivate" data-key-id="' + record.id + '">Deactivate</button>');
      if (record.status === 'inactive') actions.push('<button class="button button-small button-ghost" type="button" data-key-action="reactivate" data-key-id="' + record.id + '">Reactivate</button>');
      if (record.status !== 'revoked') actions.push('<button class="button button-small button-ghost" type="button" data-key-action="revoke" data-key-id="' + record.id + '">Revoke</button>');
      return '<tr>'
        + '<td><strong>' + record.apiKeyPreview + '</strong><div class="fine-print">Created ' + formatDate(record.createdAt) + '</div></td>'
        + '<td>' + planLabel(record.planId) + '</td>'
        + '<td>' + (record.monthlyRunQuota === null ? 'Negotiated' : formatNumber(record.monthlyRunQuota)) + '</td>'
        + '<td><span class="pill status-' + record.status + '">' + record.status + '</span></td>'
        + '<td>' + formatDate(record.lastUsedAt) + '</td>'
        + '<td><div class="key-actions">' + actions.join('') + '</div></td>'
        + '</tr>';
    }).join('');
  }

  function renderSecret() {
    if (!els.secretBox || !els.secretValue) return;
    if (!state.lastSecret) {
      els.secretBox.style.display = 'none';
      els.secretValue.textContent = '';
      return;
    }
    els.secretBox.style.display = 'block';
    els.secretValue.textContent = state.lastSecret;
  }

  function renderSnippet() {
    if (!els.curlSnippet) return;
    const apiKey = state.lastSecret || '<api-key>';
    els.curlSnippet.textContent = [
      'curl -X POST ' + window.location.origin + '/api/v1/pipeline/run \\',
      '  -H "Content-Type: application/json" \\',
      '  -H "X-Attestor-API-Key: ' + apiKey + '" \\',
      '  -d \'{',
      '    "candidateSql": "select * from counterparty_exposure limit 25",',
      '    "intent": { "goal": "evidence-bound review" },',
      '    "sign": true',
      '  }\''
    ].join('\n');
  }

  function renderAll() {
    renderSession();
    renderAccountSummary();
    renderKeys();
    renderSecret();
    renderSnippet();
  }

  async function loadAccountState() {
    if (!state.session) {
      state.accountSummary = null;
      state.apiKeys = [];
      state.keyAccess = 'pending';
      return;
    }

    state.accountSummary = await requestJson('/api/v1/account');
    try {
      const keysPayload = await requestJson('/api/v1/account/api-keys');
      state.apiKeys = keysPayload.keys || [];
      state.keyAccess = 'granted';
    } catch (error) {
      state.apiKeys = [];
      state.keyAccess = error && error.message && error.message.includes('Not authorized')
        ? 'forbidden'
        : 'pending';
    }
  }

  async function loadSession(silent) {
    try {
      state.session = await requestJson('/api/v1/auth/me');
      await loadAccountState();
      if (!silent) {
        setStatus('success', 'Session ready', 'You are signed in. Continue with ' + planLabel(state.selectedPlanId) + ' when you are ready.');
      }
    } catch (error) {
      state.session = null;
      state.accountSummary = null;
      state.apiKeys = [];
      state.keyAccess = 'pending';
      if (!silent && error && error.message && !error.message.includes('Current account session')) {
        setStatus('warning', 'Sign in required', error.message);
      }
    }
    renderAll();
  }

  async function signup(event) {
    event.preventDefault();
    clearStatus();
    const formData = new FormData(els.signupForm);
    const payload = {
      accountName: String(formData.get('accountName') || '').trim(),
      email: String(formData.get('email') || '').trim(),
      displayName: String(formData.get('displayName') || '').trim(),
      password: String(formData.get('password') || '')
    };
    try {
      const result = await requestJson('/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      state.lastSecret = result.initialKey && result.initialKey.apiKey ? result.initialKey.apiKey : '';
      await loadSession(true);
      setStatus('success', 'Account created', state.selectedPlanId === 'community'
        ? 'Community is active immediately. Your first API key is ready below.'
        : 'The account is ready. Continue with ' + planLabel(state.selectedPlanId) + ' whenever you want to open Stripe Checkout.');
      renderAll();
    } catch (error) {
      setStatus('danger', 'Signup failed', error.message);
    }
  }

  async function login(event) {
    event.preventDefault();
    clearStatus();
    const formData = new FormData(els.loginForm);
    const payload = {
      email: String(formData.get('email') || '').trim(),
      password: String(formData.get('password') || '')
    };
    try {
      const result = await requestJson('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (result.mfaRequired) {
        setStatus('warning', 'MFA required', 'This account requires MFA verification before the hosted session can continue.');
        return;
      }
      await loadSession(true);
      setStatus('success', 'Signed in', 'You can now continue with ' + planLabel(state.selectedPlanId) + ', open the billing portal, or manage API keys.');
    } catch (error) {
      setStatus('danger', 'Sign-in failed', error.message);
    }
  }

  async function beginSelectedPlan() {
    if (!state.session) {
      const signupCard = document.getElementById('signup-card');
      if (signupCard) signupCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setStatus('warning', 'Create the account first', 'Signup comes first. The same account continues into ' + planLabel(state.selectedPlanId) + '.');
      return;
    }
    if (state.selectedPlanId === 'community') {
      await loadAccountState();
      setStatus('success', 'Community is active', 'You are already on the zero-cost evaluation path for this same account.');
      renderAll();
      return;
    }
    try {
      const result = await requestJson('/api/v1/account/billing/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': makeIdempotencyKey()
        },
        body: JSON.stringify({ planId: state.selectedPlanId })
      });
      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      setStatus('warning', 'Checkout unavailable', 'The checkout URL was not returned by the runtime.');
    } catch (error) {
      setStatus('danger', 'Checkout failed', error.message);
    }
  }

  async function openPortal() {
    try {
      const result = await requestJson('/api/v1/account/billing/portal', { method: 'POST' });
      if (result.portalUrl) {
        window.location.assign(result.portalUrl);
        return;
      }
      setStatus('warning', 'Portal unavailable', 'The billing portal URL was not returned by the runtime.');
    } catch (error) {
      setStatus('danger', 'Portal failed', error.message);
    }
  }

  async function issueKey() {
    try {
      const result = await requestJson('/api/v1/account/api-keys', { method: 'POST' });
      state.lastSecret = result.key && result.key.apiKey ? result.key.apiKey : state.lastSecret;
      await loadAccountState();
      setStatus('success', 'API key issued', 'A new tenant API key was created. Copy it now and store it safely.');
      renderAll();
    } catch (error) {
      setStatus('danger', 'Could not issue key', error.message);
    }
  }

  async function mutateKey(keyId, action) {
    try {
      const result = await requestJson('/api/v1/account/api-keys/' + encodeURIComponent(keyId) + '/' + action, { method: 'POST' });
      if (action === 'rotate' && result.newKey && result.newKey.apiKey) {
        state.lastSecret = result.newKey.apiKey;
      }
      await loadAccountState();
      setStatus('success', 'Key updated', 'Key action "' + action + '" completed successfully.');
      renderAll();
    } catch (error) {
      setStatus('danger', 'Key action failed', error.message);
    }
  }

  async function logout() {
    try {
      await requestJson('/api/v1/auth/logout', { method: 'POST' });
      state.session = null;
      state.accountSummary = null;
      state.apiKeys = [];
      setStatus('success', 'Signed out', 'The hosted account session is closed.');
      renderAll();
    } catch (error) {
      setStatus('danger', 'Could not sign out', error.message);
    }
  }

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const planStart = target.closest('[data-plan-start]');
    if (planStart instanceof HTMLElement) {
      const planId = planStart.getAttribute('data-plan-start');
      if (planId) {
        updatePlanSelection(planId);
        document.getElementById('console').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }

    const planToggle = target.closest('[data-plan-toggle]');
    if (planToggle instanceof HTMLElement) {
      const planId = planToggle.getAttribute('data-plan-toggle');
      if (planId) updatePlanSelection(planId);
      return;
    }

    const keyAction = target.closest('[data-key-action]');
    if (keyAction instanceof HTMLElement) {
      const keyId = keyAction.getAttribute('data-key-id');
      const action = keyAction.getAttribute('data-key-action');
      if (keyId && action) mutateKey(keyId, action);
      return;
    }
  });

  if (els.signupForm) els.signupForm.addEventListener('submit', signup);
  if (els.loginForm) els.loginForm.addEventListener('submit', login);
  if (els.primaryAction) els.primaryAction.addEventListener('click', beginSelectedPlan);
  if (els.portalAction) els.portalAction.addEventListener('click', openPortal);
  if (els.refreshAction) els.refreshAction.addEventListener('click', () => {
    loadSession(true).then(() => setStatus('success', 'Account refreshed', 'The latest account, entitlement, and key state is now loaded.'));
  });
  if (els.exportAction) els.exportAction.addEventListener('click', () => {
    if (!state.session) {
      setStatus('warning', 'Sign in required', 'Open the hosted session first, then export billing.');
      return;
    }
    window.open('/api/v1/account/billing/export?limit=10', '_blank', 'noopener');
  });
  if (els.accountJsonAction) els.accountJsonAction.addEventListener('click', () => {
    if (!state.session) {
      setStatus('warning', 'Sign in required', 'Open the hosted session first, then inspect account JSON.');
      return;
    }
    window.open('/api/v1/account', '_blank', 'noopener');
  });
  if (els.logoutAction) els.logoutAction.addEventListener('click', logout);
  if (els.issueKeyAction) els.issueKeyAction.addEventListener('click', issueKey);
  if (els.secretCopy) els.secretCopy.addEventListener('click', () => {
    if (!state.lastSecret) return;
    navigator.clipboard.writeText(state.lastSecret).then(() => {
      setStatus('success', 'Copied', 'The latest API key was copied. Store it somewhere safe now.');
    }).catch(() => {
      setStatus('warning', 'Copy failed', 'Clipboard access was blocked by the browser.');
    });
  });

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.18 });
    revealNodes.forEach((node) => observer.observe(node));
  } else {
    revealNodes.forEach((node) => node.classList.add('is-visible'));
  }

  updatePlanSelection(state.selectedPlanId);
  loadSession(true).finally(() => {
    renderAll();
    if (window.location.pathname === '/console') {
      setTimeout(() => {
        document.getElementById('console').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    }
  });
})();
`;

function renderSiteMarkup(plans: SitePlanView[]): string {
  const bootstrap = {
    defaultHostedPlanId: DEFAULT_HOSTED_PLAN_ID,
    plans,
  };

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Attestor — Acceptance, proof, and operating infrastructure</title>
    <meta
      name="description"
      content="Attestor is the acceptance, proof, and operating layer between model output and production consequence."
    />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Space+Grotesk:wght@400;500;700&display=swap"
      rel="stylesheet"
    />
    <style>${SITE_STYLES}</style>
  </head>
  <body>
    <div class="site-shell">
      <header class="topbar">
        <a class="brand" href="/">
          <span class="brand-mark" aria-hidden="true"></span>
          <span class="brand-copy">
            <span class="brand-name">Attestor</span>
            <span class="brand-subtitle">Acceptance • Proof • Operate</span>
          </span>
        </a>
        <nav class="topnav" aria-label="Primary">
          <a href="#product">Product</a>
          <a href="#paths">Paths</a>
          <a href="#plans">Plans</a>
          <a href="#console">Console</a>
          <span class="topbar-actions">
            <a class="button button-ghost button-small" href="#console">Sign in</a>
            <a class="button button-primary button-small" href="#console">Start account</a>
          </span>
        </nav>
      </header>

      <main>
        <section class="hero">
          <div class="hero-copy" data-reveal>
            <div class="eyebrow">Acceptance infrastructure for AI-assisted work</div>
            <h1>Between model output and production consequence.</h1>
            <p>
              Attestor gives teams the layer they usually do not have yet:
              governed acceptance, portable proof, and an account surface that can
              actually be bought, rolled out, and operated.
            </p>
            <div class="hero-actions">
              <a class="button button-primary" href="#console">Start with Community</a>
              <a class="button button-secondary" href="#plans">See plans</a>
            </div>
            <dl class="hero-notes">
              <div>
                <dt>Buy once</dt>
                <dd>Create one hosted account, then keep using that same account through upgrade and billing.</dd>
              </div>
              <div>
                <dt>Prove later</dt>
                <dd>Signed proof, verification kits, and operational state stay tied to the governed runtime.</dd>
              </div>
              <div>
                <dt>Run hosted</dt>
                <dd>Starter, Pro, and Enterprise are Stripe-managed hosted plans with the same tenant boundary.</dd>
              </div>
              <div>
                <dt>Deploy privately</dt>
                <dd>Private deployment remains part of the enterprise path when boundary or compliance requirements win.</dd>
              </div>
            </dl>
          </div>

          <div class="hero-visual" data-reveal>
            <div class="hero-map" aria-hidden="true">
              <div class="hero-ring"></div>
              <div class="hero-node hero-node-left">
                <small>Before Attestor</small>
                <strong>Model output</strong>
                <span>Useful, fast, and still too weak to own consequence by itself.</span>
              </div>
              <div class="hero-node hero-node-core">
                <small>Attestor</small>
                <strong>Accept • Prove • Operate</strong>
                <span>Typed contracts, reviewer authority, verification, billing, and tenant control.</span>
              </div>
              <div class="hero-node hero-node-right">
                <small>After Attestor</small>
                <strong>Production consequence</strong>
                <span>High-stakes workflows can move with evidence instead of guesswork.</span>
              </div>
              <div class="hero-trace trace-one"></div>
              <div class="hero-trace trace-two"></div>
              <div class="hero-trace trace-three"></div>
              <div class="hero-pulse one"></div>
              <div class="hero-pulse two"></div>
            </div>
          </div>
        </section>

        <section class="section" id="product">
          <div class="section-inner">
            <div class="section-head" data-reveal>
              <div class="eyebrow">What ships now</div>
              <h2>Not another model layer. The missing operating layer.</h2>
              <p>
                The product is strongest where AI-assisted work has to cross into
                real review, audit, or production consequence. That is why the
                first commercial surface starts with account, proof, billing, and
                operator control instead of a workspace shell.
              </p>
            </div>
            <div class="rail-grid">
              <article class="rail" data-reveal>
                <span>Accept</span>
                <h3>Bound what may happen before anyone approves it.</h3>
                <p>Typed contracts, governed execution, and reviewer authority draw a clean line between suggestion and acceptable action.</p>
              </article>
              <article class="rail" data-reveal>
                <span>Prove</span>
                <h3>Carry evidence that survives the runtime that created it.</h3>
                <p>Signed certificates, verification kits, audit lineage, and schema-aware evidence keep the decision legible later.</p>
              </article>
              <article class="rail" data-reveal>
                <span>Operate</span>
                <h3>Buy, meter, and manage it like real infrastructure.</h3>
                <p>Hosted account state, usage, Stripe billing, HA bundles, observability, and deployment paths make rollout manageable.</p>
              </article>
            </div>
          </div>
        </section>

        <section class="section" id="paths">
          <div class="section-inner">
            <div class="section-head" data-reveal>
              <div class="eyebrow">Three entry paths</div>
              <h2>Start locally, run hosted, or move into a stricter boundary.</h2>
              <p>The product surface should make the three starting motions obvious. Community is for evaluation, hosted is for live API use, and enterprise covers the stricter rollout boundary.</p>
            </div>
            <div class="path-band" data-reveal>
              <article>
                <h3>Community</h3>
                <p>Zero-cost evaluation with local proof paths and the same hosted account setup you keep later.</p>
                <ul>
                  <li>Local Compose or self-hosted evaluation</li>
                  <li>Hosted account signup on the same future tenant</li>
                  <li>No included hosted pipeline runs</li>
                </ul>
              </article>
              <article>
                <h3>Hosted API</h3>
                <p>Starter and Pro keep the commercial flow simple: one account, one Stripe checkout, same tenant after payment.</p>
                <ul>
                  <li>Hosted account and tenant boundary</li>
                  <li>Usage, API keys, and billing portal</li>
                  <li>Fastest route into live governed workflows</li>
                </ul>
              </article>
              <article>
                <h3>Private deployment</h3>
                <p>Enterprise keeps private deployment on the table when the rollout boundary matters as much as the feature list.</p>
                <ul>
                  <li>HA, observability, and secret-manager bootstrap</li>
                  <li>Negotiated limits and onboarding path</li>
                  <li>Stricter compliance and network boundary control</li>
                </ul>
              </article>
            </div>
          </div>
        </section>

        <section class="section" id="plans">
          <div class="section-inner">
            <div class="section-head" data-reveal>
              <div class="eyebrow">Plans</div>
              <h2>Choose the path, then keep the same account after payment.</h2>
              <p>The buying motion is intentionally simple: create the account, choose the plan, continue in Stripe if it is paid, then keep using the same tenant afterward.</p>
            </div>
            <div class="pricing-grid">
              ${renderPlanRails(plans)}
            </div>
            ${renderPlanComparison()}
          </div>
        </section>

        <section class="section console-section" id="console">
          <div class="section-inner">
            <div class="section-head" data-reveal>
              <div class="eyebrow">Launch console</div>
              <h2>Everything needed to start the account and keep it running.</h2>
              <p>This first site includes the buyer path itself: signup, login, plan selection, Stripe checkout, billing portal, account state, and API key management.</p>
            </div>

            <div class="console-shell" data-reveal>
              <div class="console-head">
                <strong>Attestor account console</strong>
                <span class="session-pill" id="session-pill">Signed out</span>
              </div>

              <div class="console-layout">
                <aside class="console-aside">
                  <div class="console-stack">
                    <section class="console-panel">
                      <h3>Current session</h3>
                      <p id="session-title">Use one account from signup through billing</p>
                      <p id="session-text">Create the account first. Community is active immediately after signup.</p>
                    </section>

                    <section class="console-panel">
                      <h3>Selected plan</h3>
                      <div class="plan-selector">
                        ${renderPlanToggles(plans)}
                      </div>
                      <div class="summary-item">
                        <span>Selected now</span>
                        <strong id="selected-plan-name">Starter</strong>
                        <p id="selected-plan-meta" class="fine-print"></p>
                      </div>
                      <div class="panel-actions">
                        <button class="button button-primary" id="primary-action" type="button">Create account for Starter</button>
                        <button class="button button-secondary" id="portal-action" type="button">Open billing portal</button>
                      </div>
                      <div class="panel-actions">
                        <button class="button button-ghost button-small" id="refresh-action" type="button">Refresh account</button>
                        <button class="button button-ghost button-small" id="export-action" type="button">Open billing export</button>
                        <button class="button button-ghost button-small" id="account-json-action" type="button">Open account JSON</button>
                        <button class="button button-ghost button-small" id="logout-action" type="button">Sign out</button>
                      </div>
                    </section>

                    <section class="console-panel" id="signup-card">
                      <h3>Create the account</h3>
                      <p>Signup comes first. The same hosted account continues into any paid plan later.</p>
                      <form class="field-grid" id="signup-form">
                        <div class="field">
                          <label for="signup-account-name">Account name</label>
                          <input id="signup-account-name" name="accountName" type="text" placeholder="Attestor Finance Team" required />
                        </div>
                        <div class="field-grid two">
                          <div class="field">
                            <label for="signup-email">Email</label>
                            <input id="signup-email" name="email" type="email" placeholder="team@example.com" required />
                          </div>
                          <div class="field">
                            <label for="signup-display-name">Display name</label>
                            <input id="signup-display-name" name="displayName" type="text" placeholder="Dana Reviewer" required />
                          </div>
                        </div>
                        <div class="field">
                          <label for="signup-password">Password</label>
                          <input id="signup-password" name="password" type="password" minlength="12" placeholder="At least 12 characters" required />
                        </div>
                        <button class="button button-primary" type="submit">Create account</button>
                      </form>
                    </section>

                    <section class="console-panel">
                      <h3>Sign in to an existing account</h3>
                      <form class="field-grid" id="login-form">
                        <div class="field">
                          <label for="login-email">Email</label>
                          <input id="login-email" name="email" type="email" placeholder="team@example.com" required />
                        </div>
                        <div class="field">
                          <label for="login-password">Password</label>
                          <input id="login-password" name="password" type="password" placeholder="Password" required />
                        </div>
                        <button class="button button-secondary" type="submit">Sign in</button>
                      </form>
                    </section>
                  </div>
                </aside>

                <div class="console-main">
                  <div class="console-stack">
                    <section class="status-banner" id="status-banner">
                      <strong id="status-title"></strong>
                      <p id="status-text"></p>
                    </section>

                    <section class="console-panel">
                      <h3>Account state</h3>
                      <p>Plan, entitlement, usage, rate limit, and Stripe state update here after signup or login.</p>
                      <div class="summary-grid" id="account-summary"></div>
                    </section>

                    <section class="console-panel">
                      <div style="display:flex;justify-content:space-between;gap:16px;align-items:center;flex-wrap:wrap;">
                        <div>
                          <h3>Tenant API keys</h3>
                          <p>Issue, rotate, deactivate, reactivate, or revoke the keys that call the runtime.</p>
                        </div>
                        <button class="button button-secondary button-small" id="issue-key-action" type="button">Issue API key</button>
                      </div>
                      <div class="key-table-wrap">
                        <table class="key-table">
                          <thead>
                            <tr>
                              <th>Preview</th>
                              <th>Plan</th>
                              <th>Quota</th>
                              <th>Status</th>
                              <th>Last used</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody id="key-table-body"></tbody>
                        </table>
                      </div>
                      <p class="fine-print" id="key-empty-state">No API keys yet. Use "Issue API key" to mint one.</p>
                    </section>

                    <section class="console-panel">
                      <h3>Latest secret</h3>
                      <p>The raw API key only appears right after signup, issue, or rotate. Copy it immediately and store it safely.</p>
                      <div class="secret-box" id="secret-box" style="display:none;">
                        <pre id="secret-value"></pre>
                      </div>
                      <div class="panel-actions">
                        <button class="button button-ghost button-small" id="secret-copy" type="button">Copy latest API key</button>
                      </div>
                    </section>

                    <section class="console-panel">
                      <h3>First request</h3>
                      <p>Once you have the tenant API key, the governed runtime is ready to receive requests.</p>
                      <div class="code-box">
                        <pre id="curl-snippet"></pre>
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer class="site-footer">
        <span>Acceptance, proof, and operating infrastructure for AI-assisted work.</span>
        <span>Hosted API, private deployment path, and Stripe-managed billing on the same account surface.</span>
      </footer>
    </div>

    <script id="attestor-site-bootstrap" type="application/json">${safeJson(bootstrap)}</script>
    <script>${SITE_SCRIPT}</script>
  </body>
</html>`;
}

export function renderAttestorSite(): string {
  return renderSiteMarkup(buildSitePlans());
}
