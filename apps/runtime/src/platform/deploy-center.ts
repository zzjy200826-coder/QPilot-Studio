import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import {
  DeployConfigStatusSchema,
  DeployOperationSchema,
  type DeployConfigStatus,
  type DeployExecutionMode,
  type DeployOperation,
  type DeployOperationStep,
  type RestoreVerificationResult,
  runPlatformSmokeVerification
} from "@qpilot/shared";
import { z } from "zod";
import { env, RUNTIME_ROOT } from "../config/env.js";

const DEPLOY_RUNTIME_SYSTEMD_UNIT = "qpilot-runtime.service";
const DEPLOY_RUNTIME_NGINX_UNIT = "nginx.service";
const currentFile = fileURLToPath(import.meta.url);
const runtimeSrcRoot = resolve(dirname(currentFile), "..");
const runtimeScriptsRoot = resolve(RUNTIME_ROOT, "src", "scripts");
const repositoryRoot = resolve(runtimeSrcRoot, "..", "..", "..");

const deployRefSchema = z.object({
  ref: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9._/-]+$/, "Ref must be a branch-like name.")
});

type DeployOperationRecord = DeployOperation;

type DeployVerificationRunner = (input: {
  baseUrl: string;
  publicBaseUrl?: string;
  metricsToken?: string;
  expectRegistrationClosed?: boolean;
  timeoutMs: number;
}) => Promise<RestoreVerificationResult>;

interface RepositoryState {
  available: boolean;
  detail: string;
  branch?: string;
  commit?: string;
  remote?: string;
  dirty: boolean;
}

interface RemoteDeployTarget {
  host: string;
  sshUser: string;
  sshPort: number;
  sshKeyPath?: string;
  deployRoot: string;
  runtimeEnvSource?: string;
  domain?: string;
  publicDomain?: string;
  appBaseUrl?: string;
  publicBaseUrl?: string;
  metricsToken?: string;
  expectRegistrationClosed: boolean;
}

let deployVerificationRunner: DeployVerificationRunner = async (input) =>
  await runPlatformSmokeVerification(input);

const buildScriptArgs = (script: string, args: string[]): string[] => [
  "--loader",
  "ts-node/esm",
  resolve(runtimeScriptsRoot, script),
  ...args
];

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

const getDeployOpsPaths = () => {
  const root = resolve(env.BACKUP_OPS_ROOT, "deploy");
  return {
    root,
    operationsDir: resolve(root, "operations"),
    logsDir: resolve(root, "logs")
  };
};

const ensureDeployOpsLayout = async (): Promise<void> => {
  const paths = getDeployOpsPaths();
  await Promise.all([
    mkdir(paths.root, { recursive: true }),
    mkdir(paths.operationsDir, { recursive: true }),
    mkdir(paths.logsDir, { recursive: true })
  ]);
};

const buildOperationFile = (operationId: string): string =>
  resolve(getDeployOpsPaths().operationsDir, `${operationId}.json`);

const buildLogFile = (operationId: string): string =>
  resolve(getDeployOpsPaths().logsDir, `${operationId}.log`);

const commandExists = (command: string): boolean => {
  const lookupCommand = process.platform === "win32" ? "where" : "which";
  return (
    spawnSync(lookupCommand, [command], {
      stdio: "ignore",
      windowsHide: true
    }).status === 0
  );
};

const runCommandCapture = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number }
): { ok: boolean; stdout: string; stderr: string; code: number | null } => {
  const result = spawnSync(command, args, {
    cwd: options?.cwd,
    env: options?.env,
    encoding: "utf8",
    windowsHide: true,
    timeout: options?.timeout ?? 10_000
  });

  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status
  };
};

const appendLogLine = async (logPath: string, line: string): Promise<void> => {
  await appendFile(logPath, `${new Date().toISOString()} ${line}\n`, "utf8");
};

const readLogTail = async (logPath?: string, maxLines = 80): Promise<string[]> => {
  if (!logPath || !existsSync(logPath)) {
    return [];
  }

  const content = await readFile(logPath, "utf8");
  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-maxLines);
};

