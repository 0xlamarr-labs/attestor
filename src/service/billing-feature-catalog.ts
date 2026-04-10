import type { HostedPlanId } from './plan-catalog.js';

export type HostedFeatureKey =
  | 'api.access'
  | 'account.users'
  | 'billing.checkout'
  | 'billing.portal'
  | 'billing.export'
  | 'billing.reconciliation'
  | 'async.pipeline'
  | 'iam.oidc_sso'
  | 'healthcare.validation';

export interface HostedFeatureDefinition {
  key: HostedFeatureKey;
  displayName: string;
  description: string;
  category: 'access' | 'account' | 'billing' | 'runtime' | 'identity' | 'domain';
  planIds: HostedPlanId[];
  stripeManaged: boolean;
  stripeLookupKeysByPlan: Partial<Record<HostedPlanId, string[]>>;
}

const FEATURE_CATALOG: HostedFeatureDefinition[] = [
  {
    key: 'api.access',
    displayName: 'Hosted API access',
    description: 'Use Attestor hosted pipeline and account APIs for the current tenant.',
    category: 'access',
    planIds: ['starter', 'pro', 'enterprise'],
    stripeManaged: true,
    stripeLookupKeysByPlan: {
      starter: ['attestor.starter.api'],
      pro: ['attestor.pro.api'],
      enterprise: ['attestor.enterprise.api'],
    },
  },
  {
    key: 'account.users',
    displayName: 'Account user management',
    description: 'Manage hosted customer users, roles, invites, and password lifecycle.',
    category: 'account',
    planIds: ['starter', 'pro', 'enterprise'],
    stripeManaged: false,
    stripeLookupKeysByPlan: {},
  },
  {
    key: 'billing.checkout',
    displayName: 'Hosted checkout',
    description: 'Create hosted Stripe Checkout sessions for the current account.',
    category: 'billing',
    planIds: ['starter', 'pro', 'enterprise'],
    stripeManaged: false,
    stripeLookupKeysByPlan: {},
  },
  {
    key: 'billing.portal',
    displayName: 'Billing portal',
    description: 'Open the hosted Stripe Billing Portal for the current account.',
    category: 'billing',
    planIds: ['starter', 'pro', 'enterprise'],
    stripeManaged: false,
    stripeLookupKeysByPlan: {},
  },
  {
    key: 'billing.export',
    displayName: 'Billing export',
    description: 'Export invoice, charge, and billing summary truth for the current account.',
    category: 'billing',
    planIds: ['starter', 'pro', 'enterprise'],
    stripeManaged: true,
    stripeLookupKeysByPlan: {
      starter: ['attestor.starter.billing_export'],
      pro: ['attestor.pro.billing_export'],
      enterprise: ['attestor.enterprise.billing_export'],
    },
  },
  {
    key: 'billing.reconciliation',
    displayName: 'Billing reconciliation',
    description: 'Review invoice versus charge reconciliation results for hosted billing.',
    category: 'billing',
    planIds: ['pro', 'enterprise'],
    stripeManaged: true,
    stripeLookupKeysByPlan: {
      pro: ['attestor.pro.billing_reconciliation'],
      enterprise: ['attestor.enterprise.billing_reconciliation'],
    },
  },
  {
    key: 'async.pipeline',
    displayName: 'Async pipeline execution',
    description: 'Submit governed pipeline runs to the hosted async queue.',
    category: 'runtime',
    planIds: ['starter', 'pro', 'enterprise'],
    stripeManaged: true,
    stripeLookupKeysByPlan: {
      starter: ['attestor.starter.async_pipeline'],
      pro: ['attestor.pro.async_pipeline'],
      enterprise: ['attestor.enterprise.async_pipeline'],
    },
  },
  {
    key: 'iam.oidc_sso',
    displayName: 'Hosted OIDC SSO',
    description: 'Use hosted OIDC authorization-code + PKCE customer sign-in.',
    category: 'identity',
    planIds: ['pro', 'enterprise'],
    stripeManaged: false,
    stripeLookupKeysByPlan: {},
  },
  {
    key: 'healthcare.validation',
    displayName: 'Healthcare validation pack',
    description: 'Use the healthcare validation and filing slice on the hosted platform.',
    category: 'domain',
    planIds: ['pro', 'enterprise'],
    stripeManaged: true,
    stripeLookupKeysByPlan: {
      pro: ['attestor.pro.healthcare_validation'],
      enterprise: ['attestor.enterprise.healthcare_validation'],
    },
  },
];

export function listHostedFeatureDefinitions(): HostedFeatureDefinition[] {
  return FEATURE_CATALOG.map((feature) => ({
    ...feature,
    planIds: [...feature.planIds],
    stripeLookupKeysByPlan: Object.fromEntries(
      Object.entries(feature.stripeLookupKeysByPlan).map(([planId, keys]) => [planId, [...keys]]),
    ) as HostedFeatureDefinition['stripeLookupKeysByPlan'],
  }));
}

export function featureLookupKeysForPlan(
  definition: HostedFeatureDefinition,
  planId: string | null | undefined,
): string[] {
  const resolvedPlanId = planId?.trim() as HostedPlanId | undefined;
  if (resolvedPlanId && definition.stripeLookupKeysByPlan[resolvedPlanId]) {
    return [...(definition.stripeLookupKeysByPlan[resolvedPlanId] ?? [])];
  }
  return [...new Set(Object.values(definition.stripeLookupKeysByPlan).flat())].sort((left, right) => left.localeCompare(right));
}
