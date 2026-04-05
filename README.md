# Attestor

**Authority-and-evidence runtime for governed financial pipelines.**

Attestor is a standalone financial runtime for governed query execution, reviewable evidence, and truthful runtime-proof records. It separates generation from acceptance so that financial pipeline steps are warranted, escrowed, receipted, and attested before acceptance or downstream filing use.

## What Problem It Solves

Attestor exists to prevent four common failures in AI-assisted financial reporting and analytics workflows:

| Failure | Why it happens | Attestor response |
|---|---|---|
| Raw prompt execution | Query generation and acceptance collapse into one step | Typed query contracts, SQL governance, and execution guardrails before execution |
| Authority collapse | A model output or second model opinion is treated as approval authority | Explicit warrant -> escrow -> receipt -> capsule authority chain |
| Unverifiable acceptance | Teams cannot show what evidence justified a decision | Reviewer-facing dossier, output pack, manifest, attestation, and audit chain |
| Runtime truth drift | The repo or operator claims stronger guarantees than the runtime really proved | Live Proof and Live Readiness artifacts with explicit proof gaps |

This makes Attestor useful where financial logic must be reviewable, replayable, and explainable instead of merely generated.

## What Attestor Does

Attestor provides:

- **Query contracts**: typed financial query definitions with input/output schemas, SQL governance rules, and execution boundaries
- **SQL governance**: read/write safety, scope constraints, intent alignment, and policy-aware query review
- **Execution guardrails**: row, cost, timeout, and shape limits on runtime execution
- **Policy and entitlement checks**: local approval and least-privilege style decisions before execution
- **Data contracts and control totals**: schema integrity, reconciliation checks, and hard/soft data quality gates
- **Provenance and lineage**: evidence chain, audit log, replay metadata, and OpenLineage-compatible export
- **Review policy and deterministic scoring**: bounded scorer cascade, escalation rules, and explicit decision states
- **Authority artifacts**: warrant, escrow, receipt, capsule, attestation, and reviewer dossier
- **Live Proof and Live Readiness**: truthful records of what was offline, mocked, live-model, live-runtime, or hybrid
- **Filing readiness**: structured readiness assessment for internal reporting and downstream filing preparation

## Governance Capabilities

Attestor is organized around governance capabilities rather than UI layers:

- **Domain contracts**: query contract, report contract, warrant scope, and execution obligations define what is allowed before execution begins
- **Deterministic evidence**: SQL governance, data contracts, control totals, report validation, and audit-chain hashing
- **Bounded scoring and review**: deterministic scorers, review policy, escalation triggers, and reviewer-facing explanations
- **Authority closure**: warrant -> escrow -> receipt -> capsule chain preserves what was authorized, what was held, and what was denied
- **Runtime truth**: Live Proof and Live Readiness make proof mode explicit instead of implying unsupported live guarantees
- **Reviewer artifacts**: dossier, output pack, manifest, attestation, and lineage export keep acceptance explainable after the run

## Authority Chain

Every financial operation follows a strict authority lifecycle:

```text
warrant -> escrow -> receipt -> capsule
```

1. **Warrant**: authorizes the operation up front with typed scope, policy references, and evidence obligations
2. **Escrow**: holds the operation in a governed state while obligations are released, held, or denied
3. **Receipt**: records execution outcome and whether final authority was granted or withheld
4. **Capsule**: produces a portable authority summary with hard facts, advisory signals, and closure state

This chain is separate from runtime proof. Authority artifacts answer what was authorized and what was accepted. Live Proof answers what was actually observed at runtime.

## Proof Model

Attestor treats proof mode as a first-class runtime truth artifact.

Supported proof modes:

- `offline_fixture`
- `mocked_model`
- `live_model`
- `live_runtime`
- `hybrid`

Every run can also produce a **Live Readiness** result that states:

- what proof modes are currently available
- what remains blocked
- what proof gaps still exist
- what next step would increase confidence most

Important design rule:

- **Live Proof is not an authority gate by itself**
- missing live proof does not automatically deny authority
- it does change what can be truthfully claimed about the run

## Reviewer-Facing Artifacts

Attestor emits or models a reviewer-facing artifact set for every governed run:

- **Output pack**: compact machine-readable summary of the run
- **Decision dossier**: reviewer packet covering readiness, breaks, policy, guardrails, authority artifacts, and proof status
- **Manifest**: artifact inventory and run anchors
- **Attestation**: canonical evidence pack with chain linkage and verification summary
- **Audit trail**: ordered event log with evidence hashes
- **OpenLineage export**: provenance and lineage interoperability surface
- **Live Proof summary**: explicit runtime truth statement with gaps

These artifacts are meant to agree with each other and to remain truthful about what the runtime really proved.

## Financial Runtime Shape

