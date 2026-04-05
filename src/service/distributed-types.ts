/**
 * Distributed Control Plane — Service Architecture Types
 *
 * Defines the contract for a distributed Attestor deployment:
 * multiple service instances, durable workflow execution,
 * and cross-service coordination.
 *
 * RECOMMENDED STACK (from research):
 * Hono (API) + Drizzle (ORM) + PostgreSQL (RLS) + Inngest (workflows) + Railway (deploy)
 *
 * BOUNDARY:
 * - Type definitions and architecture contracts
 * - No runtime implementation of distributed coordination
 * - The minimum viable deployment is documented here
 */

// ─── Service Topology ───────────────────────────────────────────────────────

export interface ServiceTopology {
  /** API gateway instances (stateless, horizontally scaled). */
  api: ServiceInstance[];
  /** Worker instances (process background jobs). */
  workers: ServiceInstance[];
  /** Database (managed PostgreSQL with RLS). */
  database: DatabaseInstance;
  /** Queue/workflow backend. */
  queue: QueueBackend;
}

export interface ServiceInstance {
  id: string;
  role: 'api' | 'worker' | 'cron';
  host: string;
  port: number;
  status: 'healthy' | 'degraded' | 'unhealthy';
  startedAt: string;
}

export interface DatabaseInstance {
  provider: 'postgresql' | 'neon' | 'supabase';
  host: string;
  tenancyModel: 'shared_rls' | 'schema_per_tenant' | 'database_per_tenant';
}

export interface QueueBackend {
  provider: 'bullmq' | 'inngest' | 'temporal' | 'in_process';
  healthy: boolean;
  activeJobs: number;
  failedJobs: number;
}

// ─── Durable Workflow ───────────────────────────────────────────────────────

/**
 * Workflow step definition for durable execution.
 * Each step saves its result independently — if step 3 fails,
 * only step 3 retries (not the entire pipeline).
 */
export interface WorkflowStep {
  id: string;
  name: string;
  /** Step function. */
  handler: (input: unknown) => Promise<unknown>;
  /** Retry policy. */
  retry?: { attempts: number; backoff: 'exponential' | 'fixed'; delayMs: number };
  /** Timeout in milliseconds. */
  timeoutMs?: number;
}

export interface GovernanedPipelineWorkflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
}

/**
 * The governed pipeline as a durable workflow.
 * Each governance stage is a separate durable step.
 */
export const GOVERNED_PIPELINE_WORKFLOW: GovernanedPipelineWorkflow = {
  id: 'governed-pipeline',
  name: 'Governed Financial Pipeline',
  steps: [
    { id: 'sql-governance', name: 'SQL Governance Check', handler: async (input) => input, retry: { attempts: 1, backoff: 'fixed', delayMs: 0 } },
    { id: 'policy-check', name: 'Policy & Entitlement', handler: async (input) => input, retry: { attempts: 1, backoff: 'fixed', delayMs: 0 } },
    { id: 'execution', name: 'Bounded Execution', handler: async (input) => input, retry: { attempts: 3, backoff: 'exponential', delayMs: 1000 }, timeoutMs: 30000 },
    { id: 'evidence', name: 'Evidence Collection', handler: async (input) => input, retry: { attempts: 1, backoff: 'fixed', delayMs: 0 } },
    { id: 'scoring', name: 'Deterministic Scoring', handler: async (input) => input, retry: { attempts: 1, backoff: 'fixed', delayMs: 0 } },
    { id: 'review', name: 'Review & Escalation', handler: async (input) => input, retry: { attempts: 1, backoff: 'fixed', delayMs: 0 } },
    { id: 'authority', name: 'Authority Closure', handler: async (input) => input, retry: { attempts: 1, backoff: 'fixed', delayMs: 0 } },
    { id: 'attestation', name: 'Certificate Issuance', handler: async (input) => input, retry: { attempts: 1, backoff: 'fixed', delayMs: 0 } },
  ],
};

// ─── Deployment Configuration ───────────────────────────────────────────────

export interface DeploymentConfig {
  /** Deployment platform. */
  platform: 'railway' | 'fly' | 'kubernetes' | 'docker-compose' | 'local';
  /** Number of API replicas. */
  apiReplicas: number;
  /** Number of worker replicas. */
  workerReplicas: number;
  /** Database configuration. */
  database: {
    url: string;
    maxConnections: number;
    tenancyModel: DatabaseInstance['tenancyModel'];
  };
  /** Queue configuration. */
  queue: {
    provider: QueueBackend['provider'];
    redisUrl?: string;
    inngestEventKey?: string;
  };
}

/**
 * Minimum viable distributed deployment.
 */
export const MINIMUM_VIABLE_DEPLOYMENT: DeploymentConfig = {
  platform: 'railway',
  apiReplicas: 1,
  workerReplicas: 1,
  database: {
    url: 'postgresql://...',
    maxConnections: 20,
    tenancyModel: 'shared_rls',
  },
  queue: {
    provider: 'bullmq',
    redisUrl: 'redis://...',
  },
};
