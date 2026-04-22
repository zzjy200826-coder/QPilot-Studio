import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../runtime/node_modules/playwright/index.mjs";
import { createClient } from "../../runtime/node_modules/@libsql/client/lib-esm/node.js";
import {
  backfillTenantIds,
  createApiTokenFromPage,
  registerFixtureUser
} from "./auth-helpers.ts";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const workspaceRoot = resolve(currentDir, "..", "..", "..");
const outputRoot = resolve(workspaceRoot, "output", "e2e", "release-gates");
const runtimeBaseUrl = "http://127.0.0.1:8880";
const webBaseUrl = "http://127.0.0.1:4180";
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

const projectId = "proj-release-gates";
const environmentId = "env-release-staging";
const gatePolicyId = "gate-release-policy";
const releaseId = "release-gateway-2026-04-21";
const releaseGateResultId = "gate-result-gateway-2026-04-21";
const releaseBuildId = "gateway-web-2184";
const releaseCommitSha = "9f4a3c1";
const functionalRunId = "run-core-login-passed";
const newerFunctionalRunId = "run-core-login-failed-latest";
const functionalCaseId = "case-core-login";
const loadProfileId = "profile-gateway-release";
const baselineLoadRunId = "load-run-gateway-green";
const loadRunId = "load-run-gateway-hold";
const newerLoadRunId = "load-run-gateway-recovery";
const injectorPoolId = "pool-release-ap-east";
const initialApprovalId = "approval-release-reviewed";
const initialWaiverId = "waiver-expired-gateway";
const helperReleaseName = "2026.04.21 helper candidate";
const helperReleaseBuildId = "gateway-web-helper-2190";
const helperReleaseCommitSha = "7ab12ef";
const scriptReleaseName = "2026.04.21 pipeline candidate";
const scriptReleaseBuildLabel = "build-2026-04-21.pipeline";
const scriptReleaseBuildId = "gateway-web-pipeline-2191";
const scriptReleaseCommitSha = "4c91abe";
const scriptReleaseOutputPath = resolve(outputRoot, "release-submit.json");
const now = Date.now();
const fixtureEmail = "release.gates@example.test";
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

