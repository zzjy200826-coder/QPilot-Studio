import { startTransition, useDeferredValue, useMemo, useState } from "react";
import type { BenchmarkScenarioSummary, Run } from "@qpilot/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useI18n } from "../i18n/I18nProvider";
import { api } from "../lib/api";

type PickFn = (english: string, chinese: string) => string;

const statusTone: Record<string, string> = {
  queued: "border-amber-200 bg-amber-50 text-amber-700",
  running: "border-sky-200 bg-sky-50 text-sky-700",
  passed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-rose-200 bg-rose-50 text-rose-700",
  stopped: "border-slate-300 bg-slate-100 text-slate-600"
};

const statusLabel = (status: string, pick: PickFn): string => {
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
      return status;
  }
};

const describeRun = (run: Run, pick: PickFn): string => {
  switch (run.status) {
    case "queued":
      return pick(
        "This run is waiting in the queue before execution starts.",
        "这条运行正在排队，等待开始执行。"
      );
    case "running":
      return typeof run.stepCount === "number"
        ? pick(
            `${run.stepCount} steps have been recorded so far.`,
            `当前已经记录了 ${run.stepCount} 步。`
          )
        : pick("The agent is still working on the current page.", "代理仍在处理当前页面。");
    case "passed":
      return pick(
        "This run finished successfully. You can open the report if needed.",
        "这条运行已经顺利完成，需要时可以打开报告。"
      );
    case "failed":
      return pick(
        "This run ended with a failure. Open the live page or report to inspect it.",
        "这条运行以失败结束，可以打开实时页或报告查看原因。"
      );
    case "stopped":
      return pick(
        "This run was stopped before completion.",
        "这条运行在完成前被停止了。"
      );
    default:
      return run.status;
  }
};

const describeCurrentPage = (run: Run, pick: PickFn): string =>
  pick(
    `Current page: ${run.currentPageTitle ?? run.currentPageUrl ?? run.targetUrl}`,
    `当前页面：${run.currentPageTitle ?? run.currentPageUrl ?? run.targetUrl}`
  );

const formatPercent = (value: number): string => `${Math.round(value * 100)}%`;

const formatAvgSteps = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) {
    return "0.0";
  }
  return value.toFixed(1);
};

const findComparableRun = (runs: Run[], index: number): Run | undefined => {
  const current = runs[index];
  if (!current) {
    return undefined;
  }
  return runs
    .slice(index + 1)
    .find(
      (candidate) =>
        candidate.projectId === current.projectId &&
        candidate.targetUrl === current.targetUrl &&
        candidate.id !== current.id
    );
};

