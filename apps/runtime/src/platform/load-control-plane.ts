import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  InjectorWorker,
  LoadProfile,
  LoadRun,
  LoadRunMetrics,
  LoadRunSampleWindow,
  LoadRunWorker
} from "@qpilot/shared";
import {
  environmentTargetsTable,
  injectorWorkersTable,
  loadProfilesTable,
  loadRunSampleWindowsTable,
  loadRunWorkersTable,
  loadRunsTable
} from "../db/schema.js";
import { executeDistributedLoadRun } from "../load/distributed-runner.js";
import { executeLoadRun } from "../load/runner.js";
import {
  mapEnvironmentTargetRow,
  mapInjectorWorkerRow,
  mapLoadProfileRow,
  mapLoadRunRow,
  mapLoadRunWorkerRow,
  type EnvironmentTargetRow,
  type InjectorWorkerRow,
  type LoadProfileRow,
  type LoadRunRow,
  type LoadRunWorkerRow
} from "../utils/mappers.js";
import { getWorkerHeartbeatState } from "./worker-heartbeat.js";

const zeroMetrics = (): LoadRunMetrics => ({
  p50Ms: 0,
  p95Ms: 0,
  p99Ms: 0,
  errorRatePct: 0,
  throughputRps: 0,
  peakVus: 0,
  requestCount: 0,
  totalErrors: 0
});

const toEpoch = (value: string): number => Date.parse(value);

const buildLocalWindows = (
  run: LoadRun,
  workerCount: number
): Array<LoadRunSampleWindow> => {
  const windowCount = 6;
  const start = Date.parse(run.startedAt);
  const durationMs = Math.max(
    10_000,
    (Date.parse(run.endedAt ?? run.startedAt) - start) || 30_000
  );
  const interval = Math.max(5_000, Math.round(durationMs / windowCount));

  return Array.from({ length: windowCount }, (_, index) => ({
    id: nanoid(),
    runId: run.id,
    ts: new Date(start + interval * index).toISOString(),
    p95Ms: Math.round(run.metrics.p95Ms * (0.88 + ((index + 1) / windowCount) * 0.2)),
    errorRatePct: Number(
      (run.metrics.errorRatePct * (0.85 + ((index + 1) / windowCount) * 0.18)).toFixed(2)
    ),
    throughputRps: Number(
      (run.metrics.throughputRps * (0.86 + ((index + 1) / windowCount) * 0.15)).toFixed(2)
    ),
    activeWorkers: workerCount,
    note: undefined
  }));
};

const loadProfileById = async (db: any, profileId: string): Promise<LoadProfile> => {
  const profileRows = (await db
    .select()
    .from(loadProfilesTable)
    .where(eq(loadProfilesTable.id, profileId))
    .limit(1)) as LoadProfileRow[];
  const profileRow = profileRows[0];
  if (!profileRow) {
    throw new Error("Load profile not found.");
  }

  return mapLoadProfileRow(profileRow);
};

const loadRunById = async (db: any, runId: string): Promise<LoadRun> => {
  const runRows = (await db
    .select()
    .from(loadRunsTable)
    .where(eq(loadRunsTable.id, runId))
    .limit(1)) as LoadRunRow[];
  const runRow = runRows[0];
  if (!runRow) {
    throw new Error("Platform load run not found.");
  }

  return mapLoadRunRow(runRow);
};

const loadWorkersByRunId = async (db: any, runId: string): Promise<LoadRunWorker[]> => {
  const workerRows = (await db
    .select()
    .from(loadRunWorkersTable)
    .where(eq(loadRunWorkersTable.runId, runId))
    .orderBy(loadRunWorkersTable.workerIndex)) as LoadRunWorkerRow[];

  return workerRows.map(mapLoadRunWorkerRow);
};

const deriveInjectorWorkerIds = async (db: any, profile: LoadProfile): Promise<string[]> => {
  if (!profile.injectorPoolId || profile.executionMode !== "distributed") {
    return [];
  }

  const workerRows = (await db
    .select()
    .from(injectorWorkersTable)
    .where(eq(injectorWorkersTable.poolId, profile.injectorPoolId))
    .orderBy(desc(injectorWorkersTable.updatedAt))) as InjectorWorkerRow[];

  return workerRows
    .filter((worker) => worker.status !== "offline")
    .slice(0, profile.workerCount)
    .map((worker) => worker.id);
};

