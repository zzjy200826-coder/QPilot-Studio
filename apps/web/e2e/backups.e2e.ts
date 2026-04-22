import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../runtime/node_modules/playwright/index.mjs";
import { registerFixtureUser } from "./auth-helpers.ts";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const workspaceRoot = resolve(currentDir, "..", "..", "..");
const outputRoot = resolve(workspaceRoot, "output", "e2e", "backups");
const sharedRoot = resolve(outputRoot, "shared");
const dataRoot = resolve(sharedRoot, "data");
const opsRoot = resolve(outputRoot, "ops");
const backupOpsRoot = resolve(opsRoot, "backups");
const operationsRoot = resolve(backupOpsRoot, "operations");
const s3Root = resolve(outputRoot, "s3");
const databasePath = resolve(dataRoot, "runtime.db");
const artifactsRoot = resolve(dataRoot, "artifacts");
const reportsRoot = resolve(dataRoot, "reports");
const sessionsRoot = resolve(dataRoot, "sessions");
const plannerCacheRoot = resolve(dataRoot, "planner-cache");
const runtimeLogPath = resolve(outputRoot, "runtime.log");
const webLogPath = resolve(outputRoot, "web.log");
const screenshotRoot = resolve(outputRoot, "screenshots");
const observationsPath = resolve(outputRoot, "observations.json");
const runtimeBaseUrl = "http://127.0.0.1:8880";
const webBaseUrl = "http://127.0.0.1:4180";
const masterKey =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const backupKey =
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const fixtureEmail = "backups.owner@example.test";
const fixturePassword = "Password123!";
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const bucketName = "qpilot-backups";

interface ManagedProcess {
  close: () => Promise<void>;
}

const buildRuntimeCookieHeader = async (
  context: import("playwright").BrowserContext
): Promise<string> => {
  const cookies = await context.cookies(runtimeBaseUrl);
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
};

const runtimeRequest = async (
  context: import("playwright").BrowserContext,
  path: string,
  init?: RequestInit
): Promise<Response> => {
  const headers = new Headers(init?.headers);
  const cookieHeader = await buildRuntimeCookieHeader(context);
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }
  return fetch(`${runtimeBaseUrl}${path}`, {
    ...init,
    headers
  });
};

const waitForSnapshot = async (
  context: import("playwright").BrowserContext,
  timeoutMs = 45_000
): Promise<{ snapshotId: string; kind: string }> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const response = await runtimeRequest(context, "/api/platform/ops/backups/snapshots");
    if (!response.ok) {
      throw new Error(
        `Failed to load backup snapshots: ${response.status} ${await response.text()}`
      );
    }

    const snapshots = (await response.json()) as Array<{ snapshotId: string; kind: string }>;
    const manualSnapshot = snapshots.find((snapshot) => snapshot.kind === "manual");
    if (manualSnapshot) {
      return manualSnapshot;
    }

    await sleep(1_000);
  }

  throw new Error("Timed out waiting for the manual backup snapshot to appear in runtime storage.");
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });

const waitForUrl = async (
  url: string,
  timeoutMs = 45_000,
  predicate?: (response: Response) => boolean
): Promise<void> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (!predicate || predicate(response)) {
        return;
      }
    } catch {
      // keep polling
    }
    await sleep(500);
  }

  throw new Error(`Timed out waiting for ${url}`);
};

const expectOneOfTexts = async (
  scope: import("playwright").Page | import("playwright").Locator,
  texts: string[],
  timeoutMs = 15_000
): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (const text of texts) {
      const visible = await scope
        .getByText(text, { exact: false })
        .first()
        .isVisible()
        .catch(() => false);
      if (visible) {
        return;
      }
    }
    await sleep(250);
  }

  throw new Error(`Timed out waiting for one of: ${texts.join(", ")}`);
};

const assertNoMojibake = async (page: import("playwright").Page): Promise<void> => {
  const pageText = await page.locator("body").innerText();
  const suspiciousFragments = [
    "\uFFFD",
    "\u95f8",
    "\u95f9",
    "\u95fa",
    "\u9420",
    "\u95c2",
    "\u95bb",
    "\u93c9",
    "\u9352",
    "\u9359",
    "\u9369",
    "\u93ba",
    "\u93bb",
    "\u6d93"
  ];
  const hit = suspiciousFragments.find((fragment) => pageText.includes(fragment));
  if (hit) {
    throw new Error(`Detected mojibake fragment on page: ${hit}`);
  }
};

