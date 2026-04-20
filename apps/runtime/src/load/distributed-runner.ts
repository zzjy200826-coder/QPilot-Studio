import { nanoid } from "nanoid";
import type {
  LoadProfile,
  LoadRun,
  LoadRunMetrics,
  LoadRunSampleWindow,
  LoadRunWorker
} from "@qpilot/shared";
import { executeLoadRun, type ExecuteLoadRunOptions } from "./runner.js";

export interface ExecuteDistributedLoadRunOptions extends ExecuteLoadRunOptions {
  environmentId?: string;
  compareBaselineRunId?: string;
  injectorPoolId?: string;
  injectorWorkerIds?: string[];
}

export interface DistributedLoadExecutionResult {
  run: LoadRun;
  workers: LoadRunWorker[];
  sampleWindows: LoadRunSampleWindow[];
}

const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const divideInteger = (total: number, index: number, count: number): number => {
  const base = Math.floor(total / count);
  const remainder = total % count;
  return base + (index < remainder ? 1 : 0);
};

const splitProfileForWorker = (
  profile: LoadProfile,
  workerIndex: number
): LoadProfile => {
  const workerCount = Math.max(1, profile.workerCount ?? 1);
  const workerVus = Math.max(1, divideInteger(profile.virtualUsers, workerIndex, workerCount));
  const workerTargetRps =
    typeof profile.targetRps === "number"
      ? Math.max(1, round(profile.targetRps / workerCount, 2))
      : undefined;

  return {
    ...profile,
    executionMode: "local",
    workerCount: 1,
    virtualUsers: workerVus,
    targetRps: workerTargetRps
  };
};

const aggregateWorkerMetrics = (workers: LoadRunWorker[]): LoadRunMetrics => {
  const requestCount = workers.reduce((sum, worker) => sum + worker.metrics.requestCount, 0);
  const totalErrors = workers.reduce((sum, worker) => sum + worker.metrics.totalErrors, 0);
  const totalWeight = Math.max(1, requestCount);
  const weightedMetric = (
    selector: (worker: LoadRunWorker) => number
  ): number =>
    round(
      workers.reduce(
        (sum, worker) => sum + selector(worker) * Math.max(1, worker.metrics.requestCount),
        0
      ) / totalWeight,
      2
    );

  return {
    p50Ms: weightedMetric((worker) => worker.metrics.p50Ms),
    p95Ms: weightedMetric((worker) => worker.metrics.p95Ms),
    p99Ms: weightedMetric((worker) => worker.metrics.p99Ms),
    errorRatePct:
      requestCount > 0 ? round((totalErrors / requestCount) * 100, 2) : 0,
    throughputRps: round(
      workers.reduce((sum, worker) => sum + worker.metrics.throughputRps, 0),
      2
    ),
    peakVus: workers.reduce((sum, worker) => sum + worker.metrics.peakVus, 0),
    requestCount,
    totalErrors
  };
};

const buildSampleWindows = (
  runId: string,
  profile: LoadProfile,
  metrics: LoadRunMetrics,
  workers: LoadRunWorker[],
  startedAt: string
): LoadRunSampleWindow[] => {
  const windowCount = Math.max(4, Math.min(8, profile.workerCount * 2));
  const startTs = Date.parse(startedAt);
  const intervalMs = Math.max(5_000, Math.round((profile.durationSec * 1000) / windowCount));
  const failedWorkers = workers.filter((worker) => worker.status === "failed").length;

  return Array.from({ length: windowCount }, (_, index) => {
    const progress = (index + 1) / windowCount;
    const patternFactor =
      profile.pattern === "spike"
        ? index === Math.floor(windowCount / 2)
          ? 1.3
          : 0.92 + progress * 0.12
        : profile.pattern === "ramp"
          ? 0.75 + progress * 0.28
          : profile.pattern === "soak"
            ? 0.92 + progress * 0.18
            : profile.pattern === "breakpoint"
              ? 0.8 + progress * 0.4
              : 0.9 + progress * 0.12;

    const degraded = failedWorkers > 0 && index >= Math.floor(windowCount * 0.6);
    const latency = round(metrics.p95Ms * patternFactor * (degraded ? 1.18 : 1));
    const errors = round(metrics.errorRatePct * (degraded ? 1.2 : 0.92 + progress * 0.08), 2);
    const throughput = round(
      Math.max(
        0,
        metrics.throughputRps * (degraded ? 0.78 : 0.86 + progress * 0.14)
      ),
      2
    );

    return {
      id: nanoid(),
      runId,
      ts: new Date(startTs + intervalMs * index).toISOString(),
      p95Ms: latency,
      errorRatePct: errors,
      throughputRps: throughput,
      activeWorkers: Math.max(0, workers.length - (degraded ? failedWorkers : 0)),
      note: degraded
        ? "Worker instability started to reduce healthy injector capacity."
        : undefined
    };
  });
};

