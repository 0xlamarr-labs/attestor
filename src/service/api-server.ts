/**
 * Attestor HTTP API Server — Real Hono-based service layer.
 *
 * Endpoints:
 * - POST /api/v1/pipeline/run       — synchronous governed pipeline execution
 * - POST /api/v1/pipeline/run-async  — async job submission (returns jobId)
 * - GET  /api/v1/pipeline/status/:id — async job status/result
 * - POST /api/v1/verify              — certificate + PKI chain verification
 * - POST /api/v1/filing/export       — XBRL taxonomy mapping export
 * - GET  /api/v1/health              — service health + PKI + registries
 * - GET  /api/v1/domains             — registered domain packs
 * - GET  /api/v1/connectors          — registered database connectors
 *
 * This is a real server. It binds to a port and accepts real HTTP requests.
 * Integration tests hit it over the network.
 */

import { Hono, type Context } from 'hono';
import { serve } from '@hono/node-server';
import { runFinancialPipeline } from '../financial/pipeline.js';
import { generateKeyPair } from '../signing/keys.js';
import { verifyCertificate } from '../signing/certificate.js';
import { buildVerificationKit } from '../signing/bundle.js';
import { domainRegistry } from '../domains/domain-pack.js';
import { financeDomainPack } from '../domains/finance-pack.js';
import { healthcareDomainPack } from '../domains/healthcare-pack.js';
import { verifyOidcToken, classifyIdentitySource } from '../identity/oidc-identity.js';
import type { FinancialPipelineInput } from '../financial/pipeline.js';
import type { ReviewerIdentity } from '../financial/types.js';

import { connectorRegistry } from '../connectors/connector-interface.js';
import { snowflakeConnector } from '../connectors/snowflake-connector.js';
import { filingRegistry } from '../filing/filing-adapter.js';
import { xbrlUsGaapAdapter, buildCounterpartyEnvelope } from '../filing/xbrl-adapter.js';
import { xbrlCsvEbaAdapter } from '../filing/xbrl-csv-adapter.js';
import { generatePkiHierarchy, verifyTrustChain } from '../signing/pki-chain.js';
import { createKeylessSignerPair, verifyKeylessSigner, type KeylessSigner } from '../signing/keyless-signer.js';
import { derivePublicKeyIdentity } from '../signing/keys.js';
import { createPipelineQueue, submitPipelineJob, getJobStatus, createPipelineWorker } from './async-pipeline.js';
import { tenantMiddleware, getTenantContextFromHeaders, type TenantContext } from './tenant-isolation.js';
import { TENANT_SCHEMA_SQL, autoActivateRLS } from './tenant-rls.js';
import { canConsumePipelineRun, consumePipelineRun, getUsageContext } from './usage-meter.js';

// Register domain packs
if (!domainRegistry.has('finance')) domainRegistry.register(financeDomainPack);
if (!domainRegistry.has('healthcare')) domainRegistry.register(healthcareDomainPack);

// Register connectors
if (!connectorRegistry.has('snowflake')) connectorRegistry.register(snowflakeConnector);

// Register filing adapters
if (!filingRegistry.has('xbrl-us-gaap-2024')) filingRegistry.register(xbrlUsGaapAdapter);
if (!filingRegistry.has('xbrl-csv-eba-dpm2')) filingRegistry.register(xbrlCsvEbaAdapter);

const app = new Hono();
const startTime = Date.now();

// Apply tenant isolation middleware to all API routes
app.use('/api/*', tenantMiddleware());

// PKI hierarchy (startup-time, for health/metadata)
const pki = generatePkiHierarchy('Attestor Keyless CA', 'API Runtime Signer', 'API Reviewer');
const pkiReady = true;

// Keyless signer: per-request ephemeral keys with CA-issued short-lived certs (Sigstore pattern)
function createRequestSigners(identitySource: string, reviewerName?: string) {
  return createKeylessSignerPair(
    { subject: 'API Runtime Signer', source: identitySource === 'oidc_verified' ? 'oidc_verified' : 'ephemeral', identifier: 'api-keyless' },
    reviewerName ? { subject: reviewerName, source: identitySource === 'oidc_verified' ? 'oidc_verified' : 'operator_asserted', identifier: reviewerName } : undefined,
  );
}

