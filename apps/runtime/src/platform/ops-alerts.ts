import { desc, eq, isNull, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  OpsSummarySchema,
  type BackupHealthSummary,
  type MaintenanceStatus,
  type OpsAlertEvent,
  type OpsAlertSeverity,
  type OpsReleaseRisk,
  type OpsSummary
} from "@qpilot/shared";
import { env } from "../config/env.js";
import { opsAlertEventsTable, releaseGateResultsTable, tenantsTable } from "../db/schema.js";
import { mapOpsAlertEventRow, type OpsAlertEventRow, type TenantRow } from "../utils/mappers.js";
import { getBackupConfigStatus, getBackupHealthSummary } from "./backups.js";
import { buildPlatformQueueSummary } from "./queue-health.js";
import {
  buildReadinessStatus,
  getRuntimeDependencies,
  getRuntimeReadinessStatus
} from "./readiness.js";

interface MonitorContext {
  db: any;
  dbClient: any;
  platformLoadQueue: {
    getSummary: () => Promise<any>;
  };
  maintenanceState?: () => Promise<MaintenanceStatus | null>;
  backupHealth?: () => Promise<BackupHealthSummary>;
  logger?: {
    info: (payload: unknown, message?: string) => void;
    warn: (payload: unknown, message?: string) => void;
    error: (payload: unknown, message?: string) => void;
  };
}

interface AlertCondition {
  fingerprint: string;
  tenantId?: string;
  ruleKey: string;
  severity: OpsAlertSeverity;
  summary: string;
  detail: Record<string, unknown>;
  active: boolean;
}

const toIso = (value?: number | null): string | undefined =>
  typeof value === "number" ? new Date(value).toISOString() : undefined;

const parseBlockers = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
};

export const buildReleaseRiskSummary = async (
  db: any,
  tenantId: string,
  lookbackMinutes = env.OPS_RELEASE_HOLD_LOOKBACK_MINUTES
): Promise<OpsReleaseRisk> => {
  const lookbackStart = Date.now() - lookbackMinutes * 60 * 1000;
  const holdRows = await db
    .select()
    .from(releaseGateResultsTable)
    .where(eq(releaseGateResultsTable.tenantId, tenantId))
    .orderBy(desc(releaseGateResultsTable.evaluatedAt));

  const holdVerdictsLast24h = holdRows.filter(
    (row: { verdict: string; evaluatedAt: number }) =>
      row.verdict === "hold" && row.evaluatedAt >= lookbackStart
  ).length;
  const pendingBlockers = holdRows
    .filter((row: { verdict: string }) => row.verdict === "hold")
    .reduce(
      (total: number, row: { blockersJson: string }) => total + parseBlockers(row.blockersJson).length,
      0
    );

  return {
    holdVerdictsLast24h,
    pendingBlockers,
    lookbackMinutes,
    checkedAt: new Date().toISOString()
  };
};

export const listRecentOpsAlertEvents = async (
  db: any,
  input?: {
    tenantId?: string;
    limit?: number;
  }
): Promise<OpsAlertEvent[]> => {
  const limit = input?.limit ?? 12;
  const rows = (await (input?.tenantId
    ? db
        .select()
        .from(opsAlertEventsTable)
        .where(
          or(eq(opsAlertEventsTable.tenantId, input.tenantId), isNull(opsAlertEventsTable.tenantId))
        )
        .orderBy(desc(opsAlertEventsTable.lastTriggeredAt))
        .limit(limit)
    : db
        .select()
        .from(opsAlertEventsTable)
        .orderBy(desc(opsAlertEventsTable.lastTriggeredAt))
        .limit(limit))) as OpsAlertEventRow[];

  return rows.map(mapOpsAlertEventRow);
};

