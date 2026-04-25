# Security Policy

Attestor `v0.1.1-evaluation` is an evaluation pre-release. It is reviewer-runnable, CI-backed, and useful for technical evaluation. It is not a production-use guarantee, a completed customer-operated deployment, or a substitute for a security audit.

## Supported Status

| Version or branch | Status | Security posture |
|---|---|---|
| `v0.1.1-evaluation` | Current evaluation pre-release | Supported for evaluation, review, and reproducible CI-backed proof paths |
| `master` | Active development | May move quickly; use for development, not as a stable release boundary |
| Older evaluation tags | Historical | Not the current baseline for new review or disclosure guidance |

## Reporting a Vulnerability

Preferred path:

- Use GitHub private vulnerability reporting for this repository if it is enabled in repository settings.

If private vulnerability reporting is not available:

- Do not post exploit details, secrets, proof-of-concept payloads, or reproduction steps in a public GitHub issue.
- Open a minimal public issue only to request a private reporting path, or contact the repository owner through GitHub without disclosing the vulnerability details publicly.

When reporting, include:

- affected tag, branch, or commit
- impact summary
- reproduction conditions
- whether the issue affects local evaluation only or a customer-operated runtime path

## Scope

In scope for this evaluation baseline:

- release decisions, tokens, and enforcement behavior in this repository
- proof artifacts, verification flows, and evaluation packet commands
- GitHub Actions reviewer paths, including `Evaluation Smoke` and `Full Verify`

Out of scope for this evaluation baseline:

- hosted service availability or SLA claims
- customer-specific cloud, DNS, TLS, billing, wallet, or downstream-system incidents
- guarantees about production readiness beyond the explicit release and deployment docs

## Workflow Token Permissions

The current repository trust baseline keeps reviewer-facing CI workflows read-only:

- [evaluation-smoke.yml](.github/workflows/evaluation-smoke.yml) uses `permissions: contents: read`
- [full-verify.yml](.github/workflows/full-verify.yml) uses `permissions: contents: read`
- [release-provenance.yml](.github/workflows/release-provenance.yml) is the only workflow that carries `attestations: write` and `id-token: write`, and it is limited to tagged evaluation releases or explicit manual dispatch

That matches GitHub's least-privilege guidance for `GITHUB_TOKEN`. Elevated permissions for provenance publication stay isolated to the release-only workflow and do not expand the push or PR reviewer path.

## Evaluation Boundary

This security policy does not claim:

- production readiness for every runtime profile
- a public hosted crypto route
- a public npm package release
- a completed security review or external audit
