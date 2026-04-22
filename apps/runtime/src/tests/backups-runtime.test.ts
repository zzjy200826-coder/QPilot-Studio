import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { RestoreVerificationResult } from "@qpilot/shared";

const tempRoot = mkdtempSync(join(tmpdir(), "qpilot-backups-runtime-"));
const sharedRoot = resolve(tempRoot, "shared");
const dataRoot = resolve(sharedRoot, "data");
const artifactsRoot = resolve(dataRoot, "artifacts");
const reportsRoot = resolve(dataRoot, "reports");
const sessionsRoot = resolve(dataRoot, "sessions");
const plannerCacheRoot = resolve(dataRoot, "planner-cache");
const opsRoot = resolve(tempRoot, "ops");
const backupOpsRoot = resolve(opsRoot, "backups");
const s3Root = resolve(tempRoot, "s3");
const databasePath = resolve(dataRoot, "runtime.db");
const previousEnv = new Map<string, string | undefined>();

let app: any;
let backupsModule: typeof import("../platform/backups.js");
let s3rver: any;
let s3Client: S3Client;

const ownerEmail = "backup.owner@example.test";
const ownerPassword = "Password123!";
const bucketName = "qpilot-backups";

const createVerificationResult = (input: {
  ok: boolean;
  failedLabel?: string;
  failedDetail?: string;
}): RestoreVerificationResult => {
  const state: RestoreVerificationResult["checks"][number]["state"] = input.ok
    ? "passed"
    : "failed";

  return {
    ok: input.ok,
    checkedAt: new Date().toISOString(),
    baseUrl: "http://127.0.0.1:8897",
    checks: [
      {
        key: input.ok ? "health" : "ready",
        label: input.failedLabel ?? "GET /health",
        state,
        status: input.ok ? 200 : 503,
        detail:
          input.ok ? "Runtime smoke verification passed." : input.failedDetail ?? "Smoke failed.",
        checkedAt: new Date().toISOString()
      }
    ]
  };
};

