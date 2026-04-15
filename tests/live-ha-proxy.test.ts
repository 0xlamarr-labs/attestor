import { strict as assert } from 'node:assert';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

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

function spawnApiServer(instanceId: string, port: number): ChildProcessWithoutNullStreams {
  return spawn(
    process.execPath,
    [tsxCli, 'src/service/api-server.ts'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        ATTESTOR_INSTANCE_ID: instanceId,
        ATTESTOR_HA_MODE: '',
        REDIS_URL: '',
        ATTESTOR_CONTROL_PLANE_PG_URL: '',
        ATTESTOR_BILLING_LEDGER_PG_URL: '',
        ATTESTOR_OBSERVABILITY_LOG_PATH: '',
        OTEL_TRACES_EXPORTER: '',
        OTEL_METRICS_EXPORTER: '',
      },
      stdio: 'pipe',
    },
  );
}

async function fetchJsonThroughProxy(proxyPort: number, path: string): Promise<{ status: number; instanceId: string | null; body: any }> {
  const response = await fetch(`http://127.0.0.1:${proxyPort}${path}`);
  const body = await response.json();
  return {
    status: response.status,
    instanceId: response.headers.get('x-attestor-instance-id'),
    body,
  };
}

async function main(): Promise<void> {
  console.log('\n[Live Multi-Node HA Proxy]');

  const api1Port = await reservePort();
  const api2Port = await reservePort();
  const proxyPort = await reservePort();

  const api1 = spawnApiServer('api-node-1', api1Port);
  const api2 = spawnApiServer('api-node-2', api2Port);

  let proxyClosed = false;
  let proxyIndex = 0;
  const targets = [api1Port, api2Port];
  const proxy = createHttpServer((req, res) => {
    const targetPort = targets[proxyIndex % targets.length];
    proxyIndex += 1;
    const upstream = httpRequest({
      host: '127.0.0.1',
      port: targetPort,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: 'attestor.local',
        'x-forwarded-for': '203.0.113.10',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'attestor.local',
        'x-forwarded-port': '443',
      },
    }, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    });
    upstream.on('error', (error) => {
      res.statusCode = 502;
      res.end(String(error));
    });
    req.pipe(upstream);
  });

  const cleanup = async () => {
    if (!proxyClosed) {
      proxyClosed = true;
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
    for (const child of [api1, api2]) {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    }
    await Promise.all([api1, api2].map((child) => new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      setTimeout(() => resolve(), 4000).unref();
    })));
  };

  try {
    await new Promise<void>((resolve, reject) => {
      proxy.once('error', reject);
      proxy.listen(proxyPort, '127.0.0.1', () => resolve());
    });

    await Promise.all([waitForReady(api1Port), waitForReady(api2Port)]);

    const first = await fetchJsonThroughProxy(proxyPort, '/api/v1/health');
    const second = await fetchJsonThroughProxy(proxyPort, '/api/v1/health');

    ok(first.status === 200, 'HA proxy: first request returned 200');
    ok(second.status === 200, 'HA proxy: second request returned 200');
    ok(first.instanceId === 'api-node-1', 'HA proxy: first response came from api-node-1');
    ok(second.instanceId === 'api-node-2', 'HA proxy: second response came from api-node-2');
    ok(first.body.instanceId === 'api-node-1', 'HA proxy: first health body exposes instance id');
    ok(second.body.instanceId === 'api-node-2', 'HA proxy: second health body exposes instance id');
    ok(first.body.highAvailability?.enabled === false, 'HA proxy: default runtime stays single-node unless HA mode enabled');
    ok(second.body.highAvailability?.enabled === false, 'HA proxy: second node reports single-node mode by default');

    const failingPort = await reservePort();
    const failing = spawn(
      process.execPath,
      [tsxCli, 'src/service/api-server.ts'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PORT: String(failingPort),
          ATTESTOR_INSTANCE_ID: 'ha-guard-test',
          ATTESTOR_HA_MODE: 'true',
          REDIS_URL: '',
          ATTESTOR_CONTROL_PLANE_PG_URL: '',
          ATTESTOR_BILLING_LEDGER_PG_URL: '',
          OTEL_TRACES_EXPORTER: '',
          OTEL_METRICS_EXPORTER: '',
        },
        stdio: 'pipe',
      },
    );

    const outputChunks: Buffer[] = [];
    failing.stdout.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));
    failing.stderr.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));

    const exitCode = await new Promise<number | null>((resolve) => {
      failing.once('exit', (code) => resolve(code));
      setTimeout(() => resolve(null), 15000).unref();
    });

    const output = Buffer.concat(outputChunks).toString('utf8');
    ok(exitCode !== 0, 'HA guard: misconfigured HA startup exits non-zero');
    ok(output.includes('ATTESTOR_HA_MODE startup guard failed'), 'HA guard: startup failure explains HA guard');
    ok(output.includes('ATTESTOR_CONTROL_PLANE_PG_URL'), 'HA guard: failure mentions shared control-plane requirement');
    ok(output.includes('REDIS_URL-backed external Redis'), 'HA guard: failure mentions external Redis requirement');

    const publicHostedPort = await reservePort();
    const publicHosted = spawn(
      process.execPath,
      [tsxCli, 'src/service/api-server.ts'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PORT: String(publicHostedPort),
          ATTESTOR_INSTANCE_ID: 'public-hosted-guard-test',
          ATTESTOR_HA_MODE: '',
          ATTESTOR_PUBLIC_HOSTNAME: 'api.attestor.example.invalid',
          ATTESTOR_CONTROL_PLANE_PG_URL: '',
          ATTESTOR_BILLING_LEDGER_PG_URL: '',
          ATTESTOR_SESSION_COOKIE_SECURE: 'false',
          ATTESTOR_STRIPE_USE_MOCK: 'true',
          REDIS_URL: '',
          OTEL_TRACES_EXPORTER: '',
          OTEL_METRICS_EXPORTER: '',
        },
        stdio: 'pipe',
      },
    );

    const publicHostedChunks: Buffer[] = [];
    publicHosted.stdout.on('data', (chunk) => publicHostedChunks.push(Buffer.from(chunk)));
    publicHosted.stderr.on('data', (chunk) => publicHostedChunks.push(Buffer.from(chunk)));

    const publicHostedExitCode = await new Promise<number | null>((resolve) => {
      publicHosted.once('exit', (code) => resolve(code));
      setTimeout(() => resolve(null), 15000).unref();
    });

    const publicHostedOutput = Buffer.concat(publicHostedChunks).toString('utf8');
    ok(publicHostedExitCode !== 0, 'Public hosted guard: unsafe hosted startup exits non-zero');
    ok(publicHostedOutput.includes('Public hosted startup guard failed'), 'Public hosted guard: startup failure explains hosted guard');
    ok(publicHostedOutput.includes('ATTESTOR_CONTROL_PLANE_PG_URL'), 'Public hosted guard: failure mentions shared control-plane requirement');
    ok(publicHostedOutput.includes('ATTESTOR_BILLING_LEDGER_PG_URL'), 'Public hosted guard: failure mentions shared billing ledger requirement');
    ok(publicHostedOutput.includes('ATTESTOR_SESSION_COOKIE_SECURE=false'), 'Public hosted guard: failure mentions secure session cookie requirement');
    ok(publicHostedOutput.includes('ATTESTOR_STRIPE_USE_MOCK'), 'Public hosted guard: failure mentions Stripe mock prohibition');

    console.log(`  Live HA tests: ${passed} passed, 0 failed`);
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error('\nLive HA proxy tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
