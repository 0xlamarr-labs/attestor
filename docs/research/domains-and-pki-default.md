# Research: Multi-Domain Governance + PKI-by-Default (2025-2026)

*Captured: April 2026*

## Multi-Domain Governance Engines

### OPA (Open Policy Agent)
- Bundles: per-domain Rego namespaces (`healthcare/hipaa`, `insurance/solvency2`)
- Multiple bundle sources supported
- Node.js: `@open-policy-agent/opa-wasm` — load compiled Rego in-process
- Limitation: bundles are whole-cache updates, not per-tenant partial

### dbt + Great Expectations
- dbt packages as domain packs (`packages.yml`)
- `dbt-expectations` (Metaplane maintained) ports GX assertions
- GX: pluggable Expectation Suites per domain
- No native "governance domain" abstraction — built by convention

### OSCAL (NIST)
- Profile model: select + tailor controls from multiple catalogs
- Cross-domain: import from NIST 800-53, ISO 27001, custom catalogs simultaneously
- JSON/XML documents, resolver walks import/select/modify chain
- OSCAL Foundation (Feb 2025) driving tooling standardization

### Healthcare Governance (HIPAA, eCQM, HEDIS)
| Layer | Requirement |
|---|---|
| Data classification | PHI column-level tagging, de-identification tracking |
| Access control | RBAC + ABAC, minimum necessary, break-glass audit |
| eCQM | FHIR R4, CQL measure evaluation, QRDA Cat I/III export |
| HEDIS | NCQA-certified engine, transitioning to fully digital (dQM) by 2030 |
| Audit | Immutable lineage, 6-year HIPAA retention |

### Insurance Governance (Solvency II, IFRS 17)
- 700+ automated data quality checks in production systems
- Dual reporting: same source → Solvency II + IFRS 17
- 12-18 months for compliant platform, 6-12 months per use case
- Collibra/Alation/DataHub for policy definition and enforcement

### Best Architecture: Pluggable Domain Evaluators
```typescript
interface DomainEvaluator {
  domainId: string;
  evaluate(context: EvalContext): EvalResult;
  listRules(): RuleDescriptor[];
}
```
Three engine backends:
1. **OPA/WASM** — authorization policies
2. **Cedar/WASM** — fine-grained permissions
3. **Native TypeScript** — data quality, regulatory measures (registry pattern)

## PKI-by-Default Signing

### How Sigstore Made Keyless Default for npm
1. Removed `COSIGN_EXPERIMENTAL` — keyless became default
2. `npm publish --provenance` generates SLSA attestation automatically
3. Fulcio issues short-lived cert (~10min) bound to OIDC identity
4. Ephemeral key discarded after signing
5. No key management, no rotation, no storage

### Cosign/Fulcio Architecture
```
CI/CD → OIDC Provider → Fulcio (verify + issue cert) → Sign artifact → Rekor (transparency log)
```
- `@sigstore/sign`, `@sigstore/verify`, `@sigstore/bundle` — TypeScript packages npm uses
- Trusted publishing: link GitHub repo → npm package, provenance automatic

### SLSA Provenance
| Level | npm Implementation |
|---|---|
| SLSA 1 | `--provenance` flag |
| SLSA 2 | Sigstore signs via CI OIDC |
| SLSA 3 | GitHub Actions trusted builders |

### Transition: Flat Keys → Chain Verification
1. **Phase 0**: Flat long-lived keys in CI secrets
2. **Phase 1**: Add keyless alongside (backward compat)
3. **Phase 2**: Keyless becomes default (remove experimental flag)
4. **Phase 3**: Key-based becomes opt-in (explicit `--key` flag)
5. **Phase 4**: Flat keys deprecated, provenance required

### Short-Lived Certificates as Standard
- Let's Encrypt: 6-day certs GA (Jan 2026), 45-day default (May 2026)
- No OCSP/CRL needed — cert expires before revocation propagates
- Convergence: Fulcio (~10min), Let's Encrypt (6 days), tokens (hours)
- Architecture shift: "protect the key" → "automate the renewal"

### Key npm Packages
| Package | Purpose |
|---|---|
| `@sigstore/sign` | Artifact signing (what npm uses) |
| `@sigstore/verify` | Signature verification |
| `@sigstore/bundle` | Bundle format types |
| `acme-client` | Short-lived TLS certs |
| `@open-policy-agent/opa-wasm` | In-process policy evaluation |
