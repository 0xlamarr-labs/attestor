/**
 * Attestor API Service Types — Exact Public Contract
 *
 * These types describe the actual runtime shapes emitted by api-server.ts.
 * They are the source of truth for API consumers.
 */

// ─── Sync Pipeline ──────────────────────────────────────────────────────────

export interface SyncPipelineRunRequest {
  candidateSql: string;
  intent: Record<string, unknown>;
  sign?: boolean;
  fixtures?: Record<string, unknown>[];
  generatedReport?: Record<string, unknown>;
  reportContract?: Record<string, unknown>;
  connector?: string;
  reviewerOidcToken?: string;
  oidcIssuer?: string;
  oidcAudience?: string;
  reviewerName?: string;
  reviewerRole?: string;
  reviewerIdentifier?: string;
}

export interface SyncPipelineRunResponse {
  runId: string;
  decision: string;
  scoring: { scorersRun: number; decision: string };
  warrant: string;
  escrow: string;
  receipt: string | null;
  capsule: string | null;
  proofMode: string;
  auditEntries: number;
  auditChainIntact: boolean;
  certificate: Record<string, unknown> | null;
  verification: Record<string, unknown> | null;
  publicKeyPem: string | null;
  trustChain: Record<string, unknown> | null;
  caPublicKeyPem: string | null;
  signingMode: 'keyless' | null;
  connectorUsed: string | null;
  schemaAttestation: SchemaAttestationSummary | null;
  tenantContext: { tenantId: string; source: string; planId: string | null };
  usage: UsageContext;
  identitySource: 'operator_asserted' | 'oidc_verified' | 'pki_bound';
  reviewerName: string | null;
  filingExport: { adapterId: string; coveragePercent: number; mappedCount: number } | null;
}

// ─── Async Pipeline ─────────────────────────────────────────────────────────

export interface AsyncPipelineRunRequest {
  candidateSql: string;
  intent: Record<string, unknown>;
  sign?: boolean;
  fixtures?: Record<string, unknown>[];
  generatedReport?: Record<string, unknown>;
  reportContract?: Record<string, unknown>;
}

export interface AsyncPipelineSubmitResponse {
  jobId: string;
  status: 'queued';
  backendMode: 'bullmq' | 'in_process';
  submittedAt: string;
  tenantContext: { tenantId: string; source: string; planId: string | null };
  usage: UsageContext;
}

export interface AsyncPipelineStatusResponse {
  jobId: string;
  backendMode: 'bullmq' | 'in_process';
  status: 'queued' | 'running' | 'waiting' | 'active' | 'completed' | 'failed';
  submittedAt: string;
  completedAt: string | null;
  result: {
    runId: string;
    decision: string;
    proofMode: string;
    certificateId: string | null;
    certificate: Record<string, unknown> | null;
    verification: Record<string, unknown> | null;
    publicKeyPem: string | null;
    trustChain: Record<string, unknown> | null;
    caPublicKeyPem: string | null;
  } | null;
  error: string | null;
}

// ─── Verify ─────────────────────────────────────────────────────────────────

export interface VerifyRequest {
  certificate: Record<string, unknown>;
  publicKeyPem: string;
  trustChain?: Record<string, unknown>;
  caPublicKeyPem?: string;
}

export interface VerifyResponse {
  signatureValid: boolean;
  fingerprintConsistent: boolean;
  schemaValid: boolean;
  overall: 'valid' | 'invalid' | 'schema_error';
  explanation: string;
  chainVerification: {
    caValid: boolean;
    leafValid: boolean;
    chainIntact: boolean;
    issuerMatch: boolean;
    caExpired: boolean;
    leafExpired: boolean;
    leafMatchesCertificateKey: boolean;
    leafMatchesCertificateFingerprint: boolean;
    pkiBound: boolean;
    overall: string;
    caName: string | null;
    leafSubject: string | null;
  } | null;
  trustBinding: {
    certificateSignature: boolean;
    chainValid: boolean;
    certificateBoundToLeaf: boolean;
    pkiVerified: boolean;
  };
}

// ─── Filing Export ──────────────────────────────────────────────────────────

export interface FilingExportRequest {
  adapterId: string;
  runId: string;
  decision?: string;
  certificateId?: string;
  evidenceChainTerminal?: string;
  rows: Record<string, unknown>[];
  proofMode?: string;
}

export interface FilingExportResponse {
  adapterId: string;
  format: string;
  taxonomyVersion: string;
  mapping: { mappedCount: number; unmappedCount: number; coveragePercent: number };
  package: Record<string, unknown>;
}

// ─── Schema Attestation ────────────────────────────────────────────────────

export interface SchemaAttestationSummary {
  present: boolean;
  scope: 'schema_attestation_full' | 'schema_attestation_connector' | 'execution_context_only';
  executionContextHash: string | null;
  provider: string | null;
  schemaFingerprint: string | null;
  sentinelFingerprint: string | null;
  tableNames: string[] | null;
  attestationHash: string | null;
}

// ─── Health ─────────────────────────────────────────────────────────────────

export interface ServiceHealth {
  status: 'healthy';
  version: string;
  uptime: number;
  domains: string[];
  connectors: string[];
  filingAdapters: string[];
  pki: {
    ready: boolean;
    caName: string;
    caFingerprint: string;
    signerSubject: string;
    reviewerSubject: string;
  };
  tenantIsolation: {
    requestLevel: boolean;
    databaseRls: {
      schemaAvailable: boolean;
      configured: boolean;
      activated: boolean;
      verified: boolean;
    };
  };
  engine: string;
}

export interface AccountUsageResponse {
  tenantContext: { tenantId: string; source: string; planId: string | null };
  usage: UsageContext;
}

export interface AdminTenantKeyRecord {
  id: string;
  tenantId: string;
  tenantName: string;
  planId: string | null;
  monthlyRunQuota: number | null;
  apiKeyPreview: string;
  status: 'active' | 'revoked';
  createdAt: string;
  revokedAt: string | null;
}

export interface AdminListTenantKeysResponse {
  keys: AdminTenantKeyRecord[];
}

export interface AdminIssueTenantKeyRequest {
  tenantId: string;
  tenantName: string;
  planId?: string;
  monthlyRunQuota?: number | null;
}

export interface AdminIssueTenantKeyResponse {
  key: AdminTenantKeyRecord & { apiKey: string };
}

export interface AdminRevokeTenantKeyResponse {
  key: AdminTenantKeyRecord;
}

export interface UsageContext {
  tenantId: string;
  planId: string;
  meter: 'monthly_pipeline_runs';
  period: string;
  used: number;
  quota: number | null;
  remaining: number | null;
  enforced: boolean;
}

// ─── Route Constants ────────────────────────────────────────────────────────

export const API_ROUTES = {
  PIPELINE_RUN: '/api/v1/pipeline/run',
  PIPELINE_RUN_ASYNC: '/api/v1/pipeline/run-async',
  PIPELINE_STATUS: '/api/v1/pipeline/status/:jobId',
  VERIFY: '/api/v1/verify',
  FILING_EXPORT: '/api/v1/filing/export',
  ACCOUNT_USAGE: '/api/v1/account/usage',
  ADMIN_TENANT_KEYS: '/api/v1/admin/tenant-keys',
  ADMIN_TENANT_KEY_REVOKE: '/api/v1/admin/tenant-keys/:id/revoke',
  HEALTH: '/api/v1/health',
  DOMAINS: '/api/v1/domains',
  CONNECTORS: '/api/v1/connectors',
} as const;
