import { startTransition, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useI18n } from "../i18n/I18nProvider";
import { api } from "../lib/api";
import {
  formatLocalizedStepTitle,
  localizeActionDescriptor,
  localizeComparisonChange,
  localizeEvidenceText
} from "../lib/evidence-i18n";

const toneClass = (tone: string): string => {
  switch (tone) {
    case "rose":
      return "bg-rose-500";
    case "amber":
      return "bg-amber-500";
    case "indigo":
      return "bg-indigo-500";
    case "emerald":
      return "bg-emerald-500";
    default:
      return "bg-sky-500";
  }
};

export const ReportPage = () => {
  const { formatDateTime, language, pick } = useI18n();
  const navigate = useNavigate();
  const { runId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const compareTo = searchParams.get("compareTo") ?? "";
  const [showHtmlPreview, setShowHtmlPreview] = useState(false);

  const statusLabel = (status: string): string => {
    switch (status) {
      case "queued":
        return pick("queued", "排队中");
      case "running":
        return pick("running", "运行中");
      case "passed":
        return pick("passed", "已通过");
      case "failed":
        return pick("failed", "失败");
      case "stopped":
        return pick("stopped", "已停止");
      default:
        return status;
    }
  };

  const reportQuery = useQuery({
    queryKey: ["report", runId],
    queryFn: () => api.getReport(runId),
    enabled: Boolean(runId),
    staleTime: 15_000,
    refetchInterval: 2_000,
    refetchOnWindowFocus: false
  });

  const runQuery = useQuery({
    queryKey: ["run", runId, "report"],
    queryFn: () => api.getRun(runId),
    enabled: Boolean(runId),
    refetchInterval: reportQuery.data ? false : 2_000,
    refetchOnWindowFocus: false
  });

  const stepsQuery = useQuery({
    queryKey: ["steps", runId, "report"],
    queryFn: () => api.getRunSteps(runId),
    enabled: Boolean(runId),
    refetchInterval: reportQuery.data ? false : 2_000,
    refetchOnWindowFocus: false
  });

  const diagnosisQuery = useQuery({
    queryKey: ["run", runId, "diagnosis", language],
    queryFn: () => api.getRunDiagnosis(runId, language),
    enabled: Boolean(runId),
    staleTime: 10_000
  });

  const comparisonQuery = useQuery({
    queryKey: ["run", runId, "compare", compareTo, language],
    queryFn: () => api.compareRuns(compareTo, runId, language),
    enabled: Boolean(runId && compareTo),
    staleTime: 10_000
  });
  const rerunMutation = useMutation({
    mutationFn: () => api.rerunRun(runId),
    onSuccess: (nextRun) => {
      navigate(`/runs/${nextRun.id}?compareTo=${runId}`);
    }
  });

  const report = reportQuery.data;
  const run = runQuery.data;
  const steps = stepsQuery.data ?? [];
  const diagnosis = diagnosisQuery.data;
  const comparison = comparisonQuery.data;
  const rerunError =
    rerunMutation.error instanceof Error ? rerunMutation.error.message.trim() : "";
  const localizedDiagnosis = useMemo(
    () =>
      diagnosis
        ? {
            ...diagnosis,
            headline: localizeEvidenceText(diagnosis.headline, language),
            rootCause: localizeEvidenceText(diagnosis.rootCause, language),
            stopReason: localizeEvidenceText(diagnosis.stopReason, language),
            nextBestAction: localizeEvidenceText(diagnosis.nextBestAction, language),
            userImpact: localizeEvidenceText(diagnosis.userImpact, language),
            pageTitle: localizeEvidenceText(diagnosis.pageTitle, language)
          }
        : null,
    [diagnosis, language]
  );
  const localizedComparison = useMemo(
    () =>
      comparison
        ? {
            ...comparison,
            headline: localizeEvidenceText(comparison.headline, language),
            summary: localizeEvidenceText(comparison.summary, language),
            baseDiagnosis: {
              ...comparison.baseDiagnosis,
              headline: localizeEvidenceText(comparison.baseDiagnosis.headline, language),
              rootCause: localizeEvidenceText(comparison.baseDiagnosis.rootCause, language)
            },
            candidateDiagnosis: {
              ...comparison.candidateDiagnosis,
              headline: localizeEvidenceText(comparison.candidateDiagnosis.headline, language),
              rootCause: localizeEvidenceText(comparison.candidateDiagnosis.rootCause, language)
            },
            stepChanges: comparison.stepChanges.map((item) => ({
              ...item,
              summary: localizeEvidenceText(item.summary, language),
              baseAction: localizeActionDescriptor(item.baseAction, language),
              candidateAction: localizeActionDescriptor(item.candidateAction, language)
            }))
          }
        : null,
    [comparison, language]
  );
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

  const timeline = useMemo(() => {
    if (!run) {
      return [];
    }

    return [
      {
        id: "start",
        title: pick("Run started", "运行开始"),
        detail: run.targetUrl,
        at: run.startedAt ?? run.createdAt,
        tone: "sky"
      },
      ...(run.startupObservation
        ? [
            {
              id: "startup",
              title: pick("Startup evidence captured", "已采集启动证据"),
              detail: localizeEvidenceText(run.startupObservation, language),
              at: run.startedAt ?? run.createdAt,
              tone: "indigo"
            }
          ]
        : []),
      ...steps.map((step) => ({
        id: step.id,
        title: formatLocalizedStepTitle(step.index, step.action.type, language),
        detail: localizeEvidenceText(step.observationSummary, language),
        at: step.createdAt,
        tone:
          step.actionStatus === "failed"
            ? "rose"
            : step.actionStatus === "blocked_high_risk"
              ? "amber"
              : "emerald"
      })),
      ...(run.challengeKind
        ? [
            {
              id: "challenge",
              title: pick(
                `Challenge: ${run.challengeKind.replaceAll("_", " ")}`,
                `挑战：${run.challengeKind.replaceAll("_", " ")}`
              ),
              detail:
                localizeEvidenceText(run.challengeReason, language) ??
                pick(
                  "A manual checkpoint was encountered during the run.",
                  "本次运行过程中遇到了需要人工处理的关卡。"
                ),
              at: run.endedAt ?? run.startedAt ?? run.createdAt,
              tone: "amber"
            }
          ]
        : []),
      {
        id: "finish",
        title: pick(`Run ${statusLabel(run.status)}`, `运行${statusLabel(run.status)}`),
        detail:
          localizeEvidenceText(run.failureSuggestion ?? run.errorMessage, language) ??
          pick("Reports generated", "报告已生成"),
        at: run.endedAt ?? run.createdAt,
        tone: run.status === "passed" ? "emerald" : run.status === "stopped" ? "amber" : "rose"
      }
    ];
  }, [language, pick, run, steps]);

  if (reportQuery.isLoading) {
    return <div className="text-sm text-slate-500">{pick("Loading report...", "正在加载报告...")}</div>;
  }

  if (reportQuery.error || !report) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
        {pick(
          "Report is not ready yet. Keep this page open or refresh in a few seconds.",
          "报告暂时还没准备好。你可以先保持页面打开，或过几秒后刷新。"
        )}
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{pick("Run Report", "运行报告")}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {localizedDiagnosis?.headline ??
                pick("Open the generated assets or inspect the structured diagnosis below.", "可以先打开产物，也可以直接看下面的结构化诊断。")}
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <button
              type="button"
              onClick={() => rerunMutation.mutate()}
              disabled={rerunMutation.isPending}
              className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1 font-medium text-emerald-700 disabled:opacity-50"
            >
              {rerunMutation.isPending
                ? pick("Starting rerun...", "正在启动重跑...")
                : pick("Rerun And Compare", "重跑并对比")}
            </button>
            {report.videoPath ? (
              <a
                href={`${api.runtimeBase}${report.videoPath}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-slate-300 px-3 py-1 hover:text-ink"
              >
                {pick("Open Video", "打开录像")}
              </a>
            ) : null}
            <a
              href={`${api.runtimeBase}${report.htmlPath}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-slate-300 px-3 py-1 hover:text-ink"
            >
              {pick("Open HTML", "打开 HTML")}
            </a>
            <a
              href={`${api.runtimeBase}${report.xlsxPath}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-slate-300 px-3 py-1 hover:text-ink"
            >
              {pick("Download Excel", "下载 Excel")}
            </a>
            <button
              type="button"
              onClick={() => {
                startTransition(() => setShowHtmlPreview((value) => !value));
              }}
              className="rounded-md border border-slate-300 px-3 py-1 hover:text-ink"
            >
              {showHtmlPreview
                ? pick("Hide HTML Preview", "收起 HTML 预览")
                : pick("Load HTML Preview", "加载 HTML 预览")}
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          {pick(
            "The full HTML preview is deferred by default so the report page opens faster.",
            "为了让报告页打开更快，完整 HTML 预览默认会延迟加载。"
          )}
        </p>
            {rerunError ? (
          <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {localizeEvidenceText(rerunError, language)}
          </div>
        ) : null}
      </div>

      {localizedDiagnosis ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">
                {pick("Human Diagnosis", "人话诊断")}
              </p>
              <h3 className="mt-1 text-xl font-semibold text-slate-900">{localizedDiagnosis.headline}</h3>
              <p className="mt-2 text-sm text-slate-600">{localizedDiagnosis.userImpact}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                {pick(`Status ${statusLabel(localizedDiagnosis.status)}`, `状态 ${statusLabel(localizedDiagnosis.status)}`)}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                {pick(`Steps ${localizedDiagnosis.stepCount}`, `步数 ${localizedDiagnosis.stepCount}`)}
              </span>
              {localizedDiagnosis.failureCategory ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
                  {localizedDiagnosis.failureCategory}
                </span>
              ) : null}
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                {pick("Root Cause", "根因")}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-700">{localizedDiagnosis.rootCause}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                {pick("Stop Reason", "停机原因")}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-700">{localizedDiagnosis.stopReason}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                {pick("Next Action", "下一步建议")}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-700">{localizedDiagnosis.nextBestAction}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                {pick("Landing Page", "停留页面")}
              </p>
              <p className="mt-2 text-sm font-medium text-slate-900">
                {localizedDiagnosis.pageTitle ?? localizedDiagnosis.pageUrl ?? pick("Unknown page", "未知页面")}
              </p>
              {localizedDiagnosis.pageUrl ? (
                <p className="mt-2 break-all text-xs text-slate-500">{localizedDiagnosis.pageUrl}</p>
              ) : null}
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_360px]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                    {pick("Key Request", "关键请求")}
                  </p>
                  <h4 className="mt-1 text-sm font-semibold text-slate-900">
                    {pick("The most relevant request around the stop point", "停机点附近最关键的一条请求")}
                  </h4>
                </div>
              </div>
              {localizedDiagnosis.keyRequest ? (
                <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-900 px-2 py-1 text-[11px] font-medium text-white">
                      {localizedDiagnosis.keyRequest.method}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700">
                      {localizedDiagnosis.keyRequest.phase}
                    </span>
                    {typeof localizedDiagnosis.keyRequest.status === "number" ? (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700">
                        {localizedDiagnosis.keyRequest.status}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 break-all text-sm text-slate-700">
                    {localizedDiagnosis.keyRequest.pathname ?? localizedDiagnosis.keyRequest.url}
                  </p>
                  {localizedDiagnosis.keyRequest.bodyPreview ? (
                    <pre className="mt-3 max-h-36 overflow-auto rounded-xl bg-slate-950 p-3 text-[11px] text-slate-100">
                      {localizedDiagnosis.keyRequest.bodyPreview}
                    </pre>
                  ) : null}
                </div>
              ) : (
                <div className="mt-3 rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  {pick(
                    "No structured key request was captured for this run yet.",
                    "这次运行还没有捕获到结构化的关键请求。"
                  )}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                {pick("Hero Screenshot", "关键截图")}
              </p>
              {localizedDiagnosis.heroScreenshotPath ? (
                <img
                  src={`${api.runtimeBase}${localizedDiagnosis.heroScreenshotPath}`}
                  alt="run diagnosis screenshot"
                  className="mt-3 h-auto w-full rounded-2xl border border-slate-200 bg-white object-cover"
                />
              ) : (
                <div className="mt-3 rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  {pick("No screenshot was captured for this stop point.", "这个停机点还没有对应截图。")}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {localizedComparison ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">
                {pick("Run Diff", "运行对比")}
              </p>
              <h3 className="mt-1 text-xl font-semibold text-slate-900">{localizedComparison.headline}</h3>
              <p className="mt-2 text-sm text-slate-600">{localizedComparison.summary}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {localizedComparison.changedSignals.map((signal) => (
                <span
                  key={signal}
                  className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700"
                >
                  {comparisonSignalLabel(signal)}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                {pick("Baseline", "基线")}
              </p>
              <h4 className="mt-2 text-sm font-semibold text-slate-900">{localizedComparison.baseDiagnosis.headline}</h4>
              <p className="mt-2 text-sm text-slate-600">{localizedComparison.baseDiagnosis.rootCause}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                {pick("Candidate", "候选")}
              </p>
              <h4 className="mt-2 text-sm font-semibold text-slate-900">{localizedComparison.candidateDiagnosis.headline}</h4>
              <p className="mt-2 text-sm text-slate-600">{localizedComparison.candidateDiagnosis.rootCause}</p>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {localizedComparison.stepChanges.length > 0 ? (
              localizedComparison.stepChanges.map((item) => (
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
                  "这两次运行没有检测到步骤级差异。"
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {report.videoPath ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-base font-semibold text-slate-900">{pick("Run Recording", "运行录像")}</h3>
          <video
            controls
            preload="metadata"
            className="mt-3 h-auto max-h-[60vh] w-full rounded-2xl bg-slate-950"
            src={`${api.runtimeBase}${report.videoPath}`}
          />
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-base font-semibold text-slate-900">{pick("Execution Timeline", "执行时间线")}</h3>
        <div className="mt-4 space-y-3">
          {timeline.map((item) => (
            <div key={item.id} className="flex gap-3">
              <div className={`mt-1 h-3 w-3 rounded-full ${toneClass(item.tone)}`} />
              <div className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                  <p className="text-xs text-slate-500">{formatDateTime(item.at)}</p>
                </div>
                <p className="mt-1 text-sm text-slate-600">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showHtmlPreview ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <iframe
            title="report-html"
            src={`${api.runtimeBase}${report.htmlPath}`}
            loading="lazy"
            className="h-[76vh] w-full"
          />
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">
          {pick(
            "HTML preview is ready on demand. Use “Load HTML Preview” when you want the fully rendered report.",
            "HTML 预览已按需准备好，需要时再点击“加载 HTML 预览”即可查看完整报告。"
          )}
        </div>
      )}
    </section>
  );
};
