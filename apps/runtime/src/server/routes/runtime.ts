import { eq } from "drizzle-orm";
import { RuntimeMaintenanceStatusSchema } from "@qpilot/shared";
import { requireAuth } from "../../auth/guards.js";
import { getTenantRunRow } from "../../auth/tenant-access.js";
import { runsTable } from "../../db/schema.js";
import { mapRunRow, type RunRow } from "../../utils/mappers.js";
import type { AppFastify } from "../types.js";

export const registerRuntimeRoutes = (app: AppFastify): void => {
  app.get("/api/runtime/maintenance", async () => {
    const maintenance = await app.appContext.backupRuntime.getMaintenanceState();
    const operation =
      maintenance?.operationId
        ? await app.appContext.backupRuntime.getOperation(maintenance.operationId)
        : null;

    return RuntimeMaintenanceStatusSchema.parse({
      active: maintenance?.active ?? false,
      checkedAt: new Date().toISOString(),
      maintenance,
      operation
    });
  });

  app.get("/api/runtime/active-run", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) {
      return;
    }
    const active = app.appContext.orchestrator.getActiveRunSnapshot();
    if (!active) {
      return {
        activeRun: null,
        control: null
      };
    }

    const runRow = await getTenantRunRow(app.appContext.db, auth.tenant.id, active.runId);

    if (!runRow) {
      return reply.status(404).send({
        activeRun: null,
        control: null
      });
    }

    const mappedRun = mapRunRow(runRow);
    if (mappedRun.status !== "running") {
      return {
        activeRun: null,
        control: null
      };
    }

    return {
      activeRun: {
        ...mappedRun,
        executionMode: active.control.executionMode ?? mappedRun.executionMode
      },
      control: active.control
    };
  });
};
