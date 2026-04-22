import {
  STRIPE_SUPPORTED_WEBHOOK_EVENTS,
  STRIPE_WEBHOOK_ROUTE,
} from './stripe-webhook-events.js';

export const HOSTED_JOURNEY_CONTRACT_VERSION =
  'attestor.hosted-journey-contract.v1';

export const HOSTED_JOURNEY_PRODUCT_MODEL =
  'one_attestor_product_one_platform_core';

export type HostedJourneyAudience = 'customer' | 'operator' | 'stripe';

export type HostedJourneyAuthBoundary =
  | 'none'
  | 'account_session'
  | 'tenant_api_key'
  | 'account_session_or_tenant_api_key'
  | 'stripe_signature';

export type HostedJourneyRouteOwner =
  | 'account_routes'
  | 'pipeline_execution_routes'
  | 'pipeline_verification_routes'
  | 'stripe_webhook_routes';

export interface HostedJourneyRouteContract {
  key: string;
  method: 'GET' | 'POST';
  path: string;
  owner: HostedJourneyRouteOwner;
  authBoundary: HostedJourneyAuthBoundary;
  requestContract: string;
  responseContract: string;
  requiredHeaders: readonly string[];
  successSignals: readonly string[];
  failureSignals: readonly string[];
}

export interface HostedJourneyStepContract {
  id: string;
  title: string;
  audience: HostedJourneyAudience;
  intent: string;
  routeKeys: readonly string[];
  successSignals: readonly string[];
  failureSignals: readonly string[];
}

export const HOSTED_JOURNEY_TRUTH_SOURCES = {
  productPositioning: 'README.md',
  pricingPackaging: 'docs/01-overview/product-packaging.md',
  customerNarrative: 'docs/01-overview/hosted-customer-journey.md',
  firstApiCallQuickstart: 'docs/01-overview/hosted-first-api-call.md',
  firstIntegrationExamples: 'docs/01-overview/finance-and-crypto-first-integrations.md',
  accountVisibilityGuide: 'docs/01-overview/hosted-account-visibility.md',
  customerContract: 'docs/01-overview/hosted-journey-contract.md',
  operatorStripe: 'docs/01-overview/stripe-commercial-bootstrap.md',
  architectureTracker: 'docs/02-architecture/hosted-product-flow-buildout.md',
} as const;

