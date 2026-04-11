import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import * as samlify from 'samlify';

const require = createRequire(import.meta.url);
const forge = require('node-forge');

let passed = 0;
let validatorConfigured = false;

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
        reject(new Error('Could not reserve TCP port.'));
        return;
      }
      const { port } = address;
      server.close((err) => err ? reject(err) : resolve(port));
    });
  });
}

async function waitForReady(base: string, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
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

function configureTestSamlValidator(): void {
  if (validatorConfigured) return;
  samlify.setSchemaValidator({
    validate: async (xml: string) => {
      if (typeof xml !== 'string' || !xml.trim()) {
        throw new Error('SAML XML payload is empty.');
      }
      if (Buffer.byteLength(xml, 'utf8') > (256 * 1024)) {
        throw new Error('SAML XML payload exceeds the configured size limit.');
      }
      if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
        throw new Error('SAML XML payload contains forbidden DTD/entity declarations.');
      }
      if (!/<(?:\w+:)?(?:Response|AuthnRequest)\b/i.test(xml)) {
        throw new Error('SAML XML payload does not contain a supported SAML root element.');
      }
      if (!/urn:oasis:names:tc:SAML:/i.test(xml)) {
        throw new Error('SAML XML payload does not declare a SAML namespace.');
      }
      return 'test_strict_custom_guard';
    },
  });
  validatorConfigured = true;
}

function generateSelfSignedPemPair(commonName: string): { privateKeyPem: string; certPem: string } {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomBytes(16).toString('hex');
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + (365 * 24 * 60 * 60 * 1000));
  const attrs = [
    { name: 'commonName', value: commonName },
    { name: 'organizationName', value: 'Attestor Test' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certPem: forge.pki.certificateToPem(cert),
  };
}

function createMockIdentityProvider(options: {
  entityId: string;
  ssoUrl: string;
  wantAuthnRequestsSigned: boolean;
}) {
  configureTestSamlValidator();
  const keys = generateSelfSignedPemPair('attestor-saml-idp.test');
  const idp = samlify.IdentityProvider({
    entityID: options.entityId,
    signingCert: keys.certPem,
    privateKey: keys.privateKeyPem,
    wantAuthnRequestsSigned: options.wantAuthnRequestsSigned,
    nameIDFormat: ['urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress'],
    singleSignOnService: [
      {
        Binding: samlify.Constants.namespace.binding.redirect,
        Location: options.ssoUrl,
      },
    ],
    singleLogoutService: [
      {
        Binding: samlify.Constants.namespace.binding.redirect,
        Location: `${options.ssoUrl}/logout`,
      },
    ],
  });
  return {
    entityId: options.entityId,
    metadataXml: idp.getMetadata(),
    idp,
  };
}

function buildRedirectRequestInfo(authorizationUrl: string): {
  query: Record<string, string>;
  octetString?: string;
  relayState: string | null;
} {
  const url = new URL(authorizationUrl);
  const rawSearch = url.search.startsWith('?') ? url.search.slice(1) : url.search;
  const rawSegments = rawSearch
    .split('&')
    .filter(Boolean);
  const rawValues = new Map<string, string>();
  for (const segment of rawSegments) {
    const separatorIndex = segment.indexOf('=');
    const key = separatorIndex >= 0 ? segment.slice(0, separatorIndex) : segment;
    const value = separatorIndex >= 0 ? segment.slice(separatorIndex + 1) : '';
    rawValues.set(decodeURIComponent(key), value);
  }
  const query = Object.fromEntries(url.searchParams.entries());
  const octetString = rawSearch
    .split('&Signature=')[0]
    .split('&signature=')[0];
  return {
    query,
    octetString: rawValues.has('SigAlg') ? octetString : undefined,
    relayState: query.RelayState ?? null,
  };
}

const tsxCli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');

function spawnApiServer(port: number, env: NodeJS.ProcessEnv): {
  child: ChildProcessWithoutNullStreams;
  output: Buffer[];
} {
  const output: Buffer[] = [];
  const child = spawn(
    process.execPath,
    [tsxCli, 'src/service/api-server.ts'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env,
        PORT: String(port),
      },
      stdio: 'pipe',
    },
  );
  child.stdout.on('data', (chunk) => output.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => output.push(Buffer.from(chunk)));
  return { child, output };
}

function attachExitGuard(child: ChildProcessWithoutNullStreams, label: string, output: Buffer[]): void {
  child.once('exit', (code, signal) => {
    if (code === 0 || signal === 'SIGTERM') return;
    const rendered = Buffer.concat(output).toString('utf8').trim();
    throw new Error(`${label} exited unexpectedly (${code ?? 'null'} / ${signal ?? 'none'})\n${rendered}`);
  });
}

