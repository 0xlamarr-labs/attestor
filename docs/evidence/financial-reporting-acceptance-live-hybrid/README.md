# Attestor Financial Reporting Acceptance Packet

## Accepted with fully verifiable proof

Attestor produced a PASS decision for an AI-assisted financial reporting workflow and issued a portable proof kit. The packet can be re-verified outside the platform, and this run shows hybrid with sqlite. The current verification verdict is verified.

## At a glance

- **Workflow:** Counterparty exposure reporting acceptance (live hybrid)
- **Decision:** PASS
- **Verification:** Verified
- **Proof mode:** Hybrid
- **Execution:** live (sqlite)
- **Reviewer endorsement:** verified
- **DB context evidence:** not present
- **Audit entries:** 11

## What this run shows

- The run shows an AI-assisted financial reporting acceptance flow, not just a raw model response.
- The run emitted a portable verification kit that can be checked without API access.
- The evidence chain contains 11 audit entries and is intact.
- Execution was live and recorded against sqlite.
- The packet includes a verified reviewer endorsement.

## Verification checks

- **Certificate signature:** PASS - Ed25519 certificate signature verified.
- **Governance sufficiency:** PASS - SQL, policy, and guardrails all passed for decision pass.
- **Authority closure:** PASS - Warrant, escrow, and receipt reached an authorized state.
- **Reviewer endorsement:** PASS - Reviewer endorsement is present, bound to the run, and independently verified.
- **Live execution evidence:** PASS - Execution ran live against sqlite.
- **Execution context evidence:** WARN - No database execution-context hash is present in the proof bundle.

## Truthful limitations

- No schema attestation file was captured for this run.

## Included evidence

- [Verification kit](evidence/kit.json) - Portable proof bundle with certificate, authority bundle, and verification summary.
- [Certificate](evidence/certificate.json) - Ed25519-signed attestation certificate for the governed run.
- [Signer public key](evidence/public-key.pem) - Public key needed to independently verify the certificate signature.
- [Reviewer public key](evidence/reviewer-public.pem) - Public key needed to independently verify the reviewer endorsement.
- [Verification summary](evidence/verification-summary.json) - The six-dimensional verification verdict emitted for this packet.
- [Trust chain](evidence/trust-chain.json) - PKI trust chain for the runtime signer used by this proof packet.
- [CA public key](evidence/ca-public.pem) - CA public key used to verify the runtime signer leaf certificate.

## Re-run and verify

```bash
npx tsx src/financial/cli.ts live-scenario counterparty
npm run verify:cert -- .attestor/showcase/latest/evidence/kit.json
npm run verify:cert -- .attestor/showcase/latest/evidence/certificate.json .attestor/showcase/latest/evidence/public-key.pem
```