const reserveInjectorWorkers = async (
  db: any,
  injectorWorkerIds: string[],
  nowIso: string
): Promise<void> => {
  for (const workerId of injectorWorkerIds) {
    const rows = (await db
      .select()
      .from(injectorWorkersTable)
      .where(eq(injectorWorkersTable.id, workerId))
      .limit(1)) as InjectorWorkerRow[];
    const row = rows[0];
    if (!row) {
      continue;
    }

    await db
      .update(injectorWorkersTable)
      .set({
        status: "busy",
        currentRunCount: row.currentRunCount + 1,
        lastHeartbeatAt: toEpoch(nowIso),
        updatedAt: Date.now()
      })
      .where(eq(injectorWorkersTable.id, workerId));
  }
};

const loadInjectorWorkersByIds = async (
  db: any,
  injectorWorkerIds: string[]
): Promise<InjectorWorker[]> => {
  const rows = await Promise.all(
    injectorWorkerIds.map(async (workerId) => {
      const workerRows = (await db
        .select()
        .from(injectorWorkersTable)
        .where(eq(injectorWorkersTable.id, workerId))
        .limit(1)) as InjectorWorkerRow[];
      return workerRows[0];
    })
  );

  return rows
    .filter((row): row is InjectorWorkerRow => Boolean(row))
    .map(mapInjectorWorkerRow);
};

const touchInjectorWorkers = async (
  db: any,
  injectorWorkerIds: string[],
  status: "busy" | "online" | "offline"
): Promise<void> => {
  const now = Date.now();
  for (const workerId of injectorWorkerIds) {
    await db
      .update(injectorWorkersTable)
      .set({
        status,
        lastHeartbeatAt: now,
        updatedAt: now
      })
      .where(eq(injectorWorkersTable.id, workerId));
  }
};

const startInjectorHeartbeatLoop = (params: {
  db: any;
  injectorWorkerIds: string[];
  intervalMs: number;
}): { stop: () => void } => {
  if (params.injectorWorkerIds.length === 0) {
    return { stop: () => undefined };
  }

  const timer = setInterval(() => {
    void touchInjectorWorkers(params.db, params.injectorWorkerIds, "busy");
  }, params.intervalMs);

  return {
    stop: () => clearInterval(timer)
  };
};

const releaseInjectorWorkers = async (
  db: any,
  injectorWorkerIds: string[],
  nowIso: string
): Promise<void> => {
  for (const workerId of injectorWorkerIds) {
    const rows = (await db
      .select()
      .from(injectorWorkersTable)
      .where(eq(injectorWorkersTable.id, workerId))
      .limit(1)) as InjectorWorkerRow[];
    const row = rows[0];
    if (!row) {
      continue;
    }

    const nextRunCount = Math.max(0, row.currentRunCount - 1);

    await db
      .update(injectorWorkersTable)
      .set({
        status: nextRunCount > 0 ? "busy" : "online",
        currentRunCount: nextRunCount,
        lastHeartbeatAt: toEpoch(nowIso),
        updatedAt: Date.now()
      })
      .where(eq(injectorWorkersTable.id, workerId));
  }
};

const buildQueuedRun = (params: {
  profile: LoadProfile;
  environmentId?: string;
  environmentLabel: string;
  notes?: string;
  compareBaselineRunId?: string;
  createdAt: string;
  queueMode: "bullmq" | "inline";
}): LoadRun => ({
  id: nanoid(),
  projectId: params.profile.projectId,
  profileId: params.profile.id,
  profileName: params.profile.name,
  scenarioLabel: params.profile.scenarioLabel,
  targetBaseUrl: params.profile.targetBaseUrl,
  environmentId: params.environmentId,
  engine: params.profile.engine,
  pattern: params.profile.pattern,
  environmentLabel: params.environmentLabel,
  status: "queued",
  verdict: "watch",
  source: params.profile.engine === "k6_http" ? "k6" : "synthetic",
  metrics: zeroMetrics(),
  notes: params.notes,
  engineVersion: undefined,
  executorLabel:
    params.queueMode === "bullmq"
      ? "BullMQ queue orchestrator"
      : "Inline control plane",
  rawSummaryPath: undefined,
  compareBaselineRunId: params.compareBaselineRunId,
  startedAt: params.createdAt,
  endedAt: undefined,
  createdAt: params.createdAt
});

