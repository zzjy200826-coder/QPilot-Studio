import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { JobAssistantRuntime } from "../services/runtime.js";
import { DuplicateApplicationError } from "../services/runtime.js";

export const registerJobRoutes = (
  app: FastifyInstance,
  runtime: JobAssistantRuntime
): void => {
  app.get("/api/jobs", async (request) => {
    const query = z
      .object({
        status: z.enum(["new", "seen", "applied", "skipped"]).optional(),
        query: z.string().optional()
      })
      .parse(request.query);
    return runtime.listJobs(query);
  });

  app.post("/api/jobs/:jobId/prepare", async (request, reply) => {
    const params = z.object({ jobId: z.string() }).parse(request.params);
    const payload = z
      .object({
        automationMode: z.enum(["manual", "safe_auto_apply"]).optional(),
        submissionMode: z.enum(["submit_enabled", "prefill_only"]).optional()
      })
      .parse(request.body ?? {});
    try {
      return await runtime.prepareApplication(params.jobId, payload);
    } catch (error) {
      if (error instanceof DuplicateApplicationError) {
        return reply.status(error.statusCode).send({
          code: error.code,
          message: error.message,
          existingAttempt: error.existingAttempt
        });
      }
      throw error;
    }
  });

  app.post("/api/jobs/:jobId/status", async (request) => {
    const params = z.object({ jobId: z.string() }).parse(request.params);
    const payload = z
      .object({
        status: z.enum(["new", "seen", "applied", "skipped"])
      })
      .parse(request.body);
    runtime.updateJobStatus(params.jobId, payload.status);
    return { ok: true };
  });
};
