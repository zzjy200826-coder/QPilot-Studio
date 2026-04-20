import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../runtime/node_modules/playwright/index.mjs";
import { createClient } from "../../runtime/node_modules/@libsql/client/lib-esm/node.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const workspaceRoot = resolve(currentDir, "..", "..", "..");
const outputRoot = resolve(workspaceRoot, "output", "e2e", "console-review");
const runtimeBaseUrl = "http://127.0.0.1:8878";
const webBaseUrl = "http://127.0.0.1:4178";
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

const projectId = "proj-mailbox";
const freshProjectName = "E2E Fresh Project";
const sourceRunId = "run-mailbox-source";
const baselineRunId = "run-mailbox-rerun-baseline";
const candidateRunId = "run-mailbox-rerun-success";
const mailboxCaseId = "case-mailbox-recovery";
const uncoveredCaseId = "case-admin-audit";
const targetUrl = "https://mail.example.test/login";
const now = Date.now();

interface ManagedProcess {
  close: () => Promise<void>;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });

const svgCard = (input: {
  title: string;
  subtitle: string;
  accent: string;
  detail?: string;
}): string => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#eff6ff" />
      <stop offset="100%" stop-color="#f8fafc" />
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)" />
  <rect x="88" y="92" width="1104" height="536" rx="32" fill="#ffffff" stroke="#cbd5e1" stroke-width="3" />
  <rect x="136" y="146" width="220" height="12" rx="6" fill="${input.accent}" opacity="0.35" />
  <text x="136" y="238" font-size="52" font-family="Segoe UI, Arial, sans-serif" font-weight="700" fill="#0f172a">${input.title}</text>
  <text x="136" y="306" font-size="28" font-family="Segoe UI, Arial, sans-serif" fill="#334155">${input.subtitle}</text>
  <text x="136" y="392" font-size="22" font-family="Segoe UI, Arial, sans-serif" fill="#64748b">${input.detail ?? ""}</text>
  <rect x="136" y="470" width="264" height="56" rx="18" fill="${input.accent}" opacity="0.14" />
  <text x="168" y="506" font-size="24" font-family="Segoe UI, Arial, sans-serif" font-weight="600" fill="${input.accent}">Fixture Screenshot</text>
