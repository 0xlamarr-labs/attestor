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
  shutdown(): Promise<void>;
}

/**
 * Resolve a Redis connection using 3-tier fallback.
 */
export async function resolveRedis(): Promise<RedisResolution> {
  // Tier 1: REDIS_URL
  if (process.env.REDIS_URL) {
    let t1Conn: IORedis | null = null;
    try {
      const url = new URL(process.env.REDIS_URL);
      const host = url.hostname;
      const port = parseInt(url.port || '6379', 10);
      t1Conn = new IORedis({
        host, port,
        password: url.password || undefined,
        maxRetriesPerRequest: null,
        lazyConnect: true,
        connectTimeout: 2000,
        retryStrategy: () => null,
      });
      t1Conn.on('error', () => {}); // Suppress unhandled error events
      await Promise.race([
        t1Conn.connect().then(() => t1Conn!.ping()),
        new Promise<never>((_, reject) => {
          const t = setTimeout(() => reject(new Error('timeout')), 3000);
          if (typeof t.unref === 'function') t.unref();
        }),
      ]);
      const connection = t1Conn;
      return {
        connection,
        mode: 'external',
        host,
        port,
        async shutdown() {
          connection.disconnect();
        },
      };
    } catch {
      try { t1Conn?.disconnect(); } catch {}
    }
  }

  // Tier 2: localhost:6379 (fast probe with 1s timeout)
  {
    let probeConn: IORedis | null = null;
    try {
      probeConn = new IORedis({
        host: '127.0.0.1', port: 6379,
        maxRetriesPerRequest: null,
        lazyConnect: true,
        connectTimeout: 1000,
        retryStrategy: () => null,
      });
      // Suppress unhandled error events from ioredis (ECONNREFUSED, etc.)
      probeConn.on('error', () => {});
      await Promise.race([
        probeConn.connect().then(() => probeConn!.ping()),
        new Promise<never>((_, reject) => {
          const t = setTimeout(() => reject(new Error('timeout')), 1500);
          if (typeof t.unref === 'function') t.unref();
        }),
      ]);
      const connection = probeConn;
      return {
        connection,
        mode: 'localhost' as const,
        host: '127.0.0.1',
        port: 6379,
        async shutdown() {
          connection.disconnect();
        },
      };
    } catch {
      try { probeConn?.disconnect(); } catch {}
    }
  }

  // Tier 3: embedded redis-memory-server (with 10s timeout for first-run binary download)
  let embeddedServer: any = null;
  try {
    const rms = await import('redis-memory-server');
    const RedisMemoryServer = rms.RedisMemoryServer ?? (rms as any).default?.RedisMemoryServer;
    embeddedServer = new RedisMemoryServer();
    const startResult = await Promise.race([
      (async () => { const h = await embeddedServer.getHost(); const p = await embeddedServer.getPort(); return { host: h, port: p }; })(),
      new Promise<never>((_, reject) => {
        const t = setTimeout(() => reject(new Error('embedded Redis startup timeout (10s)')), 10000);
        if (typeof t.unref === 'function') t.unref();
      }),
    ]);
    const { host, port } = startResult;
    const conn = new IORedis({
      host, port,
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    conn.on('error', () => {}); // Suppress unhandled error events
    await conn.connect();
    await conn.ping();
    console.log(`[redis] Embedded Redis started on ${host}:${port} (dev mode — not for production)`);

    const shutdown = async () => {
      try { await conn.quit(); } catch { conn.disconnect(); }
      try { await embeddedServer.stop(); } catch {}
    };

    // Cleanup on process exit
    const cleanup = async () => { await shutdown(); };
    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);

    return {
      connection: conn,
      mode: 'embedded',
      host,
      port,
      shutdown,
    };
  } catch (err: any) {
    // Clean up embedded server if it was partially started
    if (embeddedServer) {
      try { await embeddedServer.stop(); } catch {}
    }
    throw new Error(
      `Redis required but unavailable.\n` +
      `  Tried: REDIS_URL (not set), localhost:6379 (not running), embedded (failed: ${err.message})\n` +
      `  Fix: set REDIS_URL, start local Redis, or install redis-memory-server`
    );
  }
}
