import { describe, expect, it } from "vitest";
import type { PlatformInfraServiceStatus } from "@qpilot/shared";
import { summarizeInfrastructureServices } from "../platform/infra-health.js";

describe("platform infra health", () => {
  it("summarizes service states into a control-plane snapshot", () => {
    const services: PlatformInfraServiceStatus[] = [
      {
        id: "postgres",
        kind: "postgres",
        label: "Postgres",
        state: "online",
        configured: true,
        endpoint: "postgres://localhost:5432",
        detail: "ok",
        latencyMs: 12,
        checkedAt: "2026-04-18T08:00:00.000Z"
      },
      {
        id: "redis",
        kind: "redis",
        label: "Redis",
        state: "degraded",
        configured: true,
        endpoint: "redis://localhost:6379",
        detail: "slow",
        checkedAt: "2026-04-18T08:00:01.000Z"
      },
      {
        id: "prometheus",
        kind: "prometheus",
        label: "Prometheus",
        state: "offline",
        configured: true,
        endpoint: "http://localhost:9090",
        detail: "down",
        checkedAt: "2026-04-18T08:00:02.000Z"
      },
      {
        id: "artifacts",
        kind: "artifacts",
        label: "Artifact store",
        state: "not_configured",
        configured: false,
        detail: "not configured",
        checkedAt: "2026-04-18T08:00:03.000Z"
      }
    ];

    const summary = summarizeInfrastructureServices(services);

    expect(summary.onlineCount).toBe(1);
    expect(summary.degradedCount).toBe(1);
    expect(summary.offlineCount).toBe(1);
    expect(summary.notConfiguredCount).toBe(1);
    expect(summary.checkedAt).toBe("2026-04-18T08:00:03.000Z");
  });
});