const buildQueuedWorkers = (params: {
  runId: string;
  profile: LoadProfile;
  injectorWorkerIds: string[];
  createdAt: string;
  queueMode: "bullmq" | "inline";
}): LoadRunWorker[] => {
  const workerCount = params.profile.executionMode === "distributed" ? params.profile.workerCount : 1;

  return Array.from({ length: workerCount }, (_, index) => ({
    id: nanoid(),
    runId: params.runId,
    workerIndex: index + 1,
    workerLabel: `worker-${index + 1}`,
    injectorPoolId: params.profile.injectorPoolId,
    injectorWorkerId: params.injectorWorkerIds[index],
    status: "queued",
    metrics: zeroMetrics(),
    notes:
      params.queueMode === "bullmq"
        ? "Queued for BullMQ worker pickup."
        : "Prepared for inline control-plane execution.",
    engineVersion: undefined,
    executorLabel:
      params.queueMode === "bullmq"
        ? "BullMQ queue shard placeholder"
        : "Inline shard placeholder",
    rawSummaryPath: undefined,
    startedAt: params.createdAt,
    endedAt: undefined,
    createdAt: params.createdAt
  }));
};

const persistQueuedRun = async (
  db: any,
  run: LoadRun,
  workers: LoadRunWorker[]
): Promise<void> => {
  await db.insert(loadRunsTable).values({
    id: run.id,
    projectId: run.projectId,
    profileId: run.profileId,
    profileName: run.profileName,
    scenarioLabel: run.scenarioLabel,
    targetBaseUrl: run.targetBaseUrl,
    environmentId: run.environmentId ?? null,
    engine: run.engine,
    pattern: run.pattern,
    environmentLabel: run.environmentLabel,
    status: run.status,
    verdict: run.verdict,
    source: run.source,
    metricsJson: JSON.stringify(run.metrics),
    notes: run.notes ?? null,
    engineVersion: run.engineVersion ?? null,
    executorLabel: run.executorLabel ?? null,
    rawSummaryPath: run.rawSummaryPath ?? null,
    compareBaselineRunId: run.compareBaselineRunId ?? null,
    startedAt: toEpoch(run.startedAt),
    endedAt: run.endedAt ? toEpoch(run.endedAt) : null,
    createdAt: toEpoch(run.createdAt)
  });

  for (const worker of workers) {
    await db.insert(loadRunWorkersTable).values({
      id: worker.id,
      runId: worker.runId,
      workerIndex: worker.workerIndex,
      workerLabel: worker.workerLabel,
      injectorPoolId: worker.injectorPoolId ?? null,
      injectorWorkerId: worker.injectorWorkerId ?? null,
      status: worker.status,
      metricsJson: JSON.stringify(worker.metrics),
      notes: worker.notes ?? null,
      engineVersion: worker.engineVersion ?? null,
      executorLabel: worker.executorLabel ?? null,
      rawSummaryPath: worker.rawSummaryPath ?? null,
      startedAt: toEpoch(worker.startedAt),
      endedAt: worker.endedAt ? toEpoch(worker.endedAt) : null,
      createdAt: toEpoch(worker.createdAt)
    });
  }
};

