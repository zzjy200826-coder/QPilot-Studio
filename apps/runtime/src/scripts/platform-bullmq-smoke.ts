import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const runtimeRoot = resolve(currentDir, "..", "..");
const workspaceRoot = resolve(runtimeRoot, "..", "..");
const outputRoot = resolve(workspaceRoot, "output", "smoke", "platform-bullmq");
const databasePath = resolve(outputRoot, "runtime.db");
const artifactsRoot = resolve(outputRoot, "artifacts");
const reportsRoot = resolve(outputRoot, "reports");
const sessionsRoot = resolve(outputRoot, "sessions");
const plannerCacheRoot = resolve(outputRoot, "planner-cache");
const runtimeControlLogPath = resolve(outputRoot, "runtime-control.log");
const runtimeWorkerLogPath = resolve(outputRoot, "runtime-worker.log");
const redisLogPath = resolve(outputRoot, "redis.log");
const observationsPath = resolve(outputRoot, "observations.json");
const redisDir = resolve(outputRoot, "redis-data");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const redisPort = 6391;
const controlPort = 8884;
const workerPort = 8885;
const redisUrl = `redis://127.0.0.1:${redisPort}`;
const runtimeBaseUrl = `http://127.0.0.1:${controlPort}`;
const masterKey =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const projectName = "BullMQ Smoke Project";
const baseUrl = "https://api.example.test";

interface ManagedProcess {
  close: () => Promise<void>;
}

interface RedisCompatibilityBinaries {
  serverBin: string;
  cliBin: string;
  label: string;
  versionText: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });

const normalizeEnv = (
  env: NodeJS.ProcessEnv & Record<string, string | undefined>
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );

const writeLog = async (path: string, chunk: string | Buffer): Promise<void> => {
  await writeFile(path, chunk, { flag: "a" });
};

const serializeError = (error: unknown): Record<string, string> => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? ""
    };
  }

  return {
    name: "Error",
    message: String(error),
    stack: ""
  };
};

