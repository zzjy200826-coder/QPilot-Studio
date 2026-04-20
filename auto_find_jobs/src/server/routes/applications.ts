import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { JobAssistantRuntime } from "../services/runtime.js";
import type { ApplicationEventHub } from "../events.js";
import { DuplicateApplicationError } from "../services/runtime.js";

export const registerApplicationRoutes = (
  app: FastifyInstance,
  runtime: JobAssistantRuntime,
  eventHub: ApplicationEventHub
): void => {
  app.post("/api/applications/direct-prepare", async (request, reply) => {
    const payload = z
      .object({
        applyUrl: z.string().url(),
        ats: z.enum(["greenhouse", "lever", "moka", "portal"]).optional(),
        title: z.string().optional(),
        company: z.string().optional(),
        location: z.string().optional(),
        submissionMode: z.enum(["submit_enabled", "prefill_only"]).optional(),
        automationMode: z.enum(["manual", "safe_auto_apply"]).optional()
      })
      .parse(request.body);

    try {
      return await runtime.prepareDirectApplication(payload);
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

  app.get("/api/applications", async (request) => {
    const query = z
      .object({
        status: z
          .string()
          .optional()
          .transform((value) => value?.split(",").filter(Boolean))
      })
      .parse(request.query);
    return runtime.listAttempts(query.status);
  });

  app.get("/api/applications/:attemptId", async (request, reply) => {
    const params = z.object({ attemptId: z.string() }).parse(request.params);
    const attempt = runtime.getAttempt(params.attemptId);
    if (!attempt) {
      return reply.status(404).send({ error: "未找到对应的申请尝试。" });
    }
    return attempt;
  });

  app.get("/api/applications/:attemptId/events", async (request) => {
    const params = z.object({ attemptId: z.string() }).parse(request.params);
    return runtime.listEvents(params.attemptId);
  });

  app.post("/api/applications/:attemptId/review", async (request) => {
    const params = z.object({ attemptId: z.string() }).parse(request.params);
    const payload = z
      .object({
        resolutions: z.array(
          z.object({
            fieldId: z.string(),
            value: z.string()
          })
        )
      })
      .parse(request.body);
    return runtime.saveReview(params.attemptId, payload.resolutions);
  });

  app.post("/api/applications/:attemptId/start", async (request) => {
    const params = z.object({ attemptId: z.string() }).parse(request.params);
    return runtime.startApplication(params.attemptId);
  });

  app.post("/api/applications/:attemptId/resume", async (request) => {
    const params = z.object({ attemptId: z.string() }).parse(request.params);
    return runtime.resumeApplication(params.attemptId);
  });

  app.post("/api/applications/:attemptId/confirm-submit", async (request) => {
    const params = z.object({ attemptId: z.string() }).parse(request.params);
    return runtime.confirmSubmit(params.attemptId);
  });

  app.post("/api/applications/:attemptId/enable-final-submit", async (request) => {
    const params = z.object({ attemptId: z.string() }).parse(request.params);
    return runtime.enableFinalSubmit(params.attemptId);
  });

  app.get("/api/applications/:attemptId/stream", async (request, reply) => {
    const params = z.object({ attemptId: z.string() }).parse(request.params);
    const clientId = randomUUID();

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no"
    });

    eventHub.subscribe(params.attemptId, clientId, reply.raw);
    reply.raw.write(
      `event: connected\ndata: ${JSON.stringify({
        attemptId: params.attemptId,
        clientId,
        ts: new Date().toISOString()
      })}\n\n`
    );

    request.raw.on("close", () => {
      eventHub.unsubscribe(params.attemptId, clientId);
    });
  });
};
