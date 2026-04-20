import { Redis } from "ioredis";
import { Queue, Worker, type Job, type JobsOptions } from "bullmq";
import type { PlatformLoadQueueSummary } from "@qpilot/shared";

export interface PlatformLoadQueueJobPayload {
  runId: string;
}

interface PlatformLoadQueueOptions {
  redisUrl?: string;
  queueName: string;
  workerEnabled: boolean;
  workerConcurrency: number;
  jobAttempts: number;
  jobBackoffMs: number;
  workerHeartbeatTimeoutMs: number;
  processor: (payload: PlatformLoadQueueJobPayload) => Promise<void>;
  log?: {
    info: (message: string) => void;
    error: (message: string, error?: unknown) => void;
  };
}

export class PlatformLoadQueue {
  readonly mode: "inline" | "bullmq";
  readonly queueName: string;
  readonly workerEnabled: boolean;
  readonly workerConcurrency: number;
  readonly jobAttempts: number;
  readonly jobBackoffMs: number;
  readonly workerHeartbeatTimeoutMs: number;

  private readonly queue?: Queue<PlatformLoadQueueJobPayload>;
  private readonly worker?: Worker<PlatformLoadQueueJobPayload>;
  private readonly queueConnection?: Redis;
  private readonly workerConnection?: Redis;
  private lastActivityAt?: string;
  private lastError?: string;
  private readonly samples: Array<{
    ts: string;
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> = [];

  constructor(options: PlatformLoadQueueOptions) {
    this.queueName = options.queueName;
    this.workerEnabled = options.workerEnabled;
    this.workerConcurrency = options.workerConcurrency;
    this.jobAttempts = options.jobAttempts;
    this.jobBackoffMs = options.jobBackoffMs;
    this.workerHeartbeatTimeoutMs = options.workerHeartbeatTimeoutMs;

    if (!options.redisUrl) {
      this.mode = "inline";
      options.log?.info("Platform load queue is running in inline mode.");
      return;
    }

    this.mode = "bullmq";
    this.queueConnection = new Redis(options.redisUrl, {
      maxRetriesPerRequest: null
    });
    this.queue = new Queue<PlatformLoadQueueJobPayload>(options.queueName, {
      connection: this.queueConnection,
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 100,
        attempts: options.jobAttempts,
        backoff:
          options.jobBackoffMs > 0
            ? {
                type: "fixed",
                delay: options.jobBackoffMs
              }
            : undefined
      }
    });

    if (options.workerEnabled) {
      this.workerConnection = new Redis(options.redisUrl, {
        maxRetriesPerRequest: null
      });
      this.worker = new Worker<PlatformLoadQueueJobPayload>(
        options.queueName,
        async (job: Job<PlatformLoadQueueJobPayload>) => {
          await options.processor(job.data);
        },
        {
          connection: this.workerConnection,
          concurrency: options.workerConcurrency
        }
      );

      this.worker.on("completed", (job) => {
        this.lastActivityAt = new Date().toISOString();
        options.log?.info(`Platform load worker completed job ${job.id}.`);
      });
      this.worker.on("failed", (job, error) => {
        this.lastActivityAt = new Date().toISOString();
        this.lastError = error instanceof Error ? error.message : String(error);
        options.log?.error(
          `Platform load worker failed job ${job?.id ?? "unknown"}.`,
          error
        );
      });
    }

    options.log?.info(
      `Platform load queue is using BullMQ (${options.queueName}) with worker ${
        options.workerEnabled ? "enabled" : "disabled"
      }.`
    );
  }

  get isAvailable(): boolean {
    return this.mode === "bullmq" && Boolean(this.queue);
  }

  async enqueue(payload: PlatformLoadQueueJobPayload): Promise<{ mode: "inline" | "bullmq"; jobId?: string }> {
    if (!this.queue) {
      return { mode: "inline" };
    }

    const jobOptions: JobsOptions = {
      jobId: payload.runId
    };
    const job = await this.queue.add("platform-load-run", payload, jobOptions);
    this.lastActivityAt = new Date().toISOString();
    return { mode: "bullmq", jobId: job.id?.toString() };
  }

