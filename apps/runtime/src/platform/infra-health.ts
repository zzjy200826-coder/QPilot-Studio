import { access, mkdir } from "node:fs/promises";
import net from "node:net";
import { resolve } from "node:path";
import type {
  PlatformInfrastructureSummary,
  PlatformInfraServiceStatus
} from "@qpilot/shared";
import { env, RUNTIME_ROOT } from "../config/env.js";

const probeTimeoutMs = 1_500;

const createNotConfiguredService = (
  input: Pick<PlatformInfraServiceStatus, "id" | "kind" | "label">
): PlatformInfraServiceStatus => ({
  ...input,
  state: "not_configured",
  configured: false,
  detail: "This service is not configured for the current runtime.",
  checkedAt: new Date().toISOString()
});

const sanitizeEndpoint = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return value;
  }
};

const tcpProbe = async (
  input: Pick<PlatformInfraServiceStatus, "id" | "kind" | "label"> & {
    endpoint: string;
    defaultPort: number;
  }
): Promise<PlatformInfraServiceStatus> => {
  const checkedAt = new Date().toISOString();
  let url: URL;

  try {
    url = new URL(input.endpoint);
  } catch {
    return {
      ...input,
      state: "degraded",
      configured: true,
      endpoint: input.endpoint,
      detail: "Configured endpoint is not a valid URL.",
      checkedAt
    };
  }

  const port = Number(url.port || input.defaultPort);
  const host = url.hostname;
  const startedAt = Date.now();

  return await new Promise<PlatformInfraServiceStatus>((resolveStatus) => {
    const socket = new net.Socket();

    const finish = (payload: Omit<PlatformInfraServiceStatus, "id" | "kind" | "label">) => {
      socket.destroy();
      resolveStatus({
        id: input.id,
        kind: input.kind,
        label: input.label,
        ...payload
      });
    };

    socket.setTimeout(probeTimeoutMs);

    socket.once("connect", () => {
      finish({
        state: "online",
        configured: true,
        endpoint: sanitizeEndpoint(input.endpoint),
        detail: `TCP handshake succeeded against ${host}:${port}.`,
        latencyMs: Date.now() - startedAt,
        checkedAt
      });
    });

    socket.once("timeout", () => {
      finish({
        state: "offline",
        configured: true,
        endpoint: sanitizeEndpoint(input.endpoint),
        detail: `Timed out while connecting to ${host}:${port}.`,
        checkedAt
      });
    });

    socket.once("error", (error) => {
      finish({
        state: "offline",
        configured: true,
        endpoint: sanitizeEndpoint(input.endpoint),
        detail: error.message,
        checkedAt
      });
    });

    socket.connect(port, host);
  });
};

const httpProbe = async (
  input: Pick<PlatformInfraServiceStatus, "id" | "kind" | "label"> & {
    endpoint: string;
    readyPath: string;
  }
): Promise<PlatformInfraServiceStatus> => {
  const checkedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), probeTimeoutMs);
  const target = new URL(input.readyPath, input.endpoint).toString();
  const startedAt = Date.now();

  try {
    const response = await fetch(target, { signal: controller.signal });
    const body = (await response.text()).trim();
    return {
      id: input.id,
      kind: input.kind,
      label: input.label,
      state: response.ok ? "online" : "degraded",
      configured: true,
      endpoint: sanitizeEndpoint(input.endpoint),
      detail: response.ok
        ? body || "Prometheus ready probe returned OK."
        : body || `Prometheus ready probe returned HTTP ${response.status}.`,
      latencyMs: Date.now() - startedAt,
      checkedAt
    };
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unable to reach the configured endpoint.";
    return {
      id: input.id,
      kind: input.kind,
      label: input.label,
      state: "offline",
      configured: true,
      endpoint: sanitizeEndpoint(input.endpoint),
      detail,
      checkedAt
    };
  } finally {
    clearTimeout(timeoutId);
  }
};

const artifactProbe = async (): Promise<PlatformInfraServiceStatus> => {
  const checkedAt = new Date().toISOString();
  const artifactsRoot = resolve(RUNTIME_ROOT, env.ARTIFACTS_DIR);

  try {
    await mkdir(artifactsRoot, { recursive: true });
    await access(artifactsRoot);
    return {
      id: "artifacts",
      kind: "artifacts",
      label: "Artifact store",
      state: "online",
      configured: true,
      endpoint: artifactsRoot,
      detail: "Artifact directory is writable on the current control plane node.",
      checkedAt
    };
  } catch (error) {
    return {
      id: "artifacts",
      kind: "artifacts",
      label: "Artifact store",
      state: "degraded",
      configured: true,
      endpoint: artifactsRoot,
      detail: error instanceof Error ? error.message : "Unable to access artifact storage.",
      checkedAt
    };
  }
};

export const summarizeInfrastructureServices = (
  services: PlatformInfraServiceStatus[]
): PlatformInfrastructureSummary => {
  const checkedAt =
    services
      .map((service) => Date.parse(service.checkedAt))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => right - left)[0] ?? Date.now();

  return {
    services,
    onlineCount: services.filter((service) => service.state === "online").length,
    degradedCount: services.filter((service) => service.state === "degraded").length,
    offlineCount: services.filter((service) => service.state === "offline").length,
    notConfiguredCount: services.filter((service) => service.state === "not_configured").length,
    checkedAt: new Date(checkedAt).toISOString()
  };
};

export const getPlatformInfrastructureSummary = async (): Promise<PlatformInfrastructureSummary> => {
  const services = await Promise.all([
    env.PLATFORM_POSTGRES_URL
      ? tcpProbe({
          id: "postgres",
          kind: "postgres",
          label: "Postgres",
          endpoint: env.PLATFORM_POSTGRES_URL,
          defaultPort: 5432
        })
      : Promise.resolve(
          createNotConfiguredService({
            id: "postgres",
            kind: "postgres",
            label: "Postgres"
          })
        ),
    env.PLATFORM_REDIS_URL
      ? tcpProbe({
          id: "redis",
          kind: "redis",
          label: "Redis",
          endpoint: env.PLATFORM_REDIS_URL,
          defaultPort: 6379
        })
      : Promise.resolve(
          createNotConfiguredService({
            id: "redis",
            kind: "redis",
            label: "Redis"
          })
        ),
    env.PLATFORM_PROMETHEUS_URL
      ? httpProbe({
          id: "prometheus",
          kind: "prometheus",
          label: "Prometheus",
          endpoint: env.PLATFORM_PROMETHEUS_URL,
          readyPath: "/-/ready"
        })
      : Promise.resolve(
          createNotConfiguredService({
            id: "prometheus",
            kind: "prometheus",
            label: "Prometheus"
          })
        ),
    artifactProbe()
  ]);

  return summarizeInfrastructureServices(services);
};
