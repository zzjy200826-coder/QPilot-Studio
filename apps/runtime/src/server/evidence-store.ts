import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  ConsoleEvidenceEntry,
  LLMDecision,
  NetworkEvidenceEntry,
  PlannerTrace,
  RunEvidence
} from "@qpilot/shared";
import { RunEvidenceSchema } from "@qpilot/shared";
import { nanoid } from "nanoid";
import type { ConsoleMessage, Page, Request, Response } from "playwright";

const MAX_CONSOLE_ENTRIES = 240;
const MAX_NETWORK_ENTRIES = 320;
const MAX_PLANNER_TRACES = 48;
const MAX_BODY_PREVIEW_CHARS = 1200;
const MAX_CAPTURED_BODY_BYTES = 24_000;

interface MutableRunEvidence {
  runId: string;
  updatedAt: string;
  console: ConsoleEvidenceEntry[];
  network: NetworkEvidenceEntry[];
  planners: PlannerTrace[];
}

const nowIso = (): string => new Date().toISOString();

const toUrlMeta = (
  value: string
): {
  host?: string;
  pathname?: string;
} => {
  try {
    const url = new URL(value);
    return {
      host: url.host,
      pathname: url.pathname
    };
  } catch {
    return {};
  }
};

const shouldCaptureBodyPreview = (
  response: Response,
  resourceType: string
): boolean => {
  if (resourceType !== "xhr" && resourceType !== "fetch") {
    return false;
  }

  const contentType = response.headers()["content-type"] ?? "";
  const contentLength = Number(response.headers()["content-length"] ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_CAPTURED_BODY_BYTES) {
    return false;
  }

  return /(json|text|javascript|xml|form-urlencoded)/i.test(contentType);
};

const readBodyPreview = async (
  response: Response,
  resourceType: string
): Promise<string | undefined> => {
  if (!shouldCaptureBodyPreview(response, resourceType)) {
    return undefined;
  }

  const raw = await response.text().catch(() => undefined);
  if (!raw) {
    return undefined;
  }

  return raw.slice(0, MAX_BODY_PREVIEW_CHARS);
};

const pushLimited = <T>(items: T[], next: T, max: number): T[] => {
  const merged = [...items, next];
  if (merged.length <= max) {
    return merged;
  }
  return merged.slice(merged.length - max);
};

const consoleType = (message: ConsoleMessage): ConsoleEvidenceEntry["type"] => {
  switch (message.type()) {
    case "error":
      return "error";
    case "warning":
      return "warning";
    case "debug":
      return "debug";
    case "info":
      return "info";
    default:
      return "log";
  }
};

const formatConsoleLocation = (message: ConsoleMessage): string | undefined => {
  const location = message.location();
  if (!location.url) {
    return undefined;
  }

  const line = typeof location.lineNumber === "number" ? location.lineNumber + 1 : null;
  const column = typeof location.columnNumber === "number" ? location.columnNumber + 1 : null;
  const suffix =
    line !== null
      ? column !== null
        ? `:${line}:${column}`
        : `:${line}`
      : "";
  return `${location.url}${suffix}`;
};

export class EvidenceStore {
  private readonly runs = new Map<string, MutableRunEvidence>();
  private readonly requestIds = new WeakMap<Request, { id: string; ts: string }>();
  private readonly activeStepByRun = new Map<string, number>();

  constructor(private readonly artifactsRoot: string) {}

  initRun(runId: string): void {
    this.runs.set(runId, {
      runId,
      updatedAt: nowIso(),
      console: [],
      network: [],
      planners: []
    });
  }

  private ensure(runId: string): MutableRunEvidence {
    const existing = this.runs.get(runId);
    if (existing) {
      return existing;
    }

    const created: MutableRunEvidence = {
      runId,
      updatedAt: nowIso(),
      console: [],
      network: [],
      planners: []
    };
    this.runs.set(runId, created);
    return created;
  }

  private update(runId: string, apply: (current: MutableRunEvidence) => MutableRunEvidence): void {
    const current = this.ensure(runId);
    this.runs.set(runId, apply(current));
  }

  recordConsole(
    runId: string,
    entry: Omit<ConsoleEvidenceEntry, "id" | "ts">
  ): void {
    const next: ConsoleEvidenceEntry = {
      id: nanoid(),
      ts: nowIso(),
      ...entry
    };

    this.update(runId, (current) => ({
      ...current,
      updatedAt: next.ts,
      console: pushLimited(current.console, next, MAX_CONSOLE_ENTRIES)
    }));
  }

