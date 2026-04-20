import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { JobAssistantRuntime } from "../services/runtime.js";

export const registerProfileRoutes = (
  app: FastifyInstance,
  runtime: JobAssistantRuntime
): void => {
  app.get("/api/profile", async () => runtime.getProfile());

  app.put("/api/profile", async (request) => {
    const payload = z.record(z.string(), z.unknown()).parse(request.body);
    return runtime.saveProfile(payload as never);
  });
};
