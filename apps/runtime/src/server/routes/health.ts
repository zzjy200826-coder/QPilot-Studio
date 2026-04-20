import type { AppFastify } from "../types.js";

export const registerHealthRoutes = (app: AppFastify): void => {
  app.get("/health", async () => ({
    ok: true,
    service: "qpilot-runtime",
    ts: new Date().toISOString()
  }));
};
