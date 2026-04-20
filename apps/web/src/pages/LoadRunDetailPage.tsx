import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { Language, LoadRunSampleWindow } from "@qpilot/shared";
import { useI18n } from "../i18n/I18nProvider";
import { api } from "../lib/api";
import { buildSparklinePath } from "../lib/sparkline";
import { PlatformBadge } from "../platform/PlatformBadge";
import { PlatformEmptyState } from "../platform/PlatformEmptyState";
import { PlatformFiltersBar } from "../platform/PlatformFiltersBar";
import { PlatformMetricCard } from "../platform/PlatformMetricCard";
import { PlatformPageShell } from "../platform/PlatformPageShell";
import { PlatformSectionHeader } from "../platform/PlatformSectionHeader";

const verdictTone = { ship: "success", watch: "warning", hold: "danger" } as const;
const statusTone = {
  passed: "success",
  failed: "danger",
  running: "info",
  queued: "warning",
  stopped: "neutral"
} as const;
const heartbeatTone = { fresh: "success", stale: "warning", missing: "neutral" } as const;

const pickStatusTone = (status: string) =>
  statusTone[status as keyof typeof statusTone] ?? "neutral";
const pickHeartbeatTone = (state: string) =>
  heartbeatTone[state as keyof typeof heartbeatTone] ?? "neutral";