const scenarioStatusTone = (scenario: BenchmarkScenarioSummary): string => {
  if (!scenario.lastRunStatus) {
    return "border-slate-200 bg-slate-50 text-slate-600";
  }
  if (scenario.lastRunStatus === "passed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (scenario.lastRunStatus === "running" || scenario.lastRunStatus === "queued") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  return "border-rose-200 bg-rose-50 text-rose-700";
};

const scenarioStatusLabel = (
  scenario: BenchmarkScenarioSummary,
  pick: PickFn
): string => {
  if (!scenario.lastRunStatus) {
    return pick("Uncovered", "待覆盖");
  }
  return statusLabel(scenario.lastRunStatus, pick);
};

const scenarioPriorityLabel = (
  scenario: BenchmarkScenarioSummary,
  pick: PickFn
): string => {
  if (scenario.runCount === 0) {
    return pick("Needs coverage", "需要补覆盖");
  }
  if (scenario.lastRunStatus === "failed" || scenario.lastRunStatus === "stopped") {
    return pick("Needs attention", "需要关注");
  }
  if (scenario.lastRunStatus === "queued" || scenario.lastRunStatus === "running") {
    return pick("Replay in progress", "回放进行中");
  }
  return pick("Healthy", "已稳定");
};

interface BenchmarkScenarioCardProps {
  scenario: BenchmarkScenarioSummary;
  pick: PickFn;
  formatRelativeTime: (iso?: string | null, emptyText?: string) => string;
  replayPending: boolean;
  onReplay: (caseId: string) => void;
}

const BenchmarkScenarioCard = ({
  scenario,
  pick,
  formatRelativeTime,
  replayPending,
  onReplay
}: BenchmarkScenarioCardProps) => {
  const lastFailureId =
    scenario.lastRunStatus === "failed" || scenario.lastRunStatus === "stopped"
      ? scenario.lastRunId
      : scenario.latestFailedRunId;
  const canCompareLastGreen =
    (scenario.lastRunStatus === "failed" || scenario.lastRunStatus === "stopped") &&
    Boolean(lastFailureId) &&
    Boolean(scenario.latestPassedRunId) &&
    lastFailureId !== scenario.latestPassedRunId;

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-slate-900">{scenario.title}</p>
            <span
              className={`rounded-full border px-3 py-1 text-[11px] font-medium ${scenarioStatusTone(
                scenario
              )}`}
            >
              {scenarioStatusLabel(scenario, pick)}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-slate-500">{scenario.entryUrl}</p>
          <p className="mt-2 text-xs leading-5 text-slate-600">
            {scenario.lastDiagnosisHeadline ??
              pick(
                "This scenario has not been replayed yet. Start a replay to create its first benchmark result.",
                "这个场景还没有回放结果，先跑一次才能建立 benchmark 基线。"
              )}
          </p>
        </div>
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-700">
          {scenarioPriorityLabel(scenario, pick)}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-600">
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
          {pick(`Runs ${scenario.runCount}`, `运行 ${scenario.runCount}`)}
        </span>
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
          {pick(`Pass ${formatPercent(scenario.passRate)}`, `通过 ${formatPercent(scenario.passRate)}`)}
        </span>
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
          {pick(
            `Avg ${formatAvgSteps(scenario.avgSteps)} steps`,
            `平均 ${formatAvgSteps(scenario.avgSteps)} 步`
          )}
        </span>
        {scenario.lastRunAt ? (
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
            {pick(
              `Updated ${formatRelativeTime(scenario.lastRunAt, "just now")}`,
              `更新于 ${formatRelativeTime(scenario.lastRunAt, "刚刚")}`
            )}
          </span>
        ) : null}
        {scenario.topFailureCategory ? (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-800">
            {scenario.topFailureCategory}
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onReplay(scenario.caseId)}
          disabled={replayPending}
          className="rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {replayPending
            ? pick("Starting replay...", "正在启动回放...")
            : pick("Replay now", "立即回放")}
        </button>
        <Link
          to={`/benchmarks/${scenario.caseId}`}
          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700"
        >
          {pick("Open scenario", "打开场景")}
        </Link>
        {scenario.lastRunId ? (
          <Link
            to={`/reports/${scenario.lastRunId}`}
            className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700"
          >
            {pick("Open latest report", "打开最近报告")}
          </Link>
        ) : null}
        {lastFailureId ? (
          <Link
            to={`/reports/${lastFailureId}`}
            className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700"
          >
            {pick("Open latest failure", "打开最近失败")}
          </Link>
        ) : null}
        {canCompareLastGreen && scenario.latestPassedRunId ? (
          <Link
            to={`/reports/${lastFailureId}?compareTo=${scenario.latestPassedRunId}`}
            className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800"
          >
            {pick("Compare last green", "对比最近绿色基线")}
          </Link>
        ) : null}
      </div>
    </div>
  );
};

