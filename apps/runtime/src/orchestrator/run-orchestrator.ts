import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { OpenAICompatibleClient } from "@qpilot/ai-gateway";
import { generateReports } from "@qpilot/report-core";
import {
  type Action,
  type ChallengeKind,
  type DraftActionState,
  type ExecutionMode,
  type LLMDecision,
  type PageSnapshot,
  type ReplayCaseStep,
  type RunConfig,
  type Run,
  type RunLivePhase,
  type RunWorkingMemory,
  RunConfigSchema,
  RUNTIME_EVENTS,
  type TrafficAssertion,
  type RuntimeEvent,
  type VerificationResult
} from "@qpilot/shared";
import { asc, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { env } from "../config/env.js";
import {
  caseTemplatesTable,
  projectsTable,
  reportsTable,
  runsTable,
  stepsTable,
  testCasesTable
} from "../db/schema.js";
import { runtimeText } from "../i18n/runtime-text.js";
import { Planner } from "../llm/planner.js";
import { PlannerCache } from "../llm/planner-cache.js";
import {
  collectPageSnapshot
} from "../playwright/collector/page-snapshot.js";
import {
  type SecurityChallengeResult,
  detectSecurityChallenge
} from "../playwright/collector/page-guards.js";
import { executeAction } from "../playwright/executor/action-executor.js";
import {
  reconcileVerificationWithApiSignals,
  verifyPageOutcome
} from "../playwright/verifier/basic-verifier.js";
import { decryptText } from "../security/credentials.js";
import { resolveSessionStatePath } from "../security/session-state.js";
import type { EvidenceStore } from "../server/evidence-store.js";
import type { LiveStreamHub } from "../server/live-stream-hub.js";
import type { SseHub } from "../server/sse-hub.js";
import {
  buildLoginActions,
  buildLoginScenarios,
  inferLoginSelectors
} from "./login-strategy.js";
import { findBestCaseTemplateMatch } from "./case-template-matcher.js";
import { refineDecisionForAuthProvider } from "./decision-refiner.js";
import {
  detectCredentialValidationFailure,
  detectRepeatedIneffectiveAttempts,
  shouldClearFlowFailuresAfterSuccess,
  shouldReplanAfterRecoverableStep,
  type GeneralFlowAttempt
} from "./general-flow-guard.js";
import { buildGoalGuardObservation } from "./goal-alignment.js";
import { applyStageActionPolicy } from "./stage-action-policy.js";
import { decideTemplateReplayFallback } from "./template-replay-policy.js";
import { buildApiVerification, buildApiVerificationRules } from "./traffic-verifier.js";
import { buildExecutionDiagnostics } from "./step-diagnostics.js";
import {
  mapProjectRow,
  mapRunRow,
  mapStepRow,
  mapTestCaseRow,
  type CaseTemplateRow,
  type ProjectRow,
  type RunRow,
  type StepRow,
  type TestCaseRow
} from "../utils/mappers.js";
import {
  buildRunWorkingMemory,
  deriveStepOutcome,
  markRunWorkingMemoryCompleted,
  summarizeRunWorkingMemory
} from "./run-memory.js";

type EventName = keyof typeof RUNTIME_EVENTS;

interface OrchestratorDeps {
  db: any;
  evidenceStore: EvidenceStore;
  sseHub: SseHub;
  liveStreamHub: LiveStreamHub;
  artifactsRoot: string;
  reportsRoot: string;
  sessionsRoot: string;
  plannerCacheRoot: string;
}

interface RunContext {
  run: RunRow & { configJson: string };
  project: ProjectRow;
}

interface FlowExecutionResult {
  stepIndex: number;
  lastObservation: string;
  hasFailures: boolean;
  workingMemory?: RunWorkingMemory;
  haltReason?: string;
}

interface StepExecutionResult {
  stepIndex: number;
  lastObservation: string;
  hasFailures: boolean;
  verification: VerificationResult;
  workingMemory?: RunWorkingMemory;
  page: Page;
  haltReason?: string;
}

interface UiSettleMetrics {
  url: string;
  frameCount: number;
  visibleIframeCount: number;
  visibleModalCount: number;
}

const RECORDED_VIDEO_SIZE = {
  width: 1280,
  height: 720
} as const;

interface RunStatusEventData {
  status?: string;
  phase?: RunLivePhase;
  stepIndex?: number;
  message?: string;
  phaseProgress?: number;
  phaseStartedAt?: string;
  action?: Action;
  verification?: VerificationResult;
  pageUrl?: string;
  pageTitle?: string;
  screenshotPath?: string;
  observationSummary?: string;
  haltReason?: string | null;
  manualRequired?: boolean;
  challengeKind?: ChallengeKind;
  executionMode?: ExecutionMode;
  draft?: DraftActionState | null;
  cacheHit?: boolean;
  replayCaseId?: string | null;
  replayCaseTitle?: string | null;
  replayCaseType?: Run["replayCaseType"] | null;
}

interface ManualWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface DraftWaiter {
  resolve: (resolution: DraftResolution) => void;
  reject: (error: Error) => void;
}

type DraftResolution =
  | { type: "approve"; action?: Action }
  | { type: "skip" };

interface RunControlState {
  pauseRequested: boolean;
  paused: boolean;
  abortRequested: boolean;
  resumeResolvers: Set<() => void>;
}

interface SessionPersistenceState {
  path: string;
  save: boolean;
}

interface ActiveRunSnapshot {
  phase: RunLivePhase | "idle";
  message?: string;
  stepIndex?: number;
  paused: boolean;
  manualRequired: boolean;
  executionMode?: ExecutionMode;
  draft?: DraftActionState | null;
  lastEventAt?: string;
}

class RunAbortedError extends Error {
  constructor(message = "Run aborted from desktop control bar.") {
    super(message);
    this.name = "RunAbortedError";
  }
}

export class RunOrchestrator {
  private activeRunId: string | null = null;
  private readonly planner: Planner | null;
  private readonly manualWaiters = new Map<string, ManualWaiter>();
  private readonly draftWaiters = new Map<string, DraftWaiter>();
  private readonly activeDrafts = new Map<string, DraftActionState>();
  private readonly activePages = new Map<string, Page>();
  private readonly activeBrowsers = new Map<string, Browser>();
  private readonly activeBrowserContexts = new Map<string, BrowserContext>();
  private readonly activePageVideos = new Map<string, ReturnType<Page["video"]>>();
  private readonly activeSessionPersistence = new Map<string, SessionPersistenceState>();
  private readonly runControls = new Map<string, RunControlState>();
  private readonly runExecutionModes = new Map<string, ExecutionMode>();
  private readonly runSnapshots = new Map<string, ActiveRunSnapshot>();
  private readonly runResourceClosers = new Map<string, Promise<void>>();

  constructor(private readonly deps: OrchestratorDeps) {
    this.planner = env.OPENAI_API_KEY
      ? new Planner(
          new OpenAICompatibleClient({
            baseURL: env.OPENAI_BASE_URL,
            apiKey: env.OPENAI_API_KEY,
            model: env.OPENAI_MODEL,
            timeoutMs: env.OPENAI_TIMEOUT_MS
          }),
          new PlannerCache(deps.plannerCacheRoot)
        )
      : null;
  }

  isBusy(): boolean {
    return this.activeRunId !== null;
  }

  getActiveRunId(): string | null {
    return this.activeRunId;
  }

  async bringBrowserToFront(runId: string): Promise<boolean> {
    const page = this.activePages.get(runId);
    if (!page || page.isClosed()) {
      return false;
    }

    try {
      await page.bringToFront();
      return true;
    } catch {
      return false;
    }
  }

  private getCurrentPage(runId: string, fallback: Page): Page {
    const activePage = this.activePages.get(runId);
    if (activePage && !activePage.isClosed()) {
      return activePage;
    }
    return fallback;
  }

  private async syncCurrentPage(
    runId: string,
    fallback: Page,
    options?: { waitForNewPageMs?: number }
  ): Promise<Page> {
    let currentPage = this.getCurrentPage(runId, fallback);
    const waitForNewPageMs = options?.waitForNewPageMs ?? 0;

    if (currentPage === fallback && waitForNewPageMs > 0) {
      const deadline = Date.now() + waitForNewPageMs;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        currentPage = this.getCurrentPage(runId, fallback);
        if (currentPage !== fallback) {
          break;
        }
      }
    }

    if (!currentPage.isClosed()) {
      await currentPage.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
    }

    return currentPage;
  }

  private async readUiSettleMetrics(page: Page): Promise<UiSettleMetrics> {
    const fallback: UiSettleMetrics = {
      url: page.url(),
      frameCount: page.frames().length,
      visibleIframeCount: 0,
      visibleModalCount: 0
    };

    if (page.isClosed()) {
      return fallback;
    }

    const domMetrics = await page
      .evaluate((contextSelector) => {
        const isVisible = (element: Element): boolean => {
          if (!(element instanceof HTMLElement)) {
            return false;
          }
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            Number(style.opacity || "1") > 0 &&
            rect.width > 1 &&
            rect.height > 1
          );
        };

        return {
          visibleIframeCount: Array.from(document.querySelectorAll("iframe")).filter(isVisible).length,
          visibleModalCount: Array.from(document.querySelectorAll(contextSelector)).filter(isVisible).length
        };
      }, "dialog,[role='dialog'],[role='alertdialog'],[aria-modal='true'],[id*='modal'],[class*='modal'],[class*='dialog'],[class*='popup']")
      .catch(() => ({
        visibleIframeCount: 0,
        visibleModalCount: 0
      }));

    return {
      url: page.url(),
      frameCount: page.frames().length,
      visibleIframeCount: domMetrics.visibleIframeCount,
      visibleModalCount: domMetrics.visibleModalCount
    };
  }

  private async waitForActionSettle(
    page: Page,
    action: Action,
    baseline: UiSettleMetrics | null
  ): Promise<void> {
    if (action.type !== "click" || !baseline || page.isClosed()) {
      return;
    }

    const deadline = Date.now() + 1_200;
    await page.waitForTimeout(180);

    while (Date.now() < deadline && !page.isClosed()) {
      const current = await this.readUiSettleMetrics(page);
      const changed =
        current.url !== baseline.url ||
        current.frameCount > baseline.frameCount ||
        current.visibleIframeCount > baseline.visibleIframeCount ||
        current.visibleModalCount !== baseline.visibleModalCount;

      if (changed) {
        await page.waitForTimeout(260);
        return;
      }

      await page.waitForTimeout(120);
    }
  }

  pauseRun(runId: string): boolean {
    if (this.activeRunId !== runId) {
      return false;
    }

    const state = this.getOrCreateRunControl(runId);
    if (state.abortRequested) {
      return false;
    }
    state.pauseRequested = true;
    return true;
  }

  resumeRun(runId: string): boolean {
    const manualResumed = this.resumeManual(runId);
    if (manualResumed) {
      return true;
    }

    const state = this.runControls.get(runId);
    if (!state) {
      return false;
    }

    state.pauseRequested = false;
    state.paused = false;
    this.resolveRunResumes(runId);
    return true;
  }

  abortRun(runId: string): boolean {
    if (this.activeRunId !== runId) {
      return false;
    }

    const state = this.getOrCreateRunControl(runId);
    state.abortRequested = true;
    state.pauseRequested = false;
    state.paused = false;
    this.resolveRunResumes(runId);

    const snapshot = this.runSnapshots.get(runId);
    this.emitRunStatus(runId, {
      status: "running",
      phase: "finished",
      stepIndex: snapshot?.stepIndex,
      manualRequired: false,
      executionMode: snapshot?.executionMode ?? this.runExecutionModes.get(runId),
      draft: null,
      message: runtimeText().abortingRun
    });

    const waiter = this.manualWaiters.get(runId);
    if (waiter) {
      clearTimeout(waiter.timeout);
      this.manualWaiters.delete(runId);
      waiter.reject(new RunAbortedError());
    }

    const draftWaiter = this.draftWaiters.get(runId);
    if (draftWaiter) {
      this.draftWaiters.delete(runId);
      this.activeDrafts.delete(runId);
      draftWaiter.reject(new RunAbortedError());
    }

    this.activeDrafts.delete(runId);
    void this.deps.liveStreamHub.unregisterRun(runId).catch(() => undefined);
    void this.closeRunResources(runId);

    return true;
  }

  getActiveRunSnapshot():
    | {
        runId: string;
        control: ActiveRunSnapshot;
      }
    | null {
    if (!this.activeRunId) {
      return null;
    }

    const snapshot = this.runSnapshots.get(this.activeRunId);
    const state = this.runControls.get(this.activeRunId);

    return {
      runId: this.activeRunId,
      control: {
        phase: state?.abortRequested ? "finished" : snapshot?.phase ?? "idle",
        message: snapshot?.message,
        stepIndex: snapshot?.stepIndex,
        paused: state?.abortRequested ? false : state?.paused ?? false,
        manualRequired: state?.abortRequested
          ? false
          : snapshot?.manualRequired ?? Boolean(this.manualWaiters.has(this.activeRunId)),
        executionMode:
          snapshot?.executionMode ?? this.runExecutionModes.get(this.activeRunId),
        draft: state?.abortRequested
          ? null
          : this.activeDrafts.get(this.activeRunId) ?? snapshot?.draft ?? null,
        lastEventAt: snapshot?.lastEventAt
      }
    };
  }

  resumeManual(runId: string): boolean {
    const waiter = this.manualWaiters.get(runId);
    if (!waiter) {
      return false;
    }

    clearTimeout(waiter.timeout);
    this.manualWaiters.delete(runId);
    waiter.resolve();
    return true;
  }

  switchExecutionMode(runId: string, executionMode: ExecutionMode): boolean {
    if (this.activeRunId !== runId) {
      return false;
    }
    this.runExecutionModes.set(runId, executionMode);
    const snapshot = this.runSnapshots.get(runId);
    const phase =
      snapshot?.phase && snapshot.phase !== "idle"
        ? snapshot.phase
        : this.activeDrafts.has(runId)
          ? "drafting"
          : "planning";
    this.emitRunStatus(runId, {
      status: "running",
      phase,
      stepIndex: snapshot?.stepIndex,
      manualRequired: snapshot?.manualRequired ?? Boolean(this.manualWaiters.has(runId)),
      executionMode,
      draft: this.activeDrafts.get(runId) ?? snapshot?.draft ?? null,
      message: snapshot?.message
    });
    return true;
  }

  private emitDraftResolution(runId: string, phase: RunLivePhase, action?: Action): void {
    const snapshot = this.runSnapshots.get(runId);
    this.emitRunStatus(runId, {
      status: "running",
      phase,
      stepIndex: snapshot?.stepIndex,
      action,
      manualRequired: false,
      executionMode: snapshot?.executionMode ?? this.runExecutionModes.get(runId),
      draft: null
    });
  }

  approveDraft(runId: string, action?: Action): boolean {
    const waiter = this.draftWaiters.get(runId);
    if (!waiter) {
      return false;
    }
    const currentDraft = this.activeDrafts.get(runId);
    const resolvedAction = action ?? currentDraft?.action;
    this.draftWaiters.delete(runId);
    this.activeDrafts.delete(runId);
    this.emitDraftResolution(runId, "executing", resolvedAction);
    waiter.resolve({ type: "approve", action });
    return true;
  }

  skipDraft(runId: string): boolean {
    const waiter = this.draftWaiters.get(runId);
    if (!waiter) {
      return false;
    }
    this.draftWaiters.delete(runId);
    this.activeDrafts.delete(runId);
    this.emitDraftResolution(runId, "planning");
    waiter.resolve({ type: "skip" });
    return true;
  }

  retryDraft(runId: string): boolean {
    const draft = this.activeDrafts.get(runId);
    if (!draft) {
      return false;
    }
    return this.approveDraft(runId, draft.action);
  }

  async extractCasesForRun(runId: string): Promise<void> {
    const context = await this.loadContext(runId);
    const runConfig = RunConfigSchema.parse(JSON.parse(context.run.configJson)) as RunConfig;
    await this.extractCaseTemplates(runId, context.project.id, runConfig);
  }

  async start(runId: string): Promise<void> {
    if (this.activeRunId && this.activeRunId !== runId) {
      throw new Error(`Runtime is busy with run ${this.activeRunId}`);
    }
    this.activeRunId = runId;
    this.runControls.set(runId, {
      pauseRequested: false,
      paused: false,
      abortRequested: false,
      resumeResolvers: new Set()
    });

    try {
      await this.execute(runId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown run failure";
      if (error instanceof RunAbortedError) {
        await this.markRunStopped(runId, message);
        await this.generateRunReports(runId);
        this.emit("RUN_FINISHED", runId, {
          status: "stopped",
          endedAt: new Date().toISOString(),
          haltReason: message
        });
      } else {
        await this.markRunFailed(runId, message);
        this.emit("RUN_ERROR", runId, { message });
      }
    } finally {
      const waiter = this.manualWaiters.get(runId);
      if (waiter) {
        clearTimeout(waiter.timeout);
        this.manualWaiters.delete(runId);
        waiter.reject(new Error("Run ended before manual intervention completed."));
      }
      const draftWaiter = this.draftWaiters.get(runId);
      if (draftWaiter) {
        this.draftWaiters.delete(runId);
        this.activeDrafts.delete(runId);
        draftWaiter.reject(new Error("Run ended before the draft action was resolved."));
      }
      this.activeRunId = null;
      this.runControls.delete(runId);
      this.runExecutionModes.delete(runId);
      this.runSnapshots.delete(runId);
    }
  }

  private emit(eventKey: EventName, runId: string, data: unknown): void {
    const payload: RuntimeEvent = {
      event: RUNTIME_EVENTS[eventKey],
      runId,
      ts: new Date().toISOString(),
      data
    };
    this.deps.sseHub.publish(payload);
  }

  private async resolveRunTenantId(runId: string): Promise<string> {
    const runRows = (await this.deps.db
      .select({ tenantId: runsTable.tenantId })
      .from(runsTable)
      .where(eq(runsTable.id, runId))
      .limit(1)) as Array<{ tenantId?: string | null }>;
    return runRows[0]?.tenantId ?? "tenant-default";
  }

  private emitRunStatus(runId: string, data: RunStatusEventData): void {
    const current = this.runSnapshots.get(runId);
    this.runSnapshots.set(runId, {
      phase: data.phase ?? current?.phase ?? "idle",
      message: data.message ?? current?.message,
      stepIndex: data.stepIndex ?? current?.stepIndex,
      paused: this.runControls.get(runId)?.paused ?? false,
      manualRequired:
        data.manualRequired ??
        (data.phase
          ? data.phase === "manual"
          : current?.manualRequired ?? false),
      executionMode: data.executionMode ?? current?.executionMode ?? this.runExecutionModes.get(runId),
      draft: data.draft === undefined ? current?.draft ?? null : data.draft,
      lastEventAt: new Date().toISOString()
    });
    this.deps.liveStreamHub.updateRunMeta(runId, {
      phase: data.phase ?? undefined,
      stepIndex: data.stepIndex,
      message: data.message,
      pageUrl: data.pageUrl,
      pageTitle: data.pageTitle
    });
    this.emit("RUN_STATUS", runId, data);
  }

  private getOrCreateRunControl(runId: string): RunControlState {
    const existing = this.runControls.get(runId);
    if (existing) {
      return existing;
    }

    const created: RunControlState = {
      pauseRequested: false,
      paused: false,
      abortRequested: false,
      resumeResolvers: new Set()
    };
    this.runControls.set(runId, created);
    return created;
  }

  private resolveRunResumes(runId: string): void {
    const state = this.runControls.get(runId);
    if (!state) {
      return;
    }

    const callbacks = Array.from(state.resumeResolvers);
    state.resumeResolvers.clear();
    for (const resolve of callbacks) {
      resolve();
    }
  }

  private async awaitWithTimeout(
    operation: Promise<unknown>,
    timeoutMs: number
  ): Promise<void> {
    await Promise.race([
      operation.then(() => undefined).catch(() => undefined),
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      })
    ]);
  }

  private closeRunResources(runId: string): Promise<void> {
    const existing = this.runResourceClosers.get(runId);
    if (existing) {
      return existing;
    }

    const browserContext = this.activeBrowserContexts.get(runId);
    const browser = this.activeBrowsers.get(runId);
    const pageVideo = this.activePageVideos.get(runId);
    const sessionPersistence = this.activeSessionPersistence.get(runId);

    const closePromise = (async () => {
      if (browserContext && sessionPersistence?.save) {
        await this.awaitWithTimeout(
          browserContext.storageState({ path: sessionPersistence.path }),
          2_000
        );
      }

      if (browserContext) {
        await this.awaitWithTimeout(browserContext.close(), 4_000);
      }

      if (pageVideo) {
        await this.persistRecordedVideo(runId, pageVideo).catch(() => undefined);
      }

      await this.deps.evidenceStore.persistRun(runId).catch(() => undefined);

      if (browser) {
        await this.awaitWithTimeout(browser.close(), 2_500);
      }
    })().finally(() => {
      this.runResourceClosers.delete(runId);
      this.activeBrowsers.delete(runId);
      this.activeBrowserContexts.delete(runId);
      this.activePageVideos.delete(runId);
      this.activeSessionPersistence.delete(runId);
    });

    this.runResourceClosers.set(runId, closePromise);
    return closePromise;
  }

  private async checkRunControl(input: {
    runId: string;
    page: Page;
    artifactDir: string;
    stepIndex: number;
    language?: RunConfig["language"];
    resumePhase: RunLivePhase;
    resumeMessage: string;
  }): Promise<void> {
    const state = this.runControls.get(input.runId);
    if (!state) {
      return;
    }

    if (state.abortRequested) {
      throw new RunAbortedError();
    }

    if (!state.pauseRequested) {
      return;
    }

    if (!state.paused) {
      const text = runtimeText(input.language);
      state.paused = true;
      const pauseSnapshot = await collectPageSnapshot(input.page, {
        artifactDir: input.artifactDir,
        screenshotPublicPrefix: `/artifacts/runs/${input.runId}`,
        stepIndex: input.stepIndex,
        label: `paused-step-${String(Math.max(input.stepIndex, 0)).padStart(4, "0")}`
      });
      this.emitRunStatus(input.runId, {
        status: "running",
        phase: "paused",
        stepIndex: input.stepIndex,
        phaseStartedAt: new Date().toISOString(),
        phaseProgress: 1,
        pageUrl: pauseSnapshot.url,
        pageTitle: pauseSnapshot.title,
        screenshotPath: pauseSnapshot.screenshotPath,
        observationSummary: text.pausedObservation,
        message: text.pausedMessage
      });
    }

    await new Promise<void>((resolve) => {
      state.resumeResolvers.add(resolve);
    });

    if (state.abortRequested) {
      throw new RunAbortedError();
    }

    state.paused = false;
    this.emitRunStatus(input.runId, {
      status: "running",
      phase: input.resumePhase,
      stepIndex: input.stepIndex,
      phaseStartedAt: new Date().toISOString(),
      pageUrl: input.page.url(),
      message: input.resumeMessage
    });
  }

  private getExecutionMode(runId: string, fallback: ExecutionMode): ExecutionMode {
    return this.runExecutionModes.get(runId) ?? fallback;
  }

  private async resolveDraftAction(input: {
    runId: string;
    stepIndex: number;
    action: Action;
    expectedChecks: string[];
    fallbackExecutionMode: ExecutionMode;
    reason?: string;
    language?: RunConfig["language"];
    awaitApproval: boolean;
    pageUrl?: string;
    pageTitle?: string;
    screenshotPath?: string;
  }): Promise<Action | null> {
    const text = runtimeText(input.language);
    const draft: DraftActionState = {
      stepIndex: input.stepIndex,
      action: input.action,
      expectedChecks: input.expectedChecks,
      reason: input.reason,
      awaitingApproval: input.awaitApproval
    };
    this.activeDrafts.set(input.runId, draft);
    this.emitRunStatus(input.runId, {
      status: "running",
      phase: "drafting",
      stepIndex: input.stepIndex,
      executionMode: this.getExecutionMode(input.runId, input.fallbackExecutionMode),
      draft,
      pageUrl: input.pageUrl,
      pageTitle: input.pageTitle,
      screenshotPath: input.screenshotPath,
      message: input.awaitApproval
        ? text.awaitingDraftApproval
        : text.nextActionDrafted(input.action)
    });

    if (!input.awaitApproval) {
      this.activeDrafts.delete(input.runId);
      return input.action;
    }

    return await new Promise<Action | null>((resolve, reject) => {
      this.draftWaiters.set(input.runId, {
        resolve: (resolution) => {
          this.draftWaiters.delete(input.runId);
          this.activeDrafts.delete(input.runId);
          if (resolution.type === "skip") {
            resolve(null);
            return;
          }
          resolve(resolution.action ?? input.action);
        },
        reject
      });
    });
  }

  private getStepTrafficEntries(runId: string, stepIndex: number) {
    return (
      this.deps.evidenceStore
        .getEvidence(runId)
        ?.network.filter((entry) => entry.stepIndex === stepIndex) ?? []
    );
  }

  private getExpectedChecksFromReplayStep(step: ReplayCaseStep): string[] {
    return step.expectedChecks;
  }

  private getExpectedRequestsFromReplayStep(step: ReplayCaseStep): TrafficAssertion[] {
    return step.expectedRequests;
  }

  private async maybeAttachMatchedReplayCase(input: {
    runId: string;
    projectId: string;
    runConfig: RunConfig;
    snapshot: PageSnapshot;
    stepIndex: number;
  }): Promise<RunConfig> {
    if (input.runConfig.mode !== "general" || input.runConfig.replayCase) {
      return input.runConfig;
    }

    const templateRows = (await this.deps.db
      .select()
      .from(caseTemplatesTable)
      .where(eq(caseTemplatesTable.projectId, input.projectId))
      .orderBy(desc(caseTemplatesTable.updatedAt))) as CaseTemplateRow[];

    const match = findBestCaseTemplateMatch({
      snapshot: input.snapshot,
      runConfig: input.runConfig,
      templates: templateRows
    });
    if (!match) {
      return input.runConfig;
    }

    const nextConfig: RunConfig = {
      ...input.runConfig,
      replayCase: match.replayCase
    };
    await this.deps.db
      .update(runsTable)
      .set({
        configJson: JSON.stringify(nextConfig)
      })
      .where(eq(runsTable.id, input.runId));

    this.deps.evidenceStore.recordPlanner(input.runId, {
      stepIndex: Math.max(input.stepIndex - 1, 0),
      prompt: JSON.stringify(
        {
          source: "case-template-match",
          snapshot: {
            url: input.snapshot.url,
            title: input.snapshot.title,
            pageState: input.snapshot.pageState
          },
          goal: input.runConfig.goal
        },
        null,
        2
      ),
      rawResponse: JSON.stringify(
        {
          source: "case-template-match",
          templateId: match.replayCase.templateId,
          templateTitle: match.replayCase.title,
          templateType: match.replayCase.type,
          score: Number(match.score.toFixed(3)),
          reasons: match.reasons
        },
        null,
        2
      ),
      cacheHit: true,
      cacheKey: `case-template:${match.replayCase.templateId}`
    });

    const text = runtimeText(input.runConfig.language);
    this.emitRunStatus(input.runId, {
      status: "running",
      phase: "planning",
      stepIndex: input.stepIndex,
      executionMode: this.getExecutionMode(input.runId, input.runConfig.executionMode),
      pageUrl: input.snapshot.url,
      pageTitle: input.snapshot.title,
      screenshotPath: input.snapshot.screenshotPath,
      replayCaseId: match.replayCase.templateId,
      replayCaseTitle: match.replayCase.title,
      replayCaseType: match.replayCase.type,
      message: text.templateReplayMatched(match.replayCase.title, match.score)
    });

    return nextConfig;
  }

  private async disableReplayCaseForRun(input: {
    runId: string;
    runConfig: RunConfig;
    stepIndex: number;
    page: Page;
    category?: string;
    reason: string;
  }): Promise<RunConfig> {
    const replayCase = input.runConfig.replayCase;
    if (!replayCase) {
      return input.runConfig;
    }

    const nextConfig: RunConfig = {
      ...input.runConfig,
      replayCase: undefined
    };
    await this.deps.db
      .update(runsTable)
      .set({
        configJson: JSON.stringify(nextConfig)
      })
      .where(eq(runsTable.id, input.runId));

    const title = await input.page.title().catch(() => undefined);
    this.deps.evidenceStore.recordPlanner(input.runId, {
      stepIndex: Math.max(input.stepIndex, 0),
      prompt: JSON.stringify(
        {
          source: "case-template-fallback",
          templateId: replayCase.templateId,
          templateTitle: replayCase.title,
          templateType: replayCase.type,
          pageUrl: input.page.url(),
          pageTitle: title
        },
        null,
        2
      ),
      rawResponse: JSON.stringify(
        {
          source: "case-template-fallback",
          templateId: replayCase.templateId,
          templateTitle: replayCase.title,
          category: input.category,
          reason: input.reason
        },
        null,
        2
      ),
      cacheHit: true,
      cacheKey: `case-template:${replayCase.templateId}:fallback`
    });

    const text = runtimeText(input.runConfig.language);
    this.emitRunStatus(input.runId, {
      status: "running",
      phase: "planning",
      stepIndex: input.stepIndex,
      executionMode: this.getExecutionMode(input.runId, input.runConfig.executionMode),
      pageUrl: input.page.url(),
      pageTitle: title,
      replayCaseId: null,
      replayCaseTitle: null,
      replayCaseType: null,
      message: text.templateReplayFallback(replayCase.title, input.category)
    });

    return nextConfig;
  }

  private async loadContext(runId: string): Promise<RunContext> {
    const row = await this.deps.db
      .select({
        run: runsTable,
        project: projectsTable
      })
      .from(runsTable)
      .innerJoin(projectsTable, eq(runsTable.projectId, projectsTable.id))
      .where(eq(runsTable.id, runId))
      .limit(1);

    const first = row[0];
    if (!first) {
      throw new Error(`Run ${runId} does not exist.`);
    }

    return {
      run: first.run as RunContext["run"],
      project: first.project as ProjectRow
    };
  }

  private async execute(runId: string): Promise<void> {
    const now = Date.now();
    const context = await this.loadContext(runId);
    let runConfig = RunConfigSchema.parse(JSON.parse(context.run.configJson)) as RunConfig;
    const text = runtimeText(runConfig.language);
    this.runExecutionModes.set(runId, runConfig.executionMode);
    let finalStatus: "passed" | "failed" = "failed";
    let finishedAtIso: string | null = null;
    let finishedHaltReason: string | null = null;

    if (!this.planner) {
      throw new Error(text.missingApiKey);
    }

    await this.deps.db
      .update(runsTable)
      .set({ status: "running", startedAt: now })
      .where(eq(runsTable.id, runId));
    this.emitRunStatus(runId, {
      status: "running",
      phase: "booting",
      message: text.bootingBrowser
    });

    const artifactDir = resolve(this.deps.artifactsRoot, "runs", runId);
    const reportDir = resolve(this.deps.reportsRoot, "runs", runId);
    const videoDir = resolve(artifactDir, "video");
    await mkdir(artifactDir, { recursive: true });
    await mkdir(reportDir, { recursive: true });
    await mkdir(videoDir, { recursive: true });

    const sessionStatePath = await resolveSessionStatePath(
      this.deps.sessionsRoot,
      context.project.id,
      runConfig.sessionProfile
    );
    const shouldLoadSavedSession =
      Boolean(runConfig.sessionProfile) &&
      typeof sessionStatePath === "string" &&
      existsSync(sessionStatePath);

    const browser = await chromium.launch({
      headless: !runConfig.headed,
      slowMo: runConfig.headed ? 75 : 0
    });
    const browserContext = await browser.newContext({
      ...(shouldLoadSavedSession && sessionStatePath
        ? { storageState: sessionStatePath }
        : {}),
      recordVideo: {
        dir: videoDir,
        size: RECORDED_VIDEO_SIZE
      }
    });
    const page = await browserContext.newPage();
    let latestPageVideo = page.video();
    this.activeBrowsers.set(runId, browser);
    this.activeBrowserContexts.set(runId, browserContext);
    if (latestPageVideo) {
      this.activePageVideos.set(runId, latestPageVideo);
    }
    if (sessionStatePath) {
      this.activeSessionPersistence.set(runId, {
        path: sessionStatePath,
        save: runConfig.saveSession
      });
    }
    this.deps.evidenceStore.initRun(runId);
    const trackedPages = new Set<Page>();
    const pageDetachHandlers = new Map<Page, () => void>();
    const registerTrackedPage = (trackedPage: Page): void => {
      if (pageDetachHandlers.has(trackedPage)) {
        return;
      }

      trackedPages.add(trackedPage);
      pageDetachHandlers.set(trackedPage, this.deps.evidenceStore.attachPage(runId, trackedPage));
      trackedPage.on("close", () => {
        trackedPages.delete(trackedPage);
        const detach = pageDetachHandlers.get(trackedPage);
        if (detach) {
          detach();
          pageDetachHandlers.delete(trackedPage);
        }

        if (this.activePages.get(runId) === trackedPage) {
          const replacement = Array.from(trackedPages).reverse().find((candidate) => !candidate.isClosed());
          if (replacement) {
            this.activePages.set(runId, replacement);
            this.deps.liveStreamHub.registerRun(runId, replacement);
            this.deps.liveStreamHub.updateRunMeta(runId, {
              pageUrl: replacement.url()
            });
          }
        }
      });
    };
    const adoptRunPage = async (
      nextPage: Page,
      options?: { waitForLoad?: boolean; bringToFront?: boolean }
    ): Promise<void> => {
      registerTrackedPage(nextPage);
      this.activePages.set(runId, nextPage);
      this.deps.liveStreamHub.registerRun(runId, nextPage);
      latestPageVideo = nextPage.video() ?? latestPageVideo;
      if (latestPageVideo) {
        this.activePageVideos.set(runId, latestPageVideo);
      }

      if (options?.waitForLoad !== false) {
        await nextPage.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
      }

      const title = await nextPage.title().catch(() => undefined);
      this.deps.liveStreamHub.updateRunMeta(runId, {
        pageUrl: nextPage.url(),
        pageTitle: title
      });

      if (options?.bringToFront !== false && runConfig.headed) {
        await nextPage.bringToFront().catch(() => undefined);
      }
    };
    browserContext.on("page", (nextPage) => {
      if (nextPage === page) {
        return;
      }
      void adoptRunPage(nextPage, {
        waitForLoad: true,
        bringToFront: true
      });
    });
    await adoptRunPage(page, {
      waitForLoad: false,
      bringToFront: false
    });

    let stepIndex = 1;
    let lastObservation = "";
    let hasFailures = false;
    let workingMemory: RunWorkingMemory | undefined;
    let haltReason: string | undefined;

    try {
      await page.goto(runConfig.targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });
      const startupSnapshot = await collectPageSnapshot(page, {
        artifactDir,
        screenshotPublicPrefix: `/artifacts/runs/${runId}`,
        stepIndex: 0,
        label: "startup"
      });
      await this.persistStartupEvidence(
        runId,
        startupSnapshot,
        shouldLoadSavedSession && runConfig.sessionProfile
          ? text.loadedSessionProfile(runConfig.sessionProfile)
          : text.startupCaptured
      );
      this.emitRunStatus(runId, {
        status: "running",
        phase: "sensing",
        stepIndex: 0,
        phaseStartedAt: new Date().toISOString(),
        pageUrl: startupSnapshot.url,
        pageTitle: startupSnapshot.title,
        screenshotPath: startupSnapshot.screenshotPath,
        observationSummary:
          shouldLoadSavedSession && runConfig.sessionProfile
            ? text.sessionLoaded(runConfig.sessionProfile)
            : text.initialPageReady,
        message: runConfig.headed
          ? text.visibleStartupCaptured
          : text.headlessStartupCaptured
      });
      await this.checkRunControl({
        runId,
        page,
        artifactDir,
        stepIndex: 0,
        language: runConfig.language,
        resumePhase: "sensing",
        resumeMessage: text.resumeFromStartup
      });

      runConfig = await this.maybeAttachMatchedReplayCase({
        runId,
        projectId: context.project.id,
        runConfig,
        snapshot: startupSnapshot,
        stepIndex
      });

      const decryptedUsername = context.project.usernameCipher &&
        context.project.usernameIv &&
        context.project.usernameTag
        ? decryptText(
            {
              ciphertext: context.project.usernameCipher,
              iv: context.project.usernameIv,
              tag: context.project.usernameTag
            },
            env.CREDENTIAL_MASTER_KEY
          )
        : runConfig.username;

      const decryptedPassword = context.project.passwordCipher &&
        context.project.passwordIv &&
        context.project.passwordTag
        ? decryptText(
            {
              ciphertext: context.project.passwordCipher,
              iv: context.project.passwordIv,
              tag: context.project.passwordTag
            },
            env.CREDENTIAL_MASTER_KEY
          )
        : runConfig.password;
      const runtimeRunConfig: RunConfig =
        decryptedUsername || decryptedPassword
          ? {
              ...runConfig,
              ...(decryptedUsername ? { username: decryptedUsername } : {}),
              ...(decryptedPassword ? { password: decryptedPassword } : {})
            }
          : runConfig;
      workingMemory = buildRunWorkingMemory({
        goal: runtimeRunConfig.goal,
        snapshot: startupSnapshot,
        previousMemory: workingMemory
      });

      if (runConfig.mode === "login" && decryptedUsername && decryptedPassword) {
        const result = await this.executeLoginFlow({
          runId,
          runConfig: runtimeRunConfig,
          page,
          artifactDir,
          username: decryptedUsername,
          password: decryptedPassword,
          manualTakeover: runtimeRunConfig.manualTakeover && runtimeRunConfig.headed,
          stepIndex,
          lastObservation,
          workingMemory
        });
        stepIndex = result.stepIndex;
        lastObservation = result.lastObservation;
        hasFailures ||= result.hasFailures;
        workingMemory = result.workingMemory ?? workingMemory;
        haltReason = result.haltReason;
      } else {
        const result = await this.executeGeneralFlow({
          runId,
          runConfig: runtimeRunConfig,
          page,
          artifactDir,
          manualTakeover: runtimeRunConfig.manualTakeover && runtimeRunConfig.headed,
          stepIndex,
          lastObservation,
          workingMemory
        });
        stepIndex = result.stepIndex;
        lastObservation = result.lastObservation;
        hasFailures ||= result.hasFailures;
        workingMemory = result.workingMemory ?? workingMemory;
        haltReason = result.haltReason;
      }

      const finishedAt = Date.now();
      finalStatus = hasFailures || haltReason ? "failed" : "passed";
      finishedAtIso = new Date(finishedAt).toISOString();
      finishedHaltReason = haltReason ?? null;
      await this.deps.db
        .update(runsTable)
        .set({
          status: finalStatus,
          endedAt: finishedAt,
          errorMessage: haltReason ?? null
        })
        .where(eq(runsTable.id, runId));
    } finally {
      for (const detach of pageDetachHandlers.values()) {
        detach();
      }
      pageDetachHandlers.clear();
      trackedPages.clear();
      this.activePages.delete(runId);
      await this.deps.liveStreamHub.unregisterRun(runId);
      await this.closeRunResources(runId);
    }

    this.emitRunStatus(runId, {
      status: finalStatus,
      phase: "reporting",
      stepIndex: Math.max(stepIndex - 1, 0),
      message: text.generatingReports
    });
    await this.generateRunReports(runId);
    if (finalStatus === "passed") {
      this.emitRunStatus(runId, {
        status: finalStatus,
        phase: "reporting",
        stepIndex: Math.max(stepIndex - 1, 0),
        executionMode: this.getExecutionMode(runId, runConfig.executionMode),
        message: text.extractingCases
      });
      await this.extractCaseTemplates(runId, context.project.id, runConfig);
    }
    this.emit("RUN_FINISHED", runId, {
      status: finalStatus,
      endedAt: finishedAtIso,
      haltReason: finishedHaltReason
    });
  }

  private async executeGeneralFlow(input: {
    runId: string;
    runConfig: RunConfig;
    page: any;
    artifactDir: string;
    manualTakeover: boolean;
    stepIndex: number;
    lastObservation: string;
    workingMemory?: RunWorkingMemory;
  }): Promise<FlowExecutionResult> {
    const text = runtimeText(input.runConfig.language);
    let stepIndex = input.stepIndex;
    let lastObservation = input.lastObservation;
    let hasFailures = false;
    let haltReason: string | undefined;
    let workingMemory = input.workingMemory;
    let currentPage = this.getCurrentPage(input.runId, input.page);
    const recentAttempts: GeneralFlowAttempt[] = [];
    let latestVerificationPassed = false;

    if (input.runConfig.replayCase?.steps?.length) {
      return this.executeReplayFlow({
        ...input,
        currentPage,
        stepIndex,
        lastObservation
      });
    }

    while (stepIndex <= input.runConfig.maxSteps) {
      currentPage = await this.syncCurrentPage(input.runId, currentPage);
      await this.checkRunControl({
        runId: input.runId,
        page: currentPage,
        artifactDir: input.artifactDir,
        stepIndex,
        language: input.runConfig.language,
        resumePhase: "sensing",
        resumeMessage: text.resumeGeneralPlanning
      });
      currentPage = this.getCurrentPage(input.runId, currentPage);
      const challenge = await detectSecurityChallenge(currentPage);
      if (challenge.detected) {
        await this.persistChallengeState(input.runId, challenge);
        if (input.manualTakeover) {
          lastObservation = await this.waitForManualTakeover({
            runId: input.runId,
            page: currentPage,
            artifactDir: input.artifactDir,
            stepIndex,
            kind: challenge.kind,
            reason: challenge.reason ?? text.defaultBlockedPageReason,
            message: text.manualReviewBeforePlanning,
            language: input.runConfig.language
          });
          continue;
        }
        haltReason = challenge.reason ?? text.securityChallengeDetected;
        hasFailures = true;
        break;
      }

      const repeatedAttemptGuard = detectRepeatedIneffectiveAttempts(recentAttempts);
      if (repeatedAttemptGuard) {
        const guardReason = text.repeatedIneffectiveActions(
          repeatedAttemptGuard.streakLength,
          repeatedAttemptGuard.host,
          repeatedAttemptGuard.surface
        );
        hasFailures = true;
        if (input.manualTakeover) {
          lastObservation = await this.waitForManualTakeover({
            runId: input.runId,
            page: currentPage,
            artifactDir: input.artifactDir,
            stepIndex,
            reason: guardReason,
            message: text.manualReviewBeforePlanning,
            language: input.runConfig.language
          });
          recentAttempts.length = 0;
          continue;
        }
        haltReason = guardReason;
        break;
      }

      this.emitRunStatus(input.runId, {
        status: "running",
        phase: "sensing",
        stepIndex,
        phaseStartedAt: new Date().toISOString(),
        message: text.captureBeforePlanning
      });
      const beforeSnapshot = await collectPageSnapshot(currentPage, {
        artifactDir: input.artifactDir,
        screenshotPublicPrefix: `/artifacts/runs/${input.runId}`,
        stepIndex
      });
      this.emitRunStatus(input.runId, {
        status: "running",
        phase: "planning",
        stepIndex,
        phaseStartedAt: new Date().toISOString(),
        pageUrl: beforeSnapshot.url,
        pageTitle: beforeSnapshot.title,
        screenshotPath: beforeSnapshot.screenshotPath,
        message: text.snapshotSentToPlanner
      });

      const plannerResult = await this.planner!.plan({
        snapshot: beforeSnapshot,
        runConfig: input.runConfig,
        stepIndex,
        seedPrompt: "General exploratory validation",
        lastObservation,
        workingMemory
      });
      const { decision, raw, promptPayload, cacheHit, cacheKey } = plannerResult;
      const refinedDecision = refineDecisionForAuthProvider({
        snapshot: beforeSnapshot,
        runConfig: input.runConfig,
        decision,
        lastObservation,
        workingMemory
      });
      const policyDecision = applyStageActionPolicy({
        snapshot: beforeSnapshot,
        runConfig: input.runConfig,
        decision: refinedDecision,
        workingMemory
      });

      await this.deps.db
        .update(runsTable)
        .set({ llmLastJson: JSON.stringify(policyDecision) })
        .where(eq(runsTable.id, input.runId));
      this.deps.evidenceStore.recordPlanner(input.runId, {
        stepIndex,
        prompt: promptPayload,
        rawResponse: raw,
        decision: policyDecision,
        cacheHit,
        cacheKey
      });
      this.emit("RUN_LLM", input.runId, {
        stepIndex,
        decision: policyDecision,
        raw,
        cacheHit,
        cacheKey
      });
      this.emitRunStatus(input.runId, {
        status: "running",
        phase: "planning",
        stepIndex,
        executionMode: this.getExecutionMode(input.runId, input.runConfig.executionMode),
        pageUrl: beforeSnapshot.url,
        pageTitle: beforeSnapshot.title,
        screenshotPath: beforeSnapshot.screenshotPath,
        cacheHit,
        message: cacheHit ? text.plannerCacheHit : text.plannerFreshDecision
      });

      if (policyDecision.test_case_candidate.generate) {
        await this.insertTestCaseFromDecision(input.runId, policyDecision);
      }

      if (policyDecision.actions.length === 0) {
        if (policyDecision.is_finished) {
          workingMemory = markRunWorkingMemoryCompleted(workingMemory) ?? workingMemory;
          lastObservation = [
            lastObservation,
            summarizeRunWorkingMemory(workingMemory)
          ]
            .filter(Boolean)
            .join("; ");
        }
        break;
      }
      for (const [actionIndex, action] of policyDecision.actions.entries()) {
        if (stepIndex > input.runConfig.maxSteps) {
          break;
        }
        const executionMode = this.getExecutionMode(input.runId, input.runConfig.executionMode);
        if (executionMode === "stepwise_replan" && actionIndex > 0) {
          break;
        }
        const nextAction = await this.resolveDraftAction({
          runId: input.runId,
          stepIndex,
          action,
          expectedChecks: policyDecision.expected_checks,
          fallbackExecutionMode: input.runConfig.executionMode,
          reason: policyDecision.plan.reason,
          language: input.runConfig.language,
          awaitApproval:
            executionMode === "stepwise_replan" || input.runConfig.confirmDraft,
          pageUrl: beforeSnapshot.url,
          pageTitle: beforeSnapshot.title,
          screenshotPath: beforeSnapshot.screenshotPath
        });
        if (!nextAction) {
          lastObservation = text.draftSkippedObservation;
          continue;
        }
        currentPage = await this.syncCurrentPage(input.runId, currentPage);
        await this.checkRunControl({
          runId: input.runId,
          page: currentPage,
          artifactDir: input.artifactDir,
          stepIndex,
          language: input.runConfig.language,
          resumePhase: "executing",
          resumeMessage: text.resumeActionExecution
        });
        const result = await this.executeAndPersistStep({
          runId: input.runId,
          runConfig: input.runConfig,
          page: currentPage,
          action: nextAction,
          expectedChecks: policyDecision.expected_checks,
          expectedRequests: [],
          artifactDir: input.artifactDir,
          manualTakeover: input.manualTakeover,
          stepIndex,
          workingMemory
        });
        currentPage = result.page;
        stepIndex = result.stepIndex;
        lastObservation = result.lastObservation;
        hasFailures ||= result.hasFailures;
        latestVerificationPassed = result.verification.passed;
        workingMemory = result.workingMemory ?? workingMemory;
        recentAttempts.push({
          action: nextAction,
          pageUrl: currentPage.url(),
          pageState: result.verification.pageState,
          failureCategory: result.verification.execution?.failureCategory,
          hasPlannedFollowUp: actionIndex < refinedDecision.actions.length - 1
        });
        if (recentAttempts.length > 8) {
          recentAttempts.shift();
        }
        if (result.haltReason) {
          haltReason = result.haltReason;
          break;
        }
        if (
          shouldReplanAfterRecoverableStep({
            action: nextAction,
            pageUrl: currentPage.url(),
            pageState: result.verification.pageState,
            failureCategory: result.verification.execution?.failureCategory,
            hasPlannedFollowUp: actionIndex < refinedDecision.actions.length - 1
          })
        ) {
          this.emitRunStatus(input.runId, {
            status: "running",
            phase: "planning",
            stepIndex,
            executionMode: this.getExecutionMode(input.runId, input.runConfig.executionMode),
            pageUrl: currentPage.url(),
            pageTitle: await currentPage.title().catch(() => undefined),
            message: text.replanningAfterStepFailure(
              result.verification.execution?.failureCategory
            )
          });
          break;
        }
      }

      if (
        shouldClearFlowFailuresAfterSuccess({
          isFinished: refinedDecision.is_finished,
          latestVerificationPassed,
          haltReason
        })
      ) {
        hasFailures = false;
        workingMemory = markRunWorkingMemoryCompleted(workingMemory) ?? workingMemory;
        lastObservation = [
          lastObservation,
          summarizeRunWorkingMemory(workingMemory)
        ]
          .filter(Boolean)
          .join("; ");
      }

      if (refinedDecision.is_finished || haltReason) {
        break;
      }
    }

    if (!haltReason && stepIndex > input.runConfig.maxSteps) {
      haltReason = text.stoppedAtMaxSteps(input.runConfig.maxSteps);
    }

    return {
      stepIndex,
      lastObservation,
      hasFailures,
      workingMemory,
      haltReason
    };
  }

  private async executeReplayFlow(input: {
    runId: string;
    runConfig: RunConfig;
    page: any;
    currentPage: Page;
    artifactDir: string;
    manualTakeover: boolean;
    stepIndex: number;
    lastObservation: string;
    workingMemory?: RunWorkingMemory;
  }): Promise<FlowExecutionResult> {
    const text = runtimeText(input.runConfig.language);
    const replayCase = input.runConfig.replayCase;
    if (!replayCase) {
      return {
        stepIndex: input.stepIndex,
        lastObservation: input.lastObservation,
        hasFailures: false
      };
    }

    let stepIndex = input.stepIndex;
    let lastObservation = input.lastObservation;
    let hasFailures = false;
    let haltReason: string | undefined;
    let workingMemory = input.workingMemory;
    let currentPage = input.currentPage;

    this.emitRunStatus(input.runId, {
      status: "running",
      phase: "planning",
      stepIndex,
      executionMode: this.getExecutionMode(input.runId, input.runConfig.executionMode),
      replayCaseId: replayCase.templateId,
      replayCaseTitle: replayCase.title,
      replayCaseType: replayCase.type,
      message: text.replayingCaseTemplate(replayCase.title)
    });

    for (const [replayIndex, step] of replayCase.steps.entries()) {
      if (stepIndex > input.runConfig.maxSteps) {
        haltReason = text.stoppedAtMaxSteps(input.runConfig.maxSteps);
        break;
      }

      currentPage = await this.syncCurrentPage(input.runId, currentPage);
      await this.checkRunControl({
        runId: input.runId,
        page: currentPage,
        artifactDir: input.artifactDir,
        stepIndex,
        language: input.runConfig.language,
        resumePhase: "executing",
        resumeMessage: text.resumeActionExecution
      });

      const beforeSnapshot = await collectPageSnapshot(currentPage, {
        artifactDir: input.artifactDir,
        screenshotPublicPrefix: `/artifacts/runs/${input.runId}`,
        stepIndex,
        label: `replay-step-${String(stepIndex).padStart(4, "0")}-before`
      });
      const executionMode = this.getExecutionMode(input.runId, input.runConfig.executionMode);
      const nextAction = await this.resolveDraftAction({
        runId: input.runId,
        stepIndex,
        action: step.action,
        expectedChecks: this.getExpectedChecksFromReplayStep(step),
        fallbackExecutionMode: input.runConfig.executionMode,
        reason: step.note ?? `Replay step ${replayIndex + 1}/${replayCase.steps.length}`,
        language: input.runConfig.language,
        awaitApproval:
          executionMode === "stepwise_replan" || input.runConfig.confirmDraft,
        pageUrl: beforeSnapshot.url,
        pageTitle: beforeSnapshot.title,
        screenshotPath: beforeSnapshot.screenshotPath
      });

      if (!nextAction) {
        lastObservation = text.draftSkippedObservation;
        continue;
      }

      const result = await this.executeAndPersistStep({
        runId: input.runId,
        runConfig: input.runConfig,
        page: currentPage,
        action: nextAction,
        expectedChecks: this.getExpectedChecksFromReplayStep(step),
        expectedRequests: this.getExpectedRequestsFromReplayStep(step),
        artifactDir: input.artifactDir,
        manualTakeover: input.manualTakeover,
        stepIndex,
        workingMemory,
        templateReplay: {
          templateId: replayCase.templateId,
          templateTitle: replayCase.title,
          templateType: replayCase.type,
          stepIndex: replayIndex + 1,
          stepCount: replayCase.steps.length
        }
      });
      currentPage = result.page;
      stepIndex = result.stepIndex;
      lastObservation = result.lastObservation;
      workingMemory = result.workingMemory ?? workingMemory;
      const replayFallback = decideTemplateReplayFallback({
        hasFailures: result.hasFailures,
        haltReason: result.haltReason,
        verification: result.verification
      });
      if (replayFallback) {
        const nextConfig = await this.disableReplayCaseForRun({
          runId: input.runId,
          runConfig: input.runConfig,
          stepIndex: Math.max(stepIndex - 1, 0),
          page: currentPage,
          category: replayFallback.category,
          reason: replayFallback.reason
        });
        return this.executeGeneralFlow({
          ...input,
          runConfig: nextConfig,
          page: currentPage,
          stepIndex,
          lastObservation: replayFallback.reason,
          workingMemory
        });
      }
      hasFailures ||= result.hasFailures;
      if (result.haltReason) {
        haltReason = result.haltReason;
        break;
      }
    }

    return {
      stepIndex,
      lastObservation,
      hasFailures,
      workingMemory,
      haltReason
    };
  }

  private async executeLoginFlow(input: {
    runId: string;
    runConfig: RunConfig;
    page: any;
    artifactDir: string;
    username: string;
    password: string;
    manualTakeover: boolean;
    stepIndex: number;
    lastObservation: string;
    workingMemory?: RunWorkingMemory;
  }): Promise<FlowExecutionResult> {
    const text = runtimeText(input.runConfig.language);
    let stepIndex = input.stepIndex;
    let lastObservation = input.lastObservation;
    let hasFailures = false;
    let haltReason: string | undefined;
    let workingMemory = input.workingMemory;
    let currentPage = this.getCurrentPage(input.runId, input.page);
    let latestVerificationPassed = false;

    const scenarios = buildLoginScenarios(input.username, input.password);

    for (let i = 0; i < scenarios.length; i += 1) {
      const scenario = scenarios[i];
      if (!scenario) {
        continue;
      }

      if (stepIndex > input.runConfig.maxSteps) {
        haltReason = text.stoppedAtMaxSteps(input.runConfig.maxSteps);
        break;
      }

      currentPage = await this.syncCurrentPage(input.runId, currentPage);
      await this.checkRunControl({
        runId: input.runId,
        page: currentPage,
        artifactDir: input.artifactDir,
        stepIndex,
        language: input.runConfig.language,
        resumePhase: "sensing",
        resumeMessage: text.resumeLoginScenario
      });

      currentPage = this.getCurrentPage(input.runId, currentPage);
      const challenge = await detectSecurityChallenge(currentPage);
      if (challenge.detected) {
        await this.persistChallengeState(input.runId, challenge);
        if (input.manualTakeover) {
          lastObservation = await this.waitForManualTakeover({
            runId: input.runId,
            page: currentPage,
            artifactDir: input.artifactDir,
            stepIndex,
            kind: challenge.kind,
            reason: challenge.reason ?? text.loginBlockedReason,
            message: text.manualReviewBeforeLogin,
            language: input.runConfig.language
          });
          continue;
        }
        haltReason = challenge.reason ?? text.securityChallengeDetected;
        hasFailures = true;
        break;
      }

      this.emitRunStatus(input.runId, {
        status: "running",
        phase: "sensing",
        stepIndex,
        phaseStartedAt: new Date().toISOString(),
        message: text.captureLoginScenario(i + 1, scenarios.length, scenario.name)
      });
      const snapshot = await collectPageSnapshot(currentPage, {
        artifactDir: input.artifactDir,
        screenshotPublicPrefix: `/artifacts/runs/${input.runId}`,
        stepIndex
      });
      this.emitRunStatus(input.runId, {
        status: "running",
        phase: "planning",
        stepIndex,
        phaseStartedAt: new Date().toISOString(),
        pageUrl: snapshot.url,
        pageTitle: snapshot.title,
        screenshotPath: snapshot.screenshotPath,
        message: text.loginScenarioSnapshotSent(scenario.name)
      });

      const plannerResult = await this.planner!.plan({
        snapshot,
        runConfig: {
          ...input.runConfig,
          goal: text.loginScenarioGoal(scenario.name)
        },
        stepIndex,
        seedPrompt: "Login page abnormal-then-normal strategy",
        lastObservation,
        workingMemory
      });

      const selectors = inferLoginSelectors(snapshot.elements);
      const decision: LLMDecision = {
        ...plannerResult.decision,
        goal: text.loginScenarioGoal(scenario.name),
        actions: buildLoginActions(selectors, scenario),
        expected_checks: scenario.expectedChecks,
        is_finished: i === scenarios.length - 1
      };
      const policyDecision = applyStageActionPolicy({
        snapshot,
        runConfig: input.runConfig,
        decision,
        workingMemory
      });

      await this.deps.db
        .update(runsTable)
        .set({ llmLastJson: JSON.stringify(policyDecision) })
        .where(eq(runsTable.id, input.runId));
      this.deps.evidenceStore.recordPlanner(input.runId, {
        stepIndex,
        prompt: plannerResult.promptPayload,
        rawResponse: plannerResult.raw,
        decision: policyDecision,
        cacheHit: plannerResult.cacheHit,
        cacheKey: plannerResult.cacheKey
      });
      this.emit("RUN_LLM", input.runId, {
        stepIndex,
        decision: policyDecision,
        raw: plannerResult.raw,
        cacheHit: plannerResult.cacheHit,
        cacheKey: plannerResult.cacheKey
      });
      this.emitRunStatus(input.runId, {
        status: "running",
        phase: "planning",
        stepIndex,
        pageUrl: snapshot.url,
        pageTitle: snapshot.title,
        screenshotPath: snapshot.screenshotPath,
        message: plannerResult.cacheHit ? text.plannerCacheHit : text.plannerFreshDecision
      });

      let scenarioLastResult: VerificationResult | null = null;

      if (policyDecision.actions.length === 0) {
        if (policyDecision.is_finished) {
          latestVerificationPassed = true;
          hasFailures = false;
          workingMemory = markRunWorkingMemoryCompleted(workingMemory) ?? workingMemory;
          lastObservation = [
            lastObservation,
            summarizeRunWorkingMemory(workingMemory)
          ]
            .filter(Boolean)
            .join("; ");
          break;
        }
        continue;
      }

      for (const action of policyDecision.actions) {
        if (stepIndex > input.runConfig.maxSteps) {
          haltReason = text.stoppedAtMaxSteps(input.runConfig.maxSteps);
          break;
        }

        currentPage = await this.syncCurrentPage(input.runId, currentPage);
        await this.checkRunControl({
          runId: input.runId,
          page: currentPage,
          artifactDir: input.artifactDir,
          stepIndex,
          language: input.runConfig.language,
          resumePhase: "executing",
          resumeMessage: text.resumeLoginActionExecution
        });

        const executionMode = this.getExecutionMode(input.runId, input.runConfig.executionMode);
        const nextAction = await this.resolveDraftAction({
          runId: input.runId,
          stepIndex,
          action,
          expectedChecks: policyDecision.expected_checks,
          fallbackExecutionMode: input.runConfig.executionMode,
          reason: policyDecision.plan.reason,
          language: input.runConfig.language,
          awaitApproval:
            executionMode === "stepwise_replan" || input.runConfig.confirmDraft,
          pageUrl: currentPage.url(),
          pageTitle: await currentPage.title().catch(() => undefined)
        });
        if (!nextAction) {
          lastObservation = text.draftSkippedObservation;
          continue;
        }

        const result = await this.executeAndPersistStep({
          runId: input.runId,
          runConfig: input.runConfig,
          page: currentPage,
          action: nextAction,
          expectedChecks: policyDecision.expected_checks,
          expectedRequests: [],
          artifactDir: input.artifactDir,
          manualTakeover: input.manualTakeover,
          stepIndex,
          workingMemory
        });
        currentPage = result.page;
        stepIndex = result.stepIndex;
        lastObservation = result.lastObservation;
        hasFailures ||= result.hasFailures;
        latestVerificationPassed = result.verification.passed;
        workingMemory = result.workingMemory ?? workingMemory;
        scenarioLastResult = result.verification;
        if (result.haltReason) {
          haltReason = result.haltReason;
          break;
        }
      }

      const status = scenarioLastResult?.passed ? "passed" : "failed";
      const tenantId = await this.resolveRunTenantId(input.runId);
      const testCaseRow = {
        id: nanoid(),
        tenantId,
        runId: input.runId,
        module: "Login Authentication",
        title: scenario.name,
        preconditions: "Page is in login state",
        stepsJson: JSON.stringify(policyDecision.actions),
        expected: scenario.expectedChecks.join(" | "),
        actual: scenarioLastResult
          ? JSON.stringify(scenarioLastResult.checks)
          : "No verification result",
        status,
        priority: "P0",
        method: "abnormal-then-normal",
        createdAt: Date.now()
      };
      await this.deps.db.insert(testCasesTable).values(testCaseRow);
      this.emit("TESTCASE_CREATED", input.runId, {
        testCase: mapTestCaseRow(testCaseRow)
      });

      if (i < scenarios.length - 1) {
        currentPage = this.getCurrentPage(input.runId, currentPage);
        await currentPage.goto(input.runConfig.targetUrl, {
          waitUntil: "domcontentloaded",
          timeout: 20_000
        });
      }

      if (haltReason) {
        break;
      }

      if (
        shouldClearFlowFailuresAfterSuccess({
          isFinished: policyDecision.is_finished,
          latestVerificationPassed,
          haltReason
        })
      ) {
        hasFailures = false;
        workingMemory = markRunWorkingMemoryCompleted(workingMemory) ?? workingMemory;
        lastObservation = [
          lastObservation,
          summarizeRunWorkingMemory(workingMemory)
        ]
          .filter(Boolean)
          .join("; ");
      }
    }

    return {
      stepIndex,
      lastObservation,
      hasFailures,
      workingMemory,
      haltReason
    };
  }

  private async executeAndPersistStep(input: {
    runId: string;
    runConfig: RunConfig;
    page: any;
    action: Action;
    expectedChecks: string[];
    expectedRequests: TrafficAssertion[];
    artifactDir: string;
    manualTakeover: boolean;
    stepIndex: number;
    workingMemory?: RunWorkingMemory;
    templateReplay?: {
      templateId: string;
      templateTitle: string;
      templateType: "ui" | "hybrid";
      stepIndex: number;
      stepCount: number;
    };
  }): Promise<StepExecutionResult> {
    const text = runtimeText(input.runConfig.language);
    let currentPage = await this.syncCurrentPage(input.runId, input.page);
    await this.checkRunControl({
      runId: input.runId,
      page: currentPage,
      artifactDir: input.artifactDir,
      stepIndex: input.stepIndex,
      language: input.runConfig.language,
      resumePhase: "executing",
      resumeMessage: text.continuingPendingAction
    });
    currentPage = this.getCurrentPage(input.runId, currentPage);
    const previousUrl = currentPage.url();
    const executionStartedAt = new Date().toISOString();
    const liveFrame = await collectPageSnapshot(currentPage, {
      artifactDir: input.artifactDir,
      screenshotPublicPrefix: `/artifacts/runs/${input.runId}`,
      stepIndex: input.stepIndex,
      label: `live-step-${String(input.stepIndex).padStart(4, "0")}-before`
    });
    this.emitRunStatus(input.runId, {
      status: "running",
      phase: "executing",
      stepIndex: input.stepIndex,
      executionMode: this.getExecutionMode(input.runId, input.runConfig.executionMode),
      phaseStartedAt: executionStartedAt,
      phaseProgress: 0,
      action: input.action,
      draft: null,
      pageUrl: liveFrame.url,
      pageTitle: liveFrame.title,
      screenshotPath: liveFrame.screenshotPath,
      message: text.executingAction(input.action)
    });
    this.deps.evidenceStore.setActiveStep(input.runId, input.stepIndex);
    const settleBaseline =
      input.action.type === "click" ? await this.readUiSettleMetrics(currentPage) : null;
    let actionResult = await executeAction(currentPage, input.action, async (progress) => {
      this.emitRunStatus(input.runId, {
        status: "running",
        phase: "executing",
        stepIndex: input.stepIndex,
        phaseStartedAt: executionStartedAt,
        phaseProgress: progress.progress,
        action: input.action,
        draft: null,
        pageUrl: currentPage.url(),
        message: progress.message
      });
    }, input.runConfig.language, {
      goal: input.runConfig.goal
    });
    currentPage = await this.syncCurrentPage(input.runId, currentPage, {
      waitForNewPageMs: input.action.type === "click" ? 1_500 : 0
    });
    await this.waitForActionSettle(currentPage, input.action, settleBaseline);

    let manualObservation: string | undefined;

    if (input.manualTakeover && actionResult.challenge?.detected) {
      await this.persistChallengeState(input.runId, actionResult.challenge);
      manualObservation = await this.waitForManualTakeover({
        runId: input.runId,
        page: currentPage,
        artifactDir: input.artifactDir,
        stepIndex: input.stepIndex,
        kind: actionResult.challenge.kind,
        reason: actionResult.blockingReason ?? text.actionNeedsManualVerification,
        message: text.manualReviewDuringAction,
        language: input.runConfig.language
      });

      if (actionResult.challengePhase === "before") {
        this.emitRunStatus(input.runId, {
          status: "running",
          phase: "executing",
          stepIndex: input.stepIndex,
          phaseStartedAt: new Date().toISOString(),
          phaseProgress: 0.15,
          action: input.action,
          pageUrl: currentPage.url(),
          message: text.retryAfterManualReview
        });
        const retrySettleBaseline =
          input.action.type === "click" ? await this.readUiSettleMetrics(currentPage) : null;
        actionResult = await executeAction(currentPage, input.action, async (progress) => {
          this.emitRunStatus(input.runId, {
            status: "running",
            phase: "executing",
            stepIndex: input.stepIndex,
            phaseStartedAt: executionStartedAt,
            phaseProgress: progress.progress,
            action: input.action,
            draft: null,
            pageUrl: currentPage.url(),
            message: progress.message
          });
        }, input.runConfig.language, {
          goal: input.runConfig.goal
        });
        currentPage = await this.syncCurrentPage(input.runId, currentPage, {
          waitForNewPageMs: input.action.type === "click" ? 1_500 : 0
        });
        await this.waitForActionSettle(currentPage, input.action, retrySettleBaseline);
      } else {
        actionResult = {
          ...actionResult,
          status: "success",
          observation: `${actionResult.observation}; ${text.manualReviewCompletedSuffix}`,
          shouldHalt: false,
          blockingReason: undefined,
          challenge: undefined,
          challengePhase: undefined
        };
      }
    }

    const verifyingStartedAt = new Date().toISOString();
    let verification = await verifyPageOutcome(
      currentPage,
      previousUrl,
      input.expectedChecks,
      {
        goal: input.runConfig.goal,
        targetUrl: input.runConfig.targetUrl,
        language: input.runConfig.language,
        action: input.action
      }
    );
    this.emitRunStatus(input.runId, {
      status: "running",
      phase: "verifying",
      stepIndex: input.stepIndex,
      phaseStartedAt: verifyingStartedAt,
      phaseProgress: 1,
      action: input.action,
      verification,
      pageUrl: currentPage.url(),
      message: text.checkingOutcome
    });

    if (actionResult.blockingReason) {
      verification.note = actionResult.blockingReason;
    }
    if (manualObservation) {
      verification.note = [verification.note, manualObservation].filter(Boolean).join(" ");
    }

    const apiVerification = buildApiVerification({
      networkEntries: this.getStepTrafficEntries(input.runId, input.stepIndex),
      expectedRequests: input.expectedRequests,
      previousUrl,
      currentUrl: currentPage.url()
    });
    verification.api = apiVerification;
    verification.rules = [
      ...(verification.rules ?? []),
      ...buildApiVerificationRules(apiVerification)
    ];
    verification = reconcileVerificationWithApiSignals({
      verification,
      apiVerification,
      previousUrl,
      currentUrl: currentPage.url(),
      expectedChecks: input.expectedChecks,
      goal: input.runConfig.goal,
      targetUrl: input.runConfig.targetUrl,
      language: input.runConfig.language,
      action: input.action
    });
    verification.execution = buildExecutionDiagnostics({
      action: input.action,
      actionResult,
      verification,
      language: input.runConfig.language,
      expectedChecks: input.expectedChecks,
      expectedRequests: input.expectedRequests,
      templateReplay: input.templateReplay
    });
    const credentialValidationFailure = detectCredentialValidationFailure({
      action: input.action,
      pageState: verification.pageState
    });
    const credentialValidationReason = credentialValidationFailure
      ? text.credentialValidationFailed(credentialValidationFailure)
      : undefined;

    const persistingStartedAt = new Date().toISOString();
    this.emitRunStatus(input.runId, {
      status: "running",
      phase: "persisting",
      stepIndex: input.stepIndex,
      phaseStartedAt: persistingStartedAt,
      phaseProgress: 0.3,
      action: input.action,
      verification,
      draft: null,
      pageUrl: currentPage.url(),
      message: text.captureAndStoreEvidence
    });
    const snapshot = await collectPageSnapshot(currentPage, {
      artifactDir: input.artifactDir,
      screenshotPublicPrefix: `/artifacts/runs/${input.runId}`,
      stepIndex: input.stepIndex
    });

    const executionHint = verification.execution?.failureCategory
      ? `; diagnosis=${verification.execution.failureCategory}`
      : verification.execution?.targetUsed
        ? `; target=${verification.execution.targetUsed}`
        : "";
    const templateHint = verification.execution?.templateReplay
      ? `; template=${verification.execution.templateReplay.stepIndex}/${verification.execution.templateReplay.stepCount}:${verification.execution.templateReplay.outcome}`
      : "";
    const observationSummary = `${actionResult.observation}; checks=${text.checksSummary(
      verification.checks
    )}; api=${apiVerification.status}(${apiVerification.requestCount})${executionHint}${templateHint}`;
    const goalGuardObservation = buildGoalGuardObservation({
      goal: input.runConfig.goal,
      snapshot,
      pageState: verification.pageState,
      action: input.action
    });
    const haltReason = actionResult.shouldHalt
      ? actionResult.blockingReason ?? text.executionHaltedByPageGuard
      : credentialValidationReason;
    const stepOutcome = deriveStepOutcome({
      verification,
      haltReason,
      actionStatus: actionResult.status,
      credentialValidationReason
    });
    const nextWorkingMemory = buildRunWorkingMemory({
      goal: input.runConfig.goal,
      snapshot,
      pageState: verification.pageState,
      verification,
      previousMemory: input.workingMemory,
      goalGuardObservation,
      outcome: stepOutcome
    });
    verification.outcome = stepOutcome;
    verification.workingMemory = nextWorkingMemory;
    const workingMemorySummary = summarizeRunWorkingMemory(nextWorkingMemory);
    const enrichedObservationSummary = [
      observationSummary,
      goalGuardObservation,
      workingMemorySummary
    ]
      .filter(Boolean)
      .join("; ");

    const stepRow = {
      id: nanoid(),
      tenantId: await this.resolveRunTenantId(input.runId),
      runId: input.runId,
      stepIndex: input.stepIndex,
      pageUrl: snapshot.url,
      pageTitle: snapshot.title,
      domSummaryJson: JSON.stringify(snapshot.elements),
      screenshotPath: snapshot.screenshotPath,
      actionJson: JSON.stringify(input.action),
      actionStatus: actionResult.status,
      observationSummary: enrichedObservationSummary,
      verificationJson: JSON.stringify(verification),
      createdAt: Date.now()
    };

    await this.deps.db.insert(stepsTable).values(stepRow);
    this.deps.evidenceStore.setActiveStep(input.runId, undefined);
    const step = mapStepRow(stepRow);

    this.emit("STEP_CREATED", input.runId, {
      step
    });
    this.emitRunStatus(input.runId, {
      status: "running",
      phase: "persisting",
      stepIndex: input.stepIndex,
      phaseStartedAt: persistingStartedAt,
      phaseProgress: 1,
      action: input.action,
      verification,
      draft: null,
      pageUrl: snapshot.url,
      pageTitle: snapshot.title,
      screenshotPath: snapshot.screenshotPath,
      observationSummary: enrichedObservationSummary,
      haltReason: actionResult.blockingReason ?? credentialValidationReason ?? null,
      message: text.stepPersisted
    });

    return {
      stepIndex: input.stepIndex + 1,
      lastObservation: enrichedObservationSummary,
      hasFailures:
        actionResult.status === "failed" ||
        !verification.passed ||
        apiVerification.status === "failed",
      verification,
      workingMemory: nextWorkingMemory,
      page: currentPage,
      haltReason
    };
  }

  private async insertTestCaseFromDecision(
    runId: string,
    decision: LLMDecision
  ): Promise<void> {
    const candidate = decision.test_case_candidate;
    const nextTitle = candidate.title ?? decision.goal;

    const existing = (await this.deps.db
      .select({ id: testCasesTable.id, title: testCasesTable.title })
      .from(testCasesTable)
      .where(eq(testCasesTable.runId, runId))) as Array<{ id: string; title: string }>;

    if (existing.some((item) => item.title.trim() === nextTitle.trim())) {
      return;
    }

    if (existing.length >= 30) {
      return;
    }

    const testCaseRow = {
      id: nanoid(),
      tenantId: await this.resolveRunTenantId(runId),
      runId,
      module: candidate.module ?? "General",
      title: nextTitle,
      preconditions: candidate.preconditions ?? null,
      stepsJson: JSON.stringify(decision.actions),
      expected: candidate.expected ?? decision.expected_checks.join(" | "),
      actual: null,
      status: "pending",
      priority: candidate.priority ?? "P1",
      method: candidate.method ?? "agent-generated",
      createdAt: Date.now()
    };
    await this.deps.db.insert(testCasesTable).values(testCaseRow);
    this.emit("TESTCASE_CREATED", runId, {
      testCase: mapTestCaseRow(testCaseRow)
    });
  }

  private async extractCaseTemplates(
    runId: string,
    projectId: string,
    runConfig: RunConfig
  ): Promise<void> {
    const existing = await this.deps.db
      .select({ id: caseTemplatesTable.id })
      .from(caseTemplatesTable)
      .where(eq(caseTemplatesTable.runId, runId));
    if (existing.length > 0) {
      return;
    }

    const stepRows = (await this.deps.db
      .select()
      .from(stepsTable)
      .where(eq(stepsTable.runId, runId))
      .orderBy(stepsTable.stepIndex)) as StepRow[];
    if (stepRows.length === 0) {
      return;
    }
    const steps = stepRows.map(mapStepRow);
    const evidence = await this.deps.evidenceStore.readRunEvidence(runId);
    const network = evidence?.network ?? [];
    const trafficByStep = new Map<number, typeof network>();
    for (const entry of network) {
      if (!entry.stepIndex) {
        continue;
      }
      const current = trafficByStep.get(entry.stepIndex) ?? [];
      current.push(entry);
      trafficByStep.set(entry.stepIndex, current);
    }

    const now = Date.now();
    const tenantId = await this.resolveRunTenantId(runId);
    const executionMode = this.getExecutionMode(runId, runConfig.executionMode);
    const buildRow = (
      type: "ui" | "api" | "hybrid",
      title: string,
      summary: string,
      payload: unknown
    ) => ({
      id: nanoid(),
      tenantId,
      projectId,
      runId,
      type,
      title,
      goal: runConfig.goal,
      entryUrl: runConfig.targetUrl,
      status: "active",
      summary,
      caseJson: JSON.stringify(payload),
      createdAt: now,
      updatedAt: now
    });

    const uiPayload = {
      executionMode,
      goal: runConfig.goal,
      entryUrl: runConfig.targetUrl,
      steps: steps.map((step) => ({
        index: step.index,
        action: step.action,
        expectedChecks: step.verificationResult.checks.map((item) => item.expected),
        pageUrl: step.pageUrl,
        pageTitle: step.pageTitle,
        verification: step.verificationResult
      }))
    };

    const apiPayload = {
      executionMode,
      goal: runConfig.goal,
      entryUrl: runConfig.targetUrl,
      requests: network.map((entry) => ({
        stepIndex: entry.stepIndex,
        method: entry.method,
        url: entry.url,
        host: entry.host,
        pathname: entry.pathname,
        status: entry.status,
        ok: entry.ok,
        phase: entry.phase,
        resourceType: entry.resourceType,
        contentType: entry.contentType,
        bodyPreview: entry.bodyPreview
      }))
    };

    const hybridPayload = {
      executionMode,
      goal: runConfig.goal,
      entryUrl: runConfig.targetUrl,
      steps: steps.map((step) => ({
        index: step.index,
        action: step.action,
        expectedChecks: step.verificationResult.checks.map((item) => item.expected),
        expectedRequests: (trafficByStep.get(step.index) ?? [])
          .filter((entry) => entry.phase === "failed" || entry.resourceType === "xhr" || entry.resourceType === "fetch")
          .map((entry) => ({
            method: entry.method,
            pathname: entry.pathname,
            host: entry.host,
            status: entry.status,
            resourceType: entry.resourceType
          })),
        verification: step.verificationResult,
        traffic: (trafficByStep.get(step.index) ?? []).map((entry) => ({
          method: entry.method,
          url: entry.url,
          host: entry.host,
          pathname: entry.pathname,
          status: entry.status,
          phase: entry.phase,
          resourceType: entry.resourceType,
          bodyPreview: entry.bodyPreview
        }))
      }))
    };

    await this.deps.db.insert(caseTemplatesTable).values([
      buildRow("ui", `${runConfig.goal} · UI`, "Reusable UI action flow captured from a passed run.", uiPayload),
      buildRow("api", `${runConfig.goal} · API`, "Network traces extracted from the passed run.", apiPayload),
      buildRow("hybrid", `${runConfig.goal} · Hybrid`, "Linked UI steps and API traffic extracted from the passed run.", hybridPayload)
    ]);
  }

  private async persistStartupEvidence(
    runId: string,
    snapshot: PageSnapshot,
    observation: string
  ): Promise<void> {
    await this.deps.db
      .update(runsTable)
      .set({
        startupPageUrl: snapshot.url,
        startupPageTitle: snapshot.title,
        startupScreenshotPath: snapshot.screenshotPath,
        startupObservation: observation
      })
      .where(eq(runsTable.id, runId));
  }

  private async waitForManualTakeover(input: {
    runId: string;
    page: any;
    artifactDir: string;
    stepIndex: number;
    kind?: ChallengeKind;
    reason: string;
    message: string;
    language?: RunConfig["language"];
  }): Promise<string> {
    const text = runtimeText(input.language);
    const labelSuffix = String(Math.max(input.stepIndex, 0)).padStart(4, "0");
    const snapshot = await collectPageSnapshot(input.page, {
      artifactDir: input.artifactDir,
      screenshotPublicPrefix: `/artifacts/runs/${input.runId}`,
      stepIndex: input.stepIndex,
      label: `manual-step-${labelSuffix}`
    });
    await this.persistStartupEvidence(input.runId, snapshot, input.reason);
    this.emitRunStatus(input.runId, {
      status: "running",
      phase: "manual",
      stepIndex: input.stepIndex,
      phaseStartedAt: new Date().toISOString(),
      phaseProgress: 1,
      pageUrl: snapshot.url,
      pageTitle: snapshot.title,
      screenshotPath: snapshot.screenshotPath,
      observationSummary: input.reason,
      manualRequired: true,
      draft: null,
      challengeKind: input.kind,
      message: input.message
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.manualWaiters.delete(input.runId);
        reject(new Error(text.manualInterventionTimeout));
      }, 10 * 60 * 1000);

      this.manualWaiters.set(input.runId, {
        resolve,
        reject,
        timeout
      });
    });

    const resumedSnapshot = await collectPageSnapshot(input.page, {
      artifactDir: input.artifactDir,
      screenshotPublicPrefix: `/artifacts/runs/${input.runId}`,
      stepIndex: input.stepIndex,
      label: `manual-resume-step-${labelSuffix}`
    });
    const observation = text.manualReviewCompletedObservation(input.reason);
    await this.persistStartupEvidence(input.runId, resumedSnapshot, observation);
    this.emitRunStatus(input.runId, {
      status: "running",
      phase: "sensing",
      stepIndex: input.stepIndex,
      phaseStartedAt: new Date().toISOString(),
      phaseProgress: 0.1,
      pageUrl: resumedSnapshot.url,
      pageTitle: resumedSnapshot.title,
      screenshotPath: resumedSnapshot.screenshotPath,
      observationSummary: observation,
      manualRequired: false,
      draft: null,
      challengeKind: input.kind,
      message: text.manualReviewCompletedMessage
    });

    return observation;
  }

  private async persistChallengeState(
    runId: string,
    challenge: SecurityChallengeResult
  ): Promise<void> {
    if (!challenge.detected) {
      return;
    }

    await this.deps.db
      .update(runsTable)
      .set({
        challengeKind: challenge.kind ?? null,
        challengeReason: challenge.reason ?? null
      })
      .where(eq(runsTable.id, runId));
  }

  private async persistRecordedVideo(
    runId: string,
    pageVideo: ReturnType<Page["video"]>
  ): Promise<void> {
    if (!pageVideo) {
      return;
    }

    const absolutePath = await pageVideo.path().catch(() => undefined);
    if (!absolutePath) {
      return;
    }

    const publicPath = `/artifacts/runs/${runId}/video/${basename(absolutePath)}`;
    await this.deps.db
      .update(runsTable)
      .set({
        recordedVideoPath: publicPath
      })
      .where(eq(runsTable.id, runId));
  }

  private async markRunFailed(runId: string, errorMessage: string): Promise<void> {
    await this.deps.db
      .update(runsTable)
      .set({
        status: "failed",
        endedAt: Date.now(),
        errorMessage
      })
      .where(eq(runsTable.id, runId));
    this.emitRunStatus(runId, {
      status: "failed",
      phase: "finished",
      message: errorMessage,
      haltReason: errorMessage
    });
  }

  private async markRunStopped(runId: string, reason: string): Promise<void> {
    await this.deps.db
      .update(runsTable)
      .set({
        status: "stopped",
        endedAt: Date.now(),
        errorMessage: reason
      })
      .where(eq(runsTable.id, runId));
    this.emitRunStatus(runId, {
      status: "stopped",
      phase: "finished",
      message: reason,
      haltReason: reason
    });
  }

  private async generateRunReports(runId: string): Promise<void> {
    const runRows = await this.deps.db
      .select()
      .from(runsTable)
      .where(eq(runsTable.id, runId))
      .limit(1);
    const runRow = runRows[0] as RunRow | undefined;
    if (!runRow) {
      return;
    }

    const projectRows = await this.deps.db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, runRow.projectId))
      .limit(1);
    const projectRow = projectRows[0] as ProjectRow | undefined;
    if (!projectRow) {
      return;
    }

    const stepsRows = (await this.deps.db
      .select()
      .from(stepsTable)
      .where(eq(stepsTable.runId, runId))
      .orderBy(asc(stepsTable.stepIndex))) as StepRow[];

    const testCaseRows = (await this.deps.db
      .select()
      .from(testCasesTable)
      .where(eq(testCasesTable.runId, runId))
      .orderBy(asc(testCasesTable.createdAt))) as TestCaseRow[];

    const htmlPathAbsolute = resolve(this.deps.reportsRoot, "runs", runId, "report.html");
    const xlsxPathAbsolute = resolve(this.deps.reportsRoot, "runs", runId, "report.xlsx");
    const htmlPathPublic = `/reports/runs/${runId}/report.html`;
    const xlsxPathPublic = `/reports/runs/${runId}/report.xlsx`;

    await generateReports({
      project: mapProjectRow(projectRow),
      run: mapRunRow(runRow),
      steps: stepsRows.map(mapStepRow),
      testCases: testCaseRows.map(mapTestCaseRow),
      htmlFilePath: htmlPathAbsolute,
      xlsxFilePath: xlsxPathAbsolute
    });

    await this.deps.db
      .insert(reportsTable)
      .values({
        runId,
        tenantId: runRow.tenantId ?? "tenant-default",
        htmlPath: htmlPathPublic,
        xlsxPath: xlsxPathPublic,
        createdAt: Date.now()
      })
      .onConflictDoUpdate({
        target: reportsTable.runId,
        set: {
          htmlPath: htmlPathPublic,
          xlsxPath: xlsxPathPublic,
          createdAt: Date.now()
        }
      });
  }
}
