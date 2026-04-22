import type { FastifyInstance } from "fastify";
import type { Client as LibsqlClient } from "@libsql/client";
import type { RequestAuth } from "../auth/service.js";
import type { RunOrchestrator } from "../orchestrator/run-orchestrator.js";
import type { BackupRuntime } from "../platform/backups.js";
import type { PlatformLoadQueue } from "../platform/load-queue.js";
import type { EvidenceStore } from "./evidence-store.js";
import type { LiveStreamHub } from "./live-stream-hub.js";
import type { SseHub } from "./sse-hub.js";

export interface AppContext {
  dbClient: LibsqlClient;
  db: any;
  orchestrator: RunOrchestrator;
  evidenceStore: EvidenceStore;
  sseHub: SseHub;
  liveStreamHub: LiveStreamHub;
  runtimeBaseUrl: string;
  platformLoadQueue: PlatformLoadQueue;
  backupRuntime: BackupRuntime;
}

export interface AppFastify extends FastifyInstance {
  appContext: AppContext;
}

declare module "fastify" {
  interface FastifyRequest {
    auth: RequestAuth | null;
  }
}
