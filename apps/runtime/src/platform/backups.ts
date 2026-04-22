import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  statfs,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { nanoid } from "nanoid";
import * as tar from "tar";
import {
  BackupOperationDetailSchema,
  BackupConfigStatusSchema,
  BackupHealthSummarySchema,
  BackupOperationSchema,
  BackupPreflightResultSchema,
  BackupSchedulerStatusSchema,
  BackupSnapshotSchema,
  MaintenanceStatusSchema,
  RestoreVerificationResultSchema,
  runPlatformSmokeVerification,
  type BackupHealthCheck,
  type BackupHealthCheckKey,
  type BackupHealthState,
  type BackupHealthSummary,
  type BackupConfigStatus,
  type BackupOperationDetail,
  type BackupSchedulerStatus,
  type BackupOperation,
  type BackupPreflightResult,
  type BackupSnapshot,
  type BackupSnapshotKind,
  type MaintenanceStatus,
  type RestorePhase,
  type RestoreVerificationResult,
  type PlatformLoadQueueSummary
} from "@qpilot/shared";
import { z } from "zod";
import { env, RUNTIME_ROOT } from "../config/env.js";

const BACKUP_SCHEMA_VERSION = 1;
const BACKUP_SCHEDULE_LABEL = "Daily 03:30";
const BACKUP_RUNTIME_SYSTEMD_UNIT = "qpilot-runtime.service";
const backupScriptsRoot = resolve(RUNTIME_ROOT, "src", "scripts");
const currentFile = fileURLToPath(import.meta.url);
const runtimeSrcRoot = resolve(dirname(currentFile), "..");
const workspaceRoot = resolve(runtimeSrcRoot, "..", "..");

const BackupManifestSchema = BackupSnapshotSchema.extend({
  encryption: z.object({
    algorithm: z.literal("aes-256-gcm"),
    ivHex: z.string(),
    authTagHex: z.string()
  })
});

type BackupManifest = z.infer<typeof BackupManifestSchema>;

type BackupOperationRecord = BackupOperation;

type BackupHealthCheckRecord = BackupHealthCheck;

interface BackupHealthEvaluationInput {
  checkedAt: string;
  configured: boolean;
  configDetail: string;
  storageState: BackupHealthState;
  storageDetail: string;
  scheduler: BackupSchedulerStatus;
  operations: BackupOperationRecord[];
  snapshots: BackupSnapshot[];
  staleAfterHours: number;
}

interface BackupStorageProbeResult {
  state: BackupHealthState;
  detail: string;
}

interface BackupRuntimeLogger {
  info?: (payload: unknown, message?: string) => void;
  warn?: (payload: unknown, message?: string) => void;
  error?: (payload: unknown, message?: string) => void;
}

interface RestorePreflightInput {
  snapshotId: string;
  functionalRunActive: boolean;
  queueHealth: PlatformLoadQueueSummary;
}

interface PerformBackupInput {
  kind: BackupSnapshotKind;
  operationId?: string;
  triggeredBy?: string;
  pruneAfter?: boolean;
}

interface PerformRestoreInput {
  snapshotId: string;
  operationId?: string;
  skipServiceControl?: boolean;
}

interface RestoreApplySnapshotInput {
  manifest: BackupManifest;
  operationId: string;
  skipServiceControl?: boolean;
  phaseMode: "primary" | "rollback";
}

interface SpawnedOperationInput {
  operationId: string;
  script: "backup-create.ts" | "backup-restore.ts";
  args: string[];
  detachedName?: string;
  forceDetachedChild?: boolean;
}

type RestoreVerificationRunner = (input: {
  baseUrl: string;
  metricsToken?: string;
  timeoutMs: number;
}) => Promise<RestoreVerificationResult>;

let restoreVerificationRunner: RestoreVerificationRunner = async (input) =>
  await runPlatformSmokeVerification(input);

const toIso = (value: number): string => new Date(value).toISOString();

const fromIso = (value?: string): number | undefined =>
  value ? Date.parse(value) : undefined;

const createSnapshotStamp = (): string =>
  new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

const createSnapshotId = (kind: BackupSnapshotKind): string =>
  `${createSnapshotStamp()}-${kind}-${nanoid(8)}`;

const readWorkspaceVersion = (() => {
  let cached: string | null = null;
  return async (): Promise<string> => {
    if (cached) {
      return cached;
    }
    try {
      const packageJson = JSON.parse(
        await readFile(resolve(workspaceRoot, "package.json"), "utf8")
      ) as { version?: string };
      cached = packageJson.version ?? "0.1.0";
    } catch {
      cached = "0.1.0";
    }
    return cached;
  };
})();

const resolveGitCommit = (() => {
  let cached: string | null | undefined;
  return (): string | undefined => {
    if (cached !== undefined) {
      return cached ?? undefined;
    }
    const result = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: workspaceRoot,
      encoding: "utf8",
      windowsHide: true
    });
    cached = result.status === 0 ? result.stdout.trim() || null : null;
    return cached ?? undefined;
  };
})();

const configuredS3Endpoint = (): boolean =>
  Boolean(
    env.BACKUP_S3_ENDPOINT &&
      env.BACKUP_S3_BUCKET &&
      env.BACKUP_S3_ACCESS_KEY_ID &&
      env.BACKUP_S3_SECRET_ACCESS_KEY
  );

export const isBackupConfigured = (): boolean =>
  configuredS3Endpoint() && Boolean(env.BACKUP_ENCRYPTION_KEY);

const normalizeSystemdTimestamp = (value?: string): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "n/a" || trimmed === "[not set]") {
    return undefined;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? trimmed : new Date(parsed).toISOString();
};

const parseSystemdShowOutput = (stdout: string): Record<string, string> =>
  stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((result, line) => {
      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        return result;
      }
      const key = line.slice(0, separatorIndex);
      const value = line.slice(separatorIndex + 1);
      result[key] = value;
      return result;
    }, {});

const runSystemCommandCapture = (
  command: string,
  args: string[],
  options?: { cwd?: string }
): { ok: boolean; stdout: string; stderr: string; code: number | null } => {
  const result = spawnSync(command, args, {
    cwd: options?.cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: 5_000
  });

  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status
  };
};

const makeBackupHealthCheck = (
  key: BackupHealthCheckKey,
  label: string,
  state: BackupHealthState,
  detail: string,
  checkedAt: string
): BackupHealthCheckRecord => ({
  key,
  label,
  state,
  detail,
  checkedAt
});

const getLatestFailedOperation = (
  operations: BackupOperationRecord[]
): BackupHealthSummary["lastFailedOperation"] | undefined => {
  const latest = operations.find(
    (operation) => operation.status === "failed" && typeof operation.error === "string"
  );
  if (!latest?.error) {
    return undefined;
  }
  return {
    operationId: latest.id,
    updatedAt: latest.updatedAt,
    error: latest.error,
    snapshotId: latest.snapshotId
  };
};

const hasMoreRecentSuccess = (
  operations: BackupOperationRecord[],
  failedOperation: BackupOperationRecord
): boolean =>
  operations.some((operation) => {
    if (operation.type !== failedOperation.type || operation.status !== "succeeded") {
      return false;
    }
    const successAt = fromIso(operation.finishedAt) ?? fromIso(operation.updatedAt) ?? 0;
    const failureAt = fromIso(failedOperation.updatedAt) ?? 0;
    return successAt >= failureAt;
  });

const getBackupKey = (createdAt: string, snapshotId: string, suffix: string): string => {
  const [year, month] = [
    createdAt.slice(0, 4),
    createdAt.slice(5, 7)
  ];
  const normalizedPrefix = env.BACKUP_S3_PREFIX.replace(/^\/+|\/+$/g, "");
  return `${normalizedPrefix}/${year}/${month}/${snapshotId}/${suffix}`;
};

