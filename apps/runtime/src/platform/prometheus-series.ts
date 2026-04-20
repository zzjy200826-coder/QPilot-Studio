import type { LoadRunSeries, LoadRunSampleWindow } from "@qpilot/shared";
import { LoadRunSeriesSchema } from "@qpilot/shared";

const WINDOW_P95_METRIC = "qpilot_platform_load_run_window_p95_ms";
const WINDOW_ERROR_RATE_METRIC = "qpilot_platform_load_run_window_error_rate_pct";
const WINDOW_THROUGHPUT_METRIC = "qpilot_platform_load_run_window_throughput_rps";
const WINDOW_ACTIVE_WORKERS_METRIC = "qpilot_platform_load_run_window_active_workers";

interface PrometheusVectorEntry {
  metric: Record<string, string>;
  value: [number | string, string];
}

interface PrometheusQueryResponse {
  status: "success" | "error";
  data?: {
    resultType: string;
    result: PrometheusVectorEntry[];
  };
  error?: string;
}

const parseNumber = (value: string | undefined): number => {
  if (!value) {
    return 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, "");

const queryPrometheusMetric = async (
  baseUrl: string,
  metricName: string,
  runId: string
): Promise<PrometheusVectorEntry[]> => {
  const query = `${metricName}{run_id="${runId}"}`;
  const response = await fetch(
    `${normalizeBaseUrl(baseUrl)}/api/v1/query?query=${encodeURIComponent(query)}`
  );

  if (!response.ok) {
    throw new Error(`Prometheus query failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as PrometheusQueryResponse;
  if (payload.status !== "success") {
    throw new Error(payload.error ?? "Prometheus returned a failed query response.");
  }

  return payload.data?.result ?? [];
};

const ensurePoint = (
  map: Map<string, LoadRunSampleWindow>,
  runId: string,
  labels: Record<string, string>
): LoadRunSampleWindow | null => {
  const ts = labels.window_ts;
  if (!ts) {
    return null;
  }

  const existing = map.get(ts);
  if (existing) {
    return existing;
  }

  const point: LoadRunSampleWindow = {
    id: labels.window_id ?? `${runId}:${ts}`,
    runId,
    ts,
    p95Ms: 0,
    errorRatePct: 0,
    throughputRps: 0,
    activeWorkers: 0,
    note: labels.window_source_detail
  };
  map.set(ts, point);
  return point;
};

const assignMetric = (
  map: Map<string, LoadRunSampleWindow>,
  runId: string,
  entries: PrometheusVectorEntry[],
  kind: "p95" | "errorRate" | "throughput" | "activeWorkers"
) => {
  for (const entry of entries) {
    const point = ensurePoint(map, runId, entry.metric);
    if (!point) {
      continue;
    }

    const value = parseNumber(entry.value?.[1]);
    if (kind === "p95") {
      point.p95Ms = value;
    } else if (kind === "errorRate") {
      point.errorRatePct = value;
    } else if (kind === "throughput") {
      point.throughputRps = value;
    } else {
      point.activeWorkers = Math.round(value);
    }
  }
};

export const fetchPrometheusLoadRunSeries = async (params: {
  baseUrl: string;
  runId: string;
}): Promise<LoadRunSeries | null> => {
  const [p95Entries, errorRateEntries, throughputEntries, activeWorkerEntries] =
    await Promise.all([
      queryPrometheusMetric(params.baseUrl, WINDOW_P95_METRIC, params.runId),
      queryPrometheusMetric(params.baseUrl, WINDOW_ERROR_RATE_METRIC, params.runId),
      queryPrometheusMetric(params.baseUrl, WINDOW_THROUGHPUT_METRIC, params.runId),
      queryPrometheusMetric(params.baseUrl, WINDOW_ACTIVE_WORKERS_METRIC, params.runId)
    ]);

  const pointMap = new Map<string, LoadRunSampleWindow>();
  assignMetric(pointMap, params.runId, p95Entries, "p95");
  assignMetric(pointMap, params.runId, errorRateEntries, "errorRate");
  assignMetric(pointMap, params.runId, throughputEntries, "throughput");
  assignMetric(pointMap, params.runId, activeWorkerEntries, "activeWorkers");

  const points = Array.from(pointMap.values()).sort((left, right) =>
    left.ts.localeCompare(right.ts)
  );

  if (points.length === 0) {
    return null;
  }

  return LoadRunSeriesSchema.parse({
    runId: params.runId,
    source: "prometheus",
    detail: "Loaded from Prometheus platform scrape data.",
    queriedAt: new Date().toISOString(),
    points
  });
};

export const buildCachedLoadRunSeries = (params: {
  runId: string;
  detail?: string;
  points: LoadRunSampleWindow[];
}): LoadRunSeries =>
  LoadRunSeriesSchema.parse({
    runId: params.runId,
    source: "sample_window_cache",
    detail: params.detail ?? "Loaded from persisted sample windows.",
    queriedAt: new Date().toISOString(),
    points: params.points
  });
