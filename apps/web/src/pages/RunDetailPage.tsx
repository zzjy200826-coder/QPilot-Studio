import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useState
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Action,
  CaseTemplateRepairDraft,
  DraftActionState,
  ExecutionMode,
  LLMDecision,
  NetworkEvidenceEntry,
  Run,
  RunLivePhase,
  Step,
  TestCase,
  VerificationResult
} from "@qpilot/shared";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { LiveRunViewport } from "../components/LiveRunViewport";
import { RunEvidencePanel } from "../components/RunEvidencePanel";
import { useI18n } from "../i18n/I18nProvider";
import { api, type ActiveRunResponse, type RunControlCommand } from "../lib/api";
import {
  formatLocalizedActionLabel,
  localizeActionType,
  localizeEvidenceText
} from "../lib/evidence-i18n";
import { useRunStreamStore } from "../store/run-stream";

type StepFilter = "all" | "failed" | "blocked";
type DetailMode = "review" | "technical";

interface RunStatusEventEnvelope {
  ts?: string;
  data?: {
    status?: Run["status"];
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
    executionMode?: ExecutionMode;
    draft?: DraftActionState | null;
    replayCaseId?: string | null;
    replayCaseTitle?: string | null;
    replayCaseType?: Run["replayCaseType"] | null;
    endedAt?: string | null;
    errorMessage?: string;
  };
}

interface RunLlmEventEnvelope {
  ts?: string;
  data?: { stepIndex?: number; decision?: LLMDecision };
}

interface StepCreatedEnvelope {
  data?: { step?: Step };
}

interface TestCaseCreatedEnvelope {
  data?: { testCase?: TestCase };
}

interface RunFinishedEnvelope {
  ts?: string;
  data?: { status?: Run["status"]; endedAt?: string | null; haltReason?: string | null };
}

const parseJsonEvent = <T,>(event: Event): T | null => {
  try {
    return JSON.parse((event as MessageEvent).data) as T;
  } catch {
    return null;
  }
};

const isTerminalRun = (status?: Run["status"] | "idle"): boolean =>
  status === "passed" || status === "failed" || status === "stopped";

const statusTone = (status: Run["status"] | "idle"): string => {
  switch (status) {
    case "running":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "passed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "failed":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "stopped":
      return "border-slate-300 bg-slate-100 text-slate-700";
    default:
      return "border-amber-200 bg-amber-50 text-amber-700";
  }
};

