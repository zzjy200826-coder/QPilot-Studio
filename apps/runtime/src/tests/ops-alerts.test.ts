import { createServer as createHttpServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const ownerEmail = "alerts.owner@example.test";
const ownerPassword = "Password123!";

const extractCookie = (setCookieHeader?: string | string[]): string => {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  return raw?.split(";")[0] ?? "";
};

const parseJson = <T>(response: { body: string }): T => JSON.parse(response.body) as T;

const restoreEnv = (previousEnv: Map<string, string | undefined>) => {
  for (const [key, value] of previousEnv.entries()) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

const withCollector = async (statusCode: number) => {
  const requests: any[] = [];
  const server = createHttpServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      requests.push(JSON.parse(body));
      response.statusCode = statusCode;
      response.end(statusCode === 200 ? "ok" : "failed");
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to allocate webhook test port.");
  }

  return {
    url: `http://127.0.0.1:${address.port}/webhook`,
    requests,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
};

const setup = async (
  webhookUrl: string,
  envOverrideValues?: Record<string, string>
) => {
  const tempDir = mkdtempSync(join(tmpdir(), "qpilot-ops-alerts-"));
  const previousEnv = new Map<string, string | undefined>();
  const envOverrides: Record<string, string> = {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: "8900",
    CORS_ORIGIN: "http://127.0.0.1:4200",
    DATABASE_URL: join(tempDir, "runtime.db"),
    ARTIFACTS_DIR: join(tempDir, "artifacts"),
    REPORTS_DIR: join(tempDir, "reports"),
    SESSIONS_DIR: join(tempDir, "sessions"),
    PLANNER_CACHE_DIR: join(tempDir, "planner-cache"),
    BACKUP_SHARED_ROOT: join(tempDir, "shared"),
    BACKUP_OPS_ROOT: join(tempDir, "ops"),
    PLATFORM_REDIS_URL: "",
    PLATFORM_REDIS_WORKER_ENABLED: "false",
    OPENAI_API_KEY: "",
    OPS_ALERT_WEBHOOK_URL: webhookUrl,
    OPS_ALERT_COOLDOWN_MS: "999999",
    OPS_QUEUE_BACKLOG_WARN_THRESHOLD: "999",
    OPS_RELEASE_HOLD_LOOKBACK_MINUTES: "1440",
    CREDENTIAL_MASTER_KEY:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    ...envOverrideValues
  };

  for (const [key, value] of Object.entries(envOverrides)) {
    previousEnv.set(key, process.env[key]);
    process.env[key] = value;
  }

  vi.resetModules();
  const serverModule = await import("../server.js");
  const alertsModule = await import("../platform/ops-alerts.js");
  const schemaModule = await import("../db/schema.js");
  const app = await serverModule.createServer();
  await app.ready();

  return {
    app,
    alertsModule,
    schemaModule,
    cleanup: async () => {
      await app.close();
      restoreEnv(previousEnv);
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore Windows handle cleanup races in integration tests.
      }
    }
  };
};

describe.sequential("ops alert monitor", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it(
    "deduplicates active alerts within cooldown and emits a resolved notification",
    async () => {
    const collector = await withCollector(200);
    const { app, alertsModule, schemaModule, cleanup } = await setup(collector.url);

    try {
      const registerResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: ownerEmail,
          password: ownerPassword,
          displayName: "Alert Owner",
          tenantName: "Alert Workspace"
        }
      });
      const ownerAuth = parseJson<any>(registerResponse);
      expect(extractCookie(registerResponse.headers["set-cookie"])).toContain("qpilot_session=");

      const now = Date.now();
      await app.appContext.db.insert(schemaModule.projectsTable).values({
        id: "project-alerts",
        tenantId: ownerAuth.tenant.id,
        name: "Alert Project",
        baseUrl: "https://alerts.example.test",
        usernameCipher: null,
        usernameIv: null,
        usernameTag: null,
        passwordCipher: null,
        passwordIv: null,
        passwordTag: null,
        createdAt: now,
        updatedAt: now
      });
      await app.appContext.db.insert(schemaModule.gatePoliciesTable).values({
        id: "policy-alerts",
        tenantId: ownerAuth.tenant.id,
        projectId: "project-alerts",
        name: "Alert Policy",
        requiredFunctionalFlowsJson: "[]",
        minBenchmarkCoveragePct: 0,
        minBenchmarkPassRate: 0,
        requiredLoadProfileIdsJson: "[]",
        minimumLoadVerdict: "watch",
        allowWaiver: 0,
        approverRolesJson: "[]",
        expiresAt: null,
        createdAt: now,
        updatedAt: now
      });
      await app.appContext.db.insert(schemaModule.releaseCandidatesTable).values({
        id: "release-alerts",
        tenantId: ownerAuth.tenant.id,
        projectId: "project-alerts",
        environmentId: null,
        gatePolicyId: "policy-alerts",
        name: "Release Alerts",
        buildLabel: "2026.04.21-alerts",
        buildId: null,
        commitSha: null,
        sourceRunIdsJson: "[]",
        sourceLoadRunIdsJson: "[]",
        status: "candidate",
        notes: null,
        createdAt: now,
        updatedAt: now
      });
      await app.appContext.db.insert(schemaModule.releaseGateResultsTable).values({
        id: "gate-alerts",
        tenantId: ownerAuth.tenant.id,
        releaseId: "release-alerts",
        verdict: "hold",
        summary: "Blocking regression detected.",
        blockersJson: JSON.stringify(["latency-regression"]),
        signalsJson: "[]",
        waiverCount: 0,
        evaluatedAt: now
      });

      await alertsModule.evaluateOpsAlerts({
        db: app.appContext.db,
        dbClient: app.appContext.dbClient,
        platformLoadQueue: app.appContext.platformLoadQueue
      });
      expect(collector.requests).toHaveLength(1);
      expect(collector.requests[0]?.event).toBe("triggered");
      expect(collector.requests[0]?.alert?.ruleKey).toBe("new_release_hold_detected");

      await alertsModule.evaluateOpsAlerts({
        db: app.appContext.db,
        dbClient: app.appContext.dbClient,
        platformLoadQueue: app.appContext.platformLoadQueue
      });
      expect(collector.requests).toHaveLength(1);

      await app.appContext.db
        .update(schemaModule.releaseGateResultsTable)
        .set({
          verdict: "ship",
          summary: "Recovered.",
          blockersJson: "[]",
          evaluatedAt: Date.now()
        })
        .where(eq(schemaModule.releaseGateResultsTable.id, "gate-alerts"));

      await alertsModule.evaluateOpsAlerts({
        db: app.appContext.db,
        dbClient: app.appContext.dbClient,
        platformLoadQueue: app.appContext.platformLoadQueue
      });
      expect(collector.requests).toHaveLength(2);
      expect(collector.requests[1]?.event).toBe("resolved");

      const rows = await app.appContext.db
        .select()
        .from(schemaModule.opsAlertEventsTable)
        .where(eq(schemaModule.opsAlertEventsTable.fingerprint, `new_release_hold_detected:${ownerAuth.tenant.id}`))
        .limit(1);
      expect(rows[0]?.status).toBe("resolved");
    } finally {
      await cleanup();
      await collector.close();
    }
    },
    15_000
  );

  it("records webhook delivery errors when the endpoint fails", async () => {
    const collector = await withCollector(500);
    const { app, alertsModule, schemaModule, cleanup } = await setup(collector.url);

    try {
      const registerResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "alerts.error@example.test",
          password: ownerPassword,
          displayName: "Alert Error Owner",
          tenantName: "Alert Error Workspace"
        }
      });
      const ownerAuth = parseJson<any>(registerResponse);
      const now = Date.now();

      await app.appContext.db.insert(schemaModule.projectsTable).values({
        id: "project-alerts-error",
        tenantId: ownerAuth.tenant.id,
        name: "Alert Error Project",
        baseUrl: "https://alerts-error.example.test",
        usernameCipher: null,
        usernameIv: null,
        usernameTag: null,
        passwordCipher: null,
        passwordIv: null,
        passwordTag: null,
        createdAt: now,
        updatedAt: now
      });
      await app.appContext.db.insert(schemaModule.gatePoliciesTable).values({
        id: "policy-alerts-error",
        tenantId: ownerAuth.tenant.id,
        projectId: "project-alerts-error",
        name: "Alert Error Policy",
        requiredFunctionalFlowsJson: "[]",
        minBenchmarkCoveragePct: 0,
        minBenchmarkPassRate: 0,
        requiredLoadProfileIdsJson: "[]",
        minimumLoadVerdict: "watch",
        allowWaiver: 0,
        approverRolesJson: "[]",
        expiresAt: null,
        createdAt: now,
        updatedAt: now
      });
      await app.appContext.db.insert(schemaModule.releaseCandidatesTable).values({
        id: "release-alerts-error",
        tenantId: ownerAuth.tenant.id,
        projectId: "project-alerts-error",
        environmentId: null,
        gatePolicyId: "policy-alerts-error",
        name: "Release Alerts Error",
        buildLabel: "2026.04.21-alerts-error",
        buildId: null,
        commitSha: null,
        sourceRunIdsJson: "[]",
        sourceLoadRunIdsJson: "[]",
        status: "candidate",
        notes: null,
        createdAt: now,
        updatedAt: now
      });
      await app.appContext.db.insert(schemaModule.releaseGateResultsTable).values({
        id: "gate-alerts-error",
        tenantId: ownerAuth.tenant.id,
        releaseId: "release-alerts-error",
        verdict: "hold",
        summary: "Webhook failure path.",
        blockersJson: JSON.stringify(["hold"]),
        signalsJson: "[]",
        waiverCount: 0,
        evaluatedAt: now
      });

      await alertsModule.evaluateOpsAlerts({
        db: app.appContext.db,
        dbClient: app.appContext.dbClient,
        platformLoadQueue: app.appContext.platformLoadQueue
      });

      const rows = await app.appContext.db.select().from(schemaModule.opsAlertEventsTable);
      expect(rows.some((row: { lastDeliveryError: string | null }) => row.lastDeliveryError?.includes("HTTP 500"))).toBe(true);
      expect(collector.requests).toHaveLength(1);
    } finally {
      await cleanup();
      await collector.close();
    }
  });

  it("persists global backup health alerts and resolves them when health recovers", async () => {
    const collector = await withCollector(200);
    const { app, alertsModule, schemaModule, cleanup } = await setup(collector.url, {
      NODE_ENV: "production"
    });

    try {
      await alertsModule.evaluateOpsAlerts({
        db: app.appContext.db,
        dbClient: app.appContext.dbClient,
        platformLoadQueue: app.appContext.platformLoadQueue,
        backupHealth: async () => ({
          state: "not_configured",
          checkedAt: "2026-04-22T12:00:00.000Z",
          lastSuccessfulBackupAt: undefined,
          latestSnapshotId: undefined,
          lastFailedOperation: undefined,
          scheduler: {
            supported: true,
            enabled: false,
            activeState: "inactive",
            subState: "dead",
            detail: "Backup timer is intentionally disabled until backup configuration is complete."
          },
          checks: [
            {
              key: "config",
              label: "Configuration",
              state: "not_configured",
              detail: "Missing backup configuration: BACKUP_ENCRYPTION_KEY.",
              checkedAt: "2026-04-22T12:00:00.000Z"
            },
            {
              key: "storage",
              label: "Storage reachability",
              state: "not_configured",
              detail: "S3 endpoint, bucket, or credentials are not configured.",
              checkedAt: "2026-04-22T12:00:00.000Z"
            },
            {
              key: "freshness",
              label: "Freshness",
              state: "not_configured",
              detail: "Backup freshness is unavailable until backup configuration is complete.",
              checkedAt: "2026-04-22T12:00:00.000Z"
            },
            {
              key: "scheduler",
              label: "Scheduler",
              state: "not_configured",
              detail: "Backup timer is intentionally disabled until backup configuration is complete.",
              checkedAt: "2026-04-22T12:00:00.000Z"
            },
            {
              key: "execution",
              label: "Execution",
              state: "ready",
              detail: "No recent backup execution problems were detected.",
              checkedAt: "2026-04-22T12:00:00.000Z"
            }
          ]
        })
      });

      expect(collector.requests.some((request) => request.alert?.ruleKey === "backup_not_configured")).toBe(true);

      await alertsModule.evaluateOpsAlerts({
        db: app.appContext.db,
        dbClient: app.appContext.dbClient,
        platformLoadQueue: app.appContext.platformLoadQueue,
        backupHealth: async () => ({
          state: "failed",
          checkedAt: "2026-04-22T13:00:00.000Z",
          lastSuccessfulBackupAt: "2026-04-20T01:00:00.000Z",
          latestSnapshotId: "20260420T010000Z-scheduled-demo",
          lastFailedOperation: {
            operationId: "backup-failed-1",
            updatedAt: "2026-04-22T12:58:00.000Z",
            error: "Upload failed.",
            snapshotId: "20260420T010000Z-scheduled-demo"
          },
          scheduler: {
            supported: true,
            enabled: false,
            activeState: "inactive",
            subState: "dead",
            lastResult: "exit-code",
            detail: "qpilot-backup.timer is not enabled."
          },
          checks: [
            {
              key: "config",
              label: "Configuration",
              state: "ready",
              detail: "Backup storage, credentials, and encryption are configured.",
              checkedAt: "2026-04-22T13:00:00.000Z"
            },
            {
              key: "storage",
              label: "Storage reachability",
              state: "failed",
              detail: "connect ECONNREFUSED 127.0.0.1:9000",
              checkedAt: "2026-04-22T13:00:00.000Z"
            },
            {
              key: "freshness",
              label: "Freshness",
              state: "failed",
              detail: "Latest successful backup is 59.0 hours old.",
              checkedAt: "2026-04-22T13:00:00.000Z"
            },
            {
              key: "scheduler",
              label: "Scheduler",
              state: "failed",
              detail: "qpilot-backup.timer is not enabled.",
              checkedAt: "2026-04-22T13:00:00.000Z"
            },
            {
              key: "execution",
              label: "Execution",
              state: "failed",
              detail: "Upload failed.",
              checkedAt: "2026-04-22T13:00:00.000Z"
            }
          ]
        })
      });

      const ruleKeys = collector.requests.map((request) => request.alert?.ruleKey);
      expect(ruleKeys).toContain("backup_storage_unreachable");
      expect(ruleKeys).toContain("backup_snapshot_stale");
      expect(ruleKeys).toContain("backup_scheduler_unhealthy");

      await alertsModule.evaluateOpsAlerts({
        db: app.appContext.db,
        dbClient: app.appContext.dbClient,
        platformLoadQueue: app.appContext.platformLoadQueue,
        backupHealth: async () => ({
          state: "ready",
          checkedAt: "2026-04-22T14:00:00.000Z",
          lastSuccessfulBackupAt: "2026-04-22T13:45:00.000Z",
          latestSnapshotId: "20260422T134500Z-manual-demo",
          lastFailedOperation: undefined,
          scheduler: {
            supported: true,
            enabled: true,
            activeState: "active",
            subState: "waiting",
            lastTriggerAt: "2026-04-22T13:45:00.000Z",
            nextTriggerAt: "2026-04-23T03:30:00.000Z",
            lastResult: "success",
            detail: "Backup timer status is healthy."
          },
          checks: [
            {
              key: "config",
              label: "Configuration",
              state: "ready",
              detail: "Backup storage, credentials, and encryption are configured.",
              checkedAt: "2026-04-22T14:00:00.000Z"
            },
            {
              key: "storage",
              label: "Storage reachability",
              state: "ready",
              detail: "S3 bucket qpilot-backups is reachable.",
              checkedAt: "2026-04-22T14:00:00.000Z"
            },
            {
              key: "freshness",
              label: "Freshness",
              state: "ready",
              detail: "Latest successful backup was 0.3 hours ago.",
              checkedAt: "2026-04-22T14:00:00.000Z"
            },
            {
              key: "scheduler",
              label: "Scheduler",
              state: "ready",
              detail: "Backup timer status is healthy.",
              checkedAt: "2026-04-22T14:00:00.000Z"
            },
            {
              key: "execution",
              label: "Execution",
              state: "ready",
              detail: "No recent backup execution problems were detected.",
              checkedAt: "2026-04-22T14:00:00.000Z"
            }
          ]
        })
      });

      const resolvedEvents = collector.requests
        .filter((request) => request.event === "resolved")
        .map((request) => request.alert?.ruleKey);
      expect(resolvedEvents).toContain("backup_not_configured");
      expect(resolvedEvents).toContain("backup_storage_unreachable");
      expect(resolvedEvents).toContain("backup_snapshot_stale");
      expect(resolvedEvents).toContain("backup_scheduler_unhealthy");

      const rows = await app.appContext.db.select().from(schemaModule.opsAlertEventsTable);
      expect(rows.some((row: { ruleKey: string; status: string }) => row.ruleKey === "backup_scheduler_unhealthy" && row.status === "resolved")).toBe(true);
    } finally {
      await cleanup();
      await collector.close();
    }
  });

  it("emits restore verification and auto rollback alerts from restore history", async () => {
    const collector = await withCollector(200);
    const { app, alertsModule, schemaModule, cleanup } = await setup(collector.url, {
      NODE_ENV: "production"
    });

    try {
      const operationsDir = join(process.env.BACKUP_OPS_ROOT!, "backups", "operations");
      mkdirSync(operationsDir, { recursive: true });
      const now = new Date().toISOString();

      writeFileSync(
        join(operationsDir, "restore-alert.json"),
        JSON.stringify(
          {
            id: "restore-alert",
            type: "restore",
            status: "failed",
            snapshotId: "20260422T030000Z-manual-restore",
            snapshotKind: "manual",
            triggeredBy: "fixture-owner",
            message: "Auto rollback failed. The instance remains in maintenance mode for manual recovery.",
            error: "Restore verification failed.\nAuto rollback: rollback verification failed.",
            detail: {
              phase: "rollback",
              phaseUpdatedAt: now,
              rollbackSnapshotId: "20260422T025500Z-pre_restore-rescue",
              failureReason: "restore_auto_rollback_failed",
              verification: {
                ok: false,
                checkedAt: now,
                baseUrl: "https://qpilot.example.test",
                checks: [
                  {
                    key: "ready",
                    label: "GET /health/ready",
                    state: "failed",
                    status: 503,
                    detail: "Readiness probe returned HTTP 503.",
                    checkedAt: now
                  }
                ]
              },
              rollbackVerification: {
                ok: false,
                checkedAt: now,
                baseUrl: "https://qpilot.example.test",
                checks: [
                  {
                    key: "ready",
                    label: "GET /health/ready",
                    state: "failed",
                    status: 503,
                    detail: "Rollback readiness probe returned HTTP 503.",
                    checkedAt: now
                  }
                ]
              },
              rollbackSucceeded: false
            },
            createdAt: now,
            updatedAt: now,
            startedAt: now,
            finishedAt: now
          },
          null,
          2
        ),
        "utf8"
      );

      await alertsModule.evaluateOpsAlerts({
        db: app.appContext.db,
        dbClient: app.appContext.dbClient,
        platformLoadQueue: app.appContext.platformLoadQueue
      });

      const ruleKeys = collector.requests.map((request) => request.alert?.ruleKey);
      expect(ruleKeys).toContain("restore_verification_failed");
      expect(ruleKeys).toContain("restore_auto_rollback_failed");

      rmSync(join(process.env.BACKUP_OPS_ROOT!, "backups"), { recursive: true, force: true });
      collector.requests.length = 0;

      await alertsModule.evaluateOpsAlerts({
        db: app.appContext.db,
        dbClient: app.appContext.dbClient,
        platformLoadQueue: app.appContext.platformLoadQueue
      });

      const resolvedRuleKeys = collector.requests
        .filter((request) => request.event === "resolved")
        .map((request) => request.alert?.ruleKey);
      expect(resolvedRuleKeys).toContain("restore_verification_failed");
      expect(resolvedRuleKeys).toContain("restore_auto_rollback_failed");

      const rows = await app.appContext.db.select().from(schemaModule.opsAlertEventsTable);
      expect(
        rows.some(
          (row: { ruleKey: string; status: string }) =>
            row.ruleKey === "restore_auto_rollback_failed" && row.status === "resolved"
        )
      ).toBe(true);
    } finally {
      await cleanup();
      await collector.close();
    }
  });
});