  recordNetwork(
    runId: string,
    entry: Omit<NetworkEvidenceEntry, "id" | "ts">
  ): NetworkEvidenceEntry {
    const next: NetworkEvidenceEntry = {
      id: nanoid(),
      ts: nowIso(),
      stepIndex: this.activeStepByRun.get(runId),
      ...entry
    };

    this.update(runId, (current) => ({
      ...current,
      updatedAt: next.ts,
      network: pushLimited(current.network, next, MAX_NETWORK_ENTRIES)
    }));
    return next;
  }

  patchNetwork(
    runId: string,
    entryId: string,
    patch: Partial<Pick<NetworkEvidenceEntry, "bodyPreview" | "contentType">>
  ): void {
    this.update(runId, (current) => ({
      ...current,
      updatedAt: nowIso(),
      network: current.network.map((entry) =>
        entry.id === entryId
          ? {
              ...entry,
              ...patch
            }
          : entry
      )
    }));
  }

  setActiveStep(runId: string, stepIndex?: number): void {
    if (typeof stepIndex === "number" && stepIndex > 0) {
      this.activeStepByRun.set(runId, stepIndex);
      return;
    }
    this.activeStepByRun.delete(runId);
  }

  recordPlanner(runId: string, input: {
    stepIndex: number;
    prompt: string;
    rawResponse: string;
    decision?: LLMDecision;
    cacheHit?: boolean;
    cacheKey?: string;
  }): void {
    const next: PlannerTrace = {
      id: nanoid(),
      ts: nowIso(),
      stepIndex: input.stepIndex,
      prompt: input.prompt,
      rawResponse: input.rawResponse,
      decision: input.decision,
      cacheHit: input.cacheHit,
      cacheKey: input.cacheKey
    };

    this.update(runId, (current) => ({
      ...current,
      updatedAt: next.ts,
      planners: pushLimited(current.planners, next, MAX_PLANNER_TRACES)
    }));
  }

  attachPage(runId: string, page: Page): () => void {
    const handleConsole = (message: ConsoleMessage): void => {
      this.recordConsole(runId, {
        type: consoleType(message),
        text: message.text(),
        location: formatConsoleLocation(message)
      });
    };

    const handlePageError = (error: Error): void => {
      this.recordConsole(runId, {
        type: "pageerror",
        text: error.message
      });
    };

    const handleRequest = (request: Request): void => {
      this.requestIds.set(request, {
        id: nanoid(),
        ts: nowIso()
      });
    };

    const handleResponse = (response: Response): void => {
      const request = response.request();
      const requestMeta = this.requestIds.get(request);
      const resourceType = request.resourceType();
      const url = response.url();
      const recorded = this.recordNetwork(runId, {
        phase: "response",
        method: request.method(),
        url,
        ...toUrlMeta(url),
        resourceType,
        status: response.status(),
        ok: response.ok(),
        contentType: response.headers()["content-type"]
      });
      void readBodyPreview(response, resourceType).then((bodyPreview) => {
        if (!bodyPreview) {
          return;
        }
        this.patchNetwork(runId, recorded.id, {
          bodyPreview
        });
      });

      if (requestMeta) {
        this.requestIds.delete(request);
      }
    };

    const handleRequestFailed = (request: Request): void => {
      const failure = request.failure();
      const url = request.url();
      this.recordNetwork(runId, {
        phase: "failed",
        method: request.method(),
        url,
        ...toUrlMeta(url),
        resourceType: request.resourceType(),
        failureText: failure?.errorText
      });
      this.requestIds.delete(request);
    };

    page.on("console", handleConsole);
    page.on("pageerror", handlePageError);
    page.on("request", handleRequest);
    page.on("response", handleResponse);
    page.on("requestfailed", handleRequestFailed);

    return () => {
      page.off("console", handleConsole);
      page.off("pageerror", handlePageError);
      page.off("request", handleRequest);
      page.off("response", handleResponse);
      page.off("requestfailed", handleRequestFailed);
    };
  }

  getEvidence(runId: string): RunEvidence | null {
    const current = this.runs.get(runId);
    if (!current) {
      return null;
    }

    return RunEvidenceSchema.parse(current);
  }

  async getPersistedEvidence(runId: string): Promise<RunEvidence | null> {
    try {
      const filePath = resolve(this.artifactsRoot, "runs", runId, "evidence.json");
      const raw = await readFile(filePath, "utf8");
      return RunEvidenceSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async readRunEvidence(runId: string): Promise<RunEvidence | null> {
    return this.getEvidence(runId) ?? (await this.getPersistedEvidence(runId));
  }

  async persistRun(runId: string): Promise<void> {
    const current = this.getEvidence(runId);
    if (!current) {
      return;
    }

    const filePath = resolve(this.artifactsRoot, "runs", runId, "evidence.json");
    await writeFile(filePath, JSON.stringify(current, null, 2), "utf8");
  }
}