const getBackupOpsPaths = () => ({
  root: resolve(env.BACKUP_OPS_ROOT),
  operationsDir: resolve(env.BACKUP_OPS_ROOT, "backups", "operations"),
  lockFile: resolve(env.BACKUP_OPS_ROOT, "backups", "restore.lock"),
  maintenanceFile: resolve(env.BACKUP_OPS_ROOT, "backups", "maintenance.json"),
  tempDir: resolve(env.BACKUP_OPS_ROOT, "backups", "tmp")
});

const ensureBackupOpsLayout = async (): Promise<void> => {
  const opsPaths = getBackupOpsPaths();
  await Promise.all([
    mkdir(opsPaths.root, { recursive: true }),
    mkdir(opsPaths.operationsDir, { recursive: true }),
    mkdir(opsPaths.tempDir, { recursive: true })
  ]);
};

const getBackupS3Client = (): S3Client => {
  if (!configuredS3Endpoint()) {
    throw new Error("Backup S3 storage is not configured.");
  }
  return new S3Client({
    endpoint: env.BACKUP_S3_ENDPOINT,
    region: env.BACKUP_S3_REGION,
    forcePathStyle: env.BACKUP_S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID!,
      secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY!
    }
  });
};

const sha256File = async (absolutePath: string): Promise<string> => {
  const hash = createHash("sha256");
  const stream = createReadStream(absolutePath);
  stream.on("data", (chunk) => {
    hash.update(chunk);
  });
  await new Promise<void>((resolveHash, reject) => {
    stream.on("end", () => resolveHash());
    stream.on("error", reject);
  });
  return hash.digest("hex");
};

const encryptArchive = async (input: {
  sourcePath: string;
  targetPath: string;
}): Promise<{ ivHex: string; authTagHex: string }> => {
  if (!env.BACKUP_ENCRYPTION_KEY) {
    throw new Error("BACKUP_ENCRYPTION_KEY is not configured.");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(env.BACKUP_ENCRYPTION_KEY, "hex"),
    iv
  );
  await pipeline(
    createReadStream(input.sourcePath),
    cipher,
    createWriteStream(input.targetPath)
  );
  return {
    ivHex: iv.toString("hex"),
    authTagHex: cipher.getAuthTag().toString("hex")
  };
};

const decryptArchive = async (input: {
  sourcePath: string;
  targetPath: string;
  ivHex: string;
  authTagHex: string;
}): Promise<void> => {
  if (!env.BACKUP_ENCRYPTION_KEY) {
    throw new Error("BACKUP_ENCRYPTION_KEY is not configured.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(env.BACKUP_ENCRYPTION_KEY, "hex"),
    Buffer.from(input.ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(input.authTagHex, "hex"));
  await pipeline(
    createReadStream(input.sourcePath),
    decipher,
    createWriteStream(input.targetPath)
  );
};

const buildOperationFile = (operationId: string): string =>
  resolve(getBackupOpsPaths().operationsDir, `${operationId}.json`);

const writeOperationRecord = async (
  operation: BackupOperationRecord
): Promise<BackupOperation> => {
  await ensureBackupOpsLayout();
  await writeFile(
    buildOperationFile(operation.id),
    JSON.stringify(operation, null, 2),
    "utf8"
  );
  return BackupOperationSchema.parse(operation);
};

const readOperationRecord = async (
  operationId: string
): Promise<BackupOperationRecord | null> => {
  try {
    const raw = await readFile(buildOperationFile(operationId), "utf8");
    return BackupOperationSchema.extend({
      detail: z.record(z.string(), z.unknown()).default({})
    }).parse(JSON.parse(raw));
  } catch {
    return null;
  }
};

const updateOperationRecord = async (
  operationId: string,
  input: Partial<BackupOperationRecord>
): Promise<BackupOperation> => {
  const existing = await readOperationRecord(operationId);
  if (!existing) {
    throw new Error(`Backup operation ${operationId} was not found.`);
  }
  return writeOperationRecord({
    ...existing,
    ...input,
    detail: {
      ...existing.detail,
      ...(input.detail ?? {})
    },
    updatedAt: new Date().toISOString()
  });
};

const parseOperationDetail = (detail?: BackupOperation["detail"]): BackupOperationDetail =>
  BackupOperationDetailSchema.parse(detail ?? {});

const resolveRestoreVerificationBaseUrl = (): string => {
  const configuredOrigins = env.CORS_ORIGIN.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const publicOrigin = configuredOrigins.find((entry) => /^https?:\/\//i.test(entry));
  return publicOrigin ?? `http://${env.HOST}:${env.PORT}`;
};

const summarizeVerificationFailure = (result: RestoreVerificationResult): string => {
  const firstFailedCheck = result.checks.find((check) => check.state === "failed");
  if (!firstFailedCheck) {
    return "Platform smoke verification failed.";
  }
  const statusSuffix =
    typeof firstFailedCheck.status === "number" ? ` (HTTP ${firstFailedCheck.status})` : "";
  return `${firstFailedCheck.label}${statusSuffix}: ${firstFailedCheck.detail}`;
};

const mergeOperationDetail = (
  existing: BackupOperation["detail"] | undefined,
  input: Partial<BackupOperationDetail>
): BackupOperationDetail =>
  BackupOperationDetailSchema.parse({
    ...parseOperationDetail(existing),
    ...input
  });

const createOperationRecord = async (input: {
  type: BackupOperation["type"];
  snapshotId?: string;
  snapshotKind?: BackupSnapshotKind;
  triggeredBy?: string;
  message?: string;
  detail?: Record<string, unknown>;
}): Promise<BackupOperation> => {
  const now = new Date().toISOString();
  return writeOperationRecord({
    id: nanoid(),
    type: input.type,
    status: "queued",
    snapshotId: input.snapshotId,
    snapshotKind: input.snapshotKind,
    triggeredBy: input.triggeredBy,
    message: input.message,
    detail: input.detail ?? {},
    createdAt: now,
    updatedAt: now
  });
};

const listOperationRecords = async (): Promise<BackupOperationRecord[]> => {
  await ensureBackupOpsLayout();
  const files = await readdir(getBackupOpsPaths().operationsDir);
  const operations = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => {
        try {
          const raw = await readFile(resolve(getBackupOpsPaths().operationsDir, file), "utf8");
          return BackupOperationSchema.parse(JSON.parse(raw));
        } catch {
          return null;
        }
      })
  );
  return operations
    .filter((value): value is BackupOperationRecord => value !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
};

const findActiveOperation = async (): Promise<BackupOperation | undefined> => {
  const operations = await listOperationRecords();
  return operations.find((operation) =>
    operation.status === "queued" || operation.status === "running"
  );
};

const listRestoreHistory = async (): Promise<BackupOperation[]> => {
  const operations = await listOperationRecords();
  return operations
    .filter((operation) => operation.type === "restore")
    .slice(0, 8)
    .map((operation) => BackupOperationSchema.parse(operation));
};

const getLastSuccessfulBackupAt = async (): Promise<string | undefined> => {
  const operations = await listOperationRecords();
  return operations.find(
    (operation) => operation.type === "backup" && operation.status === "succeeded"
  )?.finishedAt;
};

const readBodyToBuffer = async (body: unknown): Promise<Buffer> => {
  if (!body) {
    return Buffer.alloc(0);
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  if (typeof body === "string") {
    return Buffer.from(body);
  }
  if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === "function") {
    const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | Uint8Array | string>) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
    } else {
      chunks.push(Buffer.from(chunk));
    }
  }
  return Buffer.concat(chunks);
};

const getSnapshotManifest = async (snapshotId: string): Promise<BackupManifest> => {
  const snapshots = await listBackupSnapshots();
  const snapshot = snapshots.find((entry) => entry.snapshotId === snapshotId);
  if (!snapshot) {
    throw new Error("Backup snapshot not found.");
  }
  const client = getBackupS3Client();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: env.BACKUP_S3_BUCKET!,
      Key: snapshot.manifestKey
    })
  );
  const raw = await readBodyToBuffer(response.Body);
  return BackupManifestSchema.parse(JSON.parse(raw.toString("utf8")));
};

