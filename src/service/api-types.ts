/**
 * Attestor API Service Types
 *
 * Type definitions for the future HTTP API service layer.
 * The governance engine currently runs as a local CLI.
 * These types define the contract for a remote-callable service.
 *
 * DESIGN:
 * - Request/response types for governed pipeline execution
 * - Bearer token authentication model
 * - Tenant isolation model
 * - Async execution model with status polling
 *
 * BOUNDARY:
 * - Types only — no HTTP framework, no server implementation
 * - The actual service layer will wrap the existing pipeline
 * - No multi-tenant storage, no distributed state (yet)
 */

// ─── Authentication ─────────────────────────────────────────────────────────

export interface ServiceAuth {
  /** Bearer token (OIDC ID token or API key). */
  token: string;
  /** Token type. */
  type: 'bearer' | 'api_key';
  /** Tenant identifier (for future multi-tenant). */
  tenantId?: string;
}

// ─── Pipeline Execution Request ─────────────────────────────────────────────

export interface PipelineRequest {
  /** Unique request ID. */
  requestId: string;
  /** Domain pack to use (e.g., 'finance', 'healthcare'). */
  domain: string;
  /** The query/operation to govern. */
  candidateSql: string;
  /** Query intent metadata. */
  intent: Record<string, unknown>;
  /** Execution mode. */
  mode: 'sync' | 'async';
  /** Whether to issue a signed certificate. */
  sign: boolean;
  /** Whether to include reviewer endorsement. */
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
  /** Certificate ID (if signing was requested). */
  certificateId?: string;
  /** Verification kit location (if signing was requested). */
  kitUrl?: string;
  /** Error message (if failed). */
  error?: string;
  /** Execution metadata. */
  metadata?: {
    durationMs: number;
    proofMode: string;
    unitCount?: number;
  };
}

// ─── Health / Status ────────────────────────────────────────────────────────

export interface ServiceHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  domains: string[];
  connectors: string[];
  proofModes: string[];
}

// ─── Route Definitions ──────────────────────────────────────────────────────

/**
 * API route contract — what the service will expose.
 *
 * POST /api/v1/pipeline/run     — execute a governed pipeline
 * GET  /api/v1/pipeline/:id     — get pipeline execution status
 * GET  /api/v1/health           — service health check
 * GET  /api/v1/domains          — list registered domain packs
 * GET  /api/v1/connectors       — list registered database connectors
 * POST /api/v1/verify           — verify a certificate or kit
 */
export const API_ROUTES = {
  PIPELINE_RUN: '/api/v1/pipeline/run',
  PIPELINE_STATUS: '/api/v1/pipeline/:id',
  HEALTH: '/api/v1/health',
  DOMAINS: '/api/v1/domains',
  CONNECTORS: '/api/v1/connectors',
  VERIFY: '/api/v1/verify',
} as const;
