# AI-Assisted Financial Reporting Acceptance

Attestor is now positioned first around **AI-assisted financial reporting acceptance**.

That is narrower than “enterprise AI governance” and more honest than “general agent platform.” The core claim is simple:

- a model or agent can help produce reporting work
- that output still needs an explicit acceptance boundary before it influences reporting, filing, control, or review processes
- Attestor is the layer that makes that boundary reviewable, verifiable, and portable

## What Counts As Acceptance Here

In this wedge, “acceptance” means more than “someone glanced at it and said OK.”

It means the reporting workflow can show:

- what query or workflow ran
- what data boundary it was allowed to touch
- what deterministic checks passed or failed
- who reviewed it
- what certificate, proof kit, and verification material survived afterward

That is why the current Attestor proving surface is finance-first:

- counterparty exposure reporting
- liquidity / LCR-style reporting checks
- reconciliation variance workflows
- filing-oriented export and evidence paths

## Why This Wedge Is Real

This is not a made-up category. The financial reporting stack already expects stronger identity, packaging, validation, and audit properties than a generic AI tool usually gives.

Current official anchors as of **2026-04-16**:

- [SEC: EDGAR Next](https://www.sec.gov/submit-filings/improving-edgar/edgar-next-improving-filer-access-account-management)
  This is the clearest US signal that filer access, delegated authority, and API use are tightening around identity and role discipline.
- [SEC: EDGAR Filer Manual](https://www.sec.gov/submit-filings/edgar-filer-manual)
  The filing system already assumes explicit technical rules, structured submission constraints, and machine-checkable behavior.
- [ESMA: ESEF Reporting Manual](https://www.esma.europa.eu/document/esef-reporting-manual)
  European listed-entity reporting already lives inside structured tagging, validation, and filing-packaging expectations.
- [EBA: Reporting Frameworks](https://www.eba.europa.eu/risk-and-data-analysis/reporting-frameworks)
  Prudential and supervisory reporting keeps moving with formal technical packages, taxonomies, and validation rules.
- [NIST AI 600-1: Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf)
  Official US guidance is now explicit that GenAI systems need documented governance, monitoring, human oversight, and risk treatment.
- [XBRL Report Package specification](https://specifications.xbrl.org/work-product-index-report-package-report-package-1.0-report-package-1.0.html)
  The reporting world is still pushing toward portable, structured package formats rather than ad hoc text-only outputs.

None of those documents says “buy Attestor.” Together they do show why plain model output is not enough once AI starts touching real reporting consequences.

## The Canonical Attestor Demonstration

The clearest current product proof is:

1. run the live hybrid counterparty scenario
2. emit a signed proof packet
3. verify the packet outside Attestor

Commands:

```bash
npm run showcase:proof:hybrid
npm run verify:cert -- .attestor/showcase/latest/evidence/kit.json
```

The committed sample packet that mirrors this path lives here:

- [Committed financial reporting proof packet](../evidence/financial-reporting-acceptance-live-hybrid/README.md)

## What The Buyer Story Should Sound Like

Not:

- generic AI governance platform
- another agent framework
- a filing workspace

Instead:

- AI-assisted financial reporting acceptance
- a hosted API/control layer for reporting workflows that need proof and reviewer closure
- a customer-operated deployment path when the boundary cannot stay hosted

## What This Does Not Claim

This wedge does **not** claim that Attestor is the whole reporting stack.

It does **not** replace:

- the ERP
- the reporting warehouse
- the filing system
- the human control function

It sits between generated output and reporting consequence, and makes that boundary legible.