export const buildOpsSummary = async (
  context: MonitorContext,
  tenantId: string
): Promise<OpsSummary> => {
  const dependencies = await getRuntimeDependencies({ dbClient: context.dbClient });
  const readiness = buildReadinessStatus(
    dependencies,
    context.maintenanceState ? await context.maintenanceState() : null
  );
  const queueHealth = await buildPlatformQueueSummary({
    db: context.db,
    platformLoadQueue: context.platformLoadQueue,
    tenantId
  });
  const releaseRisk = await buildReleaseRiskSummary(context.db, tenantId);
  const backupHealth = await (context.backupHealth ?? getBackupHealthSummary)();
  const recentAlerts = await listRecentOpsAlertEvents(context.db, { tenantId, limit: 10 });

  return OpsSummarySchema.parse({
    readiness,
    dependencies,
    queueHealth,
    releaseRisk,
    backupHealth,
    recentAlerts,
    generatedAt: new Date().toISOString()
  });
};

const sendAlertWebhook = async (
  alert: OpsAlertEvent,
  eventType: "triggered" | "resolved"
): Promise<void> => {
  if (!env.OPS_ALERT_WEBHOOK_URL) {
    return;
  }

  const response = await fetch(env.OPS_ALERT_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      event: eventType,
      deliveredAt: new Date().toISOString(),
      alert
    })
  });

  if (!response.ok) {
    throw new Error(`Webhook returned HTTP ${response.status}.`);
  }
};

const upsertAlertEvent = async (
  db: any,
  condition: AlertCondition
): Promise<{ row: OpsAlertEventRow; eventType: "triggered" | "resolved" | null }> => {
  const existingRows = (await db
    .select()
    .from(opsAlertEventsTable)
    .where(eq(opsAlertEventsTable.fingerprint, condition.fingerprint))
    .limit(1)) as OpsAlertEventRow[];
  const existing = existingRows[0];
  const now = Date.now();

  if (!existing && !condition.active) {
    return { row: null as never, eventType: null };
  }

  if (!existing) {
    const id = nanoid();
    await db.insert(opsAlertEventsTable).values({
      id,
      tenantId: condition.tenantId ?? null,
      ruleKey: condition.ruleKey,
      severity: condition.severity,
      status: "active",
      summary: condition.summary,
      detailJson: JSON.stringify(condition.detail),
      fingerprint: condition.fingerprint,
      firstTriggeredAt: now,
      lastTriggeredAt: now,
      lastDeliveredAt: null,
      lastDeliveryError: null
    });
    const rows = (await db
      .select()
      .from(opsAlertEventsTable)
      .where(eq(opsAlertEventsTable.id, id))
      .limit(1)) as OpsAlertEventRow[];
    return { row: rows[0]!, eventType: "triggered" };
  }

  if (!condition.active && existing.status === "resolved") {
    return { row: existing, eventType: null };
  }

  const nextStatus = condition.active ? "active" : "resolved";
  const eventType =
    existing.status !== nextStatus ? (nextStatus === "active" ? "triggered" : "resolved") : null;

  await db
    .update(opsAlertEventsTable)
    .set({
      tenantId: condition.tenantId ?? null,
      ruleKey: condition.ruleKey,
      severity: condition.severity,
      status: nextStatus,
      summary: condition.summary,
      detailJson: JSON.stringify(condition.detail),
      lastTriggeredAt: now
    })
    .where(eq(opsAlertEventsTable.id, existing.id));

  const rows = (await db
    .select()
    .from(opsAlertEventsTable)
    .where(eq(opsAlertEventsTable.id, existing.id))
    .limit(1)) as OpsAlertEventRow[];
  return { row: rows[0]!, eventType };
};

const shouldDeliverAlert = (
  row: OpsAlertEventRow,
  eventType: "triggered" | "resolved" | null
): boolean => {
  if (!eventType) {
    if (row.status !== "active") {
      return false;
    }
    if (!row.lastDeliveredAt) {
      return true;
    }
    return Date.now() - row.lastDeliveredAt >= env.OPS_ALERT_COOLDOWN_MS;
  }

  return true;
};

