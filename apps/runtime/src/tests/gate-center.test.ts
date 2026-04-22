import { describe, expect, it } from "vitest";
import type {
  BenchmarkSummary,
  GatePolicy,
  LoadProfile,
  LoadRun,
  ReleaseCandidate,
  Run,
  Waiver
} from "@qpilot/shared";
import { buildControlTowerSummary, buildReleaseGateResult } from "../platform/gate-center.js";

const policy: GatePolicy = {
  id: "policy-1",
  projectId: "project-1",
  name: "Default gate",
  requiredFunctionalFlows: ["core login"],
  minBenchmarkCoveragePct: 50,
  minBenchmarkPassRate: 60,
  requiredLoadProfileIds: ["load-profile-1"],
  minimumLoadVerdict: "watch",
  allowWaiver: true,
  approverRoles: ["release-manager"],
  expiresAt: undefined,
  createdAt: "2026-04-18T00:00:00.000Z",
  updatedAt: "2026-04-18T00:00:00.000Z"
};

const release: ReleaseCandidate = {
  id: "release-1",
  projectId: "project-1",
  environmentId: "env-1",
  gatePolicyId: "policy-1",
  name: "2026.04.18",
  buildLabel: "build-1",
  buildId: "build-id-1",
  commitSha: "1234567",
  sourceRunIds: [],
  sourceLoadRunIds: [],
  status: "draft",
  notes: undefined,
  createdAt: "2026-04-18T00:00:00.000Z",
  updatedAt: "2026-04-18T00:00:00.000Z"
};

const functionalRun: Run = {
  id: "run-1",
  projectId: "project-1",
  status: "passed",
  mode: "general",
  targetUrl: "https://example.com",
  goal: "execute core login flow",
  model: undefined,
  createdAt: "2026-04-18T00:00:00.000Z"
} as Run;

const benchmark: BenchmarkSummary = {
  projectId: "project-1",
  scenarioCount: 10,
  coveredScenarioCount: 8,
  replayRunCount: 12,
  passRate: 0.9,
  avgSteps: 6,
  recentFailureCategories: [],
  scenarios: []
};

const loadProfile: LoadProfile = {
  id: "load-profile-1",
  projectId: "project-1",
  name: "checkout",
  scenarioLabel: "checkout",
  targetBaseUrl: "https://example.com",
  environmentTargetId: "env-1",
  engine: "k6_http",
  pattern: "steady",
  requestPath: "/health",
  httpMethod: "GET",
  headersJson: undefined,
  bodyTemplate: undefined,
  executionMode: "distributed",
  workerCount: 2,
  injectorPoolId: "pool-1",
  arrivalModel: "closed",
  phasePlanJson: undefined,
  requestMixJson: undefined,
  evidencePolicyJson: undefined,
  gatePolicyId: "policy-1",
  tagsJson: undefined,
  baselineRunId: undefined,
  virtualUsers: 20,
  durationSec: 30,
  rampUpSec: 5,
  targetRps: 50,
  thresholds: {
    maxP95Ms: 500,
    maxErrorRatePct: 1,
    minThroughputRps: 20
  },
  createdAt: "2026-04-18T00:00:00.000Z",
  updatedAt: "2026-04-18T00:00:00.000Z"
};

const loadRun: LoadRun = {
  id: "load-run-1",
  projectId: "project-1",
  profileId: "load-profile-1",
  profileName: "checkout",
  scenarioLabel: "checkout",
  targetBaseUrl: "https://example.com",
  environmentId: "env-1",
  engine: "k6_http",
  pattern: "steady",
  environmentLabel: "staging",
  status: "passed",
  verdict: "watch",
  source: "k6",
  metrics: {
    p50Ms: 100,
    p95Ms: 200,
    p99Ms: 300,
    errorRatePct: 0.2,
    throughputRps: 120,
    peakVus: 20,
    requestCount: 3000,
    totalErrors: 6
  },
  notes: undefined,
  engineVersion: "k6 v1",
  executorLabel: "local distributed orchestrator",
  rawSummaryPath: undefined,
  compareBaselineRunId: undefined,
  startedAt: "2026-04-18T00:00:00.000Z",
  endedAt: "2026-04-18T00:00:30.000Z",
  createdAt: "2026-04-18T00:00:00.000Z"
};

