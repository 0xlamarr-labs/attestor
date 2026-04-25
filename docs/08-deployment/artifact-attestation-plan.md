# Artifact Attestation Plan

Attestor `v0.1.1-evaluation` already has a reviewer-runnable packet, a GitHub-visible smoke gate, and a full verification workflow. The first provenance step is now implemented through [release-provenance.yml](../../.github/workflows/release-provenance.yml): a separate release-only attestation path that proves where selected review artifacts came from without widening the push or PR reviewer workflows.

## Current Baseline

Today the repository has:

- `Evaluation Smoke` for push and pull-request reviewer checks
- `Full Verify` for manual and scheduled full verification
- uploaded `proof-surface` workflow artifacts from the smoke gate
- `Release Provenance` for tagged evaluation releases and manual provenance runs

Both current workflows stay on:

```yaml
permissions:
  contents: read
```

That boundary is deliberate. The current reviewer path remains read-only even after provenance publication was added in the dedicated release workflow.

## Why Artifact Attestations

GitHub artifact attestations are the intended next provenance mechanism because they establish build provenance for produced software artifacts and can later be verified independently.

For Attestor, that is a natural fit for reviewer-facing release artifacts:

- proof-surface output
- portable proof-showcase packets
- release-side evaluation materials tied to a specific tag

## Implemented Shape

The dedicated [release-provenance.yml](../../.github/workflows/release-provenance.yml) workflow:

1. checks out the selected tag or manual-dispatch ref
2. runs `npm run proof:surface`
3. runs `npm run showcase:proof`
4. packages the review artifacts into `.attestor/release-provenance/evaluation-artifacts.tar.gz`
5. uploads that archive as the `evaluation-artifacts` workflow artifact
6. publishes a GitHub artifact attestation for that archive with `actions/attest@v4`

The current `Evaluation Smoke` and `Full Verify` workflows are not repurposed for that job.

## Candidate Artifacts

The first attested artifact set stays narrow:

- `.attestor/proof-surface/latest/`
- `.attestor/showcase/latest/`
- `docs/00-evaluation/`
- `SECURITY.md`
- `docs/08-deployment/artifact-attestation-plan.md`

That is enough to prove reviewer-visible build provenance without pretending that the entire runtime or every downstream deployment input is covered.

## Permission Boundary

Keep the current reviewer workflows read-only.

The dedicated attestation workflow requests only the extra permissions GitHub requires for provenance publication:

```yaml
permissions:
  contents: read
  attestations: write
  id-token: write
```

Those permissions stay in the dedicated release-provenance workflow only, not in the push or PR smoke path.

## Reviewer Verification

After downloading `evaluation-artifacts.tar.gz` from a `Release Provenance` run, a reviewer can verify the attestation with:

```bash
gh attestation verify evaluation-artifacts.tar.gz -R 0xlamarr-labs/attestor
```

## Non-Claims

This plan does not claim full production supply-chain provenance. It documents the first release-evaluation artifact provenance step only.

This plan also does not claim:

- SLSA compliance by itself
- production deployment provenance for customer environments
- attested provenance for secrets, external databases, or downstream systems
