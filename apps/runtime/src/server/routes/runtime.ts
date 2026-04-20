import { eq } from "drizzle-orm";
import { runsTable } from "../../db/schema.js";
import { mapRunRow, type RunRow } from "../../utils/mappers.js";
import type { AppFastify } from "../types.js";

export const registerRuntimeRoutes = (app: AppFastify): void => {
  app.get("/api/runtime/active-run", async (_request, reply) => {
    const active = app.appContext.orchestrator.getActiveRunSnapshot();
    if (!active) {
      return {
        activeRun: null,
        control: null
      };
    }

    const runRows = await app.appContext.db
      .select()
      .from(runsTable)
      .where(eq(runsTable.id, active.runId))
      .limit(1);
    const runRow = runRows[0] as RunRow | undefined;

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
