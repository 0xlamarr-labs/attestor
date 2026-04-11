import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

let passed = 0;

function ok(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

async function main(): Promise<void> {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'attestor-ha-calibration-'));
  const outputPath = resolve(tempDir, 'result.json');
  const server = createServer((_req, res) => {
    res.setHeader('Connection', 'close');
    res.statusCode = 200;
    res.end('ok');
  });

  await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', () => resolvePromise()));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not resolve test server port.');
  }

  try {
    const runStatus = await new Promise<number>((resolvePromise, reject) => {
      const child = spawn(
        process.execPath,
        [
          'node_modules/tsx/dist/cli.mjs',
          'scripts/ha-calibrate.ts',
          `--url=http://127.0.0.1:${address.port}/health`,
          '--duration=2',
          '--concurrency=4',
          '--replicas=2',
          '--queue-delay=8',
          `--output=${outputPath}`,
        ],
        {
          cwd: resolve('.'),
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolvePromise(code ?? 0);
          return;
        }
        reject(new Error(stderr || `ha-calibrate exited with code ${code}`));
      });
    });

    ok(runStatus === 0, 'HA calibration: script exits successfully');
    const result = JSON.parse(readFileSync(outputPath, 'utf8')) as {
      replicas: number;
      successRate: number;
      errorRate: number;
      successCount: number;
      errorCount: number;
      suggestedApiPrometheusThreshold: number;
      suggestedWorkerRedisListThreshold: number;
    };
    ok(result.replicas === 2, 'HA calibration: benchmark records configured replica count');
    ok(result.successCount > 0, 'HA calibration: benchmark records successful requests');
    ok(result.errorCount === 0, 'HA calibration: benchmark records zero errors for healthy target');
    ok(result.successRate === 1 && result.errorRate === 0, 'HA calibration: benchmark records availability ratios');
    ok(result.suggestedApiPrometheusThreshold >= 1, 'HA calibration: API threshold suggestion is positive');
    ok(result.suggestedWorkerRedisListThreshold >= 1, 'HA calibration: worker backlog suggestion is positive');

    console.log(`\nHA calibration tests: ${passed} passed, 0 failed`);
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('\nHA calibration tests failed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
