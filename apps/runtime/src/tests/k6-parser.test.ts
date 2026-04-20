import { describe, expect, it } from "vitest";
import { parseK6Summary } from "../load/k6-parser.js";

describe("k6 parser", () => {
  it("maps a minimal k6 summary into load metrics", () => {
    const metrics = parseK6Summary({
      metrics: {
        http_req_duration: {
          values: {
            med: 120.4,
            "p(95)": 220.8,
            "p(99)": 320.2
          }
        },
        http_req_failed: {
          values: {
            rate: 0.025,
            fails: 25
          }
        },
        http_reqs: {
          values: {
            count: 1000,
            rate: 88.4
          }
        },
        vus_max: {
          values: {
            value: 42
          }
        }
      }
    });

    expect(metrics.p50Ms).toBe(120.4);
    expect(metrics.p95Ms).toBe(220.8);
    expect(metrics.p99Ms).toBe(320.2);
    expect(metrics.errorRatePct).toBe(2.5);
    expect(metrics.throughputRps).toBe(88.4);
    expect(metrics.requestCount).toBe(1000);
    expect(metrics.totalErrors).toBe(25);
    expect(metrics.peakVus).toBe(42);
  });

  it("also supports flat summary-export metric shapes", () => {
    const metrics = parseK6Summary({
      metrics: {
        http_req_duration: {
          med: 0,
          "p(95)": 0.6497,
          "p(99)": 1.25
        },
        http_req_failed: {
          passes: 0,
          fails: 40880,
          value: 0
        },
        http_reqs: {
          count: 40880,
          rate: 8175.792007851321
        },
        vus_max: {
          value: 2,
          max: 2
        }
      }
    });

    expect(metrics.p50Ms).toBe(0);
    expect(metrics.p95Ms).toBe(0.65);
    expect(metrics.p99Ms).toBe(1.25);
    expect(metrics.errorRatePct).toBe(0);
    expect(metrics.throughputRps).toBe(8175.79);
    expect(metrics.requestCount).toBe(40880);
    expect(metrics.totalErrors).toBe(0);
    expect(metrics.peakVus).toBe(2);
  });
});