function buildCommonApiEnv(workDir: string, base: string): NodeJS.ProcessEnv {
  return {
    ATTESTOR_ADMIN_API_KEY: 'admin-saml',
    ATTESTOR_STRIPE_USE_MOCK: 'true',
    STRIPE_API_KEY: 'sk_test_live_saml_mock',
    STRIPE_WEBHOOK_SECRET: 'whsec_live_saml',
    ATTESTOR_BILLING_SUCCESS_URL: 'https://attestor.dev/billing/success',
    ATTESTOR_BILLING_CANCEL_URL: 'https://attestor.dev/billing/cancel',
    ATTESTOR_BILLING_PORTAL_RETURN_URL: 'https://attestor.dev/app',
    ATTESTOR_STRIPE_PRICE_STARTER: 'price_starter_monthly',
    ATTESTOR_STRIPE_PRICE_PRO: 'price_pro_monthly',
    ATTESTOR_STRIPE_PRICE_ENTERPRISE: 'price_enterprise_monthly',
    ATTESTOR_SESSION_COOKIE_SECURE: 'false',
    ATTESTOR_EMAIL_DELIVERY_MODE: 'manual',
    ATTESTOR_OBSERVABILITY_LOG_PATH: '',
    OTEL_TRACES_EXPORTER: '',
    OTEL_METRICS_EXPORTER: '',
    OTEL_LOGS_EXPORTER: '',
    ATTESTOR_ACCOUNT_STORE_PATH: join(workDir, 'accounts.json'),
    ATTESTOR_TENANT_KEY_STORE_PATH: join(workDir, 'tenant-keys.json'),
    ATTESTOR_USAGE_LEDGER_PATH: join(workDir, 'usage.json'),
    ATTESTOR_ACCOUNT_USER_STORE_PATH: join(workDir, 'account-users.json'),
    ATTESTOR_ACCOUNT_SESSION_STORE_PATH: join(workDir, 'account-sessions.json'),
    ATTESTOR_ACCOUNT_USER_TOKEN_STORE_PATH: join(workDir, 'account-user-tokens.json'),
    ATTESTOR_ACCOUNT_SAML_REPLAY_STORE_PATH: join(workDir, 'account-saml-replays.json'),
    ATTESTOR_ADMIN_IDEMPOTENCY_STORE_PATH: join(workDir, 'admin-idempotency.json'),
    ATTESTOR_ADMIN_AUDIT_LOG_PATH: join(workDir, 'admin-audit.jsonl'),
    ATTESTOR_ASYNC_DLQ_STORE_PATH: join(workDir, 'async-dlq.json'),
    ATTESTOR_STRIPE_WEBHOOK_STORE_PATH: join(workDir, 'stripe-webhooks.json'),
    ATTESTOR_BILLING_ENTITLEMENT_STORE_PATH: join(workDir, 'billing-entitlements.json'),
    ATTESTOR_CONTROL_PLANE_PG_URL: '',
    ATTESTOR_BILLING_LEDGER_PG_URL: '',
    ATTESTOR_HOSTED_SAML_ENTITY_ID: `${base}/api/v1/auth/saml/metadata`,
    ATTESTOR_HOSTED_SAML_METADATA_URL: `${base}/api/v1/auth/saml/metadata`,
    ATTESTOR_HOSTED_SAML_ACS_URL: `${base}/api/v1/auth/saml/acs`,
    ATTESTOR_HOSTED_SAML_RELAY_STATE_KEY: 'saml-relay-state-secret',
  };
}

async function createHostedAccountAndUser(base: string): Promise<{ tenantApiKey: string }> {
  const createAccountRes = await fetch(`${base}/api/v1/admin/accounts`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer admin-saml',
      'Content-Type': 'application/json',
      'Idempotency-Key': `live-saml-account-${randomBytes(8).toString('hex')}`,
    },
    body: JSON.stringify({
      accountName: 'SAML Hosted Co',
      contactEmail: 'ops@saml.example',
      tenantId: 'tenant-saml',
      tenantName: 'SAML Tenant',
      planId: 'enterprise',
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
      email: 'owner@saml.example',
      displayName: 'SAML Owner',
      password: 'SamlOwner123!',
    }),
  });
  ok(bootstrapRes.status === 201, 'Bootstrap: 201');
  return { tenantApiKey };
}