function currentTenant(c: Context): TenantContext {
  return getTenantContextFromHeaders(c.req.raw.headers);
}

// ─── Health ─────────────────────────────────────────────────────────────────

app.get('/api/v1/health', (c) => {
  return c.json({
    status: 'healthy',
    version: '0.1.0',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    domains: domainRegistry.listIds(),
    connectors: connectorRegistry.listIds(),
    filingAdapters: filingRegistry.list().map(a => a.id),
    pki: {
      ready: pkiReady,
      caName: pki.ca.certificate.name,
      caFingerprint: pki.ca.certificate.fingerprint,
      signerSubject: pki.signer.certificate.subject,
      reviewerSubject: pki.reviewer.certificate.subject,
    },
    tenantIsolation: {
      requestLevel: true,
      databaseRls: {
        schemaAvailable: true,
        configured: !!process.env.ATTESTOR_PG_URL,
        activated: rlsActivationResult.activated,
        policiesFound: rlsActivationResult.policiesFound,
        tablesProtected: rlsActivationResult.tablesProtected,
        error: rlsActivationResult.error,
      },
    },
    asyncBackend: { mode: asyncBackendMode, redisMode },
    engine: 'attestor',
  });
});

// ─── Domains ────────────────────────────────────────────────────────────────

app.get('/api/v1/domains', (c) => {
  const domains = domainRegistry.list().map(d => ({
    id: d.id,
    version: d.version,
    displayName: d.displayName,
    description: d.description,
    clauseCount: d.clauses.length,
    guardrailCount: d.guardrails.length,
  }));
  return c.json({ domains });
});

app.get('/api/v1/connectors', async (c) => {
  const connectors = await Promise.all(
    connectorRegistry.list().map(async (connector) => ({
      id: connector.id,
      displayName: connector.displayName,
      configured: connector.loadConfig() !== null,
      available: await connector.isAvailable(),
    })),
  );
  return c.json({ connectors });
});

app.get('/api/v1/account/usage', (c) => {
  const tenant = currentTenant(c);
  const usage = getUsageContext(tenant.tenantId, tenant.planId, tenant.monthlyRunQuota);
  return c.json({
    tenantContext: {
      tenantId: tenant.tenantId,
      source: tenant.source,
      planId: tenant.planId,
    },
    usage,
  });
});

// ─── Pipeline Run ───────────────────────────────────────────────────────────