const formatDelta = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}`;

const translateVerdict = (value: string, language: Language) =>
  language === "zh-CN"
    ? ({ ship: "通过", watch: "观察", hold: "阻塞" }[value] ?? value)
    : value;

const translateStatus = (value: string, language: Language) =>
  language === "zh-CN"
    ? ({
        passed: "已通过",
        failed: "失败",
        running: "运行中",
        queued: "排队中",
        stopped: "已停止",
        fresh: "正常",
        stale: "过期",
        missing: "缺失"
      }[value] ?? value)
    : value;

const translateSource = (value: string, language: Language) =>
  value === "k6" ? (language === "zh-CN" ? "真实 k6" : "Real k6") : language === "zh-CN" ? "模拟" : "Synthetic";

const localizeLoadText = (text: string, language: Language) => {
  if (language !== "zh-CN" || !text) {
    return text;
  }
  const exactMap: Record<string, string> = {
    "Run is actively executing": "运行仍在进行中",
    "Threshold evaluation will start once the run finishes collecting evidence.": "等运行结束并完成证据采集后，才会开始阈值评估。",
    "No summary artifact was persisted for this run.": "这次运行还没有持久化 summary 工件。",
    "This run is still executing, so the gate is in a watch state until live evidence settles.": "这次运行仍在执行中，门禁暂时保持观察状态，等待实时证据稳定。",
    "The run failed at least one release threshold and should block promotion until the regression is understood.": "这次运行至少有一项发布阈值失败，在定位回归原因前应阻止发布。",
    "The run produced blocking evidence and should keep the release gate closed.": "这次运行已经产生阻塞证据，发布门禁应保持关闭。",
    "Snapshot persisted.": "已保存一个配置快照。",
    "No time-series data found for this run.": "这次运行还没有可用的时间序列数据。",
    "Sample cache": "样本缓存",
    "Sample window cache": "样本窗口缓存"
  };
  if (exactMap[text]) {
    return exactMap[text];
  }
  return text
    .replace(/^Observed (.+) against a (.+) limit\.$/, "当前观测值 $1，阈值上限 $2。")
    .replace(/^Observed (.+) ms against a (.+) ms budget\.$/, "当前观测 $1 ms，阈值预算 $2 ms。")
    .replace(/^Observed (.+)% against a (.+)% budget\.$/, "当前观测 $1%，阈值预算 $2%。")
    .replace(/^Observed (.+) RPS against a (.+) RPS floor\.$/, "当前观测 $1 RPS，最低阈值 $2 RPS。")
    .replace(/^(\d+) workers failed and (\d+) workers have stale heartbeat signals\.$/, "$1 个 worker 失败，$2 个 worker 的心跳已过期。")
    .replace(/^(\d+) of (\d+) workers ended in a failed state\.$/, "$2 个 worker 中有 $1 个以失败状态结束。")
    .replace(/^Release thresholds failed for (.+)\. Keep this scenario blocked until the regression is understood\.$/, "$1 的发布阈值失败。在定位回归原因前，应继续阻塞这个场景。");
};

const normalizeSeries = (points: LoadRunSampleWindow[]) =>
  [...points].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

const buildDots = (values: number[], width: number, height: number) => {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - ((value - min) / range) * height;
    return { x, y };
  });
};

export const LoadRunDetailPage = () => {
  const { runId } = useParams();
  const { formatDateTime, formatRelativeTime, language, pick } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const tx = (en: string, zh: string) => pick(en, zh);
  const baselineRunId = searchParams.get("baselineRunId") ?? "";
  const candidateRunId = searchParams.get("candidateRunId") ?? "";

  const updateSearch = (entries: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(entries).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    setSearchParams(next, { replace: true });
  };

  const detailQuery = useQuery({
    queryKey: ["platform", "load-run-detail", runId],
    queryFn: () => api.getPlatformLoadRunDetail(runId ?? ""),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const detail = query.state.data;
      return detail && (detail.run.status === "queued" || detail.run.status === "running") ? 3000 : false;
    }
  });
  const detail = detailQuery.data;
  const run = detail?.run;
  const siblingRuns = useMemo(() => (detail?.recentSiblingRuns?.length ? detail.recentSiblingRuns : run ? [run] : []), [detail?.recentSiblingRuns, run]);

  useEffect(() => {
    if (!detail || !run) return;
    const preferredBaseline =
      siblingRuns.find((entry) => entry.id === detail.compareBaselineRunId) ??
      siblingRuns.find((entry) => entry.id !== run.id && entry.verdict === "ship") ??
      siblingRuns.find((entry) => entry.id !== run.id) ??
      null;
    const nextEntries: Record<string, string | null> = {};
    if (!baselineRunId && preferredBaseline) nextEntries.baselineRunId = preferredBaseline.id;
    if (!candidateRunId) nextEntries.candidateRunId = run.id;
    if (Object.keys(nextEntries).length > 0) updateSearch(nextEntries);
  }, [baselineRunId, candidateRunId, detail, run, siblingRuns]);

  const seriesQuery = useQuery({
    queryKey: ["platform", "load-run-series", runId],
    queryFn: () => api.getPlatformLoadRunSeries(runId ?? ""),
    enabled: Boolean(runId),
    refetchInterval: () => (detail?.run.status === "queued" || detail?.run.status === "running" ? 3000 : false)
  });

  const compareQuery = useQuery({
    queryKey: ["platform", "load-run-compare", runId, baselineRunId || "none", candidateRunId || "none"],
    queryFn: () =>
      api.getPlatformLoadRunCompare({
        runId: runId ?? "",
        baselineRunId: baselineRunId || undefined,
        candidateRunId: candidateRunId || undefined
      }),
    enabled: Boolean(runId && baselineRunId && candidateRunId && baselineRunId !== candidateRunId)
  });

  const profileVersionsQuery = useQuery({
    queryKey: ["platform", "load-profile-versions", detail?.profile.id ?? "none"],
    queryFn: () => api.listPlatformLoadProfileVersions(detail?.profile.id ?? ""),
    enabled: Boolean(detail?.profile.id)
  });

  const rerunMutation = useMutation({
    mutationFn: () => api.retryPlatformLoadRun(runId ?? "", tx("Retry from detail page", "从详情页重试")),
    onSuccess: async (nextRun) => {
      await queryClient.invalidateQueries({ queryKey: ["platform", "load-runs"] });
      await queryClient.invalidateQueries({ queryKey: ["platform", "load-queue"] });
      navigate(`/platform/load/runs/${nextRun.id}`);
    }
  });
  const cancelMutation = useMutation({
    mutationFn: () => api.cancelPlatformLoadRun(runId ?? ""),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["platform", "load-runs"] });
      await queryClient.invalidateQueries({ queryKey: ["platform", "load-queue"] });
      await queryClient.invalidateQueries({ queryKey: ["platform", "load-run-detail", runId] });
    }
  });
  const pinBaselineMutation = useMutation({
    mutationFn: () => api.pinPlatformLoadBaseline(detail?.profile.id ?? "", detail?.run.id ?? "")
  });
  const promoteBaselineMutation = useMutation({
    mutationFn: () => api.promotePlatformLoadBaseline(detail?.profile.id ?? "", detail?.run.id ?? "")
  });
  const rollbackProfileMutation = useMutation({
    mutationFn: (versionId: string) => api.rollbackPlatformLoadProfile(detail?.profile.id ?? "", versionId)
  });

  const alerts = detail?.alerts ?? [];
  const thresholdChecks = detail?.thresholdChecks ?? [];
  const gateInputs = detail?.gateInputs ?? [];
  const workers = detail?.workers ?? [];
  const linkedArtifacts = detail?.linkedArtifacts ?? [];
  const executionNotes = detail?.executionNotes ?? [];
  const workerHealthSummary = detail?.workerHealthSummary ?? {
    total: workers.length,
    healthy: workers.filter((worker) => worker.status === "passed").length,
    failed: workers.filter((worker) => worker.status === "failed").length,
    stale: workers.filter((worker) => worker.heartbeatState === "stale" || worker.heartbeatState === "missing").length
  };

  const seriesPoints = normalizeSeries(seriesQuery.data?.points ?? detail?.timeSeriesSummary ?? []);
  const seriesSource = seriesQuery.data?.source ?? "sample_window_cache";
  const seriesInfo = seriesQuery.data?.detail ?? (seriesQuery.error instanceof Error ? seriesQuery.error.message : undefined);
  const width = 220;
  const height = 56;
  const cards = useMemo(
    () =>
      [
        { key: "p95", label: tx("P95", "P95"), color: "#0f172a", unit: "ms", values: seriesPoints.map((entry) => entry.p95Ms) },
        { key: "error", label: tx("Error rate", "错误率"), color: "#e11d48", unit: "%", values: seriesPoints.map((entry) => entry.errorRatePct) },
        { key: "throughput", label: tx("Throughput", "吞吐量"), color: "#0284c7", unit: "RPS", values: seriesPoints.map((entry) => entry.throughputRps) }
      ].map((card) => ({
        ...card,
        path: buildSparklinePath(card.values, width, height),
        dots: buildDots(card.values, width, height),
        latest: card.values.length ? card.values[card.values.length - 1] : null
      })),
    [seriesPoints, language]
  );

  if (!runId) {
    return <section className="rounded-[28px] border border-rose-200 bg-rose-50 p-6 text-rose-700">{tx("Missing load run id.", "缺少压测运行 ID。")}</section>;
  }
  if (detailQuery.isLoading) {
    return <section className="rounded-[28px] border border-slate-200 bg-white p-6 text-slate-600">{tx("Loading load run detail...", "正在加载压测运行详情...")}</section>;
  }
  if (!detail || !run) {
    return <section className="rounded-[28px] border border-rose-200 bg-rose-50 p-6 text-rose-700">{detailQuery.error instanceof Error ? detailQuery.error.message : tx("Unable to load load run detail.", "无法加载压测运行详情。")}</section>;
  }

  const baselineOptions = siblingRuns.filter((entry) => entry.id !== candidateRunId);
  const candidateOptions = siblingRuns.filter((entry) => entry.id !== baselineRunId);
  const compare = compareQuery.data;

  return (
    <PlatformPageShell
      dense={false}
      accent="sky"
      badge={<PlatformBadge tone={verdictTone[run.verdict]}>{translateVerdict(run.verdict, language)}</PlatformBadge>}
      projectLabel={
        <>
          <PlatformBadge tone={pickStatusTone(run.status)}>{translateStatus(run.status, language)}</PlatformBadge>
          <PlatformBadge>{translateSource(run.source, language)}</PlatformBadge>
          <PlatformBadge>{run.environmentLabel}</PlatformBadge>
        </>
      }
      title={run.profileName}
      actions={
        <>
          <Link to="/platform/load" className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700">{tx("Back to Load Studio", "返回压测台")}</Link>
          <button type="button" onClick={() => rerunMutation.mutate()} disabled={rerunMutation.isPending} className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{rerunMutation.isPending ? tx("Launching retry...", "正在发起重试...") : tx("Retry this run", "重试这次运行")}</button>
          {run.status === "queued" ? <button type="button" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending} className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 disabled:opacity-50">{cancelMutation.isPending ? tx("Cancelling...", "正在取消...") : tx("Cancel queued run", "取消排队中的运行")}</button> : null}
          <button type="button" onClick={() => pinBaselineMutation.mutate()} disabled={pinBaselineMutation.isPending} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">{pinBaselineMutation.isPending ? tx("Pinning...", "正在设置基线...") : tx("Pin as baseline", "设为基线")}</button>
          <button type="button" onClick={() => promoteBaselineMutation.mutate()} disabled={promoteBaselineMutation.isPending} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">{promoteBaselineMutation.isPending ? tx("Promoting...", "正在提升为基线...") : tx("Promote baseline", "提升为基线")}</button>
        </>
      }
      metrics={
        <>
          <PlatformMetricCard label="P50" value={`${run.metrics.p50Ms.toFixed(2)} ms`} />
          <PlatformMetricCard label="P95" value={`${run.metrics.p95Ms.toFixed(2)} ms`} />
          <PlatformMetricCard label={tx("Error rate", "错误率")} value={`${run.metrics.errorRatePct.toFixed(2)}%`} />
          <PlatformMetricCard label={tx("Throughput", "吞吐量")} value={`${run.metrics.throughputRps.toFixed(2)} RPS`} />
        </>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_380px]">
        <div className="space-y-6">
          {alerts.length > 0 ? <section className="rounded-[28px] border border-amber-200 bg-amber-50 p-5 text-amber-900"><PlatformSectionHeader eyebrow={tx("Alerts", "告警")} title={tx("Run attention", "运行关注项")} description={localizeLoadText(alerts[0]?.detail ?? "", language)} /></section> : null}

          <section className="rounded-[28px] border border-slate-200 bg-white p-5">
            <PlatformSectionHeader
              eyebrow={tx("Time series", "时间序列")}
              title={tx("Live run console", "实时运行曲线")}
              description={`${tx("P95, error rate, and throughput over the latest sample windows.", "这里展示最近样本窗口里的 P95、错误率和吞吐量走势。")} ${seriesSource === "prometheus" ? "Prometheus" : tx("Sample window cache", "样本窗口缓存")}.`}
              actions={<PlatformBadge tone={seriesInfo ? "neutral" : "info"}>{seriesInfo ? localizeLoadText(seriesInfo, language) : seriesSource === "prometheus" ? "Prometheus" : tx("Sample cache", "样本缓存")}</PlatformBadge>}
            />
            {seriesPoints.length > 0 ? (
              <div className="mt-5 grid gap-4 xl:grid-cols-3">
                {cards.map((card) => (
                  <article key={card.key} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900">{card.label}</p>
                      <p className="text-xs text-slate-500">{tx("Latest", "最新")} {card.latest != null ? `${card.latest.toFixed(2)} ${card.unit}` : "-"}</p>
                    </div>
                    <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 h-16 w-full">
                      <path d={card.path} fill="none" stroke={card.color} strokeWidth="2.5" strokeLinecap="round" />
                      {card.dots.map((dot, index) => <circle key={`${card.key}-${index}`} cx={dot.x} cy={dot.y} r={index === card.dots.length - 1 ? 3.2 : 2.4} fill={card.color} />)}
                    </svg>
                    <p className="mt-3 text-xs text-slate-500">{tx("Samples", "样本点")} {card.dots.length}</p>
                  </article>
                ))}
              </div>
            ) : <div className="mt-4"><PlatformEmptyState message={tx("No time-series samples are available yet for this run.", "这次运行还没有可用的时间序列样本。")} /></div>}
          </section>

          <section className="rounded-[28px] border border-slate-200 bg-white p-5">
            <PlatformSectionHeader eyebrow={tx("Compare", "对比")} title={tx("Baseline and candidate", "基线与候选运行")} description={tx("Threshold, worker, and degradation comparison use the same model as Load Studio.", "阈值、worker 和退化对比与压测台使用同一套模型。")} />
            <PlatformFiltersBar
              filters={
                <>
                  <select className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700" value={baselineRunId} onChange={(event) => updateSearch({ baselineRunId: event.target.value || null })}>
                    <option value="">{tx("Select baseline", "选择基线运行")}</option>
                    {baselineOptions.map((entry) => <option key={entry.id} value={entry.id}>{`${entry.environmentLabel} · ${formatRelativeTime(entry.createdAt)} · ${translateVerdict(entry.verdict, language).toUpperCase()}`}</option>)}
                  </select>
                  <select className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700" value={candidateRunId} onChange={(event) => updateSearch({ candidateRunId: event.target.value || null })}>
                    <option value="">{tx("Select candidate", "选择候选运行")}</option>
                    {candidateOptions.map((entry) => <option key={entry.id} value={entry.id}>{`${entry.environmentLabel} · ${formatRelativeTime(entry.createdAt)} · ${translateVerdict(entry.verdict, language).toUpperCase()}`}</option>)}
                  </select>
                </>
              }
            />
            {compare ? (
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {compare.thresholdDiff.map((entry) => <article key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-slate-900">{localizeLoadText(entry.label, language)}</p><PlatformBadge tone={entry.direction === "better" ? "success" : entry.direction === "worse" ? "danger" : "neutral"}>{language === "zh-CN" ? entry.direction === "better" ? "更好" : entry.direction === "worse" ? "变差" : "持平" : entry.direction}</PlatformBadge></div><p className="mt-2 text-xs text-slate-500">{localizeLoadText(entry.summary, language)}</p><p className="mt-3 text-lg font-semibold text-slate-950">{formatDelta(entry.delta)}</p></article>)}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <article className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs uppercase tracking-[0.22em] text-slate-400">{tx("Worker diff", "Worker 对比")}</p><p className="mt-2 text-sm text-slate-700">{localizeLoadText(compare.workerDiff.summary, language)}</p><div className="mt-4 flex flex-wrap gap-2"><PlatformBadge>{`${tx("baseline", "基线")} ${compare.workerDiff.baselineWorkers}`}</PlatformBadge><PlatformBadge>{`${tx("candidate", "候选")} ${compare.workerDiff.candidateWorkers}`}</PlatformBadge><PlatformBadge tone="danger">{`failed Δ ${compare.workerDiff.failedDelta}`}</PlatformBadge><PlatformBadge tone="warning">{`stale Δ ${compare.workerDiff.staleDelta}`}</PlatformBadge></div></article>
                  <article className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs uppercase tracking-[0.22em] text-slate-400">{tx("Degradation diff", "退化对比")}</p><p className="mt-2 text-sm text-slate-700">{localizeLoadText(compare.degradationDiff.summary, language)}</p><div className="mt-4 flex flex-wrap gap-2"><PlatformBadge>{`${tx("baseline", "基线")} ${compare.degradationDiff.baselineEventCount}`}</PlatformBadge><PlatformBadge>{`${tx("candidate", "候选")} ${compare.degradationDiff.candidateEventCount}`}</PlatformBadge><PlatformBadge tone={compare.degradationDiff.regression ? "danger" : "success"}>{compare.degradationDiff.regression ? tx("regression", "回归") : tx("stable", "稳定")}</PlatformBadge></div></article>
                </div>
              </div>
            ) : <PlatformEmptyState message={compareQuery.error instanceof Error ? localizeLoadText(compareQuery.error.message, language) : tx("Select a baseline and a candidate run.", "请选择一条基线运行和一条候选运行。")} />}
          </section>

          <section className="rounded-[28px] border border-slate-200 bg-white p-5">
            <PlatformSectionHeader eyebrow={tx("Gate", "门禁")} title={localizeLoadText(detail.gateSummary, language)} description={localizeLoadText(detail.gateDecision.summary, language)} actions={<PlatformBadge tone={verdictTone[detail.gateDecision.verdict]}>{translateVerdict(detail.gateDecision.verdict, language)}</PlatformBadge>} />
            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              <div className="space-y-3">{thresholdChecks.length > 0 ? thresholdChecks.map((check) => <article key={check.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-slate-900">{localizeLoadText(check.label, language)}</p><PlatformBadge tone={check.status === "passed" ? "success" : check.status === "failed" ? "danger" : "warning"}>{translateStatus(check.status, language)}</PlatformBadge></div><p className="mt-2 text-xs text-slate-500">{localizeLoadText(check.summary, language)}</p></article>) : <PlatformEmptyState message={tx("No threshold result is available yet.", "还没有可用的阈值结果。")} />}</div>
              <div className="space-y-3">{gateInputs.length > 0 ? gateInputs.map((input) => <article key={input.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-slate-900">{localizeLoadText(input.label, language)}</p><PlatformBadge tone={input.status === "passed" ? "success" : input.status === "failed" ? "danger" : "warning"}>{translateStatus(input.status, language)}</PlatformBadge></div><p className="mt-2 text-xs text-slate-500">{localizeLoadText(input.detail, language)}</p></article>) : <PlatformEmptyState message={tx("No gate input is available yet.", "还没有可用的门禁输入。")} />}</div>
            </div>
          </section>

          <section className="rounded-[28px] border border-slate-200 bg-white p-5">
            <PlatformSectionHeader eyebrow={tx("Execution", "执行")} title={tx("Execution notes", "执行备注")} />
            <div className="mt-4 space-y-3">{executionNotes.length > 0 ? executionNotes.map((note, index) => <article key={`${note}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{localizeLoadText(note, language)}</article>) : <PlatformEmptyState message={tx("No execution note is attached to this run.", "这次运行没有附带执行备注。")} />}</div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-[28px] border border-slate-200 bg-white p-5">
            <PlatformSectionHeader eyebrow={tx("Workers", "工作进程")} title={tx("Worker health", "Worker 健康状态")} />
            <div className="mt-4 grid gap-3 sm:grid-cols-2"><PlatformMetricCard label={tx("Total", "总数")} value={workerHealthSummary.total} /><PlatformMetricCard label={tx("Healthy", "健康")} value={workerHealthSummary.healthy} /><PlatformMetricCard label={tx("Failed", "失败")} value={workerHealthSummary.failed} /><PlatformMetricCard label={tx("Stale", "过期")} value={workerHealthSummary.stale} /></div>
            <div className="mt-5 space-y-3">{workers.length > 0 ? workers.map((worker) => <div key={worker.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium text-slate-900">{worker.workerLabel}</p><div className="flex flex-wrap gap-2"><PlatformBadge tone={pickStatusTone(worker.status)}>{translateStatus(worker.status, language)}</PlatformBadge>{worker.heartbeatState ? <PlatformBadge tone={pickHeartbeatTone(worker.heartbeatState)}>{translateStatus(worker.heartbeatState, language)}</PlatformBadge> : null}</div></div><p className="mt-2 text-xs text-slate-500">{`P95 ${worker.metrics.p95Ms.toFixed(2)} ms · ${worker.metrics.throughputRps.toFixed(2)} RPS`}</p>{worker.lastHeartbeatAt ? <p className="mt-1 text-xs text-slate-500">{`${tx("Last heartbeat", "最近心跳")} · ${formatRelativeTime(worker.lastHeartbeatAt)}`}</p> : null}{worker.notes ? <p className="mt-2 text-xs text-slate-500">{localizeLoadText(worker.notes, language)}</p> : null}</div>) : <PlatformEmptyState message={tx("No worker detail is available yet.", "还没有可用的 worker 明细。")} />}</div>
          </section>

          <section className="rounded-[28px] border border-slate-200 bg-white p-5">
            <PlatformSectionHeader eyebrow={tx("Artifacts", "工件")} title={tx("Linked artifacts", "关联工件")} />
            <div className="mt-4 space-y-3">{linkedArtifacts.length > 0 ? linkedArtifacts.map((artifact) => <article key={artifact.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"><p className="text-sm font-semibold text-slate-900">{localizeLoadText(artifact.label, language)}</p><p className="mt-2 break-all font-mono text-xs text-slate-500">{artifact.path}</p></article>) : <PlatformEmptyState message={tx("No artifact is linked to this run.", "这次运行还没有关联工件。")} />}</div>
          </section>

          <section className="rounded-[28px] border border-slate-200 bg-white p-5">
            <PlatformSectionHeader eyebrow={tx("Versions", "版本")} title={tx("Profile versions", "配置版本")} />
            <div className="mt-4 space-y-3">{(profileVersionsQuery.data?.length ?? 0) > 0 ? profileVersionsQuery.data?.map((version) => <article key={version.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-slate-900">{`v${version.versionNumber}`}</p><p className="mt-1 text-xs text-slate-500">{version.reason ? localizeLoadText(version.reason, language) : tx("Snapshot persisted.", "已保存一个配置快照。")}</p></div><div className="flex items-center gap-2"><p className="text-xs text-slate-500">{formatDateTime(version.createdAt)}</p><button type="button" onClick={() => rollbackProfileMutation.mutate(version.id)} disabled={rollbackProfileMutation.isPending} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50">{tx("Rollback", "回滚")}</button></div></div></article>) : <PlatformEmptyState message={tx("No version snapshot for this profile.", "这个 profile 还没有版本快照。")} />}</div>
          </section>
        </aside>
      </div>
    </PlatformPageShell>
  );
};
