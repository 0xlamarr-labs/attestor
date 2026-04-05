# Attestor

**Authority-and-evidence runtime for governed financial pipelines.**

Attestor is a standalone runtime that governs financial query execution through typed authority chains, evidence-based scoring, and live readiness assessment. It ensures that every financial pipeline step is warranted, escrowed, receipted, and attestable before filing.

## What Attestor Does

Attestor provides:

- **Query Contracts** — typed financial query definitions with input/output schemas, SQL governance rules, and execution guardrails
- **Authority Chains** — warrant → escrow → receipt → capsule lifecycle for every financial operation
- **SQL Governance** — bounded SQL execution with policy/entitlement checks and data contract enforcement
- **Execution Guardrails** — runtime limits on query complexity, row counts, cost bounds, and timeout budgets
- **Data Contracts** — schema-level integrity checks for financial data inputs and outputs
- **Provenance & Lineage** — full audit trail with OpenLineage-compatible lineage events
- **Scoring & Review Policy** — deterministic scoring cascade for filing readiness assessment
- **Live Proof** — runtime-verifiable evidence that the pipeline actually executed against real systems
- **Live Readiness Assessment** — pre-flight checks that determine whether a pipeline is ready for live execution
- **Filing Readiness** — structured readiness evaluation before regulatory/compliance filing

## Core Concepts

### Authority Chain

Every financial operation follows a strict authority lifecycle:

```
Warrant → Escrow → Receipt → Capsule
```

1. **Warrant** — authorizes the operation with typed scope, policy reference, and entitlement proof
2. **Escrow** — holds the operation in a governed execution state with guardrails active
3. **Receipt** — records the execution outcome with full evidence (timing, row counts, hashes)
4. **Capsule** — sealed, immutable attestation package for audit/review/filing

### Live Proof

Live Proof is Attestor's evidence model for proving that a pipeline actually ran against real data:

- **Offline fixtures** — deterministic test data for development
- **Live model** — real LLM/model interaction evidence
- **Live runtime** — real database/API execution evidence
- **Hybrid** — combination of live + offline evidence with clear labeling

### Scoring & Review

Every pipeline run produces a structured scoring result:

- **Deterministic scoring** — schema compliance, data contract satisfaction, guardrail adherence
- **Review policy** — configurable pass/fail/escalate thresholds
- **Filing readiness** — whether the evidence package meets filing requirements

## Quick Start

```bash
# Install dependencies
npm install

# Run the financial CLI
npm start

# Run scenarios
npm run scenario

# Run benchmarks
npm run benchmark

# Run live scenarios (requires API keys)
npm run live

# Run tests
npm test

# Full verification (typecheck + test + build)
npm run verify
```

## Project Structure

```
src/
  financial/
    types.ts              — Core type definitions
    pipeline.ts           — Main pipeline orchestration
    execution.ts          — Query execution engine
    sql-governance.ts     — SQL policy enforcement
    execution-guardrails.ts — Runtime execution limits
    data-contracts.ts     — Schema/data integrity
    policy.ts             — Entitlement and policy checks
    warrant.ts            — Warrant authority issuance
    escrow.ts             — Escrow lifecycle management
    receipt.ts            — Receipt generation
    capsule.ts            — Capsule sealing and attestation
    attestation.ts        — Attestation chain logic
    evidence-chain.ts     — Evidence collection and chaining
    lineage.ts            — Provenance and lineage tracking
    openlineage.ts        — OpenLineage event format
    scoring.ts            — Deterministic scoring cascade
    review-policy.ts      — Review policy enforcement
    filing-readiness.ts   — Filing readiness assessment
    dossier.ts            — Evidence dossier assembly
    output-pack.ts        — Output packaging
    manifest.ts           — Run manifest generation
    audit.ts              — Audit trail
    canonical.ts          — Canonical form normalization
    challenge.ts          — Challenge/dispute handling
    replay.ts             — Deterministic replay
    report-validation.ts  — Report integrity validation
    break-report.ts       — Break/exception reporting
    cli.ts                — CLI entry point
    financial.test.ts     — Test suite
    fixtures/
      scenarios.ts        — Test scenario definitions
  api/
    openai.ts             — LLM API integration (for live proof)
  utils/
    errors.ts             — Error types
    logger.ts             — Logging utility
```

## What Is Implemented Today

- Full authority chain lifecycle (warrant → escrow → receipt → capsule)
- Query contract and data contract types
- SQL governance with policy enforcement
- Execution guardrails
- Provenance/lineage tracking
- Deterministic scoring cascade
- Review policy engine
- Filing readiness assessment
- Live Proof with offline/live/hybrid modes
- Live Readiness Assessment
- Benchmark corpus for regression testing
- Bounded live SQLite execution
- Evidence dossier and output pack assembly
- CLI with scenario/benchmark/live modes

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | For live proof mode only | OpenAI API key for LLM-based live proof verification |

Offline fixture mode and benchmarks work without any API key.

## Runtime Boundary

Attestor is currently a **local, single-process, offline-first** runtime:

- **Execution engine**: Node.js with built-in SQLite (experimental, Node 22+)
- **Database scope**: SQLite fixture databases only — no production database connectors
- **Policy evaluation**: Local, in-process — no external entitlement service
- **Filing**: Readiness assessment only — no actual regulatory submission
- **Live Proof**: Supports offline fixtures, live model (LLM), and live runtime (SQLite) modes
- **Deployment**: CLI or programmatic import — no server/API surface

This is a reference implementation demonstrating the authority-and-evidence governance model. Production deployment would require database connectors, entitlement service integration, and filing submission adapters.

## What Is NOT Claimed Today

- No production database connectors (SQLite only for bounded live execution)
- No regulatory filing submission (readiness assessment only)
- No multi-tenant entitlement service (local policy evaluation only)
- No distributed execution (single-process runtime)
- No REST/gRPC API surface (CLI and programmatic import only)
- No authentication/authorization layer (assumed external)

## License

Proprietary. All rights reserved.
