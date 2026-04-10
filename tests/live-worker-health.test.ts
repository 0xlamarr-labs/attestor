import { strict as assert } from 'node:assert';
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

function spawnWorker(instanceId: string, healthPort: number, haMode = ''): ChildProcessWithoutNullStreams {
  return spawn(
    process.execPath,
    [tsxCli, 'src/service/worker.ts'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ATTESTOR_INSTANCE_ID: instanceId,
        ATTESTOR_WORKER_HEALTH_PORT: String(healthPort),
        ATTESTOR_HA_MODE: haMode,
        REDIS_URL: '',
        OTEL_TRACES_EXPORTER: '',
        OTEL_METRICS_EXPORTER: '',
        OTEL_LOGS_EXPORTER: '',
      },
      stdio: 'pipe',
    },
  );
}

async function waitForReady(port: number, timeoutMs = 15000): Promise<any> {
  const started = Date.now();
  while ((Date.now() - started) < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/ready`);
      const body = await response.json();
      if (response.status === 200) return body;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for worker readiness on port ${port}.`);
}

async function main(): Promise<void> {
  console.log('\n[Live Worker Health]');

  const healthPort = await reservePort();
  const worker = spawnWorker('worker-node-1', healthPort);

  try {
    const readyBody = await waitForReady(healthPort);
    ok(readyBody.status === 'ready', 'Worker health: /ready returns ready status');
    ok(readyBody.instanceId === 'worker-node-1', 'Worker health: instance id exposed on /ready');
    ok(readyBody.queueBackend === 'bullmq', 'Worker health: queue backend exposed');
    ok(readyBody.redis?.available === true, 'Worker health: Redis availability exposed');
    ok(readyBody.highAvailability?.enabled === false, 'Worker health: HA disabled by default');

    const healthRes = await fetch(`http://127.0.0.1:${healthPort}/health`);
    ok(healthRes.status === 200, 'Worker health: /health returns 200');
    const healthBody = await healthRes.json() as any;
    ok(healthBody.status === 'healthy', 'Worker health: /health reports healthy');
    ok(healthBody.instanceId === 'worker-node-1', 'Worker health: instance id exposed on /health');

    worker.kill('SIGTERM');
    const exitResult = await new Promise<{ code: number | null; signal: NodeJS.Signals | null } | null>((resolve) => {
      worker.once('exit', (code, signal) => resolve({ code, signal }));
      setTimeout(() => resolve(null), 15000).unref();
    });
    ok(
      exitResult !== null && (exitResult.code === 0 || exitResult.signal === 'SIGTERM'),
      'Worker health: worker exits after shutdown signal',
    );

    const failingPort = await reservePort();
    const failing = spawnWorker('worker-ha-guard', failingPort, 'true');
    const outputChunks: Buffer[] = [];
    failing.stdout.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));
    failing.stderr.on('data', (chunk) => outputChunks.push(Buffer.from(chunk)));
    const failingExitCode = await new Promise<number | null>((resolve) => {
      failing.once('exit', (code) => resolve(code));
      setTimeout(() => resolve(null), 15000).unref();
    });
    const output = Buffer.concat(outputChunks).toString('utf8');
    ok(failingExitCode !== 0, 'Worker health: misconfigured HA startup exits non-zero');
    ok(output.includes('ATTESTOR_HA_MODE startup guard failed'), 'Worker health: HA guard explains startup failure');
    ok(output.includes('REDIS_URL-backed external Redis'), 'Worker health: HA guard mentions external Redis requirement');

    console.log(`  Live worker health tests: ${passed} passed, 0 failed`);
  } finally {
    if (!worker.killed) {
      worker.kill('SIGTERM');
    }
  }
}

main().catch((error) => {
  console.error('\nLive worker health tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
