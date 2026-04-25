/**
 * Redis Production Configuration — BullMQ Best Practices
 *
 * Production-grade Redis connection and queue configuration
 * based on 2025-2026 BullMQ v5 best practices research.
 *
 * Key rules:
 * - maxRetriesPerRequest: null (REQUIRED for BullMQ)
 * - Dedicated Redis instance (not cache Redis)
 * - Workers as separate processes from API
 * - removeOnComplete/removeOnFail with count limits
 * - Exponential backoff for retries
 * - Dead letter queue for exhausted jobs
 */

import { Queue, Worker, type Job } from 'bullmq';

export interface RedisProductionConfig {
  host: string;
  port: number;
  password?: string;
  /** Maximum retries per request — MUST be null for BullMQ. */
  maxRetriesPerRequest: null;
  enableReadyCheck: boolean;
  retryStrategy: (times: number) => number;
}

export function createProductionRedisConfig(url?: string): RedisProductionConfig {
  if (url) {
    try {
      const u = new URL(url);
      return {
        host: u.hostname,
        port: parseInt(u.port || '6379', 10),
        password: u.password || undefined,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        retryStrategy: (times: number) => Math.min(times * 200, 5000),
      };
    } catch { /* fall through */ }
  }
  return {
    host: 'localhost',
    port: 6379,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times: number) => Math.min(times * 200, 5000),
  };
}

export interface ProductionQueueOptions {
  /** Queue name. */
  name: string;
  /** Max retry attempts. Default: 5. */
  maxAttempts?: number;
  /** Backoff type. Default: exponential. */
  backoffType?: 'exponential' | 'fixed';
  /** Initial backoff delay in ms. Default: 2000. */
  backoffDelay?: number;
  /** Keep last N completed jobs. Default: 1000. */
  keepCompleted?: number;
  /** Keep last N failed jobs. Default: 5000. */
  keepFailed?: number;
  /** Rate limit: max jobs per duration. */
  rateLimit?: { max: number; duration: number };
  /** Worker concurrency. Default: 10. */
  concurrency?: number;
}

export function createProductionQueue(
  redisConfig: RedisProductionConfig,
  options: ProductionQueueOptions,
): Queue {
  return new Queue(options.name, {
    connection: redisConfig as any,
    defaultJobOptions: {
      attempts: options.maxAttempts ?? 5,
      backoff: {
        type: options.backoffType ?? 'exponential',
        delay: options.backoffDelay ?? 2000,
      },
      removeOnComplete: { count: options.keepCompleted ?? 1000 },
      removeOnFail: { count: options.keepFailed ?? 5000 },
    },
  });
}

export function createProductionWorker(
  redisConfig: RedisProductionConfig,
  queueName: string,
  processor: (job: Job) => Promise<any>,
  options?: { concurrency?: number; rateLimit?: { max: number; duration: number } },
): Worker {
  return new Worker(queueName, processor, {
    connection: redisConfig as any,
    concurrency: options?.concurrency ?? 10,
    limiter: options?.rateLimit,
  });
}