async function executeSamlLoginFlow(
  base: string,
  idp: any,
  expectSignedRequest: boolean,
  serviceProvider?: any,
): Promise<{
  sessionCookie: string;
  relayState: string;
  samlResponse: string;
  metadataText: string;
}> {
  const metadataRes = await fetch(`${base}/api/v1/auth/saml/metadata`);
  ok(metadataRes.status === 200, 'SAML metadata: 200');
  const metadataText = await metadataRes.text();
  ok(metadataText.includes('EntityDescriptor'), 'SAML metadata: XML returned');

  const loginRes = await fetch(`${base}/api/v1/auth/saml/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@saml.example' }),
  });
  ok(loginRes.status === 200, 'SAML login start: 200');
  const loginBody = await loginRes.json() as any;
  ok(loginBody.authorization.mode === 'sp_initiated_redirect', 'SAML login start: redirect mode');

  const authorizationUrl = String(loginBody.authorization.authorizationUrl);
  const redirectRequest = buildRedirectRequestInfo(authorizationUrl);
  ok(Boolean(redirectRequest.relayState), 'SAML login start: relay state included');
  const hasSignature = authorizationUrl.includes('Signature=');
  ok(hasSignature === expectSignedRequest, `SAML login start: signed-request=${expectSignedRequest}`);

  const sp = serviceProvider ?? samlify.ServiceProvider({ metadata: metadataText });
  const parsedRequest = await idp.parseLoginRequest(
    sp,
    'redirect',
    redirectRequest.octetString
      ? { query: redirectRequest.query, octetString: redirectRequest.octetString }
      : { query: redirectRequest.query },
  );
  ok(parsedRequest.extract.request.id === loginBody.authorization.requestId, 'SAML IdP parse: request id matches issued authorization');

  const issued = await idp.createLoginResponse(
    sp,
    parsedRequest,
    'post',
    { email: 'owner@saml.example' },
    undefined,
    false,
    redirectRequest.relayState ?? undefined,
  );
  ok(typeof issued.context === 'string' && issued.context.length > 0, 'SAML IdP response: base64 context issued');

  const acsRes = await fetch(`${base}/api/v1/auth/saml/acs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      SAMLResponse: issued.context,
      RelayState: redirectRequest.relayState ?? '',
    }).toString(),
  });
  const acsText = await acsRes.text();
  const acsBody = acsText ? JSON.parse(acsText) as any : null;
  ok(acsRes.status === 200, `SAML ACS: 200 (got ${acsRes.status} ${acsText})`);
  ok(acsBody.upstreamAuth?.provider === 'saml', 'SAML ACS: upstream auth provider recorded');
  ok(acsBody.upstreamAuth?.subject === 'owner@saml.example', 'SAML ACS: upstream subject returned');
  const sessionCookie = cookieHeaderFromResponse(acsRes);
  ok(Boolean(sessionCookie), 'SAML ACS: session cookie returned');

  return {
    sessionCookie: sessionCookie!,
    relayState: redirectRequest.relayState ?? '',
    samlResponse: issued.context,
    metadataText,
  };
}

function createServiceProviderForTest(options: {
  base: string;
  authnRequestsSigned: boolean;
  privateKeyPem?: string;
  certPem?: string;
}) {
  return samlify.ServiceProvider({
    entityID: `${options.base}/api/v1/auth/saml/metadata`,
    authnRequestsSigned: options.authnRequestsSigned,
    wantAssertionsSigned: true,
    wantMessageSigned: true,
    privateKey: options.privateKeyPem,
    signingCert: options.certPem,
    assertionConsumerService: [
      {
        Binding: samlify.Constants.namespace.binding.post,
        Location: `${options.base}/api/v1/auth/saml/acs`,
      },
    ],
  });
}

async function assertAccountSamlView(base: string, sessionCookie: string): Promise<void> {
  const samlRes = await fetch(`${base}/api/v1/account/saml`, {
    headers: { Cookie: sessionCookie },
  });
  ok(samlRes.status === 200, 'Account SAML view: 200');
  const samlBody = await samlRes.json() as any;
  ok(samlBody.saml.configured === true, 'Account SAML view: configuration visible');
  ok(samlBody.saml.identities.length === 1, 'Account SAML view: single identity linked');
  ok(samlBody.saml.identities[0].issuer, 'Account SAML view: issuer recorded');
  ok(samlBody.saml.identities[0].email === 'owner@saml.example', 'Account SAML view: linked email recorded');
}

