import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { startServer } from '../src/service/api-server.js';
import { buildAccountUserPasskeyCredentialRecord } from '../src/service/account-passkeys.js';
import { resetAccountStoreForTests } from '../src/service/account-store.js';
import { resetAccountSessionStoreForTests } from '../src/service/account-session-store.js';
import { resetAccountUserStoreForTests } from '../src/service/account-user-store.js';
import { resetAccountUserActionTokenStoreForTests } from '../src/service/account-user-token-store.js';
import { resetAdminAuditLogForTests } from '../src/service/admin-audit-log.js';
import { resetAdminIdempotencyStoreForTests } from '../src/service/admin-idempotency-store.js';
import { resetAsyncDeadLetterStoreForTests } from '../src/service/async-dead-letter-store.js';
import { resetBillingEventLedgerForTests } from '../src/service/billing-event-ledger.js';
import { resetHostedBillingEntitlementStoreForTests } from '../src/service/billing-entitlement-store.js';
import {
  findAccountUserByEmailState,
  issueAccountPasskeyChallengeTokenState,
  saveAccountUserRecordState,
} from '../src/service/control-plane-store.js';
import { resetObservabilityForTests } from '../src/service/observability.js';
import { resetStripeWebhookStoreForTests } from '../src/service/stripe-webhook-store.js';
import { resetTenantKeyStoreForTests } from '../src/service/tenant-key-store.js';
import { resetTenantRateLimiterForTests } from '../src/service/rate-limit.js';
import { resetUsageMeter } from '../src/service/usage-meter.js';
import {
  authFixtureCredential,
  authenticationChallenge,
  authenticationResponse,
  registrationChallenge,
  registrationResponse,
  webauthnOrigin,
} from './helpers/passkey-fixtures.js';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
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
      server.close((err) => err ? reject(err) : resolve(port));
    });
  });
}

