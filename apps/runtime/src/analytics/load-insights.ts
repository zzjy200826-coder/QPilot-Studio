import type {
  LoadAlert,
  LoadBaselineHistoryEntry,
  LoadDegradationEvent,
  LoadGateDecision,
  LoadGateInput,
  LoadLinkedArtifact,
  LoadProfile,
  LoadRun,
  LoadRunCompare,
  LoadRunDetail,
  LoadRunSampleWindow,
  LoadRunVerdict,
  LoadRunWorker,
  LoadStudioSummary,
  LoadThresholdDiff,
  LoadThresholdCheck
} from "@qpilot/shared";

const hashString = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const normalizeHash = (value: string): number => hashString(value) / 0xffffffff;

const round = (value: number, digits = 1): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const average = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const verdictRank: Record<LoadRun["verdict"], number> = {
  ship: 3,
  watch: 2,
  hold: 1
};

const isPendingRun = (run: LoadRun): boolean =>
  run.status === "queued" || run.status === "running";

export const buildLoadAlerts = (run: LoadRun, profile: LoadProfile): LoadAlert[] => {
  if (isPendingRun(run)) {
    return [
      {
        id: `${run.id}:pending`,
        severity: "info",
        title: run.status === "queued" ? "Run is queued for execution" : "Run is actively executing",
        detail:
          run.status === "queued"
            ? `QPilot is waiting for capacity to start ${profile.scenarioLabel}.`
            : `QPilot is still gathering live evidence for ${profile.scenarioLabel}.`,
        profileId: profile.id,
        runId: run.id
      }
    ];
  }

  const alerts: LoadAlert[] = [];
  const { metrics } = run;
  const { thresholds } = profile;

  if (metrics.p95Ms > thresholds.maxP95Ms) {
    alerts.push({
      id: `${run.id}:p95`,
      severity: run.verdict === "hold" ? "critical" : "warning",
      title: "P95 latency is above threshold",
      detail: `Observed ${metrics.p95Ms} ms against a ${thresholds.maxP95Ms} ms limit.`,
      profileId: profile.id,
      runId: run.id
    });
  }

  if (metrics.errorRatePct > thresholds.maxErrorRatePct) {
    alerts.push({
      id: `${run.id}:error-rate`,
      severity: "critical",
      title: "Error rate is above threshold",
      detail: `Observed ${metrics.errorRatePct}% against a ${thresholds.maxErrorRatePct}% limit.`,
      profileId: profile.id,
      runId: run.id
    });
  }

  if (metrics.throughputRps < thresholds.minThroughputRps) {
    alerts.push({
      id: `${run.id}:throughput`,
      severity: run.verdict === "hold" ? "critical" : "warning",
      title: "Throughput fell below the floor",
      detail: `Observed ${metrics.throughputRps} RPS against a ${thresholds.minThroughputRps} RPS floor.`,
      profileId: profile.id,
      runId: run.id
    });
  }

  if (alerts.length === 0 && run.verdict === "watch") {
    alerts.push({
      id: `${run.id}:watch`,
      severity: "info",
      title: "Capacity is close to the release gate",
      detail: "This run passed, but it is operating with limited headroom.",
      profileId: profile.id,
      runId: run.id
    });
  }

  return alerts;
};

