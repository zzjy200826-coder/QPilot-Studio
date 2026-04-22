import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../runtime/node_modules/playwright/index.mjs";
import { createClient } from "../../runtime/node_modules/@libsql/client/lib-esm/node.js";
import {
  backfillTenantIds,
  defaultTenantId,
  registerFixtureUser
} from "./auth-helpers.ts";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const workspaceRoot = resolve(currentDir, "..", "..", "..");
const outputRoot = resolve(workspaceRoot, "output", "e2e", "load-platform");
const runtimeBaseUrl = "http://127.0.0.1:8879";
const webBaseUrl = "http://127.0.0.1:4179";
const databasePath = resolve(outputRoot, "runtime.db");
const artifactsRoot = resolve(outputRoot, "runtime-artifacts");
const reportsRoot = resolve(outputRoot, "runtime-reports");
const sessionsRoot = resolve(outputRoot, "runtime-sessions");
const plannerCacheRoot = resolve(outputRoot, "runtime-planner-cache");
const runtimeLogPath = resolve(outputRoot, "runtime.log");
const webLogPath = resolve(outputRoot, "web.log");
const screenshotRoot = resolve(outputRoot, "screenshots");
const observationsPath = resolve(outputRoot, "observations.json");
const masterKey =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const projectId = "proj-load-platform";
const environmentId = "env-staging-platform";
const serviceNodeId = "svc-gateway";
const injectorPoolId = "pool-ap-east";
const gatePolicyId = "gate-api-release";
const releaseId = "release-gateway-2026-04-18";
const gateResultId = "gate-result-gateway-2026-04-18";
const approvalEventId = "approval-gateway-2026-04-18";
const profileId = "profile-gateway-distributed";
const queuedRunId = "load-run-queued";
const failedRunId = "load-run-regressed";
const baselineRunId = "load-run-green";
const now = Date.now();
const fixtureEmail = "load.platform@example.test";
const fixturePassword = "Password123!";

