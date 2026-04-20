import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { JobAssistantRuntime } from "../services/runtime.js";

const answerPayloadSchema = z.object({
  id: z.string().optional(),
  label: z.string(),
  questionKey: z.string(),
  answer: z.string(),
  synonyms: z.array(z.string()).default([])
});

export const registerAnswerRoutes = (
  app: FastifyInstance,
  runtime: JobAssistantRuntime
): void => {
  app.get("/api/answers", async () => runtime.listAnswers());

  app.post("/api/answers", async (request) => {
    const payload = answerPayloadSchema.parse(request.body);
    return runtime.upsertAnswer(payload);
  });

  app.delete("/api/answers/:id", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    runtime.deleteAnswer(params.id);
    return { ok: true };
  });
};
