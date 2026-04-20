import { desc, eq } from "drizzle-orm";
import type {
  ControlTowerSummary,
  LoadRun,
  LoadRunSampleWindow,
  PlatformInfrastructureSummary
} from "@qpilot/shared";
import {
  injectorWorkersTable,
  loadRunSampleWindowsTable,
  loadRunsTable,
  releaseCandidatesTable,
  releaseGateResultsTable
} from "../db/schema.js";
import { buildControlTowerSummary } from "../platform/gate-center.js";
import {
  mapGateResultRow,
  mapInjectorWorkerRow,
  mapLoadRunRow,
  mapLoadRunSampleWindowRow,
  mapReleaseCandidateRow,
  type GateResultRow,
  type InjectorWorkerRow,
  type LoadRunRow,
  type LoadRunSampleWindowRow,
  type ReleaseCandidateRow
} from "../utils/mappers.js";

interface PlatformMetricsSnapshot {
  controlTower: ControlTowerSummary;
  infrastructure: PlatformInfrastructureSummary;
  loadRuns: LoadRun[];
  loadRunWindows: LoadRunSampleWindow[];
  generatedAt: string;
}

const escapeLabelValue = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

const pushGaugeMetric = (
  lines: string[],
  name: string,
  help: string,
  value: number,
  labels?: Record<string, string | number>
) => {
  if (!lines.some((line) => line.startsWith(`# HELP ${name} `))) {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} gauge`);
  }

  const labelText = labels
    ? `{${Object.entries(labels)
        .map(([key, labelValue]) => `${key}="${escapeLabelValue(String(labelValue))}"`)
        .join(",")}}`
    : "";

  lines.push(`${name}${labelText} ${Number.isFinite(value) ? value : 0}`);
};

const buildLatestRunSeries = (runs: LoadRun[]): LoadRun[] => {
  const latestByProfile = new Map<string, LoadRun>();

  for (const run of [...runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt))) {
    if (!latestByProfile.has(run.profileId)) {
      latestByProfile.set(run.profileId, run);
    }
  }

  return Array.from(latestByProfile.values());
};

export const collectPlatformMetricsSnapshot = async (params: {
  db: any;
  infrastructure: PlatformInfrastructureSummary;
  projectId?: string;
}): Promise<PlatformMetricsSnapshot> => {
  const releaseQuery = params.db
    .select()
    .from(releaseCandidatesTable)
    .orderBy(desc(releaseCandidatesTable.createdAt));
  const releaseRows = (await (params.projectId
    ? releaseQuery.where(eq(releaseCandidatesTable.projectId, params.projectId))
    : releaseQuery)) as ReleaseCandidateRow[];
  const gateRows = (await params.db
    .select()
    .from(releaseGateResultsTable)
    .orderBy(desc(releaseGateResultsTable.evaluatedAt))) as GateResultRow[];
  const loadRunQuery = params.db
    .select()
    .from(loadRunsTable)
    .orderBy(desc(loadRunsTable.createdAt));
  const loadRunRows = (await (params.projectId
    ? loadRunQuery.where(eq(loadRunsTable.projectId, params.projectId))
    : loadRunQuery)) as LoadRunRow[];
  const injectorWorkerRows = (await params.db
    .select()
    .from(injectorWorkersTable)
    .orderBy(desc(injectorWorkersTable.updatedAt))) as InjectorWorkerRow[];
  const loadRunWindowRows = (await params.db
    .select()
    .from(loadRunSampleWindowsTable)
    .orderBy(desc(loadRunSampleWindowsTable.ts))) as LoadRunSampleWindowRow[];

  const controlTower = buildControlTowerSummary({
    releases: releaseRows.map(mapReleaseCandidateRow),
    gateResults: gateRows.map(mapGateResultRow),
    loadRuns: loadRunRows.map(mapLoadRunRow),
    injectorWorkers: injectorWorkerRows.map(mapInjectorWorkerRow)
  });

  return {
    controlTower,
    infrastructure: params.infrastructure,
    loadRuns: loadRunRows.map(mapLoadRunRow),
    loadRunWindows: loadRunWindowRows.map(mapLoadRunSampleWindowRow),
    generatedAt: new Date().toISOString()
  };
};

export const buildPrometheusMetricsDocument = (
  snapshot: PlatformMetricsSnapshot
): string => {
  const lines: string[] = [];

  pushGaugeMetric(
    lines,
    "qpilot_control_tower_active_releases",
    "Number of active release candidates currently tracked by the control tower.",
    snapshot.controlTower.activeReleaseCount
  );
  pushGaugeMetric(
    lines,
    "qpilot_control_tower_blocked_releases",
    "Number of release candidates currently blocked by gate verdicts.",
    snapshot.controlTower.blockedReleaseCount
  );
  pushGaugeMetric(
    lines,
    "qpilot_control_tower_active_load_runs",
    "Number of load runs currently active in the platform snapshot.",
    snapshot.controlTower.activeLoadRunCount
  );
  pushGaugeMetric(
    lines,
    "qpilot_control_tower_online_workers",
    "Number of injector workers currently online.",
    snapshot.controlTower.onlineWorkerCount
  );

  for (const service of snapshot.infrastructure.services) {
    pushGaugeMetric(
      lines,
      "qpilot_platform_infra_service_up",
      "Whether a platform infrastructure dependency is online in the latest probe.",
      service.state === "online" ? 1 : 0,
      { service: service.id }
    );
    pushGaugeMetric(
      lines,
      "qpilot_platform_infra_service_configured",
      "Whether a platform infrastructure dependency is configured for the runtime.",
      service.configured ? 1 : 0,
      { service: service.id }
    );
    pushGaugeMetric(
      lines,
      "qpilot_platform_infra_service_state",
      "One-hot encoded infrastructure state by service.",
      1,
      { service: service.id, state: service.state }
    );
    if (typeof service.latencyMs === "number") {
      pushGaugeMetric(
        lines,
        "qpilot_platform_infra_service_latency_ms",
        "Latest successful or attempted probe latency for a platform dependency.",
        service.latencyMs,
        { service: service.id }
      );
    }
  }

  const runBuckets = new Map<
    string,
    {
      count: number;
      labels: {
        status: LoadRun["status"];
        verdict: LoadRun["verdict"];
        engine: LoadRun["engine"];
        source: LoadRun["source"];
      };
    }
  >();
  for (const run of snapshot.loadRuns) {
    const bucketKey = [run.status, run.verdict, run.engine, run.source].join("|");
    const previous = runBuckets.get(bucketKey);
    runBuckets.set(bucketKey, {
      count: (previous?.count ?? 0) + 1,
      labels: {
        status: run.status,
        verdict: run.verdict,
        engine: run.engine,
        source: run.source
      }
    });
  }

  for (const [, bucket] of runBuckets.entries()) {
    pushGaugeMetric(
      lines,
      "qpilot_platform_load_runs_total",
      "Snapshot count of persisted platform load runs grouped by status, verdict, engine, and source.",
      bucket.count,
      bucket.labels
    );
  }

  for (const run of buildLatestRunSeries(snapshot.loadRuns)) {
    pushGaugeMetric(
      lines,
      "qpilot_platform_latest_load_p95_ms",
      "Latest observed P95 latency per load profile.",
      run.metrics.p95Ms,
      {
        profile_id: run.profileId,
        profile_name: run.profileName,
        environment: run.environmentLabel
      }
    );
    pushGaugeMetric(
      lines,
      "qpilot_platform_latest_load_error_rate_pct",
      "Latest observed error rate percentage per load profile.",
      run.metrics.errorRatePct,
      {
        profile_id: run.profileId,
        profile_name: run.profileName,
        environment: run.environmentLabel
      }
    );
    pushGaugeMetric(
      lines,
      "qpilot_platform_latest_load_throughput_rps",
      "Latest observed throughput per load profile.",
      run.metrics.throughputRps,
      {
        profile_id: run.profileId,
        profile_name: run.profileName,
        environment: run.environmentLabel
      }
    );
  }

  const runMetadata = new Map(
    snapshot.loadRuns.map((run) => [
      run.id,
      {
        profileId: run.profileId,
        profileName: run.profileName,
        environment: run.environmentLabel
      }
    ])
  );

  for (const point of snapshot.loadRunWindows) {
    const metadata = runMetadata.get(point.runId);
    const labels = {
      run_id: point.runId,
      profile_id: metadata?.profileId ?? "unknown",
      profile_name: metadata?.profileName ?? "unknown",
      environment: metadata?.environment ?? "unknown",
      window_id: point.id,
      window_ts: point.ts
    };
    pushGaugeMetric(
      lines,
      "qpilot_platform_load_run_window_p95_ms",
      "Persisted per-window P95 latency for a platform load run.",
      point.p95Ms,
      labels
    );
    pushGaugeMetric(
      lines,
      "qpilot_platform_load_run_window_error_rate_pct",
      "Persisted per-window error rate percentage for a platform load run.",
      point.errorRatePct,
      labels
    );
    pushGaugeMetric(
      lines,
      "qpilot_platform_load_run_window_throughput_rps",
      "Persisted per-window throughput for a platform load run.",
      point.throughputRps,
      labels
    );
    pushGaugeMetric(
      lines,
      "qpilot_platform_load_run_window_active_workers",
      "Persisted per-window active worker count for a platform load run.",
      point.activeWorkers,
      labels
    );
  }

  pushGaugeMetric(
    lines,
    "qpilot_platform_metrics_generated_unixtime",
    "Unix timestamp for when the runtime rendered this Prometheus metrics snapshot.",
    Math.floor(Date.parse(snapshot.generatedAt) / 1000)
  );

  return `${lines.join("\n")}\n`;
};