const apiTone = (status?: "passed" | "failed" | "neutral"): string => {
  switch (status) {
    case "passed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "failed":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
};

const diagnosticTone = (
  category?: string
): string => {
  switch (category) {
    case "api_mismatch":
    case "wrong_target":
    case "unexpected_runtime":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "locator_miss":
    case "element_not_interactable":
    case "no_effect":
    case "security_challenge":
    case "blocked_high_risk":
      return "border-amber-200 bg-amber-50 text-amber-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
};

const copyDraftAction = (draft?: DraftActionState | null): Action | null =>
  draft
    ? {
        type: draft.action.type,
        target: draft.action.target,
        value: draft.action.value,
        ms: draft.action.ms,
        note: draft.action.note
      }
    : null;

export const RunDetailPage = () => {
  const { formatDateTime, formatRelativeTime, language, pick } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { runId = "" } = useParams();
  const compareTo = searchParams.get("compareTo") ?? "";
  const [error, setError] = useState<string | null>(null);
  const [stepFilter, setStepFilter] = useState<StepFilter>("all");
  const [stepKeyword, setStepKeyword] = useState("");
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);
  const [detailMode, setDetailMode] = useState<DetailMode>("review");
  const [draftEdit, setDraftEdit] = useState<Action | null>(null);
  const [repairDraftPreview, setRepairDraftPreview] = useState<CaseTemplateRepairDraft | null>(null);
  const deferredStepKeyword = useDeferredValue(stepKeyword);

  const run = useRunStreamStore((state) => state.run);
  const status = useRunStreamStore((state) => state.status);
  const connection = useRunStreamStore((state) => state.connection);
  const live = useRunStreamStore((state) => state.live);
  const latestLLM = useRunStreamStore((state) => state.latestLLM);
  const steps = useRunStreamStore((state) => state.steps);
  const setInitial = useRunStreamStore((state) => state.setInitial);
  const setConnection = useRunStreamStore((state) => state.setConnection);
  const setStatus = useRunStreamStore((state) => state.setStatus);
  const setLLM = useRunStreamStore((state) => state.setLLM);
  const setLive = useRunStreamStore((state) => state.setLive);
  const mergeRun = useRunStreamStore((state) => state.mergeRun);
  const markHeartbeat = useRunStreamStore((state) => state.markHeartbeat);
  const addStep = useRunStreamStore((state) => state.addStep);
  const addTestCase = useRunStreamStore((state) => state.addTestCase);

  const focusMutation = useMutation({ mutationFn: () => api.bringRunToFront(runId) });
  const controlMutation = useMutation({
    mutationFn: (payload: RunControlCommand) => api.controlRun(runId, payload),
    onMutate: (payload) => {
      setError(null);
      const previousState = useRunStreamStore.getState();

      if (payload.command === "switch_mode") {
        mergeRun({ executionMode: payload.executionMode });
        setLive({ executionMode: payload.executionMode });
      } else if (
        payload.command === "approve" ||
        payload.command === "edit_and_run" ||
        payload.command === "retry"
      ) {
        const optimisticAction =
          payload.command === "edit_and_run"
            ? payload.action
            : payload.command === "approve"
              ? payload.action ?? currentDraft?.action ?? draftEdit ?? currentAction
              : currentDraft?.action ?? draftEdit ?? currentAction;
        setLive({
          draft: null,
          manualRequired: false,
          phase: "executing",
          action: optimisticAction ?? undefined,
          message: pick("Draft accepted. Executing the next action.", "\u8349\u6848\u5df2\u6279\u51c6\uff0c\u6b63\u5728\u6267\u884c\u4e0b\u4e00\u6b65\u3002")
        });
      } else if (payload.command === "skip") {
        setLive({
          draft: null,
          manualRequired: false,
          phase: "planning",
          message: pick("Draft skipped. Replanning now.", "\u5df2\u8df3\u8fc7\u5f53\u524d\u8349\u6848\uff0c\u6b63\u5728\u91cd\u65b0\u89c4\u5212\u3002")
        });
      }

      return {
        previousRun: previousState.run,
        previousLive: previousState.live
      };
    },
    onSuccess: (response) => {
      if (response.executionMode) {
        mergeRun({ executionMode: response.executionMode });
        setLive({ executionMode: response.executionMode });
      }
    },
    onError: (mutationError, _payload, context) => {
      if (context) {
        useRunStreamStore.setState({
          run: context.previousRun,
          live: context.previousLive
        });
      }
      setError(mutationError instanceof Error ? mutationError.message : pick("Action failed", "操作失败"));
    }
  });
  const extractCasesMutation = useMutation({
    mutationFn: () => api.extractCases(runId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["run", runId, "cases"] });
    }
  });
  const replayCaseMutation = useMutation({
    mutationFn: (caseId: string) =>
      api.replayCase(caseId, {
        language: run?.language ?? "zh-CN",
        executionMode: "stepwise_replan",
        confirmDraft: true,
        headed: true,
        manualTakeover: true,
        sessionProfile: run?.sessionProfile,
        saveSession: Boolean(run?.saveSession)
      }),
    onSuccess: (nextRun) => navigate(`/runs/${nextRun.id}`)
  });
  const rerunMutation = useMutation({
    mutationFn: () => api.rerunRun(runId),
    onSuccess: (nextRun) => {
      navigate(`/runs/${nextRun.id}?compareTo=${runId}`);
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : pick("Rerun failed", "重跑失败"));
    }
  });
  const previewRepairDraftMutation = useMutation({
    mutationFn: (caseId: string) => api.previewCaseRepairDraft(caseId, runId),
    onSuccess: (draft) => {
      setRepairDraftPreview(draft);
      setError(null);
    },
    onError: (mutationError) => {
      setRepairDraftPreview(null);
      setError(mutationError instanceof Error ? mutationError.message : pick("Preview failed", "\u751f\u6210\u8349\u6848\u5931\u8d25"));
    }
  });
  const applyRepairDraftMutation = useMutation({
    mutationFn: (input: { caseId: string; replay?: boolean }) =>
      api.applyCaseRepairDraft(
        input.caseId,
        runId,
        input.replay
          ? {
              language: run?.language ?? "zh-CN",
              executionMode: "auto_batch",
              confirmDraft: false,
              headed: true,
              manualTakeover: true,
              sessionProfile: run?.sessionProfile,
              saveSession: Boolean(run?.saveSession)
            }
          : undefined
      ),
    onSuccess: (response) => {
      setRepairDraftPreview(response.draft);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["run", runId, "cases"] });
      void queryClient.invalidateQueries({ queryKey: ["cases"] });
      if (response.replayRun) {
        navigate(`/runs/${response.replayRun.id}`);
      }
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : pick("Apply failed", "\u5e94\u7528\u8349\u6848\u5931\u8d25"));
    }
  });

  const handleInitialData = useEffectEvent((nextRun: Run, nextSteps: Step[], nextCases: TestCase[]) => {
    setInitial({ run: nextRun, steps: nextSteps, testCases: nextCases });
    const latestStep = nextSteps[nextSteps.length - 1];
    if (latestStep) {
      setSelectedStepId((current) => (autoFollow ? latestStep.id : current ?? latestStep.id));
    }
  });

  const handleIncomingStep = useEffectEvent((step: Step) => {
    addStep(step);
    setSelectedStepId((current) => (autoFollow ? step.id : current ?? step.id));
  });

  const applyActiveControlState = useEffectEvent((activeState: ActiveRunResponse | null) => {
    if (!activeState?.activeRun || activeState.activeRun.id !== runId || !activeState.control) {
      return;
    }

    if (activeState.control.executionMode) {
      mergeRun({ executionMode: activeState.control.executionMode });
    }

    setLive({
      phase: activeState.control.phase,
      message: activeState.control.message ?? undefined,
      stepIndex: activeState.control.stepIndex,
      manualRequired: activeState.control.manualRequired,
      executionMode: activeState.control.executionMode,
      draft: activeState.control.draft,
      lastEventAt: activeState.control.lastEventAt
    });
  });

  const applyRunStatus = useEffectEvent((payload: RunStatusEventEnvelope | null) => {
    if (!payload?.data) {
      return;
    }
    const next = payload.data;
    if (
      "replayCaseId" in next ||
      "replayCaseTitle" in next ||
      "replayCaseType" in next
    ) {
      mergeRun({
        replayCaseId: next.replayCaseId ?? undefined,
        replayCaseTitle: next.replayCaseTitle ?? undefined,
        replayCaseType: next.replayCaseType ?? undefined
      });
    }
    if (next.status) {
      setStatus(next.status, {
        endedAt: next.endedAt ?? undefined,
        errorMessage: next.errorMessage ?? next.haltReason ?? undefined
      });
    }
    setLive({
      phase: next.phase ?? undefined,
      message: next.message ?? undefined,
      stepIndex: next.stepIndex,
      phaseProgress: next.phaseProgress,
      phaseStartedAt: next.phaseStartedAt,
      action: next.action,
      verification: next.verification,
      pageUrl: next.pageUrl,
      pageTitle: next.pageTitle,
      screenshotPath: next.screenshotPath,
      observationSummary: next.observationSummary,
      haltReason: next.haltReason,
      manualRequired: next.manualRequired,
      executionMode: next.executionMode,
      draft: next.draft,
      lastEventAt: payload.ts
    });
    if (next.haltReason) {
      setError(next.haltReason);
    }
  });

  useEffect(() => {
    if (!runId) {
      return;
    }
    let active = true;
    let source: EventSource | null = null;
    setConnection("connecting");

    const refreshAll = async (): Promise<Run | null> => {
      try {
        const [nextRun, nextSteps, nextCases, activeControl] = await Promise.all([
          api.getRun(runId),
          api.getRunSteps(runId),
          api.getRunTestCases(runId),
          api.getActiveRun()
        ]);
        if (active) {
          handleInitialData(nextRun, nextSteps, nextCases);
          applyActiveControlState(activeControl);
        }
        return nextRun;
      } catch (fetchError) {
        if (active) {
          setError(fetchError instanceof Error ? fetchError.message : pick("Load failed", "加载失败"));
        }
        return null;
      }
    };

    const connect = async (): Promise<void> => {
      const nextRun = await refreshAll();
      if (!active) {
        return;
      }
      if (!nextRun || isTerminalRun(nextRun.status)) {
        setConnection("closed");
        return;
      }

      source = api.createRunStream(runId);
      source.onopen = () => {
        setConnection("live");
        markHeartbeat();
      };
      source.onerror = () => setConnection("reconnecting");
      source.addEventListener("connected", (event) => markHeartbeat(parseJsonEvent<{ ts?: string }>(event)?.ts));
      source.addEventListener("ping", (event) => markHeartbeat(parseJsonEvent<{ ts?: string }>(event)?.ts));
      source.addEventListener("run.status", (event) => applyRunStatus(parseJsonEvent(event)));
      source.addEventListener("run.llm", (event) => {
        const payload = parseJsonEvent<RunLlmEventEnvelope>(event);
        if (payload?.data?.decision) {
          setLLM(payload.data.decision);
        }
      });
      source.addEventListener("step.created", (event) => {
        const payload = parseJsonEvent<StepCreatedEnvelope>(event);
        if (payload?.data?.step) {
          handleIncomingStep(payload.data.step);
        }
      });
      source.addEventListener("testcase.created", (event) => {
        const payload = parseJsonEvent<TestCaseCreatedEnvelope>(event);
        if (payload?.data?.testCase) {
          addTestCase(payload.data.testCase);
        }
      });
      source.addEventListener("run.finished", (event) => {
        const payload = parseJsonEvent<RunFinishedEnvelope>(event);
        if (payload?.data?.status) {
          setStatus(payload.data.status, {
            endedAt: payload.data.endedAt ?? undefined,
            errorMessage: payload.data.haltReason ?? undefined
          });
        }
        setConnection("closed");
      });
    };

    void connect();
    return () => {
      active = false;
      setConnection("closed");
      source?.close();
    };
  }, [
    addStep,
    addTestCase,
    applyActiveControlState,
    applyRunStatus,
    handleIncomingStep,
    handleInitialData,
    markHeartbeat,
    pick,
    runId,
    setConnection,
    setInitial,
    setLLM,
    setLive,
    setStatus
  ]);

  const latestStep = steps[steps.length - 1];
  const selectedStep = useMemo(() => {
    if (autoFollow) {
      return latestStep;
    }
    return steps.find((step) => step.id === selectedStepId) ?? latestStep;
  }, [autoFollow, latestStep, selectedStepId, steps]);

  const currentDraft = live.draft ?? null;
  const currentAction = currentDraft?.action ??
    (autoFollow ? live.action ?? latestStep?.action : selectedStep?.action ?? live.action);
  const currentVerification = autoFollow
    ? live.verification ?? latestStep?.verificationResult
    : selectedStep?.verificationResult ?? live.verification;
  const currentExecutionDiagnostics = currentVerification?.execution;
  const currentTemplateReplay = currentExecutionDiagnostics?.templateReplay;
  const currentTemplateRepairCandidate = currentExecutionDiagnostics?.templateRepairCandidate;
  const currentObservationSummary =
    (autoFollow
      ? live.observationSummary ?? latestStep?.observationSummary
      : selectedStep?.observationSummary ?? live.observationSummary) ?? "";
  const localizedError = localizeEvidenceText(error, language);
  const localizedRunError = localizeEvidenceText(run?.errorMessage, language);
  const localizedLiveMessage = localizeEvidenceText(live.message, language);
  const localizedLiveHaltReason = localizeEvidenceText(live.haltReason, language);
  const localizedObservationSummary = localizeEvidenceText(currentObservationSummary, language);
  const localizedVerificationNote = localizeEvidenceText(currentVerification?.note, language);
  const localizedApiNote = localizeEvidenceText(currentVerification?.api?.note, language);
  const localizedFailureSuggestion = localizeEvidenceText(
    currentExecutionDiagnostics?.failureSuggestion,
    language
  );
  const localizedReplayRepairSuggestion = localizeEvidenceText(
    currentTemplateReplay?.repairSuggestion,
    language
  );
  const localizedTemplateRepairReason = localizeEvidenceText(
    currentTemplateRepairCandidate?.reason ?? currentTemplateRepairCandidate?.repairHint,
    language
  );
  const currentPageTitle =
    (autoFollow ? live.pageTitle ?? latestStep?.pageTitle : selectedStep?.pageTitle ?? live.pageTitle) ??
    run?.startupPageTitle ??
    pick("Target page", "目标页面");
  const currentPageUrl =
    (autoFollow ? live.pageUrl ?? latestStep?.pageUrl : selectedStep?.pageUrl ?? live.pageUrl) ??
    run?.startupPageUrl ??
    run?.targetUrl;
  const currentScreenshot =
    (autoFollow
      ? live.screenshotPath ?? latestStep?.screenshotPath
      : selectedStep?.screenshotPath ?? live.screenshotPath) ?? run?.startupScreenshotPath;

  useEffect(() => {
    setDraftEdit(copyDraftAction(currentDraft));
  }, [currentDraft]);

  useEffect(() => {
    setRepairDraftPreview(null);
  }, [runId]);

  useEffect(() => {
    setDetailMode("review");
  }, [runId]);

  const showTechnicalDetails = detailMode === "technical";
  const selectedStepIndex = autoFollow ? live.stepIndex ?? latestStep?.index : selectedStep?.index;
  const selectedTrafficRef = autoFollow ? selectedStepIndex : selectedStep?.id ?? selectedStepIndex;

  const stepTrafficQuery = useQuery({
    queryKey: ["run", runId, "traffic", selectedTrafficRef],
    queryFn: () => api.getStepTrafficByRef(runId, selectedTrafficRef as string | number),
    enabled: Boolean(runId && selectedTrafficRef),
    refetchInterval: status === "running" ? 1500 : false
  });
  const runTrafficQuery = useQuery({
    queryKey: ["run", runId, "traffic", "all"],
    queryFn: () => api.getRunTraffic(runId),
    enabled: Boolean(runId),
    refetchInterval: status === "running" ? 1500 : false
  });

  const runCasesQuery = useQuery({
    queryKey: ["run", runId, "cases"],
    queryFn: () => api.getRunCases(runId),
    enabled: Boolean(runId)
  });
  const comparisonQuery = useQuery({
    queryKey: ["run", runId, "compare", compareTo, language],
    queryFn: () => api.compareRuns(compareTo, runId, language),
    enabled: Boolean(runId && compareTo),
    refetchInterval: status === "running" ? 2_000 : false
  });

  const filteredSteps = useMemo(() => {
    const keyword = deferredStepKeyword.trim().toLowerCase();
    return steps.filter((step) => {
      if (stepFilter === "failed" && step.actionStatus !== "failed") {
        return false;
      }
      if (stepFilter === "blocked" && step.actionStatus !== "blocked_high_risk") {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return [step.action.type, step.action.target ?? "", step.action.note ?? "", step.observationSummary]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [deferredStepKeyword, stepFilter, steps]);
  const timelineSteps = useMemo(
    () => (showTechnicalDetails ? filteredSteps : filteredSteps.slice(-8)),
    [filteredSteps, showTechnicalDetails]
  );
  const templateReplaySteps = useMemo(
    () => steps.filter((step) => step.verificationResult.execution?.templateReplay),
    [steps]
  );
  const templateMatchedCount = useMemo(
    () =>
      templateReplaySteps.filter(
        (step) => step.verificationResult.execution?.templateReplay?.outcome === "matched"
      ).length,
    [templateReplaySteps]
  );
  const templateDriftedCount = useMemo(
    () =>
      templateReplaySteps.filter(
        (step) => step.verificationResult.execution?.templateReplay?.outcome === "drifted"
      ).length,
    [templateReplaySteps]
  );
  const templateHitRate =
    templateReplaySteps.length > 0
      ? Math.round((templateMatchedCount / templateReplaySteps.length) * 100)
      : null;
  const latestTemplateReplay = useMemo(
    () =>
      [...templateReplaySteps]
        .reverse()
        .map((step) => step.verificationResult.execution?.templateReplay)
        .find(Boolean),
    [templateReplaySteps]
  );
  const templateRepairCandidates = useMemo(
    () =>
      [...templateReplaySteps]
        .reverse()
        .map((step) => {
          const candidate = step.verificationResult.execution?.templateRepairCandidate;
          if (!candidate) {
            return null;
          }
          return {
            step,
            candidate
          };
        })
        .filter(
          (
            item
          ): item is {
            step: Step;
            candidate: NonNullable<
              NonNullable<Step["verificationResult"]["execution"]>["templateRepairCandidate"]
            >;
          } => Boolean(item)
        ),
    [templateReplaySteps]
  );
  const repairDraftCaseId =
    run?.replayCaseId ?? templateRepairCandidates[0]?.candidate.templateId ?? null;

  const activeExecutionMode = live.executionMode ?? run?.executionMode ?? "auto_batch";
  const cases = runCasesQuery.data ?? [];
  const comparison = comparisonQuery.data;
  const comparisonError =
    comparisonQuery.error instanceof Error ? comparisonQuery.error.message.trim() : "";
  const compareReportHref = compareTo ? `/reports/${runId}?compareTo=${compareTo}` : `/reports/${runId}`;
  const compareLabel = compareTo ? compareTo.slice(0, 8) : "";
  const comparisonSignals = comparison?.changedSignals.slice(0, 4) ?? [];
  const comparisonTone = comparison
    ? comparison.candidateRun.status === "passed"
      ? "border-emerald-200 bg-emerald-50/70"
      : comparison.candidateRun.status === "failed"
        ? "border-rose-200 bg-rose-50/70"
        : comparison.candidateRun.status === "stopped"
          ? "border-amber-200 bg-amber-50/70"
          : "border-sky-200 bg-sky-50/70"
    : comparisonError
      ? "border-rose-200 bg-rose-50/70"
      : "border-slate-200 bg-slate-50";
  const comparisonTitle = comparison
    ? localizeEvidenceText(comparison.headline, language)
    : comparisonQuery.isLoading || comparisonQuery.isFetching
      ? pick("Preparing the baseline diff for this rerun.", "正在为这次重跑准备基线对比。")
      : comparisonError
        ? pick("The baseline diff is not available yet.", "基线对比暂时还不可用。")
        : pick(
            `Tracking changes against baseline ${compareLabel}.`,
            `正在对照基线 ${compareLabel} 追踪变化。`
          );
  const comparisonDetail = comparison
    ? localizeEvidenceText(comparison.summary, language)
    : comparisonError ||
      pick(
        "This page will keep the diff summary updated as the rerun progresses.",
        "这张详情页会随着重跑进展持续刷新对比摘要。"
      );
  const comparisonCtaLabel = compareTo
    ? isTerminalRun(status)
      ? pick("Open Diff Report", "打开对比报告")
      : pick("Watch Diff Report", "查看对比报告")
    : pick("Open Report", "打开报告");
  const comparisonSupportLine = compareTo
    ? comparison
      ? pick(
          `Baseline ${compareLabel}: ${localizeEvidenceText(comparison.summary, language)}`,
          `基线 ${compareLabel}：${localizeEvidenceText(comparison.summary, language)}`
        )
      : comparisonQuery.isLoading || comparisonQuery.isFetching
        ? pick(
            `Tracking changes against baseline ${compareLabel}.`,
            `正在对照基线 ${compareLabel} 追踪变化。`
          )
        : comparisonError
          ? comparisonError
          : pick(
              `This rerun is linked to baseline ${compareLabel}.`,
              `这次重跑已经关联到基线 ${compareLabel}。`
            )
    : "";
  const stepTrafficEntries = stepTrafficQuery.data ?? [];
  const runTrafficEntries = runTrafficQuery.data ?? [];
  const recentRunTraffic = runTrafficEntries.slice(-20);
  const stepScopedRunTraffic = selectedStepIndex
    ? runTrafficEntries.filter((entry) => entry.stepIndex === selectedStepIndex)
    : [];
  const trafficEntries =
    stepTrafficEntries.length > 0
      ? stepTrafficEntries
      : stepScopedRunTraffic.length > 0
        ? stepScopedRunTraffic
        : recentRunTraffic;
  const isTrafficFallback =
    stepTrafficEntries.length === 0 &&
    stepScopedRunTraffic.length === 0 &&
    recentRunTraffic.length > 0;
  const trafficError =
    (stepTrafficQuery.error as Error | null | undefined) ??
    (runTrafficQuery.error as Error | null | undefined) ??
    null;
  const isManualBlock = live.phase === "manual" || live.manualRequired;
  const isPaused = live.phase === "paused";
  const canResume = status === "running" && (isManualBlock || isPaused);
  const draftReason =
    currentDraft?.reason ??
    latestLLM?.plan.reason ??
    (run?.replayCaseTitle
      ? pick(
          `Using case template "${run.replayCaseTitle}" as the primary execution path.`,
          `\u6b63\u5728\u4f18\u5148\u590d\u7528 Case \u6a21\u677f\u201c${run.replayCaseTitle}\u201d\u6267\u884c\u3002`
        )
      : pick(
          "Waiting for the next planner decision.",
          "\u7b49\u5f85\u4e0b\u4e00\u6b21 Planner \u51b3\u7b56\u3002"
        ));
  const isTerminalStatus = isTerminalRun(status);
  const statusLabel =
    status === "running"
      ? pick("running", "运行中")
      : status === "passed"
        ? pick("passed", "已通过")
        : status === "failed"
          ? pick("failed", "失败")
          : status === "stopped"
            ? pick("stopped", "已停止")
            : pick("idle", "空闲");
  const livePhaseLabel =
    live.phase === "booting"
      ? pick("booting", "启动中")
      : live.phase === "sensing"
        ? pick("sensing", "感知中")
        : live.phase === "planning"
          ? pick("planning", "规划中")
          : live.phase === "drafting"
            ? pick("drafting", "等待草案处理")
            : live.phase === "executing"
              ? pick("executing", "执行中")
              : live.phase === "verifying"
                ? pick("verifying", "校验中")
                : live.phase === "paused"
                  ? pick("paused", "已暂停")
                  : live.phase === "manual"
                    ? pick("manual", "等待人工处理")
                    : live.phase === "persisting"
                      ? pick("persisting", "保存中")
                      : live.phase === "reporting"
                        ? pick("reporting", "生成报告中")
                        : live.phase === "finished"
                          ? pick("finished", "已完成")
                          : live.phase;
  const phaseBadgeLabel = isTerminalStatus ? pick("finished", "已完成") : livePhaseLabel;
  const streamStatusLabel =
    connection === "live"
      ? pick("Event stream live", "事件流已连接")
      : connection === "reconnecting"
        ? pick("Event stream reconnecting", "事件流重连中")
        : connection === "connecting"
          ? pick("Event stream connecting", "事件流连接中")
          : pick("Event stream closed", "事件流已关闭");
  const terminalStatusNotice = isTerminalStatus
    ? status === "passed"
      ? {
          eyebrow: pick("Completed", "已完成"),
          title: pick("This run finished successfully.", "这条运行已经顺利完成。"),
          detail:
            localizedVerificationNote ??
            localizedLiveMessage ??
            pick(
              "The latest verified step passed and the run has moved into review mode.",
              "最近一步已经通过校验，这条运行现在进入复盘状态。"
            ),
          tone: "border-emerald-200 bg-emerald-50/80",
          badgeTone: "border-emerald-300 bg-white text-emerald-800"
        }
      : status === "failed"
        ? {
          eyebrow: pick("Failed", "失败"),
          title: pick("This run ended with a failure.", "这条运行以失败结束。"),
          detail:
            localizedRunError ??
            localizedLiveHaltReason ??
            localizedVerificationNote ??
            localizedLiveMessage ??
            pick(
              "Review the diff, report, and evidence below to understand the stopping point.",
              "可以直接往下查看对比、报告和证据，定位停机原因。"
              ),
            tone: "border-rose-200 bg-rose-50/80",
            badgeTone: "border-rose-300 bg-white text-rose-700"
          }
        : {
          eyebrow: pick("Stopped", "已停止"),
          title: pick("This run was stopped before completion.", "这条运行在完成前被停止了。"),
          detail:
            localizedLiveHaltReason ??
            localizedLiveMessage ??
            pick(
              "You can resume later, or review the captured evidence below.",
              "你可以稍后继续，也可以先查看下面已经捕获到的证据。"
              ),
            tone: "border-slate-300 bg-slate-100/80",
            badgeTone: "border-slate-300 bg-white text-slate-700"
          }
    : null;
  const statusNotice = isManualBlock
    ? {
        eyebrow: pick("Manual Checkpoint", "人工检查点"),
        title: pick("The run is waiting for you to finish this page.", "运行正在等待你处理完当前页面。"),
        detail:
          localizedLiveMessage ??
          pick(
            "The agent intentionally stopped to avoid random clicks. Finish the browser step locally, then resume the run.",
            "为了避免继续误点，代理已经主动停下。请先在本地浏览器里完成当前步骤，再继续运行。"
          ),
        tone: "border-amber-200 bg-amber-50",
        badgeTone: "border-amber-300 bg-white text-amber-800"
      }
    : isPaused
      ? {
          eyebrow: pick("Paused", "已暂停"),
          title: pick("This run is paused.", "这条运行已暂停。"),
          detail:
            localizedLiveMessage ??
            pick("Resume whenever you're ready to continue.", "准备好后点击继续即可恢复。"),
          tone: "border-slate-200 bg-slate-50",
          badgeTone: "border-slate-300 bg-white text-slate-700"
        }
      : currentDraft
        ? {
            eyebrow: pick("Draft Waiting", "草案待处理"),
            title: pick("The next action needs your decision.", "下一步动作需要你来决定。"),
            detail: localizedLiveMessage ?? draftReason,
            tone: "border-sky-200 bg-sky-50",
            badgeTone: "border-sky-300 bg-white text-sky-800"
          }
        : terminalStatusNotice
          ? terminalStatusNotice
          : connection === "reconnecting"
          ? {
              eyebrow: pick("Realtime Link", "实时链路"),
              title: pick("The page is reconnecting to the event stream.", "页面正在重连运行事件流。"),
              detail:
                localizedLiveMessage ??
                pick(
                  "The browser may still be running. This page will continue once the next event arrives.",
                  "浏览器可能仍在运行，等下一条状态事件到达后页面会继续刷新。"
                ),
              tone: "border-slate-200 bg-slate-50",
              badgeTone: "border-slate-300 bg-white text-slate-700"
            }
          : localizedLiveMessage
            ? {
                eyebrow: pick("Current Status", "当前状态"),
                title: pick("The run is still active.", "运行仍在进行中。"),
                detail: localizedLiveMessage,
                tone: "border-slate-200 bg-slate-50",
                badgeTone: "border-slate-300 bg-white text-slate-700"
              }
            : null;
  const sidebarEyebrow = currentDraft
    ? pick("Next Draft", "下一步草案")
    : canResume
      ? pick("Manual Required", "需要人工处理")
      : isTerminalStatus
        ? pick("Review Mode", "复盘模式")
        : pick("Planner Status", "规划状态");
  const sidebarTitle = currentDraft
    ? pick("Approve, edit, skip, or switch mode", "批准、编辑、跳过或切换模式")
    : canResume
      ? pick("Resume after the current page is handled", "当前页面处理完后继续运行")
      : isTerminalStatus
        ? status === "passed"
          ? pick("The run is complete. Review or extract the outcome.", "运行已完成，可以回看或沉淀结果。")
          : pick("Review the captured outcome and decide the next move.", "先复盘这次结果，再决定下一步。")
        : pick("Waiting for the next planner update", "等待下一次规划更新");
  const sidebarDescription = currentDraft
    ? draftReason
    : isTerminalStatus
      ? statusNotice?.detail ??
        pick(
          "Use compare, report, and case tools below to turn this run into something reusable.",
          "可以继续查看对比、报告和 Case 工具，把这次运行沉淀成可复用资产。"
        )
      : statusNotice?.detail ?? localizedLiveMessage ?? draftReason;
  const stepFilterLabel = (value: StepFilter): string =>
    value === "all"
      ? pick("All", "全部")
      : value === "failed"
        ? pick("Failed", "失败")
        : pick("Blocked", "阻塞");
  const runStatusBadgeLabel = (value: Run["status"]): string =>
    value === "queued"
      ? pick("Queued", "排队中")
      : value === "running"
        ? pick("Running", "运行中")
        : value === "passed"
          ? pick("Passed", "已通过")
          : value === "failed"
            ? pick("Failed", "失败")
            : pick("Stopped", "已停止");
  const comparisonSignalLabel = (signal: string): string => {
    switch (signal) {
      case "status":
        return pick("status", "状态");
      case "step_count":
        return pick("step_count", "步数");
      case "final_page":
        return pick("final_page", "落点页面");
      case "failure_category":
        return pick("failure_category", "失败类别");
      default:
        return signal;
    }
  };
  const executionModeOptionLabel = (mode: ExecutionMode): string =>
    mode === "stepwise_replan"
      ? pick("Stepwise Replan", "单步重规划")
      : pick("Auto Batch", "自动整批");
  const currentStepNumber = live.stepIndex ?? latestStep?.index ?? 0;
  const friendlyFailureCategory =
    currentExecutionDiagnostics?.failureCategory === "api_mismatch"
      ? pick("The page changed, but the expected API did not line up.", "页面已经变化，但关键接口没有对上。")
      : currentExecutionDiagnostics?.failureCategory === "wrong_target"
        ? pick("The action likely hit the wrong target.", "这一步大概率点错了目标。")
        : currentExecutionDiagnostics?.failureCategory === "unexpected_runtime"
          ? pick("The page reacted in an unexpected way.", "页面反馈和预期不一致。")
          : currentExecutionDiagnostics?.failureCategory === "locator_miss"
            ? pick("The target element could not be found.", "没有找到要操作的目标元素。")
            : currentExecutionDiagnostics?.failureCategory === "element_not_interactable"
              ? pick("The target element was present but not operable.", "目标元素存在，但当前无法操作。")
              : currentExecutionDiagnostics?.failureCategory === "no_effect"
                ? pick("This action did not cause a meaningful page change.", "这一步没有让页面产生明显变化。")
                : currentExecutionDiagnostics?.failureCategory === "security_challenge"
                  ? pick("A verification or security wall interrupted the run.", "验证码或安全校验打断了运行。")
                  : currentExecutionDiagnostics?.failureCategory === "blocked_high_risk"
                    ? pick("This action was blocked because the risk was too high.", "这一步风险过高，已被平台拦截。")
                    : null;
  const apiSummary =
    localizedApiNote ??
    ((currentVerification?.api?.requestCount ?? 0) > 0
      ? pick(
          `${currentVerification?.api?.requestCount ?? 0} requests were linked to this step.`,
          `这一步关联到了 ${currentVerification?.api?.requestCount ?? 0} 个请求。`
        )
      : pick("No step-linked API result has been recorded yet.", "这一步还没有记录到可解释的接口结果。"));
  const guidedStatusTitle = currentDraft
    ? pick("The run is waiting for your decision on the next action.", "运行正在等待你决定下一步动作。")
    : canResume
      ? pick("The run intentionally stopped on the current page.", "运行主动停在了当前页面。")
      : isTerminalStatus
        ? status === "passed"
          ? pick("The run has completed successfully.", "这条运行已经顺利完成。")
          : status === "failed"
            ? pick("The run has already ended in failure.", "这条运行已经以失败结束。")
            : pick("The run has already been stopped.", "这条运行已经被停止。")
      : currentVerification?.passed
        ? pick("The latest step looks healthy.", "最近一步看起来是正常的。")
        : friendlyFailureCategory ??
          pick("The run is still gathering evidence from the current page.", "运行仍在从当前页面收集证据。");
  const guidedStatusDetail =
    localizedFailureSuggestion ??
    localizedVerificationNote ??
    localizedObservationSummary ??
    localizedLiveMessage ??
    draftReason;
  const guidedDiagnosisTitle =
    friendlyFailureCategory ??
    (currentVerification?.api?.status === "failed"
      ? pick("The API signal needs attention.", "接口信号需要关注。")
      : currentVerification?.api?.status === "passed"
        ? pick("The API signal looks healthy.", "接口信号看起来正常。")
        : pick("There is not enough API signal yet.", "目前还没有足够的接口信号。"));
  const guidedNextTitle = currentDraft
    ? pick("Review the drafted action.", "处理这条待执行草案。")
    : canResume
      ? pick("Finish the browser step, then resume.", "先处理浏览器页面，再继续运行。")
      : status === "running"
        ? pick("Keep watching the current page for the next step.", "继续观察当前页面，等待下一步。")
        : status === "passed"
          ? pick("The run is complete. You can review or extract it.", "运行已完成，可以回看或沉淀结果。")
          : pick("Open the report if you need the full history.", "如果需要完整历史，可以打开报告。");
  const guidedNextDetail = currentDraft
    ? pick(
        "Approve it, edit it, or skip it. The run will continue from your choice.",
        "你可以批准、编辑或跳过它，运行会按照你的选择继续。"
      )
    : canResume
      ? pick(
          "The agent stopped to avoid random clicks. Handle the blocking page locally, then click resume.",
          "代理已经停下来避免继续乱点。请先在本地处理阻塞页面，再点击继续。"
        )
      : status === "running"
        ? pick(
            "You do not need to read JSON or API details unless you want deeper diagnosis.",
            "除非你想深入诊断，否则现在不需要去看 JSON 或接口明细。"
          )
        : status === "passed"
          ? pick(
              "If this run is useful, you can extract reusable cases from it later.",
              "如果这条运行有价值，后面可以把它沉淀成可复用 Case。"
            )
          : pick(
          "Use the report or technical view only when the human summary is not enough.",
          "只有当人话摘要不够时，再去看报告或技术视图。"
        );
  const primaryHeaderStatusLabel = currentDraft
    ? pick("Needs decision", "等待你决定")
    : canResume
      ? pick("Needs your help", "等待你处理")
      : statusLabel;
  const primaryHeaderStatusTone = currentDraft
    ? "border-sky-200 bg-sky-50 text-sky-700"
    : canResume
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : statusTone(status);
  const headerMetaLine = [
    pick(`Step #${currentStepNumber}`, `步骤 #${currentStepNumber}`),
    phaseBadgeLabel,
    showTechnicalDetails ? streamStatusLabel : null
  ]
    .filter(Boolean)
    .join(" · ");
  const headerSupportLine = currentDraft
    ? pick(
        "The run is waiting for you to approve, edit, or skip the next action.",
        "这条运行正在等你批准、编辑或跳过下一步动作。"
      )
    : canResume
      ? pick(
          "The agent stopped on purpose so it would not keep clicking randomly.",
          "代理是故意停下来的，目的是避免继续乱点。"
        )
      : localizedLiveMessage ??
        localizedObservationSummary ??
        pick(
          "Keep watching the live page below. Open technical details only when you need diagnosis.",
          "继续看下面的实时页面即可，只有需要排障时再展开技术细节。"
        );
  const liveViewEyebrow = isTerminalStatus
    ? pick("Recorded Evidence", "录制证据")
    : pick("Live View", "实时视图");
  const timelineTitle = showTechnicalDetails
    ? pick("Action Timeline", "动作时间线")
    : isTerminalStatus
      ? pick("Recorded Steps", "已记录步骤")
      : pick("Recent Steps", "最近步骤");
  const reviewModeHint = pick(
    "Review mode keeps the summary, diff, and replay health front and center.",
    "复盘模式会优先展示结论、对比和模板健康度。"
  );
  const technicalModeHint = pick(
    "Technical mode expands request traffic, repair candidates, and evidence panels.",
    "技术模式会展开流量、修复候选和证据面板。"
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-[28px] border border-slate-200 bg-white p-5">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-[0.35em] text-slate-400">
            {pick("Run Console", "运行控制台")}
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-slate-900">
            {run?.goal ?? pick("Live run detail", "实时运行详情")}
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-3 py-1 text-xs font-medium ${primaryHeaderStatusTone}`}
            >
              {primaryHeaderStatusLabel}
            </span>
            <span className="text-sm text-slate-500">{headerMetaLine}</span>
          </div>
          <p className="mt-3 truncate text-sm text-slate-700">
            {pick(`Current page: ${currentPageTitle}`, `当前页面：${currentPageTitle}`)}
          </p>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">{headerSupportLine}</p>
          {compareTo ? (
            <p className="mt-2 max-w-3xl text-sm leading-6 text-sky-700">{comparisonSupportLine}</p>
          ) : null}
          {run?.replayCaseTitle ? (
            <p className="mt-2 text-sm text-emerald-700">
              {pick(
                `Template-first execution: ${run.replayCaseTitle}`,
                `模板优先执行：${run.replayCaseTitle}`
              )}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canResume ? (
            <button
              type="button"
              onClick={() => controlMutation.mutate({ command: "resume" })}
              className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800"
            >
              {pick("Resume", "继续运行")}
            </button>
          ) : null}
          {status === "running" && !canResume ? (
            <button
              type="button"
              onClick={() => controlMutation.mutate({ command: "pause" })}
              className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700"
            >
              {pick("Pause", "暂停")}
            </button>
          ) : null}
          <div className="flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => setDetailMode("review")}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                !showTechnicalDetails
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600"
              }`}
            >
              {pick("Review Mode", "复盘模式")}
            </button>
            <button
              type="button"
              onClick={() => setDetailMode("technical")}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                showTechnicalDetails
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600"
              }`}
            >
              {pick("Technical Mode", "技术模式")}
            </button>
          </div>
          {run?.headed && status === "running" ? (
            <button
              type="button"
              onClick={() => focusMutation.mutate()}
              className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700"
            >
              {pick("Bring Browser Front", "前置浏览器")}
            </button>
          ) : null}
          {status !== "running" ? (
            <button
              type="button"
              onClick={() => rerunMutation.mutate()}
              disabled={rerunMutation.isPending}
              className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 disabled:opacity-50"
            >
              {rerunMutation.isPending
                ? pick("Starting rerun...", "正在启动重跑...")
                : pick("Rerun And Compare", "重跑并对比")}
            </button>
          ) : null}
          <Link
            to={compareReportHref}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              compareTo
                ? "border-sky-300 bg-sky-50 text-sky-700"
                : "border-slate-300 text-slate-700"
            }`}
          >
            {comparisonCtaLabel}
          </Link>
        </div>
      </div>

      {localizedError || localizedRunError || localizedLiveHaltReason ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{localizedError ?? localizedRunError ?? localizedLiveHaltReason}</div> : null}
      {statusNotice ? <div className={`rounded-[28px] border p-5 ${statusNotice.tone}`}><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">{statusNotice.eyebrow}</p><h3 className="mt-1 text-lg font-semibold text-slate-900">{statusNotice.title}</h3><p className="mt-2 text-sm leading-6 text-slate-700">{statusNotice.detail}</p></div><div className="flex flex-wrap gap-2"><span className={`rounded-full border px-3 py-1 text-xs font-medium ${statusNotice.badgeTone}`}>{pick(`Step #${live.stepIndex ?? latestStep?.index ?? 0}`, `步骤 #${live.stepIndex ?? latestStep?.index ?? 0}`)}</span><span className={`rounded-full border px-3 py-1 text-xs font-medium ${statusNotice.badgeTone}`}>{pick(`Phase: ${phaseBadgeLabel}`, `阶段：${phaseBadgeLabel}`)}</span>{canResume ? <button type="button" onClick={() => controlMutation.mutate({ command: "resume" })} className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">{pick("Resume run", "继续运行")}</button> : null}</div></div></div> : null}
      {compareTo ? <div className={`rounded-[28px] border p-5 ${comparisonTone}`}><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0 flex-1"><p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">{pick("Baseline Comparison", "基线对比")}</p><h3 className="mt-1 text-lg font-semibold text-slate-900">{comparisonTitle}</h3><p className="mt-2 text-sm leading-6 text-slate-700">{comparisonDetail}</p><div className="mt-3 flex flex-wrap gap-2">{comparison ? <span className={`rounded-full border px-3 py-1 text-xs font-medium ${statusTone(comparison.baseRun.status)}`}>{pick(`Baseline ${runStatusBadgeLabel(comparison.baseRun.status)}`, `基线 ${runStatusBadgeLabel(comparison.baseRun.status)}`)}</span> : null}{comparison ? <span className={`rounded-full border px-3 py-1 text-xs font-medium ${statusTone(comparison.candidateRun.status)}`}>{pick(`Current ${runStatusBadgeLabel(comparison.candidateRun.status)}`, `当前 ${runStatusBadgeLabel(comparison.candidateRun.status)}`)}</span> : null}{comparison?.firstDivergenceStep ? <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">{pick(`First divergence at step ${comparison.firstDivergenceStep}`, `首个分叉在第 ${comparison.firstDivergenceStep} 步`)}</span> : null}{comparison ? <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">{comparison.stepDelta === 0 ? pick("Same step count", "步数一致") : comparison.stepDelta > 0 ? pick(`${comparison.stepDelta} more steps`, `多了 ${comparison.stepDelta} 步`) : pick(`${Math.abs(comparison.stepDelta)} fewer steps`, `少了 ${Math.abs(comparison.stepDelta)} 步`)}</span> : null}{comparisonQuery.isFetching ? <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">{pick("Updating live", "实时更新中")}</span> : null}</div></div><div className="flex flex-wrap gap-2"><Link to={compareReportHref} className="rounded-full border border-sky-300 bg-white px-3 py-1 text-xs font-medium text-sky-700">{comparisonCtaLabel}</Link></div></div>{comparison ? <><div className="mt-4 grid gap-3 lg:grid-cols-2"><div className="rounded-2xl border border-white/70 bg-white px-4 py-3"><p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">{pick("Baseline", "基线")}</p><p className="mt-2 text-sm font-semibold text-slate-900">{localizeEvidenceText(comparison.baseDiagnosis.headline, language)}</p><p className="mt-1 text-sm text-slate-600">{localizeEvidenceText(comparison.baseDiagnosis.rootCause, language)}</p></div><div className="rounded-2xl border border-white/70 bg-white px-4 py-3"><p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">{pick("Current Rerun", "当前重跑")}</p><p className="mt-2 text-sm font-semibold text-slate-900">{localizeEvidenceText(comparison.candidateDiagnosis.headline, language)}</p><p className="mt-1 text-sm text-slate-600">{localizeEvidenceText(comparison.candidateDiagnosis.rootCause, language)}</p></div></div>{comparisonSignals.length > 0 ? <div className="mt-4 flex flex-wrap gap-2">{comparisonSignals.map((signal) => <span key={signal} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-700">{comparisonSignalLabel(signal)}</span>)}</div> : null}</> : null}</div> : null}
      {!showTechnicalDetails ? <div className="grid gap-4 lg:grid-cols-3"><div className="rounded-[28px] border border-slate-200 bg-white p-5"><p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">{pick("What Is Happening", "现在发生了什么")}</p><h3 className="mt-2 text-lg font-semibold text-slate-900">{guidedStatusTitle}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{guidedStatusDetail}</p><div className="mt-4 flex flex-wrap gap-2"><span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-700">{pick(`Step #${currentStepNumber}`, `步骤 #${currentStepNumber}`)}</span><span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-700">{phaseBadgeLabel}</span></div></div><div className="rounded-[28px] border border-slate-200 bg-white p-5"><p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">{pick("Why It Looks This Way", "为什么会这样")}</p><h3 className="mt-2 text-lg font-semibold text-slate-900">{guidedDiagnosisTitle}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{apiSummary}</p>{friendlyFailureCategory ? <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{friendlyFailureCategory}</p> : null}</div><div className="rounded-[28px] border border-slate-200 bg-white p-5"><p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">{pick("What You Should Do", "你下一步该做什么")}</p><h3 className="mt-2 text-lg font-semibold text-slate-900">{guidedNextTitle}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{guidedNextDetail}</p><div className="mt-4 flex flex-wrap gap-2">{canResume ? <button type="button" onClick={() => controlMutation.mutate({ command: "resume" })} className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">{pick("Resume run", "继续运行")}</button> : null}<button type="button" onClick={() => setDetailMode("technical")} className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700">{pick("Open technical details", "展开技术细节")}</button></div></div></div> : null}
      {templateReplaySteps.length > 0 || run?.replayCaseTitle ? <div className="rounded-[28px] border border-emerald-200 bg-emerald-50/70 p-5"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-[11px] uppercase tracking-[0.3em] text-emerald-700">{pick("Template Replay", "\u6a21\u677f\u56de\u653e")}</p><h3 className="mt-1 text-lg font-semibold text-slate-900">{run?.replayCaseTitle ?? latestTemplateReplay?.templateTitle ?? pick("Case template execution", "\u6a21\u677f\u6267\u884c\u6982\u89c8")}</h3><p className="mt-2 text-sm text-slate-600">{pick("Track how many replayed steps matched the live page, and which ones drifted and need repair.", "\u76f4\u63a5\u67e5\u770b\u56de\u653e\u6b65\u9aa4\u91cc\u6709\u591a\u5c11\u547d\u4e2d\u4e86\u5f53\u524d\u9875\u9762\uff0c\u54ea\u4e9b\u6b65\u9aa4\u5df2\u504f\u822a\u9700\u8981\u4fee\u590d\u3002")}</p></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="rounded-2xl border border-emerald-200 bg-white px-4 py-3"><p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">{pick("Steps", "\u6b65\u9aa4")}</p><p className="mt-2 text-xl font-semibold text-slate-900">{templateReplaySteps.length}</p></div><div className="rounded-2xl border border-emerald-200 bg-white px-4 py-3"><p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">{pick("Matched", "\u547d\u4e2d")}</p><p className="mt-2 text-xl font-semibold text-emerald-700">{templateMatchedCount}</p></div><div className="rounded-2xl border border-emerald-200 bg-white px-4 py-3"><p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">{pick("Drifted", "\u504f\u822a")}</p><p className="mt-2 text-xl font-semibold text-amber-700">{templateDriftedCount}</p></div><div className="rounded-2xl border border-emerald-200 bg-white px-4 py-3"><p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">{pick("Hit Rate", "\u547d\u4e2d\u7387")}</p><p className="mt-2 text-xl font-semibold text-sky-700">{templateHitRate ?? 0}%</p></div></div></div></div> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_420px]">
        <section className="space-y-4">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
              <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">{liveViewEyebrow}</p>
                <h3 className="mt-1 text-xl font-semibold text-slate-900">{currentPageTitle}</h3>
                <p className="mt-1 break-all text-sm text-slate-500">{currentPageUrl}</p>
              </div>
              <button type="button" onClick={() => { if (!autoFollow && latestStep) setSelectedStepId(latestStep.id); setAutoFollow((value) => !value); }} className={`rounded-full border px-3 py-1 text-xs font-medium ${autoFollow ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700"}`}>{autoFollow ? pick("Auto-follow on", "\u81ea\u52a8\u8ddf\u968f\u4e2d") : pick("Resume live", "\u56de\u5230\u5b9e\u65f6")}</button>
            </div>
            <div className="mt-4 rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-2xl border border-slate-200 bg-white p-3"><p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">{pick("Step", "步骤")}</p><p className="mt-2 text-xl font-semibold text-slate-900">{currentStepNumber}</p></div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3"><p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">{pick("Phase", "阶段")}</p><p className="mt-2 text-xl font-semibold text-slate-900">{phaseBadgeLabel}</p></div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3"><p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">{pick("Signal", "信号")}</p><p className="mt-2 text-base font-semibold text-slate-900">{formatRelativeTime(live.lastEventAt, pick("No signal yet", "暂无信号"))}</p></div>
              </div>
              <LiveRunViewport runId={runId} enabled={status === "running"} fallbackScreenshot={currentScreenshot} currentStepNumber={currentStepNumber} phase={live.phase} autoFollow={autoFollow} pageTitle={currentPageTitle} pageUrl={currentPageUrl} runHeaded={run?.headed} />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-[28px] border border-slate-200 bg-white p-5">
                  <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">{pick("UI Verification", "UI 验证")}</p>
              <h3 className="mt-2 text-lg font-semibold text-slate-900">{formatLocalizedActionLabel(currentAction, language)}</h3>
              <p className="mt-2 text-sm text-slate-600">{localizedVerificationNote || pick("No UI verification note yet.", "\u8fd8\u6ca1\u6709 UI \u9a8c\u8bc1\u8bf4\u660e\u3002")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {currentExecutionDiagnostics?.failureCategory ? <span className={`rounded-full border px-3 py-1 text-[11px] font-medium ${diagnosticTone(currentExecutionDiagnostics.failureCategory)}`}>{currentExecutionDiagnostics.failureCategory}</span> : null}
                {currentExecutionDiagnostics?.resolutionMethod ? <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-700">{currentExecutionDiagnostics.resolutionMethod}</span> : null}
                {currentExecutionDiagnostics?.targetUsed ? <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-700">{currentExecutionDiagnostics.targetUsed}</span> : null}
                {currentTemplateReplay ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-700">{pick(`Template ${currentTemplateReplay.stepIndex}/${currentTemplateReplay.stepCount}`, `\u6a21\u677f ${currentTemplateReplay.stepIndex}/${currentTemplateReplay.stepCount}`)}</span> : null}
                {currentTemplateReplay ? <span className={`rounded-full border px-3 py-1 text-[11px] font-medium ${currentTemplateReplay.outcome === "matched" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : currentTemplateReplay.outcome === "recovered" ? "border-sky-200 bg-sky-50 text-sky-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{currentTemplateReplay.outcome}</span> : null}
                {currentTemplateRepairCandidate ? <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-medium text-amber-800">{pick(`Repair ${Math.round(currentTemplateRepairCandidate.confidence * 100)}%`, `\u4fee\u590d\u5019\u9009 ${Math.round(currentTemplateRepairCandidate.confidence * 100)}%`)}</span> : null}
              </div>
              {localizedFailureSuggestion ? <p className="mt-3 text-sm text-amber-800">{localizedFailureSuggestion}</p> : null}
              {!localizedFailureSuggestion && localizedReplayRepairSuggestion ? <p className="mt-3 text-sm text-amber-800">{localizedReplayRepairSuggestion}</p> : null}
              {currentTemplateRepairCandidate ? <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-900"><p className="font-semibold">{pick("Template repair candidate", "\u6a21\u677f\u4fee\u590d\u5019\u9009")}</p><p className="mt-1 break-all">{currentTemplateRepairCandidate.suggestedTarget ?? currentTemplateRepairCandidate.action.target ?? currentTemplateRepairCandidate.action.type}</p><p className="mt-1 text-xs text-amber-800">{localizedTemplateRepairReason}</p></div> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {(currentVerification?.checks ?? []).map((check) => <span key={check.expected} className={`rounded-full border px-3 py-1 text-[11px] font-medium ${check.found ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-700"}`}>{check.expected}</span>)}
              </div>
            </div>
            {showTechnicalDetails ? <div className="rounded-[28px] border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">{pick("API Verification", "API 验证")}</p>
                  <h3 className="mt-2 text-lg font-semibold text-slate-900">{pick("Step-linked requests", "\u6b65\u9aa4\u7ea7\u8bf7\u6c42")}</h3>
                </div>
                <span className={`rounded-full border px-3 py-1 text-xs font-medium ${apiTone(currentVerification?.api?.status)}`}>{currentVerification?.api?.status ?? "pending"}</span>
              </div>
              <p className="mt-3 text-sm text-slate-600">{localizedApiNote || pick("Traffic summary will appear after the step is persisted.", "\u6b65\u9aa4\u6c89\u6dc0\u540e\u4f1a\u663e\u793a\u6d41\u91cf\u6458\u8981\u3002")}</p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">{pick("Matched", "命中")}</p><p className="mt-2 text-xl font-semibold text-slate-900">{currentVerification?.api?.matchedRequestCount ?? 0}</p></div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">{pick("Failed", "失败")}</p><p className="mt-2 text-xl font-semibold text-slate-900">{currentVerification?.api?.failedRequestCount ?? 0}</p></div>
              </div>
            </div> : <div className="rounded-[28px] border border-slate-200 bg-white p-5"><p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">{pick("Human Diagnosis", "人话诊断")}</p><h3 className="mt-2 text-lg font-semibold text-slate-900">{guidedDiagnosisTitle}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{apiSummary}</p>{localizedFailureSuggestion ? <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{localizedFailureSuggestion}</p> : null}<div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">{pick("Action", "动作")}</p><p className="mt-2 text-sm font-semibold text-slate-900">{currentAction ? formatLocalizedActionLabel(currentAction, language) : pick("Waiting", "等待中")}</p></div><div className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">{pick("Next", "下一步")}</p><p className="mt-2 text-sm font-semibold text-slate-900">{guidedNextTitle}</p></div></div></div>}
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{timelineTitle}</h3>
                {!showTechnicalDetails && filteredSteps.length > timelineSteps.length ? <p className="mt-1 text-xs text-slate-500">{pick(`Showing the latest ${timelineSteps.length} steps first.`, `当前先显示最近 ${timelineSteps.length} 步。`)}</p> : null}
              </div>
              <span className="text-xs text-slate-500">{timelineSteps.length}</span>
            </div>
            <div className="mt-4 flex gap-2">
              {(["all", "failed", "blocked"] as const).map((value) => <button key={value} type="button" onClick={() => setStepFilter(value)} className={`rounded-full px-3 py-1 text-xs font-medium ${stepFilter === value ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700"}`}>{stepFilterLabel(value)}</button>)}
            </div>
            <input className="mt-3 w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none" placeholder={pick("Search action or selector...", "搜索动作或选择器...")} value={stepKeyword} onChange={(event) => startTransition(() => setStepKeyword(event.target.value))} />
            <div className="mt-4 max-h-[36vh] space-y-2 overflow-auto pr-1">
              {timelineSteps.map((step) => <button key={step.id} type="button" onClick={() => { setAutoFollow(false); setSelectedStepId(step.id); }} className={`w-full rounded-2xl border p-3 text-left ${selectedStep?.id === step.id ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-slate-50"}`}><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-900">#{step.index} · {localizeActionType(step.action.type, language)}</p><div className="flex flex-wrap items-center justify-end gap-2">{step.verificationResult.execution?.templateReplay ? <span className={`rounded-full border px-2 py-1 text-[11px] font-medium ${step.verificationResult.execution.templateReplay.outcome === "matched" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : step.verificationResult.execution.templateReplay.outcome === "recovered" ? "border-sky-200 bg-sky-50 text-sky-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>T {step.verificationResult.execution.templateReplay.stepIndex}/{step.verificationResult.execution.templateReplay.stepCount}</span> : null}{showTechnicalDetails && step.verificationResult.execution?.templateRepairCandidate ? <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800">{pick("patch", "\u5019\u9009\u4fee\u590d")}</span> : null}{showTechnicalDetails && step.verificationResult.execution?.failureCategory ? <span className={`rounded-full border px-2 py-1 text-[11px] font-medium ${diagnosticTone(step.verificationResult.execution.failureCategory)}`}>{step.verificationResult.execution.failureCategory}</span> : null}<span className={`rounded-full border px-2 py-1 text-[11px] font-medium ${apiTone(step.verificationResult.api?.status)}`}>{step.verificationResult.api?.status ?? "api"}</span></div></div><p className="mt-2 text-sm font-medium text-slate-900">{formatLocalizedActionLabel(step.action, language)}</p><p className="mt-1 truncate text-[11px] text-slate-500">{localizeEvidenceText(step.observationSummary, language)}</p></button>)}
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">{sidebarEyebrow}</p>
                <h3 className="mt-1 text-lg font-semibold text-slate-900">{sidebarTitle}</h3>
              </div>
              {!isTerminalStatus ? <div className="flex gap-2">
                {(["auto_batch", "stepwise_replan"] as const).map((mode) => <button key={mode} type="button" onClick={() => controlMutation.mutate({ command: "switch_mode", executionMode: mode })} className={`rounded-full border px-3 py-1 text-[11px] font-medium ${activeExecutionMode === mode ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700"}`}>{executionModeOptionLabel(mode)}</button>)}
              </div> : null}
            </div>
            <p className="mt-3 text-sm text-slate-600">{sidebarDescription}</p>
            {currentDraft ? <><div className="mt-4 space-y-3">
              <input className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700" disabled={!currentDraft} value={draftEdit?.target ?? ""} placeholder={pick("selector or URL", "选择器或 URL")} onChange={(event) => setDraftEdit((current) => ({ ...(current ?? { type: currentDraft?.action.type ?? "click" }), target: event.target.value || undefined }))} />
              <input className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700" disabled={!currentDraft} value={draftEdit?.note ?? ""} placeholder={pick("note", "备注")} onChange={(event) => setDraftEdit((current) => ({ ...(current ?? { type: currentDraft?.action.type ?? "click" }), note: event.target.value || undefined }))} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {(currentDraft?.expectedChecks ?? []).map((check) => <span key={check} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-700">{check}</span>)}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" disabled={!currentDraft || controlMutation.isPending} onClick={() => controlMutation.mutate({ command: "approve" })} className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{pick("Approve", "批准")}</button>
              <button type="button" disabled={!currentDraft || controlMutation.isPending || !draftEdit} onClick={() => draftEdit && controlMutation.mutate({ command: "edit_and_run", action: draftEdit })} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">{pick("Edit and run", "\u7f16\u8f91\u5e76\u6267\u884c")}</button>
              <button type="button" disabled={!currentDraft || controlMutation.isPending} onClick={() => controlMutation.mutate({ command: "skip" })} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">{pick("Skip", "跳过")}</button>
              <button type="button" disabled={!currentDraft || controlMutation.isPending} onClick={() => controlMutation.mutate({ command: "retry" })} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">{pick("Retry", "重试")}</button>
            </div></> : isTerminalStatus ? <><div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">{pick("This run is no longer waiting for planner updates. Use the report, diff, and case tools to finish the review.", "这条运行已经不再等待规划更新了。接下来更适合看报告、对比和 Case 工具。")}</div><div className="mt-4 flex flex-wrap gap-2"><Link to={compareReportHref} className="rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700">{comparisonCtaLabel}</Link><button type="button" onClick={() => setDetailMode("technical")} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700">{pick("Open technical mode", "打开技术模式")}</button></div></> : <><div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">{canResume ? pick("This run is intentionally stopped on the current page. Finish the browser step locally, then click resume.", "这条运行是主动停在当前页面的。请先在本地浏览器里完成当前步骤，再点击继续。") : pick("当前没有可执行草案，页面会随着下一条状态事件自动继续刷新。", "当前没有可执行草案，页面会随着下一条状态事件自动继续刷新。")}</div><div className="mt-4 grid grid-cols-2 gap-2">{canResume ? <button type="button" disabled={controlMutation.isPending} onClick={() => controlMutation.mutate({ command: "resume" })} className="col-span-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 disabled:opacity-50">{pick("Resume run", "继续运行")}</button> : <button type="button" disabled className="col-span-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-400">{pick("Waiting for next action", "等待下一步动作")}</button>}</div></>}
          </div>

          {showTechnicalDetails ? <div className="rounded-[28px] border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-slate-900">{pick("Step Traffic", "步骤流量")}</h3>
              <span className="text-xs text-slate-500">{trafficEntries.length}</span>
            </div>
            {trafficError ? <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{trafficError.message}</div> : null}
            {isTrafficFallback ? <p className="mt-3 text-sm text-slate-500">{pick("The current step has not produced step-linked traffic yet. Showing the latest run traffic first.", "\u5f53\u524d\u6b65\u9aa4\u8fd8\u6ca1\u6709\u4ea7\u751f step \u7ea7\u6d41\u91cf\uff0c\u5148\u5c55\u793a\u672c\u6b21\u8fd0\u884c\u7684\u6700\u65b0\u5b9e\u65f6\u6d41\u91cf\u3002")}</p> : null}
            <div className="mt-4 max-h-[32vh] space-y-2 overflow-auto pr-1">
              {trafficEntries.map((entry: NetworkEvidenceEntry) => <div key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><div className="flex flex-wrap items-center gap-2 text-xs"><span className="rounded-full bg-slate-900 px-2 py-1 font-medium text-white">{entry.method}</span><span className={`rounded-full px-2 py-1 font-medium ${entry.phase === "failed" || entry.ok === false ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>{entry.phase === "failed" ? "failed" : entry.status ?? "response"}</span><span className="text-slate-500">{formatDateTime(entry.ts)}</span></div><p className="mt-2 break-all text-sm text-slate-700">{entry.pathname ?? entry.url}</p>{entry.bodyPreview ? <pre className="mt-2 max-h-24 overflow-auto rounded-xl bg-slate-950 p-3 text-[11px] text-slate-100">{entry.bodyPreview}</pre> : null}</div>)}
              {trafficEntries.length === 0 && (stepTrafficQuery.isLoading || runTrafficQuery.isLoading) ? <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">{pick("Loading traffic...", "正在加载流量...")}</div> : null}
              {trafficEntries.length === 0 && !stepTrafficQuery.isLoading && !runTrafficQuery.isLoading ? <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">{pick("No step-linked traffic yet.", "\u8fd8\u6ca1\u6709\u6b65\u9aa4\u7ea7\u6d41\u91cf\u3002")}</div> : null}
            </div>
          </div> : null}

          {showTechnicalDetails ? <div className="rounded-[28px] border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-slate-900">{pick("Template Repair Candidates", "\u6a21\u677f\u4fee\u590d\u5019\u9009")}</h3>
              <span className="text-xs text-slate-500">{templateRepairCandidates.length}</span>
            </div>
            <p className="mt-3 text-sm text-slate-500">{pick("Drifted replay steps automatically generate a suggested patch target and checks here.", "\u6a21\u677f\u56de\u653e\u6b65\u9aa4\u4e00\u65e6\u504f\u822a\uff0c\u8fd9\u91cc\u4f1a\u81ea\u52a8\u751f\u6210\u4e00\u4efd\u5019\u9009\u4fee\u590d target \u548c\u6821\u9a8c\u5efa\u8bae\u3002")}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" disabled={!repairDraftCaseId || templateRepairCandidates.length === 0 || previewRepairDraftMutation.isPending} onClick={() => repairDraftCaseId && previewRepairDraftMutation.mutate(repairDraftCaseId)} className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 disabled:opacity-50">{previewRepairDraftMutation.isPending ? pick("Generating...", "\u751f\u6210\u4e2d...") : pick("Generate patch draft", "\u751f\u6210\u4fee\u590d\u8349\u6848")}</button>
              <button type="button" disabled={!repairDraftCaseId || !repairDraftPreview || applyRepairDraftMutation.isPending} onClick={() => repairDraftCaseId && applyRepairDraftMutation.mutate({ caseId: repairDraftCaseId })} className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 disabled:opacity-50">{applyRepairDraftMutation.isPending ? pick("Applying...", "\u5e94\u7528\u4e2d...") : pick("Apply draft to template", "\u5e94\u7528\u5230\u6a21\u677f")}</button>
              <button type="button" disabled={!repairDraftCaseId || !repairDraftPreview || status === "running" || applyRepairDraftMutation.isPending} onClick={() => repairDraftCaseId && applyRepairDraftMutation.mutate({ caseId: repairDraftCaseId, replay: true })} className="rounded-full border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700 disabled:opacity-50">{applyRepairDraftMutation.isPending ? pick("Replaying...", "\u56de\u653e\u4e2d...") : pick("Apply and replay validate", "\u5e94\u7528\u5e76\u56de\u653e\u9a8c\u8bc1")}</button>
            </div>
            {repairDraftPreview ? <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-[11px] uppercase tracking-[0.3em] text-emerald-700">{pick("Patch Draft", "\u4fee\u590d\u8349\u6848")}</p><h4 className="mt-1 text-sm font-semibold text-slate-900">{repairDraftPreview.caseTitle}</h4></div><span className="rounded-full border border-emerald-300 bg-white px-3 py-1 text-[11px] font-medium text-emerald-700">{repairDraftPreview.changeCount} {pick("changes", "\u5904\u6539\u52a8")}</span></div><div className="mt-3 space-y-2">{repairDraftPreview.changes.map((change) => <div key={`${change.sourceStepId}-${change.templateStepIndex}`} className="rounded-2xl border border-emerald-200 bg-white p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-900">{pick(`Template step ${change.templateStepIndex}`, `\u6a21\u677f\u6b65\u9aa4 ${change.templateStepIndex}`)}</p><p className="mt-1 text-xs text-slate-500">{change.reason ?? change.repairHint ?? pick("Auto-generated from the latest drifted replay step.", "\u57fa\u4e8e\u6700\u65b0\u4e00\u6b21\u504f\u822a\u6b65\u9aa4\u81ea\u52a8\u751f\u6210\u3002")}</p></div><span className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-700">{Math.round(change.confidence * 100)}%</span></div><div className="mt-3 grid gap-2 text-xs text-slate-600"><div><p className="font-medium text-slate-900">{pick("Before", "\u4fee\u590d\u524d")}</p><p className="mt-1 break-all">{change.previousAction.target ?? change.previousAction.type}</p></div><div><p className="font-medium text-slate-900">{pick("After", "\u4fee\u590d\u540e")}</p><p className="mt-1 break-all">{change.nextAction.target ?? change.nextAction.type}</p></div></div><div className="mt-3 flex flex-wrap gap-2">{change.nextExpectedChecks.slice(0, 3).map((check) => <span key={check} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-700">{check}</span>)}</div></div>)}</div></div> : null}
            <div className="mt-4 space-y-2">
              {templateRepairCandidates.map(({ step, candidate }) => <div key={`${step.id}-${candidate.templateStepIndex}`} className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{candidate.templateTitle}</p><p className="mt-1 text-xs text-slate-500">{pick(`Step ${candidate.templateStepIndex}/${candidate.templateStepCount} -> run #${step.index}`, `\u6a21\u677f\u6b65\u9aa4 ${candidate.templateStepIndex}/${candidate.templateStepCount} -> \u8fd0\u884c #${step.index}`)}</p></div><span className="rounded-full border border-amber-300 bg-white px-3 py-1 text-[11px] font-medium text-amber-800">{Math.round(candidate.confidence * 100)}%</span></div><p className="mt-3 break-all text-sm font-medium text-slate-900">{candidate.suggestedTarget ?? candidate.action.target ?? candidate.action.type}</p><p className="mt-1 text-xs text-slate-600">{candidate.reason ?? candidate.repairHint ?? pick("Use this candidate to refresh the stored template step.", "\u53ef\u4ee5\u7528\u8fd9\u4efd\u5019\u9009\u4fe1\u606f\u5237\u65b0\u5df2\u5b58\u7684\u6a21\u677f\u6b65\u9aa4\u3002")}</p><div className="mt-3 flex flex-wrap gap-2">{candidate.suggestedExpectedChecks.slice(0, 3).map((check) => <span key={check} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-700">{check}</span>)}</div></div>)}
              {templateRepairCandidates.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">{pick("No repair candidates yet. When a template step drifts, the platform will propose a patch here.", "\u8fd8\u6ca1\u6709\u4fee\u590d\u5019\u9009\uff0c\u4e00\u65e6\u6a21\u677f\u6b65\u9aa4\u504f\u822a\uff0c\u8fd9\u91cc\u5c31\u4f1a\u51fa\u73b0\u5019\u9009\u4fee\u590d\u5efa\u8bae\u3002")}</div> : null}
            </div>
          </div> : null}

          {showTechnicalDetails ? <div className="rounded-[28px] border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-slate-900">{pick("Case Assets", "Case 资产")}</h3>
              <button type="button" disabled={status !== "passed" || extractCasesMutation.isPending} onClick={() => extractCasesMutation.mutate()} className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 disabled:opacity-50">{extractCasesMutation.isPending ? pick("Extracting...", "提取中...") : pick("Extract cases", "提取 Case")}</button>
            </div>
            <div className="mt-4 space-y-2">
              {cases.map((item) => <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.title}</p><p className="truncate text-xs text-slate-500">{item.type} · {formatDateTime(item.updatedAt)}</p></div><button type="button" disabled={item.type === "api" || replayCaseMutation.isPending} onClick={() => replayCaseMutation.mutate(item.id)} className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 disabled:opacity-50">{pick("Replay", "回放")}</button></div></div>)}
              {cases.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">{pick("Passed runs can be extracted into reusable cases here.", "\u901a\u8fc7\u540e\u7684\u8fd0\u884c\u4f1a\u5728\u8fd9\u91cc\u6c89\u6dc0\u6210\u53ef\u590d\u7528 Case\u3002")}</div> : null}
            </div>
          </div> : <div className="rounded-[28px] border border-slate-200 bg-white p-5"><p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">{pick("Current View", "当前视图")}</p><h3 className="mt-1 text-lg font-semibold text-slate-900">{pick("Review mode is active.", "当前处于复盘模式。")}</h3><p className="mt-3 text-sm leading-6 text-slate-600">{reviewModeHint} {technicalModeHint}</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => setDetailMode("technical")} className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700">{pick("Switch to technical mode", "切换到技术模式")}</button></div></div>}
        </aside>
      </div>

      {showTechnicalDetails ? <RunEvidencePanel runId={runId} status={status} selectedStep={selectedStep} latestLLM={latestLLM} /> : null}
    </div>
  );
};