const activeWaiver: Waiver = {
  id: "waiver-1",
  releaseId: "release-1",
  blockerKey: "functional:core login",
  reason: "temporary exception",
  requestedBy: "qa-lead",
  approvedBy: "qa-lead",
  expiresAt: "2026-04-19T00:00:00.000Z",
  status: "active",
  createdAt: "2026-04-18T00:00:00.000Z",
  updatedAt: "2026-04-18T00:00:00.000Z"
};

describe("gate center", () => {
  it("produces a watch verdict when a waived blocker remains but load stays inside minimum gate", () => {
    const result = buildReleaseGateResult({
      release,
      policy,
      projectRuns: [{ ...functionalRun, status: "failed" } as Run],
      caseTemplates: [],
      benchmark,
      loadProfiles: [loadProfile],
      loadRuns: [loadRun],
      waivers: [activeWaiver],
      nowIso: "2026-04-18T01:00:00.000Z"
    });

    expect(result.verdict).toBe("watch");
    expect(result.waiverCount).toBe(1);
    expect(result.signals.find((signal) => signal.id === "functional:core login")?.status).toBe(
      "waived"
    );
  });

  it("prefers explicitly bound functional and load evidence over newer project-wide runs", () => {
    const result = buildReleaseGateResult({
      release: {
        ...release,
        sourceRunIds: ["run-bound-pass"],
        sourceLoadRunIds: ["load-bound-hold"]
      },
      policy,
      projectRuns: [
        {
          ...functionalRun,
          id: "run-latest-fail",
          goal: "core login",
          status: "failed",
          createdAt: "2026-04-18T02:00:00.000Z"
        } as Run,
        {
          ...functionalRun,
          id: "run-bound-pass",
          goal: "core login",
          status: "passed",
          createdAt: "2026-04-18T01:00:00.000Z"
        } as Run
      ],
      caseTemplates: [],
      benchmark,
      loadProfiles: [loadProfile],
      loadRuns: [
        {
          ...loadRun,
          id: "load-latest-ship",
          verdict: "ship",
          status: "passed",
          createdAt: "2026-04-18T02:00:00.000Z"
        },
        {
          ...loadRun,
          id: "load-bound-hold",
          verdict: "hold",
          status: "failed",
          createdAt: "2026-04-18T01:00:00.000Z"
        }
      ],
      waivers: [],
      nowIso: "2026-04-18T03:00:00.000Z"
    });

    const functionalSignal = result.signals.find((signal) => signal.kind === "functional");
    const loadSignal = result.signals.find((signal) => signal.kind === "load");

    expect(result.verdict).toBe("hold");
    expect(functionalSignal?.sourceId).toBe("run-bound-pass");
    expect(functionalSignal?.status).toBe("passed");
    expect(loadSignal?.sourceId).toBe("load-bound-hold");
    expect(loadSignal?.status).toBe("failed");
  });

  it("builds a control tower snapshot from releases, gates, and worker health", () => {
    const result = buildReleaseGateResult({
      release,
      policy,
      projectRuns: [functionalRun],
      caseTemplates: [],
      benchmark,
      loadProfiles: [loadProfile],
      loadRuns: [loadRun],
      waivers: [],
      nowIso: "2026-04-18T01:00:00.000Z"
    });

    const tower = buildControlTowerSummary({
      releases: [release],
      gateResults: [result],
      loadRuns: [loadRun],
      injectorWorkers: [
        {
          id: "worker-1",
          poolId: "pool-1",
          name: "worker-1",
          status: "online",
          currentRunCount: 0,
          capacity: 10,
          lastHeartbeatAt: "2026-04-18T01:00:00.000Z",
          createdAt: "2026-04-18T00:00:00.000Z",
          updatedAt: "2026-04-18T01:00:00.000Z"
        }
      ]
    });

    expect(tower.activeReleaseCount).toBe(1);
    expect(tower.blockedReleaseCount).toBe(0);
    expect(tower.onlineWorkerCount).toBe(1);
  });
});
