import {
  DeployConfigStatusSchema,
  DeployOperationSchema
} from "@qpilot/shared";
import { z } from "zod";
import { requireMinimumRole } from "../../auth/guards.js";
import type { AppFastify } from "../types.js";

const deployRunSchema = z.object({
  ref: z.string().trim().min(1).max(120).optional()
});

const operationParamsSchema = z.object({
  operationId: z.string().trim().min(1)
});

export const registerDeployRoutes = (app: AppFastify): void => {
  app.get("/api/platform/ops/deploy/config", async (request, reply) => {
    const auth = requireMinimumRole(request, reply, "owner");
    if (!auth) {
      return;
    }
    return DeployConfigStatusSchema.parse(await app.appContext.deployRuntime.getConfigStatus());
  });

  app.post("/api/platform/ops/deploy/run", async (request, reply) => {
    const auth = requireMinimumRole(request, reply, "owner");
    if (!auth) {
      return;
    }
    try {
      const payload = deployRunSchema.parse(request.body ?? {});
      return DeployOperationSchema.parse(
        await app.appContext.deployRuntime.startDeploy({
          ref: payload.ref,
          triggeredBy: auth.user.displayName ?? auth.user.email
        })
      );
    } catch (error) {
      return reply
        .status(409)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/platform/ops/deploy/operations/:operationId", async (request, reply) => {
    const auth = requireMinimumRole(request, reply, "owner");
    if (!auth) {
      return;
    }
    const params = operationParamsSchema.parse(request.params);
    const operation = await app.appContext.deployRuntime.getOperation(params.operationId);
    if (!operation) {
      return reply.status(404).send({ error: "Deploy operation not found." });
    }
    return DeployOperationSchema.parse(operation);
  });
};
