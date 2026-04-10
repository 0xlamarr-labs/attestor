import { strict as assert } from 'node:assert';
import { createHash, randomBytes } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { tmpdir } from 'node:os';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
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

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function codeChallengeS256(verifier: string): string {
  return createHash('sha256')
    .update(verifier, 'utf8')
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function cookieHeaderFromResponse(response: Response): string | null {
  const raw = response.headers.get('set-cookie');
  return raw ? raw.split(';', 1)[0] : null;
}

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

const tsxCli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');

async function waitForReady(port: number, timeoutMs = 15000): Promise<void> {
  const started = Date.now();
  while ((Date.now() - started) < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/ready`);
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for API readiness on port ${port}.`);
}

function spawnApiServer(workDir: string, port: number, issuerUrl: string, redirectUrl: string): ChildProcessWithoutNullStreams {
  return spawn(
    process.execPath,
    [tsxCli, 'src/service/api-server.ts'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        ATTESTOR_ADMIN_API_KEY: 'admin-secret',
        ATTESTOR_HOSTED_OIDC_ISSUER_URL: issuerUrl,
        ATTESTOR_HOSTED_OIDC_CLIENT_ID: 'attestor-web',
        ATTESTOR_HOSTED_OIDC_CLIENT_SECRET: 'attestor-secret',
        ATTESTOR_HOSTED_OIDC_REDIRECT_URL: redirectUrl,
        ATTESTOR_HOSTED_OIDC_SCOPES: 'openid email profile',
        ATTESTOR_HOSTED_OIDC_STATE_KEY: 'oidc-state-secret',
        ATTESTOR_ACCOUNT_STORE_PATH: join(workDir, 'accounts.json'),
        ATTESTOR_TENANT_KEY_STORE_PATH: join(workDir, 'tenant-keys.json'),
        ATTESTOR_USAGE_LEDGER_PATH: join(workDir, 'usage.json'),
        ATTESTOR_ACCOUNT_USER_STORE_PATH: join(workDir, 'account-users.json'),
        ATTESTOR_ACCOUNT_SESSION_STORE_PATH: join(workDir, 'account-sessions.json'),
        ATTESTOR_ACCOUNT_USER_TOKEN_STORE_PATH: join(workDir, 'account-user-tokens.json'),
        ATTESTOR_ADMIN_IDEMPOTENCY_STORE_PATH: join(workDir, 'admin-idempotency.json'),
        ATTESTOR_ADMIN_AUDIT_LOG_PATH: join(workDir, 'admin-audit.jsonl'),
        ATTESTOR_CONTROL_PLANE_PG_URL: '',
        ATTESTOR_BILLING_LEDGER_PG_URL: '',
        ATTESTOR_EMAIL_DELIVERY_MODE: 'manual',
        ATTESTOR_OBSERVABILITY_LOG_PATH: '',
        OTEL_TRACES_EXPORTER: '',
        OTEL_METRICS_EXPORTER: '',
        OTEL_LOGS_EXPORTER: '',
      },
      stdio: 'pipe',
    },
  );
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ response: Response; body: any }> {
  const response = await fetch(url, init);
  const text = await response.text();
  return {
    response,
    body: text ? parseJson<any>(text) : null,
  };
}

