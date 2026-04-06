# Signing and Verification

Attestor uses Ed25519 asymmetric signing for portable attestation certificates and reviewer endorsements. This is the same signing primitive used by Sigstore, SLSA, and SSH.

## Portable Attestation Certificates

Certificates are JSON documents that bind the full authority chain, evidence anchors, governance results, and live proof into a single cryptographically signed artifact.

**What a certificate proves:**

- **WHO** signed (Ed25519 public key identity + fingerprint)
- **WHAT** was decided (pass/fail/block with decision summary)
- **HOW** it was governed (SQL governance, policy, guardrails, data contracts, scorers)
- **WHAT** evidence exists (evidence chain root/terminal, audit chain integrity, SQL hash, snapshot hash)
- **WHETHER** execution was live or fixture-based (live proof mode + consistency)

**Verification requires only the certificate JSON + the signer's public key for the default Ed25519 path. No platform access, no database, no API call.**

```bash
# Generate a signing key pair
npm run keygen

# Run a product proof (certificate issued automatically)
npm run prove -- counterparty

# Verify a certificate independently
npm run verify:cert -- path/to/certificate.json path/to/public.pem

# Verify a full verification kit
npm run verify:cert -- path/to/kit.json
```

## Verification Kit

A product-proof run emits a self-contained verification kit:

| File | Purpose |
|---|---|
| `kit.json` | Certificate + authority bundle + reviewer endorsement + verification summary |
| `certificate.json` | Portable Ed25519-signed attestation certificate |
| `bundle.json` | Authority bundle with full governance evidence and replay identity |
| `verification-summary.json` | 6-dimensional verification result |
| `public-key.pem` | Runtime signer public key |
| `reviewer-public.pem` | Reviewer signer public key (when endorsement is signed) |

## PKI Verification

PKI chain verification is now the **default** path in both CLI and API.

**CLI verify behavior:**
- When PKI chain material is present in a kit: full CA → leaf → certificate binding verification
- When PKI chain material is absent: **exit code 2** (`PKI_REQUIRED`) — verification impossible
- Legacy flat Ed25519 override: `--allow-legacy-verify` or `ATTESTOR_ALLOW_LEGACY=true`

**API verify behavior:**
- `/api/v1/verify` accepts `trustChain` + `caPublicKeyPem` alongside `certificate` + `publicKeyPem`
- Validates chain integrity, issuer linkage, certificate-to-leaf binding, and expiry
- Returns `chainVerification` + `trustBinding` summary

**API issuance:**
- `POST /api/v1/pipeline/run` with `sign=true` returns keyless-first signed certificate + trust chain + CA public key
- Every signed run uses per-request ephemeral keys with CA-issued short-lived certs

**Current boundary:**
- PKI is the default verifier path for both CLI and API
- Legacy flat Ed25519 is available as an explicit escape hatch (deprecation planned)
- No formal deprecation timeline yet (planned for v2.0)
- Not yet mandatory across every programmatic kit issuance path

## 6-Dimensional Verification

The verify CLI checks six dimensions:

1. **Cryptographic**: Ed25519 signature validity and fingerprint consistency
2. **Structural**: certificate schema version and type
3. **Authority**: warrant fulfilled, escrow released, receipt issued
4. **Governance sufficiency**: SQL governance, policy, guardrails passed
5. **Proof completeness**: proof mode, execution liveness, gap count
6. **Reviewer endorsement**: present, signed, run-bound, binding-checked, verified

## Reviewer Endorsement

Reviewer endorsements are Ed25519-signed statements by the human reviewer who approved the run.

**What a reviewer endorsement proves:**

- **WHO** approved (reviewer name, role, identifier, Ed25519 fingerprint)
- **WHAT** they approved (the decision they saw)
- **WHEN** they approved (endorsement timestamp)
- **WHY** they approved (rationale)
- **WHICH RUN** they approved (run-bound: runId + replayIdentity + evidenceChainTerminal)

### Run Binding

The endorsement signature covers the specific `runId`, `replayIdentity`, and `evidenceChainTerminal`. This prevents cross-run replay: a valid endorsement from one run cannot be injected into a different run's verification kit.

The verification summary checks binding equality:

- `endorsement.runBinding.runId` must equal `bundle.runId`
- `endorsement.runBinding.evidenceChainTerminal` must equal `bundle.evidence.chainTerminal`
- `endorsement.runBinding.replayIdentity` must equal `bundle.evidence.replayIdentity`

If any field mismatches, the summary reports `bindingMismatch = true` and `verified = false`.

### Reviewer Key Material

```bash
# Default: ephemeral reviewer key for local proof demonstration
npm run prove -- counterparty

# Persistent reviewer key directory
npm run prove -- counterparty .attestor --reviewer-key-dir ./reviewer-keys

# Expected files: reviewer-private.pem + reviewer-public.pem
```

When reviewer key material is absent, the kit stays truthful: `reviewerEndorsement.verified = false`. The verify CLI output explains why.

## Trust Chain

```text
Generator (AI) → Governor (Attestor runtime) → Reviewer (human, Ed25519-signed) → Certificate
```

The runtime certificate signer and the reviewer endorsement signer use **separate key pairs**. This preserves separation of authority: the system signs the overall attestation, the reviewer signs their specific approval.
