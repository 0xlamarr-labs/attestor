# Artifact Attestation Plan

Attestor `v0.1.1-evaluation` already has a reviewer-runnable packet, a GitHub-visible smoke gate, and a full verification workflow. The next provenance step is not to widen those workflows. It is to add a separate release-only attestation path that proves where selected review artifacts came from.

## Current Baseline

Today the repository already has:

- `Evaluation Smoke` for push and pull-request reviewer checks
- `Full Verify` for manual and scheduled full verification
- uploaded `proof-surface` workflow artifacts from the smoke gate

Both current workflows stay on:

```yaml
permissions:
  contents: read
```

That boundary is deliberate. The current reviewer path should remain read-only until Attestor actually publishes provenance.

## Why Artifact Attestations

GitHub artifact attestations are the intended next provenance mechanism because they establish build provenance for produced software artifacts and can later be verified independently.

For Attestor, that is a natural fit for reviewer-facing release artifacts:

- proof-surface output
- portable proof-showcase packets
- release-side evaluation materials tied to a specific tag

## Proposed Shape

Add a separate release-only workflow for tagged evaluation releases.

That workflow should:

1. check out the tagged commit
2. run the selected proof/render path
3. upload the chosen release artifacts
4. publish GitHub artifact attestations for those artifacts

The current `Evaluation Smoke` and `Full Verify` workflows should not be repurposed for that job.

## Candidate Artifacts

The first attested artifact set should stay narrow:

- `.attestor/proof-surface/latest/`
- `.attestor/showcase/latest/`
- release notes material attached to the tagged evaluation release

That is enough to prove reviewer-visible build provenance without pretending that the entire runtime or every downstream deployment input is covered.

## Permission Boundary

Keep the current reviewer workflows read-only.

When the dedicated attestation workflow is added, it should request only the extra permissions GitHub requires for provenance publication:

```yaml
permissions:
  contents: read
  attestations: write
  id-token: write
```

Those permissions belong in the dedicated release-provenance workflow only, not in the push or PR smoke path.

## Non-Claims

This plan does not claim that Attestor already publishes artifact attestations today.

This plan also does not claim:

- SLSA compliance by itself
- production deployment provenance for customer environments
- attested provenance for secrets, external databases, or downstream systems
