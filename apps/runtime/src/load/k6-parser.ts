import type { LoadRunMetrics } from "@qpilot/shared";

type MetricValues = Record<string, number>;

interface K6MetricLike {
  values?: MetricValues;
  [key: string]: unknown;
}

interface K6SummaryLike {
  metrics?: Record<string, K6MetricLike | undefined>;
}

const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asMetricValues = (value: unknown): MetricValues | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const entries = Object.entries(value).filter((entry): entry is [string, number] =>
    typeof entry[1] === "number" && Number.isFinite(entry[1])
  );

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const readMetricValues = (
  summary: K6SummaryLike | undefined,
  metricName: string
): MetricValues | undefined => {
  const metric = summary?.metrics?.[metricName];
  if (!metric || typeof metric !== "object") {
    return undefined;
  }

  return asMetricValues(metric.values) ?? asMetricValues(metric);
};

const pickMetricValue = (values: MetricValues | undefined, keys: string[]): number | undefined => {
  if (!values) {
    return undefined;
  }

  for (const key of keys) {
    const direct = asNumber(values[key]);
    if (direct !== undefined) {
      return direct;
    }
  }

  const normalizedKeys = keys.map((key) => key.toLowerCase().replace(/\s+/g, ""));
  for (const [key, value] of Object.entries(values)) {
    const normalized = key.toLowerCase().replace(/\s+/g, "");
    if (normalizedKeys.includes(normalized)) {
      return value;
    }
  }

  return undefined;
};

export const parseK6Summary = (summary: unknown): LoadRunMetrics => {
  const parsed = (summary && typeof summary === "object" ? summary : {}) as K6SummaryLike;
  const durationValues = readMetricValues(parsed, "http_req_duration");
  const requestValues = readMetricValues(parsed, "http_reqs");
  const failedValues = readMetricValues(parsed, "http_req_failed");
  const vusMaxValues = readMetricValues(parsed, "vus_max");
  const vusValues = readMetricValues(parsed, "vus");

  const requestCount = Math.max(
    0,
    Math.round(pickMetricValue(requestValues, ["count", "passes"]) ?? 0)
  );
  const throughputRps = round(pickMetricValue(requestValues, ["rate", "value", "avg"]) ?? 0, 2);
  const errorRate = pickMetricValue(failedValues, ["value", "rate", "avg"]) ?? 0;
  const hasFlatValue = failedValues ? Object.prototype.hasOwnProperty.call(failedValues, "value") : false;
  const hasRate = failedValues ? Object.prototype.hasOwnProperty.call(failedValues, "rate") : false;
  const totalErrors = Math.max(
    0,
    Math.round(
      (hasFlatValue
        ? pickMetricValue(failedValues, ["passes", "count"])
        : hasRate
          ? pickMetricValue(failedValues, ["fails", "count"])
          : pickMetricValue(failedValues, ["fails", "passes", "count"])) ??
        requestCount * Math.max(0, errorRate)
    )
  );

  return {
    p50Ms: round(pickMetricValue(durationValues, ["med", "p(50)", "p50", "avg"]) ?? 0),
    p95Ms: round(
      pickMetricValue(durationValues, ["p(95)", "p95", "p(0.95)", "p(90)", "avg"]) ?? 0
    ),
    p99Ms: round(
      pickMetricValue(durationValues, ["p(99)", "p99", "p(0.99)", "p(95)", "max"]) ??
        pickMetricValue(durationValues, ["p(95)", "p95", "max"]) ??
        0
    ),
    errorRatePct: round(Math.max(0, errorRate) * 100, 2),
    throughputRps,
    peakVus: Math.max(
      0,
      Math.round(
        pickMetricValue(vusMaxValues, ["value", "max"]) ??
          pickMetricValue(vusValues, ["value", "max"]) ??
          0
      )
    ),
    requestCount,
    totalErrors
  };
};