const createArchive = async (sharedRoot: string, outputFile: string): Promise<void> => {
  await tar.c(
    {
      gzip: true,
      cwd: sharedRoot,
      file: outputFile,
      portable: true
    },
    ["."]
  );
};

const dirSize = async (targetPath: string): Promise<number> => {
  const targetStat = await stat(targetPath);
  if (!targetStat.isDirectory()) {
    return targetStat.size;
  }
  const entries = await readdir(targetPath, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    total += await dirSize(resolve(targetPath, entry.name));
  }
  return total;
};

const writeLockFile = async (operationId: string, snapshotId: string): Promise<void> => {
  const opsPaths = getBackupOpsPaths();
  await ensureBackupOpsLayout();
  await writeFile(
    opsPaths.lockFile,
    JSON.stringify(
      {
        operationId,
        snapshotId,
        createdAt: new Date().toISOString()
      },
      null,
      2
    ),
    "utf8"
  );
};

const clearLockFile = async (): Promise<void> => {
  await unlink(getBackupOpsPaths().lockFile).catch(() => undefined);
};

const clearMaintenanceMarker = async (): Promise<void> => {
  await unlink(getBackupOpsPaths().maintenanceFile).catch(() => undefined);
};

const writeMaintenanceMarker = async (input: {
  operationId: string;
  snapshotId: string;
  message?: string;
  phase?: RestorePhase;
  verification?: RestoreVerificationResult;
  rollbackVerification?: RestoreVerificationResult;
  rollbackSnapshotId?: string;
  failureReason?: string;
}): Promise<void> => {
  await ensureBackupOpsLayout();
  const existing = await readMaintenanceMarker();
  const phaseUpdatedAt =
    input.phase !== undefined
      ? new Date().toISOString()
      : existing?.operationId === input.operationId
        ? existing.phaseUpdatedAt
        : undefined;
  await writeFile(
    getBackupOpsPaths().maintenanceFile,
    JSON.stringify(
      MaintenanceStatusSchema.parse({
        active: true,
        operationId: input.operationId,
        snapshotId: input.snapshotId,
        createdAt:
          existing?.operationId === input.operationId
            ? existing.createdAt
            : new Date().toISOString(),
        message:
          input.message ??
          existing?.message ??
          "Runtime maintenance window is active while restore is running.",
        phase: input.phase ?? existing?.phase,
        phaseUpdatedAt,
        verification: input.verification ?? existing?.verification,
        rollbackVerification: input.rollbackVerification ?? existing?.rollbackVerification,
        rollbackSnapshotId: input.rollbackSnapshotId ?? existing?.rollbackSnapshotId,
        failureReason: input.failureReason ?? existing?.failureReason
      }),
      null,
      2
    ),
    "utf8"
  );
};