const readBodyBuffer = async (body: unknown): Promise<Buffer> => {
  if (!body) {
    return Buffer.alloc(0);
  }
  if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === "function") {
    return Buffer.from(
      await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray()
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | Uint8Array | string>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const queueSummary = {
  mode: "inline" as const,
  queueName: "platform-load-runs",
  workerEnabled: false,
  workerConcurrency: 1,
  isConnected: false,
  counts: {
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
    delayed: 0
  },
  retryPolicy: {
    attempts: 3,
    backoffMs: 1500
  },
  workerHealth: {
    timeoutMs: 15_000,
    busyWorkers: 0,
    staleWorkers: 0,
    freshestHeartbeatAt: undefined
  },
  detail: "Test queue summary",
  lastActivityAt: undefined,
  lastError: undefined,
  samples: [],
  checkedAt: new Date().toISOString()
};

describe.sequential("instance backup and restore", () => {
  beforeAll(async () => {
    mkdirSync(artifactsRoot, { recursive: true });
    mkdirSync(reportsRoot, { recursive: true });
    mkdirSync(sessionsRoot, { recursive: true });
    mkdirSync(plannerCacheRoot, { recursive: true });
    mkdirSync(opsRoot, { recursive: true });
    mkdirSync(s3Root, { recursive: true });

    const envOverrides: Record<string, string> = {
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: "8897",
      CORS_ORIGIN: "http://127.0.0.1:4197",
      DATABASE_URL: databasePath,
      ARTIFACTS_DIR: artifactsRoot,
      REPORTS_DIR: reportsRoot,
      SESSIONS_DIR: sessionsRoot,
      PLANNER_CACHE_DIR: plannerCacheRoot,
      CREDENTIAL_MASTER_KEY:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      PLATFORM_REDIS_URL: "",
      PLATFORM_REDIS_WORKER_ENABLED: "false",
      BACKUP_SHARED_ROOT: sharedRoot,
      BACKUP_OPS_ROOT: opsRoot,
      BACKUP_S3_ENDPOINT: "http://127.0.0.1:4570",
      BACKUP_S3_REGION: "us-east-1",
      BACKUP_S3_BUCKET: bucketName,
      BACKUP_S3_PREFIX: "backups",
      BACKUP_S3_ACCESS_KEY_ID: "S3RVER",
      BACKUP_S3_SECRET_ACCESS_KEY: "S3RVER",
      BACKUP_S3_FORCE_PATH_STYLE: "true",
      BACKUP_ENCRYPTION_KEY:
        "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
      BACKUP_RETENTION_DAYS: "14"
    };

    for (const [key, value] of Object.entries(envOverrides)) {
      previousEnv.set(key, process.env[key]);
      process.env[key] = value;
    }

    const S3rver = (await import("s3rver")).default;
    s3rver = new S3rver({
      address: "127.0.0.1",
      port: 4570,
      silent: true,
      directory: s3Root,
      resetOnClose: true,
      allowMismatchedSignatures: true,
      configureBuckets: [{ name: bucketName }]
    });
    await s3rver.run();

    s3Client = new S3Client({
      endpoint: "http://127.0.0.1:4570",
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: "S3RVER",
        secretAccessKey: "S3RVER"
      }
    });

    vi.resetModules();
    backupsModule = await import("../platform/backups.js");
    writeFileSync(resolve(sharedRoot, "README.restore.txt"), "before-backup", "utf8");
    writeFileSync(resolve(artifactsRoot, "sample.txt"), "artifact-content", "utf8");
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (s3rver) {
      await s3rver.close();
    }
    for (const [key, value] of previousEnv.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore cleanup races on Windows
    }
  });

  afterEach(async () => {
    backupsModule.backupInternals.setRestoreVerificationRunner();
    rmSync(resolve(backupOpsRoot, "maintenance.json"), { force: true });
    rmSync(resolve(backupOpsRoot, "lock.json"), { force: true });
  });

  it("creates a backup snapshot, lists it, restores shared content, and prunes old scheduled snapshots", async () => {
    await backupsModule.runBackupCreateCli(["--kind", "manual"]);

    const config = await backupsModule.getBackupConfigStatus();
    expect(config.configured).toBe(true);
    expect(config.lastSuccessfulBackupAt).toBeTruthy();
    expect(config.health.state).toBeDefined();
    expect(config.health.checks.some((check) => check.key === "storage")).toBe(true);

    const snapshots = await backupsModule.listBackupSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.kind).toBe("manual");

    writeFileSync(resolve(sharedRoot, "README.restore.txt"), "mutated-after-backup", "utf8");
    const preflight = await backupsModule.buildRestorePreflight({
      snapshotId: snapshots[0]!.snapshotId,
      functionalRunActive: false,
      queueHealth: queueSummary
    });
    expect(preflight.ok).toBe(true);

    backupsModule.backupInternals.setRestoreVerificationRunner(async () =>
      createVerificationResult({ ok: true })
    );
    await backupsModule.performRestoreSnapshot({
      snapshotId: snapshots[0]!.snapshotId,
      skipServiceControl: true
    });

    expect(readFileSync(resolve(sharedRoot, "README.restore.txt"), "utf8")).toBe("before-backup");
    const restoreHistory = (await backupsModule.getBackupConfigStatus()).restoreHistory;
    expect(restoreHistory[0]?.status).toBe("succeeded");
    expect(restoreHistory[0]?.detail.phase).toBe("completed");
    expect(restoreHistory[0]?.detail.verification?.ok).toBe(true);
    expect(await backupsModule.getMaintenanceState()).toBeNull();

    const manifest = await backupsModule.backupInternals.getSnapshotManifest(
      snapshots[0]!.snapshotId
    );
    const oldCreatedAt = "2024-01-01T00:00:00.000Z";
    const oldSnapshotId = "20240101T000000Z-scheduled-old";
    const oldObjectKey = backupsModule.backupInternals.getBackupKey(
      oldCreatedAt,
      oldSnapshotId,
      "archive.tar.gz.enc"
    );
    const oldManifestKey = backupsModule.backupInternals.getBackupKey(
      oldCreatedAt,
      oldSnapshotId,
      "manifest.json"
    );
    const archiveSource = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: manifest.objectKey
      })
    );
    const archiveBuffer = await readBodyBuffer(archiveSource.Body);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: oldObjectKey,
        Body: archiveBuffer
      })
    );
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: oldManifestKey,
        Body: JSON.stringify({
          ...manifest,
          snapshotId: oldSnapshotId,
          kind: "scheduled",
          createdAt: oldCreatedAt,
          objectKey: oldObjectKey,
          manifestKey: oldManifestKey
        })
      })
    );

    const beforePrune = await backupsModule.listBackupSnapshots();
    expect(beforePrune.some((snapshot) => snapshot.snapshotId === oldSnapshotId)).toBe(true);

    const pruneResult = await backupsModule.backupInternals.pruneScheduledSnapshots();
    expect(pruneResult.deletedSnapshotIds).toContain(oldSnapshotId);

    const afterPrune = await backupsModule.listBackupSnapshots();
    expect(afterPrune.some((snapshot) => snapshot.snapshotId === oldSnapshotId)).toBe(false);
    expect(afterPrune.some((snapshot) => snapshot.kind === "manual")).toBe(true);
  });

  it("auto-rolls back to the pre-restore snapshot when smoke verification fails", async () => {
    writeFileSync(resolve(sharedRoot, "README.restore.txt"), "current-good-state", "utf8");
    await backupsModule.runBackupCreateCli(["--kind", "manual"]);
    writeFileSync(resolve(sharedRoot, "README.restore.txt"), "bad-restore-state", "utf8");
    await backupsModule.runBackupCreateCli(["--kind", "manual"]);
    writeFileSync(resolve(sharedRoot, "README.restore.txt"), "current-good-state", "utf8");

    const snapshots = await backupsModule.listBackupSnapshots();
    const targetSnapshot = snapshots.find(
      (snapshot) => snapshot.kind === "manual" && snapshot.snapshotId.includes("manual")
    );
    expect(targetSnapshot).toBeTruthy();

    let verificationAttempt = 0;
    backupsModule.backupInternals.setRestoreVerificationRunner(async () => {
      verificationAttempt += 1;
      return verificationAttempt === 1
        ? createVerificationResult({
            ok: false,
            failedLabel: "GET /health/ready",
            failedDetail: "Readiness probe returned HTTP 503."
          })
        : createVerificationResult({ ok: true });
    });

    await backupsModule.performRestoreSnapshot({
      snapshotId: targetSnapshot!.snapshotId,
      skipServiceControl: true
    });

    expect(readFileSync(resolve(sharedRoot, "README.restore.txt"), "utf8")).toBe("current-good-state");
    const restoreHistory = (await backupsModule.getBackupConfigStatus()).restoreHistory;
    expect(restoreHistory[0]?.status).toBe("failed");
    expect(restoreHistory[0]?.detail.rollbackSucceeded).toBe(true);
    expect(restoreHistory[0]?.detail.verification?.ok).toBe(false);
    expect(restoreHistory[0]?.detail.rollbackVerification?.ok).toBe(true);
    expect(restoreHistory[0]?.detail.failureReason).toBe("restore_verification_failed");
    expect(await backupsModule.getMaintenanceState()).toBeNull();
  });

  it("keeps maintenance enabled when auto rollback verification also fails", async () => {
    writeFileSync(resolve(sharedRoot, "README.restore.txt"), "stable-before-restore", "utf8");
    await backupsModule.runBackupCreateCli(["--kind", "manual"]);
    writeFileSync(resolve(sharedRoot, "README.restore.txt"), "rollback-failure-target", "utf8");
    await backupsModule.runBackupCreateCli(["--kind", "manual"]);
    writeFileSync(resolve(sharedRoot, "README.restore.txt"), "stable-before-restore", "utf8");

    const snapshots = await backupsModule.listBackupSnapshots();
    const targetSnapshot = snapshots.find(
      (snapshot) => snapshot.kind === "manual" && snapshot.snapshotId.includes("manual")
    );
    expect(targetSnapshot).toBeTruthy();

    backupsModule.backupInternals.setRestoreVerificationRunner(async () =>
      createVerificationResult({
        ok: false,
        failedLabel: "GET /health/ready",
        failedDetail: "Readiness probe returned HTTP 503."
      })
    );

    await expect(
      backupsModule.performRestoreSnapshot({
        snapshotId: targetSnapshot!.snapshotId,
        skipServiceControl: true
      })
    ).rejects.toThrow(/Readiness probe returned HTTP 503/);

    const restoreHistory = (await backupsModule.getBackupConfigStatus()).restoreHistory;
    expect(restoreHistory[0]?.status).toBe("failed");
    expect(restoreHistory[0]?.detail.rollbackSucceeded).toBe(false);
    expect(restoreHistory[0]?.detail.rollbackVerification?.ok).toBe(false);
    expect(restoreHistory[0]?.detail.failureReason).toBe("restore_auto_rollback_failed");
    const maintenanceState = await backupsModule.getMaintenanceState();
    expect(maintenanceState?.active).toBe(true);
    expect(maintenanceState?.phase).toBe("rollback");
  });

  it("requires an owner interactive session for backup routes", async () => {
    if (!app) {
      const serverModule = await import("../server.js");
      app = await serverModule.createServer();
      await app.ready();
    }

    const anonymousResponse = await app.inject({
      method: "GET",
      url: "/api/platform/ops/backups/config"
    });
    expect(anonymousResponse.statusCode).toBe(401);

    const registerResponse = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: ownerEmail,
        password: ownerPassword,
        displayName: "Backup Owner",
        tenantName: "Backup Workspace"
      }
    });
    expect(registerResponse.statusCode).toBe(200);
    const ownerCookie = String(registerResponse.headers["set-cookie"]).split(";")[0] ?? "";

    const configResponse = await app.inject({
      method: "GET",
      url: "/api/platform/ops/backups/config",
      headers: {
        cookie: ownerCookie
      }
    });
    expect(configResponse.statusCode).toBe(200);
    const configJson = JSON.parse(configResponse.body);
    expect(configJson.configured).toBe(true);
    expect(configJson.health).toBeTruthy();
    expect(configJson.health.checks.some((check: { key: string }) => check.key === "scheduler")).toBe(
      true
    );

    const tokenResponse = await app.inject({
      method: "POST",
      url: "/api/auth/tokens",
      headers: {
        cookie: ownerCookie
      },
      payload: {
        label: "Gate token",
        scopes: ["gate:read"]
      }
    });
    const plainTextToken = JSON.parse(tokenResponse.body).plainTextToken as string;
    expect(plainTextToken).toContain("qpt_");

    const tokenDeniedResponse = await app.inject({
      method: "GET",
      url: "/api/platform/ops/backups/config",
      headers: {
        authorization: `Bearer ${plainTextToken}`
      }
    });
    expect(tokenDeniedResponse.statusCode).toBe(403);
  }, 15_000);
});
