# Consequence Admission Quickstart

Use this when you already have a shipped Attestor result and want the shared customer-facing admission shape:

```text
proposed consequence -> explicit surface -> admit | narrow | review | block -> proof -> downstream gate
```

This quickstart does not add a new hosted route. It uses the public package facade exported as `attestor/consequence-admission`.

For the shortest first run, start with [Try Attestor first](try-attestor-first.md).

## Run The Local Demo

Use the first useful admission demo when you want the shortest runnable version of the model:

```bash
npm run example:admission
```

The demo shows an allowed finance consequence and a blocked finance consequence. In both cases, the customer system proposes the consequence, Attestor returns a canonical admission decision, and the downstream gate proceeds only when the decision allows it.

## Rules

- Choose the surface explicitly: `finance-pipeline-run` or `crypto-execution-plan`.
- Use finance when the source result came from `POST /api/v1/pipeline/run`.
- Use crypto when the source result is a `CryptoExecutionAdmissionPlan` from `attestor/crypto-execution-admission`.
- Do not auto-detect packs from payload shape.
- Do not treat this as a universal hosted admission route.
- Do not treat crypto as generally available through a public hosted route.

## Import The Facade

```ts
import {
  createConsequenceAdmissionFacadeResponse,
  consequenceAdmissionFacadeDescriptor,
} from 'attestor/consequence-admission';

const descriptor = consequenceAdmissionFacadeDescriptor();

if (!descriptor.explicitSurfaceRequired || descriptor.automaticPackDetection) {
  throw new Error('Unsafe admission facade configuration.');
}
```

## Finance: Wrap The Hosted Route Result

First call the hosted finance route as shown in [First hosted API call](hosted-first-api-call.md). Then wrap the returned run object:

```ts
import { createConsequenceAdmissionFacadeResponse } from 'attestor/consequence-admission';

const admission = createConsequenceAdmissionFacadeResponse({
  surface: 'finance-pipeline-run',
  run,
  decidedAt: new Date().toISOString(),
  requestInput: {
    actorRef: 'actor:finance-workflow',
    authorityMode: 'tenant-api-key',
  },
});

if (admission.decision !== 'admit' && admission.decision !== 'narrow') {
  throw new Error(`Attestor held the consequence: ${admission.decision}`);
}

// Only now may the customer system write, send, file, export, or route onward.
```

The finance facade preserves `/api/v1/pipeline/run` as the hosted route and maps the domain-native finance allow value `pass` to canonical `admit`.

## Crypto: Wrap The Package Plan

The current crypto path is a package integration boundary. Build or receive a `CryptoExecutionAdmissionPlan`, then wrap it:

```ts
import { createCryptoExecutionAdmissionPlan } from 'attestor/crypto-execution-admission';
import { createConsequenceAdmissionFacadeResponse } from 'attestor/consequence-admission';

const plan = createCryptoExecutionAdmissionPlan({
  simulation,
  createdAt: new Date().toISOString(),
  integrationRef: 'integration:erc4337:bundler',
});

const admission = createConsequenceAdmissionFacadeResponse({
  surface: 'crypto-execution-plan',
  plan,
  decidedAt: new Date().toISOString(),
});

if (admission.decision !== 'admit') {
  throw new Error(`Attestor blocked automatic execution: ${admission.decision}`);
}

// Only now may the customer-operated wallet, guard, bundler, payment server, or solver continue.
```

The crypto facade keeps `route: null` and `packageSubpath: attestor/crypto-execution-admission`. It does not claim a hosted crypto route.

## Readiness Gates

Run these before changing the public admission story:

```bash
npm run test:consequence-admission-readiness
npm run test:consequence-admission-package-surface
npm run verify
```

These gates prove that:

- README and overview docs point to the same admission story.
- The first hosted finance call still maps to canonical `admit`.
- The first crypto integration still maps `needs-evidence` to fail-closed `review` and `deny` to fail-closed `block`.
- `attestor/consequence-admission` is the public package facade.
- Internal facade module paths stay outside the public package surface.
- The facade requires an explicit surface and does not claim automatic routing.

## Keep The Boundary Honest

If a future step adds a universal hosted admission route or a hosted crypto route, it needs its own route contract, implementation, tests, package/readiness evidence, and tracker update first.
