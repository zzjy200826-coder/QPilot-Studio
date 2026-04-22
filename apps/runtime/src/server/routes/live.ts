import { nanoid } from "nanoid";
import { z } from "zod";
import { getTenantRunRow } from "../../auth/tenant-access.js";
import type { AppFastify } from "../types.js";

const runIdParamsSchema = z.object({
  runId: z.string()
});

export const registerLiveRoutes = (app: AppFastify): void => {
  app.get(
    "/api/runs/:runId/live",
    { websocket: true },
    async (socket: any, request: any) => {
      const params = runIdParamsSchema.parse(request.params);
      const auth = request.auth;
      if (!auth) {
        socket.close(4401, "Authentication required.");
        return;
      }
      const runRow = await getTenantRunRow(app.appContext.db, auth.tenant.id, params.runId);
      if (!runRow) {
        socket.close(4404, "Run not found.");
        return;
      }
      const clientId = nanoid();

      app.appContext.liveStreamHub.subscribe(params.runId, clientId, socket);
      socket.on("close", () => {
        app.appContext.liveStreamHub.unsubscribe(params.runId, clientId);
      });
    }
  );
};