const runCommand = async (
  command: string,
  args: string[]
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> =>
  await new Promise((resolveCommand) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("exit", (exitCode) => {
      resolveCommand({ exitCode, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });

const maybeExtractCachedMemurai = async (): Promise<string | null> => {
  const extractedDir = resolve(workspaceRoot, "output", "tmp", "memurai-extract", "Memurai");
  const extractedBin = resolve(extractedDir, "memurai.exe");
  if (existsSync(extractedBin)) {
    return extractedDir;
  }

  const wingetTempRoot = resolve(
    process.env.LOCALAPPDATA ?? "",
    "Temp",
    "WinGet"
  );
  if (!existsSync(wingetTempRoot)) {
    return null;
  }

  const memuraiDir = readdirSync(wingetTempRoot).find((entry) =>
    entry.startsWith("Memurai.MemuraiDeveloper.")
  );
  if (!memuraiDir) {
    return null;
  }

  const packageDir = resolve(wingetTempRoot, memuraiDir);
  const msiName = readdirSync(packageDir).find((entry) => entry.toLowerCase().endsWith(".msi"));
  if (!msiName) {
    return null;
  }

  const msiPath = resolve(packageDir, msiName);
  const extractRoot = resolve(workspaceRoot, "output", "tmp", "memurai-extract");
  rmSync(extractRoot, { recursive: true, force: true });
  mkdirSync(extractRoot, { recursive: true });

  const result = await runCommand("msiexec.exe", [
    "/a",
    msiPath,
    "/qn",
    `TARGETDIR=${extractRoot}`
  ]);

  if (result.exitCode !== 0) {
    return null;
  }

  return existsSync(extractedBin) ? extractedDir : null;
};

const parseRedisVersion = (versionText: string): number[] | null => {
  const apiMatch = versionText.match(/API v=(\d+)\.(\d+)\.(\d+)/i);
  if (apiMatch) {
    return apiMatch.slice(1).map((value) => Number(value));
  }

  const redisMatch = versionText.match(/v=(\d+)\.(\d+)\.(\d+)/i);
  if (redisMatch) {
    return redisMatch.slice(1).map((value) => Number(value));
  }

  return null;
};

const versionAtLeast = (version: number[], minimum: [number, number, number]): boolean => {
  for (let index = 0; index < minimum.length; index += 1) {
    const target = minimum[index] ?? 0;
    if ((version[index] ?? 0) > target) {
      return true;
    }
    if ((version[index] ?? 0) < target) {
      return false;
    }
  }

  return true;
};

const resolveRedisCompatibilityBinaries = async (): Promise<RedisCompatibilityBinaries> => {
  const extractedMemuraiDir = await maybeExtractCachedMemurai();
  const candidates = [
    extractedMemuraiDir
      ? {
          label: "memurai-extracted",
          serverBin: resolve(extractedMemuraiDir, "memurai.exe"),
          cliBin: resolve(extractedMemuraiDir, "memurai-cli.exe")
        }
      : null,
    {
      label: "memurai-installed",
      serverBin: "C:\\Program Files\\Memurai\\memurai.exe",
      cliBin: "C:\\Program Files\\Memurai\\memurai-cli.exe"
    },
    {
      label: "redis-installed",
      serverBin: "C:\\Program Files\\Redis\\redis-server.exe",
      cliBin: "C:\\Program Files\\Redis\\redis-cli.exe"
    }
  ].filter(Boolean) as Array<{
    label: string;
    serverBin: string;
    cliBin: string;
  }>;

  for (const candidate of candidates) {
    if (!existsSync(candidate.serverBin) || !existsSync(candidate.cliBin)) {
      continue;
    }

    const version = await runCommand(candidate.serverBin, ["--version"]);
    const versionText = `${version.stdout} ${version.stderr}`.trim();
    const parsed = parseRedisVersion(versionText);
    if (!parsed) {
      continue;
    }

    if (!versionAtLeast(parsed, [5, 0, 0])) {
      continue;
    }

    return {
      ...candidate,
      versionText
    };
  }

  throw new Error(
    "No Redis-compatible server >= 5.0 was found. Install Memurai Developer or provide extracted binaries."
  );
};

const spawnLoggedProcess = (input: {
  cwd: string;
  command: string;
  args: string[];
  logPath: string;
  env?: Record<string, string>;
}): ManagedProcess => {
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    env: normalizeEnv({
      ...process.env,
      ...input.env
    }),
    stdio: "pipe",
    windowsHide: true
  });

  child.stdout?.on("data", async (chunk) => {
    await writeLog(input.logPath, chunk);
  });
  child.stderr?.on("data", async (chunk) => {
    await writeLog(input.logPath, chunk);
  });

  child.on("exit", async (code) => {
    if (code && code !== 0) {
      await writeLog(input.logPath, `\nProcess exited with code ${code}\n`);
    }
  });

  return {
    close: async () => {
      if (child.exitCode !== null) {
        return;
      }

      if (process.platform === "win32") {
        await new Promise<void>((resolveClose) => {
          const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
            stdio: "ignore",
            windowsHide: true
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

const spawnRuntime = (input: {
  port: number;
  logPath: string;
  workerEnabled: boolean;
}): ManagedProcess =>
  spawnLoggedProcess({
    cwd: workspaceRoot,
    command: process.platform === "win32" ? "cmd.exe" : pnpmCommand,
    args:
      process.platform === "win32"
        ? ["/d", "/s", "/c", pnpmCommand, "--filter", "@qpilot/runtime", "start"]
        : ["--filter", "@qpilot/runtime", "start"],
    logPath: input.logPath,
    env: {
      HOST: "127.0.0.1",
      PORT: String(input.port),
      CORS_ORIGIN: "http://127.0.0.1:4179",
      DATABASE_URL: databasePath,
      ARTIFACTS_DIR: artifactsRoot,
      REPORTS_DIR: reportsRoot,
      SESSIONS_DIR: sessionsRoot,
      PLANNER_CACHE_DIR: plannerCacheRoot,
      CREDENTIAL_MASTER_KEY: masterKey,
      PLATFORM_REDIS_URL: redisUrl,
      PLATFORM_REDIS_QUEUE_NAME: "platform-load-runs",
      PLATFORM_REDIS_WORKER_ENABLED: input.workerEnabled ? "true" : "false",
      PLATFORM_REDIS_WORKER_CONCURRENCY: "1"
    }
  });

const spawnRedis = (binaries: RedisCompatibilityBinaries): ManagedProcess =>
  spawnLoggedProcess({
    cwd: outputRoot,
    command: binaries.serverBin,
    args: [
      "--port",
      String(redisPort),
      "--bind",
      "127.0.0.1",
      "--save",
      "",
      "--appendonly",
      "no",
      "--dir",
      redisDir
    ],
    logPath: redisLogPath
  });

const waitForHttp = async (
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

const waitForRedis = async (timeoutMs = 30_000): Promise<void> => {
  const binaries = await resolveRedisCompatibilityBinaries();
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const ping = spawn(binaries.cliBin, ["-p", String(redisPort), "PING"], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true
    });

    const stdout = await new Promise<string>((resolvePing) => {
      let output = "";
      ping.stdout?.on("data", (chunk) => {
        output += chunk.toString();
      });
      ping.on("exit", () => resolvePing(output.trim()));
    });

    if (stdout.includes("PONG")) {
      return;
    }

    await sleep(500);
  }

  throw new Error("Timed out waiting for redis-server.");
};

const apiRequest = async <T>(
  path: string,
  init?: RequestInit
): Promise<T> => {
  const response = await fetch(`${runtimeBaseUrl}${path}`, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} for ${path}: ${body}`);
  }
  return (await response.json()) as T;
};

const pollJson = async <T>(
  path: string,
  predicate: (payload: T) => boolean,
  timeoutMs = 60_000,
  onPoll?: (payload: T) => void
): Promise<T> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const payload = await apiRequest<T>(path);
    onPoll?.(payload);
    if (predicate(payload)) {
      return payload;
    }
    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for ${path}.`);
};

const run = async (): Promise<void> => {
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });
  mkdirSync(redisDir, { recursive: true });

  const observationState: Record<string, unknown> = {
    redisPort,
    controlPort,
    workerPort,
    baseUrl,
    outputRoot
  };

  const redisBinaries = await resolveRedisCompatibilityBinaries();
  observationState.redisEngine = redisBinaries.label;
  observationState.redisVersion = redisBinaries.versionText;
  const redisProcess = spawnRedis(redisBinaries);
  await waitForRedis();

  const controlRuntime = spawnRuntime({
    port: controlPort,
    logPath: runtimeControlLogPath,
    workerEnabled: false
  });

  let workerRuntime: ManagedProcess | undefined;

  try {
    await waitForHttp(`${runtimeBaseUrl}/health`, 45_000, (response) => response.ok);

    const project = await apiRequest<{ id: string }>("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: projectName,
        nameBase64: Buffer.from(projectName, "utf8").toString("base64"),
        baseUrl
      })
    });
    observationState.projectId = project.id;

    const environment = await apiRequest<{ id: string }>("/api/platform/environments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        name: "staging",
        baseUrl,
        authType: "none",
        owner: "platform-qa",
        riskLevel: "medium"
      })
    });
    observationState.environmentId = environment.id;

    const injectorPool = await apiRequest<{ id: string }>("/api/platform/injectors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "bullmq smoke pool",
        region: "local",
        capacity: 30,
        concurrencyLimit: 3,
        tags: ["smoke", "bullmq"],
        workers: [
          { name: "smoke-worker-1", capacity: 2 },
          { name: "smoke-worker-2", capacity: 2 }
        ]
      })
    });
    observationState.injectorPoolId = injectorPool.id;

    const profile = await apiRequest<{ id: string }>("/api/platform/load/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        name: "BullMQ gateway smoke",
        scenarioLabel: "Queue pickup validation",
        targetBaseUrl: baseUrl,
        environmentTargetId: environment.id,
        engine: "synthetic",
        pattern: "steady",
        executionMode: "distributed",
        workerCount: 2,
        injectorPoolId: injectorPool.id,
        arrivalModel: "closed",
        virtualUsers: 40,
        durationSec: 30,
        rampUpSec: 5,
        targetRps: 60,
        thresholds: {
          maxP95Ms: 900,
          maxErrorRatePct: 5,
          minThroughputRps: 10
        }
      })
    });
    observationState.profileId = profile.id;

    const queuedRun = await apiRequest<{ id: string; status: string }>("/api/platform/load/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileId: profile.id,
        environmentId: environment.id,
        environmentLabel: "staging",
        notes: "BullMQ smoke queued run"
      })
    });
    observationState.queuedRunId = queuedRun.id;
    observationState.queuedRunStatus = queuedRun.status;

    let lastQueueSnapshot:
      | {
          mode: string;
          counts: { waiting: number; active?: number; completed?: number };
        }
      | undefined;
    const queueAfterEnqueue = await pollJson<{
      mode: string;
      counts: { waiting: number };
    }>(
      "/api/platform/load/queue",
      (payload) => payload.mode === "bullmq" && payload.counts.waiting >= 1,
      60_000,
      (payload) => {
        lastQueueSnapshot = payload;
      }
    );
    observationState.queueAfterEnqueue = queueAfterEnqueue;

    const cancelledRun = await apiRequest<{ id: string; status: string; verdict: string }>(
      `/api/platform/load/runs/${queuedRun.id}/cancel`,
      {
        method: "POST"
      }
    );
    observationState.cancelledRunId = cancelledRun.id;
    observationState.cancelledRunStatus = cancelledRun.status;

    if (cancelledRun.status !== "stopped") {
      throw new Error(`Expected cancelled run to be stopped, got ${cancelledRun.status}.`);
    }

    workerRuntime = spawnRuntime({
      port: workerPort,
      logPath: runtimeWorkerLogPath,
      workerEnabled: true
    });

    await waitForHttp(`http://127.0.0.1:${workerPort}/health`, 45_000, (response) => response.ok);
    observationState.workerRuntimeStarted = true;

    const retriedRun = await apiRequest<{ id: string; status: string }>(
      `/api/platform/load/runs/${queuedRun.id}/retry`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: "BullMQ smoke retry"
        })
      }
    );
    observationState.retriedRunId = retriedRun.id;
    observationState.retriedRunStatus = retriedRun.status;

    const completedRun = await pollJson<{
      run: { id: string; status: string; verdict: string };
      workers: Array<{ status: string }>;
      gateSummary: string;
    }>(
      `/api/platform/load/runs/${retriedRun.id}`,
      (payload) => payload.run.status === "passed" || payload.run.status === "failed" || payload.run.status === "stopped"
    );
    observationState.completedRunStatus = completedRun.run.status;
    observationState.completedRunVerdict = completedRun.run.verdict;
    observationState.workerStatuses = completedRun.workers.map((worker) => worker.status);
    observationState.gateSummary = completedRun.gateSummary;

    const finalQueue = await pollJson<{
      counts: { waiting: number; active: number; completed: number };
      mode: string;
    }>(
      "/api/platform/load/queue",
      (payload) =>
        payload.mode === "bullmq" &&
        payload.counts.waiting === 0 &&
        payload.counts.active === 0,
      60_000,
      (payload) => {
        lastQueueSnapshot = payload;
      }
    );
    observationState.finalQueue = finalQueue;
    observationState.lastQueueSnapshot = lastQueueSnapshot;
    observationState.outcome = "passed";
    await writeFile(observationsPath, JSON.stringify(observationState, null, 2), "utf8");
  } catch (error) {
    observationState.outcome = "failed";
    observationState.error = serializeError(error);
    await writeFile(observationsPath, JSON.stringify(observationState, null, 2), "utf8");
    throw error;
  } finally {
    await Promise.allSettled([
      controlRuntime.close(),
      workerRuntime?.close(),
      redisProcess.close()
    ]);
  }
};

run()
  .then(() => {
    console.log(`BullMQ smoke completed. Output: ${outputRoot}`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