```text
financial query contract
  -> SQL governance
  -> policy and entitlement
  -> execution guardrails
  -> snapshot or fixture execution
  -> data contracts and control totals
  -> provenance and lineage evidence
  -> review policy and bounded scoring
  -> filing readiness
  -> warrant
  -> escrow
  -> receipt
  -> decision capsule
  -> output pack / dossier / manifest / attestation
  -> Live Proof summary
  -> Live Readiness assessment
```

The current repo centers this runtime on offline/reference exercises plus a bounded local live hybrid slice using model-generated SQL and local SQLite execution.

## Controls and Regulatory Relevance

Attestor does **not** claim out-of-the-box regulatory compliance. It does map to control and evidence needs that commonly appear in:

- internal control over financial reporting
- audit preparation and reviewer traceability
- governed analytics and reconciliations
- model-risk-sensitive financial workflows
- regulated reporting preparation where acceptance must be explainable

In practice, Attestor helps teams answer questions such as:

- What was authorized before execution?
- What evidence justified acceptance?
- What remained held, denied, or pending review?
- Was this run offline, live, or hybrid?
- What proof gaps still remain before stronger reliance or filing use?

## Who It Is For

- **Financial engineering and analytics teams** that need governed query execution instead of ad hoc AI SQL generation
- **Controllers, review teams, and internal assurance functions** that need explicit evidence and acceptance semantics
- **Builders of high-accountability financial workflows** who want replayable authority, provenance, and proof artifacts

## What It Is Not

- Not a dashboard or frontend generation system
- Not a generic BI tool
- Not an autonomous filing submission service
- Not a full enterprise control plane yet
- Not a claim that model output itself constitutes approval authority

## Quick Start

```bash
# Install dependencies
npm install

# Show CLI help and available modes
npm start

# List available scenarios
npm run list

# Run a named fixture scenario
npm run scenario -- counterparty

# Run the replay benchmark corpus
npm run benchmark

# Run a bounded local live scenario (requires model credentials)
npm run live -- counterparty

# Run tests
npm test

# Full verification (typecheck + test + build)
npm run verify
```

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | Optional | Enables the current live model and hybrid CLI exercise through OpenAI |
| `ANTHROPIC_API_KEY` | Optional | Counted by live-readiness checks as an alternative model credential source |

Offline fixture mode and benchmarks work without any API key. The current live CLI path uses `OPENAI_API_KEY`; `ANTHROPIC_API_KEY` currently affects readiness truth rather than the shipped live exercise path. Database connectivity remains local SQLite only in the current repo.

## Runtime Boundary

Attestor is currently a **local, single-process, offline-first** runtime:

- **Execution engine**: Node.js with built-in SQLite support (Node 22+)
- **Database scope**: SQLite fixture databases only; no production warehouse connectors yet
- **Policy evaluation**: local, in-process; no external entitlement service
- **Filing**: readiness assessment only; no actual regulatory submission adapter
- **Proof surface**: offline fixtures, live model, live runtime, and hybrid truth modes
- **Deployment model**: CLI or programmatic import; no API service layer

This repo is a serious reference implementation of the authority-and-evidence model, not yet a full enterprise deployment surface.

## What Is Implemented Today

- Full authority chain lifecycle (warrant -> escrow -> receipt -> capsule)
- Query contract and report contract types
- SQL governance with policy enforcement
- Execution guardrails
- Data contracts and control totals
- Provenance, lineage, and evidence-chain tracking
- Deterministic scoring cascade
- Review policy engine
- Filing readiness assessment
- Live Proof with offline/live/hybrid modes
- Live Readiness assessment
- Benchmark corpus for regression testing
- Bounded local SQLite live execution
- Dossier, output pack, manifest, and attestation assembly
- CLI with scenario, benchmark, list, and live modes

## What Is Not Claimed Today

- No production database connectors beyond bounded local SQLite
- No regulatory filing submission
- No multi-tenant entitlement service
- No distributed execution plane
- No REST or gRPC API surface
- No built-in authentication or authorization layer
- No external trust registration or PKI-backed signing

## Documentation

- [Purpose and product boundary](docs/01-overview/purpose.md)
- [Financial system overview](docs/02-architecture/system-overview.md)

## Project Structure

```text
src/
  financial/
    types.ts
    pipeline.ts
    execution.ts
    sql-governance.ts
    execution-guardrails.ts
    data-contracts.ts
    policy.ts
    warrant.ts
    escrow.ts
    receipt.ts
    capsule.ts
    attestation.ts
    evidence-chain.ts
    lineage.ts
    openlineage.ts
    scoring.ts
    review-policy.ts
    filing-readiness.ts
    dossier.ts
    output-pack.ts
    manifest.ts
    audit.ts
    canonical.ts
    challenge.ts
    replay.ts
    report-validation.ts
    break-report.ts
    cli.ts
    financial.test.ts
    fixtures/
      scenarios.ts
  api/
    openai.ts
  utils/
    errors.ts
    logger.ts
```

## License

Proprietary. All rights reserved.