async function runFileBackedScenario(): Promise<void> {
  console.log('\n[Live Account SAML SSO: file-backed]');
  const workDir = mkdtempSync(join(tmpdir(), 'attestor-live-saml-file-'));
  const apiPort = await reservePort();
  const base = `http://127.0.0.1:${apiPort}`;
  const idp = createMockIdentityProvider({
    entityId: 'urn:attestor:test:idp:file',
    ssoUrl: 'https://idp.file.example/sso',
    wantAuthnRequestsSigned: false,
  });
  const env = buildCommonApiEnv(workDir, base);
  env.ATTESTOR_HOSTED_SAML_IDP_METADATA_XML = idp.metadataXml;
  const { child, output } = spawnApiServer(apiPort, env);
  attachExitGuard(child, 'File-backed SAML API server', output);
  try {
    await waitForReady(base);
    await createHostedAccountAndUser(base);

    const sp = createServiceProviderForTest({
      base,
      authnRequestsSigned: false,
    });

    const first = await executeSamlLoginFlow(base, idp.idp, false, sp);
    await assertAccountSamlView(base, first.sessionCookie);
    ok(existsSync(join(workDir, 'account-saml-replays.json')), 'File-backed SAML replay store: local file created after ACS');

    const replayRes = await fetch(`${base}/api/v1/auth/saml/acs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        SAMLResponse: first.samlResponse,
        RelayState: first.relayState,
      }).toString(),
    });
    ok(replayRes.status === 409, 'SAML replay guard(file): reused assertion rejected');

    const second = await executeSamlLoginFlow(base, idp.idp, false, sp);
    await assertAccountSamlView(base, second.sessionCookie);
  } finally {
    if (!child.killed) child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', () => resolve(null)));
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function runSharedPgScenario(): Promise<void> {
  console.log('\n[Live Account SAML SSO: shared PG]');
  const workDir = mkdtempSync(join(tmpdir(), 'attestor-live-saml-pg-'));
  const pgPort = await reservePort();
  const apiPort = await reservePort();
  const base = `http://127.0.0.1:${apiPort}`;
  const pg = new EmbeddedPostgres({
    databaseDir: join(workDir, 'pg'),
    user: 'saml_live',
    password: 'saml_live',
    port: pgPort,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });
  const idp = createMockIdentityProvider({
    entityId: 'urn:attestor:test:idp:pg',
    ssoUrl: 'https://idp.pg.example/sso',
    wantAuthnRequestsSigned: true,
  });
  const spKeys = generateSelfSignedPemPair('attestor-saml-sp.test');
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('attestor_control_plane');
  await pg.createDatabase('attestor_billing');

  const env = buildCommonApiEnv(workDir, base);
  env.ATTESTOR_HOSTED_SAML_IDP_METADATA_XML = idp.metadataXml;
  env.ATTESTOR_HOSTED_SAML_SIGN_AUTHN_REQUESTS = 'true';
  env.ATTESTOR_HOSTED_SAML_SP_PRIVATE_KEY = spKeys.privateKeyPem;
  env.ATTESTOR_HOSTED_SAML_SP_CERT = spKeys.certPem;
  env.ATTESTOR_CONTROL_PLANE_PG_URL = `postgres://saml_live:saml_live@localhost:${pgPort}/attestor_control_plane`;
  env.ATTESTOR_BILLING_LEDGER_PG_URL = `postgres://saml_live:saml_live@localhost:${pgPort}/attestor_billing`;

  const { child, output } = spawnApiServer(apiPort, env);
  attachExitGuard(child, 'Shared-PG SAML API server', output);
  try {
    await waitForReady(base);
    await createHostedAccountAndUser(base);

    const sp = createServiceProviderForTest({
      base,
      authnRequestsSigned: true,
      privateKeyPem: spKeys.privateKeyPem,
      certPem: spKeys.certPem,
    });

    const first = await executeSamlLoginFlow(base, idp.idp, true, sp);
    await assertAccountSamlView(base, first.sessionCookie);
    ok(!existsSync(join(workDir, 'account-saml-replays.json')), 'Shared PG SAML replay store: local file not created');
    ok(!existsSync(join(workDir, 'account-users.json')), 'Shared PG SAML users: local file not created');

    const replayRes = await fetch(`${base}/api/v1/auth/saml/acs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        SAMLResponse: first.samlResponse,
        RelayState: first.relayState,
      }).toString(),
    });
    ok(replayRes.status === 409, 'SAML replay guard(shared PG): reused assertion rejected');
  } finally {
    if (!child.killed) child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', () => resolve(null)));
    await pg.stop();
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  await runFileBackedScenario();
  await runSharedPgScenario();
  console.log(`passed ${passed}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
