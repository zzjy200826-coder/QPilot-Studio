import {
  BackupConfigStatusSchema,
  BackupOperationSchema,
  BackupPreflightResultSchema,
  BackupSnapshotSchema
} from "@qpilot/shared";
import { z } from "zod";
import { requireMinimumRole } from "../../auth/guards.js";
import type { AppFastify } from "../types.js";

const snapshotIdSchema = z.object({
  snapshotId: z.string().trim().min(1)
});

const operationIdParamsSchema = z.object({
  operationId: z.string().trim().min(1)
});

export const registerBackupRoutes = (app: AppFastify): void => {
  app.get("/api/platform/ops/backups/config", async (request, reply) => {
    const auth = requireMinimumRole(request, reply, "owner");
    if (!auth) {
      return;
    }
    return BackupConfigStatusSchema.parse(
      await app.appContext.backupRuntime.getConfigStatus()
    );
  });

  app.get("/api/platform/ops/backups/snapshots", async (request, reply) => {
    const auth = requireMinimumRole(request, reply, "owner");
    if (!auth) {
      return;
    }
    const snapshots = await app.appContext.backupRuntime.listSnapshots();
    return snapshots.map((snapshot) => BackupSnapshotSchema.parse(snapshot));
  });

  app.post("/api/platform/ops/backups/run", async (request, reply) => {
    const auth = requireMinimumRole(request, reply, "owner");
    if (!auth) {
      return;
    }
    try {
      return BackupOperationSchema.parse(
        await app.appContext.backupRuntime.createManualBackup(
          auth.user.displayName ?? auth.user.email
        )
      );
    } catch (error) {
      return reply
        .status(409)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/platform/ops/backups/preflight", async (request, reply) => {
    const auth = requireMinimumRole(request, reply, "owner");
    if (!auth) {
      return;
    }
    try {
      const payload = snapshotIdSchema.parse(request.body);
      return BackupPreflightResultSchema.parse(
        await app.appContext.backupRuntime.buildRestorePreflight(payload.snapshotId)
      );
    } catch (error) {
      return reply
        .status(400)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/platform/ops/backups/restore", async (request, reply) => {
    const auth = requireMinimumRole(request, reply, "owner");
    if (!auth) {
      return;
    }
    try {
      const payload = snapshotIdSchema.parse(request.body);
      return BackupOperationSchema.parse(
        await app.appContext.backupRuntime.startRestore({
          snapshotId: payload.snapshotId,
          triggeredBy: auth.user.displayName ?? auth.user.email
        })
      );
    } catch (error) {
      return reply
        .status(409)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/platform/ops/backups/operations/:operationId", async (request, reply) => {
    const auth = requireMinimumRole(request, reply, "owner");
    if (!auth) {
      return;
    }
    const params = operationIdParamsSchema.parse(request.params);
    const operation = await app.appContext.backupRuntime.getOperation(params.operationId);
    if (!operation) {
      return reply.status(404).send({ error: "Backup operation not found." });
    }
    return BackupOperationSchema.parse(operation);
  });
};