const buildThresholdChecks = (run: LoadRun, profile: LoadProfile): LoadThresholdCheck[] => {
  const { metrics } = run;
  const { thresholds } = profile;

  if (isPendingRun(run)) {
    return [
      {
        id: "latency",
        label: "P95 latency",
        status: "warning",
        actual: metrics.p95Ms,
        target: thresholds.maxP95Ms,
        summary: "Threshold evaluation will start once the run finishes collecting evidence."
      },
      {
        id: "error_rate",
        label: "Error rate",
        status: "warning",
        actual: metrics.errorRatePct,
        target: thresholds.maxErrorRatePct,
        summary: "Threshold evaluation will start once the run finishes collecting evidence."
      },
      {
        id: "throughput",
        label: "Throughput",
        status: "warning",
        actual: metrics.throughputRps,
        target: thresholds.minThroughputRps,
        summary: "Threshold evaluation will start once the run finishes collecting evidence."
      }
    ];
  }

  return [
    {
      id: "latency",
      label: "P95 latency",
      status:
        metrics.p95Ms <= thresholds.maxP95Ms
          ? metrics.p95Ms <= thresholds.maxP95Ms * 0.85
            ? "passed"
            : "warning"
          : "failed",
      actual: metrics.p95Ms,
      target: thresholds.maxP95Ms,
      summary: `Observed ${metrics.p95Ms} ms against a ${thresholds.maxP95Ms} ms budget.`
    },
    {
      id: "error_rate",
      label: "Error rate",
      status:
        metrics.errorRatePct <= thresholds.maxErrorRatePct
          ? metrics.errorRatePct <= thresholds.maxErrorRatePct * 0.6
            ? "passed"
            : "warning"
          : "failed",
      actual: metrics.errorRatePct,
      target: thresholds.maxErrorRatePct,
      summary: `Observed ${metrics.errorRatePct}% against a ${thresholds.maxErrorRatePct}% budget.`
    },
    {
      id: "throughput",
      label: "Throughput",
      status:
        metrics.throughputRps >= thresholds.minThroughputRps
          ? metrics.throughputRps >= thresholds.minThroughputRps * 1.08
            ? "passed"
            : "warning"
          : "failed",
      actual: metrics.throughputRps,
      target: thresholds.minThroughputRps,
      summary: `Observed ${metrics.throughputRps} RPS against a ${thresholds.minThroughputRps} RPS floor.`
    }
  ];
};

const buildThresholdDiff = (params: {
  baselineRun: LoadRun;
  candidateRun: LoadRun;
  profile: LoadProfile;
}): LoadThresholdDiff[] => {
  const baselineMetrics = params.baselineRun.metrics;
  const candidateMetrics = params.candidateRun.metrics;
  const { thresholds } = params.profile;

  const rows = [
    {
      id: "latency" as const,
      label: "P95 latency",
      baseValue: baselineMetrics.p95Ms,
      candidateValue: candidateMetrics.p95Ms,
      target: thresholds.maxP95Ms,
      delta: round(candidateMetrics.p95Ms - baselineMetrics.p95Ms),
      direction:
        candidateMetrics.p95Ms === baselineMetrics.p95Ms
          ? ("unchanged" as const)
          : candidateMetrics.p95Ms < baselineMetrics.p95Ms
            ? ("better" as const)
            : ("worse" as const)
    },
    {
      id: "error_rate" as const,
      label: "Error rate",
      baseValue: baselineMetrics.errorRatePct,
      candidateValue: candidateMetrics.errorRatePct,
      target: thresholds.maxErrorRatePct,
      delta: round(candidateMetrics.errorRatePct - baselineMetrics.errorRatePct, 2),
      direction:
        candidateMetrics.errorRatePct === baselineMetrics.errorRatePct
          ? ("unchanged" as const)
          : candidateMetrics.errorRatePct < baselineMetrics.errorRatePct
            ? ("better" as const)
            : ("worse" as const)
    },
    {
      id: "throughput" as const,
      label: "Throughput",
      baseValue: baselineMetrics.throughputRps,
      candidateValue: candidateMetrics.throughputRps,
      target: thresholds.minThroughputRps,
      delta: round(candidateMetrics.throughputRps - baselineMetrics.throughputRps),
      direction:
        candidateMetrics.throughputRps === baselineMetrics.throughputRps
          ? ("unchanged" as const)
          : candidateMetrics.throughputRps > baselineMetrics.throughputRps
            ? ("better" as const)
            : ("worse" as const)
    }
  ];

  return rows.map((row) => ({
    ...row,
    summary:
      row.direction === "unchanged"
        ? `${row.label} stayed flat at ${row.candidateValue}.`
        : row.direction === "better"
          ? `${row.label} improved by ${Math.abs(row.delta)} against the pinned baseline.`
          : `${row.label} regressed by ${Math.abs(row.delta)} against the pinned baseline.`
  }));
};

const buildWorkerHealthSummary = (workers: LoadRunWorker[]) => {
  const total = workers.length;
  const failed = workers.filter((worker) => worker.status === "failed").length;
  const stale = workers.filter((worker) => worker.heartbeatState === "stale").length;
  const missing = workers.filter((worker) => worker.heartbeatState === "missing").length;
  const healthy = Math.max(0, total - failed - stale - missing);

  return {
    total,
    healthy,
    failed,
    stale,
    missing
  };
};

