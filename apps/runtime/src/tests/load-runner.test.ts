import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoadProfile } from "@qpilot/shared";

const profile: LoadProfile = {
  id: "profile-k6",
  projectId: "project-1",
  name: "Real k6 checkout",
  scenarioLabel: "Checkout API",
  targetBaseUrl: "https://example.com",
  environmentTargetId: undefined,
  engine: "k6_http",
  pattern: "steady",
  requestPath: "/api/health",
  httpMethod: "GET",
  headersJson: '{"Accept":"application/json"}',
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
  virtualUsers: 10,
  durationSec: 30,
  rampUpSec: 5,
  targetRps: 20,
  thresholds: {
    maxP95Ms: 500,
    maxErrorRatePct: 1,
    minThroughputRps: 10
  },
  createdAt: "2026-04-17T00:00:00.000Z",
  updatedAt: "2026-04-17T00:00:00.000Z"
};

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unmock("node:child_process");
});

describe("load runner", () => {
  it("returns a clear failed run when every k6 binary candidate is missing", async () => {
    vi.doMock("node:child_process", () => ({
      execFile: (...args: unknown[]) => {
        const callback = args[args.length - 1] as (error: Error, stdout?: string, stderr?: string) => void;
        callback(new Error("spawn ENOENT: local k6 binary not found"));
      }
    }));

    const { executeK6LoadRun } = await import("../load/k6-runner.js");
    const run = await executeK6LoadRun(profile, {
      environmentLabel: "staging",
      startedAt: "2026-04-17T00:10:00.000Z"
    });

    expect(run.engine).toBe("k6_http");
    expect(run.source).toBe("k6");
    expect(run.status).toBe("failed");
    expect(run.verdict).toBe("hold");
    expect(run.notes?.toLowerCase()).toContain("local k6 binary not found");
  });
});
