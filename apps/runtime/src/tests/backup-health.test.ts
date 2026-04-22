import type { BackupOperation, BackupSnapshot } from "@qpilot/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const previousEnv = new Map<string, string | undefined>();

const makeSnapshot = (overrides: Partial<BackupSnapshot> = {}): BackupSnapshot => ({
  snapshotId: "20260422T030000Z-scheduled-a1b2c3d4",
  kind: "scheduled",
  createdAt: "2026-04-22T03:00:00.000Z",
  sharedRoot: "/opt/qpilot-studio/shared",
  appVersion: "0.1.0",
  gitCommit: "abcdef1234567",
  schemaVersion: 1,
  archiveBytes: 1024,
  sha256: "abc123",
  host: "backup-host",
  objectKey: "backups/2026/04/snapshot/archive.tar.gz.enc",
  manifestKey: "backups/2026/04/snapshot/manifest.json",
  ...overrides
});

const makeOperation = (overrides: Partial<BackupOperation> = {}): BackupOperation => ({
  id: "operation-1",
  type: "backup",
  status: "succeeded",
  snapshotId: "20260422T030000Z-scheduled-a1b2c3d4",
  snapshotKind: "scheduled",
  triggeredBy: "systemd-timer",
  message: "Backup completed.",
  detail: {},
  createdAt: "2026-04-22T03:00:00.000Z",
  updatedAt: "2026-04-22T03:05:00.000Z",
  startedAt: "2026-04-22T03:00:00.000Z",
  finishedAt: "2026-04-22T03:05:00.000Z",
  ...overrides
});