const buildGateInputs = (params: {
  run: LoadRun;
  workers: LoadRunWorker[];
  thresholdChecks: LoadThresholdCheck[];
  linkedArtifacts: LoadLinkedArtifact[];
}): LoadGateInput[] => {
  const workerFailures = params.workers.filter((worker) => worker.status === "failed").length;
  const staleWorkers = params.workers.filter(
    (worker) =>
      worker.status === "running" &&
      (worker.heartbeatState === "stale" || worker.heartbeatState === "missing")
  ).length;
  const inputs: LoadGateInput[] = params.thresholdChecks.map((check) => ({
    id: `threshold:${check.id}`,
    source: "threshold",
    status: check.status,
    label: check.label,
    detail: check.summary
  }));

  inputs.push({
    id: "workers:health",
    source: "workers",
    status:
      workerFailures === 0 && staleWorkers === 0
        ? "passed"
        : workerFailures + staleWorkers < Math.max(1, Math.ceil(params.workers.length / 2))
          ? "warning"
          : "failed",
    label: "Worker health",
    detail:
      workerFailures === 0 && staleWorkers === 0
        ? "All workers reported healthy execution."
        : staleWorkers > 0
          ? `${workerFailures} workers failed and ${staleWorkers} workers have stale heartbeat signals.`
          : `${workerFailures} of ${params.workers.length} workers ended in a failed state.`
  });

  inputs.push({
    id: "artifacts:summary",
    source: "artifacts",
    status: params.linkedArtifacts.length > 0 ? "passed" : "warning",
    label: "Execution artifacts",
    detail:
      params.linkedArtifacts.length > 0
        ? `${params.linkedArtifacts.length} summary artifacts were persisted.`
        : "No summary artifact was persisted for this run."
  });

  return inputs;
};

const buildGateDecision = (
  run: LoadRun,
  verdict: LoadRun["verdict"],
  gateInputs: LoadGateInput[]
): LoadGateDecision => {
  if (isPendingRun(run)) {
    return {
      verdict: "watch",
      blockerCount: 0,
      watchCount: gateInputs.length,
      summary:
        run.status === "queued"
          ? "This run is queued in the control plane and has not produced gate evidence yet."
          : "This run is still executing, so the gate is in a watch state until live evidence settles."
    };
  }

  const blockerCount = gateInputs.filter((input) => input.status === "failed").length;
  const watchCount = gateInputs.filter((input) => input.status === "warning").length;

  if (verdict === "ship") {
    return {
      verdict,
      blockerCount,
      watchCount,
      summary: "This run stayed healthy across thresholds, workers, and persisted evidence."
    };
  }

  if (verdict === "watch") {
    return {
      verdict,
      blockerCount,
      watchCount,
      summary: "The run stayed mostly healthy, but at least one signal needs attention before promotion."
    };
  }

  return {
    verdict,
    blockerCount,
    watchCount,
    summary: "The run produced blocking evidence and should keep the release gate closed."
  };
};

const buildLinkedArtifacts = (
  run: LoadRun,
  workers: LoadRunWorker[]
): LoadLinkedArtifact[] => {
  const artifacts: LoadLinkedArtifact[] = [];

  if (run.rawSummaryPath) {
    artifacts.push({
      id: `${run.id}:summary`,
      type: "summary",
      label: "Aggregated summary export",
      path: run.rawSummaryPath
    });
  }

  for (const worker of workers) {
    if (!worker.rawSummaryPath) {
      continue;
    }

    artifacts.push({
      id: `${worker.id}:summary`,
      type: "worker_summary",
      label: `${worker.workerLabel} raw export`,
      path: worker.rawSummaryPath
    });
  }

  return artifacts;
};

