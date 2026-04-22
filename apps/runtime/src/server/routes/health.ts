import { getRuntimeReadinessStatus } from "../../platform/readiness.js";
import type { AppFastify } from "../types.js";

export const registerHealthRoutes = (app: AppFastify): void => {
  app.get("/health", async () => ({
    ok: true,
    service: "qpilot-runtime",
    ts: new Date().toISOString()
  }));

  app.get("/health/ready", async (_request, reply) => {
    const maintenance = await app.appContext.backupRuntime.getMaintenanceState();
    const readiness = await getRuntimeReadinessStatus({
      dbClient: app.appContext.dbClient,
      maintenance
    });

    return reply.status(readiness.ready ? 200 : 503).send(readiness);
  });
};
