import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { LoadProfile, LoadRun } from "@qpilot/shared";
import { parseK6Summary } from "./k6-parser.js";
import type { ExecuteLoadRunOptions } from "./runner.js";

const execFileAsync = promisify(execFile);

const K6_BIN = process.env.K6_BIN?.trim() || "k6";
const DEFAULT_WINDOWS_K6_BIN = "C:\\Program Files\\k6\\k6.exe";

const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const joinNotes = (...parts: Array<string | undefined>): string | undefined => {
  const entries = parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part));
  return entries.length > 0 ? entries.join("\n") : undefined;
};

const normalizeRequestPath = (requestPath: string | undefined): string =>
  !requestPath || requestPath.trim().length === 0
    ? "/"
    : requestPath.startsWith("/")
      ? requestPath
      : `/${requestPath}`;

const buildTargetUrl = (profile: LoadProfile): string =>
  new URL(normalizeRequestPath(profile.requestPath), profile.targetBaseUrl).toString();

const buildStages = (profile: LoadProfile): Array<{ duration: string; target: number }> | undefined => {
  const totalDuration = Math.max(1, profile.durationSec);
  const rampDuration = Math.max(1, Math.min(profile.rampUpSec || 1, totalDuration));
  const steadyDuration = Math.max(1, totalDuration - rampDuration);

  switch (profile.pattern) {
    case "steady":
      return undefined;
    case "ramp":
    case "soak":
      return [
        { duration: `${rampDuration}s`, target: profile.virtualUsers },
        { duration: `${steadyDuration}s`, target: profile.virtualUsers }
      ];
    case "spike":
      return [
        { duration: `${Math.max(1, Math.floor(rampDuration / 2))}s`, target: Math.max(1, Math.round(profile.virtualUsers * 0.35)) },
        { duration: `${Math.max(1, Math.floor(steadyDuration / 3))}s`, target: profile.virtualUsers },
        { duration: `${Math.max(1, Math.floor(steadyDuration / 3))}s`, target: Math.max(1, Math.round(profile.virtualUsers * 0.45)) },
        { duration: `${Math.max(1, steadyDuration - Math.floor((steadyDuration / 3) * 2))}s`, target: Math.max(1, Math.round(profile.virtualUsers * 0.6)) }
      ];
    case "breakpoint": {
      const segment = Math.max(1, Math.floor(totalDuration / 4));
      return [0.25, 0.5, 0.75, 1].map((ratio, index) => ({
        duration: `${index === 3 ? Math.max(1, totalDuration - segment * 3) : segment}s`,
        target: Math.max(1, Math.round(profile.virtualUsers * ratio))
      }));
    }
    default:
      return undefined;
  }
};

const buildK6Options = (profile: LoadProfile): Record<string, unknown> => {
  const stages = buildStages(profile);
  const summaryTrendStats = ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"];
  return stages
    ? {
        stages,
        summaryTrendStats
      }
    : {
        vus: profile.virtualUsers,
        duration: `${profile.durationSec}s`,
        summaryTrendStats
      };
};

const parseHeaders = (headersJson?: string): Record<string, string> => {
  if (!headersJson?.trim()) {
    return {};
  }

  const parsed = JSON.parse(headersJson) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("headersJson must be a JSON object of string headers.");
  }

  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, typeof value === "string" ? value : String(value)])
  );
};

const buildFailureRun = (
  profile: LoadProfile,
  options: ExecuteLoadRunOptions,
  message: string,
  overrides?: Partial<LoadRun>
): LoadRun => {
  const startedAt = options.startedAt ?? new Date().toISOString();

  return {
    id: `k6_failed_${Date.now()}`,
    projectId: profile.projectId,
    profileId: profile.id,
    profileName: profile.name,
    scenarioLabel: profile.scenarioLabel,
    targetBaseUrl: profile.targetBaseUrl,
    engine: profile.engine,
    pattern: profile.pattern,
    environmentLabel: options.environmentLabel,
    status: "failed",
    verdict: "hold",
    source: "k6",
    metrics: {
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      errorRatePct: 0,
      throughputRps: 0,
      peakVus: profile.virtualUsers,
      requestCount: 0,
      totalErrors: 0
    },
    notes: joinNotes(options.notes, message),
    executorLabel: "Local k6 runner",
    startedAt,
    endedAt: startedAt,
    createdAt: startedAt,
    ...overrides
  };
};

const buildScript = (profile: LoadProfile, headers: Record<string, string>): string => {
  const targetUrl = buildTargetUrl(profile);
  const body =
    profile.httpMethod && !["GET", "HEAD", "OPTIONS"].includes(profile.httpMethod)
      ? profile.bodyTemplate ?? ""
      : null;

  return `
import http from "k6/http";

export const options = ${JSON.stringify(buildK6Options(profile), null, 2)};

const targetUrl = ${JSON.stringify(targetUrl)};
const method = ${JSON.stringify(profile.httpMethod ?? "GET")};
const requestBody = ${JSON.stringify(body)};
const params = { headers: ${JSON.stringify(headers)} };

export default function () {
  http.request(method, targetUrl, requestBody, params);
}
`.trimStart();
};