const writeRunCompletion = async (params: {
  db: any;
  run: LoadRun;
  workers: LoadRunWorker[];
  sampleWindows: LoadRunSampleWindow[];
}): Promise<void> => {
  try {
    await params.db
      .update(loadRunsTable)
      .set({
        status: params.run.status,
        verdict: params.run.verdict,
        source: params.run.source,
        metricsJson: JSON.stringify(params.run.metrics),
        notes: params.run.notes ?? null,
        engineVersion: params.run.engineVersion ?? null,
        executorLabel: params.run.executorLabel ?? null,
        rawSummaryPath: params.run.rawSummaryPath ?? null,
        compareBaselineRunId: params.run.compareBaselineRunId ?? null,
        startedAt: toEpoch(params.run.startedAt),
        endedAt: params.run.endedAt ? toEpoch(params.run.endedAt) : null
      })
      .where(eq(loadRunsTable.id, params.run.id));
  } catch (error) {
    throw new Error(
      `Failed to update load_runs for run ${params.run.id}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  for (const worker of params.workers) {
    try {
      await params.db
        .update(loadRunWorkersTable)
        .set({
          status: worker.status,
          metricsJson: JSON.stringify(worker.metrics),
          notes: worker.notes ?? null,
          engineVersion: worker.engineVersion ?? null,
          executorLabel: worker.executorLabel ?? null,
          rawSummaryPath: worker.rawSummaryPath ?? null,
          startedAt: toEpoch(worker.startedAt),
          endedAt: worker.endedAt ? toEpoch(worker.endedAt) : null
        })
        .where(eq(loadRunWorkersTable.id, worker.id));
    } catch (error) {
      throw new Error(
        `Failed to update load_run_workers row ${worker.id} for run ${params.run.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  try {
    await params.db
      .delete(loadRunSampleWindowsTable)
      .where(eq(loadRunSampleWindowsTable.runId, params.run.id));
  } catch (error) {
    throw new Error(
      `Failed to clear existing load_run_sample_windows for run ${params.run.id}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  for (const sampleWindow of params.sampleWindows) {
    try {
      await params.db.insert(loadRunSampleWindowsTable).values({
        id: sampleWindow.id,
        runId: params.run.id,
        ts: toEpoch(sampleWindow.ts),
        p95Ms: Math.round(sampleWindow.p95Ms),
        errorRatePct: Math.round(sampleWindow.errorRatePct * 100),
        throughputRps: Math.round(sampleWindow.throughputRps * 100),
        activeWorkers: sampleWindow.activeWorkers,
        note: sampleWindow.note ?? null
      });
    } catch (error) {
      throw new Error(
        `Failed to insert load_run_sample_windows row ${sampleWindow.id} for run ${params.run.id} (sample runId ${sampleWindow.runId}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

const appendNote = (base: string | undefined, next: string): string =>
  base?.trim() ? `${base.trim()}\n${next}` : next;

const markInjectorWorkersOffline = async (
  db: any,
  injectorWorkerIds: string[]
): Promise<void> => {
  for (const workerId of injectorWorkerIds) {
    const rows = (await db
      .select()
      .from(injectorWorkersTable)
      .where(eq(injectorWorkersTable.id, workerId))
      .limit(1)) as InjectorWorkerRow[];
    const row = rows[0];
    if (!row) {
      continue;
    }

    await db
      .update(injectorWorkersTable)
      .set({
        status: "offline",
        currentRunCount: Math.max(0, row.currentRunCount - 1),
        updatedAt: Date.now()
      })
      .where(eq(injectorWorkersTable.id, workerId));
  }
};

export const createPlatformLoadRunRecord = async (params: {
  db: any;
  profileId: string;
  environmentId?: string;
  environmentLabel?: string;
  notes?: string;
  queueMode: "bullmq" | "inline";
}): Promise<LoadRun> => {
  const profile = await loadProfileById(params.db, params.profileId);
  const createdAt = new Date().toISOString();
  const siblingRows = (await params.db
    .select()
    .from(loadRunsTable)
    .where(eq(loadRunsTable.profileId, profile.id))
    .orderBy(desc(loadRunsTable.createdAt))
    .limit(1)) as LoadRunRow[];
  const latestBaseline = profile.baselineRunId ?? siblingRows[0]?.id;

  const environmentRows =
    params.environmentId
      ? ((await params.db
          .select()
          .from(environmentTargetsTable)
          .where(eq(environmentTargetsTable.id, params.environmentId))
          .limit(1)) as EnvironmentTargetRow[])
      : [];
  const environmentLabel =
    environmentRows[0] ? mapEnvironmentTargetRow(environmentRows[0]).name : params.environmentLabel ?? "staging";

  const injectorWorkerIds = await deriveInjectorWorkerIds(params.db, profile);
  const run = buildQueuedRun({
    profile,
    environmentId: params.environmentId ?? profile.environmentTargetId,
    environmentLabel,
    notes: params.notes,
    compareBaselineRunId: latestBaseline,
    createdAt,
    queueMode: params.queueMode
  });
  const workers = buildQueuedWorkers({
    runId: run.id,
    profile,
    injectorWorkerIds,
    createdAt,
    queueMode: params.queueMode
  });

  await persistQueuedRun(params.db, run, workers);

  return run;
};

export const recoverTimedOutPlatformLoadRuns = async (params: {
  db: any;
  heartbeatTimeoutMs: number;
}): Promise<string[]> => {
  const runningRunRows = (await params.db
    .select()
    .from(loadRunsTable)
    .where(eq(loadRunsTable.status, "running"))) as LoadRunRow[];
  const now = Date.now();
  const recoveredRunIds: string[] = [];

  for (const runRow of runningRunRows) {
    const run = mapLoadRunRow(runRow);
    const workers = await loadWorkersByRunId(params.db, run.id);
    const activeWorkers = workers.filter((worker) => worker.status === "running");
    if (activeWorkers.length === 0) {
      continue;
    }

    const injectorWorkerIds = activeWorkers
      .map((worker) => worker.injectorWorkerId)
      .filter((value): value is string => Boolean(value));
    if (injectorWorkerIds.length === 0) {
      continue;
    }

    const injectorWorkers = await loadInjectorWorkersByIds(params.db, injectorWorkerIds);
    const heartbeatByInjectorId = new Map(
      injectorWorkers.map((worker) => [
        worker.id,
        getWorkerHeartbeatState({
          lastHeartbeatAt: worker.lastHeartbeatAt,
          timeoutMs: params.heartbeatTimeoutMs,
          now
        })
      ])
    );

    const staleWorkers = activeWorkers.filter((worker) => {
      const heartbeat = worker.injectorWorkerId
        ? heartbeatByInjectorId.get(worker.injectorWorkerId)
        : undefined;
      return !heartbeat || heartbeat.state !== "fresh";
    });

    const runAgeMs = Math.max(0, now - Date.parse(run.startedAt));
    if (staleWorkers.length !== activeWorkers.length || runAgeMs <= params.heartbeatTimeoutMs) {
      continue;
    }

    const endedAt = new Date(now).toISOString();
    const timeoutNote = `Worker heartbeat timed out after ${Math.round(
      params.heartbeatTimeoutMs / 1000
    )} seconds.`;
    const failedRun: LoadRun = {
      ...run,
      status: "failed",
      verdict: "hold",
      endedAt,
      notes: appendNote(run.notes, timeoutNote)
    };
    const failedWorkers = workers.map((worker) => ({
      ...worker,
      status: worker.status === "running" ? ("failed" as const) : worker.status,
      endedAt: worker.status === "running" ? endedAt : worker.endedAt,
      notes:
        worker.status === "running"
          ? appendNote(worker.notes, timeoutNote)
          : worker.notes
    }));

    await writeRunCompletion({
      db: params.db,
      run: failedRun,
      workers: failedWorkers,
      sampleWindows: []
    });
    await markInjectorWorkersOffline(params.db, injectorWorkerIds);
    recoveredRunIds.push(run.id);
  }

  return recoveredRunIds;
};

export const executePersistedPlatformLoadRun = async (params: {
  db: any;
  runId: string;
  heartbeatIntervalMs?: number;
}): Promise<LoadRun> => {
  const initialRun = await loadRunById(params.db, params.runId);
  const profile = await loadProfileById(params.db, initialRun.profileId);
  const workers = await loadWorkersByRunId(params.db, initialRun.id);
  const injectorWorkerIds = workers
    .map((worker) => worker.injectorWorkerId)
    .filter((value): value is string => Boolean(value));
  const startedAt = new Date().toISOString();
  const runningRun: LoadRun = {
    ...initialRun,
    status: "running",
    startedAt,
    endedAt: undefined
  };
  const runningWorkers = workers.map((worker) => ({
    ...worker,
    status: "running" as const,
    startedAt,
    endedAt: undefined,
    notes:
      initialRun.executorLabel === "BullMQ queue orchestrator"
        ? "Picked up by BullMQ worker."
        : "Picked up by inline control plane."
  }));

  await params.db
    .update(loadRunsTable)
    .set({
      status: runningRun.status,
      startedAt: toEpoch(runningRun.startedAt),
      endedAt: null
    })
    .where(eq(loadRunsTable.id, runningRun.id));

  for (const worker of runningWorkers) {
    await params.db
      .update(loadRunWorkersTable)
      .set({
        status: worker.status,
        startedAt: toEpoch(worker.startedAt),
        endedAt: null,
        notes: worker.notes ?? null
      })
      .where(eq(loadRunWorkersTable.id, worker.id));
  }

  await reserveInjectorWorkers(params.db, injectorWorkerIds, startedAt);
  const heartbeatLoop = startInjectorHeartbeatLoop({
    db: params.db,
    injectorWorkerIds,
    intervalMs: params.heartbeatIntervalMs ?? 3_000
  });

  try {
    const executed =
      profile.executionMode === "distributed"
        ? await executeDistributedLoadRun(profile, {
            environmentId: runningRun.environmentId,
            environmentLabel: runningRun.environmentLabel,
            notes: runningRun.notes,
            startedAt,
            compareBaselineRunId: runningRun.compareBaselineRunId,
            injectorPoolId: profile.injectorPoolId,
            injectorWorkerIds
          })
        : null;
    const localRun = !executed
      ? await executeLoadRun(profile, {
          environmentLabel: runningRun.environmentLabel,
          notes: runningRun.notes,
          startedAt
        })
      : null;

    const finalRun: LoadRun = executed?.run ?? {
      ...localRun!,
      id: runningRun.id,
      createdAt: runningRun.createdAt,
      environmentId: runningRun.environmentId,
      compareBaselineRunId: runningRun.compareBaselineRunId
    };
    if (executed) {
      finalRun.id = runningRun.id;
      finalRun.createdAt = runningRun.createdAt;
      finalRun.environmentId = runningRun.environmentId;
      finalRun.compareBaselineRunId = runningRun.compareBaselineRunId;
    }
    const finalWorkers =
      executed?.workers ??
      [
        {
          id: runningWorkers[0]?.id ?? nanoid(),
          runId: finalRun.id,
          workerIndex: 1,
          workerLabel: "worker-1",
          injectorPoolId: profile.injectorPoolId,
          injectorWorkerId: injectorWorkerIds[0],
          status: finalRun.status,
          metrics: finalRun.metrics,
          notes: finalRun.notes,
          engineVersion: finalRun.engineVersion,
          executorLabel: finalRun.executorLabel,
          rawSummaryPath: finalRun.rawSummaryPath,
          startedAt: finalRun.startedAt,
          endedAt: finalRun.endedAt,
          createdAt: finalRun.createdAt
        }
      ];

    const boundWorkers = finalWorkers.map((worker, index) => ({
      ...worker,
      id: runningWorkers[index]?.id ?? worker.id,
      runId: finalRun.id,
      workerIndex: runningWorkers[index]?.workerIndex ?? worker.workerIndex,
      workerLabel: runningWorkers[index]?.workerLabel ?? worker.workerLabel,
      injectorPoolId: runningWorkers[index]?.injectorPoolId ?? worker.injectorPoolId,
      injectorWorkerId: runningWorkers[index]?.injectorWorkerId ?? worker.injectorWorkerId
    }));
    const sampleWindows = (executed?.sampleWindows ?? buildLocalWindows(finalRun, boundWorkers.length)).map(
      (sampleWindow) => ({
        ...sampleWindow,
        runId: finalRun.id
      })
    );

    await writeRunCompletion({
      db: params.db,
      run: finalRun,
      workers: boundWorkers,
      sampleWindows
    });

    return finalRun;
  } catch (error) {
    const endedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "Load execution failed unexpectedly.";
    const failedRun: LoadRun = {
      ...runningRun,
      status: "failed",
      verdict: "hold",
      metrics: zeroMetrics(),
      notes: runningRun.notes ? `${runningRun.notes}\n${message}` : message,
      endedAt
    };
    const failedWorkers = runningWorkers.map((worker) => ({
      ...worker,
      status: "failed" as const,
      endedAt,
      notes: message
    }));

    await writeRunCompletion({
      db: params.db,
      run: failedRun,
      workers: failedWorkers,
      sampleWindows: []
    });

    return failedRun;
  } finally {
    heartbeatLoop.stop();
    await releaseInjectorWorkers(params.db, injectorWorkerIds, new Date().toISOString());
  }
};

export const stopQueuedPlatformLoadRun = async (params: {
  db: any;
  runId: string;
  note: string;
}): Promise<LoadRun> => {
  const run = await loadRunById(params.db, params.runId);
  if (run.status !== "queued") {
    throw new Error("Only queued runs can be cancelled at the moment.");
  }

  const stoppedAt = new Date().toISOString();
  const nextRun: LoadRun = {
    ...run,
    status: "stopped",
    verdict: "hold",
    endedAt: stoppedAt,
    notes: run.notes ? `${run.notes}\n${params.note}` : params.note
  };

  await params.db
    .update(loadRunsTable)
    .set({
      status: nextRun.status,
      verdict: nextRun.verdict,
      notes: nextRun.notes ?? null,
      endedAt: toEpoch(stoppedAt)
    })
    .where(eq(loadRunsTable.id, nextRun.id));

  await params.db
    .update(loadRunWorkersTable)
    .set({
      status: "stopped",
      notes: params.note,
      endedAt: toEpoch(stoppedAt)
    })
    .where(eq(loadRunWorkersTable.runId, nextRun.id));

  return nextRun;
};