const buildDegradationTimeline = (
  windows: LoadRunSampleWindow[],
  profile: LoadProfile
): LoadDegradationEvent[] => {
  const events: LoadDegradationEvent[] = [];

  for (const window of windows) {
    if (window.p95Ms > profile.thresholds.maxP95Ms) {
      events.push({
        id: `${window.id}:latency`,
        severity: "critical",
        title: "Latency breached the configured budget",
        detail: `P95 reached ${window.p95Ms} ms against ${profile.thresholds.maxP95Ms} ms.`,
        startedAt: window.ts,
        endedAt: window.ts
      });
    }

    if (window.errorRatePct > profile.thresholds.maxErrorRatePct) {
      events.push({
        id: `${window.id}:errors`,
        severity: "critical",
        title: "Error rate spiked above the threshold",
        detail: `Error rate reached ${window.errorRatePct}% against ${profile.thresholds.maxErrorRatePct}%.`,
        startedAt: window.ts,
        endedAt: window.ts
      });
    }

    if (window.throughputRps < profile.thresholds.minThroughputRps) {
      events.push({
        id: `${window.id}:throughput`,
        severity: "warning",
        title: "Throughput dipped under the floor",
        detail: `Throughput fell to ${window.throughputRps} RPS against ${profile.thresholds.minThroughputRps}.`,
        startedAt: window.ts,
        endedAt: window.ts
      });
    }
  }

  return events.slice(0, 8);
};

const buildGateSummary = (run: LoadRun, alerts: LoadAlert[]): string => {
  if (run.status === "queued") {
    return "The run is queued in the control plane and has not produced threshold evidence yet.";
  }

  if (run.status === "running") {
    return "The run is actively executing, and gate evidence will settle when worker results finish streaming in.";
  }

  if (run.verdict === "ship") {
    return "This run stayed inside the configured latency and error budget with healthy throughput headroom.";
  }

  if (run.verdict === "watch") {
    return alerts.length > 0
      ? "The run passed, but one or more signals are trending close to the release gate."
      : "The run passed with limited headroom and should be watched before release.";
  }

  return "The run failed at least one release threshold and should block promotion until the regression is understood.";
};

const buildTimelineEvents = (params: {
  run: LoadRun;
  thresholdChecks: LoadThresholdCheck[];
  workerSummary: ReturnType<typeof buildWorkerHealthSummary>;
  baselineHistory: LoadBaselineHistoryEntry[];
}) => {
  const events: Array<{
    id: string;
    at: string;
    kind:
      | "run_queued"
      | "run_started"
      | "run_completed"
      | "run_failed"
      | "threshold_breach"
      | "baseline_pinned"
      | "baseline_promoted"
      | "worker_stale";
    title: string;
    detail: string;
  }> = [
    {
      id: `${params.run.id}:queued`,
      at: params.run.createdAt,
      kind: "run_queued" as const,
      title: "Run queued",
      detail: `${params.run.profileName} was queued for ${params.run.environmentLabel}.`
    },
    {
      id: `${params.run.id}:started`,
      at: params.run.startedAt,
      kind: "run_started" as const,
      title: "Run started",
      detail: `${params.run.engine} execution started with verdict target ${params.run.verdict}.`
    }
  ];

  if (params.run.status === "passed" || params.run.status === "stopped") {
    events.push({
      id: `${params.run.id}:completed`,
      at: params.run.endedAt ?? params.run.startedAt,
      kind: "run_completed" as const,
      title: "Run completed",
      detail: `Run finished with ${params.run.verdict.toUpperCase()} verdict.`
    });
  }

  if (params.run.status === "failed") {
    events.push({
      id: `${params.run.id}:failed`,
      at: params.run.endedAt ?? params.run.startedAt,
      kind: "run_failed" as const,
      title: "Run failed",
      detail: params.run.notes ?? "Execution ended in a failed state."
    });
  }

  for (const check of params.thresholdChecks.filter((entry) => entry.status === "failed")) {
    events.push({
      id: `${params.run.id}:${check.id}`,
      at: params.run.endedAt ?? params.run.startedAt,
      kind: "threshold_breach" as const,
      title: `${check.label} breached`,
      detail: check.summary
    });
  }

  if (params.workerSummary.stale > 0 || params.workerSummary.missing > 0) {
    events.push({
      id: `${params.run.id}:worker-stale`,
      at: params.run.endedAt ?? params.run.startedAt,
      kind: "worker_stale" as const,
      title: "Worker heartbeat drift detected",
      detail: `${params.workerSummary.stale} stale and ${params.workerSummary.missing} missing worker heartbeats were observed.`
    });
  }

  for (const entry of params.baselineHistory) {
    events.push({
      id: entry.id,
      at: entry.createdAt,
      kind: entry.action === "promoted" ? "baseline_promoted" : "baseline_pinned",
      title: entry.action === "promoted" ? "Baseline promoted" : "Baseline pinned",
      detail: entry.note ?? `Run ${entry.runId} was recorded as the active baseline.`
    });
  }

  return events.sort((left, right) => left.at.localeCompare(right.at));
};

