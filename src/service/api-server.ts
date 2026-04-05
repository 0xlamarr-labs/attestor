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

import { Hono } from 'hono';
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
import { xbrlUsGaapAdapter } from '../filing/xbrl-adapter.js';
import { generatePkiHierarchy, verifyTrustChain, type TrustChain } from '../signing/pki-chain.js';

// Register domain packs
if (!domainRegistry.has('finance')) domainRegistry.register(financeDomainPack);
if (!domainRegistry.has('healthcare')) domainRegistry.register(healthcareDomainPack);

// Register connectors
if (!connectorRegistry.has('snowflake')) connectorRegistry.register(snowflakeConnector);

// Register filing adapters
if (!filingRegistry.has('xbrl-us-gaap-2024')) filingRegistry.register(xbrlUsGaapAdapter);

const app = new Hono();
const startTime = Date.now();

// Generate PKI hierarchy at server startup
const pki = generatePkiHierarchy('Attestor API Root CA', 'API Runtime Signer', 'API Reviewer');
const pkiReady = true;

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

// ─── Pipeline Run ───────────────────────────────────────────────────────────

app.post('/api/v1/pipeline/run', async (c) => {
  try {
    const body = await c.req.json();
    const { scenarioId, candidateSql, intent, sign } = body;

    if (!candidateSql || !intent) {
      return c.json({ error: 'candidateSql and intent are required' }, 400);
    }

    // ── Optional connector-backed execution ──
    let connectorExecution: any = null;
    let connectorProvider: string | null = null;
    if (body.connector) {
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

    // Use PKI-backed signer key pair when signing
    const keyPair = sign ? pki.signer.keyPair : undefined;

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

    // Use PKI-backed reviewer key pair when reviewer is present
    const reviewerKeyPair = (sign && reviewerIdentity) ? pki.reviewer.keyPair : undefined;

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
      kit = buildVerificationKit(report, keyPair.publicKeyPem);
    }

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
      trustChain: sign ? pki.chains.signer : null,
      caPublicKeyPem: sign ? pki.ca.keyPair.publicKeyPem : null,
      connectorUsed: connectorProvider,
      // Schema attestation summary (when real DB execution with attestation capture)
      schemaAttestation: connectorExecution?.executionContextHash ? {
        executionContextHash: connectorExecution.executionContextHash,
        provider: connectorProvider,
      } : null,
      identitySource,
      reviewerName: reviewerIdentity?.name ?? null,
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

    // 1. Verify certificate signature
    const certResult = verifyCertificate(certificate, publicKeyPem);

    // 2. Verify PKI trust chain if provided
    // Chain verification uses the CA's public key (not the signer's)
    let chainVerification = null;
    if (trustChain && trustChain.ca && trustChain.leaf && caPublicKeyPem) {
      const chainResult = verifyTrustChain(trustChain, caPublicKeyPem);
      chainVerification = {
        caValid: chainResult.caValid,
        leafValid: chainResult.leafValid,
        chainIntact: chainResult.chainIntact,
        issuerMatch: chainResult.issuerMatch,
        caExpired: chainResult.caExpired,
        leafExpired: chainResult.leafExpired,
        overall: chainResult.overall,
        caName: trustChain.ca.name ?? null,
        leafSubject: trustChain.leaf.subject ?? null,
      };
    }

    return c.json({
      signatureValid: certResult.signatureValid,
      fingerprintConsistent: certResult.fingerprintConsistent,
      schemaValid: certResult.schemaValid,
      overall: certResult.overall,
      explanation: certResult.explanation,
      // PKI trust chain verification (when chain material is provided)
      chainVerification,
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

// ─── Async Pipeline (in-process job store for bounded first slice) ───────────

interface AsyncJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  submittedAt: string;
  completedAt: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
}

const jobStore = new Map<string, AsyncJob>();

app.post('/api/v1/pipeline/run-async', async (c) => {
  try {
    const body = await c.req.json();
    const { candidateSql, intent, sign } = body;
    if (!candidateSql || !intent) {
      return c.json({ error: 'candidateSql and intent are required' }, 400);
    }

    const jobId = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const job: AsyncJob = { id: jobId, status: 'queued', submittedAt: new Date().toISOString(), completedAt: null, result: null, error: null };
    jobStore.set(jobId, job);

    // Execute asynchronously (in-process worker for bounded first slice)
    setImmediate(async () => {
      job.status = 'running';
      try {
        const keyPair = sign ? pki.signer.keyPair : undefined;
        const input: FinancialPipelineInput = {
          runId: `async-${jobId}`,
          intent, candidateSql,
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
          trustChain: sign ? pki.chains.signer : null,
          caPublicKeyPem: sign ? pki.ca.keyPair.publicKeyPem : null,
        };
        job.status = 'completed';
        job.completedAt = new Date().toISOString();
      } catch (err: any) {
        job.status = 'failed';
        job.error = err.message ?? String(err);
        job.completedAt = new Date().toISOString();
      }
    });

    return c.json({ jobId, status: 'queued', submittedAt: job.submittedAt }, 202);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.get('/api/v1/pipeline/status/:jobId', (c) => {
  const jobId = c.req.param('jobId');
  const job = jobStore.get(jobId);
  if (!job) return c.json({ error: 'Job not found' }, 404);
  return c.json({
    jobId: job.id,
    status: job.status,
    submittedAt: job.submittedAt,
    completedAt: job.completedAt,
    result: job.result,
    error: job.error,
  });
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