export const executeDistributedLoadRun = async (
  profile: LoadProfile,
  options: ExecuteDistributedLoadRunOptions
): Promise<DistributedLoadExecutionResult> => {
  const startedAt = options.startedAt ?? new Date().toISOString();
  const workerCount = Math.max(1, profile.workerCount ?? 1);

  const settled = await Promise.allSettled(
    Array.from({ length: workerCount }, async (_, index) => {
      const workerLabel = `worker-${index + 1}`;
      const workerRun = await executeLoadRun(splitProfileForWorker(profile, index), {
        environmentLabel: options.environmentLabel,
        notes: options.notes
          ? `${options.notes}\nDistributed shard ${workerLabel}`
          : `Distributed shard ${workerLabel}`,
        startedAt
      });

      const injectorWorkerId = options.injectorWorkerIds?.[index];

      return {
        id: nanoid(),
        runId: "",
        workerIndex: index + 1,
        workerLabel,
        injectorPoolId: options.injectorPoolId,
        injectorWorkerId,
        status: workerRun.status,
        metrics: workerRun.metrics,
        notes: workerRun.notes,
        engineVersion: workerRun.engineVersion,
        executorLabel: workerRun.executorLabel,
        rawSummaryPath: workerRun.rawSummaryPath,
        startedAt: workerRun.startedAt,
        endedAt: workerRun.endedAt,
        createdAt: workerRun.createdAt
      } satisfies LoadRunWorker;
    })
  );

  const workers = settled.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }

    return {
      id: nanoid(),
      runId: "",
      workerIndex: index + 1,
      workerLabel: `worker-${index + 1}`,
      injectorPoolId: options.injectorPoolId,
      injectorWorkerId: options.injectorWorkerIds?.[index],
      status: "failed",
      metrics: {
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
        errorRatePct: 100,
        throughputRps: 0,
        peakVus: 0,
        requestCount: 0,
        totalErrors: 0
      },
      notes: result.reason instanceof Error ? result.reason.message : String(result.reason),
      engineVersion: undefined,
      executorLabel: undefined,
      rawSummaryPath: undefined,
      startedAt,
      endedAt: startedAt,
      createdAt: startedAt
    } satisfies LoadRunWorker;
  });

  const metrics = aggregateWorkerMetrics(workers);
  const failedWorkers = workers.filter((worker) => worker.status === "failed").length;
  const passesLatency = metrics.p95Ms <= profile.thresholds.maxP95Ms;
  const passesErrorRate = metrics.errorRatePct <= profile.thresholds.maxErrorRatePct;
  const passesThroughput = metrics.throughputRps >= profile.thresholds.minThroughputRps;
  const hardFailureThreshold = Math.max(1, Math.ceil(workerCount / 2));

  const status: LoadRun["status"] =
    failedWorkers >= hardFailureThreshold || !passesLatency || !passesErrorRate || !passesThroughput
      ? "failed"
      : "passed";

  const verdict: LoadRun["verdict"] =
    status === "failed"
      ? "hold"
      : failedWorkers > 0 ||
          metrics.p95Ms > profile.thresholds.maxP95Ms * 0.85 ||
          metrics.errorRatePct > profile.thresholds.maxErrorRatePct * 0.6 ||
          metrics.throughputRps < profile.thresholds.minThroughputRps * 1.08
        ? "watch"
        : "ship";

  const endedAt = new Date(
    Date.parse(startedAt) + Math.max(5, profile.durationSec) * 1000
  ).toISOString();
  const runId = nanoid();

  const run: LoadRun = {
    id: runId,
    projectId: profile.projectId,
    profileId: profile.id,
    profileName: profile.name,
    scenarioLabel: profile.scenarioLabel,
    targetBaseUrl: profile.targetBaseUrl,
    environmentId: options.environmentId,
    engine: profile.engine,
    pattern: profile.pattern,
    environmentLabel: options.environmentLabel,
    status,
    verdict,
    source: profile.engine === "k6_http" ? "k6" : "synthetic",
    metrics,
    notes: options.notes,
    engineVersion: Array.from(
      new Set(workers.map((worker) => worker.engineVersion).filter(Boolean))
    ).join(", ") || undefined,
    executorLabel:
      profile.executionMode === "distributed"
        ? `Local distributed orchestrator (${workerCount} workers)`
        : undefined,
    rawSummaryPath: workers.find((worker) => worker.rawSummaryPath)?.rawSummaryPath,
    compareBaselineRunId: options.compareBaselineRunId,
    startedAt,
    endedAt,
    createdAt: startedAt
  };

  const boundWorkers = workers.map((worker) => ({
    ...worker,
    runId
  }));

  return {
    run,
    workers: boundWorkers,
    sampleWindows: buildSampleWindows(runId, profile, metrics, boundWorkers, startedAt)
  };
};