export const simulateLoadRun = (
  profile: LoadProfile,
  options?: {
    environmentLabel?: string;
    notes?: string;
    startedAt?: string;
  }
): LoadRun => {
  const startedAt = options?.startedAt ?? new Date().toISOString();
  const seedBase = `${profile.id}:${options?.environmentLabel ?? "staging"}:${profile.virtualUsers}:${profile.durationSec}:${profile.pattern}`;
  const jitter = normalizeHash(seedBase);

  const patternLatencyPenalty: Record<LoadProfile["pattern"], number> = {
    ramp: 20,
    steady: 10,
    spike: 90,
    soak: 55,
    breakpoint: 120
  };

  const patternErrorPenalty: Record<LoadProfile["pattern"], number> = {
    ramp: 0.3,
    steady: 0.15,
    spike: 1.4,
    soak: 0.8,
    breakpoint: 1.8
  };

  const engineLatencyPenalty: Record<LoadProfile["engine"], number> = {
    synthetic: 0,
    browser_probe: 95,
    k6_http: 25
  };

  const engineCapacityFactor: Record<LoadProfile["engine"], number> = {
    synthetic: 3.6,
    browser_probe: 1.2,
    k6_http: 2.4
  };

  const baseP50 =
    110 +
    profile.virtualUsers * 1.35 +
    patternLatencyPenalty[profile.pattern] +
    engineLatencyPenalty[profile.engine] +
    jitter * 48;
  const p50Ms = round(baseP50);
  const p95Ms = round(baseP50 * 1.72 + profile.rampUpSec * 0.25 + jitter * 32);
  const p99Ms = round(p95Ms * 1.28 + 24 + jitter * 15);

  const targetThroughput =
    profile.targetRps ?? Math.max(8, profile.virtualUsers * engineCapacityFactor[profile.engine] * 0.92);
  const availableThroughput =
    profile.virtualUsers * engineCapacityFactor[profile.engine] * (0.88 + jitter * 0.16);
  const throughputRps = round(Math.min(targetThroughput, availableThroughput));

  const rawErrorRate =
    0.18 +
    profile.virtualUsers / 180 +
    patternErrorPenalty[profile.pattern] +
    (profile.engine === "browser_probe" ? 0.4 : 0) +
    jitter * 0.9;
  const errorRatePct = round(rawErrorRate, 2);

  const requestCount = Math.max(1, Math.round(throughputRps * profile.durationSec));
  const totalErrors = Math.max(0, Math.round((requestCount * errorRatePct) / 100));

  const passesLatency = p95Ms <= profile.thresholds.maxP95Ms;
  const passesErrorRate = errorRatePct <= profile.thresholds.maxErrorRatePct;
  const passesThroughput = throughputRps >= profile.thresholds.minThroughputRps;
  const status: LoadRun["status"] =
    passesLatency && passesErrorRate && passesThroughput ? "passed" : "failed";

  const verdict: LoadRun["verdict"] =
    status === "failed"
      ? "hold"
      : p95Ms <= profile.thresholds.maxP95Ms * 0.85 &&
          errorRatePct <= profile.thresholds.maxErrorRatePct * 0.6 &&
          throughputRps >= profile.thresholds.minThroughputRps * 1.08
        ? "ship"
        : "watch";

  const endedAt = new Date(
    new Date(startedAt).getTime() + Math.max(8, Math.min(profile.durationSec, 45)) * 1000
  ).toISOString();

  return {
    id: `load_${hashString(`${seedBase}:${startedAt}`).toString(16)}`,
    projectId: profile.projectId,
    profileId: profile.id,
    profileName: profile.name,
    scenarioLabel: profile.scenarioLabel,
    targetBaseUrl: profile.targetBaseUrl,
    engine: profile.engine,
    pattern: profile.pattern,
    environmentLabel: options?.environmentLabel ?? "staging",
    status,
    verdict,
    source: "synthetic",
    metrics: {
      p50Ms,
      p95Ms,
      p99Ms,
      errorRatePct,
      throughputRps,
      peakVus: profile.virtualUsers,
      requestCount,
      totalErrors
    },
    notes: options?.notes,
    executorLabel:
      profile.engine === "browser_probe" ? "Browser probe adapter" : "Synthetic adapter",
    startedAt,
    endedAt,
    createdAt: startedAt
  };
};

