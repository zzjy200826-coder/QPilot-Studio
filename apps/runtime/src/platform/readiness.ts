import { access, mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { join, resolve } from "node:path";
import type { Client as LibsqlClient } from "@libsql/client";
import {
  ReadinessStatusSchema,
  type MaintenanceStatus,
  type OpsDependencyStatus,
  type ReadinessStatus
} from "@qpilot/shared";
import { env, RUNTIME_ROOT } from "../config/env.js";

const probeTimeoutMs = 1_500;

const createDependency = (
  input: Omit<OpsDependencyStatus, "checkedAt">
): OpsDependencyStatus => ({
  ...input,
  checkedAt: new Date().toISOString()
});

const databaseProbe = async (dbClient: LibsqlClient): Promise<OpsDependencyStatus> => {
  const startedAt = Date.now();

  try {
    await dbClient.execute("SELECT 1;");
    await dbClient.execute("BEGIN IMMEDIATE;");
    await dbClient.execute("ROLLBACK;");
    return createDependency({
      key: "sqlite",
      label: "SQLite",
      state: "ready",
      required: true,
      detail: "SQLite is reachable and accepted a write lock probe.",
      endpoint: env.DATABASE_URL,
      latencyMs: Date.now() - startedAt
    });
  } catch (error) {
    try {
      await dbClient.execute("ROLLBACK;");
    } catch {
      // Ignore nested rollback failures after an unsuccessful BEGIN probe.
    }
    return createDependency({
      key: "sqlite",
      label: "SQLite",
      state: "failed",
      required: true,
      detail:
        error instanceof Error ? error.message : "SQLite did not accept the readiness probe.",
      endpoint: env.DATABASE_URL
    });
  }
};

const filesystemProbe = async (): Promise<OpsDependencyStatus> => {
  const startedAt = Date.now();
  const roots = [
    resolve(RUNTIME_ROOT, env.ARTIFACTS_DIR),
    resolve(RUNTIME_ROOT, env.REPORTS_DIR),
    resolve(RUNTIME_ROOT, env.SESSIONS_DIR),
    resolve(RUNTIME_ROOT, env.PLANNER_CACHE_DIR)
  ];

  try {
    for (const root of roots) {
      await mkdir(root, { recursive: true });
      await access(root);
      const probeFile = join(root, `.readiness-${process.pid}.tmp`);
      await writeFile(probeFile, `${Date.now()}`, "utf8");
      await rm(probeFile, { force: true });
    }

    return createDependency({
      key: "filesystem",
      label: "Filesystem",
      state: "ready",
      required: true,
      detail: "Artifacts, reports, sessions, and planner cache directories are writable.",
      endpoint: roots.join(", "),
      latencyMs: Date.now() - startedAt
    });
  } catch (error) {
    return createDependency({
      key: "filesystem",
      label: "Filesystem",
      state: "failed",
      required: true,
      detail:
        error instanceof Error
          ? error.message
          : "One or more runtime directories are not writable.",
      endpoint: roots.join(", ")
    });
  }
};

const tcpProbe = async (input: {
  key: "redis";
  label: string;
  endpoint: string;
  required: boolean;
  defaultPort: number;
}): Promise<OpsDependencyStatus> => {
  let target: URL;
  try {
    target = new URL(input.endpoint);
  } catch {
    return createDependency({
      key: input.key,
      label: input.label,
      state: input.required ? "failed" : "warning",
      required: input.required,
      detail: "Configured endpoint is not a valid URL.",
      endpoint: input.endpoint
    });
  }

  const port = Number(target.port || input.defaultPort);
  const host = target.hostname;
  const startedAt = Date.now();

  return await new Promise<OpsDependencyStatus>((resolveProbe) => {
    const socket = new net.Socket();
    const finish = (result: Omit<OpsDependencyStatus, "checkedAt">) => {
      socket.destroy();
      resolveProbe(createDependency(result));
    };

    socket.setTimeout(probeTimeoutMs);
    socket.once("connect", () => {
      finish({
        key: input.key,
        label: input.label,
        state: "ready",
        required: input.required,
        detail: `TCP handshake succeeded against ${host}:${port}.`,
        endpoint: `${target.protocol}//${target.host}`,
        latencyMs: Date.now() - startedAt
      });
    });
    socket.once("timeout", () => {
      finish({
        key: input.key,
        label: input.label,
        state: input.required ? "failed" : "warning",
        required: input.required,
        detail: `Timed out while connecting to ${host}:${port}.`,
        endpoint: `${target.protocol}//${target.host}`
      });
    });
    socket.once("error", (error) => {
      finish({
        key: input.key,
        label: input.label,
        state: input.required ? "failed" : "warning",
        required: input.required,
        detail: error.message,
        endpoint: `${target.protocol}//${target.host}`
      });
    });

    socket.connect(port, host);
  });
};

const httpWarningProbe = async (
  endpoint: string
): Promise<OpsDependencyStatus> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), probeTimeoutMs);
  const target = new URL("/-/ready", endpoint).toString();
  const startedAt = Date.now();

  try {
    const response = await fetch(target, { signal: controller.signal });
    const body = (await response.text()).trim();
    return createDependency({
      key: "prometheus",
      label: "Prometheus",
      state: response.ok ? "ready" : "warning",
      required: false,
      detail: response.ok
        ? body || "Prometheus ready probe returned OK."
        : body || `Prometheus ready probe returned HTTP ${response.status}.`,
      endpoint,
      latencyMs: Date.now() - startedAt
    });
  } catch (error) {
    return createDependency({
      key: "prometheus",
      label: "Prometheus",
      state: "warning",
      required: false,
      detail:
        error instanceof Error
          ? error.message
          : "Unable to reach the configured Prometheus endpoint.",
      endpoint
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

const disabledDependency = (
  input: Pick<OpsDependencyStatus, "key" | "label" | "detail">
): OpsDependencyStatus =>
  createDependency({
    ...input,
    state: "disabled",
    required: false
  });

const openAiProbe = (): OpsDependencyStatus =>
  env.OPENAI_API_KEY
    ? createDependency({
        key: "openai",
        label: "OpenAI",
        state: "ready",
        required: false,
        detail: "OpenAI API key is configured.",
        endpoint: env.OPENAI_BASE_URL
      })
    : createDependency({
        key: "openai",
        label: "OpenAI",
        state: "warning",
        required: false,
        detail: "OPENAI_API_KEY is not configured. AI-driven flows may be unavailable.",
        endpoint: env.OPENAI_BASE_URL
      });

export const getRuntimeDependencies = async (input: {
  dbClient: LibsqlClient;
}): Promise<OpsDependencyStatus[]> => {
  const redisConfigured = Boolean(env.PLATFORM_REDIS_URL);

  return await Promise.all([
    databaseProbe(input.dbClient),
    filesystemProbe(),
    redisConfigured
      ? tcpProbe({
          key: "redis",
          label: "Redis",
          endpoint: env.PLATFORM_REDIS_URL!,
          required: true,
          defaultPort: 6379
        })
      : Promise.resolve(
          disabledDependency({
            key: "redis",
            label: "Redis",
            detail: "Redis-backed load queue is not configured for this runtime."
          })
        ),
    env.PLATFORM_PROMETHEUS_URL
      ? httpWarningProbe(env.PLATFORM_PROMETHEUS_URL)
      : Promise.resolve(
          disabledDependency({
            key: "prometheus",
            label: "Prometheus",
            detail: "Prometheus scraping is not configured for this runtime."
          })
        ),
    Promise.resolve(openAiProbe())
  ]);
};

export const buildReadinessStatus = (
  dependencies: OpsDependencyStatus[],
  maintenance?: MaintenanceStatus | null
): ReadinessStatus => {
  const checkedAt =
    dependencies
      .map((dependency) => Date.parse(dependency.checkedAt))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => right - left)[0] ?? Date.now();
  const failedComponents = dependencies
    .filter((dependency) => dependency.required && dependency.state === "failed")
    .map((dependency) => dependency.label);
  if (maintenance?.active) {
    failedComponents.push("Maintenance window");
  }
  const warnings = dependencies
    .filter((dependency) => dependency.state === "warning")
    .map((dependency) => dependency.label);

  return ReadinessStatusSchema.parse({
    ready: failedComponents.length === 0,
    checkedAt: new Date(checkedAt).toISOString(),
    failedComponents,
    warnings,
    maintenance: maintenance ?? null,
    components: dependencies
  });
};

export const getRuntimeReadinessStatus = async (input: {
  dbClient: LibsqlClient;
  maintenance?: MaintenanceStatus | null;
}): Promise<ReadinessStatus> =>
  buildReadinessStatus(await getRuntimeDependencies(input), input.maintenance);
