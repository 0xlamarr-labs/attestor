# Customer Admission Gate

Use this after [Try Attestor first](try-attestor-first.md) when you want to see how an application actually enforces an Attestor decision.

```bash
npm run example:customer-gate
```

For concrete application placements, see [Customer integration recipes](customer-integration-recipes.md).

The example shows the customer-side step:

```text
Attestor admission response -> customer gate -> downstream write/send/file/execute
```

## What The Gate Does

The customer system passes an Attestor admission response and a downstream action label to the gate.

The gate returns:

- `PROCEED` when Attestor returned `admit` or `narrow`, the response is not fail-closed, and required proof is present
- `HOLD` when Attestor returned `review` or `block`, the response is fail-closed, or required proof is missing

The downstream system should only write, send, file, execute, broadcast, sign, or settle after the customer gate returns `PROCEED`.

## Minimal Shape

```ts
import {
  assertConsequenceAdmissionGateAllows,
  createConsequenceAdmissionFacadeResponse,
} from 'attestor/consequence-admission';

const admission = createConsequenceAdmissionFacadeResponse({
  surface: 'finance-pipeline-run',
  run,
  decidedAt: new Date().toISOString(),
});

assertConsequenceAdmissionGateAllows({
  admission,
  downstreamAction: 'customer_reporting_store.write',
  requireProof: true,
});

// Only now may the customer system run the downstream action.
```

## Boundary

- This does not add a universal hosted admission route.
- This does not add a public hosted crypto route.
- This does not auto-detect packs from payload shape.
- This does not make Attestor the downstream system.

Attestor supplies the decision and proof. The customer system enforces the final gate before consequence.
