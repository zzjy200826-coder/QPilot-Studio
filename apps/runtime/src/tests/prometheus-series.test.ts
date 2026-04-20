import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCachedLoadRunSeries,
  fetchPrometheusLoadRunSeries
} from "../platform/prometheus-series.js";

describe("prometheus load run series", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses per-window metrics from Prometheus vector queries", async () => {
    const responsePayload = (metric: string, value: string) => ({
      status: "success",
      data: {
        resultType: "vector",
        result: [
          {
            metric: {
              __name__: metric,
              run_id: "run-1",
              window_id: "window-1",
              window_ts: "2026-04-18T10:00:00.000Z"
            },
            value: [1713434400, value]
          }
        ]
      }
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("p95")) {
        return new Response(JSON.stringify(responsePayload("p95", "180")), { status: 200 });
      }
      if (url.includes("error_rate")) {
        return new Response(JSON.stringify(responsePayload("error_rate", "0.5")), { status: 200 });
      }
      if (url.includes("throughput")) {
        return new Response(JSON.stringify(responsePayload("throughput", "220")), {
          status: 200
        });
      }
      return new Response(JSON.stringify(responsePayload("active_workers", "3")), { status: 200 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const series = await fetchPrometheusLoadRunSeries({
      baseUrl: "http://localhost:9090",
      runId: "run-1"
    });

    expect(series?.source).toBe("prometheus");
    expect(series?.points).toHaveLength(1);
    expect(series?.points[0]).toMatchObject({
      runId: "run-1",
      p95Ms: 180,
      errorRatePct: 0.5,
      throughputRps: 220,
      activeWorkers: 3
    });
  });

  it("builds cache-backed load series envelopes", () => {
    const series = buildCachedLoadRunSeries({
      runId: "run-2",
      points: [
        {
          id: "window-2",
          runId: "run-2",
          ts: "2026-04-18T10:05:00.000Z",
          p95Ms: 320,
          errorRatePct: 1.2,
          throughputRps: 140,
          activeWorkers: 2
        }
      ]
    });

    expect(series.source).toBe("sample_window_cache");
    expect(series.points[0]?.id).toBe("window-2");
  });
});