const normalizeEnv = (
  env: NodeJS.ProcessEnv & Record<string, string | undefined>
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );

const spawnProcess = (input: {
  cwd: string;
  args: string[];
  logPath: string;
  env?: Record<string, string>;
}): ManagedProcess => {
  const command = process.platform === "win32" ? "cmd.exe" : pnpmCommand;
  const commandArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", pnpmCommand, ...input.args]
      : input.args;

  const child = spawn(command, commandArgs, {
    cwd: input.cwd,
    env: normalizeEnv({
      ...process.env,
      ...input.env
    }),
    stdio: "pipe",
    windowsHide: true
  });

  child.stdout?.on("data", async (chunk) => {
    await writeFile(input.logPath, chunk, { flag: "a" });
  });
  child.stderr?.on("data", async (chunk) => {
    await writeFile(input.logPath, chunk, { flag: "a" });
  });

  return {
    close: async () => {
      if (child.exitCode !== null) {
        return;
      }
      if (process.platform === "win32") {
        await new Promise<void>((resolveClose) => {
          const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
            stdio: "ignore"
          });
          killer.on("exit", () => resolveClose());
        });
        return;
      }
      child.kill("SIGTERM");
      await new Promise<void>((resolveClose) => {
        child.on("exit", () => resolveClose());
      });
    }
  };
};

const seedFilesystem = () => {
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(artifactsRoot, { recursive: true });
  mkdirSync(reportsRoot, { recursive: true });
  mkdirSync(sessionsRoot, { recursive: true });
  mkdirSync(plannerCacheRoot, { recursive: true });
  mkdirSync(operationsRoot, { recursive: true });
  mkdirSync(s3Root, { recursive: true });
  mkdirSync(screenshotRoot, { recursive: true });
  writeFileSync(resolve(sharedRoot, "README.restore.txt"), "shared backup fixture", "utf8");
  writeFileSync(resolve(artifactsRoot, "fixture-artifact.txt"), "artifact", "utf8");
};

const writeRestoreOperation = (input: {
  id: string;
  status: "running" | "failed";
  snapshotId: string;
  rollbackSucceeded?: boolean;
}) => {
  mkdirSync(operationsRoot, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(
    resolve(operationsRoot, `${input.id}.json`),
    JSON.stringify(
      {
        id: input.id,
        type: "restore",
        status: input.status,
        snapshotId: input.snapshotId,
        snapshotKind: "manual",
        triggeredBy: "fixture-owner",
        message:
          input.status === "running"
            ? "Running platform smoke verification after auto rollback..."
            : input.rollbackSucceeded === false
              ? "Auto rollback failed. The instance remains in maintenance mode for manual recovery."
              : "Restore failed and was rolled back to rescue snapshot 20260422T025500Z-pre_restore-fixture.",
        error:
          input.status === "failed"
            ? input.rollbackSucceeded === false
              ? "Restore verification failed.\nAuto rollback: rollback verification failed."
              : "Restore verification failed."
            : undefined,
        detail: {
          phase: input.status === "running" ? "rollback" : "completed",
          phaseUpdatedAt: now,
          failureReason:
            input.status === "failed"
              ? input.rollbackSucceeded === false
                ? "restore_auto_rollback_failed"
                : "restore_verification_failed"
              : "restore_verification_failed",
          rollbackSnapshotId: "20260422T025500Z-pre_restore-fixture",
          rollbackSucceeded: input.rollbackSucceeded,
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
            ok: input.rollbackSucceeded === true,
            checkedAt: now,
            baseUrl: "https://qpilot.example.test",
            checks: [
              {
                key: "ready",
                label: "GET /health/ready",
                state: input.rollbackSucceeded === true ? "passed" : "failed",
                status: input.rollbackSucceeded === true ? 200 : 503,
                detail:
                  input.rollbackSucceeded === true
                    ? "Runtime readiness OK."
                    : "Rollback readiness probe returned HTTP 503.",
                checkedAt: now
              }
            ]
          }
        },
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        finishedAt: input.status === "failed" ? now : undefined
      },
      null,
      2
    ),
    "utf8"
  );
};