describe("backup health summary", () => {
  beforeAll(() => {
    const envOverrides: Record<string, string> = {
      NODE_ENV: "test",
      CREDENTIAL_MASTER_KEY:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    };

    for (const [key, value] of Object.entries(envOverrides)) {
      previousEnv.set(key, process.env[key]);
      process.env[key] = value;
    }
  });

  afterAll(() => {
    for (const [key, value] of previousEnv.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("marks backup health as not configured when config is incomplete", async () => {
    vi.resetModules();
    const backupsModule = await import("../platform/backups.js");

    const summary = backupsModule.buildBackupHealthSummary({
      checkedAt: "2026-04-22T10:00:00.000Z",
      configured: false,
      configDetail: "Missing backup configuration: BACKUP_ENCRYPTION_KEY.",
      storageState: "not_configured",
      storageDetail: "S3 endpoint, bucket, or credentials are not configured.",
      scheduler: {
        supported: true,
        enabled: false,
        activeState: "inactive",
        subState: "dead",
        detail: "Backup timer is intentionally disabled until backup configuration is complete."
      },
      operations: [],
      snapshots: [],
      staleAfterHours: 36
    });

    expect(summary.state).toBe("not_configured");
    expect(summary.checks.find((check) => check.key === "config")?.state).toBe(
      "not_configured"
    );
  });

  it("marks configured backups as healthy when storage, freshness, and scheduler are healthy", async () => {
    vi.resetModules();
    const backupsModule = await import("../platform/backups.js");

    const summary = backupsModule.buildBackupHealthSummary({
      checkedAt: "2026-04-22T12:00:00.000Z",
      configured: true,
      configDetail: "Backup storage, credentials, and encryption are configured.",
      storageState: "ready",
      storageDetail: "S3 bucket qpilot-backups is reachable.",
      scheduler: {
        supported: true,
        enabled: true,
        activeState: "active",
        subState: "waiting",
        nextTriggerAt: "2026-04-23T03:30:00.000Z",
        lastTriggerAt: "2026-04-22T03:30:00.000Z",
        lastResult: "success",
        detail: "Backup timer status is healthy."
      },
      operations: [makeOperation()],
      snapshots: [makeSnapshot()],
      staleAfterHours: 36
    });

    expect(summary.state).toBe("ready");
    expect(summary.latestSnapshotId).toBe("20260422T030000Z-scheduled-a1b2c3d4");
    expect(summary.checks.every((check) => check.state === "ready")).toBe(true);
  });

  it("marks backup freshness as failed when the latest successful backup is stale", async () => {
    vi.resetModules();
    const backupsModule = await import("../platform/backups.js");

    const summary = backupsModule.buildBackupHealthSummary({
      checkedAt: "2026-04-24T18:00:00.000Z",
      configured: true,
      configDetail: "Backup storage, credentials, and encryption are configured.",
      storageState: "ready",
      storageDetail: "S3 bucket qpilot-backups is reachable.",
      scheduler: {
        supported: true,
        enabled: true,
        activeState: "active",
        subState: "waiting",
        lastResult: "success",
        detail: "Backup timer status is healthy."
      },
      operations: [makeOperation()],
      snapshots: [makeSnapshot()],
      staleAfterHours: 36
    });

    expect(summary.state).toBe("failed");
    expect(summary.checks.find((check) => check.key === "freshness")?.state).toBe(
      "failed"
    );
  });

  it("surfaces recent execution failures and storage probe failures", async () => {
    vi.resetModules();
    const backupsModule = await import("../platform/backups.js");

    const summary = backupsModule.buildBackupHealthSummary({
      checkedAt: "2026-04-22T12:00:00.000Z",
      configured: true,
      configDetail: "Backup storage, credentials, and encryption are configured.",
      storageState: "failed",
      storageDetail: "connect ECONNREFUSED 127.0.0.1:9000",
      scheduler: {
        supported: true,
        enabled: true,
        activeState: "active",
        subState: "waiting",
        lastResult: "success",
        detail: "Backup timer status is healthy."
      },
      operations: [
        makeOperation({
          id: "operation-failed",
          status: "failed",
          error: "Upload failed.",
          updatedAt: "2026-04-22T11:55:00.000Z",
          finishedAt: "2026-04-22T11:55:00.000Z"
        })
      ],
      snapshots: [],
      staleAfterHours: 36
    });

    expect(summary.state).toBe("failed");
    expect(summary.checks.find((check) => check.key === "storage")?.state).toBe(
      "failed"
    );
    expect(summary.checks.find((check) => check.key === "execution")?.state).toBe(
      "failed"
    );
    expect(summary.lastFailedOperation?.operationId).toBe("operation-failed");
  });

  it("treats unsupported scheduler probing as warning and disabled timers as failed when configured", async () => {
    vi.resetModules();
    const backupsModule = await import("../platform/backups.js");

    const unsupported = await backupsModule.backupInternals.probeBackupSchedulerStatus({
      configured: true,
      platform: "win32",
      hasSystemctl: false
    });
    expect(unsupported.supported).toBe(false);

    const disabled = await backupsModule.backupInternals.probeBackupSchedulerStatus({
      configured: true,
      platform: "linux",
      hasSystemctl: true,
      capture: (_command: string, args: string[]) => {
        if (args.includes("qpilot-backup.timer")) {
          return {
            ok: true,
            stdout: [
              "ActiveState=inactive",
              "SubState=dead",
              "UnitFileState=disabled",
              "LastTriggerUSec=n/a",
              "NextElapseUSecRealtime=n/a",
              "Result=success"
            ].join("\n"),
            stderr: "",
            code: 0
          };
        }

        return {
          ok: true,
          stdout: [
            "ActiveState=inactive",
            "SubState=dead",
            "Result=exit-code"
          ].join("\n"),
          stderr: "",
          code: 0
        };
      }
    });

    const summary = backupsModule.buildBackupHealthSummary({
      checkedAt: "2026-04-22T12:00:00.000Z",
      configured: true,
      configDetail: "Backup storage, credentials, and encryption are configured.",
      storageState: "ready",
      storageDetail: "S3 bucket qpilot-backups is reachable.",
      scheduler: disabled,
      operations: [makeOperation()],
      snapshots: [makeSnapshot()],
      staleAfterHours: 36
    });

    expect(summary.checks.find((check) => check.key === "scheduler")?.state).toBe(
      "failed"
    );
  });
});
