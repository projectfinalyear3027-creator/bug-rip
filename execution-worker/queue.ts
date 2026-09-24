/**
 * BUG RIP - Execution Queue System (Fragment 8)
 * 
 * Implements BullMQ queue backed by Redis with automatic fallback to
 * in-memory async processing when Redis is not running (e.g. isolated test environments).
 */

import { Queue, Worker, Job } from 'bullmq';
import { EventEmitter } from 'events';
import IORedis from 'ioredis';
import { ExecutionJobPayload, ExecutionResult } from './types';

export const EXECUTION_QUEUE_NAME = 'java-execution';

export class ExecutionQueueManager extends EventEmitter {
  private queue: Queue | null = null;
  private redisConnection: IORedis | null = null;
  private isRedisAvailable: boolean = false;
  private inMemoryQueue: ExecutionJobPayload[] = [];
  private jobHandler?: (payload: ExecutionJobPayload) => Promise<ExecutionResult>;

  constructor() {
    super();
  }

  /**
   * Initialize Queue connection (attempts Redis/BullMQ, falls back to in-memory in development only)
   */
  public async initialize(): Promise<{ mode: 'redis' | 'in-memory' }> {
    const isProduction = process.env.NODE_ENV === 'production';
    const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    const forceInMemory = process.env.EXECUTION_IN_MEMORY === 'true';

    if (forceInMemory) {
      if (isProduction) {
        throw new Error(
          '[ExecutionQueue] FATAL CONFIGURATION ERROR: EXECUTION_IN_MEMORY=true is forbidden in production environment. Redis is mandatory.'
        );
      }
      this.isRedisAvailable = false;
      return { mode: 'in-memory' };
    }

    try {
      const client = new IORedis(redisUrl, {
        maxRetriesPerRequest: null,
        connectTimeout: 2500,
        retryStrategy: isProduction ? (times) => (times <= 3 ? Math.min(times * 500, 2000) : null) : () => null,
        lazyConnect: true,
      });

      // Attach error handler to prevent unhandled EventEmitter error during connection checks
      client.on('error', () => {});

      await client.connect();
      const ping = await client.ping();

      if (ping === 'PONG') {
        this.redisConnection = client;
        this.isRedisAvailable = true;

        const connectionOpts = {
          host: client.options.host || '127.0.0.1',
          port: client.options.port || 6379,
          maxRetriesPerRequest: null,
        };

        this.queue = new Queue(EXECUTION_QUEUE_NAME, {
          connection: connectionOpts,
          defaultJobOptions: {
            attempts: 1,
            removeOnComplete: true,
            removeOnFail: 100,
          },
        });

        return { mode: 'redis' };
      }
    } catch (err: any) {
      if (isProduction) {
        throw new Error(
          `[ExecutionQueue] CRITICAL INFRASTRUCTURE FAILURE: Redis is mandatory in production (NODE_ENV=production). Failed to connect to Redis at ${redisUrl}: ${err?.message || 'Connection refused'}. In-memory fallback is disabled in production.`
        );
      }
      // In development, safely fall back to in-memory queue
      console.warn(`[ExecutionQueue] Redis unavailable in development (${err?.message || 'Connection refused'}). Falling back to in-memory queue.`);
    }

    if (isProduction) {
      throw new Error(
        `[ExecutionQueue] CRITICAL INFRASTRUCTURE FAILURE: Redis is mandatory in production (NODE_ENV=production). In-memory fallback is disabled.`
      );
    }

    this.isRedisAvailable = false;
    return { mode: 'in-memory' };
  }

  /**
   * Register the worker processing function
   */
  public registerWorkerHandler(handler: (payload: ExecutionJobPayload) => Promise<ExecutionResult>) {
    this.jobHandler = handler;

    if (this.isRedisAvailable && this.redisConnection) {
      new Worker(
        EXECUTION_QUEUE_NAME,
        async (job: Job<ExecutionJobPayload>) => {
          return await handler(job.data);
        },
        {
          connection: {
            host: this.redisConnection.options.host || '127.0.0.1',
            port: this.redisConnection.options.port || 6379,
            maxRetriesPerRequest: null,
          },
          concurrency: 2,
        }
      );
    }
  }

  /**
   * Enqueue an execution job
   */
  public async enqueue(payload: ExecutionJobPayload): Promise<{ jobId: string }> {
    const jobId = payload.jobId || payload.submissionId;

    if (this.isRedisAvailable && this.queue) {
      await this.queue.add('execute-java', payload, { jobId });
      this.emit('job:enqueued', payload);
      return { jobId };
    }

    // In-memory queue processing
    this.inMemoryQueue.push(payload);
    this.emit('job:enqueued', payload);

    // Process asynchronously on next tick so callers receive immediate submission response
    setImmediate(async () => {
      const nextJob = this.inMemoryQueue.shift();
      if (nextJob && this.jobHandler) {
        try {
          await this.jobHandler(nextJob);
        } catch (err) {
          console.error('[InMemoryQueue] Job handler failed:', err);
        }
      }
    });

    return { jobId };
  }

  /**
   * Check queue mode
   */
  public getMode(): 'redis' | 'in-memory' {
    return this.isRedisAvailable ? 'redis' : 'in-memory';
  }

  /**
   * Close queue connections gracefully
   */
  public async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
    }
    if (this.redisConnection) {
      await this.redisConnection.quit();
    }
  }
}

export const executionQueue = new ExecutionQueueManager();
