# Authority Model

Attestor's control model is a stack of distinct authority surfaces, not a flat validator list.

## Authority Chain

Every financial operation follows a strict lifecycle:

```text
warrant → escrow → receipt → capsule
```

1. **Warrant**: authorizes the operation up front with typed scope, policy references, and evidence obligations
2. **Escrow**: holds the operation in a governed state while obligations are progressively released, held, or denied
3. **Receipt**: records execution outcome and whether final authority was granted or withheld
4. **Capsule**: produces a portable authority summary with hard facts, advisory signals, and closure state

This chain is separate from runtime proof. Authority artifacts answer **what was authorized and what was accepted**. Live Proof answers **what was actually observed at runtime**.

## Authority Stack

| Layer | Role | Financial example |
|---|---|---|
| **Deterministic evidence** | Mechanical acceptance checks | SQL governance, data contracts, control totals, report validation |
| **Runtime proof** | What actually happened at runtime | Live Proof, Live Readiness, snapshot hashing, execution evidence |
| **Independent scorers** | Bounded quality and control judgment | 8-scorer cascade with priority short-circuit |
| **Review policy** | Escalation and approval discipline | Pre-score and post-score review triggers, approval/rejection/pending states |
| **Authority artifacts** | Monotonic acceptance closure | Warrant → escrow → receipt → capsule |
| **Reviewer artifacts** | Human-review and audit packaging | Output pack, dossier, manifest, attestation, lineage export |
| **Portable attestation** | Independently verifiable output certificate | Ed25519-signed certificate binding authority + evidence + decision |

## Reviewer-Facing Artifacts

Every governed run emits a reviewer-facing artifact set:

- **Output pack**: compact machine-readable summary of the run
- **Decision dossier**: reviewer packet covering readiness, breaks, policy, guardrails, authority artifacts, and proof status
- **Manifest**: artifact inventory and run anchors
- **Attestation**: canonical evidence pack with chain linkage and verification summary
- **Audit trail**: ordered event log with evidence hashes
- **OpenLineage export**: provenance and lineage interoperability surface

These artifacts are designed to agree with each other and to remain truthful about what the runtime really proved.

## Financial Runtime Shape

```text
financial query contract
  → SQL governance
  → policy and entitlement
  → execution guardrails
  → snapshot or fixture execution
  → data contracts and control totals
  → provenance and lineage evidence
  → review policy and bounded scoring
  → filing readiness
  → warrant
  → escrow
  → receipt
  → decision capsule
  → output pack / dossier / manifest / attestation
  → Live Proof summary
  → Live Readiness assessment
```

## Design Rules

- Authority artifacts form a **monotonic chain**: once a warrant is fulfilled, escrow released, receipt issued, and capsule sealed, that authority state cannot be weakened retroactively within the run.
- Review policy is **evidence-aware**: escalation triggers can fire based on runtime evidence conditions, not only static materiality tiers.
- The authority chain does **not** depend on proof mode. A fixture-based run can still produce a valid authority chain. Proof mode determines what can be truthfully claimed about runtime observation, not whether authority was granted.
