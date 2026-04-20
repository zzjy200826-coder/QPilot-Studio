import { describe, expect, it } from "vitest";
import type {
  ControlTowerSummary,
  LoadRun,
  LoadRunSampleWindow,
  PlatformInfrastructureSummary
} from "@qpilot/shared";
import { buildPrometheusMetricsDocument } from "../platform/metrics.js";

const controlTower: ControlTowerSummary = {
  activeReleaseCount: 3,
  blockedReleaseCount: 1,
  activeLoadRunCount: 2,
  onlineWorkerCount: 4,
  topBlockers: ["checkout gate"],
  latestReleases: []
};

const infrastructure: PlatformInfrastructureSummary = {
  services: [
    {
      id: "postgres",
      kind: "postgres",
      label: "Postgres",
      state: "online",
      configured: true,
      endpoint: "postgres://localhost:5432",
      detail: "ok",
      latencyMs: 14,
      checkedAt: "2026-04-18T08:00:00.000Z"
    },
    {
      id: "prometheus",
      kind: "prometheus",
      label: "Prometheus",
      state: "offline",
      configured: true,
      endpoint: "http://localhost:9090",
      detail: "down",
      checkedAt: "2026-04-18T08:00:00.000Z"
    }
  ],
  onlineCount: 1,
  degradedCount: 0,
  offlineCount: 1,
  notConfiguredCount: 0,
  checkedAt: "2026-04-18T08:00:00.000Z"
};

const loadRuns: LoadRun[] = [
  {
    id: "run-1",
    projectId: "project-1",
    profileId: "profile-checkout",
    profileName: "checkout",
    scenarioLabel: "checkout",
    targetBaseUrl: "https://example.com",
    environmentId: "env-1",
    engine: "k6_http",
    pattern: "steady",
    environmentLabel: "staging",
    status: "passed",
    verdict: "ship",
    source: "k6",
    metrics: {
      p50Ms: 90,
      p95Ms: 180,
      p99Ms: 260,
      errorRatePct: 0.2,
      throughputRps: 220,
      peakVus: 20,
      requestCount: 3000,
      totalErrors: 6
    },
    startedAt: "2026-04-18T08:00:00.000Z",
    endedAt: "2026-04-18T08:00:30.000Z",
    createdAt: "2026-04-18T08:00:00.000Z"
  },
  {
    id: "run-2",
    projectId: "project-1",
    profileId: "profile-search",
    profileName: "search",
    scenarioLabel: "search",
    targetBaseUrl: "https://example.com",
    environmentId: "env-1",
    engine: "synthetic",
    pattern: "spike",
    environmentLabel: "staging",
    status: "failed",
    verdict: "hold",
    source: "synthetic",
    metrics: {
      p50Ms: 150,
      p95Ms: 420,
      p99Ms: 600,
      errorRatePct: 5.5,
      throughputRps: 40,
      peakVus: 10,
      requestCount: 1200,
      totalErrors: 66
    },
    startedAt: "2026-04-18T08:05:00.000Z",
    endedAt: "2026-04-18T08:05:30.000Z",
    createdAt: "2026-04-18T08:05:00.000Z"
  }
];

const loadRunWindows: LoadRunSampleWindow[] = [
  {
    id: "window-1",
    runId: "run-1",
    ts: "2026-04-18T08:00:05.000Z",
    p95Ms: 175,
    errorRatePct: 0.1,
    throughputRps: 215,
    activeWorkers: 2
  }
];

describe("platform metrics", () => {
  it("renders prometheus exposition for control tower, infra, and load snapshots", () => {
    const document = buildPrometheusMetricsDocument({
      controlTower,
      infrastructure,
      loadRuns,
      loadRunWindows,
      generatedAt: "2026-04-18T08:10:00.000Z"
    });

    expect(document).toContain("qpilot_control_tower_active_releases 3");
    expect(document).toContain(
      'qpilot_platform_infra_service_up{service="postgres"} 1'
    );
    expect(document).toContain(
      'qpilot_platform_infra_service_up{service="prometheus"} 0'
    );
    expect(document).toContain(
      'qpilot_platform_load_runs_total{status="passed",verdict="ship",engine="k6_http",source="k6"} 1'
    );
    expect(document).toContain(
      'qpilot_platform_latest_load_p95_ms{profile_id="profile-checkout",profile_name="checkout",environment="staging"} 180'
    );
    expect(document).toContain(
      'qpilot_platform_load_run_window_p95_ms{run_id="run-1",profile_id="profile-checkout",profile_name="checkout",environment="staging",window_id="window-1",window_ts="2026-04-18T08:00:05.000Z"} 175'
    );
  });
});