const writeMaintenanceMarker = (operationId: string, snapshotId: string) => {
  mkdirSync(backupOpsRoot, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(
    resolve(backupOpsRoot, "maintenance.json"),
    JSON.stringify(
      {
        active: true,
        operationId,
        snapshotId,
        createdAt: now,
        message: "Runtime maintenance window is active while restore is running.",
        phase: "rollback",
        phaseUpdatedAt: now
      },
      null,
      2
    ),
    "utf8"
  );
};

const clearMaintenanceMarker = () => {
  rmSync(resolve(backupOpsRoot, "maintenance.json"), { force: true });
};

const run = async (): Promise<void> => {
  seedFilesystem();
  const { default: S3rver } = await import("../../runtime/node_modules/s3rver/lib/s3rver.js");
  const s3rver = new S3rver({
    address: "127.0.0.1",
    port: 4571,
    silent: true,
    directory: s3Root,
    resetOnClose: true,
    allowMismatchedSignatures: true,
    configureBuckets: [{ name: bucketName }]
  });
  await s3rver.run();

  const runtimeProcess = spawnProcess({
    cwd: workspaceRoot,
    args: ["--filter", "@qpilot/runtime", "start"],
    logPath: runtimeLogPath,
    env: {
      HOST: "127.0.0.1",
      PORT: "8880",
      CORS_ORIGIN: webBaseUrl,
      DATABASE_URL: databasePath,
      ARTIFACTS_DIR: artifactsRoot,
      REPORTS_DIR: reportsRoot,
      SESSIONS_DIR: sessionsRoot,
      PLANNER_CACHE_DIR: plannerCacheRoot,
      CREDENTIAL_MASTER_KEY: masterKey,
      PLATFORM_REDIS_URL: "",
      PLATFORM_REDIS_WORKER_ENABLED: "false",
      BACKUP_SHARED_ROOT: sharedRoot,
      BACKUP_OPS_ROOT: opsRoot,
      BACKUP_S3_ENDPOINT: "http://127.0.0.1:4571",
      BACKUP_S3_REGION: "us-east-1",
      BACKUP_S3_BUCKET: bucketName,
      BACKUP_S3_PREFIX: "backups",
      BACKUP_S3_ACCESS_KEY_ID: "S3RVER",
      BACKUP_S3_SECRET_ACCESS_KEY: "S3RVER",
      BACKUP_S3_FORCE_PATH_STYLE: "true",
      BACKUP_ENCRYPTION_KEY: backupKey
    }
  });

  const webProcess = spawnProcess({
    cwd: workspaceRoot,
    args: [
      "--filter",
      "@qpilot/web",
      "exec",
      "vite",
      "--host",
      "127.0.0.1",
      "--port",
      "4180",
      "--strictPort"
    ],
    logPath: webLogPath,
    env: {
      VITE_RUNTIME_BASE_URL: runtimeBaseUrl
    }
  });

  const cleanup = async (): Promise<void> => {
    await Promise.allSettled([webProcess.close(), runtimeProcess.close(), s3rver.close()]);
  };

  try {
    await waitForUrl(`${runtimeBaseUrl}/health`, 45_000, (response) => response.ok);
    await waitForUrl(`${webBaseUrl}/login`, 45_000, (response) => response.ok);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      baseURL: webBaseUrl,
      locale: "en-US",
      viewport: { width: 1440, height: 1200 }
    });
    const page = await context.newPage();

    await registerFixtureUser(page, {
      email: fixtureEmail,
      password: fixturePassword,
      displayName: "Backups Owner",
      tenantName: "Backups Workspace",
      redirectPath: "/projects"
    });

    await page.goto("/platform/ops/backups", { waitUntil: "domcontentloaded" });
    await expectOneOfTexts(page, ["Instance Backups & Restore"]);
    await expectOneOfTexts(page, ["Storage, encryption, and backup health"]);
    await expectOneOfTexts(page, ["Remote encrypted snapshots"]);
    await page.screenshot({
      path: resolve(screenshotRoot, "01-backups-overview.png"),
      fullPage: true
    });

    const runBackupResponse = await runtimeRequest(context, "/api/platform/ops/backups/run", {
      method: "POST"
    });
    if (!runBackupResponse.ok) {
      throw new Error(
        `Failed to trigger manual backup: ${runBackupResponse.status} ${await runBackupResponse.text()}`
      );
    }
    await runBackupResponse.json();

    const createdSnapshot = await waitForSnapshot(context);
    await page.goto("/platform/ops/backups", { waitUntil: "domcontentloaded" });
    await expectOneOfTexts(page, [createdSnapshot.snapshotId]);
    const snapshotButton = page
      .getByRole("button")
      .filter({ hasText: createdSnapshot.snapshotId })
      .first();
    const snapshotButtonText = (await snapshotButton.innerText()).trim();
    await page.screenshot({
      path: resolve(screenshotRoot, "02-backup-succeeded.png"),
      fullPage: true
    });

    await snapshotButton.click();
    await page.getByRole("button", { name: "Preview restore" }).click();
    await expectOneOfTexts(page, ["Restore preflight passed.", "Preflight passed"]);
    await page.screenshot({
      path: resolve(screenshotRoot, "03-restore-preflight.png"),
      fullPage: true
    });

    writeRestoreOperation({
      id: "restore-running-fixture",
      status: "running",
      snapshotId: "20260422T030000Z-manual-restore"
    });
    await page.goto("/platform/ops/backups", { waitUntil: "domcontentloaded" });
    await expectOneOfTexts(page, ["Restore phase, verification, and rollback"]);
    await expectOneOfTexts(page, ["Restore verification"]);
    await expectOneOfTexts(page, ["Auto rollback verification"]);
    await page.screenshot({
      path: resolve(screenshotRoot, "04-backups-active-restore.png"),
      fullPage: true
    });

    writeMaintenanceMarker("restore-running-fixture", "20260422T030000Z-manual-restore");
    await page.goto("/maintenance", { waitUntil: "domcontentloaded" });
    await expectOneOfTexts(page, [
      "QPilot is temporarily protected while restore and verification are running"
    ]);
    await expectOneOfTexts(page, ["Auto rollback"]);
    await expectOneOfTexts(page, ["Latest restore verification"]);
    await page.screenshot({
      path: resolve(screenshotRoot, "05-maintenance-rollback.png"),
      fullPage: true
    });

    clearMaintenanceMarker();
    writeRestoreOperation({
      id: "restore-failed-fixture",
      status: "failed",
      snapshotId: "20260422T040000Z-manual-restore",
      rollbackSucceeded: false
    });
    await page.goto("/platform/ops/backups", { waitUntil: "domcontentloaded" });
    await expectOneOfTexts(page, ["Restore failed, auto rollback failed"]);
    await page.screenshot({
      path: resolve(screenshotRoot, "06-backups-history-failed.png"),
      fullPage: true
    });

    await page.evaluate(() => {
      window.localStorage.setItem("qpilot.language.v1", "zh-CN");
    });
    await page.goto("/platform/ops/backups", { waitUntil: "domcontentloaded" });
    await expectOneOfTexts(page, ["实例级备份与恢复", "Instance Backups & Restore"]);
    await expectOneOfTexts(page, ["恢复阶段、验收结果与回滚情况", "Restore phase, verification, and rollback"]);
    await expectOneOfTexts(page, ["恢复失败，且自动回滚也失败", "Restore failed, auto rollback failed"]);
    await assertNoMojibake(page);
    await page.screenshot({
      path: resolve(screenshotRoot, "07-backups-zh.png"),
      fullPage: true
    });

    const pageBody = (await page.locator("body").textContent()) ?? "";
    const snapshotMatch =
      snapshotButtonText.match(/\d{8}T\d{6}Z-manual-[a-zA-Z0-9_-]+/) ??
      pageBody.match(/\d{8}T\d{6}Z-manual-[a-zA-Z0-9_-]+/);

    await writeFile(
      observationsPath,
      JSON.stringify(
        {
          authEmail: fixtureEmail,
          sharedRoot,
          opsRoot,
          bucketName,
          snapshotId: snapshotMatch?.[0] ?? null,
          seededOperations: [
            "restore-running-fixture",
            "restore-failed-fixture"
          ],
          screenshots: {
            overview: resolve(screenshotRoot, "01-backups-overview.png"),
            backupSucceeded: resolve(screenshotRoot, "02-backup-succeeded.png"),
            restorePreflight: resolve(screenshotRoot, "03-restore-preflight.png"),
            activeRestore: resolve(screenshotRoot, "04-backups-active-restore.png"),
            maintenanceRollback: resolve(screenshotRoot, "05-maintenance-rollback.png"),
            historyFailed: resolve(screenshotRoot, "06-backups-history-failed.png"),
            zh: resolve(screenshotRoot, "07-backups-zh.png")
          }
        },
        null,
        2
      ),
      "utf8"
    );

    await browser.close();
  } finally {
    await cleanup();
  }
};

run()
  .then(() => {
    console.log(`Backups E2E fixture completed. Output: ${outputRoot}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
