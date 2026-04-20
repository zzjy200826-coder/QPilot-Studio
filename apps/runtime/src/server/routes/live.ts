import { nanoid } from "nanoid";
import { z } from "zod";
import type { AppFastify } from "../types.js";

const runIdParamsSchema = z.object({
  runId: z.string()
});

export const registerLiveRoutes = (app: AppFastify): void => {
  app.get(
    "/api/runs/:runId/live",
    { websocket: true },
    (socket: any, request: any) => {
      const params = runIdParamsSchema.parse(request.params);
      const clientId = nanoid();

      app.appContext.liveStreamHub.subscribe(params.runId, clientId, socket);
      socket.on("close", () => {
        app.appContext.liveStreamHub.unsubscribe(params.runId, clientId);
      });
    }
  );
};
