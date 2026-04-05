/**
 * Attestor API Service Types
 *
 * Type definitions for the bounded HTTP API service layer.
 * The repository ships a real Hono server with:
 * - Synchronous and async governed pipeline execution
 * - PKI-backed certificate issuance with trust chain
 * - Certificate + chain verification with leaf binding
 * - XBRL filing export
 * - OIDC reviewer identity verification
 * - Request-level tenant isolation middleware
 * - Registry metadata for domains, connectors, and filing adapters
 *
 * BOUNDARY:
 * - Single-process local server with optional BullMQ async (REDIS_URL)
 * - Request-level tenant isolation (not database-level)
 * - In-process async fallback when Redis is not available
 * - No persistent multi-tenant storage or full IAM
 */

// Authentication

export interface ServiceAuth {
  /** Bearer token (OIDC ID token or API key). */
  token: string;
  /** Token type. */
  type: 'bearer' | 'api_key';
  /** Tenant identifier for future multi-tenant routing. */
  tenantId?: string;
}

// Pipeline Execution Request

export interface PipelineRequest {
  /** Unique request ID. */
  requestId: string;
  /** Domain pack to use (for example 'finance' or 'healthcare'). */
  domain: string;
  /** The query or operation to govern. */
  candidateSql: string;
  /** Query intent metadata. */
  intent: Record<string, unknown>;
  /** Execution mode. */
  mode: 'sync' | 'async';
  /** Whether to issue a signed certificate. */
  sign: boolean;
  /** Optional reviewer identity supplied by the caller. */
  reviewerEndorsement?: {
    reviewerName: string;
    reviewerRole: string;
    rationale: string;
  };
}

export interface PipelineResponse {
  requestId: string;
  status: 'completed' | 'pending' | 'failed';
  /** Governed decision. */
  decision?: string;
  /** Full certificate when signing was requested. */
  certificate?: Record<string, unknown> | null;
  /** Verification summary when signing was requested. */
  verification?: Record<string, unknown> | null;
  /** Runtime signer public key PEM when signing was requested. */
  publicKeyPem?: string | null;
  /** How reviewer identity was established. */
  identitySource?: 'operator_asserted' | 'oidc_verified' | 'pki_bound';
  /** Reviewer name when present. */
  reviewerName?: string | null;
  /** PKI trust chain when signing was requested. */
  trustChain?: Record<string, unknown> | null;
  /** CA public key PEM for chain verification. */
  caPublicKeyPem?: string | null;
  /** Tenant context from request-level isolation. */
  tenantContext?: { tenantId: string; source: string };
  /** Schema attestation summary when available. */
  schemaAttestation?: SchemaAttestationSummary | null;
  /** Connector used for execution. */
  connectorUsed?: string | null;
  /** Filing export auto-summary when sign=true and XBRL adapter is available. */
  filingExport?: { adapterId: string; coveragePercent: number; mappedCount: number } | null;
  /** Error message when the run failed. */
  error?: string;
  /** Execution metadata. */
  metadata?: {
    durationMs: number;
    proofMode: string;
    unitCount?: number;
  };
}

export interface SchemaAttestationSummary {
  present: boolean;
  scope: 'schema_attestation_summary' | 'execution_context_only';
  executionContextHash: string | null;
  provider: string | null;
  schemaFingerprint?: string | null;
  sentinelFingerprint?: string | null;
  tableNames?: string[] | null;
}

// Health / Status

export interface ServiceHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  domains: string[];
  connectors: string[];
  filingAdapters?: string[];
  pki?: { ready: boolean; caName: string; caFingerprint: string; signerSubject: string; reviewerSubject: string };
}

export interface VerifyResponse {
  signatureValid: boolean;
  fingerprintConsistent: boolean;
  schemaValid: boolean;
  overall: 'valid' | 'invalid' | 'schema_error';
  explanation: string;
  chainVerification?: {
    caValid: boolean;
    leafValid: boolean;
    chainIntact: boolean;
    issuerMatch: boolean;
    leafMatchesCertificateKey: boolean;
    leafMatchesCertificateFingerprint: boolean;
    pkiBound: boolean;
    overall: string;
    caName: string | null;
    leafSubject: string | null;
  } | null;
  trustBinding?: {
    certificateSignature: boolean;
    chainValid: boolean;
    certificateBoundToLeaf: boolean;
    pkiVerified: boolean;
  };
}

export interface ConnectorSummary {
  id: string;
  displayName: string;
  configured: boolean;
  available: boolean;
}

// Route Definitions

/**
 * API route contract — current shipped surface.
 *
 * POST /api/v1/pipeline/run        — synchronous governed pipeline execution
 * POST /api/v1/pipeline/run-async  — async job submission (returns jobId)
 * GET  /api/v1/pipeline/status/:id — async job status and result
 * POST /api/v1/verify              — certificate + PKI chain verification
 * POST /api/v1/filing/export       — XBRL taxonomy mapping export
 * GET  /api/v1/health              — service health + PKI + registries
 * GET  /api/v1/domains             — registered domain packs
 * GET  /api/v1/connectors          — registered database connectors
 */
export const API_ROUTES = {
  PIPELINE_RUN: '/api/v1/pipeline/run',
  PIPELINE_RUN_ASYNC: '/api/v1/pipeline/run-async',
  PIPELINE_STATUS: '/api/v1/pipeline/status/:jobId',
  VERIFY: '/api/v1/verify',
  FILING_EXPORT: '/api/v1/filing/export',
  HEALTH: '/api/v1/health',
  DOMAINS: '/api/v1/domains',
  CONNECTORS: '/api/v1/connectors',
} as const;
