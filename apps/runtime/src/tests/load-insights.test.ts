import { describe, expect, it } from "vitest";
import type { LoadProfile, LoadRun } from "@qpilot/shared";
import {
  buildLoadRunDetail,
  buildLoadStudioSummary,
  simulateLoadRun
} from "../analytics/load-insights.js";

const baseProfile = (overrides: Partial<LoadProfile> = {}): LoadProfile => ({
  id: "profile-1",
  projectId: "project-1",
  name: "Checkout steady",
  scenarioLabel: "Checkout release guard",
  targetBaseUrl: "https://example.com",
  environmentTargetId: undefined,
  engine: "synthetic",
  pattern: "steady",
  requestPath: undefined,
  httpMethod: undefined,
  headersJson: undefined,
  bodyTemplate: undefined,
  executionMode: "local",
  workerCount: 1,
  injectorPoolId: undefined,
  arrivalModel: "closed",
  phasePlanJson: undefined,
  requestMixJson: undefined,
  evidencePolicyJson: undefined,
  gatePolicyId: undefined,
  tagsJson: undefined,
  baselineRunId: undefined,
  virtualUsers: 120,
  durationSec: 300,
  rampUpSec: 45,
  targetRps: 240,
  thresholds: {
    maxP95Ms: 650,
    maxErrorRatePct: 1.5,
    minThroughputRps: 180
  },
  createdAt: "2026-04-17T00:00:00.000Z",
  updatedAt: "2026-04-17T00:00:00.000Z",
  ...overrides
});

const baseRun = (overrides: Partial<LoadRun> = {}): LoadRun => ({
  id: "load-run-1",
  projectId: "project-1",
  profileId: "profile-1",
  profileName: "Checkout steady",
  scenarioLabel: "Checkout release guard",
  targetBaseUrl: "https://example.com",
  environmentId: undefined,
  engine: "synthetic",
  pattern: "steady",
  environmentLabel: "staging",
  status: "passed",
  verdict: "ship",
  source: "synthetic",
  metrics: {
    p50Ms: 140,
    p95Ms: 260,
    p99Ms: 340,
    errorRatePct: 0.4,
    throughputRps: 210,
    peakVus: 120,
    requestCount: 63_000,
    totalErrors: 252
  },
  startedAt: "2026-04-17T00:01:00.000Z",
  endedAt: "2026-04-17T00:01:30.000Z",
  engineVersion: undefined,
  executorLabel: "Synthetic adapter",
  rawSummaryPath: undefined,
  compareBaselineRunId: undefined,
  createdAt: "2026-04-17T00:01:00.000Z",
  ...overrides
});

describe("load insights", () => {
  it("simulates a load run with verdict and metrics", () => {
    const run = simulateLoadRun(baseProfile(), {
      environmentLabel: "staging",
      startedAt: "2026-04-17T02:00:00.000Z"
    });

    expect(run.status).toBeTypeOf("string");
    expect(run.verdict).toBeTypeOf("string");
    expect(run.metrics.p95Ms).toBeGreaterThan(run.metrics.p50Ms);
    expect(run.metrics.requestCount).toBeGreaterThan(0);
    expect(run.environmentLabel).toBe("staging");
    expect(run.source).toBe("synthetic");
  });

  it("builds a summary with alerts from recent load runs", () => {
    const profile = baseProfile();
    const summary = buildLoadStudioSummary(
      [profile],
      [
        baseRun(),
        baseRun({
          id: "load-run-2",
          verdict: "hold",
          status: "failed",
          metrics: {
            p50Ms: 420,
            p95Ms: 880,
            p99Ms: 1100,
            errorRatePct: 3.2,
            throughputRps: 140,
            peakVus: 120,
            requestCount: 42_000,
            totalErrors: 1344
          },
          createdAt: "2026-04-17T00:03:00.000Z"
        })
      ]
    );

    expect(summary.profileCount).toBe(1);
    expect(summary.runCount).toBe(2);
    expect(summary.latestVerdict).toBe("hold");
    expect(summary.topAlerts.length).toBeGreaterThan(0);
    expect(summary.topAlerts[0]?.severity).toMatch(/critical|warning/);
  });

  it("builds a load run detail payload with checks and sibling history", () => {
    const profile = baseProfile();
    const detail = buildLoadRunDetail({
      run: baseRun({
        verdict: "watch",
        metrics: {
          p50Ms: 220,
          p95Ms: 600,
          p99Ms: 760,
          errorRatePct: 1.2,
          throughputRps: 185,
          peakVus: 120,
          requestCount: 55_500,
          totalErrors: 666
        }
      }),
      profile,
      siblingRuns: [
        baseRun({
          id: "load-run-2",
          createdAt: "2026-04-17T00:03:00.000Z"
        }),
        baseRun({
          id: "load-run-3",
          verdict: "hold",
          status: "failed",
          createdAt: "2026-04-17T00:04:00.000Z"
        })
      ]
    });

    expect(detail.profile.id).toBe(profile.id);
    expect(detail.source).toBe("synthetic");
    expect(detail.thresholdChecks).toHaveLength(3);
    expect(detail.recentSiblingRuns[0]?.id).toBe("load-run-3");
    expect(detail.gateSummary).toContain("release gate");
    expect(detail.executionNotes.length).toBeGreaterThan(0);
    expect(detail.gateDecision.verdict).toBe("watch");
    expect(detail.gateInputs.length).toBeGreaterThan(0);
    expect(detail.workers).toHaveLength(0);
    expect(detail.timeSeriesSummary).toHaveLength(0);
  });

  it("keeps queued runs in a pending gate state instead of evaluating thresholds as failures", () => {
    const profile = baseProfile({
      executionMode: "distributed",
      workerCount: 3
    });
    const detail = buildLoadRunDetail({
      run: baseRun({
        id: "load-run-queued",
        status: "queued",
        verdict: "watch",
        metrics: {
          p50Ms: 0,
          p95Ms: 0,
          p99Ms: 0,
          errorRatePct: 0,
          throughputRps: 0,
          peakVus: 0,
          requestCount: 0,
          totalErrors: 0
        },
        endedAt: undefined,
        executorLabel: "BullMQ queue orchestrator"
      }),
      profile,
      siblingRuns: []
    });

    expect(detail.alerts[0]?.title).toContain("queued");
    expect(detail.thresholdChecks.every((check) => check.status === "warning")).toBe(true);
    expect(detail.gateDecision.summary).toContain("queued");
    expect(detail.executionNotes.some((note) => note.includes("waiting in the control plane queue"))).toBe(true);
  });
});