</svg>
`;

const runtimeConfig = (overrides?: {
  goal?: string;
  replayCase?: {
    templateId: string;
    title: string;
    type: "ui" | "hybrid";
  };
}) => ({
  targetUrl,
  mode: "login",
  language: "en",
  executionMode: "auto_batch",
  confirmDraft: false,
  goal:
    overrides?.goal ??
    "Validate that the mailbox recovery journey can reach the authenticated shell.",
  maxSteps: 18,
  headed: true,
  manualTakeover: true,
  sessionProfile: "mailbox-fixture",
  saveSession: true,
  replayCase: overrides?.replayCase
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
  stage:
    | "target_site"
    | "provider_auth"
    | "credential_form"
    | "authenticated_app"
    | "security_challenge";
  authErrorText?: string;
  failureCategory?:
    | "locator_miss"
    | "element_not_interactable"
    | "wrong_target"
    | "no_effect"
    | "api_mismatch"
    | "security_challenge"
    | "blocked_high_risk"
    | "unexpected_runtime";
  failureSuggestion?: string;
  failureReason?: string;
  templateReplay?: {
    stepIndex: number;
    stepCount: number;
    outcome: "matched" | "drifted" | "recovered";
  };
  apiStatus?: "passed" | "failed" | "neutral";
  keyRequest?: {
    method: string;
    url: string;
    status: number;
    ok: boolean;
    phase: "response" | "failed";
    bodyPreview?: string;
  };
}) =>
  JSON.stringify({
    urlChanged: true,
    checks: [
      {
        expected:
          input.stage === "authenticated_app" ? "mailbox shell visible" : "checkpoint advanced",
        found: input.passed
      }
    ],
    pageState: {
      surface: input.stage,
      hasModal: false,
      hasIframe: input.stage === "provider_auth" || input.stage === "credential_form",
      frameCount:
        input.stage === "provider_auth" || input.stage === "credential_form" ? 1 : 0,
      hasLoginForm: input.stage === "credential_form",
      hasProviderChooser: input.stage === "provider_auth",
      hasSearchResults: false,
      matchedSignals:
        input.stage === "authenticated_app"
          ? ["mailbox-shell", "inbox"]
          : input.stage === "security_challenge"
            ? ["captcha", "checkpoint"]
            : ["fixture"],
      primaryContext:
        input.stage === "authenticated_app"
          ? "Mailbox shell"
          : input.stage === "security_challenge"
            ? "Consent challenge"
            : "Recovery form",
      authErrorText: input.authErrorText
    },
    api: {
      status: input.apiStatus ?? (input.passed ? "passed" : "failed"),
      requestCount: input.keyRequest ? 2 : 0,
      matchedRequestCount: input.keyRequest?.ok ? 1 : 0,
      failedRequestCount: input.keyRequest && !input.keyRequest.ok ? 1 : 0,
      expectedRequestCount: input.keyRequest ? 1 : 0,
      tokenSignals: input.keyRequest?.ok ? 1 : 0,
      sessionSignals: input.keyRequest?.ok ? 1 : 0,
      hostTransition: {
        from: "mail.example.test",
        to: input.stage === "authenticated_app" ? "mail.example.test" : "auth.example.test",
        changed: input.stage !== "authenticated_app"
      },
      note: input.note,
      keyRequests: input.keyRequest
        ? [
            {
              method: input.keyRequest.method,
              url: input.keyRequest.url,
              host: new URL(input.keyRequest.url).host,
              pathname: new URL(input.keyRequest.url).pathname,
              resourceType: "xhr",
              status: input.keyRequest.status,
              ok: input.keyRequest.ok,
              phase: input.keyRequest.phase,
              contentType: "application/json",
              bodyPreview: input.keyRequest.bodyPreview
            }
          ]
        : []
    },
    execution: {
      targetUsed: "#fixture-target",
      resolutionMethod: "dom_selector",
      failureCategory: input.failureCategory,
      failureSuggestion: input.failureSuggestion,
      failureReason: input.failureReason,
      templateReplay: input.templateReplay
        ? {
            templateId: mailboxCaseId,
            templateTitle: "Mailbox recovery replay",
            templateType: "hybrid",
            stepIndex: input.templateReplay.stepIndex,
            stepCount: input.templateReplay.stepCount,
            outcome: input.templateReplay.outcome
          }
        : undefined
    },
    outcome: input.outcome,
    workingMemory: {
      stage: input.stage,
      alignment: input.stage === "authenticated_app" ? "aligned" : "intermediate_auth",
      transitionReason:
        input.stage === "provider_auth"
          ? "provider_auth"
          : input.stage === "credential_form"
            ? "credential_form"
            : input.stage === "security_challenge"
              ? "security_challenge"
              : input.stage === "authenticated_app"
                ? "authenticated_app"
                : "target_site",
      goalAnchors: ["mailbox", "recovery", "login"],
      avoidHosts: [],
      avoidLabels: [],
      blockedStage: input.stage === "security_challenge" ? "security_challenge" : undefined,
      avoidRepeatCredentialSubmission: input.stage === "security_challenge",
      lastOutcome: input.outcome,
      lastStepUrl:
        input.stage === "authenticated_app"
          ? "https://mail.example.test/app"
          : "https://auth.example.test/checkpoint",
      successSignals: input.stage === "authenticated_app" ? ["mailbox-shell"] : []
    },
    passed: input.passed,
    note: input.note
  });

const domSummary = (label: string) =>
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

const action = (type: string, target: string, note: string, value?: string) =>
  JSON.stringify({
    type,
    target,
    value,
    note
  });

const reportHtml = (title: string, summary: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body { font-family: "Segoe UI", Arial, sans-serif; margin: 48px; color: #0f172a; }
      h1 { font-size: 32px; margin-bottom: 16px; }
      p { font-size: 16px; line-height: 1.7; max-width: 72ch; }
      .chip { display: inline-block; margin-top: 16px; padding: 6px 12px; border-radius: 999px; background: #e0f2fe; color: #0369a1; font-weight: 600; }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    <p>${summary}</p>
    <span class="chip">Fixture Report</span>
  </body>
</html>
`;

const placeholderWorkbook = "Fixture workbook placeholder";

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