const buildExecutionNotes = (
  run: LoadRun,
  profile: LoadProfile,
  thresholdChecks: LoadThresholdCheck[],
  workers: LoadRunWorker[]
): string[] => {
  const notes: string[] = [];

  if (run.notes?.trim()) {
    notes.push(run.notes.trim());
  }

  if (run.status === "queued") {
    notes.push("This run is waiting in the control plane queue for an available worker.");
  } else if (run.status === "running") {
    notes.push("This run is currently executing and will update when worker evidence is persisted.");
  }

  if (run.source === "k6" && !run.engineVersion) {
    notes.push("k6 completed without returning a version string.");
  }

  if (run.source === "k6" && !run.rawSummaryPath && run.status !== "running" && run.status !== "queued") {
    notes.push("Raw k6 summary artifact was not persisted for this run.");
  }

  if (run.verdict === "hold" || thresholdChecks.some((check) => check.status === "failed")) {
    notes.push(
      `Release thresholds failed for ${profile.scenarioLabel}. Keep this scenario blocked until the regression is understood.`
    );
  } else if (run.verdict === "watch") {
    notes.push(
      `Capacity stayed inside the gate, but ${profile.scenarioLabel} is operating with limited headroom.`
    );
  }

  if (profile.executionMode === "distributed") {
    const failedWorkers = workers.filter((worker) => worker.status === "failed").length;
    const staleWorkers = workers.filter(
      (worker) =>
        worker.status === "running" &&
        (worker.heartbeatState === "stale" || worker.heartbeatState === "missing")
    ).length;
    notes.push(
      failedWorkers > 0
        ? `${profile.workerCount} workers were scheduled and ${failedWorkers} reported failed execution.`
        : `${profile.workerCount} workers completed the distributed plan.`
    );
    if (staleWorkers > 0) {
      notes.push(
        `${staleWorkers} workers are still marked running, but their heartbeat is stale. The control plane may fail this run if the worker does not recover.`
      );
    }
  }

  return Array.from(new Set(notes));
};

export const buildLoadStudioSummary = (
  profiles: LoadProfile[],
  runs: LoadRun[]
): LoadStudioSummary => {
  const sortedProfiles = [...profiles].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
  const sortedRuns = [...runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const profileById = new Map(sortedProfiles.map((profile) => [profile.id, profile]));
  const topAlerts = sortedRuns
    .flatMap((run) => {
      const profile = profileById.get(run.profileId);
      return profile ? buildLoadAlerts(run, profile) : [];
    })
    .slice(0, 6);

  return {
    projectId: sortedProfiles[0]?.projectId ?? sortedRuns[0]?.projectId,
    profileCount: profiles.length,
    runCount: runs.length,
    activeRunCount: runs.filter((run) => run.status === "queued" || run.status === "running").length,
    avgP95Ms: round(average(runs.map((run) => run.metrics.p95Ms))),
    avgErrorRatePct: round(average(runs.map((run) => run.metrics.errorRatePct)), 2),
    latestVerdict: sortedRuns[0]?.verdict,
    profiles: sortedProfiles,
    recentRuns: sortedRuns.slice(0, 8),
    topAlerts
  };
};

export const buildLoadRunDetail = (params: {
  run: LoadRun;
  profile: LoadProfile;
  siblingRuns: LoadRun[];
  workers?: LoadRunWorker[];
  sampleWindows?: LoadRunSampleWindow[];
  baselineHistory?: LoadBaselineHistoryEntry[];
}): LoadRunDetail => {
  const alerts = buildLoadAlerts(params.run, params.profile);
  const thresholdChecks = buildThresholdChecks(params.run, params.profile);
  const workers = params.workers ?? [];
  const sampleWindows = params.sampleWindows ?? [];
  const baselineHistory = params.baselineHistory ?? [];
  const linkedArtifacts = buildLinkedArtifacts(params.run, workers);
  const gateInputs = buildGateInputs({
    run: params.run,
    workers,
    thresholdChecks,
    linkedArtifacts
  });
  const gateDecision = buildGateDecision(params.run, params.run.verdict, gateInputs);
  const executionNotes = buildExecutionNotes(
    params.run,
    params.profile,
    thresholdChecks,
    workers
  );
  const recentSiblingRuns = [...params.siblingRuns]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 6);
  const compareBaselineRunId =
    params.run.compareBaselineRunId ??
    params.profile.baselineRunId ??
    recentSiblingRuns.find(
      (entry) => entry.id !== params.run.id && verdictRank[entry.verdict] >= verdictRank.watch
    )?.id;
  const compareBaselineSnapshot = compareBaselineRunId
    ? recentSiblingRuns.find((entry) => entry.id === compareBaselineRunId)
    : undefined;
  const thresholdDiff =
    compareBaselineSnapshot && compareBaselineSnapshot.id !== params.run.id
      ? buildThresholdDiff({
          baselineRun: compareBaselineSnapshot,
          candidateRun: params.run,
          profile: params.profile
        })
      : [];
  const workerHealthSummary = buildWorkerHealthSummary(workers);
  const timelineEvents = buildTimelineEvents({
    run: params.run,
    thresholdChecks,
    workerSummary: workerHealthSummary,
    baselineHistory
  });

  return {
    source: params.run.source,
    run: params.run,
    profile: params.profile,
    alerts,
    thresholdChecks,
    gateSummary: buildGateSummary(params.run, alerts),
    executionNotes,
    recentSiblingRuns
    ,
    workers,
    timeSeriesSummary: sampleWindows,
    linkedArtifacts,
    degradationTimeline: buildDegradationTimeline(sampleWindows, params.profile),
    gateInputs,
    gateDecision,
    compareBaselineRunId,
    compareBaselineSnapshot,
    thresholdDiff,
    workerHealthSummary,
    timelineEvents,
    baselineHistory
  };
};