async function waitForReady(base: string, timeoutMs = 15000): Promise<void> {
  const started = Date.now();
  while ((Date.now() - started) < timeoutMs) {
    try {
      const response = await fetch(`${base}/api/v1/ready`);
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for API readiness at ${base}.`);
}

function cookieHeaderFromResponse(response: Response): string | null {
  const raw = response.headers.get('set-cookie');
  if (!raw) return null;
  const [cookie] = raw.split(';', 1);
  return cookie?.trim() || null;
}

async function main(): Promise<void> {
  const previousEnv = { ...process.env };
  const workspace = mkdtempSync(join(tmpdir(), 'attestor-live-passkeys-'));
  const apiPort = await reservePort();
  const base = `http://127.0.0.1:${apiPort}`;
  let serverHandle: { close: () => void } | null = null;

  try {
    mkdirSync(join(workspace, '.attestor'), { recursive: true });

    process.env.ATTESTOR_TENANT_KEY_STORE_PATH = join(workspace, '.attestor', 'tenant-keys.json');
    process.env.ATTESTOR_USAGE_LEDGER_PATH = join(workspace, '.attestor', 'usage-ledger.json');
    process.env.ATTESTOR_ACCOUNT_STORE_PATH = join(workspace, '.attestor', 'accounts.json');
    process.env.ATTESTOR_ACCOUNT_USER_STORE_PATH = join(workspace, '.attestor', 'account-users.json');
    process.env.ATTESTOR_ACCOUNT_USER_TOKEN_STORE_PATH = join(workspace, '.attestor', 'account-user-tokens.json');
    process.env.ATTESTOR_ACCOUNT_SESSION_STORE_PATH = join(workspace, '.attestor', 'account-sessions.json');
    process.env.ATTESTOR_ADMIN_AUDIT_LOG_PATH = join(workspace, '.attestor', 'admin-audit.json');
    process.env.ATTESTOR_ADMIN_IDEMPOTENCY_STORE_PATH = join(workspace, '.attestor', 'admin-idempotency.json');
    process.env.ATTESTOR_ASYNC_DLQ_STORE_PATH = join(workspace, '.attestor', 'async-dlq.json');
    process.env.ATTESTOR_STRIPE_WEBHOOK_STORE_PATH = join(workspace, '.attestor', 'stripe-webhooks.json');
    process.env.ATTESTOR_BILLING_ENTITLEMENT_STORE_PATH = join(workspace, '.attestor', 'billing-entitlements.json');
    process.env.ATTESTOR_OBSERVABILITY_LOG_PATH = join(workspace, '.attestor', 'observability.jsonl');
    process.env.ATTESTOR_ADMIN_API_KEY = 'admin-passkeys';
    process.env.ATTESTOR_STRIPE_USE_MOCK = 'true';
    process.env.STRIPE_API_KEY = 'sk_test_live_passkeys_mock';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_live_passkeys';
    process.env.ATTESTOR_BILLING_SUCCESS_URL = 'https://attestor.dev/billing/success';
    process.env.ATTESTOR_BILLING_CANCEL_URL = 'https://attestor.dev/billing/cancel';
  process.env.ATTESTOR_BILLING_PORTAL_RETURN_URL = 'https://attestor.dev/settings/billing';
    process.env.ATTESTOR_STRIPE_PRICE_STARTER = 'price_starter_monthly';
    process.env.ATTESTOR_STRIPE_PRICE_PRO = 'price_pro_monthly';
    process.env.ATTESTOR_SESSION_COOKIE_SECURE = 'false';
    process.env.ATTESTOR_EMAIL_DELIVERY_MODE = 'manual';
    process.env.ATTESTOR_CONTROL_PLANE_PG_URL = '';
    process.env.ATTESTOR_BILLING_LEDGER_PG_URL = '';
    process.env.ATTESTOR_WEBAUTHN_RP_ID = 'dev.dontneeda.pw';
    process.env.ATTESTOR_WEBAUTHN_ORIGIN = webauthnOrigin;
    process.env.ATTESTOR_WEBAUTHN_RP_NAME = 'Attestor Test';
    process.env.ATTESTOR_WEBAUTHN_REQUIRE_USER_VERIFICATION = 'false';

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
    resetHostedBillingEntitlementStoreForTests();
    await resetBillingEventLedgerForTests();
    resetObservabilityForTests();

    serverHandle = startServer(apiPort);
    await waitForReady(base);

    console.log('\n[Live Account Passkeys]');

    const createAccountRes = await fetch(`${base}/api/v1/admin/accounts`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer admin-passkeys',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'live-passkeys-account-1',
      },
      body: JSON.stringify({
        accountName: 'Passkey Hosted Co',
        contactEmail: 'ops@passkeys.example',
        tenantId: 'tenant-passkeys',
        tenantName: 'Passkeys Tenant',
        planId: 'starter',
      }),
    });
    ok(createAccountRes.status === 201, 'Admin account create: 201');
    const createAccountBody = await createAccountRes.json() as any;
    const tenantApiKey = createAccountBody.initialKey.apiKey as string;
    ok(tenantApiKey.startsWith('atk_'), 'Admin account create: tenant API key returned');

    const bootstrapRes = await fetch(`${base}/api/v1/account/users/bootstrap`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tenantApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'owner@passkeys.example',
        displayName: 'Passkey Owner',
        password: 'PasskeyOwner123!',
      }),
    });
    ok(bootstrapRes.status === 201, 'Bootstrap: 201');

    const loginRes = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'owner@passkeys.example',
        password: 'PasskeyOwner123!',
      }),
    });
    ok(loginRes.status === 200, 'Password login: 200');
    let sessionCookie = cookieHeaderFromResponse(loginRes);
    ok(Boolean(sessionCookie), 'Password login: session cookie returned');

    const listEmptyRes = await fetch(`${base}/api/v1/account/passkeys`, {
      headers: { Cookie: sessionCookie! },
    });
    ok(listEmptyRes.status === 200, 'Passkey list(empty): 200');
    const listEmptyBody = await listEmptyRes.json() as any;
    ok(listEmptyBody.passkeys.credentialCount === 0, 'Passkey list(empty): count=0');

    const registerOptionsRes = await fetch(`${base}/api/v1/account/passkeys/register/options`, {
      method: 'POST',
      headers: {
        Cookie: sessionCookie!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        password: 'PasskeyOwner123!',
        preferredAuthenticatorType: 'localDevice',
      }),
    });
    ok(registerOptionsRes.status === 200, 'Passkey register options: 200');
    const registerOptionsBody = await registerOptionsRes.json() as any;
    ok(typeof registerOptionsBody.challengeToken === 'string', 'Passkey register options: challenge token returned');
    ok(registerOptionsBody.rp.id === 'dev.dontneeda.pw', 'Passkey register options: RP id pinned');

    const userBeforeRegistration = await findAccountUserByEmailState('owner@passkeys.example');
    ok(Boolean(userBeforeRegistration), 'Passkey register verify: user lookup available');
    const seededRegistrationToken = await issueAccountPasskeyChallengeTokenState({
      purpose: 'passkey_registration',
      accountId: userBeforeRegistration!.accountId,
      accountUserId: userBeforeRegistration!.id,
      email: userBeforeRegistration!.email,
      context: {
        challenge: registrationChallenge,
        rpId: 'dev.dontneeda.pw',
        origin: webauthnOrigin,
        userHandle: 'live-passkey-user-handle',
      },
    });

    const registerVerifyRes = await fetch(`${base}/api/v1/account/passkeys/register/verify`, {
      method: 'POST',
      headers: {
        Cookie: sessionCookie!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        challengeToken: seededRegistrationToken.token,
        response: registrationResponse,
      }),
    });
    ok(registerVerifyRes.status === 200, 'Passkey register verify: 200');
    const registerVerifyBody = await registerVerifyRes.json() as any;
    ok(registerVerifyBody.registered === true, 'Passkey register verify: registered=true');
    ok(registerVerifyBody.passkey.credentialId === registrationResponse.id, 'Passkey register verify: credential stored');
    ok(registerVerifyBody.user.passkeys.credentialCount === 1, 'Passkey register verify: user summary updated');

    const registerReplayRes = await fetch(`${base}/api/v1/account/passkeys/register/verify`, {
      method: 'POST',
      headers: {
        Cookie: sessionCookie!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        challengeToken: seededRegistrationToken.token,
        response: registrationResponse,
      }),
    });
    ok(registerReplayRes.status === 400, 'Passkey register verify replay: rejected');

    const listRegisteredRes = await fetch(`${base}/api/v1/account/passkeys`, {
      headers: { Cookie: sessionCookie! },
    });
    ok(listRegisteredRes.status === 200, 'Passkey list(after registration): 200');
    const listRegisteredBody = await listRegisteredRes.json() as any;
    ok(listRegisteredBody.passkeys.credentialCount === 1, 'Passkey list(after registration): count=1');

    const userForAuthFixture = await findAccountUserByEmailState('owner@passkeys.example');
    ok(Boolean(userForAuthFixture), 'Auth fixture seed: user lookup available');
    const nextUser = structuredClone(userForAuthFixture!);
    nextUser.passkeys.userHandle = nextUser.passkeys.userHandle || 'live-passkey-user-handle';
    nextUser.passkeys.credentials = [
      buildAccountUserPasskeyCredentialRecord({
        credential: {
          id: authFixtureCredential.id,
          publicKey: Buffer.from(authFixtureCredential.publicKey),
          counter: authFixtureCredential.counter,
        },
        transports: ['internal'],
        aaguid: null,
        deviceType: 'singleDevice',
        backedUp: false,
      }),
    ];
    nextUser.passkeys.updatedAt = new Date().toISOString();
    nextUser.updatedAt = nextUser.passkeys.updatedAt;
    await saveAccountUserRecordState(nextUser);

    const authOptionsRes = await fetch(`${base}/api/v1/auth/passkeys/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'owner@passkeys.example',
      }),
    });
    ok(authOptionsRes.status === 200, 'Passkey auth options: 200');
    const authOptionsBody = await authOptionsRes.json() as any;
    ok(authOptionsBody.mode === 'email_lookup', 'Passkey auth options: email_lookup mode');
    ok(authOptionsBody.hintedUser?.email === 'owner@passkeys.example', 'Passkey auth options: hinted user returned');

    const seededAuthenticationToken = await issueAccountPasskeyChallengeTokenState({
      purpose: 'passkey_authentication',
      accountId: nextUser.accountId,
      accountUserId: nextUser.id,
      email: nextUser.email,
      context: {
        challenge: authenticationChallenge,
        rpId: 'dev.dontneeda.pw',
        origin: webauthnOrigin,
      },
    });

    const authVerifyRes = await fetch(`${base}/api/v1/auth/passkeys/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeToken: seededAuthenticationToken.token,
        response: authenticationResponse,
      }),
    });
    ok(authVerifyRes.status === 200, 'Passkey auth verify: 200');
    const authVerifyBody = await authVerifyRes.json() as any;
    ok(authVerifyBody.upstreamAuth?.provider === 'passkey', 'Passkey auth verify: upstream provider=passkey');
    ok(authVerifyBody.upstreamAuth?.credentialId === authenticationResponse.id, 'Passkey auth verify: credential id returned');
    sessionCookie = cookieHeaderFromResponse(authVerifyRes);
    ok(Boolean(sessionCookie), 'Passkey auth verify: session cookie returned');

    const meAfterPasskeyRes = await fetch(`${base}/api/v1/auth/me`, {
      headers: { Cookie: sessionCookie! },
    });
    ok(meAfterPasskeyRes.status === 200, 'Passkey auth verify: me route works with new session');

    const passkeysAfterAuthRes = await fetch(`${base}/api/v1/account/passkeys`, {
      headers: { Cookie: sessionCookie! },
    });
    ok(passkeysAfterAuthRes.status === 200, 'Passkey list(after auth): 200');
    const passkeysAfterAuthBody = await passkeysAfterAuthRes.json() as any;
    const storedPasskeyId = passkeysAfterAuthBody.passkeys.credentials[0]?.id as string | undefined;
    ok(Boolean(storedPasskeyId), 'Passkey list(after auth): stored passkey id visible');
    ok(passkeysAfterAuthBody.passkeys.credentials[0]?.lastUsedAt !== null, 'Passkey list(after auth): lastUsedAt updated');

    const deleteRes = await fetch(`${base}/api/v1/account/passkeys/${storedPasskeyId}/delete`, {
      method: 'POST',
      headers: {
        Cookie: sessionCookie!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        password: 'PasskeyOwner123!',
      }),
    });
    ok(deleteRes.status === 200, 'Passkey delete: 200');
    const deleteBody = await deleteRes.json() as any;
    ok(deleteBody.deleted === true, 'Passkey delete: deleted=true');

    const listDeletedRes = await fetch(`${base}/api/v1/account/passkeys`, {
      headers: { Cookie: sessionCookie! },
    });
    ok(listDeletedRes.status === 200, 'Passkey list(after delete): 200');
    const listDeletedBody = await listDeletedRes.json() as any;
    ok(listDeletedBody.passkeys.credentialCount === 0, 'Passkey list(after delete): count=0');

    const authOptionsAfterDeleteRes = await fetch(`${base}/api/v1/auth/passkeys/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'owner@passkeys.example',
      }),
    });
    ok(authOptionsAfterDeleteRes.status === 409, 'Passkey auth options(after delete): 409');

    console.log(`  ${passed} passed, 0 failed`);
  } finally {
    if (serverHandle) serverHandle.close();
    Object.keys(process.env).forEach((key) => {
      if (!(key in previousEnv)) delete process.env[key];
    });
    Object.assign(process.env, previousEnv);
    rmSync(workspace, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nLive account passkey tests failed.');
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