export const HOSTED_JOURNEY_ROUTE_CONTRACTS = [
  {
    key: 'signup',
    method: 'POST',
    path: '/api/v1/auth/signup',
    owner: 'account_routes',
    authBoundary: 'none',
    requestContract: 'AuthSignupRequest',
    responseContract: 'AuthSignupResponse',
    requiredHeaders: ['Content-Type: application/json'],
    successSignals: [
      '201 Created',
      'account_session cookie issued',
      'initialKey.apiKey returned once',
      'commercial.currentPhase is evaluation',
      'commercial.firstHostedPlanId is starter',
    ],
    failureSignals: [
      '400 for missing or invalid signup input',
      '409 for account/user state conflicts',
    ],
  },
  {
    key: 'account_summary',
    method: 'GET',
    path: '/api/v1/account',
    owner: 'account_routes',
    authBoundary: 'account_session_or_tenant_api_key',
    requestContract: 'AccountSummaryRequest',
    responseContract: 'AccountSummaryResponse',
    requiredHeaders: ['Cookie or Authorization: Bearer <tenant_api_key>'],
    successSignals: [
      'account returned',
      'entitlement returned',
      'tenantContext returned',
      'usage returned',
      'rateLimit returned',
    ],
    failureSignals: [
      '401 when hosted account context cannot be resolved',
      '403 when account lifecycle state blocks access',
    ],
  },
  {
    key: 'usage',
    method: 'GET',
    path: '/api/v1/account/usage',
    owner: 'account_routes',
    authBoundary: 'account_session_or_tenant_api_key',
    requestContract: 'AccountUsageRequest',
    responseContract: 'AccountUsageResponse',
    requiredHeaders: ['Cookie or Authorization: Bearer <tenant_api_key>'],
    successSignals: [
      'tenantContext returned',
      'usage.quota returned',
      'usage.remaining returned',
      'rateLimit returned',
    ],
    failureSignals: [
      '401 when tenant context cannot be resolved for hosted use',
      '429 when downstream consequence calls exceed quota or rate limits',
    ],
  },
  {
    key: 'entitlement',
    method: 'GET',
    path: '/api/v1/account/entitlement',
    owner: 'account_routes',
    authBoundary: 'account_session_or_tenant_api_key',
    requestContract: 'AccountEntitlementRequest',
    responseContract: 'AccountEntitlementResponse',
    requiredHeaders: ['Cookie or Authorization: Bearer <tenant_api_key>'],
    successSignals: [
      'entitlement.status returned',
      'entitlement.accessEnabled returned',
      'entitlement.effectivePlanId returned',
    ],
    failureSignals: [
      '401 when hosted account context cannot be resolved',
      '403 when account lifecycle state blocks access',
    ],
  },
  {
    key: 'features',
    method: 'GET',
    path: '/api/v1/account/features',
    owner: 'account_routes',
    authBoundary: 'account_session_or_tenant_api_key',
    requestContract: 'account/tenant context',
    responseContract: 'AccountFeaturesResponse',
    requiredHeaders: ['Cookie or Authorization: Bearer <tenant_api_key>'],
    successSignals: [
      'features returned',
      'summary returned',
      'stripeSummaryPresent returned',
    ],
    failureSignals: [
      '401 when hosted account context cannot be resolved',
      '403 when account lifecycle state blocks access',
    ],
  },
  {
    key: 'first_consequence_call',
    method: 'POST',
    path: '/api/v1/pipeline/run',
    owner: 'pipeline_execution_routes',
    authBoundary: 'tenant_api_key',
    requestContract: 'PipelineRunRequest',
    responseContract: 'PipelineRunResponse',
    requiredHeaders: [
      'Content-Type: application/json',
      'Authorization: Bearer <tenant_api_key>',
    ],
    successSignals: [
      '200 OK',
      'decision returned',
      'proofMode returned',
      'tenantContext returned',
      'usage consumed on allowed run',
    ],
    failureSignals: [
      '400 when candidateSql or intent is missing',
      '429 when quota or rate limit blocks the run',
    ],
  },
  {
    key: 'verify_proof',
    method: 'POST',
    path: '/api/v1/verify',
    owner: 'pipeline_verification_routes',
    authBoundary: 'tenant_api_key',
    requestContract: 'VerifyRequest',
    responseContract: 'VerifyResponse',
    requiredHeaders: [
      'Content-Type: application/json',
      'Authorization: Bearer <tenant_api_key>',
    ],
    successSignals: [
      '200 OK',
      'overall returned',
      'signatureValid returned',
      'trustBinding returned',
    ],
    failureSignals: [
      '400 when certificate or publicKeyPem is missing',
      '422 when PKI trust chain material is required but missing',
    ],
  },
  {
    key: 'checkout',
    method: 'POST',
    path: '/api/v1/account/billing/checkout',
    owner: 'account_routes',
    authBoundary: 'account_session',
    requestContract: 'AccountBillingCheckoutRequest',
    responseContract: 'AccountBillingCheckoutResponse',
    requiredHeaders: [
      'Content-Type: application/json',
      'Cookie: account session',
      'Idempotency-Key',
    ],
    successSignals: [
      '200 OK',
      'checkoutSessionId returned',
      'checkoutUrl returned',
      'planId returned',
      'trialDays returned',
    ],
    failureSignals: [
      '400 when Idempotency-Key is missing',
      '400 when planId is missing or not a hosted paid plan',
      '401 or 403 when account_admin or billing_admin session is missing',
    ],
  },
  {
    key: 'billing_portal',
    method: 'POST',
    path: '/api/v1/account/billing/portal',
    owner: 'account_routes',
    authBoundary: 'account_session',
    requestContract: 'AccountBillingPortalRequest',
    responseContract: 'AccountBillingPortalResponse',
    requiredHeaders: ['Cookie: account session'],
    successSignals: [
      '200 OK',
      'portalSessionId returned',
      'portalUrl returned',
    ],
    failureSignals: [
      '401 or 403 when account_admin or billing_admin session is missing',
      '409 when billing state is not ready for portal creation',
    ],
  },
  {
    key: 'billing_export',
    method: 'GET',
    path: '/api/v1/account/billing/export',
    owner: 'account_routes',
    authBoundary: 'account_session_or_tenant_api_key',
    requestContract: 'format=json|csv, optional limit',
    responseContract: 'AccountBillingExportResponse or CSV export',
    requiredHeaders: ['Cookie or Authorization: Bearer <tenant_api_key>'],
    successSignals: [
      'checkout returned',
      'invoices returned',
      'charges returned',
      'summary.dataSource returned',
    ],
    failureSignals: [
      "400 when format is not 'json' or 'csv'",
      '400 when limit is not a positive integer',
      '404 when hosted account is not found for the resolved tenant context',
    ],
  },
  {
    key: 'billing_reconciliation',
    method: 'GET',
    path: '/api/v1/account/billing/reconciliation',
    owner: 'account_routes',
    authBoundary: 'account_session',
    requestContract: 'optional limit',
    responseContract: 'AccountBillingReconciliationResponse',
    requiredHeaders: ['Cookie: account session'],
    successSignals: [
      'reconciliation returned',
      'entitlement returned',
      'summary.status returned',
    ],
    failureSignals: [
      '400 when limit is not a positive integer',
      '401 or 403 when account, billing, or read_only session is missing',
      '404 when hosted account is not found for the resolved tenant context',
    ],
  },
  {
    key: 'api_key_lifecycle',
    method: 'GET',
    path: '/api/v1/account/api-keys',
    owner: 'account_routes',
    authBoundary: 'account_session',
    requestContract: 'AccountApiKeysListRequest',
    responseContract: 'AccountApiKeysListResponse',
    requiredHeaders: ['Cookie: account session'],
    successSignals: [
      'keys returned without plaintext secret material',
      'defaults returned',
    ],
    failureSignals: [
      '401 or 403 when account_admin session is missing',
    ],
  },
  {
    key: 'issue_api_key',
    method: 'POST',
    path: '/api/v1/account/api-keys',
    owner: 'account_routes',
    authBoundary: 'account_session',
    requestContract: 'AccountIssueApiKeyRequest',
    responseContract: 'AccountIssueApiKeyResponse',
    requiredHeaders: ['Cookie: account session'],
    successSignals: [
      '201 Created',
      'new key returned with plaintext apiKey once',
    ],
    failureSignals: [
      '401 or 403 when account_admin session is missing',
      '409 when active key limit is reached',
    ],
  },
  {
    key: 'stripe_webhook',
    method: 'POST',
    path: STRIPE_WEBHOOK_ROUTE,
    owner: 'stripe_webhook_routes',
    authBoundary: 'stripe_signature',
    requestContract: 'RawStripeWebhookEvent',
    responseContract: 'StripeWebhookBillingProcessorResult',
    requiredHeaders: ['Stripe-Signature'],
    successSignals: [
      '200 OK for applied or ignored supported event',
      '200 OK with x-attestor-stripe-replay for duplicate event',
      'entitlement state converges after supported billing events',
    ],
    failureSignals: [
      '400 when Stripe-Signature is missing or invalid',
      '409 when event id is reused with a different payload hash',
      '503 when STRIPE_WEBHOOK_SECRET is not configured',
    ],
  },
] as const satisfies readonly HostedJourneyRouteContract[];