async function main(): Promise<void> {
  console.log('\n[Live Account OIDC SSO]');

  const workDir = mkdtempSync(join(tmpdir(), 'attestor-oidc-'));
  const oidcPort = await reservePort();
  const apiPort = await reservePort();
  const issuerUrl = `http://127.0.0.1:${oidcPort}`;
  const redirectUrl = `http://127.0.0.1:${apiPort}/api/v1/auth/oidc/callback`;

  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey) as JWK;
  publicJwk.kid = 'oidc-test-key';
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';

  const authorizationCodes = new Map<string, {
    codeChallenge: string;
    redirectUri: string;
    nonce: string;
    subject: string;
    email: string;
    name: string;
  }>();
  let currentSubject = 'oidc-subject-1';
  let currentEmail = 'owner@account.example';
  let currentName = 'OIDC Owner';

  const oidcServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const requestUrl = new URL(req.url ?? '/', issuerUrl);
      if (requestUrl.pathname === '/.well-known/openid-configuration') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          issuer: issuerUrl,
          authorization_endpoint: `${issuerUrl}/authorize`,
          token_endpoint: `${issuerUrl}/token`,
          jwks_uri: `${issuerUrl}/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          token_endpoint_auth_methods_supported: ['client_secret_post'],
          code_challenge_methods_supported: ['S256'],
          scopes_supported: ['openid', 'email', 'profile'],
        }));
        return;
      }
      if (requestUrl.pathname === '/jwks') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ keys: [publicJwk] }));
        return;
      }
      if (requestUrl.pathname === '/authorize') {
        const redirectUri = requestUrl.searchParams.get('redirect_uri');
        const state = requestUrl.searchParams.get('state');
        const codeChallenge = requestUrl.searchParams.get('code_challenge');
        const nonce = requestUrl.searchParams.get('nonce');
        const responseType = requestUrl.searchParams.get('response_type');
        const clientId = requestUrl.searchParams.get('client_id');
        if (!redirectUri || !state || !codeChallenge || !nonce || responseType !== 'code' || clientId !== 'attestor-web') {
          res.statusCode = 400;
          res.end('bad authorize request');
          return;
        }
        const code = `code_${randomBytes(8).toString('hex')}`;
        authorizationCodes.set(code, {
          codeChallenge,
          redirectUri,
          nonce,
          subject: currentSubject,
          email: currentEmail,
          name: currentName,
        });
        res.statusCode = 302;
        res.setHeader('location', `${redirectUri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);
        res.end();
        return;
      }
      if (requestUrl.pathname === '/token' && req.method === 'POST') {
        const body = new URLSearchParams(await readRequestBody(req));
        const code = body.get('code');
        const clientId = body.get('client_id');
        const clientSecret = body.get('client_secret');
        const codeVerifier = body.get('code_verifier');
        const redirectUri = body.get('redirect_uri');
        const record = code ? authorizationCodes.get(code) ?? null : null;
        if (!code || !record || clientId !== 'attestor-web' || clientSecret !== 'attestor-secret' || !codeVerifier || !redirectUri) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }
        if (record.redirectUri !== redirectUri || record.codeChallenge !== codeChallengeS256(codeVerifier)) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }
        authorizationCodes.delete(code);
        const now = Math.floor(Date.now() / 1000);
        const idToken = await new SignJWT({
          email: record.email,
          email_verified: true,
          name: record.name,
          preferred_username: record.email,
          nonce: record.nonce,
        })
          .setProtectedHeader({ alg: 'RS256', kid: 'oidc-test-key' })
          .setIssuer(issuerUrl)
          .setAudience('attestor-web')
          .setSubject(record.subject)
          .setIssuedAt(now)
          .setExpirationTime(now + 300)
          .sign(privateKey);

        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          access_token: `access_${randomBytes(12).toString('hex')}`,
          token_type: 'Bearer',
          expires_in: 300,
          id_token: idToken,
        }));
        return;
      }

      res.statusCode = 404;
      res.end('not found');
    } catch (error) {
      res.statusCode = 500;
      res.end(error instanceof Error ? error.message : String(error));
    }
  });

  const api = spawnApiServer(workDir, apiPort, issuerUrl, redirectUrl);
  const apiOutput: Buffer[] = [];
  api.stdout.on('data', (chunk) => apiOutput.push(Buffer.from(chunk)));
  api.stderr.on('data', (chunk) => apiOutput.push(Buffer.from(chunk)));
  const cleanup = async () => {
    try {
      await new Promise<void>((resolve) => oidcServer.close(() => resolve()));
    } catch {}
    if (!api.killed) api.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      api.once('exit', () => resolve());
      setTimeout(() => resolve(), 4000).unref();
    });
    rmSync(workDir, { recursive: true, force: true });
  };

  try {
    await new Promise<void>((resolve, reject) => {
      oidcServer.once('error', reject);
      oidcServer.listen(oidcPort, '127.0.0.1', () => resolve());
    });
    await waitForReady(apiPort);

    const adminCreate = await fetchJson(`http://127.0.0.1:${apiPort}/api/v1/admin/accounts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: 'Bearer admin-secret',
        'idempotency-key': `oidc-account-create-${randomBytes(6).toString('hex')}`,
      },
      body: JSON.stringify({
        accountName: 'OIDC Account',
        contactEmail: 'owner@account.example',
        tenantId: 'tenant-oidc',
        tenantName: 'OIDC Tenant',
      }),
    });
    ok(
      adminCreate.response.status === 201,
      `OIDC: hosted account provision status 201 (${adminCreate.response.status} ${JSON.stringify(adminCreate.body)} | logs=${Buffer.concat(apiOutput).toString('utf8')})`,
    );
    const initialKey = adminCreate.body.initialKey.apiKey as string;
    ok(typeof initialKey === 'string' && initialKey.startsWith('atk_'), `OIDC: initial tenant key is returned (${JSON.stringify(adminCreate.body)})`);

    const tenantKeyStorePath = join(workDir, 'tenant-keys.json');
    ok(existsSync(tenantKeyStorePath), 'OIDC: tenant key store file created after account provisioning');
    const accountProbe = await fetchJson(`http://127.0.0.1:${apiPort}/api/v1/account`, {
      headers: {
        Authorization: `Bearer ${initialKey}`,
      },
    });
    ok(
      accountProbe.response.status === 200,
      `OIDC: initial tenant API key resolves hosted account (${accountProbe.response.status} ${JSON.stringify(accountProbe.body)} | tenantKeyStore=${readFileSync(tenantKeyStorePath, 'utf8')} | logs=${Buffer.concat(apiOutput).toString('utf8')})`,
    );

    const bootstrap = await fetchJson(`http://127.0.0.1:${apiPort}/api/v1/account/users/bootstrap`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${initialKey}`,
      },
      body: JSON.stringify({
        email: 'owner@account.example',
        displayName: 'Owner Admin',
        password: 'BootstrapPass123!',
      }),
    });
    ok(
      bootstrap.response.status === 201,
      `OIDC: bootstrap account admin status 201 (${bootstrap.response.status} ${JSON.stringify(bootstrap.body)} | logs=${Buffer.concat(apiOutput).toString('utf8')})`,
    );
    ok(bootstrap.body.user.federation.oidcLinked === false, 'OIDC: bootstrap user starts without linked OIDC identity');

    const oidcBegin = await fetchJson(`http://127.0.0.1:${apiPort}/api/v1/auth/oidc/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@account.example' }),
    });
    ok(
      oidcBegin.response.status === 200,
      `OIDC: login begin status 200 (${oidcBegin.response.status} ${JSON.stringify(oidcBegin.body)} | logs=${Buffer.concat(apiOutput).toString('utf8')})`,
    );
    ok(oidcBegin.body.authorization.mode === 'authorization_code_pkce', 'OIDC: login begin reports PKCE mode');
    ok(Array.isArray(oidcBegin.body.authorization.scopes) && oidcBegin.body.authorization.scopes.includes('openid'), 'OIDC: login begin reports scopes');

    const authorizeRes = await fetch(oidcBegin.body.authorization.authorizationUrl, { redirect: 'manual' });
    ok(authorizeRes.status === 302, 'OIDC: authorize endpoint redirects back to callback');
    const callbackUrl = authorizeRes.headers.get('location');
    ok(Boolean(callbackUrl), 'OIDC: authorize redirect location present');

    const callback = await fetchJson(callbackUrl!, { redirect: 'manual' });
    ok(callback.response.status === 200, 'OIDC: callback returns 200');
    ok(callback.body.upstreamAuth.provider === 'oidc', 'OIDC: callback marks upstream auth provider');
    const oidcCookie = cookieHeaderFromResponse(callback.response);
    ok(Boolean(oidcCookie), 'OIDC: callback sets hosted session cookie');
    ok(callback.body.user.federation.oidcLinked === true, 'OIDC: callback links identity to hosted user');
    ok(callback.body.user.federation.oidcIdentityCount === 1, 'OIDC: callback reports one linked identity');

    const me = await fetchJson(`http://127.0.0.1:${apiPort}/api/v1/auth/me`, {
      headers: { Cookie: oidcCookie! },
    });
    ok(me.response.status === 200, 'OIDC: auth/me works with OIDC-issued session');
    ok(me.body.user.email === 'owner@account.example', 'OIDC: auth/me resolves linked account user');

    const oidcSummary = await fetchJson(`http://127.0.0.1:${apiPort}/api/v1/account/oidc`, {
      headers: { Cookie: oidcCookie! },
    });
    ok(oidcSummary.response.status === 200, 'OIDC: account summary status 200');
    ok(oidcSummary.body.oidc.configured === true, 'OIDC: account summary shows hosted OIDC configured');
    ok(Array.isArray(oidcSummary.body.oidc.identities) && oidcSummary.body.oidc.identities.length === 1, 'OIDC: account summary returns linked identity');

    currentEmail = 'owner+renamed@idp.example';
    currentName = 'OIDC Owner Renamed';
    const secondBegin = await fetchJson(`http://127.0.0.1:${apiPort}/api/v1/auth/oidc/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    ok(secondBegin.response.status === 200, 'OIDC: second login begin works without email hint');
    const secondAuthorize = await fetch(secondBegin.body.authorization.authorizationUrl, { redirect: 'manual' });
    const secondCallback = await fetchJson(secondAuthorize.headers.get('location')!, { redirect: 'manual' });
    ok(secondCallback.response.status === 200, 'OIDC: linked subject can re-login after IdP email change');
    ok(secondCallback.body.user.email === 'owner@account.example', 'OIDC: hosted account user mapping stays stable on email change');
    const secondCookie = cookieHeaderFromResponse(secondCallback.response);
    ok(Boolean(secondCookie), 'OIDC: second callback sets a fresh session cookie');

    const secondOidcSummary = await fetchJson(`http://127.0.0.1:${apiPort}/api/v1/account/oidc`, {
      headers: { Cookie: secondCookie! },
    });
    ok(secondOidcSummary.response.status === 200, 'OIDC: summary still available after linked re-login');
    ok(secondOidcSummary.body.oidc.identities[0].email === 'owner+renamed@idp.example', 'OIDC: linked identity email is refreshed from latest IdP claim');

    console.log(`  Live account OIDC tests: ${passed} passed, 0 failed`);
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error('\nLive account OIDC SSO tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
