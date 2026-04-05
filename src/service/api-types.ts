/**
 * Attestor API Service Types
 *
 * Type definitions for the bounded HTTP API service layer.
 * The repository ships a real Hono server for synchronous governed runs,
 * certificate verification, and registry metadata endpoints.
 *
 * DESIGN:
 * - Request/response types for synchronous governed pipeline execution
 * - Optional bearer-token identity verification (OIDC first slice)
 * - Registry metadata for domains and connectors
 * - Certificate verification endpoint
 *
 * BOUNDARY:
 * - Single-process local server, not a distributed control plane
 * - No persistent job store or async execution queue
 * - No multi-tenant storage or session management
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
  /** Error message when the run failed. */
  error?: string;
  /** Execution metadata. */
  metadata?: {
    durationMs: number;
    proofMode: string;
    unitCount?: number;
  };
}

// Health / Status

export interface ServiceHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  domains: string[];
  connectors: string[];
  filingAdapters?: string[];
  proofModes: string[];
}

export interface ConnectorSummary {
  id: string;
  displayName: string;
  configured: boolean;
  available: boolean;
}

// Route Definitions

/**
 * API route contract - what the bounded service exposes today.
 *
 * POST /api/v1/pipeline/run     - execute a governed pipeline
 * GET  /api/v1/pipeline/:id     - future async status path
 * GET  /api/v1/health           - service health check
 * GET  /api/v1/domains          - list registered domain packs
 * GET  /api/v1/connectors       - list registered database connectors
 * POST /api/v1/verify           - verify a certificate or kit
 */
export const API_ROUTES = {
  PIPELINE_RUN: '/api/v1/pipeline/run',
  PIPELINE_STATUS: '/api/v1/pipeline/:id',
  HEALTH: '/api/v1/health',
  DOMAINS: '/api/v1/domains',
  CONNECTORS: '/api/v1/connectors',
  VERIFY: '/api/v1/verify',
} as const;