app.post('/api/v1/pipeline/run', async (c) => {
  try {
    const body = await c.req.json();
    const { scenarioId, candidateSql, intent, sign } = body;

    if (!candidateSql || !intent) {
      return c.json({ error: 'candidateSql and intent are required' }, 400);
    }

    const tenant = currentTenant(c);
    const quotaCheck = canConsumePipelineRun(tenant.tenantId, tenant.planId, tenant.monthlyRunQuota);
    if (!quotaCheck.allowed) {
      return c.json({
        error: 'Monthly pipeline run quota exceeded for this tenant plan.',
        tenantContext: { tenantId: tenant.tenantId, source: tenant.source, planId: tenant.planId },
        usage: quotaCheck.usage,
      }, 429);
    }

    // ── Optional connector-backed execution ──
    let connectorExecution: any = null;
    let connectorProvider: string | null = null;
    let fullSchemaAttestation: any = null;

    // Special case: 'postgres-prove' uses the full postgres-prove path with schema attestation
    if (body.connector === 'postgres-prove') {
      try {
        const { isPostgresConfigured } = await import('../connectors/postgres.js');
        const { runPostgresProve } = await import('../connectors/postgres-prove.js');
        if (isPostgresConfigured()) {
          const pgResult = await runPostgresProve(candidateSql);
          if (pgResult.execution?.success) {
            connectorExecution = pgResult.execution;
            connectorProvider = 'postgres';
            fullSchemaAttestation = pgResult.schemaAttestation;
          }
        }
      } catch { /* non-fatal */ }
    } else if (body.connector) {
      const connector = connectorRegistry.get(body.connector);
      if (!connector) {
        return c.json({ error: `Connector '${body.connector}' not registered. Available: ${connectorRegistry.listIds().join(', ')}` }, 404);
      }
      const connConfig = connector.loadConfig();
      if (!connConfig) {
        return c.json({ error: `Connector '${body.connector}' not configured (env vars missing)` }, 400);
      }
      try {
        const result = await connector.execute(candidateSql, connConfig);
        if (result.success) {
          connectorExecution = result;
          connectorProvider = result.provider;
        }
      } catch (err: any) {
        // Connector execution failure is not fatal — fall back to fixture
        connectorExecution = null;
      }
    }

    // Keyless signer created after identity resolution (below)

    // ── OIDC-backed reviewer identity ──
    // If reviewerOidcToken is provided, verify it and derive reviewer identity.
    // If absent, fall back to operator-asserted identity (or no reviewer).
    let reviewerIdentity: ReviewerIdentity | undefined;
    let oidcVerified = false;

    if (body.reviewerOidcToken && body.oidcIssuer) {
      const oidcResult = await verifyOidcToken(body.reviewerOidcToken, {
        issuer: body.oidcIssuer,
        audience: body.oidcAudience,
      });
      if (oidcResult.verified && oidcResult.identity) {
        reviewerIdentity = oidcResult.identity;
        oidcVerified = true;
      } else {
        return c.json({ error: `OIDC token verification failed: ${oidcResult.error}`, identitySource: 'rejected' }, 401);
      }
    } else if (body.reviewerName) {
      reviewerIdentity = {
        name: body.reviewerName,
        role: body.reviewerRole ?? 'operator',
        identifier: body.reviewerIdentifier ?? 'api-caller',
        signerFingerprint: null,
      };
    }

    const identitySource = classifyIdentitySource(oidcVerified, false);

    // Keyless-first: per-request ephemeral keys with CA-issued short-lived certs
    const keylessPair = sign ? createRequestSigners(identitySource, reviewerIdentity?.name) : null;
    const keyPair = keylessPair?.signer.signingKeyPair;
    const reviewerKeyPair = (sign && reviewerIdentity && keylessPair) ? keylessPair.reviewer.signingKeyPair : undefined;

    const input: FinancialPipelineInput = {
      runId: `api-${Date.now().toString(36)}`,
      intent,
      candidateSql,
      fixtures: body.fixtures ?? [],
      generatedReport: body.generatedReport,
      reportContract: body.reportContract,
      signingKeyPair: keyPair,
      // Connector-backed execution evidence
      ...(connectorExecution ? {
        externalExecution: connectorExecution,
        liveProof: {
          collectedAt: new Date().toISOString(),
          execution: { live: true, provider: connectorProvider!, mode: 'live_db' as const, latencyMs: connectorExecution.durationMs ?? null },
        },
      } : {}),
      ...(reviewerIdentity && reviewerKeyPair ? {
        approval: {
          status: 'approved' as const,
          reviewerRole: reviewerIdentity.role,
          reviewNote: `API reviewer (${identitySource})`,
          reviewerIdentity,
          reviewerKeyPair,
        },
      } : {}),
    };

    const report = runFinancialPipeline(input);

    let kit = null;
    if (keyPair && report.certificate) {
      kit = buildVerificationKit(
        report, keyPair.publicKeyPem, undefined,
        keylessPair?.signer.trustChain ?? null,
        keylessPair?.signer.caPublicKeyPem ?? null,
      );
    }

    const usage = consumePipelineRun(tenant.tenantId, tenant.planId, tenant.monthlyRunQuota);

    return c.json({
      runId: report.runId,
      decision: report.decision,
      scoring: {
        scorersRun: report.scoring.scorersRun,
        decision: report.scoring.decision,
      },
      warrant: report.warrant.status,
      escrow: report.escrow.state,
      receipt: report.receipt?.receiptStatus ?? null,
      capsule: report.capsule?.authorityState ?? null,
      proofMode: report.liveProof.mode,
      auditEntries: report.audit.entries.length,
      auditChainIntact: report.audit.chainIntact,
      // Full certificate for independent verification
      certificate: report.certificate ?? null,
      verification: kit?.verification ?? null,
      publicKeyPem: keyPair?.publicKeyPem ?? null,
      trustChain: keylessPair?.signer.trustChain ?? null,
      caPublicKeyPem: keylessPair?.signer.caPublicKeyPem ?? null,
      signingMode: sign ? 'keyless' : null,
      connectorUsed: connectorProvider,
      // Schema/data-state attestation
      schemaAttestation: fullSchemaAttestation ? {
        present: true,
        scope: 'schema_attestation_full' as const,
        executionContextHash: fullSchemaAttestation.executionContextHash,
        provider: 'postgres',
        schemaFingerprint: fullSchemaAttestation.schemaFingerprint,
        sentinelFingerprint: fullSchemaAttestation.sentinelFingerprint,
        tableNames: fullSchemaAttestation.tables,
        attestationHash: fullSchemaAttestation.attestationHash,
      } : connectorExecution?.schemaAttestation ? {
        present: true,
        scope: 'schema_attestation_connector' as const,
        executionContextHash: connectorExecution.executionContextHash,
        provider: connectorProvider,
        schemaFingerprint: connectorExecution.schemaAttestation.schemaFingerprint,
        sentinelFingerprint: connectorExecution.schemaAttestation.sentinelFingerprint,
        tableNames: connectorExecution.schemaAttestation.tables,
        attestationHash: connectorExecution.schemaAttestation.attestationHash,
      } : connectorExecution?.executionContextHash ? {
        present: true,
        scope: 'execution_context_only' as const,
        executionContextHash: connectorExecution.executionContextHash,
        provider: connectorProvider,
        schemaFingerprint: null,
        sentinelFingerprint: null,
        tableNames: null,
        attestationHash: null,
      } : null,
      // Tenant context (from middleware)
      tenantContext: (() => {
        return { tenantId: tenant.tenantId, source: tenant.source, planId: tenant.planId };
      })(),
      usage,
      identitySource,
      reviewerName: reviewerIdentity?.name ?? null,
      // Auto-filing: when sign=true and filing adapter is available, include XBRL mapping summary
      filingExport: (sign && report.certificate) ? (() => {
        try {
          const adapter = filingRegistry.get('xbrl-us-gaap-2024');
          if (!adapter) return null;
          const envelope = buildCounterpartyEnvelope(
            report.runId, report.decision, report.certificate?.certificateId ?? null,
            report.evidenceChain?.terminalHash ?? '', report.execution?.rows ?? [], report.liveProof.mode,
          );
          const mapping = adapter.mapToTaxonomy(envelope);
          return { adapterId: adapter.id, coveragePercent: mapping.coveragePercent, mappedCount: mapping.mapped.length };
        } catch { return null; }
      })() : null,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ─── Verify Certificate ─────────────────────────────────────────────────────

app.post('/api/v1/verify', async (c) => {
  try {
    const body = await c.req.json();
    const { certificate, publicKeyPem, trustChain, caPublicKeyPem } = body;
    if (!certificate || !publicKeyPem) {
      return c.json({ error: 'certificate and publicKeyPem are required' }, 400);
    }

    // PKI mandatory gate: reject flat Ed25519 unless legacy escape is set
    const allowLegacyApi = process.env.ATTESTOR_ALLOW_LEGACY_API === 'true';
    const hasPkiMaterial = trustChain && trustChain.ca && trustChain.leaf && caPublicKeyPem;
    if (!hasPkiMaterial && !allowLegacyApi) {
      console.log(`[verify] Rejected: no PKI chain material submitted`);
      return c.json({
        error: 'PKI trust chain required for verification.',
        hint: 'Submit trustChain and caPublicKeyPem alongside certificate and publicKeyPem.',
        legacyEscape: 'Set ATTESTOR_ALLOW_LEGACY_API=true to allow flat Ed25519 verification (deprecated).',
      }, 422);
    }

    // 1. Verify certificate signature
    const certResult = verifyCertificate(certificate, publicKeyPem);

    // 2. Verify PKI trust chain if provided
    let chainVerification = null;
    let pkiBound = false;
    if (hasPkiMaterial) {
      const chainResult = verifyTrustChain(trustChain, caPublicKeyPem);

      // 3. CRITICAL: Bind certificate to chain leaf
      // The leaf's subject key must be the same key that signed the certificate
      const signerIdentity = derivePublicKeyIdentity(publicKeyPem);
      const leafMatchesCertificateKey = trustChain.leaf.subjectFingerprint === signerIdentity.fingerprint;
      const leafMatchesCertificateFingerprint = certificate.signing?.fingerprint === trustChain.leaf.subjectFingerprint;

      pkiBound = chainResult.chainIntact && leafMatchesCertificateKey && leafMatchesCertificateFingerprint;

      chainVerification = {
        caValid: chainResult.caValid,
        leafValid: chainResult.leafValid,
        chainIntact: chainResult.chainIntact,
        issuerMatch: chainResult.issuerMatch,
        caExpired: chainResult.caExpired,
        leafExpired: chainResult.leafExpired,
        // Certificate-to-leaf binding
        leafMatchesCertificateKey,
        leafMatchesCertificateFingerprint,
        pkiBound,
        overall: chainResult.overall,
        caName: trustChain.ca.name ?? null,
        leafSubject: trustChain.leaf.subject ?? null,
      };
    }

    // 4. Structured verification scope summary
    const pkiVerified = certResult.overall === 'valid' && pkiBound;
    const verificationMode = chainVerification ? 'pki' as const : 'legacy_ed25519' as const;
    const trustBinding = {
      certificateSignature: certResult.signatureValid && certResult.fingerprintConsistent,
      chainValid: chainVerification?.chainIntact ?? false,
      certificateBoundToLeaf: pkiBound,
      pkiVerified,
    };

    // 5. Deprecation notice when legacy flat Ed25519 path is used
    const deprecationNotice = verificationMode === 'legacy_ed25519'
      ? 'Flat Ed25519 verification without PKI trust chain is deprecated. ' +
        'Submit trustChain + caPublicKeyPem for full PKI-backed verification. ' +
        'Legacy mode will be removed in a future version.'
      : null;

    if (verificationMode === 'legacy_ed25519') {
      console.log(`[verify] Legacy flat Ed25519 verification used (no trust chain submitted)`);
    }

    return c.json({
      signatureValid: certResult.signatureValid,
      fingerprintConsistent: certResult.fingerprintConsistent,
      schemaValid: certResult.schemaValid,
      overall: certResult.overall,
      explanation: certResult.explanation,
      verificationMode,
      deprecationNotice,
      chainVerification,
      trustBinding,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ─── Filing Export ──────────────────────────────────────────────────────────

app.post('/api/v1/filing/export', async (c) => {
  try {
    const { adapterId, runId, decision, certificateId, evidenceChainTerminal, rows, proofMode } = await c.req.json();
    if (!adapterId || !runId || !rows) {
      return c.json({ error: 'adapterId, runId, and rows are required' }, 400);
    }

    const adapter = filingRegistry.get(adapterId);
    if (!adapter) {
      return c.json({ error: `Filing adapter '${adapterId}' not registered. Available: ${filingRegistry.list().map(a => a.id).join(', ')}` }, 404);
    }

    // Build decision envelope from provided data
    const { buildCounterpartyEnvelope } = await import('../filing/xbrl-adapter.js');
    const envelope = buildCounterpartyEnvelope(
      runId, decision ?? 'unknown', certificateId ?? null,
      evidenceChainTerminal ?? '', rows, proofMode ?? 'unknown',
    );

    const mapping = adapter.mapToTaxonomy(envelope);
    const pkg = adapter.generatePackage(mapping);
    pkg.evidenceLink = { runId, certificateId: certificateId ?? null, evidenceChainTerminal: evidenceChainTerminal ?? '' };

    return c.json({
      adapterId: adapter.id,
      format: adapter.format,
      taxonomyVersion: adapter.taxonomyVersion,
      mapping: {
        mappedCount: mapping.mapped.length,
        unmappedCount: mapping.unmapped.length,
        coveragePercent: mapping.coveragePercent,
      },
      package: pkg,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ─── Async Pipeline — BullMQ with truthful in-process fallback ──────────────

// Detect async backend at startup
let asyncBackendMode: 'bullmq' | 'in_process' = 'in_process';
let bullmqQueue: Awaited<ReturnType<typeof createPipelineQueue>> | null = null;
let bullmqWorker: Awaited<ReturnType<typeof createPipelineWorker>> | null = null;

// In-process fallback store
interface AsyncJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  submittedAt: string;
  completedAt: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
}
const inProcessJobs = new Map<string, AsyncJob>();

// BullMQ initialization via 3-tier Redis auto-resolution:
// 1. REDIS_URL env var (production)  2. localhost:6379 probe  3. embedded (dev/CI)
// Falls back to in_process if all tiers fail.
import { resolveRedis } from './redis-auto.js';

let redisMode: string = 'none';
try {
  const resolved = await resolveRedis();
  const redisUrl = `redis://${resolved.host}:${resolved.port}`;
  bullmqQueue = createPipelineQueue({ redisUrl });
  bullmqWorker = createPipelineWorker({ redisUrl });
  asyncBackendMode = 'bullmq';
  redisMode = resolved.mode;
  console.log(`[async] BullMQ active (Redis: ${resolved.mode} @ ${resolved.host}:${resolved.port})`);
} catch (err: any) {
  redisMode = 'unavailable';
  console.log(`[async] Redis unavailable (${err.message}), using in_process fallback`);
}

// ─── RLS Auto-Activation ─────────────────────────────────────────────────────

let rlsActivationResult = { activated: false, policiesFound: 0, tablesProtected: [] as string[], error: null as string | null };

if (process.env.ATTESTOR_PG_URL) {
  try {
    const pg = await (Function('return import("pg")')() as Promise<any>);
    const Pool = pg.Pool ?? pg.default?.Pool;
    const pool = new Pool({ connectionString: process.env.ATTESTOR_PG_URL });
    rlsActivationResult = await autoActivateRLS(pool);
    if (rlsActivationResult.activated) {
      console.log(`[rls] Active: ${rlsActivationResult.policiesFound} policies on [${rlsActivationResult.tablesProtected.join(', ')}]`);
    } else {
      console.log(`[rls] Not activated: ${rlsActivationResult.error ?? 'unknown'}`);
    }
    await pool.end();
  } catch (err: any) {
    rlsActivationResult.error = err.message;
    console.log(`[rls] Skipped: ${err.message}`);
  }
}

app.post('/api/v1/pipeline/run-async', async (c) => {
  try {
    const body = await c.req.json();
    const { candidateSql, intent, sign } = body;
    if (!candidateSql || !intent) {
      return c.json({ error: 'candidateSql and intent are required' }, 400);
    }

    const tenant = currentTenant(c);
    const quotaCheck = canConsumePipelineRun(tenant.tenantId, tenant.planId, tenant.monthlyRunQuota);
    if (!quotaCheck.allowed) {
      return c.json({
        error: 'Monthly pipeline run quota exceeded for this tenant plan.',
        tenantContext: { tenantId: tenant.tenantId, source: tenant.source, planId: tenant.planId },
        usage: quotaCheck.usage,
      }, 429);
    }

    const submittedAt = new Date().toISOString();
    const usage = consumePipelineRun(tenant.tenantId, tenant.planId, tenant.monthlyRunQuota);

    if (asyncBackendMode === 'bullmq' && bullmqQueue) {
      // BullMQ path
      const input: FinancialPipelineInput = {
        runId: `async-bullmq-${Date.now().toString(36)}`,
        intent, candidateSql,
        fixtures: body.fixtures ?? [],
        generatedReport: body.generatedReport,
        reportContract: body.reportContract,
        signingKeyPair: sign ? pki.signer.keyPair : undefined,
      };
      const { jobId } = await submitPipelineJob(bullmqQueue, input, sign);
      return c.json({
        jobId,
        status: 'queued',
        backendMode: 'bullmq',
        submittedAt,
        tenantContext: { tenantId: tenant.tenantId, source: tenant.source, planId: tenant.planId },
        usage,
      }, 202);
    }

    // In-process fallback (explicit about mode)
    const jobId = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const job: AsyncJob = { id: jobId, status: 'queued', submittedAt, completedAt: null, result: null, error: null };
    inProcessJobs.set(jobId, job);

    setImmediate(async () => {
      job.status = 'running';
      try {
        const asyncSigners = sign ? createRequestSigners('ephemeral') : null;
        const keyPair = asyncSigners?.signer.signingKeyPair;
        const input: FinancialPipelineInput = {
          runId: `async-${jobId}`, intent, candidateSql,
          fixtures: body.fixtures ?? [],
          generatedReport: body.generatedReport,
          reportContract: body.reportContract,
          signingKeyPair: keyPair,
        };
        const report = runFinancialPipeline(input);
        let kit = null;
        if (keyPair && report.certificate) {
          kit = buildVerificationKit(report, keyPair.publicKeyPem);
        }
        job.result = {
          runId: report.runId, decision: report.decision,
          proofMode: report.liveProof.mode,
          certificateId: report.certificate?.certificateId ?? null,
          certificate: report.certificate ?? null,
          verification: kit?.verification ?? null,
          publicKeyPem: keyPair?.publicKeyPem ?? null,
          trustChain: asyncSigners?.signer.trustChain ?? null,
          caPublicKeyPem: asyncSigners?.signer.caPublicKeyPem ?? null,
        };
        job.status = 'completed';
        job.completedAt = new Date().toISOString();
      } catch (err: any) {
        job.status = 'failed';
        job.error = err.message ?? String(err);
        job.completedAt = new Date().toISOString();
      }
    });

    return c.json({
      jobId,
      status: 'queued',
      backendMode: 'in_process',
      submittedAt,
      tenantContext: { tenantId: tenant.tenantId, source: tenant.source, planId: tenant.planId },
      usage,
    }, 202);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.get('/api/v1/pipeline/status/:jobId', async (c) => {
  const jobId = c.req.param('jobId');

  // Try BullMQ first
  if (asyncBackendMode === 'bullmq' && bullmqQueue) {
    const bmStatus = await getJobStatus(bullmqQueue, jobId);
    if (bmStatus.status !== 'not_found') {
      return c.json({ jobId, backendMode: 'bullmq', ...bmStatus });
    }
  }

  // In-process fallback
  const job = inProcessJobs.get(jobId);
  if (!job) return c.json({ error: 'Job not found' }, 404);
  return c.json({
    jobId: job.id,
    backendMode: 'in_process',
    status: job.status,
    submittedAt: job.submittedAt,
    completedAt: job.completedAt,
    result: job.result,
    error: job.error,
  });
});

// ─── Readiness Probe ───────────────────────────────────────────────────────
// Distinct from /health: /ready signals "this instance can serve requests"
// Used by orchestrators (Kubernetes, Railway, Compose healthcheck)

app.get('/api/v1/ready', (c) => {
  const checks: Record<string, boolean> = {};
  let ready = true;

  // 1. Async backend initialized (BullMQ or in-process fallback)
  checks.asyncBackend = asyncBackendMode === 'bullmq' || asyncBackendMode === 'in_process';
  if (!checks.asyncBackend) ready = false;

  // 2. PKI initialized
  checks.pki = pkiReady;
  if (!checks.pki) ready = false;

  // 3. Domain registry loaded
  checks.domains = domainRegistry.listIds().length > 0;
  if (!checks.domains) ready = false;

  // 4. Redis was resolved at startup (state-based, not new probe)
  if (asyncBackendMode === 'bullmq') {
    checks.redis = redisMode !== 'unavailable' && redisMode !== 'none';
    if (!checks.redis) ready = false;
  }

  const status = ready ? 200 : 503;
  return c.json({ ready, checks, asyncBackendMode, redisMode }, status);
});

// ─── Server Start/Stop ──────────────────────────────────────────────────────

export function startServer(port: number = 3700): { port: number; close: () => void } {
  const server = serve({ fetch: app.fetch, port });
  return {
    port,
    close: () => {
      if (server && typeof (server as any).close === 'function') {
        (server as any).close();
      }
    },
  };
}

export { app };

// Standalone mode: start server when run directly
if (process.argv[1]?.endsWith('api-server.ts') || process.argv[1]?.endsWith('api-server.js')) {
  const port = parseInt(process.env.PORT ?? '3700', 10);
  const handle = startServer(port);
  console.log(`[attestor] API server running on port ${port}`);

  // Graceful shutdown: drain connections on SIGTERM/SIGINT (container orchestration)
  const shutdown = (signal: string) => {
    console.log(`[attestor] ${signal} received — shutting down gracefully...`);
    handle.close();
    // Give in-flight requests 5s to complete, then force exit
    setTimeout(() => { console.log('[attestor] Force exit after timeout'); process.exit(0); }, 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
