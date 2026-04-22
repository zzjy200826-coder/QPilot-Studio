import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tempDir = mkdtempSync(join(tmpdir(), "qpilot-ops-runtime-"));
const databasePath = join(tempDir, "runtime.db");
const artifactsRoot = join(tempDir, "artifacts");
const reportsRoot = join(tempDir, "reports");
const sessionsRoot = join(tempDir, "sessions");
const plannerCacheRoot = join(tempDir, "planner-cache");
const backupSharedRoot = join(tempDir, "shared");
const backupOpsRoot = join(tempDir, "ops");
const previousEnv = new Map<string, string | undefined>();

let app: any;
let hashPassword: (password: string) => Promise<string>;
let usersTable: any;
let membershipsTable: any;
let opsAlertEventsTable: any;

const ownerEmail = "ops.owner@example.test";
const ownerPassword = "Password123!";
const memberEmail = "ops.member@example.test";
const memberPassword = "Password123!";

const extractCookie = (setCookieHeader?: string | string[]): string => {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  return raw?.split(";")[0] ?? "";
};

const parseJson = <T>(response: { body: string }): T => JSON.parse(response.body) as T;

describe.sequential("ops routes and readiness", () => {
  beforeAll(async () => {
    const envOverrides: Record<string, string> = {
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: "8899",
      CORS_ORIGIN: "http://127.0.0.1:4199",
      DATABASE_URL: databasePath,
      ARTIFACTS_DIR: artifactsRoot,
      REPORTS_DIR: reportsRoot,
      SESSIONS_DIR: sessionsRoot,
      PLANNER_CACHE_DIR: plannerCacheRoot,
      BACKUP_SHARED_ROOT: backupSharedRoot,
      BACKUP_OPS_ROOT: backupOpsRoot,
      PLATFORM_REDIS_URL: "",
      PLATFORM_REDIS_WORKER_ENABLED: "false",
      PLATFORM_METRICS_ENABLED: "true",
      METRICS_BEARER_TOKEN: "metrics-token-123456",
      CREDENTIAL_MASTER_KEY:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    };

    for (const [key, value] of Object.entries(envOverrides)) {
      previousEnv.set(key, process.env[key]);
      process.env[key] = value;
    }

    vi.resetModules();
    const serverModule = await import("../server.js");
    const authServiceModule = await import("../auth/service.js");
    const schemaModule = await import("../db/schema.js");

    app = await serverModule.createServer();
    await app.ready();
    hashPassword = authServiceModule.hashPassword;
    usersTable = schemaModule.usersTable;
    membershipsTable = schemaModule.membershipsTable;
    opsAlertEventsTable = schemaModule.opsAlertEventsTable;
  }, 20_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    for (const [key, value] of previousEnv.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore Windows cleanup races.
    }
  });

  it("separates liveness, readiness, and metrics protection", async () => {
    const healthResponse = await app.inject({
      method: "GET",
      url: "/health"
    });
    expect(healthResponse.statusCode).toBe(200);
    expect(parseJson<{ ok: boolean }>(healthResponse).ok).toBe(true);

    const readyResponse = await app.inject({
      method: "GET",
      url: "/health/ready"
    });
    expect(readyResponse.statusCode).toBe(200);
    expect(parseJson<{ ready: boolean }>(readyResponse).ready).toBe(true);

    const metricsDenied = await app.inject({
      method: "GET",
      url: "/metrics"
    });
    expect(metricsDenied.statusCode).toBe(401);

    const metricsAllowed = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: {
        authorization: "Bearer metrics-token-123456"
      }
    });
    expect(metricsAllowed.statusCode).toBe(200);
    expect(metricsAllowed.body).toContain("qpilot_platform_metrics_generated_unixtime");

    const originalExecute = app.appContext.dbClient.execute.bind(app.appContext.dbClient);
    app.appContext.dbClient.execute = vi.fn().mockRejectedValue(new Error("db unavailable"));
    const failingReadyResponse = await app.inject({
      method: "GET",
      url: "/health/ready"
    });
    expect(failingReadyResponse.statusCode).toBe(503);
    expect(parseJson<{ failedComponents: string[] }>(failingReadyResponse).failedComponents).toContain(
      "SQLite"
    );
    app.appContext.dbClient.execute = originalExecute;
  });

  it("allows owners to read ops summary while blocking members and API tokens", async () => {
    const registerResponse = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: ownerEmail,
        password: ownerPassword,
        displayName: "Ops Owner",
        tenantName: "Ops Workspace"
      }
    });
    expect(registerResponse.statusCode).toBe(200);
    const ownerAuth = parseJson<any>(registerResponse);
    const ownerCookie = extractCookie(registerResponse.headers["set-cookie"]);

    const now = Date.now();
    await app.appContext.db.insert(usersTable).values({
      id: "user-ops-member",
      email: memberEmail,
      passwordHash: await hashPassword(memberPassword),
      displayName: "Ops Member",
      createdAt: now,
      updatedAt: now
    });
    await app.appContext.db.insert(membershipsTable).values({
      id: "membership-ops-member",
      tenantId: ownerAuth.tenant.id,
      userId: "user-ops-member",
      role: "member",
      createdAt: now,
      updatedAt: now
    });
    await app.appContext.db.insert(opsAlertEventsTable).values({
      id: "ops-alert-seeded",
      tenantId: ownerAuth.tenant.id,
      ruleKey: "load_queue_backlog_high",
      severity: "warning",
      status: "active",
      summary: "Queue backlog exceeded threshold during fixture test.",
      detailJson: JSON.stringify({ backlog: 8, threshold: 5 }),
      fingerprint: `load_queue_backlog_high:${ownerAuth.tenant.id}`,
      firstTriggeredAt: now - 5_000,
      lastTriggeredAt: now - 1_000,
      lastDeliveredAt: null,
      lastDeliveryError: null
    });

    const ownerSummaryResponse = await app.inject({
      method: "GET",
      url: "/api/platform/ops/summary",
      headers: { cookie: ownerCookie }
    });
    expect(ownerSummaryResponse.statusCode).toBe(200);
    const ownerSummary = parseJson<any>(ownerSummaryResponse);
    expect(ownerSummary.readiness.ready).toBe(true);
    expect(ownerSummary.dependencies.length).toBeGreaterThan(0);
    expect(ownerSummary.backupHealth).toBeTruthy();
    expect(ownerSummary.backupHealth.checks.some((check: { key: string }) => check.key === "config")).toBe(
      true
    );
    expect(ownerSummary.recentAlerts[0]?.ruleKey).toBe("load_queue_backlog_high");

    const memberLoginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: memberEmail, password: memberPassword }
    });
    const memberCookie = extractCookie(memberLoginResponse.headers["set-cookie"]);
    const memberSummaryResponse = await app.inject({
      method: "GET",
      url: "/api/platform/ops/summary",
      headers: { cookie: memberCookie }
    });
    expect(memberSummaryResponse.statusCode).toBe(403);

    const apiTokenResponse = await app.inject({
      method: "POST",
      url: "/api/auth/tokens",
      headers: { cookie: ownerCookie },
      payload: {
        label: "ops-summary-token",
        scopes: ["gate:read"]
      }
    });
    expect(apiTokenResponse.statusCode).toBe(200);
    const tokenBody = parseJson<{ plainTextToken: string }>(apiTokenResponse);

    const tokenSummaryResponse = await app.inject({
      method: "GET",
      url: "/api/platform/ops/summary",
      headers: {
        authorization: `Bearer ${tokenBody.plainTextToken}`
      }
    });
    expect(tokenSummaryResponse.statusCode).toBe(403);
  });

  it("enters maintenance protection when a restore marker is present", async () => {
    const maintenanceDir = join(backupOpsRoot, "backups");
    const operationsDir = join(maintenanceDir, "operations");
    mkdirSync(maintenanceDir, { recursive: true });
    mkdirSync(operationsDir, { recursive: true });
    writeFileSync(
      join(operationsDir, "restore-op-123.json"),
      JSON.stringify(
        {
          id: "restore-op-123",
          type: "restore",
          status: "running",
          snapshotId: "20260421T130000Z-pre_restore-demo",
          snapshotKind: "pre_restore",
          triggeredBy: "fixture-owner",
          message: "Downloading and restoring snapshot...",
          detail: {
            phase: "rollback",
            phaseUpdatedAt: new Date().toISOString(),
            verification: {
              ok: false,
              checkedAt: new Date().toISOString(),
              baseUrl: "https://fixture.example.test",
              checks: [
                {
                  key: "ready",
                  label: "GET /health/ready",
                  state: "failed",
                  status: 503,
                  detail: "Readiness probe returned HTTP 503.",
                  checkedAt: new Date().toISOString()
                }
              ]
            }
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          startedAt: new Date().toISOString()
        },
        null,
        2
      ),
      "utf8"
    );
    writeFileSync(
      join(maintenanceDir, "maintenance.json"),
      JSON.stringify(
        {
          active: true,
          operationId: "restore-op-123",
          snapshotId: "20260421T130000Z-pre_restore-demo",
          createdAt: new Date().toISOString(),
          message: "Runtime maintenance window is active while restore is running.",
          phase: "rollback",
          phaseUpdatedAt: new Date().toISOString()
        },
        null,
        2
      ),
      "utf8"
    );

    try {
      const healthResponse = await app.inject({
        method: "GET",
        url: "/health"
      });
      expect(healthResponse.statusCode).toBe(200);

      const readyResponse = await app.inject({
        method: "GET",
        url: "/health/ready"
      });
      expect(readyResponse.statusCode).toBe(503);
      const readyJson = parseJson<{ maintenance: { operationId: string } | null; failedComponents: string[] }>(
        readyResponse
      );
      expect(readyJson.maintenance?.operationId).toBe("restore-op-123");
      expect(readyJson.failedComponents).toContain("Maintenance window");

      const projectsResponse = await app.inject({
        method: "GET",
        url: "/api/projects"
      });
      expect(projectsResponse.statusCode).toBe(503);
      expect(parseJson<{ maintenance: { snapshotId: string } }>(projectsResponse).maintenance.snapshotId).toBe(
        "20260421T130000Z-pre_restore-demo"
      );

      const maintenanceStatusResponse = await app.inject({
        method: "GET",
        url: "/api/runtime/maintenance"
      });
      expect(maintenanceStatusResponse.statusCode).toBe(200);
      const maintenanceStatus = parseJson<{
        active: boolean;
        maintenance: { operationId: string; phase?: string } | null;
        operation: { status: string; message?: string; detail?: { phase?: string } } | null;
      }>(maintenanceStatusResponse);
      expect(maintenanceStatus.active).toBe(true);
      expect(maintenanceStatus.maintenance?.operationId).toBe("restore-op-123");
      expect(maintenanceStatus.maintenance?.phase).toBe("rollback");
      expect(maintenanceStatus.operation?.status).toBe("running");
      expect(maintenanceStatus.operation?.message).toContain("restoring snapshot");
      expect(maintenanceStatus.operation?.detail?.phase).toBe("rollback");

      const metricsResponse = await app.inject({
        method: "GET",
        url: "/metrics",
        headers: {
          authorization: "Bearer metrics-token-123456"
        }
      });
      expect(metricsResponse.statusCode).toBe(200);
    } finally {
      rmSync(maintenanceDir, { recursive: true, force: true });
    }

    const clearedMaintenanceResponse = await app.inject({
      method: "GET",
      url: "/api/runtime/maintenance"
    });
    expect(clearedMaintenanceResponse.statusCode).toBe(200);
    expect(
      parseJson<{ active: boolean; maintenance: null; operation: null }>(clearedMaintenanceResponse)
    ).toMatchObject({
      active: false,
      maintenance: null,
      operation: null
    });
  });
});