const markDeliveryResult = async (
  db: any,
  rowId: string,
  input: {
    deliveredAt?: number;
    error?: string | null;
  }
): Promise<void> => {
  await db
    .update(opsAlertEventsTable)
    .set({
      lastDeliveredAt: input.deliveredAt ?? null,
      lastDeliveryError: input.error ?? null
    })
    .where(eq(opsAlertEventsTable.id, rowId));
};

const evaluateAlertCondition = async (
  db: any,
  condition: AlertCondition,
  logger?: MonitorContext["logger"]
): Promise<void> => {
  const result = await upsertAlertEvent(db, condition);
  if (!result.row) {
    return;
  }

  if (!env.OPS_ALERT_WEBHOOK_URL || !shouldDeliverAlert(result.row, result.eventType)) {
    return;
  }

  const mapped = mapOpsAlertEventRow(result.row);
  const eventType = result.eventType ?? (result.row.status === "resolved" ? "resolved" : "triggered");

  try {
    await sendAlertWebhook(mapped, eventType);
    await markDeliveryResult(db, result.row.id, {
      deliveredAt: Date.now(),
      error: null
    });
  } catch (error) {
    await markDeliveryResult(db, result.row.id, {
      error: error instanceof Error ? error.message : String(error)
    });
    logger?.warn?.(
      {
        err: error,
        fingerprint: condition.fingerprint,
        ruleKey: condition.ruleKey
      },
      "Failed to deliver ops alert webhook."
    );
  }
};

const evaluateTenantAlerts = async (
  context: MonitorContext,
  tenantId: string
): Promise<void> => {
  const queueHealth = await buildPlatformQueueSummary({
    db: context.db,
    platformLoadQueue: context.platformLoadQueue,
    tenantId
  });
  const releaseRisk = await buildReleaseRiskSummary(context.db, tenantId);
  const backlog = queueHealth.counts.waiting + queueHealth.counts.delayed;

  await evaluateAlertCondition(
    context.db,
    {
      fingerprint: `load_queue_backlog_high:${tenantId}`,
      tenantId,
      ruleKey: "load_queue_backlog_high",
      severity: "warning",
      summary:
        backlog >= env.OPS_QUEUE_BACKLOG_WARN_THRESHOLD
          ? `Load queue backlog is ${backlog}, above the warning threshold ${env.OPS_QUEUE_BACKLOG_WARN_THRESHOLD}.`
          : "Load queue backlog returned to a healthy level.",
      detail: {
        threshold: env.OPS_QUEUE_BACKLOG_WARN_THRESHOLD,
        backlog,
        waiting: queueHealth.counts.waiting,
        delayed: queueHealth.counts.delayed,
        active: queueHealth.counts.active
      },
      active: backlog >= env.OPS_QUEUE_BACKLOG_WARN_THRESHOLD
    },
    context.logger
  );

  await evaluateAlertCondition(
    context.db,
    {
      fingerprint: `stale_load_worker_detected:${tenantId}`,
      tenantId,
      ruleKey: "stale_load_worker_detected",
      severity: "critical",
      summary:
        queueHealth.workerHealth.staleWorkers > 0
          ? `${queueHealth.workerHealth.staleWorkers} stale load workers need attention.`
          : "No stale load workers remain.",
      detail: {
        staleWorkers: queueHealth.workerHealth.staleWorkers,
        busyWorkers: queueHealth.workerHealth.busyWorkers,
        freshestHeartbeatAt: queueHealth.workerHealth.freshestHeartbeatAt,
        timeoutMs: queueHealth.workerHealth.timeoutMs
      },
      active: queueHealth.workerHealth.staleWorkers > 0
    },
    context.logger
  );

  await evaluateAlertCondition(
    context.db,
    {
      fingerprint: `new_release_hold_detected:${tenantId}`,
      tenantId,
      ruleKey: "new_release_hold_detected",
      severity: "warning",
      summary:
        releaseRisk.holdVerdictsLast24h > 0
          ? `${releaseRisk.holdVerdictsLast24h} release hold verdicts were recorded in the last ${releaseRisk.lookbackMinutes} minutes.`
          : "No recent release hold verdicts remain in the alert window.",
      detail: {
        holdVerdictsLast24h: releaseRisk.holdVerdictsLast24h,
        pendingBlockers: releaseRisk.pendingBlockers,
        lookbackMinutes: releaseRisk.lookbackMinutes
      },
      active: releaseRisk.holdVerdictsLast24h > 0
    },
    context.logger
  );
};

