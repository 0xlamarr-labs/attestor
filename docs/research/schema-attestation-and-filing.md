# Research: Schema Attestation & Filing Integration (2025-2026)

*Captured: April 2026*

## Schema Attestation

### PostgreSQL
- `information_schema.columns` fingerprinting: hash ordered column defs → SHA-256
- `pgaudit` for DDL audit trail (append-only log of schema changes)
- Production pattern: migration tool (Flyway/Liquibase) + post-migration fingerprint + `pg_dump --schema-only | sha256sum`
- Temporal tables: not native in PG, limited use for schema attestation

### Snowflake
- `INFORMATION_SCHEMA` is session-scoped (real-time), `ACCOUNT_USAGE` has 45min-2hr latency
- Time Travel works on data, NOT schema — schema history must be captured explicitly
- Scheduled task: daily `INFORMATION_SCHEMA.COLUMNS` hash → attestation table
- `ACCESS_HISTORY` + `QUERY_HISTORY` for DDL tracking (365-day retention)

### Cross-Database
- Each DB produces own fingerprint → central attestation store
- Composite fingerprint: `SHA-256(pg_fingerprint || snowflake_fingerprint || timestamp)`
- Merkle trees: applicable but rare in practice (mostly blockchain-adjacent contexts)
- dbt contracts (`contract: {enforced: true}`) for schema attestation at transformation layer

## Filing Integration

### XBRL Lifecycle
1. Data sourcing → 2. Mapping to taxonomy → 3. Report generation → 4. Validation → 5. Review → 6. Submission → 7. Acceptance

### SEC EDGAR (2025)
- EDGAR Next with login.gov OAuth2 authentication
- iXBRL mandatory for most financial filings
- Programmatic: authenticate → construct package → POST → poll acceptance → store accession number
- Common rejections: calculation inconsistencies, custom element abuse

### EBA DPM 2.0 / xBRL-CSV
- DPM 2.0: database-centric model replacing XML-based XBRL
- xBRL-CSV: CSV files + JSON metadata descriptor (much simpler than XML)
- Taxonomy packages versioned semi-annually by EBA

### Filing-Grade Evidence (minimum)
| Type | Requirement |
|---|---|
| Source extract | Timestamped with query ID + hash |
| Mapping | Versioned, linked to taxonomy version |
| Validation | Complete run output, zero errors |
| Sign-off | Named individuals + timestamps |
| Submission receipt | Accession number / receipt ID |
| Reconciliation | Filed value = audited FS +/- adjustments |

### Key Gap (2025-2026)
The handoff between "data warehouse schema" and "filing taxonomy mapping" is manual and poorly evidenced. This is where schema attestation meets filing integration — still largely unsolved as an automated, attestable workflow.
