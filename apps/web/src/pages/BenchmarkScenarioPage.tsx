import { startTransition, useMemo, useState } from "react";
import type { Action, BenchmarkScenarioSummary, CaseTemplate, Run } from "@qpilot/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useI18n } from "../i18n/I18nProvider";
import { api } from "../lib/api";
import {
  formatLocalizedActionLabel,
  localizeActionDescriptor,
  localizeComparisonChange,
  localizeEvidenceText
} from "../lib/evidence-i18n";

type PickFn = (english: string, chinese: string) => string;

type ComparisonSelection = {
  baseRunId: string;
  candidateRunId: string;
};

type HistoryFilter = "all" | "green" | "red" | "active";
type TrendWindow = 3 | 5 | "all";

type ScenarioTrendSummary = {
  headline: string;
  detail: string;
  toneClass: string;
  windowLabel: string;
  streakLabel: string;
};

const statusTone: Record<string, string> = {
  queued: "border-amber-200 bg-amber-50 text-amber-700",
  running: "border-sky-200 bg-sky-50 text-sky-700",
  passed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-rose-200 bg-rose-50 text-rose-700",
  stopped: "border-slate-300 bg-slate-100 text-slate-600"
};

const scenarioStatusTone = (scenario: BenchmarkScenarioSummary | null): string => {
  if (!scenario?.lastRunStatus) {
    return "border-slate-200 bg-slate-50 text-slate-600";
  }
  return statusTone[scenario.lastRunStatus] ?? "border-slate-200 bg-slate-50 text-slate-600";
};

const statusLabel = (status: string | undefined, pick: PickFn): string => {
  switch (status) {
    case "queued":
      return pick("Queued", "排队中");
    case "running":
      return pick("Running", "运行中");
    case "passed":
      return pick("Passed", "已通过");
    case "failed":
      return pick("Failed", "失败");
    case "stopped":
      return pick("Stopped", "已停止");
    default:
      return pick("Uncovered", "待覆盖");
  }
};

const comparisonSignalLabel = (signal: string, pick: PickFn): string => {
  switch (signal) {
    case "status":
      return pick("Status", "状态");
    case "step_count":
      return pick("Step Count", "步数");
    case "final_page":
      return pick("Final Page", "最终页面");
    case "failure_category":
      return pick("Failure Category", "失败类别");
    default:
      return signal;
  }
};

const formatPercent = (value: number): string => `${Math.round(value * 100)}%`;

const formatAvgSteps = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) {
    return "0.0";
  }
  return value.toFixed(1);
};

const parseTemplateSteps = (caseTemplate?: CaseTemplate | null) => {
  if (!caseTemplate?.caseJson) {
    return [] as Array<{ index: number; action: { type: string; target?: string; note?: string } }>;
  }

  try {
    const parsed = JSON.parse(caseTemplate.caseJson) as {
      steps?: Array<{ type?: string; target?: string; note?: string }>;
    };
    return (parsed.steps ?? []).reduce<
      Array<{ index: number; action: { type: string; target?: string; note?: string } }>
    >((steps, step, index) => {
      if (!step.type) {
        return steps;
      }
      steps.push({
        index: index + 1,
        action: {
          type: step.type,
          target: step.target,
          note: step.note
        }
      });
      return steps;
    }, []);
  } catch {
    return [];
  }
};

const sortRunsDescending = (runs: Run[]): Run[] =>
  [...runs].sort(
    (left, right) =>
      Date.parse(right.startedAt ?? right.createdAt) - Date.parse(left.startedAt ?? left.createdAt)
  );