export const evaluateOpsAlerts = async (context: MonitorContext): Promise<void> => {
  const maintenance = context.maintenanceState ? await context.maintenanceState() : null;
  const readiness = await getRuntimeReadinessStatus({
    dbClient: context.dbClient,
    maintenance
  });

  await evaluateAlertCondition(
    context.db,
    {
      fingerprint: "runtime_readiness_failed:global",
      ruleKey: "runtime_readiness_failed",
      severity: "critical",
      summary: maintenance
        ? "Runtime is in a planned maintenance window."
        : readiness.ready
          ? "Runtime readiness recovered."
          : `Runtime readiness failed for ${readiness.failedComponents.join(", ")}.`,
      detail: {
        ready: readiness.ready,
        failedComponents: readiness.failedComponents,
        warnings: readiness.warnings,
        checkedAt: readiness.checkedAt,
        maintenance
      },
      active: !readiness.ready && !maintenance
    },
    context.logger
  );

  const backupHealth = await (context.backupHealth ?? getBackupHealthSummary)();
  const checkMap = new Map(
    backupHealth.checks.map((check) => [check.key, check])
  );
  const configCheck = checkMap.get("config");
  const storageCheck = checkMap.get("storage");
  const freshnessCheck = checkMap.get("freshness");
  const schedulerCheck = checkMap.get("scheduler");

  await evaluateAlertCondition(
    context.db,
    {
      fingerprint: "backup_not_configured:global",
      ruleKey: "backup_not_configured",
      severity: "warning",
      summary:
        backupHealth.state === "not_configured"
          ? "Backup storage or encryption is not fully configured."
          : "Backup configuration is complete again.",
      detail: {
        state: backupHealth.state,
        check: configCheck ?? null
      },
      active:
        env.NODE_ENV === "production" &&
        backupHealth.state === "not_configured"
    },
    context.logger
  );

  await evaluateAlertCondition(
    context.db,
    {
      fingerprint: "backup_storage_unreachable:global",
      ruleKey: "backup_storage_unreachable",
      severity: "critical",
      summary:
        storageCheck?.state === "failed"
          ? `Backup storage probe failed: ${storageCheck.detail}`
          : "Backup storage reachability recovered.",
      detail: {
        state: backupHealth.state,
        check: storageCheck ?? null
      },
      active: storageCheck?.state === "failed"
    },
    context.logger
  );

  await evaluateAlertCondition(
    context.db,
    {
      fingerprint: "backup_snapshot_stale:global",
      ruleKey: "backup_snapshot_stale",
      severity: "warning",
      summary:
        freshnessCheck?.state === "failed"
          ? freshnessCheck.detail
          : "Backup freshness returned within the expected window.",
      detail: {
        state: backupHealth.state,
        lastSuccessfulBackupAt: backupHealth.lastSuccessfulBackupAt,
        latestSnapshotId: backupHealth.latestSnapshotId,
        check: freshnessCheck ?? null
      },
      active: freshnessCheck?.state === "failed"
    },
    context.logger
  );

  await evaluateAlertCondition(
    context.db,
    {
      fingerprint: "backup_scheduler_unhealthy:global",
      ruleKey: "backup_scheduler_unhealthy",
      severity: "critical",
      summary:
        schedulerCheck?.state === "failed"
          ? schedulerCheck.detail
          : "Backup scheduler is healthy again.",
      detail: {
        state: backupHealth.state,
        scheduler: backupHealth.scheduler,
        check: schedulerCheck ?? null
      },
      active: schedulerCheck?.state === "failed"
    },
    context.logger
  );

  const backupConfig = await getBackupConfigStatus();
  const latestRestore = backupConfig.restoreHistory[0];
  const latestRestoreDetail = latestRestore?.detail ?? {};
  const latestVerification =
    "verification" in latestRestoreDetail ? latestRestoreDetail.verification : undefined;
  const latestRollbackVerification =
    "rollbackVerification" in latestRestoreDetail
      ? latestRestoreDetail.rollbackVerification
      : undefined;
  const rollbackSucceeded =
    "rollbackSucceeded" in latestRestoreDetail
      ? latestRestoreDetail.rollbackSucceeded
      : undefined;
  const restoreVerificationFailed =
    latestRestore?.status === "failed" &&
    Boolean(
      latestVerification &&
        typeof latestVerification === "object" &&
        "ok" in latestVerification &&
        latestVerification.ok === false
    );
  const restoreAutoRollbackFailed =
    latestRestore?.status === "failed" && rollbackSucceeded === false;

  await evaluateAlertCondition(
    context.db,
    {
      fingerprint: "restore_verification_failed:global",
      ruleKey: "restore_verification_failed",
      severity: "warning",
      summary: restoreVerificationFailed
        ? rollbackSucceeded
          ? "Restore verification failed, but the instance recovered through auto rollback."
          : "Restore verification failed before the instance could be confirmed healthy."
        : "The latest restore verification is healthy again.",
      detail: {
        operationId: latestRestore?.id,
        snapshotId: latestRestore?.snapshotId,
        verification: latestVerification ?? null,
        rollbackSucceeded: rollbackSucceeded ?? null,
        updatedAt: latestRestore?.updatedAt
      },
      active: restoreVerificationFailed
    },
    context.logger
  );

  await evaluateAlertCondition(
    context.db,
    {
      fingerprint: "restore_auto_rollback_failed:global",
      ruleKey: "restore_auto_rollback_failed",
      severity: "critical",
      summary: restoreAutoRollbackFailed
        ? "Restore auto rollback failed. The instance may still require manual recovery."
        : "Restore auto rollback is healthy again.",
      detail: {
        operationId: latestRestore?.id,
        snapshotId: latestRestore?.snapshotId,
        rollbackSnapshotId:
          "rollbackSnapshotId" in latestRestoreDetail
            ? latestRestoreDetail.rollbackSnapshotId
            : null,
        rollbackVerification: latestRollbackVerification ?? null,
        rollbackSucceeded: rollbackSucceeded ?? null,
        updatedAt: latestRestore?.updatedAt
      },
      active: restoreAutoRollbackFailed
    },
    context.logger
  );

  const tenantRows = (await context.db
    .select()
    .from(tenantsTable)
    .orderBy(desc(tenantsTable.createdAt))) as TenantRow[];

  for (const tenant of tenantRows) {
    await evaluateTenantAlerts(context, tenant.id);
  }
};

export const startOpsAlertMonitor = (context: MonitorContext): (() => void) => {
  if (!env.OPS_ALERTS_ENABLED) {
    return () => {};
  }

  let stopped = false;
  let running = false;

  const tick = async () => {
    if (running || stopped) {
      return;
    }
    running = true;
    try {
      await evaluateOpsAlerts(context);
    } catch (error) {
      context.logger?.error?.({ err: error }, "Ops alert monitor tick failed.");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, env.OPS_ALERT_POLL_INTERVAL_MS);
  timer.unref?.();
  void tick();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
};