export const HOSTED_JOURNEY_STEP_CONTRACTS = [
  {
    id: 'create-hosted-account',
    title: 'Create the hosted account',
    audience: 'customer',
    intent: 'Start on the free community evaluation path and receive the first tenant API key.',
    routeKeys: ['signup'],
    successSignals: [
      'first account user has account_admin authority',
      'session cookie is issued for account-plane work',
      'initial tenant API key can call hosted API routes',
    ],
    failureSignals: [
      'signup input is incomplete',
      'account or user state conflicts',
    ],
  },
  {
    id: 'inspect-evaluation-state',
    title: 'Inspect account, usage, and entitlement state',
    audience: 'customer',
    intent: 'Confirm the account plane can show current plan, entitlement, usage, and rate limit before real use.',
    routeKeys: ['account_summary', 'usage', 'entitlement', 'features'],
    successSignals: [
      'community plan is visible during evaluation',
      'included hosted run quota is visible',
      'entitlement state is visible',
      'feature grants are visible',
    ],
    failureSignals: [
      'tenant or account context is not resolvable',
      'account lifecycle state blocks access',
    ],
  },
  {
    id: 'make-first-attestor-call',
    title: 'Call Attestor before consequence',
    audience: 'customer',
    intent: 'Use the first API key to call Attestor before a downstream system writes, sends, files, or executes.',
    routeKeys: ['first_consequence_call', 'verify_proof'],
    successSignals: [
      'decision is returned before downstream consequence',
      'proof material can be verified',
      'usage is consumed only for governed execution',
    ],
    failureSignals: [
      'bad request shape',
      'quota exhausted',
      'rate limit exceeded',
      'required proof material missing',
    ],
  },
  {
    id: 'upgrade-through-checkout',
    title: 'Upgrade through Stripe Checkout',
    audience: 'customer',
    intent: 'Move from evaluation to a paid hosted plan without changing the account-plane identity.',
    routeKeys: ['checkout'],
    successSignals: [
      'checkoutUrl sends the customer to Stripe-hosted checkout',
      'idempotent retries do not create a conflicting checkout request',
    ],
    failureSignals: [
      'missing Idempotency-Key',
      'unsupported plan',
      'missing account_admin or billing_admin authority',
    ],
  },
  {
    id: 'converge-billing-state',
    title: 'Converge billing and entitlement state',
    audience: 'stripe',
    intent: 'Use signed Stripe webhooks to converge checkout, subscription, invoice, charge, and entitlement changes into Attestor account state.',
    routeKeys: ['stripe_webhook', 'entitlement', 'account_summary'],
    successSignals: [
      'supported Stripe event is applied or ignored deterministically',
      'duplicate event replay is accepted without reapplying side effects',
      'entitlement access reflects subscription and entitlement state',
    ],
    failureSignals: [
      'missing or invalid Stripe signature',
      'payload hash conflict',
      'webhook secret missing',
    ],
  },
  {
    id: 'operate-account-plane',
    title: 'Operate keys and billing from the same account plane',
    audience: 'customer',
    intent: 'Keep usage, billing, entitlement, and API key management attached to the same hosted account.',
    routeKeys: [
      'billing_portal',
      'billing_export',
      'billing_reconciliation',
      'api_key_lifecycle',
      'issue_api_key',
      'usage',
      'features',
      'entitlement',
    ],
    successSignals: [
      'billing portal session is created for a Stripe-backed account',
      'billing export and reconciliation views stay attached to the same account plane',
      'API key list never exposes historical plaintext secrets',
      'newly issued API keys return plaintext only at issue or rotate time',
    ],
    failureSignals: [
      'missing account role',
      'billing state not ready',
      'billing export input is invalid',
      'active API key limit reached',
    ],
  },
] as const satisfies readonly HostedJourneyStepContract[];

export function hostedJourneyContract() {
  return {
    version: HOSTED_JOURNEY_CONTRACT_VERSION,
    productModel: HOSTED_JOURNEY_PRODUCT_MODEL,
    defaultEvaluationPlanId: 'community',
    firstPaidHostedPlanId: 'starter',
    consequenceBoundary:
      'customer systems call Attestor before the downstream system writes, sends, files, or executes',
    packSelection:
      'Attestor does not auto-detect packs; callers choose the relevant hosted path for the consequence they need to control',
    billingConvergence:
      'checkout starts the paid hosted path, while signed Stripe webhooks converge account entitlement state',
    truthSources: HOSTED_JOURNEY_TRUTH_SOURCES,
    routeContracts: HOSTED_JOURNEY_ROUTE_CONTRACTS,
    steps: HOSTED_JOURNEY_STEP_CONTRACTS,
    supportedStripeWebhookEvents: [...STRIPE_SUPPORTED_WEBHOOK_EVENTS],
  } as const;
}
