/**
 * Attestor HTTP API Server — Real Hono-based service layer.
 *
 * Wraps the governance engine in a real HTTP API:
 * - POST /api/v1/pipeline/run — execute a governed pipeline
 * - GET  /api/v1/health — service health check
 * - GET  /api/v1/domains — list registered domain packs
 * - POST /api/v1/verify — verify a certificate
 *
 * This is a real server, not a mock. It binds to a port and accepts
 * real HTTP requests. Integration tests hit it over the network.
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
      connectorUsed: connectorProvider,
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
    const { certificate, publicKeyPem } = await c.req.json();
    if (!certificate || !publicKeyPem) {
      return c.json({ error: 'certificate and publicKeyPem are required' }, 400);
    }

    const result = verifyCertificate(certificate, publicKeyPem);
    return c.json({
      signatureValid: result.signatureValid,
      fingerprintConsistent: result.fingerprintConsistent,
      schemaValid: result.schemaValid,
      overall: result.overall,
      explanation: result.explanation,
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