const hydrateOperationRecord = async (
  operation: DeployOperationRecord
): Promise<DeployOperation> =>
  DeployOperationSchema.parse({
    ...operation,
    detail: {
      ...operation.detail,
      logTail: await readLogTail(operation.detail.logPath)
    }
  });

const writeOperationRecord = async (
  operation: DeployOperationRecord
): Promise<DeployOperation> => {
  await ensureDeployOpsLayout();
  await writeFile(buildOperationFile(operation.id), JSON.stringify(operation, null, 2), "utf8");
  return hydrateOperationRecord(operation);
};

const readOperationRecord = async (operationId: string): Promise<DeployOperationRecord | null> => {
  try {
    const raw = await readFile(buildOperationFile(operationId), "utf8");
    return DeployOperationSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
};

const updateOperationRecord = async (
  operationId: string,
  input: Omit<Partial<DeployOperationRecord>, "detail"> & {
    detail?: Partial<DeployOperationRecord["detail"]>;
  }
): Promise<DeployOperation> => {
  const existing = await readOperationRecord(operationId);
  if (!existing) {
    throw new Error(`Deploy operation ${operationId} was not found.`);
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

const listOperationRecords = async (): Promise<DeployOperationRecord[]> => {
  await ensureDeployOpsLayout();
  const entries = await readdir(getDeployOpsPaths().operationsDir, { withFileTypes: true });
  const operations = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const raw = await readFile(resolve(getDeployOpsPaths().operationsDir, entry.name), "utf8");
        return DeployOperationSchema.parse(JSON.parse(raw));
      })
  );

  return operations.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
};

const getActiveOperationRecord = async (): Promise<DeployOperationRecord | null> => {
  const records = await listOperationRecords();
  return records.find((record) => record.status === "queued" || record.status === "running") ?? null;
};

const parseEnvText = (text: string): Map<string, string> => {
  const values = new Map<string, string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    values.set(line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim());
  }

  return values;
};

const readEnvMap = async (filePath?: string): Promise<Map<string, string> | null> => {
  if (!filePath || !existsSync(filePath)) {
    return null;
  }
  return parseEnvText(await readFile(filePath, "utf8"));
};

const normalizeBaseUrl = (value?: string, fallbackProtocol = "https:"): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, "");
  }
  return `${fallbackProtocol}//${trimmed.replace(/\/+$/, "")}`;
};

const readFirstOrigin = (value?: string): string | undefined =>
  value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)[0];

const getRepositoryState = (): RepositoryState => {
  const gitTopLevel = runCommandCapture("git", ["rev-parse", "--show-toplevel"], {
    cwd: repositoryRoot
  });
  if (!gitTopLevel.ok) {
    return {
      available: false,
      detail: "Git repository was not detected in the configured workspace root.",
      dirty: false
    };
  }

  const branch = runCommandCapture("git", ["branch", "--show-current"], {
    cwd: repositoryRoot
  });
  const commit = runCommandCapture("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot
  });
  const remote = runCommandCapture("git", ["remote", "get-url", "origin"], {
    cwd: repositoryRoot
  });
  const dirty = runCommandCapture("git", ["status", "--porcelain"], {
    cwd: repositoryRoot
  });

  return {
    available: true,
    detail: "Repository is available for managed deployment updates.",
    branch: branch.ok ? branch.stdout.trim() || undefined : undefined,
    commit: commit.ok ? commit.stdout.trim() || undefined : undefined,
    remote: remote.ok ? remote.stdout.trim() || undefined : undefined,
    dirty: dirty.ok ? dirty.stdout.trim().length > 0 : false
  };
};

const detectLocalAppBaseUrl = (): string | undefined => readFirstOrigin(env.CORS_ORIGIN);

const detectLocalPublicBaseUrl = (appBaseUrl?: string): string | undefined => {
  const host = process.env.VITE_PUBLIC_MARKETING_HOST?.trim();
  if (!host) {
    return undefined;
  }
  const protocol = appBaseUrl ? new URL(appBaseUrl).protocol : "https:";
  return normalizeBaseUrl(host, protocol);
};