interface ManagedProcess {
  close: () => Promise<void>;
}

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

  child.on("exit", async (code) => {
    if (code && code !== 0) {
      await writeFile(input.logPath, `\nProcess exited with code ${code}\n`, { flag: "a" });
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

const writeRuntimeFile = async (absolutePath: string, content: string): Promise<void> => {
  mkdirSync(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
};

const insertRows = async (
  client: ReturnType<typeof createClient>,
  tableName: string,
  rows: Array<Record<string, string | number | null>>
): Promise<void> => {
  for (const row of rows) {
    const entries = Object.entries(row);
    await client.execute({
      sql: `INSERT INTO ${tableName} (${entries.map(([key]) => key).join(", ")}) VALUES (${entries
        .map(() => "?")
        .join(", ")})`,
      args: entries.map(([, value]) => value)
    });
  }
};

const toMetricsJson = (input: {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  errorRatePct: number;
  throughputRps: number;
  peakVus: number;
  requestCount: number;
  totalErrors: number;
}) => JSON.stringify(input);

const sampleWindowRow = (input: {
  id: string;
  runId: string;
  ts: number;
  p95Ms: number;
  errorRatePct: number;
  throughputRps: number;
  activeWorkers: number;
  note?: string;
}) => ({
  id: input.id,
  run_id: input.runId,
  ts: input.ts,
  p95_ms: Math.round(input.p95Ms),
  error_rate_pct: Math.round(input.errorRatePct * 100),
  throughput_rps: Math.round(input.throughputRps * 100),
  active_workers: input.activeWorkers,
  note: input.note ?? null
});

const bootstrapDatabase = async (): Promise<void> => {
  const runtimeProcess = spawnProcess({
    cwd: workspaceRoot,
    args: ["--filter", "@qpilot/runtime", "start"],
    logPath: runtimeLogPath,
    env: {
      HOST: "127.0.0.1",
      PORT: "8879",
      CORS_ORIGIN: webBaseUrl,
      DATABASE_URL: databasePath,
      ARTIFACTS_DIR: artifactsRoot,
      REPORTS_DIR: reportsRoot,
      SESSIONS_DIR: sessionsRoot,
      PLANNER_CACHE_DIR: plannerCacheRoot,
      CREDENTIAL_MASTER_KEY: masterKey,
      PLATFORM_REDIS_URL: "",
      PLATFORM_REDIS_WORKER_ENABLED: "false"
    }
  });

  try {
    await waitForUrl(`${runtimeBaseUrl}/health`, 45_000, (response) => response.ok);
  } finally {
    await runtimeProcess.close();
  }
};

const seedFixture = async (): Promise<void> => {
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });
  mkdirSync(screenshotRoot, { recursive: true });

  await bootstrapDatabase();

  await writeRuntimeFile(
    resolve(artifactsRoot, "platform-load", "baseline-summary.json"),
    JSON.stringify({ verdict: "ship", profile: profileId }, null, 2)
  );
  await writeRuntimeFile(
    resolve(artifactsRoot, "platform-load", "failed-summary.json"),
    JSON.stringify({ verdict: "hold", profile: profileId, cause: "latency-regression" }, null, 2)
  );
  await writeRuntimeFile(
    resolve(artifactsRoot, "platform-load", "worker-2-failed.json"),
    JSON.stringify({ worker: "worker-2", status: "failed" }, null, 2)
  );

  const client = createClient({
    url: `file:${databasePath}`
  });

  try {
    await insertRows(client, "projects", [
      {
        id: projectId,
        name: "Load Platform Demo",
        base_url: "https://api.example.test",
        username_cipher: null,
        username_iv: null,
        username_tag: null,
        password_cipher: null,
        password_iv: null,
        password_tag: null,
        created_at: now - 360_000,
        updated_at: now - 360_000
      }
    ]);

    await insertRows(client, "environment_targets", [
      {
        id: environmentId,
        project_id: projectId,
        name: "staging",
        base_url: "https://api.example.test",
        auth_type: "none",
        owner: "platform-qa",
        risk_level: "medium",
        created_at: now - 350_000,
        updated_at: now - 350_000
      }
    ]);

    await insertRows(client, "environment_service_nodes", [
      {
        id: serviceNodeId,
        environment_id: environmentId,
        name: "gateway",
        protocol: "https",
        base_url: "https://api.example.test",
        health_path: "/health",
        depends_on_json: "[]",
        tags_json: '["edge","api"]',
        created_at: now - 348_000,
        updated_at: now - 348_000
      }
    ]);

    await insertRows(client, "injector_pools", [
      {
        id: injectorPoolId,
        name: "ap-east steady pool",
        region: "ap-east",
        capacity: 600,
        concurrency_limit: 12,
        tags_json: '["steady","synthetic"]',
        created_at: now - 340_000,
        updated_at: now - 340_000
      }
    ]);

    await insertRows(client, "injector_workers", [
      {
        id: "injector-worker-1",
        pool_id: injectorPoolId,
        name: "injector-1",
        status: "online",
        current_run_count: 0,
        capacity: 4,
        last_heartbeat_at: now - 4_000,
        created_at: now - 338_000,
        updated_at: now - 4_000
      },
      {
        id: "injector-worker-2",
        pool_id: injectorPoolId,
        name: "injector-2",
        status: "online",
        current_run_count: 0,
        capacity: 4,
        last_heartbeat_at: now - 3_000,
        created_at: now - 337_000,
        updated_at: now - 3_000
      },
      {
        id: "injector-worker-3",
        pool_id: injectorPoolId,
        name: "injector-3",
        status: "online",
        current_run_count: 0,
        capacity: 4,
        last_heartbeat_at: now - 2_000,
        created_at: now - 336_000,
        updated_at: now - 2_000
      }
    ]);

    await insertRows(client, "gate_policies", [
      {
        id: gatePolicyId,
        project_id: projectId,
        name: "API release gate",
        required_functional_flows_json: "[]",
        min_benchmark_coverage_pct: 0,
        min_benchmark_pass_rate: 0,
        required_load_profile_ids_json: JSON.stringify([profileId]),
        minimum_load_verdict: "watch",
        allow_waiver: 1,
        approver_roles_json: '["release-manager"]',
        expires_at: null,
        created_at: now - 330_000,
        updated_at: now - 330_000
      }
    ]);

    await insertRows(client, "release_candidates", [
      {
        id: releaseId,
        project_id: projectId,
        environment_id: environmentId,
        gate_policy_id: gatePolicyId,
        name: "2026.04.18 candidate",
        build_label: "build-2026-04-18.1",
        status: "hold",
        notes: "Latency regression requires review before ship.",
        created_at: now - 140_000,
        updated_at: now - 120_000
      }
    ]);

    await insertRows(client, "release_gate_results", [
      {
        id: gateResultId,
        release_id: releaseId,
        verdict: "hold",
        summary: "Load regression blocked release readiness.",
        blockers_json: JSON.stringify(["load.gateway.latency"]),
        signals_json: JSON.stringify([
          {
            id: "functional.login",
            kind: "functional",
            status: "passed",
            label: "Login regression pack",
            detail: "Core sign-in flow passed in the latest smoke run.",
            sourceId: "functional-login"
          },
          {
            id: "benchmark.coverage",
            kind: "benchmark",
            status: "passed",
            label: "Benchmark coverage",
            detail: "Coverage stayed above the required threshold.",
            sourceId: "benchmark-mailbox"
          },
          {
            id: "load.gateway.latency",
            kind: "load",
            status: "failed",
            label: "Gateway distributed gate",
            detail: "P95 and error-rate thresholds regressed against the pinned baseline.",
            sourceId: failedRunId
          }
        ]),
        waiver_count: 0,
        evaluated_at: now - 118_000
      }
    ]);

    await insertRows(client, "approval_events", [
      {
        id: approvalEventId,
        release_id: releaseId,
        waiver_id: null,
        actor: "qa-lead",
        role: "qa-lead",
        action: "release_reviewed",
        detail: "Reviewed the latest load evidence and requested mitigation before ship.",
        created_at: now - 110_000
      }
    ]);

    await insertRows(client, "load_profiles", [
      {
        id: profileId,
        project_id: projectId,
        name: "Gateway distributed gate",
        scenario_label: "Gateway health under steady load",
        target_base_url: "https://api.example.test",
        environment_target_id: environmentId,
        engine: "synthetic",
        pattern: "steady",
        request_path: null,
        http_method: null,
        headers_json: null,
        body_template: null,
        execution_mode: "distributed",
        worker_count: 3,
        injector_pool_id: injectorPoolId,
        arrival_model: "closed",
        phase_plan_json: null,
        request_mix_json: null,
        evidence_policy_json: null,
        gate_policy_id: gatePolicyId,
        tags_json: '["steady","gateway","distributed"]',
        baseline_run_id: baselineRunId,
        virtual_users: 180,
        duration_sec: 180,
        ramp_up_sec: 30,
        target_rps: 320,
        thresholds_json: JSON.stringify({
          maxP95Ms: 500,
          maxErrorRatePct: 1,
          minThroughputRps: 250
        }),
        created_at: now - 320_000,
        updated_at: now - 320_000
      }
    ]);

    await insertRows(client, "load_runs", [
      {
        id: baselineRunId,
        project_id: projectId,
        profile_id: profileId,
        profile_name: "Gateway distributed gate",
        scenario_label: "Gateway health under steady load",
        target_base_url: "https://api.example.test",
        environment_id: environmentId,
        engine: "synthetic",
        pattern: "steady",
        environment_label: "staging",
        status: "passed",
        verdict: "ship",
        source: "synthetic",
        metrics_json: toMetricsJson({
          p50Ms: 110,
          p95Ms: 220,
          p99Ms: 310,
          errorRatePct: 0.2,
          throughputRps: 382,
          peakVus: 180,
          requestCount: 68400,
          totalErrors: 137
        }),
        notes: "Pinned green baseline for gateway release readiness.",
        engine_version: "synthetic-fixture",
        executor_label: "Distributed synthetic runner",
        raw_summary_path: "/platform-load/baseline-summary.json",
        compare_baseline_run_id: null,
        started_at: now - 250_000,
        ended_at: now - 247_000,
        created_at: now - 252_000
      },
      {
        id: failedRunId,
        project_id: projectId,
        profile_id: profileId,
        profile_name: "Gateway distributed gate",
        scenario_label: "Gateway health under steady load",
        target_base_url: "https://api.example.test",
        environment_id: environmentId,
        engine: "synthetic",
        pattern: "steady",
        environment_label: "staging",
        status: "failed",
        verdict: "hold",
        source: "synthetic",
        metrics_json: toMetricsJson({
          p50Ms: 320,
          p95Ms: 780,
          p99Ms: 980,
          errorRatePct: 2.4,
          throughputRps: 168,
          peakVus: 180,
          requestCount: 30120,
          totalErrors: 725
        }),
        notes: "Latency regression after the last gateway cache rollout.",
        engine_version: "synthetic-fixture",
        executor_label: "Distributed synthetic runner",
        raw_summary_path: "/platform-load/failed-summary.json",
        compare_baseline_run_id: baselineRunId,
        started_at: now - 150_000,
        ended_at: now - 146_000,
        created_at: now - 152_000
      },
      {
        id: queuedRunId,
        project_id: projectId,
        profile_id: profileId,
        profile_name: "Gateway distributed gate",
        scenario_label: "Gateway health under steady load",
        target_base_url: "https://api.example.test",
        environment_id: environmentId,
        engine: "synthetic",
        pattern: "steady",
        environment_label: "staging",
        status: "queued",
        verdict: "watch",
        source: "synthetic",
        metrics_json: toMetricsJson({
          p50Ms: 0,
          p95Ms: 0,
          p99Ms: 0,
          errorRatePct: 0,
          throughputRps: 0,
          peakVus: 0,
          requestCount: 0,
          totalErrors: 0
        }),
        notes: "Queued behind a temporary capacity reservation.",
        engine_version: null,
        executor_label: "Inline control plane",
        raw_summary_path: null,
        compare_baseline_run_id: baselineRunId,
        started_at: now - 40_000,
        ended_at: null,
        created_at: now - 42_000
      }
    ]);

    await insertRows(client, "load_run_workers", [
      {
        id: "worker-green-1",
        run_id: baselineRunId,
        worker_index: 1,
        worker_label: "worker-1",
        injector_pool_id: injectorPoolId,
        injector_worker_id: "injector-worker-1",
        status: "passed",
        metrics_json: toMetricsJson({
          p50Ms: 108,
          p95Ms: 218,
          p99Ms: 300,
          errorRatePct: 0.2,
          throughputRps: 126,
          peakVus: 60,
          requestCount: 22800,
          totalErrors: 46
        }),
        notes: "Steady execution window.",
        engine_version: "synthetic-fixture",
        executor_label: "Synthetic shard",
        raw_summary_path: "/platform-load/baseline-summary.json",
        started_at: now - 250_000,
        ended_at: now - 247_000,
        created_at: now - 252_000
      },
      {
        id: "worker-green-2",
        run_id: baselineRunId,
        worker_index: 2,
        worker_label: "worker-2",
        injector_pool_id: injectorPoolId,
        injector_worker_id: "injector-worker-2",
        status: "passed",
        metrics_json: toMetricsJson({
          p50Ms: 112,
          p95Ms: 222,
          p99Ms: 312,
          errorRatePct: 0.2,
          throughputRps: 128,
          peakVus: 60,
          requestCount: 22800,
          totalErrors: 45
        }),
        notes: "Steady execution window.",
        engine_version: "synthetic-fixture",
        executor_label: "Synthetic shard",
        raw_summary_path: "/platform-load/baseline-summary.json",
        started_at: now - 250_000,
        ended_at: now - 247_000,
        created_at: now - 252_000
      },
      {
        id: "worker-green-3",
        run_id: baselineRunId,
        worker_index: 3,
        worker_label: "worker-3",
        injector_pool_id: injectorPoolId,
        injector_worker_id: "injector-worker-3",
        status: "passed",
        metrics_json: toMetricsJson({
          p50Ms: 111,
          p95Ms: 220,
          p99Ms: 318,
          errorRatePct: 0.2,
          throughputRps: 128,
          peakVus: 60,
          requestCount: 22800,
          totalErrors: 46
        }),
        notes: "Steady execution window.",
        engine_version: "synthetic-fixture",
        executor_label: "Synthetic shard",
        raw_summary_path: "/platform-load/baseline-summary.json",
        started_at: now - 250_000,
        ended_at: now - 247_000,
        created_at: now - 252_000
      },
      {
        id: "worker-red-1",
        run_id: failedRunId,
        worker_index: 1,
        worker_label: "worker-1",
        injector_pool_id: injectorPoolId,
        injector_worker_id: "injector-worker-1",
        status: "passed",
        metrics_json: toMetricsJson({
          p50Ms: 210,
          p95Ms: 420,
          p99Ms: 560,
          errorRatePct: 0.9,
          throughputRps: 98,
          peakVus: 60,
          requestCount: 10040,
          totalErrors: 90
        }),
        notes: "One shard stayed partially healthy.",
        engine_version: "synthetic-fixture",
        executor_label: "Synthetic shard",
        raw_summary_path: "/platform-load/failed-summary.json",
        started_at: now - 150_000,
        ended_at: now - 146_000,
        created_at: now - 152_000
      },
      {
        id: "worker-red-2",
        run_id: failedRunId,
        worker_index: 2,
        worker_label: "worker-2",
        injector_pool_id: injectorPoolId,
        injector_worker_id: "injector-worker-2",
        status: "failed",
        metrics_json: toMetricsJson({
          p50Ms: 410,
          p95Ms: 980,
          p99Ms: 1240,
          errorRatePct: 4.2,
          throughputRps: 28,
          peakVus: 60,
          requestCount: 5040,
          totalErrors: 350
        }),
        notes: "Injector shard degraded after the cache rollout.",
        engine_version: "synthetic-fixture",
        executor_label: "Synthetic shard",
        raw_summary_path: "/platform-load/worker-2-failed.json",
        started_at: now - 150_000,
        ended_at: now - 146_000,
        created_at: now - 152_000
      },
      {
        id: "worker-red-3",
        run_id: failedRunId,
        worker_index: 3,
        worker_label: "worker-3",
        injector_pool_id: injectorPoolId,
        injector_worker_id: "injector-worker-3",
        status: "passed",
        metrics_json: toMetricsJson({
          p50Ms: 320,
          p95Ms: 640,
          p99Ms: 790,
          errorRatePct: 2.1,
          throughputRps: 42,
          peakVus: 60,
          requestCount: 15040,
          totalErrors: 285
        }),
        notes: "Recovered partially but stayed under the throughput floor.",
        engine_version: "synthetic-fixture",
        executor_label: "Synthetic shard",
        raw_summary_path: "/platform-load/failed-summary.json",
        started_at: now - 150_000,
        ended_at: now - 146_000,
        created_at: now - 152_000
      },
      {
        id: "worker-queued-1",
        run_id: queuedRunId,
        worker_index: 1,
        worker_label: "worker-1",
        injector_pool_id: injectorPoolId,
        injector_worker_id: "injector-worker-1",
        status: "queued",
        metrics_json: toMetricsJson({
          p50Ms: 0,
          p95Ms: 0,
          p99Ms: 0,
          errorRatePct: 0,
          throughputRps: 0,
          peakVus: 0,
          requestCount: 0,
          totalErrors: 0
        }),
        notes: "Queued for execution.",
        engine_version: null,
        executor_label: "Inline shard placeholder",
        raw_summary_path: null,
        started_at: now - 40_000,
        ended_at: null,
        created_at: now - 42_000
      },
      {
        id: "worker-queued-2",
        run_id: queuedRunId,
        worker_index: 2,
        worker_label: "worker-2",
        injector_pool_id: injectorPoolId,
        injector_worker_id: "injector-worker-2",
        status: "queued",
        metrics_json: toMetricsJson({
          p50Ms: 0,
          p95Ms: 0,
          p99Ms: 0,
          errorRatePct: 0,
          throughputRps: 0,
          peakVus: 0,
          requestCount: 0,
          totalErrors: 0
        }),
        notes: "Queued for execution.",
        engine_version: null,
        executor_label: "Inline shard placeholder",
        raw_summary_path: null,
        started_at: now - 40_000,
        ended_at: null,
        created_at: now - 42_000
      },
      {
        id: "worker-queued-3",
        run_id: queuedRunId,
        worker_index: 3,
        worker_label: "worker-3",
        injector_pool_id: injectorPoolId,
        injector_worker_id: "injector-worker-3",
        status: "queued",
        metrics_json: toMetricsJson({
          p50Ms: 0,
          p95Ms: 0,
          p99Ms: 0,
          errorRatePct: 0,
          throughputRps: 0,
          peakVus: 0,
          requestCount: 0,
          totalErrors: 0
        }),
        notes: "Queued for execution.",
        engine_version: null,
        executor_label: "Inline shard placeholder",
        raw_summary_path: null,
        started_at: now - 40_000,
        ended_at: null,
        created_at: now - 42_000
      }
    ]);

    await insertRows(client, "load_run_sample_windows", [
      sampleWindowRow({
        id: "sample-green-1",
        runId: baselineRunId,
        ts: now - 249_000,
        p95Ms: 210,
        errorRatePct: 0.18,
        throughputRps: 372,
        activeWorkers: 3
      }),
      sampleWindowRow({
        id: "sample-green-2",
        runId: baselineRunId,
        ts: now - 248_500,
        p95Ms: 218,
        errorRatePct: 0.2,
        throughputRps: 378,
        activeWorkers: 3
      }),
      sampleWindowRow({
        id: "sample-green-3",
        runId: baselineRunId,
        ts: now - 248_000,
        p95Ms: 224,
        errorRatePct: 0.23,
        throughputRps: 384,
        activeWorkers: 3
      }),
      sampleWindowRow({
        id: "sample-green-4",
        runId: baselineRunId,
        ts: now - 247_500,
        p95Ms: 220,
        errorRatePct: 0.2,
        throughputRps: 388,
        activeWorkers: 3
      }),
      sampleWindowRow({
        id: "sample-failed-1",
        runId: failedRunId,
        ts: now - 149_000,
        p95Ms: 520,
        errorRatePct: 1.2,
        throughputRps: 240,
        activeWorkers: 3,
        note: "Latency drift started."
      }),
      sampleWindowRow({
        id: "sample-failed-2",
        runId: failedRunId,
        ts: now - 148_500,
        p95Ms: 640,
        errorRatePct: 1.9,
        throughputRps: 214,
        activeWorkers: 3
      }),
      sampleWindowRow({
        id: "sample-failed-3",
        runId: failedRunId,
        ts: now - 148_000,
        p95Ms: 760,
        errorRatePct: 2.2,
        throughputRps: 196,
        activeWorkers: 2,
        note: "Worker instability reduced healthy capacity."
      }),
      sampleWindowRow({
        id: "sample-failed-4",
        runId: failedRunId,
        ts: now - 147_500,
        p95Ms: 810,
        errorRatePct: 2.5,
        throughputRps: 172,
        activeWorkers: 2
      }),
      sampleWindowRow({
        id: "sample-failed-5",
        runId: failedRunId,
        ts: now - 147_000,
        p95Ms: 790,
        errorRatePct: 2.4,
        throughputRps: 168,
        activeWorkers: 2
      })
    ]);

    await insertRows(client, "ops_alert_events", [
      {
        id: "ops-alert-load-backlog",
        tenant_id: defaultTenantId,
        rule_key: "load_queue_backlog_high",
        severity: "warning",
        status: "active",
        summary: "Queue backlog exceeded threshold during fixture validation.",
        detail_json: JSON.stringify({
          backlog: 8,
          threshold: 5,
          waiting: 5,
          delayed: 3
        }),
        fingerprint: `load_queue_backlog_high:${defaultTenantId}`,
        first_triggered_at: now - 80_000,
        last_triggered_at: now - 20_000,
        last_delivered_at: now - 10_000,
        last_delivery_error: null
      }
    ]);
  } finally {
    await backfillTenantIds(client);
    await client.close();
  }
};

const expectText = async (
  scope: import("playwright").Page | import("playwright").Locator,
  text: string
): Promise<void> => {
  await scope.getByText(text, { exact: false }).first().waitFor({ timeout: 15_000 });
};

const run = async (): Promise<void> => {
  await seedFixture();
  console.log("[load-platform] seeded fixture");

  const runtimeProcess = spawnProcess({
    cwd: workspaceRoot,
    args: ["--filter", "@qpilot/runtime", "start"],
    logPath: runtimeLogPath,
    env: {
      HOST: "127.0.0.1",
      PORT: "8879",
      CORS_ORIGIN: webBaseUrl,
      DATABASE_URL: databasePath,
      ARTIFACTS_DIR: artifactsRoot,
      REPORTS_DIR: reportsRoot,
      SESSIONS_DIR: sessionsRoot,
      PLANNER_CACHE_DIR: plannerCacheRoot,
      CREDENTIAL_MASTER_KEY: masterKey,
      PLATFORM_REDIS_URL: "",
      PLATFORM_REDIS_WORKER_ENABLED: "false"
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
      "4179",
      "--strictPort"
    ],
    logPath: webLogPath,
    env: {
      VITE_RUNTIME_BASE_URL: runtimeBaseUrl
    }
  });

  const cleanup = async (): Promise<void> => {
    await Promise.allSettled([webProcess.close(), runtimeProcess.close()]);
  };

  try {
    await waitForUrl(`${runtimeBaseUrl}/health`, 45_000, (response) => response.ok);
    await waitForUrl(`${webBaseUrl}/platform/control`, 45_000, (response) => response.ok);
    console.log("[load-platform] runtime and web are ready");

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
      displayName: "Load Platform Owner",
      tenantName: "Load Platform Workspace",
      redirectPath: "/projects"
    });
    await page.goto("/platform/control", { waitUntil: "domcontentloaded" });
    console.log("[load-platform] opened control tower");
    await page.getByRole("button", { name: "Dense" }).click();
    await expectText(page, "Dependencies");
    await expectText(page, "Load dispatch");
    await expectText(page, "retry 3x");
    await expectText(page, "timeout 15000 ms");
    await page.screenshot({
      path: resolve(screenshotRoot, "01-control-tower-queue.png"),
      fullPage: true
    });

    await page.goto("/platform/ops", { waitUntil: "domcontentloaded" });
    console.log("[load-platform] opened ops summary");
    await expectText(page, "Runtime readiness");
    await expectText(page, "Backup health");
    await expectText(page, "Dependencies");
    await expectText(page, "Recent alerts");
    await expectText(page, "Scheduler and storage summary");
    await expectText(page, "Queue backlog exceeded threshold during fixture validation.");
    await page.screenshot({
      path: resolve(screenshotRoot, "02-ops-summary.png"),
      fullPage: true
    });

    await page.goto("/platform/environments", { waitUntil: "domcontentloaded" });
    console.log("[load-platform] opened environments");
    await expectText(page, "Targets, topology, and injector capacity.");
    await page.getByRole("button", { name: "Create environment" }).first().click();
    await expectText(page, "Create environment");
    await page.getByRole("button", { name: "Close" }).first().click();

    await page.goto("/platform/gates", { waitUntil: "domcontentloaded" });
    console.log("[load-platform] opened gates");
    await expectText(page, "Verdicts, blockers, waivers, and approvals.");
    await page.getByRole("button", { name: "Create policy" }).first().click();
    await expectText(page, "Create policy");
    await page.getByRole("button", { name: "Close" }).first().click();
    await expectText(page, "Release candidates");
    await expectText(page, "2026.04.18 candidate");
    await page.getByRole("button", { name: "Inspect" }).first().click();
    await expectText(page, "Gate inputs");
    await expectText(page, "Approval timeline");
    await page.getByRole("button", { name: "Record approval" }).first().click();
    await expectText(page, "Record approval");
    await page.getByRole("button", { name: "Close" }).first().click();

    await page.goto("/platform/load?studioMode=run", { waitUntil: "domcontentloaded" });
    console.log("[load-platform] opened load studio");
    await expectText(page, "Load Studio");
    await expectText(page, "Profile inventory");
    await expectText(page, "Gateway distributed gate");
    await page.getByRole("button", { name: "New profile" }).first().click();
    await expectText(page, "New profile");
    const advancedHeadersCount = await page.getByText("Headers", { exact: false }).count();
    if (advancedHeadersCount !== 0) {
      throw new Error("Advanced fields should stay collapsed by default in Load Studio.");
    }
    await page.getByRole("button", { name: "Advanced" }).click();
    await expectText(page, "Headers");
    await page.getByRole("button", { name: "Close" }).first().click();
    await page.screenshot({
      path: resolve(screenshotRoot, "03-load-studio.png"),
      fullPage: true
    });

    const runRows = page.locator("table").nth(1).locator("tbody tr");
    const queuedRow = runRows.nth(0);
    await queuedRow.locator("a").first().click();
    console.log("[load-platform] opened queued run detail");

    await expectText(page, "Retry this run");
    await expectText(page, "Cancel queued run");
    await expectText(page, "Live run console");
    await expectText(page, "Baseline and candidate");
    await page.screenshot({
      path: resolve(screenshotRoot, "04-queued-detail.png"),
      fullPage: true
    });

    await page.getByRole("button", { name: "Cancel queued run" }).click();
    await expectText(page, "stopped");
    await page.screenshot({
      path: resolve(screenshotRoot, "05-queued-cancelled.png"),
      fullPage: true
    });

    await page.evaluate(() => {
      window.localStorage.setItem("qpilot.language.v1", "zh-CN");
    });
    await page.goto("/platform/ops", { waitUntil: "domcontentloaded" });
    await expectText(page, "运行就绪");
    await expectText(page, "依赖检查");
    await expectText(page, "最近告警");
    const zhBody = (await page.locator("body").textContent()) ?? "";
    if (!zhBody.includes("Backup health") && !zhBody.includes("备份健康")) {
      throw new Error("Ops summary should render the backup health section in Chinese mode.");
    }
    if (zhBody.includes("�")) {
      throw new Error("Ops summary should not render replacement-character mojibake in Chinese mode.");
    }
    await page.screenshot({
      path: resolve(screenshotRoot, "06-ops-summary-zh.png"),
      fullPage: true
    });

    await writeFile(
      observationsPath,
      JSON.stringify(
        {
          projectId,
          environmentId,
          injectorPoolId,
          profileId,
          queuedRunId,
          failedRunId,
          baselineRunId,
          opsAlertId: "ops-alert-load-backlog",
          authEmail: fixtureEmail,
          retriedRunId: null,
          screenshots: {
            controlTower: resolve(screenshotRoot, "01-control-tower-queue.png"),
            opsSummary: resolve(screenshotRoot, "02-ops-summary.png"),
            loadStudio: resolve(screenshotRoot, "03-load-studio.png"),
            queuedDetail: resolve(screenshotRoot, "04-queued-detail.png"),
            queuedCancelled: resolve(screenshotRoot, "05-queued-cancelled.png"),
            opsSummaryZh: resolve(screenshotRoot, "06-ops-summary-zh.png")
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
    console.log(`Load platform E2E fixture completed. Output: ${outputRoot}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
