import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import {
  checkApiRateLimit,
  formatRetryAfterSeconds,
  getRequestIp,
  resolveRequestAuth
} from "./auth/service.js";
import { env, RUNTIME_ROOT } from "./config/env.js";
import { createDatabase, resolveDatabasePath } from "./db/client.js";
import { migrateDatabase } from "./db/migrate.js";
import { RunOrchestrator } from "./orchestrator/run-orchestrator.js";
import { BackupRuntime } from "./platform/backups.js";
import { executePersistedPlatformLoadRun } from "./platform/load-control-plane.js";
import { PlatformLoadQueue } from "./platform/load-queue.js";
import { startOpsAlertMonitor } from "./platform/ops-alerts.js";
import { EvidenceStore } from "./server/evidence-store.js";
import { registerAuthRoutes } from "./server/routes/auth.js";
import { registerFileRoutes } from "./server/routes/files.js";
import { LiveStreamHub } from "./server/live-stream-hub.js";
import { registerHealthRoutes } from "./server/routes/health.js";
import { registerBackupRoutes } from "./server/routes/backups.js";
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
  const allowedCorsOrigins = env.CORS_ORIGIN.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

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
  const backupRuntime = new BackupRuntime({
    orchestrator,
    platformLoadQueue,
    logger: app.log
  });

  app.appContext = {
    dbClient: client,
    db,
    orchestrator,
    evidenceStore,
    sseHub,
    liveStreamHub,
    runtimeBaseUrl: `http://${env.HOST}:${env.PORT}`,
    platformLoadQueue,
    backupRuntime
  };
  const stopOpsAlertMonitor = startOpsAlertMonitor({
    db,
    dbClient: client,
    platformLoadQueue,
    maintenanceState: () => backupRuntime.getMaintenanceState(),
    logger: app.log
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || allowedCorsOrigins.length === 0 || allowedCorsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed by CORS"), false);
    },
    credentials: true
  });
  await app.register(websocket);

  app.addHook("onRequest", async (request, reply) => {
    request.auth = null;
    const pathname = request.raw.url?.split("?")[0] ?? "";
    const isAuthRoute = pathname.startsWith("/api/auth");
    const isRuntimeMaintenanceRoute = pathname === "/api/runtime/maintenance";
    const isPublicRoute =
      pathname === "/health" || isAuthRoute || isRuntimeMaintenanceRoute;
    const isMaintenanceBypassRoute =
      pathname === "/health" ||
      pathname === "/health/ready" ||
      pathname === "/metrics" ||
      isRuntimeMaintenanceRoute;
    const shouldRateLimit =
      (pathname.startsWith("/api/") || pathname.startsWith("/artifacts/") || pathname.startsWith("/reports/")) &&
      !isPublicRoute;

    const maintenance = await backupRuntime.getMaintenanceState();
    if (maintenance?.active && !isMaintenanceBypassRoute) {
      return reply.status(503).send({
        error: maintenance.message,
        maintenance
      });
    }

    if (shouldRateLimit) {
      const rateLimit = checkApiRateLimit(
        `${getRequestIp(request) ?? "unknown"}:${pathname.split("/").slice(0, 4).join("/")}`
      );
      if (!rateLimit.allowed) {
        reply.header("Retry-After", String(formatRetryAfterSeconds(rateLimit.retryAfterMs)));
        return reply.status(429).send({ error: "Too many requests. Please retry shortly." });
      }
    }

    request.auth = await resolveRequestAuth(db, request);

    if (
      !isPublicRoute &&
      (pathname.startsWith("/api/") || pathname.startsWith("/artifacts/") || pathname.startsWith("/reports/")) &&
      !request.auth
    ) {
      return reply.status(401).send({ error: "Authentication required." });
    }
  });

  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerFileRoutes(app, {
    artifactsRoot,
    reportsRoot
  });
  registerLiveRoutes(app);
  registerLoadRoutes(app);
  registerMetricsRoutes(app);
  registerPlatformRoutes(app);
  registerBackupRoutes(app);
  registerProjectRoutes(app);
  registerRuntimeRoutes(app);
  registerRunRoutes(app);
  registerReportRoutes(app);

  app.addHook("onClose", async () => {
    sseHub.close();
    liveStreamHub.close();
    stopOpsAlertMonitor();
    await platformLoadQueue.close();
    client.close();
  });

  return app;
};