const getRemoteDeployTarget = async (): Promise<RemoteDeployTarget | null> => {
  const host = env.DEPLOY_REMOTE_HOST?.trim();
  const sshUser = env.DEPLOY_REMOTE_SSH_USER?.trim();
  if (!host || !sshUser) {
    return null;
  }

  const runtimeEnvMap = await readEnvMap(env.DEPLOY_REMOTE_RUNTIME_ENV_SOURCE);
  const appBaseUrl =
    normalizeBaseUrl(env.DEPLOY_REMOTE_DOMAIN) ??
    normalizeBaseUrl(readFirstOrigin(runtimeEnvMap?.get("CORS_ORIGIN")));
  const publicBaseUrl =
    normalizeBaseUrl(
      env.DEPLOY_REMOTE_PUBLIC_DOMAIN ??
        runtimeEnvMap?.get("VITE_PUBLIC_MARKETING_HOST"),
      appBaseUrl ? new URL(appBaseUrl).protocol : "https:"
    ) ?? undefined;

  return {
    host,
    sshUser,
    sshPort: env.DEPLOY_REMOTE_SSH_PORT,
    sshKeyPath: env.DEPLOY_REMOTE_SSH_KEY_PATH?.trim() || undefined,
    deployRoot: env.DEPLOY_REMOTE_ROOT,
    runtimeEnvSource: env.DEPLOY_REMOTE_RUNTIME_ENV_SOURCE?.trim() || undefined,
    domain: env.DEPLOY_REMOTE_DOMAIN?.trim() || undefined,
    publicDomain: env.DEPLOY_REMOTE_PUBLIC_DOMAIN?.trim() || undefined,
    appBaseUrl,
    publicBaseUrl,
    metricsToken: runtimeEnvMap?.get("METRICS_BEARER_TOKEN")?.trim() || undefined,
    expectRegistrationClosed: runtimeEnvMap?.get("AUTH_SELF_SERVICE_REGISTRATION")?.trim() === "false"
  };
};

const detectExecutionMode = async (): Promise<DeployExecutionMode> =>
  (await getRemoteDeployTarget()) ? "remote_ssh" : "local";

const createDefaultSteps = (mode: DeployExecutionMode): DeployOperationStep[] =>
  mode === "remote_ssh"
    ? [
        { key: "prepare", label: "Validate operator workspace", status: "pending" },
        { key: "remote_update", label: "Run remote deploy:update", status: "pending" },
        { key: "smoke", label: "Verify remote platform", status: "pending" }
      ]
    : [
        { key: "fetch", label: "Fetch repository", status: "pending" },
        { key: "checkout", label: "Checkout target ref", status: "pending" },
        { key: "install", label: "Install dependencies", status: "pending" },
        { key: "build_web", label: "Build web application", status: "pending" },
        { key: "restart_runtime", label: "Restart runtime service", status: "pending" },
        { key: "reload_nginx", label: "Reload nginx", status: "pending" },
        { key: "smoke", label: "Run platform smoke", status: "pending" }
      ];

const updateStepState = (
  steps: DeployOperationStep[],
  key: string,
  input: Partial<DeployOperationStep>
): DeployOperationStep[] =>
  steps.map((step) => (step.key === key ? { ...step, ...input } : step));

const markStep = async (
  operationId: string,
  key: string,
  input: Partial<DeployOperationStep>
): Promise<DeployOperation> => {
  const existing = await readOperationRecord(operationId);
  if (!existing) {
    throw new Error(`Deploy operation ${operationId} was not found.`);
  }
  const steps = updateStepState(existing.detail.steps ?? createDefaultSteps("local"), key, input);
  return updateOperationRecord(operationId, {
    detail: {
      ...existing.detail,
      steps
    }
  });
};

