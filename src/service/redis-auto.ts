/**
 * Redis Auto-Provision — Unconditional BullMQ Backend
 *
 * Three-tier Redis resolution:
 * 1. REDIS_URL environment variable (production)
 * 2. Probe localhost:6379 (local Redis running)
 * 3. Embedded redis-memory-server (zero-config dev/CI)
 *
 * BullMQ requires a REAL Redis process (ioredis-mock does not work).
 * redis-memory-server downloads and runs a real Redis binary.
 *
 * BOUNDARY:
 * - Embedded Redis is NOT for production
 * - Windows uses Memurai binary (auto-downloaded)
 * - First run: 30-60s download; subsequent: cached
 */

import IORedis from 'ioredis';

export interface RedisResolution {
  connection: IORedis;
  mode: 'external' | 'localhost' | 'embedded';
  host: string;
  port: number;
}

/**
 * Resolve a Redis connection using 3-tier fallback.
 */
export async function resolveRedis(): Promise<RedisResolution> {
  // Tier 1: REDIS_URL
  if (process.env.REDIS_URL) {
    try {
      const url = new URL(process.env.REDIS_URL);
      const host = url.hostname;
      const port = parseInt(url.port || '6379', 10);
      const conn = new IORedis({
        host, port,
        password: url.password || undefined,
        maxRetriesPerRequest: null,
        lazyConnect: true,
        connectTimeout: 2000,
        retryStrategy: () => null,
      });
      await Promise.race([
        conn.connect().then(() => conn.ping()),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);
      return { connection: conn, mode: 'external', host, port };
    } catch { /* fall through */ }
  }

  // Tier 2: localhost:6379 (fast probe with 1s timeout)
  try {
    const conn = new IORedis({
      host: '127.0.0.1', port: 6379,
      maxRetriesPerRequest: null,
      lazyConnect: true,
      connectTimeout: 1000,
      retryStrategy: () => null, // no retries — fail fast
    });
    await Promise.race([
      conn.connect().then(() => conn.ping()),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500)),
    ]);
    return { connection: conn, mode: 'localhost', host: '127.0.0.1', port: 6379 };
  } catch {
    // localhost Redis not available — fall through
  }

  // Tier 3: embedded redis-memory-server
  try {
    const rms = await (Function('return import("redis-memory-server")')() as Promise<any>);
    const RedisMemoryServer = rms.RedisMemoryServer ?? rms.default?.RedisMemoryServer;
    const server = new RedisMemoryServer();
    const host = await server.getHost();
    const port = await server.getPort();
    const conn = new IORedis({
      host, port,
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    await conn.connect();
    await conn.ping();
    console.log(`[redis] Embedded Redis started on ${host}:${port} (dev mode — not for production)`);

    // Cleanup on process exit
    process.on('SIGTERM', async () => { try { await server.stop(); } catch {} });
    process.on('SIGINT', async () => { try { await server.stop(); } catch {} });

    return { connection: conn, mode: 'embedded', host, port };
  } catch (err: any) {
    throw new Error(
      `Redis required but unavailable.\n` +
      `  Tried: REDIS_URL (not set), localhost:6379 (not running), embedded (failed: ${err.message})\n` +
      `  Fix: set REDIS_URL, start local Redis, or install redis-memory-server`
    );
  }
}
