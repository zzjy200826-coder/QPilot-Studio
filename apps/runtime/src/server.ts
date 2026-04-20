import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { env, RUNTIME_ROOT } from "./config/env.js";
import { createDatabase, resolveDatabasePath } from "./db/client.js";
import { migrateDatabase } from "./db/migrate.js";
import { RunOrchestrator } from "./orchestrator/run-orchestrator.js";
import { executePersistedPlatformLoadRun } from "./platform/load-control-plane.js";
import { PlatformLoadQueue } from "./platform/load-queue.js";
import { EvidenceStore } from "./server/evidence-store.js";
import { LiveStreamHub } from "./server/live-stream-hub.js";
import { registerHealthRoutes } from "./server/routes/health.js";
import { registerLiveRoutes } from "./server/routes/live.js";
import { registerLoadRoutes } from "./server/routes/load.js";
import { registerPlatformRoutes } from "./server/routes/platform.js";
import { registerMetricsRoutes } from "./server/routes/metrics.js";
import { registerProjectRoutes } from "./server/routes/projects.js";
import { registerReportRoutes } from "./server/routes/reports.js";
import { registerRuntimeRoutes } from "./server/routes/runtime.js";
import { registerRunRoutes } from "./server/routes/runs.js";
import { SseHub } from "./server/sse-hub.js";
import type { AppFastify } from "./server/types.js";

const resolvePath = (value: string): string => resolve(RUNTIME_ROOT, value);

export const createServer = async (): Promise<AppFastify> => {
  const app = Fastify({ logger: true }) as unknown as AppFastify;

  const databasePath = resolveDatabasePath(env.DATABASE_URL, RUNTIME_ROOT);
  await migrateDatabase();
  const { client, db } = await createDatabase(databasePath);

  const artifactsRoot = resolvePath(env.ARTIFACTS_DIR);
  const reportsRoot = resolvePath(env.REPORTS_DIR);
  const sessionsRoot = resolvePath(env.SESSIONS_DIR);
  const plannerCacheRoot = resolvePath(env.PLANNER_CACHE_DIR);
  mkdirSync(artifactsRoot, { recursive: true });
  mkdirSync(reportsRoot, { recursive: true });
  mkdirSync(sessionsRoot, { recursive: true });
  mkdirSync(plannerCacheRoot, { recursive: true });

  const sseHub = new SseHub();
  const liveStreamHub = new LiveStreamHub();
  const evidenceStore = new EvidenceStore(artifactsRoot);
  const orchestrator = new RunOrchestrator({
    db,
    evidenceStore,
    sseHub,
    liveStreamHub,
    artifactsRoot,
    reportsRoot,
    sessionsRoot,
    plannerCacheRoot
  });
  const platformLoadQueue = new PlatformLoadQueue({
    redisUrl: env.PLATFORM_REDIS_URL,
    queueName: env.PLATFORM_REDIS_QUEUE_NAME,
    workerEnabled: env.PLATFORM_REDIS_WORKER_ENABLED,
    workerConcurrency: env.PLATFORM_REDIS_WORKER_CONCURRENCY,
    jobAttempts: env.PLATFORM_REDIS_JOB_ATTEMPTS,
    jobBackoffMs: env.PLATFORM_REDIS_JOB_BACKOFF_MS,
    workerHeartbeatTimeoutMs: env.PLATFORM_WORKER_HEARTBEAT_TIMEOUT_MS,
    processor: async ({ runId }) => {
      await executePersistedPlatformLoadRun({
        db,
        runId,
        heartbeatIntervalMs: env.PLATFORM_WORKER_HEARTBEAT_INTERVAL_MS
      });
    },
    log: {
      info: (message) => app.log.info(message),
      error: (message, error) => app.log.error({ error }, message)
    }
  });

  app.appContext = {
    db,
    orchestrator,
    evidenceStore,
    sseHub,
    liveStreamHub,
    runtimeBaseUrl: `http://${env.HOST}:${env.PORT}`,
    platformLoadQueue
  };

  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true
  });
  await app.register(websocket);

  await app.register(staticPlugin, {
    root: artifactsRoot,
    prefix: "/artifacts/"
  });

  await app.register(staticPlugin, {
    root: reportsRoot,
    prefix: "/reports/",
    decorateReply: false
  });

  registerHealthRoutes(app);
  registerLiveRoutes(app);
  registerLoadRoutes(app);
  registerMetricsRoutes(app);
  registerPlatformRoutes(app);
  registerProjectRoutes(app);
  registerRuntimeRoutes(app);
  registerRunRoutes(app);
  registerReportRoutes(app);

  app.addHook("onClose", async () => {
    sseHub.close();
    liveStreamHub.close();
    await platformLoadQueue.close();
    client.close();
  });

  return app;
};