export const buildLoadRunCompare = (params: {
  baselineRun: LoadRun;
  candidateRun: LoadRun;
  baselineProfile: LoadProfile;
  candidateProfile: LoadProfile;
  baselineWorkers?: LoadRunWorker[];
  candidateWorkers?: LoadRunWorker[];
  baselineWindows?: LoadRunSampleWindow[];
  candidateWindows?: LoadRunSampleWindow[];
}): LoadRunCompare => {
  const baselineWorkers = params.baselineWorkers ?? [];
  const candidateWorkers = params.candidateWorkers ?? [];
  const thresholdDiff = buildThresholdDiff({
    baselineRun: params.baselineRun,
    candidateRun: params.candidateRun,
    profile: params.candidateProfile
  });
  const baselineWorkerSummary = buildWorkerHealthSummary(baselineWorkers);
  const candidateWorkerSummary = buildWorkerHealthSummary(candidateWorkers);
  const baselineEventCount = buildDegradationTimeline(
    params.baselineWindows ?? [],
    params.baselineProfile
  ).length;
  const candidateEventCount = buildDegradationTimeline(
    params.candidateWindows ?? [],
    params.candidateProfile
  ).length;
  const regression =
    verdictRank[params.candidateRun.verdict as LoadRunVerdict] <
      verdictRank[params.baselineRun.verdict as LoadRunVerdict] ||
    thresholdDiff.some((entry) => entry.direction === "worse") ||
    candidateEventCount > baselineEventCount;

  return {
    baselineRun: params.baselineRun,
    candidateRun: params.candidateRun,
    baselineProfile: params.baselineProfile,
    candidateProfile: params.candidateProfile,
    thresholdDiff,
    workerDiff: {
      baselineWorkers: baselineWorkers.length,
      candidateWorkers: candidateWorkers.length,
      failedDelta: candidateWorkerSummary.failed - baselineWorkerSummary.failed,
      staleDelta:
        candidateWorkerSummary.stale +
        candidateWorkerSummary.missing -
        (baselineWorkerSummary.stale + baselineWorkerSummary.missing),
      summary: regression
        ? "Candidate run regressed against the selected baseline."
        : "Candidate run stayed flat or improved against the selected baseline."
    },
    degradationDiff: {
      baselineEventCount,
      candidateEventCount,
      regression,
      summary: regression
        ? `${candidateEventCount} degradation events were detected, compared with ${baselineEventCount} on the baseline.`
        : "Candidate run did not introduce additional degradation events."
    },
    compareBaselineRunId: params.baselineRun.id
  };
};