const readMaintenanceMarker = async (): Promise<MaintenanceStatus | null> => {
  try {
    const raw = await readFile(getBackupOpsPaths().maintenanceFile, "utf8");
    return MaintenanceStatusSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
};

const updateRestoreProgress = async (input: {
  operationId: string;
  snapshotId: string;
  message?: string;
  phase?: RestorePhase;
  detail?: Partial<BackupOperationDetail>;
  status?: BackupOperation["status"];
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  maintenanceActive?: boolean;
}): Promise<BackupOperation> => {
  const existing = await readOperationRecord(input.operationId);
  if (!existing) {
    throw new Error(`Backup operation ${input.operationId} was not found.`);
  }

  const detail = mergeOperationDetail(existing.detail, {
    ...(input.detail ?? {}),
    ...(input.phase
      ? {
          phase: input.phase,
          phaseUpdatedAt: new Date().toISOString()
        }
      : {})
  });

  const updated = await updateOperationRecord(input.operationId, {
    ...(input.message !== undefined ? { message: input.message } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.error !== undefined ? { error: input.error } : {}),
    ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
    ...(input.finishedAt !== undefined ? { finishedAt: input.finishedAt } : {}),
    detail
  });

  if (input.maintenanceActive === false) {
    await clearMaintenanceMarker();
  } else if (input.maintenanceActive) {
    await writeMaintenanceMarker({
      operationId: input.operationId,
      snapshotId: input.snapshotId,
      message: input.message ?? updated.message,
      phase: detail.phase,
      verification: detail.verification,
      rollbackVerification: detail.rollbackVerification,
      rollbackSnapshotId: detail.rollbackSnapshotId,
      failureReason: detail.failureReason
    });
  }

  return updated;
};

const verifyRestoredPlatform = async (): Promise<RestoreVerificationResult> => {
  return RestoreVerificationResultSchema.parse(
    await restoreVerificationRunner({
      baseUrl: resolveRestoreVerificationBaseUrl(),
      metricsToken: env.METRICS_BEARER_TOKEN,
      timeoutMs: 8_000
    })
  );
};

const commandExists = (command: string): boolean =>
  spawnSync(command, ["--version"], {
    stdio: "ignore",
    shell: process.platform === "win32",
    windowsHide: true
  }).status === 0;

const runSystemCommand = async (
  command: string,
  args: string[],
  options?: { cwd?: string }
): Promise<void> => {
  await new Promise<void>((resolveCommand, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      stdio: "inherit",
      windowsHide: true
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolveCommand();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? 1}.`));
      }
    });
  });
};

const listMissingBackupConfig = (): string[] => {
  const missing: string[] = [];
  if (!env.BACKUP_S3_ENDPOINT) {
    missing.push("BACKUP_S3_ENDPOINT");
  }
  if (!env.BACKUP_S3_BUCKET) {
    missing.push("BACKUP_S3_BUCKET");
  }
  if (!env.BACKUP_S3_ACCESS_KEY_ID) {
    missing.push("BACKUP_S3_ACCESS_KEY_ID");
  }
  if (!env.BACKUP_S3_SECRET_ACCESS_KEY) {
    missing.push("BACKUP_S3_SECRET_ACCESS_KEY");
  }
  if (!env.BACKUP_ENCRYPTION_KEY) {
    missing.push("BACKUP_ENCRYPTION_KEY");
  }
  return missing;
};

const describeBackupConfiguration = (): string => {
  const missing = listMissingBackupConfig();
  if (!missing.length) {
    return "Backup storage, credentials, and encryption are configured.";
  }
  return `Missing backup configuration: ${missing.join(", ")}.`;
};

const probeBackupStorage = async (): Promise<BackupStorageProbeResult> => {
  if (!configuredS3Endpoint()) {
    return {
      state: "not_configured",
      detail: "S3 endpoint, bucket, or credentials are not configured."
    };
  }

  try {
    const client = getBackupS3Client();
    await client.send(
      new HeadBucketCommand({
        Bucket: env.BACKUP_S3_BUCKET!
      })
    );
    await client.send(
      new ListObjectsV2Command({
        Bucket: env.BACKUP_S3_BUCKET!,
        Prefix: env.BACKUP_S3_PREFIX.replace(/^\/+|\/+$/g, ""),
        MaxKeys: 1
      })
    );

    return {
      state: "ready",
      detail: `S3 bucket ${env.BACKUP_S3_BUCKET} is reachable.`
    };
  } catch (error) {
    return {
      state: "failed",
      detail:
        error instanceof Error
          ? error.message
          : "Backup storage probe failed."
    };
  }
};

const probeBackupSchedulerStatus = async (input?: {
  configured?: boolean;
  platform?: NodeJS.Platform;
  hasSystemctl?: boolean;
  capture?: typeof runSystemCommandCapture;
}): Promise<BackupSchedulerStatus> => {
  const configured = input?.configured ?? isBackupConfigured();
  const platform = input?.platform ?? process.platform;
  const hasSystemctl = input?.hasSystemctl ?? commandExists("systemctl");
  const capture = input?.capture ?? runSystemCommandCapture;

  if (platform !== "linux" || !hasSystemctl) {
    return BackupSchedulerStatusSchema.parse({
      supported: false,
      detail: "systemd timer probing is unavailable on this host."
    });
  }

  const timer = capture("systemctl", [
    "show",
    "qpilot-backup.timer",
    "--property=ActiveState",
    "--property=SubState",
    "--property=UnitFileState",
    "--property=LastTriggerUSec",
    "--property=NextElapseUSecRealtime",
    "--property=Result"
  ]);

  const service = capture("systemctl", [
    "show",
    "qpilot-backup.service",
    "--property=ActiveState",
    "--property=SubState",
    "--property=Result",
    "--property=ExecMainStartTimestamp",
    "--property=ExecMainExitTimestamp"
  ]);

  if (!timer.ok) {
    return BackupSchedulerStatusSchema.parse({
      supported: true,
      enabled: false,
      activeState: "unknown",
      subState: "unknown",
      detail: timer.stderr.trim() || "Unable to read qpilot-backup.timer."
    });
  }

  const timerFields = parseSystemdShowOutput(timer.stdout);
  const serviceFields = service.ok ? parseSystemdShowOutput(service.stdout) : {};
  const unitFileState = timerFields.UnitFileState?.trim() ?? "";
  const enabled =
    unitFileState === "enabled" || unitFileState === "enabled-runtime";
  const serviceResult = serviceFields.Result?.trim();
  let detail = "Backup timer status is healthy.";

  if (!configured && !enabled) {
    detail = "Backup timer is intentionally disabled until backup configuration is complete.";
  } else if (!enabled) {
    detail = "qpilot-backup.timer is not enabled.";
  } else if ((timerFields.ActiveState?.trim() ?? "") !== "active") {
    detail = `qpilot-backup.timer is ${timerFields.ActiveState?.trim() ?? "unknown"}.`;
  } else if (
    serviceResult &&
    serviceResult !== "success" &&
    serviceResult !== "done"
  ) {
    detail = `qpilot-backup.service last result is ${serviceResult}.`;
  }

  return BackupSchedulerStatusSchema.parse({
    supported: true,
    enabled,
    activeState: timerFields.ActiveState?.trim() || undefined,
    subState: timerFields.SubState?.trim() || undefined,
    lastTriggerAt: normalizeSystemdTimestamp(timerFields.LastTriggerUSec),
    nextTriggerAt: normalizeSystemdTimestamp(timerFields.NextElapseUSecRealtime),
    lastResult:
      serviceResult ||
      timerFields.Result?.trim() ||
      undefined,
    detail
  });
};

export const buildBackupHealthSummary = (
  input: BackupHealthEvaluationInput
): BackupHealthSummary => {
  const latestSnapshotId = input.snapshots[0]?.snapshotId;
  const activeOperation = input.operations.find(
    (operation) => operation.status === "queued" || operation.status === "running"
  );
  const latestFailedOperationRecord = input.operations.find(
    (operation) =>
      operation.status === "failed" &&
      typeof operation.error === "string" &&
      !hasMoreRecentSuccess(input.operations, operation)
  );
  const lastFailedOperation = getLatestFailedOperation(input.operations);
  const lastSuccessfulBackupAt = input.operations.find(
    (operation) =>
      operation.type === "backup" && operation.status === "succeeded"
  )?.finishedAt;

  const configCheck = makeBackupHealthCheck(
    "config",
    "Configuration",
    input.configured ? "ready" : "not_configured",
    input.configDetail,
    input.checkedAt
  );

  const storageCheck = makeBackupHealthCheck(
    "storage",
    "Storage reachability",
    input.storageState,
    input.storageDetail,
    input.checkedAt
  );

  let freshnessState: BackupHealthState = "ready";
  let freshnessDetail = "Latest backup is within the freshness window.";
  if (!input.configured) {
    freshnessState = "not_configured";
    freshnessDetail = "Backup freshness is unavailable until backup configuration is complete.";
  } else if (!lastSuccessfulBackupAt) {
    freshnessState = "warning";
    freshnessDetail = "No successful backup has been recorded yet.";
  } else {
    const ageMs = Date.parse(input.checkedAt) - Date.parse(lastSuccessfulBackupAt);
    const staleThresholdMs = input.staleAfterHours * 60 * 60 * 1000;
    const ageHours = ageMs / (60 * 60 * 1000);
    if (ageMs > staleThresholdMs) {
      freshnessState = "failed";
      freshnessDetail = `Latest successful backup is ${ageHours.toFixed(1)} hours old, beyond the ${input.staleAfterHours}h freshness window.`;
    } else {
      freshnessDetail = `Latest successful backup was ${ageHours.toFixed(1)} hours ago.`;
    }
  }

  let schedulerState: BackupHealthState = "ready";
  let schedulerDetail =
    input.scheduler.detail ?? "Backup scheduler looks healthy.";
  if (!input.configured) {
    schedulerState = "not_configured";
    schedulerDetail =
      input.scheduler.detail ??
      "Backup scheduler is intentionally disabled until configuration is complete.";
  } else if (!input.scheduler.supported) {
    schedulerState = "warning";
    schedulerDetail =
      input.scheduler.detail ?? "systemd probing is unavailable on this host.";
  } else if (
    input.scheduler.enabled !== true ||
    input.scheduler.activeState !== "active" ||
    (input.scheduler.lastResult &&
      input.scheduler.lastResult !== "success" &&
      input.scheduler.lastResult !== "done")
  ) {
    schedulerState = "failed";
  }

  let executionState: BackupHealthState = "ready";
  let executionDetail = "No recent backup execution problems were detected.";
  if (activeOperation) {
    executionState = "warning";
    executionDetail = `${activeOperation.type} operation ${activeOperation.id} is ${activeOperation.status}.`;
  } else if (latestFailedOperationRecord?.error) {
    executionState = "failed";
    executionDetail = latestFailedOperationRecord.error;
  }

  const checks = [
    configCheck,
    storageCheck,
    makeBackupHealthCheck(
      "freshness",
      "Freshness",
      freshnessState,
      freshnessDetail,
      input.checkedAt
    ),
    makeBackupHealthCheck(
      "scheduler",
      "Scheduler",
      schedulerState,
      schedulerDetail,
      input.checkedAt
    ),
    makeBackupHealthCheck(
      "execution",
      "Execution",
      executionState,
      executionDetail,
      input.checkedAt
    )
  ];

  const state: BackupHealthState = !input.configured
    ? "not_configured"
    : checks.some((check) => check.state === "failed")
      ? "failed"
      : checks.some((check) => check.state === "warning")
        ? "warning"
        : "ready";

  return BackupHealthSummarySchema.parse({
    state,
    checkedAt: input.checkedAt,
    lastSuccessfulBackupAt,
    latestSnapshotId,
    lastFailedOperation,
    scheduler: input.scheduler,
    checks
  });
};

export const getBackupHealthSummary = async (): Promise<BackupHealthSummary> => {
  const checkedAt = new Date().toISOString();
  const storageProbe = await probeBackupStorage();
  let snapshots: BackupSnapshot[] = [];
  if (storageProbe.state === "ready") {
    try {
      snapshots = await listBackupSnapshots();
    } catch (error) {
      return buildBackupHealthSummary({
        checkedAt,
        configured: isBackupConfigured(),
        configDetail: describeBackupConfiguration(),
        storageState: "failed",
        storageDetail:
          error instanceof Error
            ? error.message
            : "Unable to load backup snapshots from storage.",
        scheduler: await probeBackupSchedulerStatus({
          configured: isBackupConfigured()
        }),
        operations: await listOperationRecords(),
        snapshots: [],
        staleAfterHours: env.BACKUP_STALE_AFTER_HOURS
      });
    }
  }

  return buildBackupHealthSummary({
    checkedAt,
    configured: isBackupConfigured(),
    configDetail: describeBackupConfiguration(),
    storageState: storageProbe.state,
    storageDetail: storageProbe.detail,
    scheduler: await probeBackupSchedulerStatus({
      configured: isBackupConfigured()
    }),
    operations: await listOperationRecords(),
    snapshots,
    staleAfterHours: env.BACKUP_STALE_AFTER_HOURS
  });
};

const buildScriptArgs = (script: string, args: string[]): string[] => [
  "--loader",
  "ts-node/esm",
  resolve(backupScriptsRoot, script),
  ...args
];

const spawnDetachedNode = (script: string, args: string[], extraEnv?: Record<string, string>) => {
  const child = spawn(process.execPath, buildScriptArgs(script, args), {
    cwd: workspaceRoot,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      ...extraEnv
    },
    windowsHide: true
  });
  child.unref();
};

const spawnManagedOperation = async (input: SpawnedOperationInput): Promise<void> => {
  const baseEnv = {
    BACKUP_OPERATION_ID: input.operationId
  };
  const canUseSystemdRun =
    process.platform === "linux" &&
    !input.forceDetachedChild &&
    commandExists("systemd-run");

  if (canUseSystemdRun && input.script === "backup-restore.ts") {
    const unitName = input.detachedName ?? `qpilot-restore-${input.operationId}`;
    const args = [
      `--unit=${unitName}`,
      "--collect",
      `--property=WorkingDirectory=${workspaceRoot}`,
      `--setenv=BACKUP_OPERATION_ID=${input.operationId}`,
      process.execPath,
      ...buildScriptArgs(input.script, input.args)
    ];
    const child = spawn("systemd-run", args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
    return;
  }

  spawnDetachedNode(input.script, input.args, {
    ...baseEnv,
    ...(input.script === "backup-restore.ts" ? { BACKUP_SKIP_SERVICE_CONTROL: "true" } : {})
  });
};

export const listBackupSnapshots = async (): Promise<BackupSnapshot[]> => {
  if (!configuredS3Endpoint()) {
    return [];
  }
  const client = getBackupS3Client();
  const snapshots: BackupSnapshot[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: env.BACKUP_S3_BUCKET!,
        Prefix: env.BACKUP_S3_PREFIX.replace(/^\/+|\/+$/g, ""),
        ContinuationToken: continuationToken
      })
    );

    const manifestKeys = (response.Contents ?? [])
      .map((entry) => entry.Key)
      .filter((key): key is string => Boolean(key && key.endsWith("/manifest.json")));

    const manifests = await Promise.all(
      manifestKeys.map(async (manifestKey) => {
        const manifestResponse = await client.send(
          new GetObjectCommand({
            Bucket: env.BACKUP_S3_BUCKET!,
            Key: manifestKey
          })
        );
        const body = await readBodyToBuffer(manifestResponse.Body);
        const parsed = BackupManifestSchema.parse(JSON.parse(body.toString("utf8")));
        return BackupSnapshotSchema.parse({
          snapshotId: parsed.snapshotId,
          kind: parsed.kind,
          createdAt: parsed.createdAt,
          sharedRoot: parsed.sharedRoot,
          appVersion: parsed.appVersion,
          gitCommit: parsed.gitCommit,
          schemaVersion: parsed.schemaVersion,
          archiveBytes: parsed.archiveBytes,
          sha256: parsed.sha256,
          host: parsed.host,
          objectKey: parsed.objectKey,
          manifestKey: parsed.manifestKey
        });
      })
    );

    snapshots.push(...manifests);
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return snapshots.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
};

const pruneScheduledSnapshots = async (): Promise<{ deletedSnapshotIds: string[] }> => {
  if (!configuredS3Endpoint()) {
    return { deletedSnapshotIds: [] };
  }
  const cutoff = Date.now() - env.BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const snapshots = await listBackupSnapshots();
  const expired = snapshots.filter(
    (snapshot) =>
      snapshot.kind === "scheduled" && Date.parse(snapshot.createdAt) < cutoff
  );
  if (expired.length === 0) {
    return { deletedSnapshotIds: [] };
  }
  const client = getBackupS3Client();
  for (const snapshot of expired) {
    await client.send(
      new DeleteObjectCommand({
        Bucket: env.BACKUP_S3_BUCKET!,
        Key: snapshot.objectKey
      })
    );
    await client.send(
      new DeleteObjectCommand({
        Bucket: env.BACKUP_S3_BUCKET!,
        Key: snapshot.manifestKey
      })
    );
  }
  return {
    deletedSnapshotIds: expired.map((snapshot) => snapshot.snapshotId)
  };
};

const verifyBackupConfigReachable = async (): Promise<void> => {
  if (!configuredS3Endpoint()) {
    throw new Error("Backup S3 storage is not configured.");
  }
  const client = getBackupS3Client();
  await client.send(
    new HeadBucketCommand({
      Bucket: env.BACKUP_S3_BUCKET!
    })
  );
};

export const performBackupSnapshot = async (
  input: PerformBackupInput
): Promise<BackupSnapshot> => {
  if (!isBackupConfigured()) {
    throw new Error("Backup storage or encryption is not fully configured.");
  }
  await ensureBackupOpsLayout();
  const sharedRoot = resolve(env.BACKUP_SHARED_ROOT);
  if (!existsSync(sharedRoot)) {
    throw new Error(`Shared root does not exist: ${sharedRoot}`);
  }

  if (input.operationId) {
    await updateOperationRecord(input.operationId, {
      status: "running",
      startedAt: new Date().toISOString(),
      message: `Creating ${input.kind.replace(/_/g, " ")} snapshot...`
    });
  }

  const tempRoot = await mkdtemp(resolve(getBackupOpsPaths().tempDir, "snapshot-"));
  try {
    const snapshotId = createSnapshotId(input.kind);
    const createdAt = new Date().toISOString();
    const archivePath = resolve(tempRoot, `${snapshotId}.tar.gz`);
    const encryptedArchivePath = resolve(tempRoot, `${snapshotId}.tar.gz.enc`);
    const manifestPath = resolve(tempRoot, `${snapshotId}.manifest.json`);

    await verifyBackupConfigReachable();
    await createArchive(sharedRoot, archivePath);
    const archiveStat = await stat(archivePath);
    const sha256 = await sha256File(archivePath);
    const encryption = await encryptArchive({
      sourcePath: archivePath,
      targetPath: encryptedArchivePath
    });
    const appVersion = await readWorkspaceVersion();
    const gitCommit = resolveGitCommit();
    const objectKey = getBackupKey(createdAt, snapshotId, "archive.tar.gz.enc");
    const manifestKey = getBackupKey(createdAt, snapshotId, "manifest.json");
    const manifest: BackupManifest = BackupManifestSchema.parse({
      snapshotId,
      kind: input.kind,
      createdAt,
      sharedRoot,
      appVersion,
      gitCommit,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      archiveBytes: archiveStat.size,
      sha256,
      host: process.env.HOSTNAME ?? process.env.COMPUTERNAME ?? "unknown-host",
      objectKey,
      manifestKey,
      encryption: {
        algorithm: "aes-256-gcm",
        ...encryption
      }
    });

    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    const client = getBackupS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: env.BACKUP_S3_BUCKET!,
        Key: objectKey,
        Body: await readFile(encryptedArchivePath),
        ContentType: "application/octet-stream"
      })
    );
    await client.send(
      new PutObjectCommand({
        Bucket: env.BACKUP_S3_BUCKET!,
        Key: manifestKey,
        Body: JSON.stringify(manifest, null, 2),
        ContentType: "application/json"
      })
    );

    if (input.pruneAfter) {
      await pruneScheduledSnapshots();
    }

    const snapshot = BackupSnapshotSchema.parse({
      snapshotId: manifest.snapshotId,
      kind: manifest.kind,
      createdAt: manifest.createdAt,
      sharedRoot: manifest.sharedRoot,
      appVersion: manifest.appVersion,
      gitCommit: manifest.gitCommit,
      schemaVersion: manifest.schemaVersion,
      archiveBytes: manifest.archiveBytes,
      sha256: manifest.sha256,
      host: manifest.host,
      objectKey: manifest.objectKey,
      manifestKey: manifest.manifestKey
    });

    if (input.operationId) {
      await updateOperationRecord(input.operationId, {
        status: "succeeded",
        snapshotId: snapshot.snapshotId,
        snapshotKind: input.kind,
        message: `Backup snapshot ${snapshot.snapshotId} uploaded successfully.`,
        finishedAt: new Date().toISOString(),
        detail: {
          snapshotId: snapshot.snapshotId,
          objectKey: snapshot.objectKey,
          manifestKey: snapshot.manifestKey
        }
      });
    }

    return snapshot;
  } catch (error) {
    if (input.operationId) {
      await updateOperationRecord(input.operationId, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date().toISOString(),
        message: "Backup snapshot failed."
      }).catch(() => undefined);
    }
    throw error;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

export const buildRestorePreflight = async (
  input: RestorePreflightInput
): Promise<BackupPreflightResult> => {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const checks: BackupPreflightResult["checks"] = [];
  let availableBytes: number | undefined;

  if (!isBackupConfigured()) {
    throw new Error("Backup storage or encryption is not fully configured.");
  }

  const snapshot = await getSnapshotManifest(input.snapshotId);

  const pushCheck = (
    key: string,
    label: string,
    status: "passed" | "warning" | "failed",
    detail: string
  ) => {
    checks.push({ key, label, status, detail });
    if (status === "failed") {
      blockers.push(detail);
    }
    if (status === "warning") {
      warnings.push(detail);
    }
  };

  try {
    await verifyBackupConfigReachable();
    pushCheck("s3", "S3 connectivity", "passed", "Backup bucket is reachable.");
  } catch (error) {
    pushCheck(
      "s3",
      "S3 connectivity",
      "failed",
      error instanceof Error ? error.message : String(error)
    );
  }

  pushCheck(
    "encryption",
    "Encryption key",
    env.BACKUP_ENCRYPTION_KEY ? "passed" : "failed",
    env.BACKUP_ENCRYPTION_KEY
      ? "Decrypt key is configured."
      : "BACKUP_ENCRYPTION_KEY is missing."
  );

  pushCheck(
    "functional_runs",
    "Functional runtime activity",
    input.functionalRunActive ? "failed" : "passed",
    input.functionalRunActive
      ? "A functional run is still active."
      : "No functional run is active."
  );

  const queuedLoadWork =
    input.queueHealth.counts.active +
    input.queueHealth.counts.waiting +
    input.queueHealth.counts.delayed;
  pushCheck(
    "load_queue",
    "Load queue activity",
    queuedLoadWork > 0 ? "failed" : "passed",
    queuedLoadWork > 0
      ? `Load queue still has ${queuedLoadWork} active or queued items.`
      : "No load queue work is active."
  );

  const estimatedRequiredBytes = snapshot.archiveBytes * 3;
  try {
    const fsStats = await statfs(resolve(env.BACKUP_OPS_ROOT));
    availableBytes = fsStats.bavail * fsStats.bsize;
    pushCheck(
      "disk",
      "Disk headroom",
      availableBytes >= estimatedRequiredBytes ? "passed" : "failed",
      availableBytes >= estimatedRequiredBytes
        ? `Disk has ${availableBytes} free bytes for restore staging.`
        : `Disk free space ${availableBytes} is below required ${estimatedRequiredBytes}.`
    );
  } catch (error) {
    pushCheck(
      "disk",
      "Disk headroom",
      "warning",
      error instanceof Error ? error.message : String(error)
    );
  }

  pushCheck(
    "schema",
    "Snapshot schema",
    snapshot.schemaVersion <= BACKUP_SCHEMA_VERSION ? "passed" : "failed",
    snapshot.schemaVersion <= BACKUP_SCHEMA_VERSION
      ? `Snapshot schema ${snapshot.schemaVersion} is supported.`
      : `Snapshot schema ${snapshot.schemaVersion} is newer than runtime schema ${BACKUP_SCHEMA_VERSION}.`
  );

  return BackupPreflightResultSchema.parse({
    snapshotId: snapshot.snapshotId,
    ok: blockers.length === 0,
    generatedAt: new Date().toISOString(),
    estimatedRequiredBytes,
    availableBytes,
    snapshot: BackupSnapshotSchema.parse({
      snapshotId: snapshot.snapshotId,
      kind: snapshot.kind,
      createdAt: snapshot.createdAt,
      sharedRoot: snapshot.sharedRoot,
      appVersion: snapshot.appVersion,
      gitCommit: snapshot.gitCommit,
      schemaVersion: snapshot.schemaVersion,
      archiveBytes: snapshot.archiveBytes,
      sha256: snapshot.sha256,
      host: snapshot.host,
      objectKey: snapshot.objectKey,
      manifestKey: snapshot.manifestKey
    }),
    checks,
    blockers,
    warnings
  });
};

const downloadSnapshotArchive = async (
  manifest: BackupManifest,
  targetPath: string
): Promise<void> => {
  const client = getBackupS3Client();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: env.BACKUP_S3_BUCKET!,
      Key: manifest.objectKey
    })
  );
  const body = await readBodyToBuffer(response.Body);
  await writeFile(targetPath, body);
};

const swapSharedRoot = async (restoredRoot: string, operationId: string): Promise<void> => {
  const sharedRoot = resolve(env.BACKUP_SHARED_ROOT);
  const parentDir = dirname(sharedRoot);
  const previousRoot = resolve(parentDir, `${basename(sharedRoot)}.restore-prev-${operationId}`);
  await rm(previousRoot, { recursive: true, force: true });
  await rename(sharedRoot, previousRoot);
  try {
    await rename(restoredRoot, sharedRoot);
    await rm(previousRoot, { recursive: true, force: true });
  } catch (error) {
    await rm(sharedRoot, { recursive: true, force: true }).catch(() => undefined);
    await rename(previousRoot, sharedRoot).catch(() => undefined);
    throw error;
  }
};

const applySnapshotToSharedRoot = async (
  input: RestoreApplySnapshotInput
): Promise<void> => {
  const tempRoot = await mkdtemp(resolve(getBackupOpsPaths().tempDir, "restore-"));
  const encryptedArchivePath = resolve(tempRoot, `${input.manifest.snapshotId}.tar.gz.enc`);
  const decryptedArchivePath = resolve(tempRoot, `${input.manifest.snapshotId}.tar.gz`);
  const stagingRoot = resolve(tempRoot, "restored-shared");
  const phaseMessages =
    input.phaseMode === "primary"
      ? {
          download: "Downloading snapshot archive...",
          decrypt: "Decrypting snapshot archive...",
          extract: "Extracting restored shared directory...",
          swap: "Swapping restored shared directory into place...",
          restart: "Restarting runtime service..."
        }
      : {
          download: "Downloading rescue snapshot for auto rollback...",
          decrypt: "Decrypting rescue snapshot archive...",
          extract: "Extracting rescue snapshot content...",
          swap: "Restoring the rescue snapshot into place...",
          restart: "Restarting runtime after auto rollback..."
        };

  try {
    await updateRestoreProgress({
      operationId: input.operationId,
      snapshotId: input.manifest.snapshotId,
      phase: input.phaseMode === "primary" ? "download" : "rollback",
      message: phaseMessages.download,
      maintenanceActive: true
    });
    if (
      !input.skipServiceControl &&
      process.platform === "linux" &&
      commandExists("systemctl")
    ) {
      await runSystemCommand("systemctl", ["stop", BACKUP_RUNTIME_SYSTEMD_UNIT]);
    }

    await downloadSnapshotArchive(input.manifest, encryptedArchivePath);

    await updateRestoreProgress({
      operationId: input.operationId,
      snapshotId: input.manifest.snapshotId,
      phase: input.phaseMode === "primary" ? "decrypt" : "rollback",
      message: phaseMessages.decrypt,
      maintenanceActive: true
    });
    await decryptArchive({
      sourcePath: encryptedArchivePath,
      targetPath: decryptedArchivePath,
      ivHex: input.manifest.encryption.ivHex,
      authTagHex: input.manifest.encryption.authTagHex
    });
    const sha256 = await sha256File(decryptedArchivePath);
    if (sha256 !== input.manifest.sha256) {
      throw new Error(
        `Snapshot checksum mismatch: expected ${input.manifest.sha256}, received ${sha256}.`
      );
    }

    await updateRestoreProgress({
      operationId: input.operationId,
      snapshotId: input.manifest.snapshotId,
      phase: input.phaseMode === "primary" ? "extract" : "rollback",
      message: phaseMessages.extract,
      maintenanceActive: true
    });
    await mkdir(stagingRoot, { recursive: true });
    await tar.x({
      file: decryptedArchivePath,
      cwd: stagingRoot,
      strip: 0
    });

    await updateRestoreProgress({
      operationId: input.operationId,
      snapshotId: input.manifest.snapshotId,
      phase: input.phaseMode === "primary" ? "swap" : "rollback",
      message: phaseMessages.swap,
      maintenanceActive: true
    });
    await swapSharedRoot(stagingRoot, input.operationId);

    await updateRestoreProgress({
      operationId: input.operationId,
      snapshotId: input.manifest.snapshotId,
      phase: input.phaseMode === "primary" ? "restart" : "rollback",
      message: phaseMessages.restart,
      maintenanceActive: true
    });
    if (
      !input.skipServiceControl &&
      process.platform === "linux" &&
      commandExists("systemctl")
    ) {
      await runSystemCommand("systemctl", ["start", BACKUP_RUNTIME_SYSTEMD_UNIT]);
    }
  } catch (error) {
    if (
      !input.skipServiceControl &&
      process.platform === "linux" &&
      commandExists("systemctl")
    ) {
      await runSystemCommand("systemctl", ["start", BACKUP_RUNTIME_SYSTEMD_UNIT]).catch(
        () => undefined
      );
    }
    throw error;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

export const performRestoreSnapshot = async (
  input: PerformRestoreInput
): Promise<void> => {
  if (!isBackupConfigured()) {
    throw new Error("Backup storage or encryption is not fully configured.");
  }
  const operationId =
    input.operationId ??
    (
      await createOperationRecord({
        type: "restore",
        snapshotId: input.snapshotId,
        triggeredBy: "cli",
        message: "Restore queued."
      })
    ).id;
  const manifest = await getSnapshotManifest(input.snapshotId);
  await writeLockFile(operationId, manifest.snapshotId);
  await updateRestoreProgress({
    operationId,
    snapshotId: manifest.snapshotId,
    status: "running",
    startedAt: new Date().toISOString(),
    phase: "pre_restore_snapshot",
    message: "Creating pre-restore rescue snapshot...",
    maintenanceActive: true
  });

  let rescueSnapshot: BackupSnapshot | null = null;
  let verification: RestoreVerificationResult | undefined;
  let rollbackVerification: RestoreVerificationResult | undefined;
  let primaryFailure: Error | null = null;
  let primaryFailureReason = "restore_apply_failed";
  try {
    rescueSnapshot = await performBackupSnapshot({
      kind: "pre_restore",
      triggeredBy: "restore-cli"
    });
    await updateRestoreProgress({
      operationId,
      snapshotId: manifest.snapshotId,
      message: "Applying the requested restore snapshot...",
      detail: {
        rescueSnapshotId: rescueSnapshot.snapshotId,
        rollbackSnapshotId: rescueSnapshot.snapshotId,
        restoredSnapshotId: manifest.snapshotId
      },
      maintenanceActive: true
    });

    await applySnapshotToSharedRoot({
      manifest,
      operationId,
      skipServiceControl: input.skipServiceControl,
      phaseMode: "primary"
    });

    await updateRestoreProgress({
      operationId,
      snapshotId: manifest.snapshotId,
      phase: "verify",
      message: "Running platform smoke verification after restore...",
      detail: {
        rescueSnapshotId: rescueSnapshot.snapshotId,
        rollbackSnapshotId: rescueSnapshot.snapshotId,
        restoredSnapshotId: manifest.snapshotId
      },
      maintenanceActive: false
    });
    verification = await verifyRestoredPlatform();
    if (verification.ok) {
      await updateRestoreProgress({
        operationId,
        snapshotId: manifest.snapshotId,
        status: "succeeded",
        finishedAt: new Date().toISOString(),
        phase: "completed",
        message: `Restore completed from snapshot ${manifest.snapshotId}.`,
        detail: {
          rescueSnapshotId: rescueSnapshot.snapshotId,
          rollbackSnapshotId: rescueSnapshot.snapshotId,
          restoredSnapshotId: manifest.snapshotId,
          verification
        },
        maintenanceActive: false
      });
      await clearLockFile();
      return;
    }

    primaryFailureReason = "restore_verification_failed";
    primaryFailure = new Error(summarizeVerificationFailure(verification));
  } catch (error) {
    primaryFailure = error instanceof Error ? error : new Error(String(error));
    if (!rescueSnapshot) {
      await updateRestoreProgress({
        operationId,
        snapshotId: manifest.snapshotId,
        status: "failed",
        finishedAt: new Date().toISOString(),
        phase: "completed",
        message: "Restore failed before the rescue snapshot could be created.",
        error: primaryFailure.message,
        detail: {
          failureReason: "pre_restore_snapshot_failed",
          verification
        },
        maintenanceActive: false
      }).catch(() => undefined);
      await clearLockFile().catch(() => undefined);
      throw primaryFailure;
    }
  }

  if (!rescueSnapshot || !primaryFailure) {
    await clearLockFile();
    return;
  }

  try {
    await updateRestoreProgress({
      operationId,
      snapshotId: rescueSnapshot.snapshotId,
      phase: "rollback",
      message:
        primaryFailureReason === "restore_verification_failed"
          ? "Restore verification failed. Rolling back to the rescue snapshot..."
          : "Restore application failed. Rolling back to the rescue snapshot...",
      error: primaryFailure.message,
      detail: {
        rescueSnapshotId: rescueSnapshot.snapshotId,
        rollbackSnapshotId: rescueSnapshot.snapshotId,
        restoredSnapshotId: manifest.snapshotId,
        verification,
        failureReason: primaryFailureReason
      },
      maintenanceActive: true
    });

    const rescueManifest = await getSnapshotManifest(rescueSnapshot.snapshotId);
    await applySnapshotToSharedRoot({
      manifest: rescueManifest,
      operationId,
      skipServiceControl: input.skipServiceControl,
      phaseMode: "rollback"
    });

    await updateRestoreProgress({
      operationId,
      snapshotId: rescueSnapshot.snapshotId,
      phase: "rollback",
      message: "Running platform smoke verification after auto rollback...",
      detail: {
        rescueSnapshotId: rescueSnapshot.snapshotId,
        rollbackSnapshotId: rescueSnapshot.snapshotId,
        restoredSnapshotId: manifest.snapshotId,
        verification,
        failureReason: primaryFailureReason
      },
      maintenanceActive: false
    });
    rollbackVerification = await verifyRestoredPlatform();
    if (rollbackVerification.ok) {
      await updateRestoreProgress({
        operationId,
        snapshotId: manifest.snapshotId,
        status: "failed",
        finishedAt: new Date().toISOString(),
        phase: "completed",
        message: `Restore failed and was rolled back to rescue snapshot ${rescueSnapshot.snapshotId}.`,
        error: primaryFailure.message,
        detail: {
          rescueSnapshotId: rescueSnapshot.snapshotId,
          rollbackSnapshotId: rescueSnapshot.snapshotId,
          restoredSnapshotId: manifest.snapshotId,
          verification,
          rollbackVerification,
          rollbackSucceeded: true,
          failureReason: primaryFailureReason
        },
        maintenanceActive: false
      });
      return;
    }

    const rollbackFailure = new Error(summarizeVerificationFailure(rollbackVerification));
    await updateRestoreProgress({
      operationId,
      snapshotId: rescueSnapshot.snapshotId,
      status: "failed",
      finishedAt: new Date().toISOString(),
      phase: "rollback",
      message: "Auto rollback verification failed. The instance remains in maintenance mode.",
      error: `${primaryFailure.message}\nRollback verification: ${rollbackFailure.message}`,
      detail: {
        rescueSnapshotId: rescueSnapshot.snapshotId,
        rollbackSnapshotId: rescueSnapshot.snapshotId,
        restoredSnapshotId: manifest.snapshotId,
        verification,
        rollbackVerification,
        rollbackSucceeded: false,
        failureReason: "restore_auto_rollback_failed"
      },
      maintenanceActive: true
    });
    throw rollbackFailure;
  } catch (rollbackError) {
    const message = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
    await updateRestoreProgress({
      operationId,
      snapshotId: rescueSnapshot.snapshotId,
      status: "failed",
      finishedAt: new Date().toISOString(),
      phase: "rollback",
      message: "Auto rollback failed. The instance remains in maintenance mode for manual recovery.",
      error: `${primaryFailure.message}\nAuto rollback: ${message}`,
      detail: {
        rescueSnapshotId: rescueSnapshot.snapshotId,
        rollbackSnapshotId: rescueSnapshot.snapshotId,
        restoredSnapshotId: manifest.snapshotId,
        verification,
        rollbackVerification,
        rollbackSucceeded: false,
        failureReason: "restore_auto_rollback_failed"
      },
      maintenanceActive: true
    }).catch(() => undefined);
    throw rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
  } finally {
    await clearLockFile();
  }
};

export const getBackupConfigStatus = async (): Promise<BackupConfigStatus> => {
  const activeOperation = await findActiveOperation();
  const health = await getBackupHealthSummary();
  return BackupConfigStatusSchema.parse({
    configured: isBackupConfigured(),
    endpoint: env.BACKUP_S3_ENDPOINT,
    bucket: env.BACKUP_S3_BUCKET,
    prefix: env.BACKUP_S3_PREFIX,
    sharedRoot: resolve(env.BACKUP_SHARED_ROOT),
    opsRoot: resolve(env.BACKUP_OPS_ROOT),
    encryptionConfigured: Boolean(env.BACKUP_ENCRYPTION_KEY),
    retentionDays: env.BACKUP_RETENTION_DAYS,
    schedule: BACKUP_SCHEDULE_LABEL,
    lastSuccessfulBackupAt: await getLastSuccessfulBackupAt(),
    health,
    activeOperation,
    restoreHistory: await listRestoreHistory()
  });
};

export const getBackupOperation = async (
  operationId: string
): Promise<BackupOperation | null> =>
  (await readOperationRecord(operationId)) ?? null;

export const getMaintenanceState = async (): Promise<MaintenanceStatus | null> =>
  readMaintenanceMarker();

export class BackupRuntime {
  constructor(
    private readonly input: {
      orchestrator: { isBusy: () => boolean };
      platformLoadQueue: {
        getSummary: () => Promise<PlatformLoadQueueSummary>;
      };
      logger?: BackupRuntimeLogger;
    }
  ) {}

  async getConfigStatus(): Promise<BackupConfigStatus> {
    return getBackupConfigStatus();
  }

  async listSnapshots(): Promise<BackupSnapshot[]> {
    return listBackupSnapshots();
  }

  async getHealthSummary(): Promise<BackupHealthSummary> {
    return getBackupHealthSummary();
  }

  async getOperation(operationId: string): Promise<BackupOperation | null> {
    return getBackupOperation(operationId);
  }

  async getMaintenanceState(): Promise<MaintenanceStatus | null> {
    return readMaintenanceMarker();
  }

  async createManualBackup(triggeredBy?: string): Promise<BackupOperation> {
    const activeOperation = await findActiveOperation();
    if (activeOperation) {
      throw new Error(`Operation ${activeOperation.id} is already in progress.`);
    }
    const operation = await createOperationRecord({
      type: "backup",
      snapshotKind: "manual",
      triggeredBy,
      message: "Backup queued."
    });
    queueMicrotask(() => {
      void performBackupSnapshot({
        kind: "manual",
        operationId: operation.id,
        triggeredBy
      }).catch((error) => {
        this.input.logger?.error?.(
          {
            operationId: operation.id,
            error: error instanceof Error ? error.message : String(error)
          },
          "Manual backup operation failed."
        );
      });
    });
    return operation;
  }

  async buildRestorePreflight(snapshotId: string): Promise<BackupPreflightResult> {
    const queueHealth = await this.input.platformLoadQueue.getSummary();
    return buildRestorePreflight({
      snapshotId,
      functionalRunActive: this.input.orchestrator.isBusy(),
      queueHealth
    });
  }

  async startRestore(input: {
    snapshotId: string;
    triggeredBy?: string;
  }): Promise<BackupOperation> {
    const activeOperation = await findActiveOperation();
    if (activeOperation) {
      throw new Error(`Operation ${activeOperation.id} is already in progress.`);
    }
    const preflight = await this.buildRestorePreflight(input.snapshotId);
    if (!preflight.ok) {
      throw new Error(`Restore preflight failed: ${preflight.blockers.join(" ")}`);
    }
    const operation = await createOperationRecord({
      type: "restore",
      snapshotId: input.snapshotId,
      triggeredBy: input.triggeredBy,
      message: "Restore queued.",
      detail: {
        preflightGeneratedAt: preflight.generatedAt
      }
    });
    await spawnManagedOperation({
      operationId: operation.id,
      script: "backup-restore.ts",
      args: ["--snapshot-id", input.snapshotId],
      detachedName: `qpilot-restore-${operation.id}`
    });
    return operation;
  }
}

export const runBackupCreateCli = async (argv: string[]): Promise<void> => {
  const kindIndex = argv.indexOf("--kind");
  const operationIdIndex = argv.indexOf("--operation-id");
  const prune = argv.includes("--prune");
  const kind = (kindIndex >= 0 ? argv[kindIndex + 1] : "manual") as BackupSnapshotKind;
  let operationId =
    operationIdIndex >= 0 ? argv[operationIdIndex + 1] : process.env.BACKUP_OPERATION_ID;
  if (!operationId) {
    operationId = (
      await createOperationRecord({
        type: "backup",
        snapshotKind: kind,
        triggeredBy: kind === "scheduled" ? "systemd-timer" : "cli",
        message: "Backup queued."
      })
    ).id;
  }
  await performBackupSnapshot({
    kind,
    operationId,
    pruneAfter: prune
  });
};

export const runBackupRestoreCli = async (argv: string[]): Promise<void> => {
  const snapshotIndex = argv.indexOf("--snapshot-id");
  const operationIdIndex = argv.indexOf("--operation-id");
  const snapshotId = snapshotIndex >= 0 ? argv[snapshotIndex + 1] : undefined;
  if (!snapshotId) {
    throw new Error("backup:restore requires --snapshot-id.");
  }
  let operationId =
    operationIdIndex >= 0 ? argv[operationIdIndex + 1] : process.env.BACKUP_OPERATION_ID;
  if (!operationId) {
    operationId = (
      await createOperationRecord({
        type: "restore",
        snapshotId,
        triggeredBy: "cli",
        message: "Restore queued."
      })
    ).id;
  }
  await performRestoreSnapshot({
    snapshotId,
    operationId,
    skipServiceControl: process.env.BACKUP_SKIP_SERVICE_CONTROL === "true"
  });
};

export const runBackupPruneCli = async (): Promise<void> => {
  await pruneScheduledSnapshots();
};

export const backupInternals = {
  BACKUP_SCHEMA_VERSION,
  BACKUP_SCHEDULE_LABEL,
  createSnapshotId,
  createSnapshotStamp,
  getBackupKey,
  sha256File,
  encryptArchive,
  decryptArchive,
  buildOperationFile,
  listOperationRecords,
  dirSize,
  buildBackupHealthSummary,
  probeBackupSchedulerStatus,
  probeBackupStorage,
  pruneScheduledSnapshots,
  getSnapshotManifest,
  setRestoreVerificationRunner: (runner?: RestoreVerificationRunner) => {
    restoreVerificationRunner =
      runner ??
      (async (input) => {
        return await runPlatformSmokeVerification(input);
      });
  }
};
