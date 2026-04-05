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
import type { FinancialPipelineInput } from '../financial/pipeline.js';

// Register domain packs
if (!domainRegistry.has('finance')) domainRegistry.register(financeDomainPack);
if (!domainRegistry.has('healthcare')) domainRegistry.register(healthcareDomainPack);

const app = new Hono();
const startTime = Date.now();

// ─── Health ─────────────────────────────────────────────────────────────────

app.get('/api/v1/health', (c) => {
  return c.json({
    status: 'healthy',
    version: '0.1.0',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    domains: domainRegistry.listIds(),
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

// ─── Pipeline Run ───────────────────────────────────────────────────────────

app.post('/api/v1/pipeline/run', async (c) => {
  try {
    const body = await c.req.json();
    const { scenarioId, candidateSql, intent, sign } = body;

    if (!candidateSql || !intent) {
      return c.json({ error: 'candidateSql and intent are required' }, 400);
    }

    const keyPair = sign ? generateKeyPair() : undefined;

    const input: FinancialPipelineInput = {
      runId: `api-${Date.now().toString(36)}`,
      intent,
      candidateSql,
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
      certificate: report.certificate ? {
        id: report.certificate.certificateId,
        decision: report.certificate.decision,
        algorithm: report.certificate.signing.algorithm,
        fingerprint: report.certificate.signing.fingerprint,
      } : null,
      verification: kit?.verification ?? null,
      publicKeyPem: keyPair?.publicKeyPem ?? null,
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