const readVersion = async (k6Bin: string): Promise<string | undefined> => {
  const { stdout, stderr } = await execFileAsync(k6Bin, ["version"], {
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024
  });
  return (stdout || stderr).trim().split(/\r?\n/)[0]?.trim() || undefined;
};

const isMissingBinaryError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("enoent") || message.includes("not found");
};

const resolveK6Binary = async (): Promise<{ bin: string; version?: string }> => {
  const candidates = Array.from(
    new Set(
      [process.env.K6_BIN?.trim(), K6_BIN, DEFAULT_WINDOWS_K6_BIN].filter(
        (value): value is string => Boolean(value)
      )
    )
  );
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      return {
        bin: candidate,
        version: await readVersion(candidate)
      };
    } catch (error) {
      lastError = error;
      if (!isMissingBinaryError(error)) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("local k6 binary not found");
};

export const executeK6LoadRun = async (
  profile: LoadProfile,
  options: ExecuteLoadRunOptions
): Promise<LoadRun> => {
  const startedAt = options.startedAt ?? new Date().toISOString();

  try {
    const headers = parseHeaders(profile.headersJson);
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "qpilot-k6-"));
    const scriptPath = path.join(tempDir, "script.js");
    const summaryPath = path.join(tempDir, "summary.json");
    const script = buildScript(profile, headers);

    await writeFile(scriptPath, script, "utf8");

    let k6Bin: string;
    let engineVersion: string | undefined;
    try {
      const resolved = await resolveK6Binary();
      k6Bin = resolved.bin;
      engineVersion = resolved.version;
    } catch (error) {
      if (isMissingBinaryError(error)) {
        return buildFailureRun(profile, options, "local k6 binary not found", {
          engineVersion: undefined,
          executorLabel: "k6 (unresolved)"
        });
      }
      return buildFailureRun(profile, options, `Unable to inspect local k6 binary: ${String(error)}`, {
        executorLabel: "k6 (unresolved)"
      });
    }

    try {
      await execFileAsync(
        k6Bin,
        ["run", "--summary-export", summaryPath, scriptPath],
        {
          windowsHide: true,
          maxBuffer: 16 * 1024 * 1024
        }
      );
    } catch (error) {
      const stderr =
        error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string"
          ? error.stderr.trim()
          : undefined;
      const message = stderr || (error instanceof Error ? error.message : String(error));
      return buildFailureRun(profile, options, `k6 execution failed: ${message}`, {
        engineVersion,
        executorLabel: `k6 (${k6Bin})`,
        rawSummaryPath: summaryPath
      });
    }

    let metrics;
    try {
      const rawSummary = await readFile(summaryPath, "utf8");
      metrics = parseK6Summary(JSON.parse(rawSummary));
    } catch (error) {
      return buildFailureRun(
        profile,
        options,
        `Unable to parse k6 summary export: ${error instanceof Error ? error.message : String(error)}`,
        {
          engineVersion,
          executorLabel: `k6 (${k6Bin})`,
          rawSummaryPath: summaryPath
        }
      );
    }

    const passesLatency = metrics.p95Ms <= profile.thresholds.maxP95Ms;
    const passesErrorRate = metrics.errorRatePct <= profile.thresholds.maxErrorRatePct;
    const passesThroughput = metrics.throughputRps >= profile.thresholds.minThroughputRps;

    const status: LoadRun["status"] =
      passesLatency && passesErrorRate && passesThroughput ? "passed" : "failed";
    const verdict: LoadRun["verdict"] =
      status === "failed"
        ? "hold"
        : metrics.p95Ms <= profile.thresholds.maxP95Ms * 0.85 &&
            metrics.errorRatePct <= profile.thresholds.maxErrorRatePct * 0.6 &&
            metrics.throughputRps >= profile.thresholds.minThroughputRps * 1.08
          ? "ship"
          : "watch";

    const endedAt = new Date(
      Date.parse(startedAt) + Math.max(5, profile.durationSec) * 1000
    ).toISOString();

    return {
      id: `k6_${Date.now()}`,
      projectId: profile.projectId,
      profileId: profile.id,
      profileName: profile.name,
      scenarioLabel: profile.scenarioLabel,
      targetBaseUrl: profile.targetBaseUrl,
      engine: profile.engine,
      pattern: profile.pattern,
      environmentLabel: options.environmentLabel,
      status,
      verdict,
      source: "k6",
      metrics: {
        ...metrics,
        throughputRps: round(metrics.throughputRps, 2)
      },
      notes: options.notes,
      engineVersion,
      executorLabel: `k6 (${k6Bin})`,
      rawSummaryPath: summaryPath,
      startedAt,
      endedAt,
      createdAt: startedAt
    };
  } catch (error) {
    return buildFailureRun(
      profile,
      options,
      `Unable to prepare k6 execution: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};
