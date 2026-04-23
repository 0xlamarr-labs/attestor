# Try Attestor First

Use this when you want the shortest local run before reading the deeper architecture docs.

```bash
npm install
npm run example:admission
```

The demo shows two AI-assisted finance consequences:

- one is admitted and allowed to proceed
- one is blocked fail-closed before the downstream action happens

In both cases, the shape is the same:

```text
proposed consequence -> Attestor admission decision -> proof refs -> downstream gate
```

## What You Should See

The output is grouped into four practical parts:

- **Input:** what the customer system wants to write, send, file, or execute
- **Attestor decision:** the native result and canonical admit / narrow / review / block decision
- **Proof refs:** the portable evidence references returned with the decision
- **Downstream result:** whether the customer system proceeds or holds

This is the simplest way to see Attestor's role: proof first, action second.

## What This Does Not Claim

- It is not a universal hosted admission route.
- It is not a public hosted crypto route.
- It is not a wallet, custody platform, agent runtime, or orchestration layer.
- It does not auto-detect packs from payload shape.

Customer systems still choose the relevant Attestor surface explicitly.

## Where To Go Next

- Need the shared admission vocabulary? Read [Consequence Admission Quickstart](consequence-admission-quickstart.md).
- Need the first hosted call after signup? Read [First hosted API call](hosted-first-api-call.md).
- Need the finance and crypto entry paths? Read [Finance and crypto first integrations](finance-and-crypto-first-integrations.md).
- Need pricing, evaluation, or hosted trial details? Read [Commercial packaging, pricing, and evaluation](product-packaging.md).