const migrateFixtureDatabase = async (
  client: ReturnType<typeof createClient>
): Promise<void> => {
  const statements = [
    `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      username_cipher TEXT,
      username_iv TEXT,
      username_tag TEXT,
      password_cipher TEXT,
      password_iv TEXT,
      password_tag TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id),
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      target_url TEXT NOT NULL,
      goal TEXT NOT NULL,
      model TEXT,
      config_json TEXT NOT NULL,
      startup_page_url TEXT,
      startup_page_title TEXT,
      startup_screenshot_path TEXT,
      startup_observation TEXT,
      challenge_kind TEXT,
      challenge_reason TEXT,
      recorded_video_path TEXT,
      llm_last_json TEXT,
      error_message TEXT,
      started_at INTEGER,
      ended_at INTEGER,
      created_at INTEGER NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS steps (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL REFERENCES runs(id),
      step_index INTEGER NOT NULL,
      page_url TEXT NOT NULL,
      page_title TEXT NOT NULL,
      dom_summary_json TEXT NOT NULL,
      screenshot_path TEXT NOT NULL,
      action_json TEXT NOT NULL,
      action_status TEXT NOT NULL,
      observation_summary TEXT NOT NULL,
      verification_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS test_cases (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL REFERENCES runs(id),
      module TEXT NOT NULL,
      title TEXT NOT NULL,
      preconditions TEXT,
      steps_json TEXT NOT NULL,
      expected TEXT,
      actual TEXT,
      status TEXT NOT NULL,
      priority TEXT,
      method TEXT,
      created_at INTEGER NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS reports (
      run_id TEXT PRIMARY KEY NOT NULL REFERENCES runs(id),
      html_path TEXT NOT NULL,
      xlsx_path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS case_templates (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id),
      run_id TEXT NOT NULL REFERENCES runs(id),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      goal TEXT NOT NULL,
      entry_url TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT,
      case_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );`
  ];

  for (const sql of statements) {
    await client.execute(sql);
  }
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
  const command =
    process.platform === "win32" ? "cmd.exe" : pnpmCommand;
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

const seedFixture = async (): Promise<void> => {
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });
  mkdirSync(screenshotRoot, { recursive: true });

  const client = createClient({
    url: `file:${databasePath}`
  });
  await migrateFixtureDatabase(client);
  try {
    await insertRows(client, "projects", [
      {
        id: projectId,
        name: "Mailbox QA Demo",
        base_url: targetUrl,
        username_cipher: null,
        username_iv: null,
        username_tag: null,
        password_cipher: null,
        password_iv: null,
        password_tag: null,
        created_at: now - 90_000,
        updated_at: now - 90_000
      }
    ]);

    await writeRuntimeFile(
      resolve(artifactsRoot, "runs", sourceRunId, "startup.svg"),
      svgCard({
        title: "Mailbox template source",
        subtitle: "Stable login flow used to extract the replay template.",
        accent: "#0ea5e9",
        detail: "Source run"
      })
    );
    await writeRuntimeFile(
      resolve(artifactsRoot, "runs", baselineRunId, "startup.svg"),
      svgCard({
        title: "Consent wall blocks progress",
        subtitle: "Baseline replay stops before the authenticated shell.",
        accent: "#f97316",
        detail: "Baseline failed replay"
      })
    );
    await writeRuntimeFile(
      resolve(artifactsRoot, "runs", candidateRunId, "startup.svg"),
      svgCard({
        title: "Mailbox shell recovered",
        subtitle: "Candidate replay reaches the authenticated inbox shell.",
        accent: "#10b981",
        detail: "Successful rerun"
      })
    );

    for (const [runId, stepIndex, title, subtitle, accent] of [
      [sourceRunId, 1, "Open mailbox login", "Source flow step 1", "#0ea5e9"],
      [sourceRunId, 2, "Mailbox shell ready", "Source flow step 2", "#0ea5e9"],
      [baselineRunId, 1, "Recovery email submitted", "Baseline step 1", "#f59e0b"],
      [baselineRunId, 2, "SSO handoff opened", "Baseline step 2", "#f59e0b"],
      [baselineRunId, 3, "Consent challenge appears", "Baseline step 3", "#fb7185"],
      [baselineRunId, 4, "Checkpoint blocks finish", "Baseline step 4", "#ef4444"],
      [candidateRunId, 1, "Recovery email submitted", "Candidate step 1", "#0ea5e9"],
      [candidateRunId, 2, "SSO handoff opened", "Candidate step 2", "#0ea5e9"],
      [candidateRunId, 3, "OTP form visible", "Candidate step 3", "#0ea5e9"],
      [candidateRunId, 4, "OTP accepted", "Candidate step 4", "#14b8a6"],
      [candidateRunId, 5, "Mailbox shell ready", "Candidate step 5", "#10b981"]
    ] as const) {
      await writeRuntimeFile(
        resolve(
          artifactsRoot,
          "runs",
          runId,
          `step-${String(stepIndex).padStart(4, "0")}.svg`
        ),
        svgCard({
          title,
          subtitle,
          accent,
          detail: `${runId} step ${stepIndex}`
        })
      );
    }

    await writeRuntimeFile(
      resolve(reportsRoot, "candidate-report.html"),
      reportHtml(
        "Mailbox recovery rerun report",
        "The candidate replay recovered the mailbox flow after the baseline stalled on a consent challenge."
      )
    );
    await writeRuntimeFile(resolve(reportsRoot, "candidate-report.xlsx"), placeholderWorkbook);

    await insertRows(client, "runs", [
      {
        id: sourceRunId,
        project_id: projectId,
        status: "passed",
        mode: "login",
        target_url: targetUrl,
        goal: "Stable login template extraction run",
        model: "fixture",
        config_json: JSON.stringify(
          runtimeConfig({
            goal: "Capture the stable mailbox login flow and extract a replay template."
          })
        ),
        startup_page_url: targetUrl,
        startup_page_title: "Mailbox sign in",
        startup_screenshot_path: "/artifacts/runs/run-mailbox-source/startup.svg",
        startup_observation: "Source run captured the stable mailbox login shell.",
        challenge_kind: null,
        challenge_reason: null,
        recorded_video_path: null,
        llm_last_json: null,
        error_message: null,
        started_at: now - 70_000,
        ended_at: now - 60_000,
        created_at: now - 72_000
      },
      {
        id: baselineRunId,
        project_id: projectId,
        status: "failed",
        mode: "login",
        target_url: targetUrl,
        goal: "Recovery rerun stalls on consent challenge",
        model: "fixture",
        config_json: JSON.stringify(
          runtimeConfig({
            goal: "Replay the mailbox recovery journey and verify the authenticated shell.",
            replayCase: {
              templateId: mailboxCaseId,
              title: "Mailbox recovery replay",
              type: "hybrid"
            }
          })
        ),
        startup_page_url: targetUrl,
        startup_page_title: "Mailbox sign in",
        startup_screenshot_path: "/artifacts/runs/run-mailbox-rerun-baseline/startup.svg",
        startup_observation: "Baseline replay drifted into a consent challenge.",
        challenge_kind: "captcha",
        challenge_reason: "Consent wall required a human verification token.",
        recorded_video_path: null,
        llm_last_json: null,
        error_message: "Captcha challenge blocked the replayed recovery flow.",
        started_at: now - 50_000,
        ended_at: now - 42_000,
        created_at: now - 52_000
      },
      {
        id: candidateRunId,
        project_id: projectId,
        status: "passed",
        mode: "login",
        target_url: targetUrl,
        goal: "Recovery rerun reaches mailbox shell",
        model: "fixture",
        config_json: JSON.stringify(
          runtimeConfig({
            goal: "Replay the mailbox recovery journey and verify the authenticated shell.",
            replayCase: {
              templateId: mailboxCaseId,
              title: "Mailbox recovery replay",
              type: "hybrid"
            }
          })
        ),
        startup_page_url: targetUrl,
        startup_page_title: "Mailbox sign in",
        startup_screenshot_path: "/artifacts/runs/run-mailbox-rerun-success/startup.svg",
        startup_observation: "Candidate replay recovered the mailbox flow.",
        challenge_kind: null,
        challenge_reason: null,
        recorded_video_path: null,
        llm_last_json: null,
        error_message: null,
        started_at: now - 25_000,
        ended_at: now - 15_000,
        created_at: now - 28_000
      }
    ]);

    await insertRows(client, "steps", [
      {
        id: "step-source-1",
        run_id: sourceRunId,
        step_index: 1,
        page_url: targetUrl,
        page_title: "Mailbox sign in",
        dom_summary_json: domSummary("Open mailbox login"),
        screenshot_path: "/artifacts/runs/run-mailbox-source/step-0001.svg",
        action_json: action("navigate", targetUrl, "Open the mailbox login page."),
        action_status: "success",
        observation_summary: "Source run opened the mailbox login page.",
        verification_json: verification({
          passed: true,
          note: "The login page loaded cleanly.",
          outcome: "progressed",
          stage: "target_site",
          apiStatus: "neutral"
        }),
        created_at: now - 69_000
      },
      {
        id: "step-source-2",
        run_id: sourceRunId,
        step_index: 2,
        page_url: "https://mail.example.test/app",
        page_title: "Mailbox home",
        dom_summary_json: domSummary("Mailbox shell ready"),
        screenshot_path: "/artifacts/runs/run-mailbox-source/step-0002.svg",
        action_json: action("click", "button:has-text('Continue')", "Complete the stable login flow."),
        action_status: "success",
        observation_summary: "Source run reached the authenticated mailbox shell.",
        verification_json: verification({
          passed: true,
          note: "Inbox shell is visible and session bootstrap returned 200.",
          outcome: "terminal_success",
          stage: "authenticated_app",
          apiStatus: "passed",
          keyRequest: {
            method: "POST",
            url: "https://mail.example.test/api/session/bootstrap",
            status: 200,
            ok: true,
            phase: "response",
            bodyPreview: "{\"session\":\"active\"}"
          }
        }),
        created_at: now - 61_000
      },
      {
        id: "step-baseline-1",
        run_id: baselineRunId,
        step_index: 1,
        page_url: targetUrl,
        page_title: "Mailbox sign in",
        dom_summary_json: domSummary("Recovery email submitted"),
        screenshot_path: "/artifacts/runs/run-mailbox-rerun-baseline/step-0001.svg",
        action_json: action("input", "#email", "Fill the mailbox recovery account.", "fixture@example.test"),
        action_status: "success",
        observation_summary: "Baseline replay filled the recovery account field.",
        verification_json: verification({
          passed: true,
          note: "Email input accepted the recovery account.",
          outcome: "progressed",
          stage: "target_site",
          templateReplay: { stepIndex: 1, stepCount: 4, outcome: "matched" }
        }),
        created_at: now - 49_000
      },
      {
        id: "step-baseline-2",
        run_id: baselineRunId,
        step_index: 2,
        page_url: "https://auth.example.test/provider",
        page_title: "Provider handoff",
        dom_summary_json: domSummary("SSO handoff opened"),
        screenshot_path: "/artifacts/runs/run-mailbox-rerun-baseline/step-0002.svg",
        action_json: action("click", "button:has-text('Continue with SSO')", "Open the SSO provider handoff."),
        action_status: "success",
        observation_summary: "Baseline replay opened the provider handoff modal.",
        verification_json: verification({
          passed: true,
          note: "Provider handoff opened and reused the stored replay action.",
          outcome: "progressed",
          stage: "provider_auth",
          templateReplay: { stepIndex: 2, stepCount: 4, outcome: "matched" }
        }),
        created_at: now - 47_000
      },
      {
        id: "step-baseline-3",
        run_id: baselineRunId,
        step_index: 3,
        page_url: "https://auth.example.test/checkpoint",
        page_title: "Consent challenge",
        dom_summary_json: domSummary("Consent challenge appears"),
        screenshot_path: "/artifacts/runs/run-mailbox-rerun-baseline/step-0003.svg",
        action_json: action("wait", "checkpoint", "Wait for the consent screen to settle."),
        action_status: "success",
        observation_summary: "Baseline replay encountered a consent checkpoint that requested extra verification.",
        verification_json: verification({
          passed: false,
          note: "The consent checkpoint appeared instead of the mailbox shell.",
          outcome: "recoverable_failure",
          stage: "security_challenge",
          failureCategory: "security_challenge",
          failureSuggestion: "Resume from a visible session after solving the checkpoint.",
          failureReason: "Consent wall requested a human verification token.",
          templateReplay: { stepIndex: 3, stepCount: 4, outcome: "drifted" },
          apiStatus: "failed",
          keyRequest: {
            method: "POST",
            url: "https://auth.example.test/api/consent",
            status: 403,
            ok: false,
            phase: "response",
            bodyPreview: "{\"error\":\"captcha_required\"}"
          }
        }),
        created_at: now - 45_000
      },
      {
        id: "step-baseline-4",
        run_id: baselineRunId,
        step_index: 4,
        page_url: "https://auth.example.test/checkpoint",
        page_title: "Consent challenge",
        dom_summary_json: domSummary("Checkpoint blocks finish"),
        screenshot_path: "/artifacts/runs/run-mailbox-rerun-baseline/step-0004.svg",
        action_json: action("click", "button:has-text('Approve')", "Attempt to finish the consent step."),
        action_status: "failed",
        observation_summary: "Baseline replay could not finish because the checkpoint blocked further automation.",
        verification_json: verification({
          passed: false,
          note: "The consent wall blocked any further safe automation.",
          outcome: "blocking_failure",
          stage: "security_challenge",
          failureCategory: "security_challenge",
          failureSuggestion: "Do not keep clicking. Hand this checkpoint to a human and resume after it clears.",
          failureReason: "Approval button remained behind the consent challenge.",
          apiStatus: "failed",
          keyRequest: {
            method: "POST",
            url: "https://auth.example.test/api/consent",
            status: 403,
            ok: false,
            phase: "response",
            bodyPreview: "{\"error\":\"captcha_required\"}"
          }
        }),
        created_at: now - 43_000
      },
      {
        id: "step-candidate-1",
        run_id: candidateRunId,
        step_index: 1,
        page_url: targetUrl,
        page_title: "Mailbox sign in",
        dom_summary_json: domSummary("Recovery email submitted"),
        screenshot_path: "/artifacts/runs/run-mailbox-rerun-success/step-0001.svg",
        action_json: action("input", "#email", "Fill the mailbox recovery account.", "fixture@example.test"),
        action_status: "success",
        observation_summary: "Candidate replay filled the recovery account field.",
        verification_json: verification({
          passed: true,
          note: "Email input matched the replay template.",
          outcome: "progressed",
          stage: "target_site",
          templateReplay: { stepIndex: 1, stepCount: 5, outcome: "matched" }
        }),
        created_at: now - 24_000
      },
      {
        id: "step-candidate-2",
        run_id: candidateRunId,
        step_index: 2,
        page_url: "https://auth.example.test/provider",
        page_title: "Provider handoff",
        dom_summary_json: domSummary("SSO handoff opened"),
        screenshot_path: "/artifacts/runs/run-mailbox-rerun-success/step-0002.svg",
        action_json: action("click", "button:has-text('Continue with SSO')", "Open the SSO provider handoff."),
        action_status: "success",
        observation_summary: "Candidate replay opened the provider handoff.",
        verification_json: verification({
          passed: true,
          note: "Provider handoff stayed aligned with the replay template.",
          outcome: "progressed",
          stage: "provider_auth",
          templateReplay: { stepIndex: 2, stepCount: 5, outcome: "matched" }
        }),
        created_at: now - 22_000
      },
      {
        id: "step-candidate-3",
        run_id: candidateRunId,
        step_index: 3,
        page_url: "https://auth.example.test/otp",
        page_title: "Recovery verification",
        dom_summary_json: domSummary("OTP form visible"),
        screenshot_path: "/artifacts/runs/run-mailbox-rerun-success/step-0003.svg",
        action_json: action("input", "#otp", "Fill the recovery OTP.", "123456"),
        action_status: "success",
        observation_summary: "Candidate replay pivoted to the OTP form instead of the consent wall.",
        verification_json: verification({
          passed: true,
          note: "The rerun recovered by switching to the OTP form.",
          outcome: "progressed",
          stage: "credential_form",
          templateReplay: { stepIndex: 3, stepCount: 5, outcome: "recovered" }
        }),
        created_at: now - 20_000
      },
      {
        id: "step-candidate-4",
        run_id: candidateRunId,
        step_index: 4,
        page_url: "https://auth.example.test/otp",
        page_title: "Recovery verification",
        dom_summary_json: domSummary("OTP accepted"),
        screenshot_path: "/artifacts/runs/run-mailbox-rerun-success/step-0004.svg",
        action_json: action("click", "button:has-text('Verify')", "Submit the OTP challenge."),
        action_status: "success",
        observation_summary: "Candidate replay verified the OTP challenge and moved past the auth checkpoint.",
        verification_json: verification({
          passed: true,
          note: "OTP verification returned 200 and advanced the auth state.",
          outcome: "progressed",
          stage: "credential_form",
          templateReplay: { stepIndex: 4, stepCount: 5, outcome: "matched" },
          apiStatus: "passed",
          keyRequest: {
            method: "POST",
            url: "https://auth.example.test/api/verify-otp",
            status: 200,
            ok: true,
            phase: "response",
            bodyPreview: "{\"verified\":true}"
          }
        }),
        created_at: now - 18_000
      },
      {
        id: "step-candidate-5",
        run_id: candidateRunId,
        step_index: 5,
        page_url: "https://mail.example.test/app",
        page_title: "Mailbox home",
        dom_summary_json: domSummary("Mailbox shell ready"),
        screenshot_path: "/artifacts/runs/run-mailbox-rerun-success/step-0005.svg",
        action_json: action("wait", "mailbox-shell", "Wait for the mailbox shell to render."),
        action_status: "success",
        observation_summary: "Candidate replay reached the authenticated mailbox shell.",
        verification_json: verification({
          passed: true,
          note: "Mailbox shell rendered and the session bootstrap request returned 200.",
          outcome: "terminal_success",
          stage: "authenticated_app",
          templateReplay: { stepIndex: 5, stepCount: 5, outcome: "matched" },
          apiStatus: "passed",
          keyRequest: {
            method: "POST",
            url: "https://mail.example.test/api/session/bootstrap",
            status: 200,
            ok: true,
            phase: "response",
            bodyPreview: "{\"session\":\"active\",\"mailbox\":\"ready\"}"
          }
        }),
        created_at: now - 16_000
      }
    ]);

    await insertRows(client, "case_templates", [
      {
        id: mailboxCaseId,
        project_id: projectId,
        run_id: sourceRunId,
        type: "hybrid",
        title: "Mailbox recovery replay",
        goal: "Replay the mailbox recovery flow and verify the authenticated shell.",
        entry_url: targetUrl,
        status: "active",
        summary: "Template distilled from a stable mailbox recovery login flow.",
        case_json: JSON.stringify({
          title: "Mailbox recovery replay",
          steps: [
            { type: "input", target: "#email" },
            { type: "click", target: "button:has-text('Continue with SSO')" },
            { type: "input", target: "#otp" },
            { type: "click", target: "button:has-text('Verify')" },
            { type: "wait", target: "mailbox-shell" }
          ]
        }),
        created_at: now - 58_000,
        updated_at: now - 58_000
      },
      {
        id: uncoveredCaseId,
        project_id: projectId,
        run_id: sourceRunId,
        type: "ui",
        title: "Admin audit dashboard smoke",
        goal: "Inspect the admin dashboard and verify that the audit widgets render.",
        entry_url: "https://admin.example.test/audit",
        status: "active",
        summary: "No replay runs yet. This scenario is still uncovered.",
        case_json: JSON.stringify({
          title: "Admin audit dashboard smoke",
          steps: [
            { type: "navigate", target: "https://admin.example.test/audit" },
            { type: "wait", target: "dashboard-shell" }
          ]
        }),
        created_at: now - 57_000,
        updated_at: now - 57_000
      }
    ]);

    await insertRows(client, "reports", [
      {
        run_id: candidateRunId,
        html_path: "/reports/candidate-report.html",
        xlsx_path: "/reports/candidate-report.xlsx",
        created_at: now - 14_000
      }
    ]);
  } finally {
    client.close();
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

  const runtimeProcess = spawnProcess({
    cwd: workspaceRoot,
    args: ["--filter", "@qpilot/runtime", "start"],
    logPath: runtimeLogPath,
    env: {
      HOST: "127.0.0.1",
      PORT: "8878",
      CORS_ORIGIN: webBaseUrl,
      DATABASE_URL: databasePath,
      ARTIFACTS_DIR: artifactsRoot,
      REPORTS_DIR: reportsRoot,
      SESSIONS_DIR: sessionsRoot,
      PLANNER_CACHE_DIR: plannerCacheRoot,
      CREDENTIAL_MASTER_KEY: masterKey
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
      "4178",
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
    await waitForUrl(`${webBaseUrl}/projects`, 45_000, (response) => response.ok);

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

    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    await expectText(page, "Create Project");
    await page.getByPlaceholder("Project name").fill(freshProjectName);
    await page.getByPlaceholder("Base URL").fill("https://fresh.example.test");
    await page
      .locator("form")
      .filter({ hasText: "Create Project" })
      .getByRole("button", { name: "Create Project" })
      .click();
    await expectText(page, freshProjectName);
    await page.screenshot({
      path: resolve(screenshotRoot, "01-projects-created.png"),
      fullPage: true
    });

    await page.goto("/runs", { waitUntil: "domcontentloaded" });
    await expectText(page, "Benchmark Readiness");
    await expectText(page, "Needs Coverage");
    await expectText(page, "Needs Attention");
    await expectText(page, "Mailbox recovery replay");
    await expectText(page, "Admin audit dashboard smoke");
    const mailboxScenarioLink = page.locator(`a[href="/benchmarks/${mailboxCaseId}"]`);
    const mailboxFailureLink = page.getByRole("link", { name: "Open latest failure" });
    await mailboxScenarioLink.waitFor({ timeout: 15_000 });
    await mailboxFailureLink.waitFor({ timeout: 15_000 });
    await expectText(page, "Replay now");
    await page.screenshot({
      path: resolve(screenshotRoot, "02-runs-benchmark.png"),
      fullPage: true
    });

    await mailboxScenarioLink.click();
    await expectText(page, "Benchmark Scenario");
    await expectText(page, "Recent Trend");
    await expectText(page, "Recovered after a recent failure");
    await expectText(page, "Last 3");
    await expectText(page, "All Runs");
    await expectText(page, "Recent replay runs for this scenario");
    await expectText(page, "Scenario Comparison");
    await expectText(page, "First divergence at step 3");
    await expectText(page, "Open full diff report");
    await page.getByRole("button", { name: "Active (0)" }).click();
    await expectText(page, "No runs match the current filter");
    await page.getByRole("button", { name: "All Runs (2)" }).click();
    await page.screenshot({
      path: resolve(screenshotRoot, "02b-benchmark-scenario-detail.png"),
      fullPage: true
    });

    await page.getByRole("button", { name: "Compare to latest green" }).click();
    await expectText(page, "Inline Diff Preview");
    await expectText(page, "Use this preview before opening the full report");
    await expectText(page, "Hide diff preview");
    await page.getByRole("button", { name: "Show all 3 changes" }).click();
    await expectText(page, "Step 5");
    await page.screenshot({
      path: resolve(screenshotRoot, "02c-benchmark-inline-diff.png"),
      fullPage: true
    });

    await page.getByLabel("Comparison baseline").selectOption(candidateRunId);
    await expectText(page, "Outcome changed from passed to failed.");
    await expectText(page, "The candidate run regressed away from the previously stable result.");
    await page.getByRole("button", { name: "Reset to latest failure vs green" }).click();
    await expectText(page, "Outcome changed from failed to passed.");

    await page.getByRole("link", { name: "Open full diff report" }).click();
    await expectText(page, "Human Diagnosis");
    await expectText(page, "Run Diff");
    await expectText(page, "Outcome changed from failed to passed.");
    await expectText(page, "The candidate run recovered the flow and reached a success state.");
    await page.screenshot({
      path: resolve(screenshotRoot, "03-report-diff.png"),
      fullPage: true
    });

    await page.goto(`/runs/${candidateRunId}?compareTo=${baselineRunId}`, {
      waitUntil: "domcontentloaded"
    });
    await expectText(page, "This run finished successfully.");
    await expectText(page, "Baseline Comparison");
    await expectText(page, "First divergence at step 3");
    await expectText(page, "Mailbox recovery replay");
    await expectText(page, "Review Mode");
    await expectText(page, "Recorded Evidence");
    await expectText(page, "Open Diff Report");
    await page.screenshot({
      path: resolve(screenshotRoot, "04-run-detail-compare.png"),
      fullPage: true
    });

    await page.getByRole("button", { name: "中文" }).click();
    await sleep(300);
    await expectText(page, "这条运行已经顺利完成。");
    await expectText(page, "结果从 失败 变成了 已通过。");
    await expectText(page, "候选运行修复了这条链路，并成功走到了完成态。");
    await expectText(page, "接口信号看起来正常。");
    await expectText(page, "邮箱壳已渲染，session bootstrap 请求返回了 200。");
    await expectText(page, "等待邮箱壳渲染完成。");
    const chineseNavRunsLabel = (await page.locator("header nav a").nth(1).innerText()).trim();
    const chineseNavNewRunLabel = (await page.locator("header nav a").nth(2).innerText()).trim();
    const chineseLanguageChip = (
      await page.locator("header").getByText(/语言/).first().innerText()
    ).trim();
    await page.screenshot({
      path: resolve(screenshotRoot, "05-run-detail-zh.png"),
      fullPage: true
    });

    await page.getByRole("link", { name: "打开对比报告" }).first().click();
    await expectText(page, "人话诊断");
    await expectText(page, "场景已在 邮箱首页 走通。");
    await expectText(page, "结果从 失败 变成了 已通过。");
    await expectText(page, "候选运行修复了邮箱链路。");
    await expectText(page, "第 3 步从“等待 checkpoint”变成了“输入 #otp”。");
    await page.screenshot({
      path: resolve(screenshotRoot, "06-report-diff-zh.png"),
      fullPage: true
    });

    const observations = {
      fixture: {
        projectId,
        baselineRunId,
        candidateRunId,
        mailboxCaseId
      },
      verifiedFlow: {
        createdProjectName: freshProjectName,
        benchmarkScenario: "Mailbox recovery replay",
        diffHeadline: "Outcome changed from failed to passed.",
        firstDivergenceStep: 3
      },
      languageReview: {
        chineseNavRunsLabel,
        chineseNavNewRunLabel,
        chineseLanguageChip,
        mojibakeDetected:
          chineseNavRunsLabel !== "运行" ||
          chineseNavNewRunLabel !== "新建运行" ||
          chineseLanguageChip !== "语言"
      },
      screenshots: {
        projects: resolve(screenshotRoot, "01-projects-created.png"),
        runs: resolve(screenshotRoot, "02-runs-benchmark.png"),
        scenario: resolve(screenshotRoot, "02b-benchmark-scenario-detail.png"),
        scenarioInlineDiff: resolve(screenshotRoot, "02c-benchmark-inline-diff.png"),
        report: resolve(screenshotRoot, "03-report-diff.png"),
        detail: resolve(screenshotRoot, "04-run-detail-compare.png"),
        chinese: resolve(screenshotRoot, "05-run-detail-zh.png"),
        chineseReport: resolve(screenshotRoot, "06-report-diff-zh.png")
      }
    };

    await writeFile(observationsPath, JSON.stringify(observations, null, 2), "utf8");
    await browser.close();
  } finally {
    await cleanup();
  }
};

run()
  .then(async () => {
    await writeFile(
      resolve(outputRoot, "e2e-status.txt"),
      "console-review.e2e.ts finished successfully.\n",
      "utf8"
    );
    // eslint-disable-next-line no-console
    console.log(`E2E fixture completed. Output: ${outputRoot}`);
  })
  .catch(async (error) => {
    await writeFile(
      resolve(outputRoot, "e2e-status.txt"),
      `console-review.e2e.ts failed.\n${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
      "utf8"
    );
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
