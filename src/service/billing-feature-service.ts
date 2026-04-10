import type { HostedBillingEntitlementRecord } from './billing-entitlement-store.js';
import {
  featureLookupKeysForPlan,
  listHostedFeatureDefinitions,
  type HostedFeatureDefinition,
  type HostedFeatureKey,
} from './billing-feature-catalog.js';

export type HostedFeatureGrantSource =
  | 'stripe_entitlement'
  | 'plan_default'
  | 'stripe_not_granted'
  | 'not_in_plan';

export interface HostedFeatureGrantRecord {
  key: HostedFeatureKey;
  displayName: string;
  description: string;
  category: HostedFeatureDefinition['category'];
  granted: boolean;
  available: boolean;
  grantSource: HostedFeatureGrantSource;
  planEligible: boolean;
  stripeManaged: boolean;
  stripeSummaryPresent: boolean;
  configuredLookupKeys: string[];
  matchedLookupKeys: string[];
}

export interface HostedFeatureServiceView {
  accountId: string;
  tenantId: string;
  effectivePlanId: string | null;
  provider: HostedBillingEntitlementRecord['provider'];
  entitlementStatus: HostedBillingEntitlementRecord['status'];
  accessEnabled: boolean;
  stripeSummaryUpdatedAt: string | null;
  features: HostedFeatureGrantRecord[];
  summary: {
    featureCount: number;
    grantedCount: number;
    availableCount: number;
    stripeGrantedCount: number;
    planDefaultCount: number;
    stripeDeniedCount: number;
    notInPlanCount: number;
    stripeSummaryPresent: boolean;
  };
}

function normalizeStringSet(values: string[]): Set<string> {
  return new Set(
    values
      .map((value) => value.trim())
      .filter((value) => value !== ''),
  );
}

function projectFeatureGrant(
  definition: HostedFeatureDefinition,
  entitlement: HostedBillingEntitlementRecord,
  lookupKeys: Set<string>,
  stripeSummaryPresent: boolean,
): HostedFeatureGrantRecord {
  const planId = entitlement.effectivePlanId?.trim() || null;
  const planEligible = planId ? definition.planIds.includes(planId as any) : false;
  const configuredLookupKeys = featureLookupKeysForPlan(definition, planId);
  const matchedLookupKeys = configuredLookupKeys.filter((lookupKey) => lookupKeys.has(lookupKey));

  let granted = false;
  let grantSource: HostedFeatureGrantSource = 'not_in_plan';

  if (matchedLookupKeys.length > 0) {
    granted = true;
    grantSource = 'stripe_entitlement';
  } else if (planEligible && definition.stripeManaged && stripeSummaryPresent) {
    granted = false;
    grantSource = 'stripe_not_granted';
  } else if (planEligible) {
    granted = true;
    grantSource = 'plan_default';
  }

  return {
    key: definition.key,
    displayName: definition.displayName,
    description: definition.description,
    category: definition.category,
    granted,
    available: granted && entitlement.accessEnabled,
    grantSource,
    planEligible,
    stripeManaged: definition.stripeManaged,
    stripeSummaryPresent,
    configuredLookupKeys,
    matchedLookupKeys,
  };
}

export function buildHostedFeatureServiceView(
  entitlement: HostedBillingEntitlementRecord,
): HostedFeatureServiceView {
  const lookupKeys = normalizeStringSet(entitlement.stripeEntitlementLookupKeys);
  const stripeSummaryPresent = Boolean(entitlement.stripeEntitlementSummaryUpdatedAt)
    || lookupKeys.size > 0
    || entitlement.stripeEntitlementFeatureIds.length > 0;
  const features = listHostedFeatureDefinitions().map((definition) => projectFeatureGrant(
    definition,
    entitlement,
    lookupKeys,
    stripeSummaryPresent,
  ));

  return {
    accountId: entitlement.accountId,
    tenantId: entitlement.tenantId,
    effectivePlanId: entitlement.effectivePlanId,
    provider: entitlement.provider,
    entitlementStatus: entitlement.status,
    accessEnabled: entitlement.accessEnabled,
    stripeSummaryUpdatedAt: entitlement.stripeEntitlementSummaryUpdatedAt,
    features,
    summary: {
      featureCount: features.length,
      grantedCount: features.filter((feature) => feature.granted).length,
      availableCount: features.filter((feature) => feature.available).length,
      stripeGrantedCount: features.filter((feature) => feature.grantSource === 'stripe_entitlement').length,
      planDefaultCount: features.filter((feature) => feature.grantSource === 'plan_default').length,
      stripeDeniedCount: features.filter((feature) => feature.grantSource === 'stripe_not_granted').length,
      notInPlanCount: features.filter((feature) => feature.grantSource === 'not_in_plan').length,
      stripeSummaryPresent,
    },
  };
}