const runCommandCapture = (input: {
  cwd: string;
  args: string[];
  env?: Record<string, string>;
}): { stdout: string; stderr: string } => {
  const command = process.platform === "win32" ? "cmd.exe" : pnpmCommand;
  const commandArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", pnpmCommand, ...input.args]
      : input.args;

  const result = spawnSync(command, commandArgs, {
    cwd: input.cwd,
    env: normalizeEnv({
      ...process.env,
      ...input.env
    }),
    windowsHide: true,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error(
      `Command failed with exit code ${result.status}: ${input.args.join(" ")}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`
    );
  }

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
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

const svgCard = (input: {
  title: string;
  subtitle: string;
  accent: string;
  detail?: string;
}): string => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fdf2f8" />
      <stop offset="100%" stop-color="#f8fafc" />
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)" />
  <rect x="84" y="92" width="1112" height="536" rx="32" fill="#ffffff" stroke="#cbd5e1" stroke-width="3" />
  <rect x="136" y="146" width="220" height="12" rx="6" fill="${input.accent}" opacity="0.35" />
  <text x="136" y="236" font-size="52" font-family="Segoe UI, Arial, sans-serif" font-weight="700" fill="#0f172a">${input.title}</text>
  <text x="136" y="304" font-size="28" font-family="Segoe UI, Arial, sans-serif" fill="#334155">${input.subtitle}</text>
  <text x="136" y="388" font-size="22" font-family="Segoe UI, Arial, sans-serif" fill="#64748b">${input.detail ?? ""}</text>
  <rect x="136" y="472" width="288" height="56" rx="18" fill="${input.accent}" opacity="0.14" />
  <text x="166" y="508" font-size="24" font-family="Segoe UI, Arial, sans-serif" font-weight="600" fill="${input.accent}">Fixture Evidence</text>
</svg>
`;

const runConfig = (input: {
  replayCaseId: string;
  replayCaseTitle: string;
}): string =>
  JSON.stringify({
    targetUrl: "https://gateway.example.test/login",
    mode: "login",
    language: "en",
    executionMode: "stepwise_replan",
    confirmDraft: false,
    goal: "Validate the core login flow before release.",
    maxSteps: 8,
    headed: true,
    manualTakeover: true,
    sessionProfile: "release-gates-fixture",
    saveSession: true,
    replayCase: {
      templateId: input.replayCaseId,
      title: input.replayCaseTitle,
      type: "hybrid"
    }
  });

const verification = (input: {
  passed: boolean;
  note: string;
  outcome:
    | "progressed"
    | "recoverable_failure"
    | "blocking_failure"
    | "terminal_success"
    | "terminal_failure";
  stage: "target_site" | "credential_form" | "authenticated_app";
}): string =>
  JSON.stringify({
    urlChanged: true,
    checks: [
      {
        expected: input.stage === "authenticated_app" ? "authenticated shell visible" : "checkpoint advanced",
        found: input.passed
      }
    ],
    pageState: {
      surface: input.stage,
      hasModal: false,
      hasIframe: false,
      frameCount: 0,
      hasLoginForm: input.stage === "credential_form",
      hasProviderChooser: false,
      hasSearchResults: false,
      matchedSignals: input.stage === "authenticated_app" ? ["dashboard-shell"] : ["fixture"],
      primaryContext: input.stage === "authenticated_app" ? "Gateway shell" : "Credential form"
    },
    api: {
      status: input.passed ? "passed" : "failed",
      requestCount: 1,
      matchedRequestCount: input.passed ? 1 : 0,
      failedRequestCount: input.passed ? 0 : 1,
      expectedRequestCount: 1,
      tokenSignals: input.passed ? 1 : 0,
      sessionSignals: input.passed ? 1 : 0,
      hostTransition: {
        from: "gateway.example.test",
        to: "gateway.example.test",
        changed: false
      },
      note: input.note,
      keyRequests: []
    },
    execution: {
      targetUsed: "#fixture-target",
      resolutionMethod: "dom_selector"
    },
    outcome: input.outcome,
    workingMemory: {
      stage: input.stage,
      alignment: input.stage === "authenticated_app" ? "aligned" : "intermediate_auth",
      transitionReason: input.stage,
      goalAnchors: ["gateway", "login", "release"],
      avoidHosts: [],
      avoidLabels: [],
      avoidRepeatCredentialSubmission: false,
      lastOutcome: input.outcome,
      lastStepUrl:
        input.stage === "authenticated_app"
          ? "https://gateway.example.test/app"
          : "https://gateway.example.test/login",
      successSignals: input.stage === "authenticated_app" ? ["dashboard-shell"] : []
    },
    passed: input.passed,
    note: input.note
  });

const domSummary = (label: string): string =>
  JSON.stringify([
    {
      tag: "button",
      selector: "#fixture-target",
      text: label,
      role: "button",
      isVisible: true,
      isEnabled: true
    }
  ]);

const action = (type: string, target: string, note: string, value?: string): string =>
  JSON.stringify({
    type,
    target,
    value,
    note
  });

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
      PORT: "8880",
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
    resolve(artifactsRoot, "runs", functionalRunId, "startup.svg"),
    svgCard({
      title: "Core login passed",
      subtitle: "Release smoke run reached the authenticated shell.",
      accent: "#0f766e",
      detail: functionalRunId
    })
  );
  await writeRuntimeFile(
    resolve(artifactsRoot, "runs", functionalRunId, "step-0001.svg"),
    svgCard({
      title: "Login form ready",
      subtitle: "Credentials accepted and auth request sent.",
      accent: "#0ea5e9",
      detail: "step 1"
    })
  );
  await writeRuntimeFile(
    resolve(artifactsRoot, "runs", functionalRunId, "step-0002.svg"),
    svgCard({
      title: "Gateway shell ready",
      subtitle: "Authenticated dashboard rendered without blockers.",
      accent: "#10b981",
      detail: "step 2"
    })
  );
  await writeRuntimeFile(
    resolve(artifactsRoot, "platform-release", "baseline-summary.json"),
    JSON.stringify({ verdict: "ship", runId: baselineLoadRunId }, null, 2)
  );
  await writeRuntimeFile(
    resolve(artifactsRoot, "platform-release", "candidate-summary.json"),
    JSON.stringify({ verdict: "hold", runId: loadRunId, reason: "latency-regression" }, null, 2)
  );

  const client = createClient({
    url: `file:${databasePath}`
  });

  try {
    await insertRows(client, "projects", [
      {
        id: projectId,
        name: "Release Gate Demo",
        base_url: "https://gateway.example.test",
        username_cipher: null,
        username_iv: null,
        username_tag: null,
        password_cipher: null,
        password_iv: null,
        password_tag: null,
        created_at: now - 600_000,
        updated_at: now - 600_000
      }
    ]);

    await insertRows(client, "environment_targets", [
      {
        id: environmentId,
        project_id: projectId,
        name: "staging",
        base_url: "https://gateway.example.test",
        auth_type: "none",
        owner: "release-platform",
        risk_level: "medium",
        created_at: now - 560_000,
        updated_at: now - 560_000
      }
    ]);

    await insertRows(client, "injector_pools", [
      {
        id: injectorPoolId,
        name: "release steady pool",
        region: "ap-east",
        capacity: 240,
        concurrency_limit: 8,
        tags_json: '["release","steady"]',
        created_at: now - 550_000,
        updated_at: now - 550_000
      }
    ]);

    await insertRows(client, "injector_workers", [
      {
        id: "injector-release-1",
        pool_id: injectorPoolId,
        name: "injector-release-1",
        status: "online",
        current_run_count: 0,
        capacity: 4,
        last_heartbeat_at: now - 4_000,
        created_at: now - 548_000,
        updated_at: now - 4_000
      },
      {
        id: "injector-release-2",
        pool_id: injectorPoolId,
        name: "injector-release-2",
        status: "online",
        current_run_count: 0,
        capacity: 4,
        last_heartbeat_at: now - 3_000,
        created_at: now - 547_000,
        updated_at: now - 3_000
      }
    ]);

    await insertRows(client, "gate_policies", [
      {
        id: gatePolicyId,
        project_id: projectId,
        name: "Gateway release policy",
        required_functional_flows_json: JSON.stringify(["Core login"]),
        min_benchmark_coverage_pct: 100,
        min_benchmark_pass_rate: 100,
        required_load_profile_ids_json: JSON.stringify([loadProfileId]),
        minimum_load_verdict: "watch",
        allow_waiver: 1,
        approver_roles_json: JSON.stringify(["release-manager", "qa-lead"]),
        expires_at: null,
        created_at: now - 520_000,
        updated_at: now - 520_000
      }
    ]);

    await insertRows(client, "runs", [
      {
        id: functionalRunId,
        project_id: projectId,
        status: "passed",
        mode: "login",
        target_url: "https://gateway.example.test/login",
        goal: "Validate the Core login release flow.",
        model: "fixture",
        config_json: runConfig({
          replayCaseId: functionalCaseId,
          replayCaseTitle: "Core login smoke"
        }),
        startup_page_url: "https://gateway.example.test/login",
        startup_page_title: "Gateway sign in",
        startup_screenshot_path: "/artifacts/runs/run-core-login-passed/startup.svg",
        startup_observation: "Core login release smoke is ready to begin.",
        challenge_kind: null,
        challenge_reason: null,
        recorded_video_path: null,
        llm_last_json: null,
        error_message: null,
        started_at: now - 240_000,
        ended_at: now - 236_000,
        created_at: now - 242_000
      },
      {
        id: newerFunctionalRunId,
        project_id: projectId,
        status: "failed",
        mode: "login",
        target_url: "https://gateway.example.test/login",
        goal: "Validate the Core login release flow.",
        model: "fixture",
        config_json: runConfig({
          replayCaseId: functionalCaseId,
          replayCaseTitle: "Core login smoke"
        }),
        startup_page_url: "https://gateway.example.test/login",
        startup_page_title: "Gateway sign in",
        startup_screenshot_path: null,
        startup_observation: "A newer failed run exists but is not bound to this release.",
        challenge_kind: null,
        challenge_reason: null,
        recorded_video_path: null,
        llm_last_json: null,
        error_message: "Latest smoke failed after a staging-only outage.",
        started_at: now - 90_000,
        ended_at: now - 88_000,
        created_at: now - 92_000
      }
    ]);

    await insertRows(client, "steps", [
      {
        id: "step-core-login-1",
        run_id: functionalRunId,
        step_index: 1,
        page_url: "https://gateway.example.test/login",
        page_title: "Gateway sign in",
        dom_summary_json: domSummary("Sign in form ready"),
        screenshot_path: "/artifacts/runs/run-core-login-passed/step-0001.svg",
        action_json: action("input", "#email", "Fill the release smoke account.", "fixture@example.test"),
        action_status: "success",
        observation_summary: "Gateway sign-in form accepted the release smoke credentials.",
        verification_json: verification({
          passed: true,
          note: "Credential entry matched the release smoke template.",
          outcome: "progressed",
          stage: "credential_form"
        }),
        created_at: now - 241_000
      },
      {
        id: "step-core-login-2",
        run_id: functionalRunId,
        step_index: 2,
        page_url: "https://gateway.example.test/app",
        page_title: "Gateway shell",
        dom_summary_json: domSummary("Authenticated shell ready"),
        screenshot_path: "/artifacts/runs/run-core-login-passed/step-0002.svg",
        action_json: action("wait", "dashboard-shell", "Wait for the gateway shell to render."),
        action_status: "success",
        observation_summary: "Gateway shell rendered and the release smoke finished cleanly.",
        verification_json: verification({
          passed: true,
          note: "Gateway shell rendered and the session bootstrap request returned 200.",
          outcome: "terminal_success",
          stage: "authenticated_app"
        }),
        created_at: now - 239_000
      }
    ]);

    await insertRows(client, "test_cases", [
      {
        id: "testcase-core-login",
        run_id: functionalRunId,
        module: "auth",
        title: "Core login release smoke",
        preconditions: "Release candidate deployed to staging",
        steps_json: JSON.stringify(["Open login page", "Submit credentials", "Wait for dashboard shell"]),
        expected: "Authenticated shell appears",
        actual: "Authenticated shell appears",
        status: "passed",
        priority: "p0",
        method: "hybrid",
        created_at: now - 238_000
      }
    ]);

    await insertRows(client, "case_templates", [
      {
        id: functionalCaseId,
        project_id: projectId,
        run_id: functionalRunId,
        type: "hybrid",
        title: "Core login smoke",
        goal: "Replay the core login flow and verify the authenticated shell.",
        entry_url: "https://gateway.example.test/login",
        status: "active",
        summary: "Release smoke template for the gateway login flow.",
        case_json: JSON.stringify({
          title: "Core login smoke",
          steps: [
            { type: "input", target: "#email" },
            { type: "wait", target: "dashboard-shell" }
          ]
        }),
        created_at: now - 245_000,
        updated_at: now - 245_000
      }
    ]);

    await insertRows(client, "load_profiles", [
      {
        id: loadProfileId,
        project_id: projectId,
        name: "Gateway release gate",
        scenario_label: "Gateway health under release load",
        target_base_url: "https://gateway.example.test",
        environment_target_id: environmentId,
        engine: "synthetic",
        pattern: "steady",
        request_path: null,
        http_method: null,
        headers_json: null,
        body_template: null,
        execution_mode: "distributed",
        worker_count: 2,
        injector_pool_id: injectorPoolId,
        arrival_model: "closed",
        phase_plan_json: null,
        request_mix_json: null,
        evidence_policy_json: null,
        gate_policy_id: gatePolicyId,
        tags_json: '["release","gateway"]',
        baseline_run_id: baselineLoadRunId,
        virtual_users: 120,
        duration_sec: 180,
        ramp_up_sec: 30,
        target_rps: 220,
        thresholds_json: JSON.stringify({
          maxP95Ms: 500,
          maxErrorRatePct: 1.2,
          minThroughputRps: 180
        }),
        created_at: now - 300_000,
        updated_at: now - 300_000
      }
    ]);

    await insertRows(client, "load_runs", [
      {
        id: baselineLoadRunId,
        project_id: projectId,
        profile_id: loadProfileId,
        profile_name: "Gateway release gate",
        scenario_label: "Gateway health under release load",
        target_base_url: "https://gateway.example.test",
        environment_id: environmentId,
        engine: "synthetic",
        pattern: "steady",
        environment_label: "staging",
        status: "passed",
        verdict: "ship",
        source: "synthetic",
        metrics_json: toMetricsJson({
          p50Ms: 110,
          p95Ms: 240,
          p99Ms: 320,
          errorRatePct: 0.2,
          throughputRps: 242,
          peakVus: 120,
          requestCount: 43560,
          totalErrors: 87
        }),
        notes: "Pinned green baseline for release readiness.",
        engine_version: "synthetic-fixture",
        executor_label: "Distributed synthetic runner",
        raw_summary_path: "/platform-release/baseline-summary.json",
        compare_baseline_run_id: null,
        started_at: now - 190_000,
        ended_at: now - 186_000,
        created_at: now - 192_000
      },
      {
        id: loadRunId,
        project_id: projectId,
        profile_id: loadProfileId,
        profile_name: "Gateway release gate",
        scenario_label: "Gateway health under release load",
        target_base_url: "https://gateway.example.test",
        environment_id: environmentId,
        engine: "synthetic",
        pattern: "steady",
        environment_label: "staging",
        status: "failed",
        verdict: "hold",
        source: "synthetic",
        metrics_json: toMetricsJson({
          p50Ms: 330,
          p95Ms: 780,
          p99Ms: 910,
          errorRatePct: 2.3,
          throughputRps: 146,
          peakVus: 120,
          requestCount: 26280,
          totalErrors: 604
        }),
        notes: "Gateway latency regressed after the latest cache rollout.",
        engine_version: "synthetic-fixture",
        executor_label: "Distributed synthetic runner",
        raw_summary_path: "/platform-release/candidate-summary.json",
        compare_baseline_run_id: baselineLoadRunId,
        started_at: now - 150_000,
        ended_at: now - 146_000,
        created_at: now - 152_000
      },
      {
        id: newerLoadRunId,
        project_id: projectId,
        profile_id: loadProfileId,
        profile_name: "Gateway release gate",
        scenario_label: "Gateway health under release load",
        target_base_url: "https://gateway.example.test",
        environment_id: environmentId,
        engine: "synthetic",
        pattern: "steady",
        environment_label: "staging",
        status: "passed",
        verdict: "ship",
        source: "synthetic",
        metrics_json: toMetricsJson({
          p50Ms: 130,
          p95Ms: 260,
          p99Ms: 340,
          errorRatePct: 0.3,
          throughputRps: 238,
          peakVus: 120,
          requestCount: 42840,
          totalErrors: 129
        }),
        notes: "A newer recovery run exists but is not yet bound to this release.",
        engine_version: "synthetic-fixture",
        executor_label: "Distributed synthetic runner",
        raw_summary_path: "/platform-release/baseline-summary.json",
        compare_baseline_run_id: baselineLoadRunId,
        started_at: now - 70_000,
        ended_at: now - 66_000,
        created_at: now - 72_000
      }
    ]);

    await insertRows(client, "load_run_workers", [
      {
        id: "load-worker-green-1",
        run_id: baselineLoadRunId,
        worker_index: 1,
        worker_label: "worker-1",
        injector_pool_id: injectorPoolId,
        injector_worker_id: "injector-release-1",
        status: "passed",
        metrics_json: toMetricsJson({
          p50Ms: 108,
          p95Ms: 238,
          p99Ms: 315,
          errorRatePct: 0.2,
          throughputRps: 122,
          peakVus: 60,
          requestCount: 21780,
          totalErrors: 44
        }),
        notes: "Healthy shard baseline.",
        engine_version: "synthetic-fixture",
        executor_label: "Synthetic shard",
        raw_summary_path: "/platform-release/baseline-summary.json",
        started_at: now - 190_000,
        ended_at: now - 186_000,
        created_at: now - 192_000
      },
      {
        id: "load-worker-green-2",
        run_id: baselineLoadRunId,
        worker_index: 2,
        worker_label: "worker-2",
        injector_pool_id: injectorPoolId,
        injector_worker_id: "injector-release-2",
        status: "passed",
        metrics_json: toMetricsJson({
          p50Ms: 112,
          p95Ms: 242,
          p99Ms: 325,
          errorRatePct: 0.2,
          throughputRps: 120,
          peakVus: 60,
          requestCount: 21780,
          totalErrors: 43
        }),
        notes: "Healthy shard baseline.",
        engine_version: "synthetic-fixture",
        executor_label: "Synthetic shard",
        raw_summary_path: "/platform-release/baseline-summary.json",
        started_at: now - 190_000,
        ended_at: now - 186_000,
        created_at: now - 192_000
      },
      {
        id: "load-worker-red-1",
        run_id: loadRunId,
        worker_index: 1,
        worker_label: "worker-1",
        injector_pool_id: injectorPoolId,
        injector_worker_id: "injector-release-1",
        status: "failed",
        metrics_json: toMetricsJson({
          p50Ms: 320,
          p95Ms: 760,
          p99Ms: 900,
          errorRatePct: 2.1,
          throughputRps: 72,
          peakVus: 60,
          requestCount: 13140,
          totalErrors: 281
        }),
        notes: "Latency regression on shard one.",
        engine_version: "synthetic-fixture",
        executor_label: "Synthetic shard",
        raw_summary_path: "/platform-release/candidate-summary.json",
        started_at: now - 150_000,
        ended_at: now - 146_000,
        created_at: now - 152_000
      },
      {
        id: "load-worker-red-2",
        run_id: loadRunId,
        worker_index: 2,
        worker_label: "worker-2",
        injector_pool_id: injectorPoolId,
        injector_worker_id: "injector-release-2",
        status: "failed",
        metrics_json: toMetricsJson({
          p50Ms: 340,
          p95Ms: 800,
          p99Ms: 920,
          errorRatePct: 2.5,
          throughputRps: 74,
          peakVus: 60,
          requestCount: 13140,
          totalErrors: 323
        }),
        notes: "Latency regression on shard two.",
        engine_version: "synthetic-fixture",
        executor_label: "Synthetic shard",
        raw_summary_path: "/platform-release/candidate-summary.json",
        started_at: now - 150_000,
        ended_at: now - 146_000,
        created_at: now - 152_000
      }
    ]);

    await insertRows(client, "load_run_sample_windows", [
      sampleWindowRow({
        id: "release-baseline-sample-1",
        runId: baselineLoadRunId,
        ts: now - 189_000,
        p95Ms: 228,
        errorRatePct: 0.2,
        throughputRps: 236,
        activeWorkers: 2
      }),
      sampleWindowRow({
        id: "release-baseline-sample-2",
        runId: baselineLoadRunId,
        ts: now - 188_500,
        p95Ms: 240,
        errorRatePct: 0.2,
        throughputRps: 242,
        activeWorkers: 2
      }),
      sampleWindowRow({
        id: "release-candidate-sample-1",
        runId: loadRunId,
        ts: now - 149_000,
        p95Ms: 700,
        errorRatePct: 1.9,
        throughputRps: 162,
        activeWorkers: 2,
        note: "Regression begins."
      }),
      sampleWindowRow({
        id: "release-candidate-sample-2",
        runId: loadRunId,
        ts: now - 148_500,
        p95Ms: 780,
        errorRatePct: 2.3,
        throughputRps: 146,
        activeWorkers: 2,
        note: "Release threshold breached."
      })
    ]);

    await insertRows(client, "release_candidates", [
      {
        id: releaseId,
        project_id: projectId,
        environment_id: environmentId,
        gate_policy_id: gatePolicyId,
        name: "2026.04.21 candidate",
        build_label: "build-2026-04-21.3",
        build_id: releaseBuildId,
        commit_sha: releaseCommitSha,
        source_run_ids_json: JSON.stringify([functionalRunId]),
        source_load_run_ids_json: JSON.stringify([loadRunId]),
        status: "hold",
        notes: "Latency regression must be waived or fixed before ship.",
        created_at: now - 120_000,
        updated_at: now - 118_000
      }
    ]);

    await insertRows(client, "release_gate_results", [
      {
        id: releaseGateResultId,
        release_id: releaseId,
        verdict: "hold",
        summary: "Release evidence contains blocking signals that should stop promotion.",
        blockers_json: JSON.stringify(["Gateway release gate"]),
        signals_json: JSON.stringify([
          {
            id: "functional:Core login",
            kind: "functional",
            status: "passed",
            label: "Core login",
            detail: `Latest matching run ${functionalRunId} passed.`,
            sourceId: functionalRunId
          },
          {
            id: "benchmark:coverage",
            kind: "benchmark",
            status: "passed",
            label: "Benchmark coverage",
            detail: "Coverage 100.0% vs required 100.0%."
          },
          {
            id: "benchmark:pass-rate",
            kind: "benchmark",
            status: "passed",
            label: "Benchmark pass rate",
            detail: "Pass rate 100.0% vs required 100.0%."
          },
          {
            id: `load:${loadProfileId}`,
            kind: "load",
            status: "failed",
            label: "Gateway release gate",
            detail: `Latest run ${loadRunId} produced HOLD in staging.`,
            sourceId: loadRunId
          }
        ]),
        waiver_count: 0,
        evaluated_at: now - 116_000
      }
    ]);

    await insertRows(client, "waivers", [
      {
        id: initialWaiverId,
        release_id: releaseId,
        blocker_key: `load:${loadProfileId}`,
        reason: "Expired mitigation window from the previous release train.",
        requested_by: "release-manager",
        approved_by: "release-manager",
        expires_at: now - 60_000,
        status: "expired",
        created_at: now - 108_000,
        updated_at: now - 60_000
      }
    ]);

    await insertRows(client, "approval_events", [
      {
        id: initialApprovalId,
        release_id: releaseId,
        waiver_id: null,
        actor: "qa-lead",
        role: "qa-lead",
        action: "release_reviewed",
        detail: "Reviewed the release evidence and requested mitigation before ship.",
        created_at: now - 104_000
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

const expectOneOfTexts = async (
  scope: import("playwright").Page | import("playwright").Locator,
  texts: string[]
): Promise<void> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 15_000) {
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
    "鍙戝竷",
    "闃诲",
    "璇█",
    "鏆傛棤",
    "鍘嬫祴",
    "姝ｅ湪",
    "鏃堕棿",
    "鏍稿績"
  ];
  const hit = suspiciousFragments.find((fragment) => pageText.includes(fragment));
  if (hit) {
    throw new Error(`Detected mojibake fragment on page: ${hit}`);
  }
};

const run = async (): Promise<void> => {
  await seedFixture();
  console.log("[release-gates] seeded fixture");

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
      "4180",
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
    console.log("[release-gates] runtime and web are ready");

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      baseURL: webBaseUrl,
      locale: "en-US",
      viewport: { width: 1440, height: 1200 }
    });
    await context.addInitScript(() => {
      window.localStorage.setItem("qpilot.language.v1", "en");
    });
    const page = await context.newPage();

    await registerFixtureUser(page, {
      email: fixtureEmail,
      password: fixturePassword,
      displayName: "Release Gates Owner",
      tenantName: "Release Gates Workspace",
      redirectPath: "/projects"
    });
    const releaseSubmitToken = await createApiTokenFromPage(page, runtimeBaseUrl, {
      label: "Release submit fixture token",
      scopes: ["release:create", "gate:read"]
    });

    runCommandCapture({
      cwd: workspaceRoot,
      args: [
        "--filter",
        "@qpilot/runtime",
        "run",
        "release:submit",
        "--",
        "--runtime-base-url",
        runtimeBaseUrl,
        "--api-token",
        releaseSubmitToken.plainTextToken,
        "--project-id",
        projectId,
        "--environment-id",
        environmentId,
        "--gate-policy-id",
        gatePolicyId,
        "--name",
        scriptReleaseName,
        "--build-label",
        scriptReleaseBuildLabel,
        "--build-id",
        scriptReleaseBuildId,
        "--commit-sha",
        scriptReleaseCommitSha,
        "--source-run-id",
        functionalRunId,
        "--source-load-run-id",
        newerLoadRunId,
        "--notes",
        "Created from the release submit script during fixture verification.",
        "--required-verdict",
        "watch",
        "--output-file",
        scriptReleaseOutputPath
      ]
    });

    const scriptReleaseResult = JSON.parse(
      await readFile(scriptReleaseOutputPath, "utf8")
    ) as {
      release: { id: string };
      gate?: { verdict: string };
      satisfiedRequiredVerdict: boolean;
    };

    if (!scriptReleaseResult.satisfiedRequiredVerdict) {
      throw new Error("Expected the release submit script to satisfy the required verdict.");
    }

    const scriptReleaseId = scriptReleaseResult.release.id;
    const scriptReleaseVerdict = scriptReleaseResult.gate?.verdict ?? "draft";

    await page.goto("/platform/control", { waitUntil: "domcontentloaded" });
    await expectText(page, "2026.04.21 candidate");
    await expectText(page, "Open detail");
    await page.screenshot({
      path: resolve(screenshotRoot, "control-tower-release-entry.png"),
      fullPage: true
    });

    const initialControlTowerReleaseCard = page
      .locator("div.rounded-2xl")
      .filter({ hasText: "2026.04.21 candidate" })
      .first();
    await initialControlTowerReleaseCard.getByRole("link", { name: "Open detail" }).click();
    await expectText(page, "Gate verdict");
    await expectText(page, "Release evidence");
    await expectText(page, "Approval timeline");
    await expectText(page, "Policy snapshot");
    await expectText(page, "Nearby queue");
    await expectText(page, releaseBuildId);
    await expectText(page, releaseCommitSha);
    await expectText(page, functionalRunId);
    await expectText(page, loadRunId);
    await page.screenshot({
      path: resolve(screenshotRoot, "release-detail-overview.png"),
      fullPage: true
    });
    await expectText(page, "Core login");
    await expectText(page, "Gateway release gate");
    await page.screenshot({
      path: resolve(screenshotRoot, "release-detail-signals.png"),
      fullPage: true
    });

    await page.getByRole("link", { name: "Open source run" }).click();
    await expectText(page, "This run finished successfully.");
    await page.goBack({ waitUntil: "domcontentloaded" });
    await expectText(page, "Release evidence");

    await page.getByRole("link", { name: "Open load run" }).click();
    await expectText(page, "Retry this run");
    await expectText(page, "Gateway release gate");
    await page.goBack({ waitUntil: "domcontentloaded" });
    await expectText(page, "Blockers and waivers");

    await page.getByRole("button", { name: "Apply waiver" }).first().click();
    await expectText(page, "Temporarily acknowledge a blocker with an explicit reason.");
    const waiverDrawer = page.locator("div.fixed");
    await waiverDrawer.locator("textarea").fill(
      "Approved temporary waiver while the cache mitigation finishes rollout."
    );
    await waiverDrawer.locator("input").first().fill("release-director");
    await waiverDrawer.getByRole("button", { name: "Apply waiver" }).last().click();
    await expectText(page, "Approved temporary waiver while the cache mitigation finishes rollout.");
    await page.screenshot({
      path: resolve(screenshotRoot, "release-detail-waiver.png"),
      fullPage: true
    });

    await page.getByRole("button", { name: "Record approval" }).first().click();
    await expectText(page, "Create an explicit approval event for this release.");
    const approvalDrawer = page.locator("div.fixed");
    await approvalDrawer.locator("input").nth(0).fill("release-director");
    await approvalDrawer.locator("input").nth(1).fill("release-manager");
    await approvalDrawer
      .locator("textarea")
      .fill("Approved after reviewing the mitigation owner, load evidence, and waiver.");
    await approvalDrawer.getByRole("button", { name: "Record approval" }).last().click();
    await expectText(page, "release-director");
    await expectText(page, "Approved after reviewing the mitigation owner, load evidence, and waiver.");
    await page.screenshot({
      path: resolve(screenshotRoot, "release-detail-approval.png"),
      fullPage: true
    });

    await page.goto("/platform/gates", { waitUntil: "domcontentloaded" });
    await expectText(page, "Release candidates");
    await expectText(page, "2026.04.21 candidate");
    const initialReleaseRow = page
      .locator("tr")
      .filter({ hasText: "2026.04.21 candidate" })
      .first();
    await initialReleaseRow.getByRole("button", { name: "Inspect" }).click();
    await expectText(page, "Gate inputs");
    await expectText(page, "Approval timeline");
    await expectText(page, "Open detail page");
    await page.screenshot({
      path: resolve(screenshotRoot, "gate-center-release-entry.png"),
      fullPage: true
    });

    await page.getByRole("link", { name: "Open detail page" }).click();
    await expectText(page, "Metadata");
    await expectText(page, "Policy snapshot");
    await expectText(page, "Approval timeline");
    await expectText(page, releaseBuildId);
    await expectText(page, releaseCommitSha);

    await page.goto("/platform/gates", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Create release" }).click();
    await expectText(page, "Use latest evidence bundle");
    await expectText(page, "Recent functional evidence");
    await expectText(page, "Recent load evidence");
    const createReleaseDrawer = page.locator("div.fixed");
    await createReleaseDrawer.locator("input").nth(0).fill(helperReleaseName);
    await createReleaseDrawer.locator("input").nth(2).fill(helperReleaseBuildId);
    await createReleaseDrawer.locator("input").nth(3).fill(helperReleaseCommitSha);
    await createReleaseDrawer.getByRole("button", { name: "Use latest evidence bundle" }).click();
    const helperFunctionalBindings = (await createReleaseDrawer.locator("textarea").nth(0).inputValue())
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    const helperLoadBindings = (await createReleaseDrawer.locator("textarea").nth(1).inputValue())
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (helperFunctionalBindings.length === 0 || helperLoadBindings.length === 0) {
      throw new Error("Expected the release helper actions to bind both functional and load evidence.");
    }
    await createReleaseDrawer
      .locator("textarea")
      .nth(2)
      .fill("Created from Gate Center helper actions to bind the latest verified evidence.");
    await page.screenshot({
      path: resolve(screenshotRoot, "release-create-helper.png"),
      fullPage: true
    });
    await page.getByRole("button", { name: "Save release" }).last().click();
    await expectText(page, helperReleaseName);
    await expectText(page, "Open detail page");
    await page.getByRole("link", { name: "Open detail page" }).click();
    await expectText(page, helperReleaseName);
    await expectText(page, helperReleaseBuildId);
    await expectText(page, helperReleaseCommitSha);
    for (const bindingId of helperFunctionalBindings) {
      await expectText(page, bindingId);
    }
    for (const bindingId of helperLoadBindings) {
      await expectText(page, bindingId);
    }

    await page.goto(`/platform/releases/${scriptReleaseId}`, { waitUntil: "domcontentloaded" });
    await expectText(page, scriptReleaseName);
    await expectText(page, scriptReleaseBuildId);
    await expectText(page, scriptReleaseCommitSha);
    await expectText(page, functionalRunId);
    await expectText(page, newerLoadRunId);
    await page.screenshot({
      path: resolve(screenshotRoot, "release-detail-script.png"),
      fullPage: true
    });

    await page.getByRole("button", { name: "\u4e2d\u6587" }).click();
    await sleep(300);
    await expectOneOfTexts(page, ["\u53d1\u5e03\u8be6\u60c5", "Release Detail"]);
    await expectOneOfTexts(page, ["\u95e8\u7981\u7ed3\u8bba", "Gate verdict"]);
    await expectOneOfTexts(page, ["\u53d1\u5e03\u8bc1\u636e", "Release evidence"]);
    await expectOneOfTexts(page, ["\u7b56\u7565\u5feb\u7167", "Policy snapshot"]);
    await expectOneOfTexts(page, ["\u76f8\u90bb\u961f\u5217", "Nearby queue"]);
    await expectOneOfTexts(page, ["\u6253\u5f00\u6e90\u8fd0\u884c", "Open source run"]);
    await assertNoMojibake(page);

    await page.goto("/platform/control", { waitUntil: "domcontentloaded" });
    await expectOneOfTexts(page, ["\u6253\u5f00\u8be6\u60c5", "Open detail"]);
    await assertNoMojibake(page);

    await page.goto("/platform/gates", { waitUntil: "domcontentloaded" });
    const initialReleaseRowZh = page
      .locator("tr")
      .filter({ hasText: "2026.04.21 candidate" })
      .first();
    await initialReleaseRowZh.getByRole("button", { name: "Inspect" }).click();
    await expectOneOfTexts(page, ["\u6253\u5f00\u8be6\u60c5\u9875", "Open detail page"]);
    await assertNoMojibake(page);
    await page.goto(`/platform/releases/${releaseId}`, { waitUntil: "domcontentloaded" });
    await expectOneOfTexts(page, ["\u53d1\u5e03\u8be6\u60c5", "Release Detail"]);
    await page.screenshot({
      path: resolve(screenshotRoot, "release-detail-zh.png"),
      fullPage: true
    });

    await writeFile(
      observationsPath,
      JSON.stringify(
        {
          releaseId,
          projectId,
          environmentId,
          authEmail: fixtureEmail,
          buildId: releaseBuildId,
          commitSha: releaseCommitSha,
          functionalSourceRunId: functionalRunId,
          loadSourceRunId: loadRunId,
          scriptReleaseId,
          scriptReleaseName,
          scriptReleaseBuildLabel,
          scriptReleaseBuildId,
          scriptReleaseCommitSha,
          scriptReleaseVerdict,
          releaseSubmitTokenId: releaseSubmitToken.apiToken.id,
          releaseSubmitTokenScopes: releaseSubmitToken.apiToken.scopes,
          helperReleaseName,
          helperReleaseBuildId,
          helperReleaseCommitSha,
          helperFunctionalBindings,
          helperLoadBindings,
          ignoredLatestFunctionalRunId: newerFunctionalRunId,
          ignoredLatestLoadRunId: newerLoadRunId,
          baselineLoadRunId,
          screenshots: {
            controlTowerEntry: resolve(screenshotRoot, "control-tower-release-entry.png"),
            gateCenterEntry: resolve(screenshotRoot, "gate-center-release-entry.png"),
            releaseOverview: resolve(screenshotRoot, "release-detail-overview.png"),
            releaseSignals: resolve(screenshotRoot, "release-detail-signals.png"),
            waiver: resolve(screenshotRoot, "release-detail-waiver.png"),
            approval: resolve(screenshotRoot, "release-detail-approval.png"),
            scriptRelease: resolve(screenshotRoot, "release-detail-script.png"),
            helperCreate: resolve(screenshotRoot, "release-create-helper.png"),
            chinese: resolve(screenshotRoot, "release-detail-zh.png")
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
  .then(async () => {
    await writeFile(
      resolve(outputRoot, "e2e-status.txt"),
      "release-gates.e2e.ts finished successfully.\n",
      "utf8"
    );
    console.log(`Release gates E2E fixture completed. Output: ${outputRoot}`);
  })
  .catch(async (error) => {
    await writeFile(
      resolve(outputRoot, "e2e-status.txt"),
      `release-gates.e2e.ts failed.\n${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
      "utf8"
    );
    console.error(error);
    process.exit(1);
  });
