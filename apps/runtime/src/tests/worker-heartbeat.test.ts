import { describe, expect, it } from "vitest";
import { z } from "zod";
import { InjectorWorkerSchema, LoadRunWorkerSchema } from "@qpilot/shared";
import {
  enrichLoadRunWorkersWithHeartbeat,
  getWorkerHeartbeatState,
  summarizeInjectorWorkerHealth
} from "../platform/worker-heartbeat.js";

describe("worker heartbeat", () => {
  it("classifies missing, fresh, and stale heartbeats", () => {
    const now = Date.parse("2026-04-18T02:10:00.000Z");

    expect(getWorkerHeartbeatState({ timeoutMs: 15_000, now }).state).toBe("missing");
    expect(
      getWorkerHeartbeatState({
        lastHeartbeatAt: "2026-04-18T02:09:55.000Z",
        timeoutMs: 15_000,
        now
      }).state
    ).toBe("fresh");
    expect(
      getWorkerHeartbeatState({
        lastHeartbeatAt: "2026-04-18T02:09:20.000Z",
        timeoutMs: 15_000,
        now
      }).state
    ).toBe("stale");
  });

  it("summarizes stale busy workers and enriches run workers", () => {
    const now = Date.parse("2026-04-18T02:10:00.000Z");
    const injectorWorkers = [
      InjectorWorkerSchema.parse({
        id: "injector-1",
        poolId: "pool-1",
        name: "injector-1",
        status: "busy",
        currentRunCount: 1,
        capacity: 2,
        lastHeartbeatAt: "2026-04-18T02:09:59.000Z",
        createdAt: "2026-04-18T02:00:00.000Z",
        updatedAt: "2026-04-18T02:09:59.000Z"
      }),
      InjectorWorkerSchema.parse({
        id: "injector-2",
        poolId: "pool-1",
        name: "injector-2",
        status: "busy",
        currentRunCount: 1,
        capacity: 2,
        lastHeartbeatAt: "2026-04-18T02:09:30.000Z",
        createdAt: "2026-04-18T02:00:00.000Z",
        updatedAt: "2026-04-18T02:09:30.000Z"
      })
    ];

    const summary = summarizeInjectorWorkerHealth({
      workers: injectorWorkers,
      timeoutMs: 15_000,
      now
    });
    expect(summary.busyWorkers).toBe(2);
    expect(summary.staleWorkers).toBe(1);

    const workers = [
      LoadRunWorkerSchema.parse({
        id: "worker-1",
        runId: "run-1",
        workerIndex: 1,
        workerLabel: "worker-1",
        injectorPoolId: "pool-1",
        injectorWorkerId: "injector-1",
        status: "running",
        metrics: {
          p50Ms: 10,
          p95Ms: 20,
          p99Ms: 30,
          errorRatePct: 0,
          throughputRps: 50,
          peakVus: 10,
          requestCount: 100,
          totalErrors: 0
        },
        startedAt: "2026-04-18T02:09:00.000Z",
        createdAt: "2026-04-18T02:09:00.000Z"
      }),
      LoadRunWorkerSchema.parse({
        id: "worker-2",
        runId: "run-1",
        workerIndex: 2,
        workerLabel: "worker-2",
        injectorPoolId: "pool-1",
        injectorWorkerId: "injector-2",
        status: "running",
        metrics: {
          p50Ms: 10,
          p95Ms: 20,
          p99Ms: 30,
          errorRatePct: 0,
          throughputRps: 50,
          peakVus: 10,
          requestCount: 100,
          totalErrors: 0
        },
        startedAt: "2026-04-18T02:09:00.000Z",
        createdAt: "2026-04-18T02:09:00.000Z"
      })
    ];

    const enriched = enrichLoadRunWorkersWithHeartbeat({
      workers,
      injectorWorkers,
      timeoutMs: 15_000,
      now
    });

    expect(enriched[0]?.heartbeatState).toBe("fresh");
    expect(enriched[1]?.heartbeatState).toBe("stale");
    expect(z.number().int().nonnegative().safeParse(enriched[1]?.heartbeatAgeMs).success).toBe(true);
  });
});
