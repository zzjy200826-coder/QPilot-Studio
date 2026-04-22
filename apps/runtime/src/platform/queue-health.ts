import { desc, eq } from "drizzle-orm";
import {
  PlatformLoadQueueSummarySchema,
  type InjectorWorker,
  type PlatformLoadQueueSummary
} from "@qpilot/shared";
import { env } from "../config/env.js";
import { injectorWorkersTable } from "../db/schema.js";
import { recoverTimedOutPlatformLoadRuns } from "./load-control-plane.js";
import { summarizeInjectorWorkerHealth } from "./worker-heartbeat.js";
import { mapInjectorWorkerRow, type InjectorWorkerRow } from "../utils/mappers.js";

export const listInjectorWorkers = async (
  db: any,
  tenantId: string
): Promise<InjectorWorker[]> => {
  const rows = (await db
    .select()
    .from(injectorWorkersTable)
    .where(eq(injectorWorkersTable.tenantId, tenantId))
    .orderBy(desc(injectorWorkersTable.updatedAt))) as InjectorWorkerRow[];

  return rows.map(mapInjectorWorkerRow);
};

export const buildPlatformQueueSummary = async (input: {
  db: any;
  platformLoadQueue: {
    getSummary: () => Promise<PlatformLoadQueueSummary>;
  };
  tenantId: string;
}): Promise<PlatformLoadQueueSummary> => {
  await recoverTimedOutPlatformLoadRuns({
    db: input.db,
    heartbeatTimeoutMs: env.PLATFORM_WORKER_HEARTBEAT_TIMEOUT_MS
  });

  const queueSummary = await input.platformLoadQueue.getSummary();
  const injectorWorkers = await listInjectorWorkers(input.db, input.tenantId);

  return PlatformLoadQueueSummarySchema.parse({
    ...queueSummary,
    workerHealth: summarizeInjectorWorkerHealth({
      workers: injectorWorkers,
      timeoutMs: env.PLATFORM_WORKER_HEARTBEAT_TIMEOUT_MS
    })
  });
};
