import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { JobAssistantRuntime } from "../services/runtime.js";

const sourcePayloadSchema = z.object({
  label: z.string().trim().optional().default(""),
  seedUrl: z.string().trim().url("请输入有效的来源 URL。"),
  kind: z.enum(["greenhouse", "lever", "generic", "feishu_sheet"]).optional()
});

export const registerSourceRoutes = (
  app: FastifyInstance,
  runtime: JobAssistantRuntime
): void => {
  app.get("/api/sources", async () => runtime.listSources());

  app.post("/api/sources", async (request) => {
    const payload = sourcePayloadSchema.parse(request.body);
    return runtime.createSource(payload);
  });

  app.post("/api/sources/discover", async (request) => {
    const payload = z.object({ sourceId: z.string().optional() }).parse(request.body ?? {});
    return {
      jobs: await runtime.discoverSources(payload.sourceId)
    };
  });

  app.delete("/api/sources/:id", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    runtime.deleteSource(params.id);
    return { ok: true };
  });
};