export const RunsPage = () => {
  const { formatRelativeTime, language, pick } = useI18n();
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState<string>("");
  const [keyword, setKeyword] = useState("");
  const deferredKeyword = useDeferredValue(keyword);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects
  });

  const runsQuery = useQuery({
    queryKey: ["runs", projectId || "all"],
    queryFn: () => api.listRuns(projectId || undefined),
    refetchInterval: 2_000
  });

  const benchmarkQuery = useQuery({
    queryKey: ["benchmarks", projectId || "all", language],
    queryFn: () => api.getBenchmarkSummary(projectId || undefined, language),
    refetchInterval: 15_000
  });

  const replayScenarioMutation = useMutation({
    mutationFn: (caseId: string) =>
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

  const filteredRuns = useMemo(() => {
    const value = deferredKeyword.trim().toLowerCase();
    if (!value) {
      return runsQuery.data ?? [];
    }
    return (runsQuery.data ?? []).filter((item) => {
      return (
        item.id.toLowerCase().includes(value) ||
        item.goal.toLowerCase().includes(value) ||
        item.targetUrl.toLowerCase().includes(value) ||
        (item.currentPageUrl ?? "").toLowerCase().includes(value) ||
        (item.currentPageTitle ?? "").toLowerCase().includes(value)
      );
    });
  }, [deferredKeyword, runsQuery.data]);

  const benchmarkSections = useMemo(() => {
    const scenarios = benchmarkQuery.data?.scenarios ?? [];
    return {
      uncovered: scenarios.filter((scenario) => scenario.runCount === 0),
      attention: scenarios.filter(
        (scenario) =>
          scenario.runCount > 0 &&
          scenario.lastRunStatus !== "passed"
      ),
      healthy: scenarios.filter(
        (scenario) => scenario.runCount > 0 && scenario.lastRunStatus === "passed"
      )
    };
  }, [benchmarkQuery.data?.scenarios]);

  const benchmarkActionError =
    replayScenarioMutation.error instanceof Error
      ? replayScenarioMutation.error.message.trim()
      : "";

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-44 flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              {pick("Project Filter", "项目筛选")}
            </label>
            <select
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">{pick("All projects", "全部项目")}</option>
              {projectsQuery.data?.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-56 flex-[1.3]">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              {pick("Search Runs", "搜索运行")}
            </label>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={pick("Run ID / Goal / Page", "运行 ID / 目标 / 页面")}
              value={keyword}
              onChange={(event) =>
                startTransition(() => {
                  setKeyword(event.target.value);
                })
              }
            />
          </div>
          <Link
            to="/runs/new"
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white"
          >
            {pick("New Run", "新建运行")}
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              {pick("Benchmark Readiness", "Benchmark 就绪度")}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {pick(
                "Track reusable case scenarios, replay coverage, and whether recent benchmark runs are getting healthier.",
                "这里会汇总可复用 Case 场景、回放覆盖率，以及最近 benchmark 运行是否在变得更健康。"
              )}
            </p>
          </div>
          {benchmarkQuery.data ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
              {benchmarkQuery.data.scenarioCount}
            </span>
          ) : null}
        </div>

        {benchmarkQuery.isLoading ? (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            {pick("Loading benchmark summary...", "正在加载 benchmark 摘要...")}
          </div>
        ) : benchmarkQuery.data ? (
          <>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                  {pick("Scenarios", "场景数")}
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {benchmarkQuery.data.scenarioCount}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                  {pick("Covered", "已覆盖")}
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {benchmarkQuery.data.coveredScenarioCount}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                  {pick("Replay Pass Rate", "回放通过率")}
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {formatPercent(benchmarkQuery.data.passRate)}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                  {pick("Avg Steps", "平均步数")}
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {formatAvgSteps(benchmarkQuery.data.avgSteps)}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {benchmarkQuery.data.recentFailureCategories.map((bucket) => (
                <span
                  key={bucket.category}
                  className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-medium text-amber-800"
                >
                  {bucket.category} · {bucket.count}
                </span>
              ))}
              {benchmarkQuery.data.recentFailureCategories.length === 0 ? (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-700">
                  {pick("No recent benchmark failures", "最近没有 benchmark 失败")}
                </span>
              ) : null}
            </div>

            {benchmarkActionError ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {benchmarkActionError}
              </div>
            ) : null}

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                  {pick("Needs Coverage", "待覆盖")}
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {benchmarkSections.uncovered.length}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                  {pick("Needs Attention", "需关注")}
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {benchmarkSections.attention.length}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                  {pick("Healthy", "已稳定")}
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {benchmarkSections.healthy.length}
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-5">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      {pick("Needs Coverage", "待覆盖场景")}
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {pick(
                        "Start with scenarios that still have no benchmark replay history.",
                        "优先补齐还没有 benchmark 回放历史的场景。"
                      )}
                    </p>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                    {benchmarkSections.uncovered.length}
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  {benchmarkSections.uncovered.length > 0 ? (
                    benchmarkSections.uncovered.map((scenario) => (
                      <BenchmarkScenarioCard
                        key={scenario.caseId}
                        scenario={scenario}
                        pick={pick}
                        formatRelativeTime={formatRelativeTime}
                        replayPending={replayScenarioMutation.isPending}
                        onReplay={(caseId) => replayScenarioMutation.mutate(caseId)}
                      />
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                      {pick(
                        "Every known scenario has at least one replay result now.",
                        "当前已知场景都已经有至少一次回放结果了。"
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      {pick("Needs Attention", "需要关注")}
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {pick(
                        "Open the latest failure directly or compare it with the most recent green run.",
                        "可以直接打开最近失败，或和最近一次绿色基线做对比。"
                      )}
                    </p>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                    {benchmarkSections.attention.length}
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  {benchmarkSections.attention.length > 0 ? (
                    benchmarkSections.attention.map((scenario) => (
                      <BenchmarkScenarioCard
                        key={scenario.caseId}
                        scenario={scenario}
                        pick={pick}
                        formatRelativeTime={formatRelativeTime}
                        replayPending={replayScenarioMutation.isPending}
                        onReplay={(caseId) => replayScenarioMutation.mutate(caseId)}
                      />
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                      {pick(
                        "There are no regressed benchmark scenarios at the moment.",
                        "当前没有需要紧急处理的 benchmark 回归场景。"
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      {pick("Healthy Coverage", "稳定覆盖")}
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {pick(
                        "These scenarios are currently green and can be replayed again as fresh baselines.",
                        "这些场景目前是绿色的，也可以继续回放刷新基线。"
                      )}
                    </p>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                    {benchmarkSections.healthy.length}
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  {benchmarkSections.healthy.length > 0 ? (
                    benchmarkSections.healthy.slice(0, 4).map((scenario) => (
                      <BenchmarkScenarioCard
                        key={scenario.caseId}
                        scenario={scenario}
                        pick={pick}
                        formatRelativeTime={formatRelativeTime}
                        replayPending={replayScenarioMutation.isPending}
                        onReplay={(caseId) => replayScenarioMutation.mutate(caseId)}
                      />
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                      {pick(
                        "A scenario becomes healthy after its latest replay finishes green.",
                        "场景的最近一次回放变成绿色后，就会出现在这里。"
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            {pick(
              "No benchmark summary yet. Extract passed runs into cases first so replay coverage can accumulate here.",
              "暂时还没有 benchmark 摘要。先把通过运行提取成 Case，回放覆盖率才会在这里开始沉淀。"
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              {pick("Run History", "运行列表")}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {pick(
                "Show the goal, current conclusion, and entry points first.",
                "默认先展示目标、当前结论和入口。"
              )}
            </p>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
            {filteredRuns.length}
          </span>
        </div>

        <div className="max-h-[68vh] overflow-auto">
          {runsQuery.isLoading ? (
            <div className="p-5 text-sm text-slate-500">
              {pick("Loading runs...", "正在加载运行...")}
            </div>
          ) : filteredRuns.length === 0 ? (
            <div className="p-5 text-sm text-slate-500">
              {pick("No runs found.", "没有找到运行记录。")}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {filteredRuns.map((run, index) => {
                const updatedLabel = formatRelativeTime(
                  run.startedAt ?? run.createdAt,
                  pick("just now", "刚刚")
                );
                const comparableRun = findComparableRun(filteredRuns, index);
                const metaParts = [
                  pick(`Updated ${updatedLabel}`, `更新于 ${updatedLabel}`),
                  typeof run.stepCount === "number"
                    ? pick(`${run.stepCount} steps`, `${run.stepCount} 步`)
                    : null,
                  pick(`ID ${run.id.slice(0, 8)}`, `ID ${run.id.slice(0, 8)}`)
                ].filter(Boolean);

                return (
                  <li key={run.id} className="px-5 py-4 transition hover:bg-slate-50/70">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{run.goal}</p>
                        <p className="mt-1 text-sm text-slate-600">{describeRun(run, pick)}</p>
                        <p className="mt-2 truncate text-xs text-slate-500">
                          {describeCurrentPage(run, pick)}
                        </p>
                      </div>
                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-medium ${
                          statusTone[run.status] ?? "border-slate-300 bg-slate-100 text-slate-600"
                        }`}
                      >
                        {statusLabel(run.status, pick)}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <span>{metaParts.join(" · ")}</span>
                      <div className="flex items-center gap-3">
                        <Link to={`/runs/${run.id}`} className="text-sky-700 hover:underline">
                          {pick("Open Live", "打开实时页")}
                        </Link>
                        <Link to={`/reports/${run.id}`} className="text-slate-700 hover:underline">
                          {pick("Report", "报告")}
                        </Link>
                        {comparableRun ? (
                          <Link
                            to={`/reports/${run.id}?compareTo=${comparableRun.id}`}
                            className="text-amber-700 hover:underline"
                          >
                            {pick("Compare Previous", "对比上一轮")}
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
};