const buildScenarioTrend = (
  runs: Run[],
  pick: PickFn,
  formatRelativeTime: (iso?: string | null, emptyText?: string) => string
): ScenarioTrendSummary => {
  const recentRuns = runs.slice(0, 5);
  if (recentRuns.length === 0) {
    return {
      headline: pick("No replay trend yet", "还没有趋势数据"),
      detail: pick(
        "Start the first replay to create a benchmark trail for this scenario.",
        "先跑出第一条回放记录，这里才会开始形成场景趋势。"
      ),
      toneClass: "border-slate-200 bg-slate-50 text-slate-700",
      windowLabel: pick("No replay window", "暂无回放窗口"),
      streakLabel: pick("Waiting for the first run", "等待首个回放")
    };
  }

  const latestRun = recentRuns[0]!;
  const greenCount = recentRuns.filter((run) => run.status === "passed").length;
  const latestIsGreen = latestRun.status === "passed";
  const latestIsFailure = latestRun.status === "failed" || latestRun.status === "stopped";
  const priorHadGreen = recentRuns.slice(1).some((run) => run.status === "passed");
  const priorHadFailure = recentRuns
    .slice(1)
    .some((run) => run.status === "failed" || run.status === "stopped");

  let streak = 0;
  for (const run of recentRuns) {
    if (run.status !== latestRun.status) {
      break;
    }
    streak += 1;
  }

  if (latestIsGreen && priorHadFailure) {
    return {
      headline: pick("Recovered after a recent failure", "最近一次失败后已经恢复"),
      detail: pick(
        `The newest replay turned green ${formatRelativeTime(
          latestRun.startedAt ?? latestRun.createdAt,
          ""
        )} and restored the scenario baseline.`,
        `最新一次回放在 ${formatRelativeTime(
          latestRun.startedAt ?? latestRun.createdAt,
          ""
        )} 转成绿色，说明这条场景已经恢复。`
      ),
      toneClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
      windowLabel: pick(`Last ${recentRuns.length} replays`, `最近 ${recentRuns.length} 次回放`),
      streakLabel: pick(`Passed streak ${streak}`, `连续通过 ${streak} 次`)
    };
  }

  if (latestIsGreen) {
    return {
      headline: pick("Stable green streak", "绿色基线正在稳定"),
      detail: pick(
        `${greenCount} of the last ${recentRuns.length} replays finished green.`,
        `最近 ${recentRuns.length} 次回放里，有 ${greenCount} 次是绿色。`
      ),
      toneClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
      windowLabel: pick(`Last ${recentRuns.length} replays`, `最近 ${recentRuns.length} 次回放`),
      streakLabel: pick(`Passed streak ${streak}`, `连续通过 ${streak} 次`)
    };
  }

  if (latestIsFailure && priorHadGreen) {
    return {
      headline: pick("Regression after the last green run", "最近一次绿色基线之后发生回归"),
      detail: pick(
        `The latest replay is red ${formatRelativeTime(
          latestRun.startedAt ?? latestRun.createdAt,
          ""
        )}, even though this scenario had a green baseline before.`,
        `最新一次回放在 ${formatRelativeTime(
          latestRun.startedAt ?? latestRun.createdAt,
          ""
        )} 变红了，而这条场景之前是有绿色基线的。`
      ),
      toneClass: "border-rose-200 bg-rose-50 text-rose-700",
      windowLabel: pick(`Last ${recentRuns.length} replays`, `最近 ${recentRuns.length} 次回放`),
      streakLabel: pick(
        `${statusLabel(latestRun.status, pick)} streak ${streak}`,
        `${statusLabel(latestRun.status, pick)} 连续 ${streak} 次`
      )
    };
  }

  if (latestIsFailure) {
    return {
      headline: pick("Still blocked on the latest replay", "最新一次回放仍然受阻"),
      detail: pick(
        `The last ${recentRuns.length} replays have not produced a fresh green baseline yet.`,
        `最近 ${recentRuns.length} 次回放还没有重新产出绿色基线。`
      ),
      toneClass: "border-rose-200 bg-rose-50 text-rose-700",
      windowLabel: pick(`Last ${recentRuns.length} replays`, `最近 ${recentRuns.length} 次回放`),
      streakLabel: pick(
        `${statusLabel(latestRun.status, pick)} streak ${streak}`,
        `${statusLabel(latestRun.status, pick)} 连续 ${streak} 次`
      )
    };
  }

  return {
    headline: pick("Replay still in progress", "回放仍在进行中"),
    detail: pick(
      `The latest replay is ${statusLabel(latestRun.status, pick).toLowerCase()} and the benchmark trend is still moving.`,
      `最新一次回放目前是${statusLabel(latestRun.status, pick)}，这条场景的趋势还在变化。`
    ),
    toneClass:
      latestRun.status === "queued"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-sky-200 bg-sky-50 text-sky-700",
    windowLabel: pick(`Last ${recentRuns.length} replays`, `最近 ${recentRuns.length} 次回放`),
    streakLabel: pick(
      `${statusLabel(latestRun.status, pick)} streak ${streak}`,
      `${statusLabel(latestRun.status, pick)} 连续 ${streak} 次`
    )
  };
};

