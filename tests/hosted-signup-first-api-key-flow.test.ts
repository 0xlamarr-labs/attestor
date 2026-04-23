import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/service/api-server.js';
import {
  COUNTERPARTY_FIXTURE,
  COUNTERPARTY_INTENT,
  COUNTERPARTY_REPORT,
  COUNTERPARTY_REPORT_CONTRACT,
  COUNTERPARTY_SQL,
} from '../src/financial/fixtures/scenarios.js';
import {
  createConsequenceAdmissionFacadeResponse,
  evaluateConsequenceAdmissionGate,
  type FinancePipelineAdmissionRun,
} from '../src/consequence-admission/index.js';
import { resetAccountSessionStoreForTests } from '../src/service/account-session-store.js';
import { resetAccountStoreForTests } from '../src/service/account-store.js';
import { resetAccountUserStoreForTests } from '../src/service/account-user-store.js';
import { resetAccountUserActionTokenStoreForTests } from '../src/service/account-user-token-store.js';
import { resetAdminAuditLogForTests } from '../src/service/admin-audit-log.js';
import { resetAdminIdempotencyStoreForTests } from '../src/service/admin-idempotency-store.js';
import { resetAsyncDeadLetterStoreForTests } from '../src/service/async-dead-letter-store.js';
import { resetBillingEventLedgerForTests } from '../src/service/billing-event-ledger.js';
import { resetHostedBillingEntitlementStoreForTests } from '../src/service/billing-entitlement-store.js';
import { resetHostedEmailDeliveryEventStoreForTests } from '../src/service/email-delivery-event-store.js';
import { resetObservabilityForTests } from '../src/service/observability.js';
import { resetTenantRateLimiterForTests } from '../src/service/rate-limit.js';
import { resetStripeWebhookStoreForTests } from '../src/service/stripe-webhook-store.js';
import { resetTenantKeyStoreForTests } from '../src/service/tenant-key-store.js';
import { shutdownTenantRuntimeBackends } from '../src/service/runtime/tenant-runtime.js';
import { consumePipelineRun, resetUsageMeter } from '../src/service/usage-meter.js';

let passed = 0;

interface TestServerHandle {
  close(): void;
}

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a TCP port.'));
        return;
      }
      const { port } = address;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
  passed += 1;
}

function cookieHeaderFromResponse(res: Response): string | null {
  const raw = res.headers.get('set-cookie');
  if (!raw) return null;
  const [cookiePair] = raw.split(';', 1);
  return cookiePair?.trim() || null;
}

