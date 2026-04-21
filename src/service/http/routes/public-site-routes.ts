import type { Context, Hono } from 'hono';

export interface PublicSiteRouteDeps<Packet = unknown> {
  committedFinancialPacket: Packet;
  renderFinancialReportingLandingPage(packet: Packet): string;
  renderFinancialReportingProofPage(packet: Packet): string;
  renderHostedReturnPage(input: {
    eyebrow: string;
    title: string;
    message: string;
    bullets: string[];
    note?: string;
    actions: Array<{ href: string; label: string }>;
  }): string;
  readCommittedEvidence(relativePath: string): { path: string; content: string } | null;
  committedEvidenceContentType(path: string): string;
}

export function registerPublicSiteRoutes<Packet>(app: Hono, deps: PublicSiteRouteDeps<Packet>): void {
  const {
    committedFinancialPacket,
    renderFinancialReportingLandingPage,
    renderFinancialReportingProofPage,
    renderHostedReturnPage,
    readCommittedEvidence,
    committedEvidenceContentType,
  } = deps;

  const serveCommittedEvidence = (relativePath: string, c: Context) => {
    const file = readCommittedEvidence(relativePath);
    if (!file) return c.json({ error: 'Proof asset not found' }, 404);
    return c.body(file.content, 200, {
      'content-type': committedEvidenceContentType(file.path),
    });
  };

  app.get('/', (c) => c.body(renderFinancialReportingLandingPage(committedFinancialPacket), 200, {
    'content-type': 'text/html; charset=utf-8',
  }));

  app.get('/financial-reporting-acceptance', (c) => c.body(renderFinancialReportingLandingPage(committedFinancialPacket), 200, {
    'content-type': 'text/html; charset=utf-8',
  }));

  app.get('/proof/financial-reporting-acceptance', (c) => c.body(renderFinancialReportingProofPage(committedFinancialPacket), 200, {
    'content-type': 'text/html; charset=utf-8',
  }));

  app.get('/proof/financial-reporting-acceptance/packet.json', (c) => serveCommittedEvidence('packet.json', c));
  app.get('/proof/financial-reporting-acceptance/README.md', (c) => serveCommittedEvidence('README.md', c));
  app.get('/proof/financial-reporting-acceptance/index.html', (c) => serveCommittedEvidence('index.html', c));
  app.get('/proof/financial-reporting-acceptance/evidence/:asset', (c) => serveCommittedEvidence(`evidence/${c.req.param('asset')}`, c));

  app.get('/billing/success', (c) => c.body(renderHostedReturnPage({
    eyebrow: 'Billing',
    title: 'Checkout completed',
    message: 'Your checkout finished successfully. Attestor keeps the same account and updates the plan on that account as soon as Stripe webhook reconciliation completes.',
    bullets: [
      'Starter begins with a 14-day free trial before the first paid cycle.',
      'If the plan view still looks unchanged, wait a few seconds and refresh.',
      'You can manage payment details, invoices, and plan changes from the billing portal.',
    ],
    note: 'The machine-readable account endpoints remain the source of truth for API-first customers.',
    actions: [
      { href: '/settings/billing', label: 'Open billing summary' },
      { href: '/api/v1/account', label: 'View account summary (JSON)' },
    ],
  }), 200, {
    'content-type': 'text/html; charset=utf-8',
  }));

  app.get('/billing/cancel', (c) => c.body(renderHostedReturnPage({
    eyebrow: 'Billing',
    title: 'Checkout canceled',
    message: 'No plan change was applied. Your existing account stays exactly as it was before checkout started.',
    bullets: [
      'You can start checkout again from the same hosted account.',
      'Starter is the first hosted paid plan and includes a 14-day free trial.',
      'If you are still evaluating, you can wait to upgrade until you are ready.',
    ],
    actions: [
      { href: '/settings/billing', label: 'Return to billing summary' },
      { href: '/api/v1/account', label: 'View current account (JSON)' },
    ],
  }), 200, {
    'content-type': 'text/html; charset=utf-8',
  }));

  app.get('/settings/billing', (c) => c.body(renderHostedReturnPage({
    eyebrow: 'Hosted account',
    title: 'Billing settings',
    message: 'This is the simple return page for billing. Use it after checkout or the Stripe billing portal to confirm what happens next.',
    bullets: [
      'Hosted signup creates the account you will keep using.',
      'Starter is the first hosted paid plan and includes a 14-day free trial.',
      'Pro and Enterprise are paid upgrades on the same account.',
      'Use Stripe Checkout to start a paid plan and the billing portal to manage it later.',
    ],
    note: 'If you are integrating directly against the API, the account and billing export endpoints below remain the canonical machine-readable views.',
    actions: [
      { href: '/api/v1/account', label: 'View current plan and usage (JSON)' },
      { href: '/api/v1/account/billing/export', label: 'View invoices and charges (JSON/CSV)' },
    ],
  }), 200, {
    'content-type': 'text/html; charset=utf-8',
  }));

  app.get('/app', (c) => c.redirect('/settings/billing', 302));
}