const runLoggedCommand = async (input: {
  command: string;
  args: string[];
  logPath: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<void> => {
  await appendLogLine(input.logPath, `$ ${input.command} ${input.args.join(" ")}`);
  await new Promise<void>((resolveCommand, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    child.stdout?.on("data", (chunk) => {
      void appendFile(input.logPath, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      void appendFile(input.logPath, chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolveCommand();
        return;
      }
      reject(new Error(`${input.command} exited with code ${code ?? "unknown"}.`));
    });
  });
};

const checkoutTargetRef = async (input: {
  ref: string;
  logPath: string;
}): Promise<void> => {
  const localBranch = runCommandCapture(
    "git",
    ["show-ref", "--verify", "--quiet", `refs/heads/${input.ref}`],
    { cwd: repositoryRoot }
  );

  if (localBranch.ok) {
    await runLoggedCommand({
      command: "git",
      args: ["checkout", input.ref],
      cwd: repositoryRoot,
      logPath: input.logPath
    });
  } else {
    await runLoggedCommand({
      command: "git",
      args: ["checkout", "-b", input.ref, "--track", `origin/${input.ref}`],
      cwd: repositoryRoot,
      logPath: input.logPath
    });
  }

  await runLoggedCommand({
    command: "git",
    args: ["pull", "--ff-only", "origin", input.ref],
    cwd: repositoryRoot,
    logPath: input.logPath
  });
};

const sleep = async (ms: number): Promise<void> =>
  await new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

const runSmokeWithRetry = async (input: {
  baseUrl: string;
  publicBaseUrl?: string;
  metricsToken?: string;
  expectRegistrationClosed: boolean;
  maxWaitMs: number;
  attemptTimeoutMs: number;
  logPath: string;
}): Promise<RestoreVerificationResult> => {
  const deadline = Date.now() + input.maxWaitMs;
  let lastResult: RestoreVerificationResult | null = null;

  while (Date.now() < deadline) {
    lastResult = await deployVerificationRunner({
      baseUrl: input.baseUrl,
      publicBaseUrl: input.publicBaseUrl,
      metricsToken: input.metricsToken,
      expectRegistrationClosed: input.expectRegistrationClosed,
      timeoutMs: input.attemptTimeoutMs
    });

    if (lastResult.ok) {
      await appendLogLine(input.logPath, "Platform smoke verification passed.");
      return lastResult;
    }

    const failedLabels = lastResult.checks
      .filter((check) => check.state === "failed")
      .map((check) => `${check.label}: ${check.detail}`);
    await appendLogLine(
      input.logPath,
      `Smoke attempt failed, retrying: ${failedLabels.join(" | ")}`
    );
    await sleep(5_000);
  }

  if (!lastResult) {
    throw new Error("Smoke verification did not produce a result.");
  }

  return lastResult;
};

const buildRemoteDeployArgs = (target: RemoteDeployTarget, ref: string): string[] => {
  const args = [
    "deploy:update",
    "--",
    "--host",
    target.host,
    "--ssh-user",
    target.sshUser,
    "--ssh-port",
    String(target.sshPort),
    "--deploy-root",
    target.deployRoot,
    "--ref",
    ref
  ];

  if (target.sshKeyPath) {
    args.push("--ssh-key", target.sshKeyPath);
  }
  if (target.runtimeEnvSource) {
    args.push("--runtime-env-source", target.runtimeEnvSource);
  }
  if (target.domain) {
    args.push("--domain", target.domain);
  }
  if (target.publicDomain) {
    args.push("--public-domain", target.publicDomain);
  }

  return args;
};

const captureRemoteGitState = (
  target: RemoteDeployTarget
): { branch?: string; commit?: string } => {
  if (!commandExists("ssh")) {
    return {};
  }

  const sshArgs = [
    "-p",
    String(target.sshPort),
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new"
  ];
  if (target.sshKeyPath) {
    sshArgs.push("-i", target.sshKeyPath);
  }

  const appDir = `${target.deployRoot}/app`;
  const script = [
    `if [ -d ${shellQuote(`${appDir}/.git`)} ]; then`,
    `  printf 'branch='; git -C ${shellQuote(appDir)} branch --show-current`,
    "  printf '\\n'",
    `  printf 'commit='; git -C ${shellQuote(appDir)} rev-parse HEAD`,
    "fi"
  ].join(" ");

  const result = runCommandCapture(
    "ssh",
    [...sshArgs, `${target.sshUser}@${target.host}`, "bash", "-lc", script],
    { timeout: 20_000 }
  );

  if (!result.ok) {
    return {};
  }

  const values = parseEnvText(result.stdout.replace(/^/gm, ""));
  return {
    branch: values.get("branch")?.trim() || undefined,
    commit: values.get("commit")?.trim() || undefined
  };
};

const performLocalDeployOperation = async (operationId: string): Promise<void> => {
  const operation = await readOperationRecord(operationId);
  if (!operation) {
    throw new Error(`Deploy operation ${operationId} was not found.`);
  }

  const logPath = buildLogFile(operationId);
  const repoState = getRepositoryState();
  if (!repoState.available) {
    throw new Error(repoState.detail);
  }
  if (repoState.dirty) {
    throw new Error("Repository has uncommitted changes. Clean the workspace before deploying.");
  }

  const appBaseUrl = detectLocalAppBaseUrl();
  const publicBaseUrl = detectLocalPublicBaseUrl(appBaseUrl);

  await appendLogLine(logPath, `Starting local deploy for ref ${operation.targetRef}.`);
  await updateOperationRecord(operationId, {
    status: "running",
    startedAt: new Date().toISOString(),
    branchBefore: repoState.branch,
    commitBefore: repoState.commit,
    detail: {
      ...operation.detail,
      executionMode: "local",
      workspaceRoot: repositoryRoot,
      repoRemote: repoState.remote,
      repoDirty: repoState.dirty,
      targetAppBaseUrl: appBaseUrl,
      targetPublicBaseUrl: publicBaseUrl,
      logPath,
      steps: operation.detail.steps?.length ? operation.detail.steps : createDefaultSteps("local")
    }
  });

  const executeStep = async (
    key: string,
    action: () => Promise<void>,
    onSuccessDetail?: string
  ): Promise<void> => {
    await markStep(operationId, key, {
      status: "running",
      startedAt: new Date().toISOString(),
      detail: undefined
    });
    try {
      await action();
      await markStep(operationId, key, {
        status: "succeeded",
        finishedAt: new Date().toISOString(),
        detail: onSuccessDetail
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markStep(operationId, key, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        detail: message
      });
      throw error;
    }
  };

  try {
    await executeStep("fetch", async () => {
      await runLoggedCommand({
        command: "git",
        args: ["fetch", "origin", operation.targetRef],
        cwd: repositoryRoot,
        logPath
      });
    });

    await executeStep("checkout", async () => {
      await checkoutTargetRef({
        ref: operation.targetRef,
        logPath
      });
    });

    await executeStep("install", async () => {
      await runLoggedCommand({
        command: "pnpm",
        args: ["install", "--frozen-lockfile"],
        cwd: repositoryRoot,
        logPath
      });
    });

    await executeStep("build_web", async () => {
      await runLoggedCommand({
        command: "pnpm",
        args: ["--filter", "@qpilot/web", "build"],
        cwd: repositoryRoot,
        logPath
      });
    });

    await executeStep("restart_runtime", async () => {
      await runLoggedCommand({
        command: "systemctl",
        args: ["restart", DEPLOY_RUNTIME_SYSTEMD_UNIT],
        logPath
      });
    });

    await executeStep("reload_nginx", async () => {
      await runLoggedCommand({
        command: "systemctl",
        args: ["reload", DEPLOY_RUNTIME_NGINX_UNIT],
        logPath
      });
    });

    if (!appBaseUrl) {
      throw new Error("Unable to derive the deploy smoke base URL from CORS_ORIGIN.");
    }

    const smokeResultHolder: { value?: RestoreVerificationResult } = {};
    await executeStep(
      "smoke",
      async () => {
        smokeResultHolder.value = await runSmokeWithRetry({
          baseUrl: appBaseUrl,
          publicBaseUrl,
          metricsToken: env.METRICS_BEARER_TOKEN,
          expectRegistrationClosed: env.AUTH_SELF_SERVICE_REGISTRATION === false,
          maxWaitMs: 90_000,
          attemptTimeoutMs: 8_000,
          logPath
        });
      },
      "Platform smoke passed."
    );

    const afterState = getRepositoryState();
    await appendLogLine(
      logPath,
      `Local deploy finished at ${afterState.commit ?? "unknown commit"} on branch ${afterState.branch ?? "unknown"}.`
    );
    await updateOperationRecord(operationId, {
      status: "succeeded",
      branchAfter: afterState.branch,
      commitAfter: afterState.commit,
      message: "Deploy completed successfully.",
      finishedAt: new Date().toISOString(),
      detail: {
        ...(await readOperationRecord(operationId))?.detail,
        smokeVerification: smokeResultHolder.value
      }
    });
  } catch (error) {
    const afterState = getRepositoryState();
    const message = error instanceof Error ? error.message : String(error);
    await appendLogLine(logPath, `Local deploy failed: ${message}`);
    await updateOperationRecord(operationId, {
      status: "failed",
      branchAfter: afterState.branch,
      commitAfter: afterState.commit,
      error: message,
      message: "Deploy failed.",
      finishedAt: new Date().toISOString()
    });
    throw error;
  }
};

const performRemoteDeployOperation = async (operationId: string): Promise<void> => {
  const operation = await readOperationRecord(operationId);
  if (!operation) {
    throw new Error(`Deploy operation ${operationId} was not found.`);
  }

  const target = await getRemoteDeployTarget();
  if (!target) {
    throw new Error(
      "Remote deploy target is not configured. Set DEPLOY_REMOTE_HOST and DEPLOY_REMOTE_SSH_USER."
    );
  }

  const logPath = buildLogFile(operationId);
  const repoState = getRepositoryState();

  await appendLogLine(
    logPath,
    `Starting remote deploy for ref ${operation.targetRef} on ${target.sshUser}@${target.host}:${target.sshPort}.`
  );
  await updateOperationRecord(operationId, {
    status: "running",
    startedAt: new Date().toISOString(),
    branchBefore: repoState.branch,
    commitBefore: repoState.commit,
    detail: {
      ...operation.detail,
      executionMode: "remote_ssh",
      workspaceRoot: repositoryRoot,
      repoRemote: repoState.remote,
      repoDirty: repoState.dirty,
      targetHost: target.host,
      targetSshUser: target.sshUser,
      targetAppBaseUrl: target.appBaseUrl,
      targetPublicBaseUrl: target.publicBaseUrl,
      logPath,
      steps:
        operation.detail.steps?.length ? operation.detail.steps : createDefaultSteps("remote_ssh")
    }
  });

  const executeStep = async (
    key: string,
    action: () => Promise<void>,
    onSuccessDetail?: string
  ): Promise<void> => {
    await markStep(operationId, key, {
      status: "running",
      startedAt: new Date().toISOString(),
      detail: undefined
    });
    try {
      await action();
      await markStep(operationId, key, {
        status: "succeeded",
        finishedAt: new Date().toISOString(),
        detail: onSuccessDetail
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markStep(operationId, key, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        detail: message
      });
      throw error;
    }
  };

  try {
    await executeStep(
      "prepare",
      async () => {
        if (!repoState.available) {
          throw new Error(repoState.detail);
        }
        if (!commandExists("pnpm")) {
          throw new Error("pnpm is required on the operator host.");
        }
        if (!commandExists("ssh")) {
          throw new Error("ssh is required on the operator host.");
        }
        if (!commandExists("scp")) {
          throw new Error("scp is required on the operator host.");
        }
      },
      `Operator host is ready to reach ${target.host}.`
    );

    await executeStep(
      "remote_update",
      async () => {
        await runLoggedCommand({
          command: "pnpm",
          args: buildRemoteDeployArgs(target, operation.targetRef),
          cwd: repositoryRoot,
          logPath
        });
      },
      `Remote update completed on ${target.host}.`
    );

    let smokeResult: RestoreVerificationResult | undefined;
    if (target.appBaseUrl) {
      await executeStep(
        "smoke",
        async () => {
          smokeResult = await runSmokeWithRetry({
            baseUrl: target.appBaseUrl!,
            publicBaseUrl: target.publicBaseUrl,
            metricsToken: target.metricsToken,
            expectRegistrationClosed: target.expectRegistrationClosed,
            maxWaitMs: 90_000,
            attemptTimeoutMs: 8_000,
            logPath
          });
        },
        "Remote platform smoke passed."
      );
    } else {
      await markStep(operationId, "smoke", {
        status: "skipped",
        finishedAt: new Date().toISOString(),
        detail: "Smoke verification was skipped because no remote app URL was configured."
      });
    }

    const remoteState = captureRemoteGitState(target);
    await appendLogLine(
      logPath,
      `Remote deploy finished at ${remoteState.commit ?? "unknown commit"} on branch ${remoteState.branch ?? operation.targetRef}.`
    );
    await updateOperationRecord(operationId, {
      status: "succeeded",
      branchAfter: remoteState.branch,
      commitAfter: remoteState.commit,
      message: "Deploy completed successfully.",
      finishedAt: new Date().toISOString(),
      detail: {
        ...(await readOperationRecord(operationId))?.detail,
        smokeVerification: smokeResult
      }
    });
  } catch (error) {
    const remoteState = captureRemoteGitState(target);
    const message = error instanceof Error ? error.message : String(error);
    await appendLogLine(logPath, `Remote deploy failed: ${message}`);
    await updateOperationRecord(operationId, {
      status: "failed",
      branchAfter: remoteState.branch,
      commitAfter: remoteState.commit,
      error: message,
      message: "Deploy failed.",
      finishedAt: new Date().toISOString()
    });
    throw error;
  }
};

const spawnManagedDeployOperation = async (
  operationId: string,
  mode: DeployExecutionMode
): Promise<void> => {
  if (mode === "remote_ssh") {
    const child = spawn(process.execPath, buildScriptArgs("deploy-run.ts", []), {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        DEPLOY_OPERATION_ID: operationId
      },
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
    return;
  }

  if (process.platform !== "linux" || !commandExists("systemd-run")) {
    throw new Error("Deploy Center requires a Linux host with systemd-run available.");
  }

  const child = spawn(
    "systemd-run",
    [
      `--unit=qpilot-deploy-${operationId}`,
      "--collect",
      `--property=WorkingDirectory=${repositoryRoot}`,
      `--setenv=DEPLOY_OPERATION_ID=${operationId}`,
      process.execPath,
      ...buildScriptArgs("deploy-run.ts", [])
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    }
  );
  child.unref();
};

export const getDeployConfigStatus = async (): Promise<DeployConfigStatus> => {
  const repoState = getRepositoryState();
  const activeOperation = await getActiveOperationRecord();
  const recentOperations = await listOperationRecords();
  const sshAvailable = commandExists("ssh");
  const scpAvailable = commandExists("scp");
  const systemctlAvailable = commandExists("systemctl");
  const systemdRunAvailable = commandExists("systemd-run");
  const remoteTarget = await getRemoteDeployTarget();
  const executionMode: DeployExecutionMode = remoteTarget ? "remote_ssh" : "local";

  let supported = false;
  let detail = "";
  let appBaseUrl: string | undefined;
  let publicBaseUrl: string | undefined;

  if (executionMode === "remote_ssh") {
    supported = repoState.available && sshAvailable && scpAvailable && commandExists("pnpm");
    detail = supported
      ? "Deploy Center can push updates to the configured SSH target through deploy:update."
      : "Remote SSH deploy requires a git workspace plus local pnpm, ssh, and scp tooling.";
    appBaseUrl = remoteTarget?.appBaseUrl;
    publicBaseUrl = remoteTarget?.publicBaseUrl;
  } else {
    supported =
      process.platform === "linux" &&
      repoState.available &&
      systemctlAvailable &&
      systemdRunAvailable;
    detail = supported
      ? "Deploy Center can update this workspace in place through systemd-run."
      : "Deploy Center requires a Linux host, a git workspace, systemctl, and systemd-run.";
    appBaseUrl = detectLocalAppBaseUrl();
    publicBaseUrl = detectLocalPublicBaseUrl(appBaseUrl);
  }

  return DeployConfigStatusSchema.parse({
    supported,
    detail,
    executionMode,
    workspaceRoot: repositoryRoot,
    gitBranch: repoState.branch,
    gitCommit: repoState.commit,
    gitRemote: repoState.remote,
    gitDirty: repoState.dirty,
    sshAvailable,
    scpAvailable,
    systemdRunAvailable,
    systemctlAvailable,
    targetHost: remoteTarget?.host,
    targetSshUser: remoteTarget?.sshUser,
    targetSshPort: remoteTarget?.sshPort,
    targetDeployRoot: remoteTarget?.deployRoot,
    runtimeEnvSourcePath: remoteTarget?.runtimeEnvSource,
    activeOperation: activeOperation ? await hydrateOperationRecord(activeOperation) : undefined,
    recentOperations: await Promise.all(
      recentOperations.slice(0, 8).map((operation) => hydrateOperationRecord(operation))
    ),
    lastSuccessfulAt: recentOperations.find((operation) => operation.status === "succeeded")
      ?.finishedAt,
    appBaseUrl,
    publicBaseUrl
  });
};

export const getDeployOperation = async (
  operationId: string
): Promise<DeployOperation | null> => {
  const operation = await readOperationRecord(operationId);
  return operation ? hydrateOperationRecord(operation) : null;
};

export const createDeployOperation = async (input: {
  ref?: string;
  triggeredBy?: string;
}): Promise<DeployOperation> => {
  const executionMode = await detectExecutionMode();
  const repoState = getRepositoryState();
  const remoteTarget = executionMode === "remote_ssh" ? await getRemoteDeployTarget() : null;
  const defaultRef = executionMode === "remote_ssh" ? "main" : repoState.branch || "main";
  const parsed = deployRefSchema.parse({ ref: input.ref?.trim() || defaultRef });
  const operationId = nanoid();

  if (!repoState.available) {
    throw new Error(repoState.detail);
  }
  if (executionMode === "local" && repoState.dirty) {
    throw new Error("Repository has local changes. Commit or discard them before deploying.");
  }
  if (await getActiveOperationRecord()) {
    throw new Error("Another deploy operation is already running.");
  }

  const operation = await writeOperationRecord({
    id: operationId,
    status: "queued",
    targetRef: parsed.ref,
    triggeredBy: input.triggeredBy,
    message: "Deploy queued.",
    branchBefore: repoState.branch,
    commitBefore: repoState.commit,
    detail: {
      executionMode,
      workspaceRoot: repositoryRoot,
      repoRemote: repoState.remote,
      repoDirty: repoState.dirty,
      targetHost: remoteTarget?.host,
      targetSshUser: remoteTarget?.sshUser,
      targetAppBaseUrl:
        executionMode === "remote_ssh"
          ? remoteTarget?.appBaseUrl
          : detectLocalAppBaseUrl(),
      targetPublicBaseUrl:
        executionMode === "remote_ssh"
          ? remoteTarget?.publicBaseUrl
          : detectLocalPublicBaseUrl(detectLocalAppBaseUrl()),
      logPath: buildLogFile(operationId),
      logTail: [],
      steps: createDefaultSteps(executionMode)
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  try {
    await spawnManagedDeployOperation(operation.id, executionMode);
    return operation;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return updateOperationRecord(operation.id, {
      status: "failed",
      error: message,
      message,
      finishedAt: new Date().toISOString()
    });
  }
};

export class DeployRuntime {
  async getConfigStatus(): Promise<DeployConfigStatus> {
    return getDeployConfigStatus();
  }

  async getOperation(operationId: string): Promise<DeployOperation | null> {
    return getDeployOperation(operationId);
  }

  async startDeploy(input: { ref?: string; triggeredBy?: string }): Promise<DeployOperation> {
    return createDeployOperation(input);
  }
}

export const runDeployCli = async (): Promise<void> => {
  const operationId = process.env.DEPLOY_OPERATION_ID?.trim();
  if (!operationId) {
    throw new Error("DEPLOY_OPERATION_ID is required.");
  }

  const operation = await readOperationRecord(operationId);
  if (!operation) {
    throw new Error(`Deploy operation ${operationId} was not found.`);
  }

  if (operation.detail.executionMode === "remote_ssh") {
    await performRemoteDeployOperation(operationId);
    return;
  }

  await performLocalDeployOperation(operationId);
};

export const deployCenterInternals = {
  getRepositoryState,
  getDeployConfigStatus,
  readLogTail,
  detectLocalAppBaseUrl,
  detectLocalPublicBaseUrl,
  getRemoteDeployTarget,
  setVerificationRunner: (runner?: DeployVerificationRunner) => {
    deployVerificationRunner =
      runner ?? (async (input) => await runPlatformSmokeVerification(input));
  }
};