async function readJson(res: Response): Promise<any> {
  return res.json() as Promise<any>;
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function pipelineBody() {
  return {
    candidateSql: COUNTERPARTY_SQL,
    intent: COUNTERPARTY_INTENT,
    fixtures: [COUNTERPARTY_FIXTURE],
    generatedReport: COUNTERPARTY_REPORT,
    reportContract: COUNTERPARTY_REPORT_CONTRACT,
    sign: false,
  };
}

async function runPipeline(baseUrl: string, apiKey: string): Promise<Response> {
  return postJson(`${baseUrl}/api/v1/pipeline/run`, pipelineBody(), {
    Authorization: `Bearer ${apiKey}`,
  });
}

function configureIsolatedStores(root: string): void {
  delete process.env.ATTESTOR_TENANT_KEYS;
  delete process.env.ATTESTOR_BILLING_LEDGER_PG_URL;
  delete process.env.ATTESTOR_RATE_LIMIT_COMMUNITY_REQUESTS;
  delete process.env.ATTESTOR_RATE_LIMIT_STARTER_REQUESTS;
  delete process.env.ATTESTOR_RATE_LIMIT_PRO_REQUESTS;
  delete process.env.ATTESTOR_RATE_LIMIT_ENTERPRISE_REQUESTS;
  delete process.env.ATTESTOR_ASYNC_QUEUE_REDIS_URL;
  delete process.env.ATTESTOR_ASYNC_DISPATCH_REDIS_URL;

  process.env.ATTESTOR_TENANT_KEY_STORE_PATH = join(root, 'tenant-keys.json');
  process.env.ATTESTOR_USAGE_LEDGER_PATH = join(root, 'usage-ledger.json');
  process.env.ATTESTOR_ACCOUNT_STORE_PATH = join(root, 'accounts.json');
  process.env.ATTESTOR_ACCOUNT_USER_STORE_PATH = join(root, 'account-users.json');
  process.env.ATTESTOR_ACCOUNT_USER_TOKEN_STORE_PATH = join(root, 'account-user-tokens.json');
  process.env.ATTESTOR_ACCOUNT_SESSION_STORE_PATH = join(root, 'account-sessions.json');
  process.env.ATTESTOR_ACCOUNT_MFA_ENCRYPTION_KEY = 'hosted-signup-first-key-mfa-secret';
  process.env.ATTESTOR_ADMIN_AUDIT_LOG_PATH = join(root, 'admin-audit.json');
  process.env.ATTESTOR_ADMIN_IDEMPOTENCY_STORE_PATH = join(root, 'admin-idempotency.json');
  process.env.ATTESTOR_ASYNC_DLQ_STORE_PATH = join(root, 'async-dlq.json');
  process.env.ATTESTOR_STRIPE_WEBHOOK_STORE_PATH = join(root, 'stripe-webhooks.json');
  process.env.ATTESTOR_BILLING_ENTITLEMENT_STORE_PATH = join(root, 'billing-entitlements.json');
  process.env.ATTESTOR_EMAIL_DELIVERY_EVENTS_PATH = join(root, 'email-delivery-events.json');
  process.env.ATTESTOR_OBSERVABILITY_LOG_PATH = join(root, 'observability.jsonl');
  process.env.ATTESTOR_SESSION_COOKIE_SECURE = 'false';
  process.env.ATTESTOR_ADMIN_API_KEY = 'hosted-signup-first-key-admin';
  process.env.ATTESTOR_METRICS_API_KEY = 'hosted-signup-first-key-metrics';
  process.env.ATTESTOR_TENANT_KEY_MAX_ACTIVE_PER_TENANT = '2';
  process.env.ATTESTOR_STRIPE_USE_MOCK = 'true';
  process.env.STRIPE_API_KEY = 'sk_test_hosted_signup_first_key';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_hosted_signup_first_key';
  process.env.ATTESTOR_BILLING_SUCCESS_URL = 'https://attestor.dev/billing/success';
  process.env.ATTESTOR_BILLING_CANCEL_URL = 'https://attestor.dev/billing/cancel';
  process.env.ATTESTOR_BILLING_PORTAL_RETURN_URL = 'https://attestor.dev/settings/billing';
  process.env.ATTESTOR_STRIPE_PRICE_STARTER = 'price_starter_monthly';
  process.env.ATTESTOR_STRIPE_PRICE_PRO = 'price_pro_monthly';
  process.env.ATTESTOR_STRIPE_PRICE_ENTERPRISE = 'price_enterprise_monthly';
}

async function resetStores(): Promise<void> {
  resetTenantKeyStoreForTests();
  resetUsageMeter();
  await resetTenantRateLimiterForTests();
  resetAccountStoreForTests();
  resetAccountUserStoreForTests();
  resetAccountUserActionTokenStoreForTests();
  resetAccountSessionStoreForTests();
  resetAdminAuditLogForTests();
  resetAdminIdempotencyStoreForTests();
  resetAsyncDeadLetterStoreForTests();
  resetStripeWebhookStoreForTests();
  await resetBillingEventLedgerForTests();
  resetHostedBillingEntitlementStoreForTests();
  resetHostedEmailDeliveryEventStoreForTests();
  resetObservabilityForTests();
}

async function main(): Promise<void> {
  const tempRoot = mkdtempSync(join(tmpdir(), 'attestor-hosted-signup-'));
  let serverHandle: TestServerHandle | null = null;

  try {
    configureIsolatedStores(tempRoot);
    await resetStores();

    const port = await reservePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    serverHandle = startServer(port);
    await new Promise((resolve) => setTimeout(resolve, 250));

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signupRes = await postJson(`${baseUrl}/api/v1/auth/signup`, {
      accountName: `Hosted Evaluation ${suffix}`,
      email: `owner-${suffix}@example.test`,
      displayName: 'Hosted Evaluation Owner',
      password: 'HostedSignupPass123!',
    });
    equal(signupRes.status, 201, 'Hosted signup: account is created');
    const signupCookie = cookieHeaderFromResponse(signupRes);
    ok(Boolean(signupCookie), 'Hosted signup: account session cookie is issued');

    const signupBody = await readJson(signupRes);
    equal(signupBody.signup, true, 'Hosted signup: response identifies signup flow');
    equal(signupBody.user.role, 'account_admin', 'Hosted signup: first user is account_admin');
    equal(signupBody.initialKey.planId, 'community', 'Hosted signup: first API key starts on community');
    equal(signupBody.initialKey.monthlyRunQuota, 10, 'Hosted signup: first API key has community quota');
    equal(signupBody.commercial.currentPhase, 'evaluation', 'Hosted signup: commercial phase starts as evaluation');
    equal(signupBody.commercial.includedMonthlyRunQuota, 10, 'Hosted signup: evaluation quota is visible');
    equal(signupBody.commercial.firstHostedPlanId, 'starter', 'Hosted signup: first paid hosted plan is starter');
    equal(signupBody.commercial.firstHostedPlanTrialDays, 14, 'Hosted signup: starter trial posture is visible');
    ok(
      typeof signupBody.initialKey.apiKey === 'string' && signupBody.initialKey.apiKey.startsWith('atk_'),
      'Hosted signup: plaintext initial API key is returned once',
    );
    equal(
      Object.prototype.hasOwnProperty.call(signupBody.initialKey, 'apiKeyHash'),
      false,
      'Hosted signup: API key hash is not exposed in the customer response',
    );

    const initialApiKey = signupBody.initialKey.apiKey as string;
    const initialKeyId = signupBody.initialKey.id as string;
    const tenantId = signupBody.account.primaryTenantId as string;

    const anonymousUsageRes = await fetch(`${baseUrl}/api/v1/account/usage`);
    equal(anonymousUsageRes.status, 401, 'Hosted auth: active hosted key makes tenant auth mandatory');

    const usageRes = await fetch(`${baseUrl}/api/v1/account/usage`, {
      headers: { Authorization: `Bearer ${initialApiKey}` },
    });
    equal(usageRes.status, 200, 'Hosted usage: first API key authenticates with bearer auth');
    const usageBody = await readJson(usageRes);
    equal(usageBody.tenantContext.tenantId, tenantId, 'Hosted usage: tenant context matches signup account');
    equal(usageBody.tenantContext.source, 'api_key', 'Hosted usage: tenant source is API key');
    equal(usageBody.tenantContext.planId, 'community', 'Hosted usage: community plan is visible');
    equal(usageBody.usage.used, 0, 'Hosted usage: usage starts at zero');
    equal(usageBody.usage.quota, 10, 'Hosted usage: community quota is visible');
    equal(usageBody.usage.remaining, 10, 'Hosted usage: remaining quota starts at ten');
    equal(usageBody.usage.enforced, true, 'Hosted usage: community quota is enforced');

    const accountRes = await fetch(`${baseUrl}/api/v1/account`, {
      headers: { Authorization: `Bearer ${initialApiKey}` },
    });
    equal(accountRes.status, 200, 'Hosted account: API key can inspect account summary');
    const accountBody = await readJson(accountRes);
    equal(accountBody.account.id, signupBody.account.id, 'Hosted account: account id matches signup');
    equal(accountBody.entitlement.status, 'provisioned', 'Hosted account: initial entitlement is provisioned');
    equal(accountBody.entitlement.accessEnabled, true, 'Hosted account: initial entitlement allows access');
    equal(accountBody.entitlement.effectivePlanId, 'community', 'Hosted account: entitlement reflects community plan');

    const firstRunRes = await runPipeline(baseUrl, initialApiKey);
    equal(firstRunRes.status, 200, 'Hosted consequence call: first API key can call Attestor');
    const firstRunBody = await readJson(firstRunRes);
    equal(firstRunBody.decision, 'pass', 'Hosted consequence call: decision is returned before consequence');
    equal(firstRunBody.tenantContext.tenantId, tenantId, 'Hosted consequence call: tenant context is preserved');
    equal(firstRunBody.usage.used, 1, 'Hosted consequence call: allowed run consumes usage');
    equal(firstRunBody.usage.remaining, 9, 'Hosted consequence call: remaining quota decrements');

    const admission = createConsequenceAdmissionFacadeResponse({
      surface: 'finance-pipeline-run',
      run: firstRunBody as FinancePipelineAdmissionRun,
      decidedAt: '2026-04-23T19:00:00.000Z',
      requestInput: {
        actorRef: 'actor:hosted-first-api-key-flow',
        authorityMode: 'tenant-api-key',
        summary: 'Hosted first API key asks whether the reporting consequence may proceed.',
      },
    });
    equal(admission.decision, 'admit', 'Hosted consequence call: finance pass maps to canonical admit');
    equal(admission.request.entryPoint.route, '/api/v1/pipeline/run', 'Hosted consequence call: canonical admission preserves hosted route');
    const gate = evaluateConsequenceAdmissionGate({
      admission,
      downstreamAction: 'customer_reporting_store.write',
      requireProof: false,
    });
    equal(gate.outcome, 'proceed', 'Hosted consequence call: customer gate proceeds after admitted response');
    equal(gate.downstreamAction, 'customer_reporting_store.write', 'Hosted consequence call: customer gate preserves downstream action label');
    equal(gate.failClosed, false, 'Hosted consequence call: admitted customer gate is not fail closed');
    ok(
      gate.reasonCodes.includes('customer-gate-proceed'),
      'Hosted consequence call: customer gate records proceed reason',
    );

    for (let usageSeed = 2; usageSeed <= 10; usageSeed += 1) {
      const seededUsage = consumePipelineRun(tenantId, 'community', 10);
      equal(
        seededUsage.used,
        usageSeed,
        `Hosted quota: ledger seed reaches community usage ${usageSeed}`,
      );
    }

    const quotaExceededRes = await runPipeline(baseUrl, initialApiKey);
    equal(quotaExceededRes.status, 429, 'Hosted quota: community run 11 is blocked');
    const quotaExceededBody = await readJson(quotaExceededRes);
    equal(
      quotaExceededBody.error,
      'Monthly pipeline run quota exceeded for this tenant plan.',
      'Hosted quota: rejection reason is explicit',
    );
    equal(quotaExceededBody.usage.used, 10, 'Hosted quota: rejected run does not increment usage');
    equal(quotaExceededBody.usage.remaining, 0, 'Hosted quota: rejected run reports exhausted quota');

    const keysRes = await fetch(`${baseUrl}/api/v1/account/api-keys`, {
      headers: { Cookie: signupCookie! },
    });
    equal(keysRes.status, 200, 'Hosted API keys: account admin session can list keys');
    const keysBody = await readJson(keysRes);
    equal(keysBody.keys.length, 1, 'Hosted API keys: initial key is listed');
    equal(keysBody.keys[0].id, initialKeyId, 'Hosted API keys: listed key id matches signup key');
    equal(keysBody.keys[0].status, 'active', 'Hosted API keys: initial key is active');
    equal(
      Object.prototype.hasOwnProperty.call(keysBody.keys[0], 'apiKey'),
      false,
      'Hosted API keys: historical plaintext secret is not listed',
    );
    equal(keysBody.defaults.maxActiveKeysPerTenant, 2, 'Hosted API keys: active key limit is visible');

    const issueKeyRes = await fetch(`${baseUrl}/api/v1/account/api-keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: signupCookie!,
      },
    });
    equal(issueKeyRes.status, 201, 'Hosted API keys: account admin can issue a second key');
    const issueKeyBody = await readJson(issueKeyRes);
    ok(
      typeof issueKeyBody.key.apiKey === 'string' && issueKeyBody.key.apiKey.startsWith('atk_'),
      'Hosted API keys: newly issued plaintext key is returned once',
    );
    equal(issueKeyBody.key.planId, 'community', 'Hosted API keys: issued key inherits community plan');

    const secondApiKey = issueKeyBody.key.apiKey as string;
    const secondKeyUsageRes = await fetch(`${baseUrl}/api/v1/account/usage`, {
      headers: { Authorization: `Bearer ${secondApiKey}` },
    });
    equal(secondKeyUsageRes.status, 200, 'Hosted API keys: newly issued key authenticates');
    const secondKeyUsageBody = await readJson(secondKeyUsageRes);
    equal(secondKeyUsageBody.usage.used, 10, 'Hosted API keys: usage stays tenant-scoped across keys');

    const revokeInitialKeyRes = await fetch(`${baseUrl}/api/v1/account/api-keys/${initialKeyId}/revoke`, {
      method: 'POST',
      headers: { Cookie: signupCookie! },
    });
    equal(revokeInitialKeyRes.status, 200, 'Hosted API keys: account admin can revoke the signup key');
    const revokeInitialKeyBody = await readJson(revokeInitialKeyRes);
    equal(revokeInitialKeyBody.key.status, 'revoked', 'Hosted API keys: revoked key state is returned');

    const revokedUsageRes = await fetch(`${baseUrl}/api/v1/account/usage`, {
      headers: { Authorization: `Bearer ${initialApiKey}` },
    });
    equal(revokedUsageRes.status, 401, 'Hosted API keys: revoked signup key is rejected');

    const replacementUsageRes = await fetch(`${baseUrl}/api/v1/account/usage`, {
      headers: { Authorization: `Bearer ${secondApiKey}` },
    });
    equal(replacementUsageRes.status, 200, 'Hosted API keys: replacement key remains accepted');

    ok(passed > 0, 'Hosted signup-to-first-API-key flow: tests executed');
    console.log(`\nHosted signup-to-first-API-key flow tests: ${passed} passed, 0 failed`);
  } finally {
    serverHandle?.close();
    await shutdownTenantRuntimeBackends();
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('\nHosted signup-to-first-API-key flow tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
