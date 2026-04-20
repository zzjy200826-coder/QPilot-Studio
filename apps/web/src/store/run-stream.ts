import type {
  Action,
  ChallengeKind,
  DraftActionState,
  ExecutionMode,
  LLMDecision,
  Run,
  RunLivePhase,
  Step,
  TestCase,
  VerificationResult
} from "@qpilot/shared";
import { create } from "zustand";

export type StreamConnectionState = "connecting" | "live" | "reconnecting" | "closed";

export interface LiveRunState {
  phase: RunLivePhase | "idle";
  message: string;
  stepIndex?: number;
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
  lastEventAt?: string;
}

interface RunStreamState {
  run: Run | null;
  status: Run["status"] | "idle";
  connection: StreamConnectionState;
  latestLLM: LLMDecision | null;
  live: LiveRunState;
  steps: Step[];
  testCases: TestCase[];
  setInitial: (payload: { run: Run; steps: Step[]; testCases: TestCase[] }) => void;
  setConnection: (connection: StreamConnectionState) => void;
  mergeRun: (patch: Partial<Run>) => void;
  setStatus: (status: Run["status"], patch?: Partial<Run>) => void;
  setLLM: (decision: LLMDecision) => void;
  setLive: (payload: Partial<LiveRunState>) => void;
  markHeartbeat: (ts?: string) => void;
  addStep: (step: Step) => void;
  addTestCase: (testCase: TestCase) => void;
}

const nowIso = (): string => new Date().toISOString();

const getLatestStep = (steps: Step[]): Step | undefined => steps[steps.length - 1];

const mergeDefined = <T extends object>(current: T, patch: Partial<T>): T => {
  const next = { ...current } as T;
  for (const key of Object.keys(patch) as Array<keyof T>) {
    const value = patch[key];
    if (value !== undefined) {
      (next as Record<keyof T, T[keyof T]>)[key] = value as T[keyof T];
    }
  }
  return next;
};

const phaseFromRun = (run: Run, latestStep?: Step): LiveRunState["phase"] => {
  if (run.status === "queued") {
    return "queued";
  }
  if (run.status === "running") {
    return latestStep ? "persisting" : "booting";
  }
  if (run.status === "passed" || run.status === "failed" || run.status === "stopped") {
    return "finished";
  }
  return "idle";
};

const liveFromRun = (run: Run, steps: Step[]): LiveRunState => {
  const latestStep = getLatestStep(steps);
  if (!latestStep) {
    return {
      phase: phaseFromRun(run),
      message:
        run.startupObservation ??
        run.errorMessage ??
        "",
      haltReason: run.errorMessage ?? null,
      phaseProgress: run.status === "running" ? 0 : undefined,
      phaseStartedAt: run.startedAt ?? run.createdAt,
      pageUrl: run.startupPageUrl ?? run.targetUrl,
      pageTitle: run.startupPageTitle ?? "Target page",
      screenshotPath: run.startupScreenshotPath,
      observationSummary: run.startupObservation,
      challengeKind: run.challengeKind,
      executionMode: run.executionMode,
      lastEventAt: run.endedAt ?? run.startedAt ?? run.createdAt
    };
  }

  return {
    phase: phaseFromRun(run, latestStep),
    message: latestStep.observationSummary,
    stepIndex: latestStep.index,
    phaseProgress: 1,
    phaseStartedAt: latestStep.createdAt,
    action: latestStep.action,
    verification: latestStep.verificationResult,
    pageUrl: latestStep.pageUrl,
    pageTitle: latestStep.pageTitle,
    screenshotPath: latestStep.screenshotPath,
    observationSummary: latestStep.observationSummary,
    haltReason: run.errorMessage ?? latestStep.verificationResult.note ?? null,
    challengeKind: run.challengeKind,
    executionMode: run.executionMode,
    lastEventAt: latestStep.createdAt
  };
};

const mergeStep = (steps: Step[], nextStep: Step): Step[] => {
  const existing = steps.findIndex((item) => item.id === nextStep.id);
  if (existing >= 0) {
    const updated = [...steps];
    updated[existing] = nextStep;
    return updated.sort((left, right) => left.index - right.index);
  }
  return [...steps, nextStep].sort((left, right) => left.index - right.index);
};

const mergeTestCase = (testCases: TestCase[], nextTestCase: TestCase): TestCase[] => {
  const existing = testCases.findIndex((item) => item.id === nextTestCase.id);
  if (existing >= 0) {
    const updated = [...testCases];
    updated[existing] = nextTestCase;
    return updated;
  }
  return [...testCases, nextTestCase];
};

export const useRunStreamStore = create<RunStreamState>((set, get) => ({
  run: null,
  status: "idle",
  connection: "connecting",
  latestLLM: null,
  live: {
    phase: "idle",
    message: ""
  },
  steps: [],
  testCases: [],
  setInitial: ({ run, steps, testCases }) => {
    set({
      run,
      status: run.status,
      latestLLM: run.llmLastJson ?? null,
      steps,
      testCases,
      live: liveFromRun(run, steps)
    });
  },
  setConnection: (connection) => {
    set({ connection });
  },
  mergeRun: (patch) => {
    const currentRun = get().run;
    if (!currentRun) {
      return;
    }
    set({
      run: { ...currentRun, ...patch }
    });
  },
  setStatus: (status, patch) => {
    const currentRun = get().run;
    set({
      status,
      run: currentRun ? { ...currentRun, status, ...patch } : currentRun
    });
  },
  setLLM: (decision) => set({ latestLLM: decision }),
  setLive: (payload) => {
    set((state) => {
      const nextLive = mergeDefined(state.live, payload);
      return {
        live: {
          ...nextLive,
          phaseStartedAt:
            payload.phaseStartedAt ??
            (payload.phase && payload.phase !== state.live.phase
              ? payload.lastEventAt ?? nowIso()
              : state.live.phaseStartedAt),
          lastEventAt:
            payload.lastEventAt ??
            nextLive.lastEventAt ??
            nowIso()
        }
      };
    });
  },
  markHeartbeat: (ts) => {
    set((state) => ({
      connection: "live",
      live: {
        ...state.live,
        lastEventAt: ts ?? nowIso()
      }
    }));
  },
  addStep: (step) => {
    set((state) => {
      const nextSteps = mergeStep(state.steps, step);
      return {
        steps: nextSteps,
        live: {
          ...state.live,
          phase: "persisting",
          message: step.observationSummary,
          stepIndex: step.index,
          phaseProgress: 1,
          phaseStartedAt: step.createdAt,
          action: step.action,
          verification: step.verificationResult,
          pageUrl: step.pageUrl,
          pageTitle: step.pageTitle,
          screenshotPath: step.screenshotPath,
          observationSummary: step.observationSummary,
          haltReason: step.verificationResult.note ?? null,
          lastEventAt: step.createdAt
        }
      };
    });
  },
  addTestCase: (testCase) => {
    set((state) => ({
      testCases: mergeTestCase(state.testCases, testCase)
    }));
  }
}));