  async cancel(runId: string): Promise<{ ok: boolean; detail: string }> {
    if (!this.queue) {
      this.lastActivityAt = new Date().toISOString();
      return {
        ok: true,
        detail: `Inline mode acknowledged cancellation for queued run ${runId}.`
      };
    }

    const job = await this.queue.getJob(runId);
    if (!job) {
      return {
        ok: false,
        detail: "The queued job could not be found. It may already be active or completed."
      };
    }

    const state = await job.getState();
    if (state === "active") {
      return {
        ok: false,
        detail: "The run is already active and cannot be removed from the queue."
      };
    }

    await job.remove();
    this.lastActivityAt = new Date().toISOString();
    return {
      ok: true,
      detail: "The queued run was removed from BullMQ."
    };
  }

  private recordSample(counts: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }): void {
    this.samples.push({
      ts: new Date().toISOString(),
      ...counts
    });
    if (this.samples.length > 20) {
      this.samples.splice(0, this.samples.length - 20);
    }
  }

  async getSummary(): Promise<PlatformLoadQueueSummary> {
    const checkedAt = new Date().toISOString();

    if (!this.queue) {
      this.recordSample({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0
      });
      return {
        mode: "inline",
        queueName: this.queueName,
        workerEnabled: this.workerEnabled,
        workerConcurrency: this.workerConcurrency,
        isConnected: false,
        counts: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0
        },
        retryPolicy: {
          attempts: this.jobAttempts,
          backoffMs: this.jobBackoffMs
        },
        workerHealth: {
          timeoutMs: this.workerHeartbeatTimeoutMs,
          busyWorkers: 0,
          staleWorkers: 0,
          freshestHeartbeatAt: undefined
        },
        detail: "Redis is not configured, so the platform is executing load runs inline.",
        lastActivityAt: this.lastActivityAt,
        lastError: this.lastError,
        samples: [...this.samples],
        checkedAt
      };
    }

    try {
      const counts = await this.queue.getJobCounts(
        "waiting",
        "active",
        "completed",
        "failed",
        "delayed"
      );
      const isConnected = this.queueConnection?.status === "ready";
      const normalizedCounts = {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0
      };
      this.recordSample(normalizedCounts);

      return {
        mode: "bullmq",
        queueName: this.queueName,
        workerEnabled: this.workerEnabled,
        workerConcurrency: this.workerConcurrency,
        isConnected,
        counts: normalizedCounts,
        retryPolicy: {
          attempts: this.jobAttempts,
          backoffMs: this.jobBackoffMs
        },
        workerHealth: {
          timeoutMs: this.workerHeartbeatTimeoutMs,
          busyWorkers: 0,
          staleWorkers: 0,
          freshestHeartbeatAt: undefined
        },
        detail: isConnected
          ? "BullMQ is connected and can dispatch platform load runs."
          : "BullMQ is configured, but the Redis connection is not currently ready.",
        lastActivityAt: this.lastActivityAt,
        lastError: this.lastError,
        samples: [...this.samples],
        checkedAt
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to query queue health.";
      this.lastError = message;
      this.recordSample({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0
      });

      return {
        mode: "bullmq",
        queueName: this.queueName,
        workerEnabled: this.workerEnabled,
        workerConcurrency: this.workerConcurrency,
        isConnected: false,
        counts: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0
        },
        retryPolicy: {
          attempts: this.jobAttempts,
          backoffMs: this.jobBackoffMs
        },
        workerHealth: {
          timeoutMs: this.workerHeartbeatTimeoutMs,
          busyWorkers: 0,
          staleWorkers: 0,
          freshestHeartbeatAt: undefined
        },
        detail: "BullMQ is configured, but queue health could not be read from Redis.",
        lastActivityAt: this.lastActivityAt,
        lastError: message,
        samples: [...this.samples],
        checkedAt
      };
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled([
      this.worker?.close(),
      this.queue?.close(),
      this.workerConnection?.quit(),
      this.queueConnection?.quit()
    ]);
  }
}