export const BenchmarkScenarioPage = () => {
  const { caseId = "" } = useParams();
  const navigate = useNavigate();
  const { formatDateTime, formatRelativeTime, language, pick } = useI18n();
  const [selectedComparison, setSelectedComparison] = useState<ComparisonSelection | null>(null);
  const [trendWindow, setTrendWindow] = useState<TrendWindow>(5);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [historyPreviewRunId, setHistoryPreviewRunId] = useState<string | null>(null);
  const [historyPreviewExpandedRunId, setHistoryPreviewExpandedRunId] = useState<string | null>(null);

  const casesQuery = useQuery({
    queryKey: ["cases", "all", caseId],
    queryFn: () => api.listCases(),
    enabled: Boolean(caseId)
  });

  const caseTemplate = useMemo(
    () => (casesQuery.data ?? []).find((item) => item.id === caseId) ?? null,
    [caseId, casesQuery.data]
  );

  const projectId = caseTemplate?.projectId;

  const benchmarkQuery = useQuery({
    queryKey: ["benchmarks", projectId || "none", language, "scenario"],
    queryFn: () => api.getBenchmarkSummary(projectId, language),
    enabled: Boolean(projectId),
    refetchInterval: 15_000
  });

  const runsQuery = useQuery({
    queryKey: ["runs", projectId || "none", "scenario", caseId],
    queryFn: () => api.listRuns(projectId),
    enabled: Boolean(projectId),
    refetchInterval: 5_000
  });

  const replayMutation = useMutation({
    mutationFn: () =>
      api.replayCase(caseId, {
        language,
        headed: true,
        manualTakeover: true,
        saveSession: true
      }),
    onSuccess: (run) => {
      navigate(`/runs/${run.id}`);
    }
  });

  const scenario = useMemo(
    () => benchmarkQuery.data?.scenarios.find((item) => item.caseId === caseId) ?? null,
    [benchmarkQuery.data?.scenarios, caseId]
  );

  const scenarioRuns = useMemo(
    () => sortRunsDescending((runsQuery.data ?? []).filter((run) => run.replayCaseId === caseId)),
    [caseId, runsQuery.data]
  );

  const latestFailureRun = useMemo(
    () =>
      scenarioRuns.find((run) => run.id === scenario?.latestFailedRunId) ??
      scenarioRuns.find((run) => run.status === "failed" || run.status === "stopped") ??
      null,
    [scenario?.latestFailedRunId, scenarioRuns]
  );

  const latestPassedRun = useMemo(
    () =>
      scenarioRuns.find((run) => run.id === scenario?.latestPassedRunId) ??
      scenarioRuns.find((run) => run.status === "passed") ??
      null,
    [scenario?.latestPassedRunId, scenarioRuns]
  );

  const defaultComparison = useMemo<ComparisonSelection | null>(() => {
    if (!latestFailureRun || !latestPassedRun || latestFailureRun.id === latestPassedRun.id) {
      return null;
    }
    return {
      baseRunId: latestFailureRun.id,
      candidateRunId: latestPassedRun.id
    };
  }, [latestFailureRun, latestPassedRun]);

  const activeComparison = selectedComparison ?? defaultComparison;
  const activeComparisonBaseRun =
    scenarioRuns.find((run) => run.id === activeComparison?.baseRunId) ?? null;
  const activeComparisonCandidateRun =
    scenarioRuns.find((run) => run.id === activeComparison?.candidateRunId) ?? null;

  const comparisonQuery = useQuery({
    queryKey: [
      "run",
      "compare",
      "scenario",
      activeComparison?.baseRunId ?? "none",
      activeComparison?.candidateRunId ?? "none",
      language
    ],
    queryFn: () =>
      api.compareRuns(activeComparison!.baseRunId, activeComparison!.candidateRunId, language),
    enabled: Boolean(
      activeComparison &&
        activeComparison.baseRunId &&
        activeComparison.candidateRunId &&
        activeComparison.baseRunId !== activeComparison.candidateRunId
    ),
    staleTime: 10_000
  });

  const localizedComparison = useMemo(
    () =>
      comparisonQuery.data
        ? {
            ...comparisonQuery.data,
            headline: localizeEvidenceText(comparisonQuery.data.headline, language),
            summary: localizeEvidenceText(comparisonQuery.data.summary, language),
            baseDiagnosis: {
              ...comparisonQuery.data.baseDiagnosis,
              headline: localizeEvidenceText(comparisonQuery.data.baseDiagnosis.headline, language),
              rootCause: localizeEvidenceText(
                comparisonQuery.data.baseDiagnosis.rootCause,
                language
              )
            },
            candidateDiagnosis: {
              ...comparisonQuery.data.candidateDiagnosis,
              headline: localizeEvidenceText(
                comparisonQuery.data.candidateDiagnosis.headline,
                language
              ),
              rootCause: localizeEvidenceText(
                comparisonQuery.data.candidateDiagnosis.rootCause,
                language
              )
            },
            stepChanges: comparisonQuery.data.stepChanges.map((item) => ({
              ...item,
              summary: localizeEvidenceText(item.summary, language),
              baseAction: localizeActionDescriptor(item.baseAction, language),
              candidateAction: localizeActionDescriptor(item.candidateAction, language)
            }))
          }
        : null,
    [comparisonQuery.data, language]
  );

  const trendRuns = useMemo(
    () => (trendWindow === "all" ? scenarioRuns : scenarioRuns.slice(0, trendWindow)),
    [scenarioRuns, trendWindow]
  );
  const trendSummary = buildScenarioTrend(trendRuns, pick, formatRelativeTime);
  const templateSteps = useMemo(() => parseTemplateSteps(caseTemplate), [caseTemplate]);
  const trendWindowPassedCount = useMemo(
    () => trendRuns.filter((run) => run.status === "passed").length,
    [trendRuns]
  );
  const trendWindowOptions = useMemo(
    () =>
      [
        { value: 3 as const, label: pick("Last 3", "最近 3 次") },
        { value: 5 as const, label: pick("Last 5", "最近 5 次") },
        { value: "all" as const, label: pick("All Runs", "全部回放") }
      ] satisfies ReadonlyArray<{ value: TrendWindow; label: string }>,
    [pick]
  );
  const historyFilterOptions = useMemo(
    () =>
      [
        {
          value: "all" as const,
          label: pick("All Runs", "全部回放"),
          count: scenarioRuns.length
        },
        {
          value: "green" as const,
          label: pick("Green", "绿色"),
          count: scenarioRuns.filter((run) => run.status === "passed").length
        },
        {
          value: "red" as const,
          label: pick("Red", "红色"),
          count: scenarioRuns.filter((run) => run.status === "failed" || run.status === "stopped")
            .length
        },
        {
          value: "active" as const,
          label: pick("Active", "进行中"),
          count: scenarioRuns.filter((run) => run.status === "queued" || run.status === "running")
            .length
        }
      ] satisfies ReadonlyArray<{ value: HistoryFilter; label: string; count: number }>,
    [pick, scenarioRuns]
  );
  const comparisonRunOptions = useMemo(
    () =>
      scenarioRuns.map((run) => ({
        id: run.id,
        label: pick(
          `${run.id.slice(0, 8)} · ${statusLabel(run.status, pick)} · ${formatRelativeTime(
            run.startedAt ?? run.createdAt,
            "unknown time"
          )}`,
          `${run.id.slice(0, 8)} · ${statusLabel(run.status, pick)} · ${formatRelativeTime(
            run.startedAt ?? run.createdAt,
            "未知时间"
          )}`
        )
      })),
    [formatRelativeTime, pick, scenarioRuns]
  );
  const filteredScenarioRuns = useMemo(() => {
    switch (historyFilter) {
      case "green":
        return scenarioRuns.filter((run) => run.status === "passed");
      case "red":
        return scenarioRuns.filter((run) => run.status === "failed" || run.status === "stopped");
      case "active":
        return scenarioRuns.filter((run) => run.status === "queued" || run.status === "running");
      default:
        return scenarioRuns;
    }
  }, [historyFilter, scenarioRuns]);

  const replayError =
    replayMutation.error instanceof Error ? replayMutation.error.message.trim() : "";
  const comparisonError =
    comparisonQuery.error instanceof Error ? comparisonQuery.error.message.trim() : "";

  const activateComparison = (
    baseRunId: string,
    candidateRunId: string,
    anchorRunId?: string | null
  ) => {
    if (!baseRunId || !candidateRunId || baseRunId === candidateRunId) {
      return;
    }

    startTransition(() => {
      setSelectedComparison({
        baseRunId,
        candidateRunId
      });
      setHistoryPreviewRunId(anchorRunId ?? null);
      setHistoryPreviewExpandedRunId(null);
    });
  };

  const pickAlternativeRunId = (primaryRunId: string, preferredRunId?: string): string | null => {
    if (preferredRunId && preferredRunId !== primaryRunId) {
      return preferredRunId;
    }
    return scenarioRuns.find((run) => run.id !== primaryRunId)?.id ?? null;
  };

  const updateComparisonSelection = (nextSelection: Partial<ComparisonSelection>) => {
    const fallbackBaseRunId = scenarioRuns[0]?.id ?? "";
    const fallbackCandidateRunId =
      scenarioRuns.find((run) => run.id !== fallbackBaseRunId)?.id ?? "";
    const currentSelection = activeComparison ?? {
      baseRunId: fallbackBaseRunId,
      candidateRunId: fallbackCandidateRunId
    };

    let baseRunId = nextSelection.baseRunId ?? currentSelection.baseRunId;
    let candidateRunId = nextSelection.candidateRunId ?? currentSelection.candidateRunId;

    if (baseRunId === candidateRunId) {
      if (nextSelection.baseRunId) {
        candidateRunId =
          pickAlternativeRunId(baseRunId, currentSelection.baseRunId === baseRunId ? currentSelection.candidateRunId : currentSelection.baseRunId) ??
          "";
      } else if (nextSelection.candidateRunId) {
        baseRunId =
          pickAlternativeRunId(candidateRunId, currentSelection.candidateRunId === candidateRunId ? currentSelection.baseRunId : currentSelection.candidateRunId) ??
          "";
      }
    }

    if (!baseRunId || !candidateRunId || baseRunId === candidateRunId) {
      return;
    }

    activateComparison(baseRunId, candidateRunId);
  };

  const swapComparisonSelection = () => {
    if (!activeComparisonBaseRun || !activeComparisonCandidateRun) {
      return;
    }

    activateComparison(activeComparisonCandidateRun.id, activeComparisonBaseRun.id);
  };

  const updateTrendWindow = (nextWindow: TrendWindow) => {
    startTransition(() => {
      setTrendWindow(nextWindow);
    });
  };

  const updateHistoryFilter = (nextFilter: HistoryFilter) => {
    startTransition(() => {
      setHistoryFilter(nextFilter);
    });
  };

  if (casesQuery.isLoading) {
    return <div className="text-sm text-slate-500">{pick("Loading scenario...", "正在加载场景...")}</div>;
  }

  if (!caseTemplate) {
    return (
      <div className="space-y-4">
        <Link to="/runs" className="text-sm font-medium text-sky-700 hover:underline">
          {pick("Back to runs", "返回运行页")}
        </Link>
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">
          {pick(
            "This benchmark scenario could not be found. Go back to the runs page and choose another one.",
            "没有找到这个 benchmark 场景。可以先回到运行页，再从别的场景卡进入。"
          )}
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/runs" className="text-sm font-medium text-sky-700 hover:underline">
          {pick("Back to runs", "返回运行页")}
        </Link>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => replayMutation.mutate()}
            disabled={replayMutation.isPending}
            className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {replayMutation.isPending
              ? pick("Starting replay...", "正在启动回放...")
              : pick("Replay now", "立即回放")}
          </button>
          {scenario?.lastRunId ? (
            <Link
              to={`/reports/${scenario.lastRunId}`}
              className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700"
            >
              {pick("Open latest report", "打开最近报告")}
            </Link>
          ) : null}
          {latestFailureRun ? (
            <Link
              to={`/reports/${latestFailureRun.id}`}
              className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700"
            >
              {pick("Open latest failure", "打开最近失败")}
            </Link>
          ) : null}
          {latestFailureRun && latestPassedRun && latestFailureRun.id !== latestPassedRun.id ? (
            <Link
              to={`/reports/${latestPassedRun.id}?compareTo=${latestFailureRun.id}`}
              className="rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800"
            >
              {pick("Compare latest failure vs green", "对比最近失败和绿色基线")}
            </Link>
          ) : null}
        </div>
      </div>

      {replayError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {replayError}
        </div>
      ) : null}

      <div className="rounded-[28px] border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-[0.32em] text-slate-400">
              {pick("Benchmark Scenario", "Benchmark 场景")}
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">{caseTemplate.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {caseTemplate.summary ??
                pick(
                  "This scenario has a reusable template but no human summary yet.",
                  "这个场景已经有可复用模板，但还没有额外的人话摘要。"
                )}
            </p>
            <div className="mt-4 space-y-2 text-sm text-slate-600">
              <p>
                <span className="font-medium text-slate-900">{pick("Goal", "目标")}:</span>{" "}
                {caseTemplate.goal}
              </p>
              <p>
                <span className="font-medium text-slate-900">{pick("Entry URL", "入口 URL")}:</span>{" "}
                {caseTemplate.entryUrl}
              </p>
            </div>
          </div>
          <span
            className={`rounded-full border px-3 py-1 text-xs font-medium ${scenarioStatusTone(
              scenario
            )}`}
          >
            {statusLabel(scenario?.lastRunStatus, pick)}
          </span>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
              {pick("Runs", "运行数")}
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{scenario?.runCount ?? 0}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
              {pick("Pass Rate", "通过率")}
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {formatPercent(scenario?.passRate ?? 0)}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
              {pick("Avg Steps", "平均步数")}
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {formatAvgSteps(scenario?.avgSteps ?? 0)}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
              {pick("Last Updated", "最近更新")}
            </p>
            <p className="mt-2 text-sm font-semibold text-slate-900">
              {formatRelativeTime(scenario?.lastRunAt, pick("No runs yet", "还没有回放"))}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_420px]">
        <div className="space-y-4">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">
                  {pick("Scenario State", "场景状态")}
                </p>
                <h3 className="mt-2 text-lg font-semibold text-slate-900">
                  {pick("What changed most recently", "最近一次发生了什么")}
                </h3>
              </div>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {scenario?.lastDiagnosisHeadline ??
                pick(
                  "This scenario still needs its first replay before we can summarize it.",
                  "这个场景还需要先跑出第一条回放，我们才能给出它的状态摘要。"
                )}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {scenario?.topFailureCategory ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-medium text-amber-800">
                  {scenario.topFailureCategory}
                </span>
              ) : null}
              {latestPassedRun ? (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-700">
                  {pick(
                    `Latest green ${latestPassedRun.id.slice(0, 8)}`,
                    `最近绿色 ${latestPassedRun.id.slice(0, 8)}`
                  )}
                </span>
              ) : null}
              {latestFailureRun ? (
                <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-medium text-rose-700">
                  {pick(
                    `Latest failure ${latestFailureRun.id.slice(0, 8)}`,
                    `最近失败 ${latestFailureRun.id.slice(0, 8)}`
                  )}
                </span>
              ) : null}
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">
                  {pick("Recent Trend", "近期趋势")}
                </p>
                <h3 className="mt-2 text-lg font-semibold text-slate-900">{trendSummary.headline}</h3>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {trendWindowOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => updateTrendWindow(option.value)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                      trendWindow === option.value
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-slate-50 text-slate-700"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${trendSummary.toneClass}`}
                >
                  {trendSummary.windowLabel}
                </span>
              </div>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">{trendSummary.detail}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                {trendSummary.streakLabel}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                {pick(
                  `${trendWindowPassedCount}/${trendRuns.length || 0} green in window`,
                  `窗口内 ${trendWindowPassedCount}/${trendRuns.length || 0} 次绿色`
                )}
              </span>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              {trendRuns.length > 0 ? (
                trendRuns.map((run) => (
                  <Link
                    key={run.id}
                    to={`/runs/${run.id}`}
                    className={`rounded-2xl border px-3 py-3 text-left transition hover:-translate-y-0.5 ${
                      statusTone[run.status] ?? "border-slate-200 bg-slate-50 text-slate-700"
                    }`}
                  >
                    <p className="text-[11px] uppercase tracking-[0.28em] opacity-70">
                      {statusLabel(run.status, pick)}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-current">
                      {run.id.slice(0, 8)}
                    </p>
                    <p className="mt-1 text-xs opacity-80">
                      {formatRelativeTime(run.startedAt ?? run.createdAt, pick("just now", "刚刚"))}
                    </p>
                  </Link>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 sm:col-span-2 xl:col-span-5">
                  {pick(
                    "Replay history will start forming a trend as soon as the first run lands here.",
                    "第一条回放落进来之后，这里就会开始形成趋势。"
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">
                  {pick("Replay History", "回放历史")}
                </p>
                <h3 className="mt-2 text-lg font-semibold text-slate-900">
                  {pick("Recent replay runs for this scenario", "这个场景最近的回放记录")}
                </h3>
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                {scenarioRuns.length}
              </span>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {historyFilterOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => updateHistoryFilter(option.value)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    historyFilter === option.value
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-slate-50 text-slate-700"
                  }`}
                >
                  {pick(
                    `${option.label} (${option.count})`,
                    `${option.label}（${option.count}）`
                  )}
                </button>
              ))}
            </div>

            <div className="mt-4 space-y-3">
              {filteredScenarioRuns.length > 0 ? (
                filteredScenarioRuns.map((run) => {
                  const quickCompareAction =
                    run.status === "passed"
                      ? latestFailureRun && latestFailureRun.id !== run.id
                        ? {
                            label: pick("Compare to latest failure", "对比最近失败"),
                            baseRunId: latestFailureRun.id,
                            candidateRunId: run.id
                          }
                        : null
                      : latestPassedRun && latestPassedRun.id !== run.id
                        ? {
                            label: pick("Compare to latest green", "对比最近绿色"),
                            baseRunId: run.id,
                            candidateRunId: latestPassedRun.id
                          }
                        : null;

                  const isComparisonFocused =
                    run.id === activeComparisonBaseRun?.id || run.id === activeComparisonCandidateRun?.id;
                  const isQuickCompareSelected = Boolean(
                    quickCompareAction &&
                      activeComparison?.baseRunId === quickCompareAction.baseRunId &&
                      activeComparison?.candidateRunId === quickCompareAction.candidateRunId
                  );
                  const isHistoryPreviewOpen = historyPreviewRunId === run.id && isQuickCompareSelected;
                  const isPreviewExpanded = historyPreviewExpandedRunId === run.id;
                  const previewStepChanges =
                    isQuickCompareSelected && localizedComparison
                      ? isPreviewExpanded
                        ? localizedComparison.stepChanges
                        : localizedComparison.stepChanges.slice(0, 2)
                      : [];

                  return (
                    <div
                      key={run.id}
                      className={`rounded-2xl border px-4 py-3 ${
                        isComparisonFocused
                          ? "border-sky-200 bg-sky-50/60"
                          : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-semibold text-slate-900">{run.goal}</p>
                            <span
                              className={`rounded-full border px-3 py-1 text-[11px] font-medium ${
                                statusTone[run.status] ?? "border-slate-300 bg-slate-100 text-slate-600"
                              }`}
                            >
                              {statusLabel(run.status, pick)}
                            </span>
                            {isComparisonFocused ? (
                              <span className="rounded-full border border-sky-200 bg-white px-3 py-1 text-[11px] font-medium text-sky-700">
                                {run.id === activeComparisonBaseRun?.id
                                  ? pick("Current baseline", "当前基线")
                                  : pick("Current candidate", "当前候选")}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 truncate text-xs text-slate-500">
                            {run.currentPageTitle ?? run.currentPageUrl ?? run.targetUrl}
                          </p>
                          <p className="mt-2 text-xs text-slate-600">
                            {pick(
                              `${run.stepCount ?? 0} steps · ${formatDateTime(run.startedAt ?? run.createdAt)}`,
                              `${run.stepCount ?? 0} 步 · ${formatDateTime(run.startedAt ?? run.createdAt)}`
                            )}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {quickCompareAction ? (
                            <button
                              type="button"
                              onClick={() => {
                                if (isHistoryPreviewOpen) {
                                  startTransition(() => {
                                    setHistoryPreviewRunId(null);
                                    setHistoryPreviewExpandedRunId(null);
                                  });
                                  return;
                                }

                                activateComparison(
                                  quickCompareAction.baseRunId,
                                  quickCompareAction.candidateRunId,
                                  run.id
                                );
                              }}
                              className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800"
                            >
                              {isHistoryPreviewOpen
                                ? pick("Hide diff preview", "收起差异预览")
                                : quickCompareAction.label}
                            </button>
                          ) : null}
                          <Link
                            to={`/runs/${run.id}`}
                            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700"
                          >
                            {pick("Open live", "打开详情")}
                          </Link>
                          <Link
                            to={`/reports/${run.id}`}
                            className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700"
                          >
                            {pick("Open report", "打开报告")}
                          </Link>
                        </div>
                      </div>

                      {historyPreviewRunId === run.id ? (
                        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                                {pick("Inline Diff Preview", "内联差异预览")}
                              </p>
                              <h4 className="mt-1 text-sm font-semibold text-slate-900">
                                {pick(
                                  "Use this preview before opening the full report",
                                  "先看这个预览，再决定要不要打开完整报告"
                                )}
                              </h4>
                            </div>
                            {activeComparisonBaseRun && activeComparisonCandidateRun ? (
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-700">
                                {pick(
                                  `${activeComparisonBaseRun.id.slice(0, 8)} -> ${activeComparisonCandidateRun.id.slice(0, 8)}`,
                                  `${activeComparisonBaseRun.id.slice(0, 8)} -> ${activeComparisonCandidateRun.id.slice(0, 8)}`
                                )}
                              </span>
                            ) : null}
                          </div>

                          {comparisonQuery.isLoading || comparisonQuery.isFetching ? (
                            <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                              {pick("Loading this comparison preview...", "正在加载这条对比预览...")}
                            </div>
                          ) : null}

                          {comparisonError ? (
                            <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                              {comparisonError}
                            </div>
                          ) : null}

                          {isQuickCompareSelected && localizedComparison ? (
                            <div className="mt-3 space-y-3">
                              <p className="text-sm leading-6 text-slate-600">
                                {localizedComparison.summary}
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {localizedComparison.firstDivergenceStep ? (
                                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-700">
                                    {pick(
                                      `First divergence at step ${localizedComparison.firstDivergenceStep}`,
                                      `首次分叉在第 ${localizedComparison.firstDivergenceStep} 步`
                                    )}
                                  </span>
                                ) : null}
                                {localizedComparison.changedSignals.map((signal) => (
                                  <span
                                    key={`${run.id}-${signal}`}
                                    className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-medium text-sky-700"
                                  >
                                    {comparisonSignalLabel(signal, pick)}
                                  </span>
                                ))}
                              </div>
                              {localizedComparison.stepChanges.length > 2 ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    startTransition(() => {
                                      setHistoryPreviewExpandedRunId(isPreviewExpanded ? null : run.id);
                                    });
                                  }}
                                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700"
                                >
                                  {isPreviewExpanded
                                    ? pick("Show fewer changes", "收起更多变化")
                                    : pick(
                                        `Show all ${localizedComparison.stepChanges.length} changes`,
                                        `展开全部 ${localizedComparison.stepChanges.length} 处变化`
                                      )}
                                </button>
                              ) : null}
                              <div className="space-y-2">
                                {previewStepChanges.map((item) => (
                                  <div
                                    key={`${run.id}-${item.index}-${item.change}`}
                                    className="rounded-2xl border border-slate-200 bg-slate-50 p-3"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                      <p className="text-sm font-semibold text-slate-900">
                                        {pick(`Step ${item.index}`, `步骤 ${item.index}`)}
                                      </p>
                                      <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-700">
                                        {localizeComparisonChange(item.change, language)}
                                      </span>
                                    </div>
                                    <p className="mt-2 text-sm text-slate-700">{item.summary}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  {pick(
                    historyFilter === "all"
                      ? "No replay history yet. Start the first replay from the button above."
                      : "No runs match the current filter. Switch filters to inspect a different slice of history.",
                    historyFilter === "all"
                      ? "还没有回放历史，可以直接用上面的按钮启动第一次回放。"
                      : "当前筛选条件下没有匹配的运行，可以切换到其他筛选查看不同的历史切片。"
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">
                  {pick("Scenario Comparison", "场景对比")}
                </p>
                <h3 className="mt-2 text-lg font-semibold text-slate-900">
                  {localizedComparison?.headline ??
                    pick("Keep one green run close to every failure", "给每个失败都准备一个绿色对照")}
                </h3>
              </div>
              {activeComparisonBaseRun && activeComparisonCandidateRun ? (
                <Link
                  to={`/reports/${activeComparisonCandidateRun.id}?compareTo=${activeComparisonBaseRun.id}`}
                  className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700"
                >
                  {pick("Open full diff report", "打开完整对比报告")}
                </Link>
              ) : null}
            </div>

            {activeComparisonBaseRun && activeComparisonCandidateRun ? (
              <>
                {comparisonRunOptions.length >= 2 ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                    <label className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                        {pick("Comparison Baseline", "对比基线")}
                      </p>
                      <select
                        aria-label={pick("Comparison baseline", "对比基线")}
                        value={activeComparisonBaseRun.id}
                        onChange={(event) =>
                          updateComparisonSelection({ baseRunId: event.target.value })
                        }
                        className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-900"
                      >
                        {comparisonRunOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex items-center justify-center">
                      <button
                        type="button"
                        onClick={swapComparisonSelection}
                        className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-700"
                      >
                        {pick("Swap runs", "交换方向")}
                      </button>
                    </div>
                    <label className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                        {pick("Comparison Candidate", "对比候选")}
                      </p>
                      <select
                        aria-label={pick("Comparison candidate", "对比候选")}
                        value={activeComparisonCandidateRun.id}
                        onChange={(event) =>
                          updateComparisonSelection({ candidateRunId: event.target.value })
                        }
                        className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-900"
                      >
                        {comparisonRunOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : null}

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                      {pick("Baseline", "基线")}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">
                      {activeComparisonBaseRun.goal}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      {statusLabel(activeComparisonBaseRun.status, pick)} ·{" "}
                      {formatRelativeTime(
                        activeComparisonBaseRun.startedAt ?? activeComparisonBaseRun.createdAt,
                        pick("unknown time", "未知时间")
                      )}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                      {pick("Candidate", "候选")}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">
                      {activeComparisonCandidateRun.goal}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      {statusLabel(activeComparisonCandidateRun.status, pick)} ·{" "}
                      {formatRelativeTime(
                        activeComparisonCandidateRun.startedAt ??
                          activeComparisonCandidateRun.createdAt,
                        pick("unknown time", "未知时间")
                      )}
                    </p>
                  </div>
                </div>

                {selectedComparison && defaultComparison ? (
                  <button
                    type="button"
                    onClick={() => {
                      startTransition(() => {
                        setSelectedComparison(null);
                        setHistoryPreviewRunId(null);
                        setHistoryPreviewExpandedRunId(null);
                      });
                    }}
                    className="mt-3 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700"
                  >
                    {pick("Reset to latest failure vs green", "恢复成最近失败对比绿色基线")}
                  </button>
                ) : null}

                {comparisonQuery.isLoading || comparisonQuery.isFetching ? (
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                    {pick("Loading the latest scenario diff...", "正在加载最新场景 diff...")}
                  </div>
                ) : null}

                {comparisonError ? (
                  <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                    {comparisonError}
                  </div>
                ) : null}
                {localizedComparison ? (
                  <div className="mt-4 space-y-3">
                    <p className="text-sm leading-6 text-slate-600">{localizedComparison.summary}</p>

                    <div className="flex flex-wrap gap-2">
                      {localizedComparison.changedSignals.map((signal) => (
                        <span
                          key={signal}
                          className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-medium text-sky-700"
                        >
                          {comparisonSignalLabel(signal, pick)}
                        </span>
                      ))}
                      {localizedComparison.firstDivergenceStep ? (
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-700">
                          {pick(
                            `First divergence at step ${localizedComparison.firstDivergenceStep}`,
                            `首次分叉在第 ${localizedComparison.firstDivergenceStep} 步`
                          )}
                        </span>
                      ) : null}
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                          {pick("Baseline Diagnosis", "基线诊断")}
                        </p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">
                          {localizedComparison.baseDiagnosis.headline}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-slate-600">
                          {localizedComparison.baseDiagnosis.rootCause}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                          {pick("Candidate Diagnosis", "候选诊断")}
                        </p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">
                          {localizedComparison.candidateDiagnosis.headline}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-slate-600">
                          {localizedComparison.candidateDiagnosis.rootCause}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {localizedComparison.stepChanges.length > 0 ? (
                        localizedComparison.stepChanges.slice(0, 3).map((item) => (
                          <div
                            key={`${item.index}-${item.change}`}
                            className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <p className="text-sm font-semibold text-slate-900">
                                {pick(`Step ${item.index}`, `步骤 ${item.index}`)}
                              </p>
                              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-700">
                                {localizeComparisonChange(item.change, language)}
                              </span>
                            </div>
                            <p className="mt-2 text-sm text-slate-700">{item.summary}</p>
                            {(item.baseAction || item.candidateAction) ? (
                              <div className="mt-3 grid gap-3 md:grid-cols-2">
                                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                                  <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                                    {pick("Baseline Action", "基线动作")}
                                  </p>
                                  <p className="mt-2 break-all text-sm text-slate-700">
                                    {item.baseAction ?? pick("Missing", "不存在")}
                                  </p>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                                  <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                                    {pick("Candidate Action", "候选动作")}
                                  </p>
                                  <p className="mt-2 break-all text-sm text-slate-700">
                                    {item.candidateAction ?? pick("Missing", "不存在")}
                                  </p>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                          {pick(
                            "No step-level divergence was detected between these two runs.",
                            "这两次运行之间没有检测到步骤级差异。"
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                {pick(
                  "Once this scenario has both a green run and a non-green run, inline comparison will appear here.",
                  "当这条场景同时拥有绿色和非绿色运行后，这里就会出现内联对比。"
                )}
              </div>
            )}
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5">
            <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">
              {pick("Template Steps", "模板步骤")}
            </p>
            <h3 className="mt-2 text-lg font-semibold text-slate-900">
              {pick("Reusable flow snapshot", "可复用流程快照")}
            </h3>
            <div className="mt-4 space-y-2">
              {templateSteps.length > 0 ? (
                templateSteps.map((step) => (
                  <div
                    key={step.index}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                  >
                    <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                      {pick(`Step ${step.index}`, `步骤 ${step.index}`)}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">
                      {formatLocalizedActionLabel(
                        {
                          type: step.action.type as Action["type"],
                          target: step.action.target,
                          note: step.action.note
                        },
                        language
                      )}
                    </p>
                    <p className="mt-1 break-all text-xs text-slate-500">
                      {step.action.target ?? pick("No selector recorded", "没有记录 selector")}
                    </p>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  {pick(
                    "Template steps are not available for this scenario yet.",
                    "这个场景暂时还没有可展示的模板步骤。"
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5">
            <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">
              {pick("Operator Notes", "操作建议")}
            </p>
            <h3 className="mt-2 text-lg font-semibold text-slate-900">
              {pick("What this page is good for", "这个页面适合做什么")}
            </h3>
            <div className="mt-3 space-y-3 text-sm leading-6 text-slate-600">
              <p>
                {pick(
                  "Use this page when the list view is no longer enough and you need scenario-level history, not just run-level history.",
                  "当列表页已经不够用、你开始需要场景级历史而不只是单次 run 历史时，就可以用这个页面。"
                )}
              </p>
              <p>
                {pick(
                  "Start with the trend card to see whether the scenario is regressing or recovering, then use the inline comparison to decide whether you need a replay or a template repair.",
                  "先看趋势卡判断这条场景是在回归还是恢复，再用内联对比决定下一步是继续回放还是修模板。"
                )}
              </p>
              {scenario?.lastRunId ? (
                <p className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">
                  {localizeEvidenceText(scenario.lastDiagnosisHeadline, language)}
                </p>
              ) : null}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
};
