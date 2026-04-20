import type { FastifyInstance } from "fastify";
import type { RunOrchestrator } from "../orchestrator/run-orchestrator.js";
import type { PlatformLoadQueue } from "../platform/load-queue.js";
import type { EvidenceStore } from "./evidence-store.js";
import type { LiveStreamHub } from "./live-stream-hub.js";
import type { SseHub } from "./sse-hub.js";

export interface AppContext {
  db: any;
  orchestrator: RunOrchestrator;
  evidenceStore: EvidenceStore;
  sseHub: SseHub;
  liveStreamHub: LiveStreamHub;
  runtimeBaseUrl: string;
  platformLoadQueue: PlatformLoadQueue;
}

export interface AppFastify extends FastifyInstance {
  appContext: AppContext;
}
