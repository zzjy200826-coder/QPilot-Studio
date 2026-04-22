import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../../auth/guards.js";
import { getTenantRunRow } from "../../auth/tenant-access.js";
import { reportsTable, runsTable } from "../../db/schema.js";
import type { AppFastify } from "../types.js";

export const registerReportRoutes = (app: AppFastify): void => {
  app.get("/api/reports/:runId", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) {
      return;
    }
    const params = z.object({ runId: z.string() }).parse(request.params);
    const runRow = await getTenantRunRow(app.appContext.db, auth.tenant.id, params.runId);
    if (!runRow) {
      return reply.status(404).send({ error: "Run not found." });
    }
    const rows = await app.appContext.db
      .select({
        report: reportsTable,
        run: runsTable
      })
      .from(reportsTable)
      .innerJoin(runsTable, eq(reportsTable.runId, runsTable.id))
      .where(eq(reportsTable.runId, params.runId))
      .limit(1);
    const record = rows[0];
    if (!record) {
      return reply.status(404).send({ error: "Report not found yet" });
    }
    return {
      runId: record.report.runId,
      htmlPath: record.report.htmlPath,
      xlsxPath: record.report.xlsxPath,
      videoPath: record.run.recordedVideoPath ?? undefined,
      challengeKind: record.run.challengeKind ?? undefined,
      challengeReason: record.run.challengeReason ?? undefined,
      createdAt: new Date(record.report.createdAt).toISOString()
    };
  });
};
