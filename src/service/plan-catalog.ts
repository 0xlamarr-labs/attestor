/**
 * Hosted Plan Catalog — Single source of truth for monetizable hosted access.
 *
 * The catalog defines the small built-in plan set used by hosted onboarding,
 * quota defaults, and operator/admin surfaces. Self-hosted or externally
 * asserted tokens may still carry custom plan ids, but the managed hosted
 * shell should speak a consistent built-in vocabulary.
 */

export type HostedPlanId = 'community' | 'starter' | 'pro' | 'enterprise';

export interface HostedPlanDefinition {
  id: HostedPlanId;
  displayName: string;
  description: string;
  defaultMonthlyRunQuota: number | null;
  defaultPipelineRequestsPerWindow: number | null;
  intendedFor: 'self_host' | 'hosted' | 'enterprise';
  defaultForHostedProvisioning: boolean;
}

export interface ResolvedPlanSpec {
  plan: HostedPlanDefinition | null;
  planId: string;
  monthlyRunQuota: number | null;
  knownPlan: boolean;
  quotaSource: 'override' | 'plan_default' | 'plan_unlimited' | 'custom_override' | 'custom_unlimited';
}

export interface PlanRateLimitSpec {
  planId: string;
  windowSeconds: number;
  requestsPerWindow: number | null;
  enforced: boolean;
  knownPlan: boolean;
  source: 'plan_default' | 'env_override' | 'custom_unlimited';
}

export const SELF_HOST_PLAN_ID: HostedPlanId = 'community';
export const DEFAULT_HOSTED_PLAN_ID: HostedPlanId = 'starter';

const PLAN_CATALOG: HostedPlanDefinition[] = [
  {
    id: 'community',
    displayName: 'Community',
    description: 'Self-hosted evaluation and internal development.',
    defaultMonthlyRunQuota: null,
    defaultPipelineRequestsPerWindow: null,
    intendedFor: 'self_host',
    defaultForHostedProvisioning: false,
  },
  {
    id: 'starter',
    displayName: 'Starter',
    description: 'Entry hosted tenant with bounded monthly pipeline usage.',
    defaultMonthlyRunQuota: 100,
    defaultPipelineRequestsPerWindow: 10,
    intendedFor: 'hosted',
    defaultForHostedProvisioning: true,
  },
  {
    id: 'pro',
    displayName: 'Pro',
    description: 'Higher-throughput hosted tenant for repeated operational use.',
    defaultMonthlyRunQuota: 1000,
    defaultPipelineRequestsPerWindow: 60,
    intendedFor: 'hosted',
    defaultForHostedProvisioning: false,
  },
  {
    id: 'enterprise',
    displayName: 'Enterprise',
    description: 'Hosted or private deployment plan with negotiated limits.',
    defaultMonthlyRunQuota: null,
    defaultPipelineRequestsPerWindow: 300,
    intendedFor: 'enterprise',
    defaultForHostedProvisioning: false,
  },
];

function normalizeQuota(quota: number | null | undefined): number | null {
  if (typeof quota !== 'number' || !Number.isInteger(quota) || quota < 0) return null;
  return quota;
}

function normalizeRateLimit(limit: number | null | undefined): number | null {
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit <= 0) return null;
  return limit;
}

function envOverrideNameForPlan(planId: HostedPlanId): string {
  return `ATTESTOR_RATE_LIMIT_${planId.toUpperCase()}_REQUESTS`;
}

export function defaultRateLimitWindowSeconds(): number {
  const raw = Number.parseInt(process.env.ATTESTOR_RATE_LIMIT_WINDOW_SECONDS ?? '60', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 60;
}

export function listHostedPlans(): HostedPlanDefinition[] {
  return PLAN_CATALOG.map((plan) => ({ ...plan }));
}

export function validHostedPlanIds(): HostedPlanId[] {
  return PLAN_CATALOG.map((plan) => plan.id);
}

export function getHostedPlan(planId: string | null | undefined): HostedPlanDefinition | null {
  if (!planId) return null;
  return PLAN_CATALOG.find((plan) => plan.id === planId) ?? null;
}

export function resolvePlanRateLimit(planId: string | null | undefined): PlanRateLimitSpec {
  const resolvedPlanId = planId?.trim() || SELF_HOST_PLAN_ID;
  const plan = getHostedPlan(resolvedPlanId);
  const windowSeconds = defaultRateLimitWindowSeconds();

  if (!plan) {
    return {
      planId: resolvedPlanId,
      windowSeconds,
      requestsPerWindow: null,
      enforced: false,
      knownPlan: false,
      source: 'custom_unlimited',
    };
  }

  const envOverride = normalizeRateLimit(
    Number.parseInt(process.env[envOverrideNameForPlan(plan.id)] ?? '', 10),
  );
  const requestsPerWindow = envOverride ?? plan.defaultPipelineRequestsPerWindow;

  return {
    planId: plan.id,
    windowSeconds,
    requestsPerWindow,
    enforced: requestsPerWindow !== null,
    knownPlan: true,
    source: envOverride !== null ? 'env_override' : 'plan_default',
  };
}

export function resolvePlanSpec(options?: {
  planId?: string | null;
  monthlyRunQuota?: number | null;
  defaultPlanId?: HostedPlanId;
  allowCustomPlan?: boolean;
}): ResolvedPlanSpec {
  const requestedPlanId = options?.planId?.trim() || options?.defaultPlanId || SELF_HOST_PLAN_ID;
  const overrideQuota = normalizeQuota(options?.monthlyRunQuota);
  const plan = getHostedPlan(requestedPlanId);

  if (!plan) {
    if (!options?.allowCustomPlan) {
      throw new Error(`Unknown planId '${requestedPlanId}'. Valid plans: ${validHostedPlanIds().join(', ')}`);
    }
    return {
      plan: null,
      planId: requestedPlanId,
      monthlyRunQuota: overrideQuota,
      knownPlan: false,
      quotaSource: overrideQuota === null ? 'custom_unlimited' : 'custom_override',
    };
  }

  if (overrideQuota !== null) {
    return {
      plan,
      planId: plan.id,
      monthlyRunQuota: overrideQuota,
      knownPlan: true,
      quotaSource: 'override',
    };
  }

  return {
    plan,
    planId: plan.id,
    monthlyRunQuota: plan.defaultMonthlyRunQuota,
    knownPlan: true,
    quotaSource: plan.defaultMonthlyRunQuota === null ? 'plan_unlimited' : 'plan_default',
  };
}
