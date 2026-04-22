import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { useI18n } from "../i18n/I18nProvider";
import { api } from "../lib/api";

type PickFn = (english: string, chinese: string) => string;

const describePhase = (phase: string | undefined, pick: PickFn): string => {
  switch (phase) {
    case "booting":
      return pick("Booting", "启动中");
    case "sensing":
      return pick("Observing", "观察中");
    case "planning":
      return pick("Planning", "规划中");
    case "executing":
      return pick("Executing", "执行中");
    case "verifying":
      return pick("Verifying", "校验中");
    case "paused":
      return pick("Paused", "已暂停");
    case "manual":
      return pick("Waiting for you", "等待你处理");
    case "persisting":
      return pick("Saving", "保存中");
    case "reporting":
      return pick("Reporting", "生成报告中");
    case "finished":
      return pick("Finished", "已完成");
    default:
      return phase ?? pick("Running", "运行中");
  }
};

export const DesktopControlDock = () => {
  const { formatRelativeTime, pick } = useI18n();
  const location = useLocation();
  const activeRunQuery = useQuery({
    queryKey: ["runtime", "active-run"],
    queryFn: () => api.getActiveRun(),
    refetchInterval: 2000
  });

  const pauseMutation = useMutation({
    mutationFn: (runId: string) => api.pauseRun(runId),
    onSuccess: () => activeRunQuery.refetch()
  });
  const resumeMutation = useMutation({
    mutationFn: (runId: string) => api.resumeRun(runId),
    onSuccess: () => activeRunQuery.refetch()
  });
  const abortMutation = useMutation({
    mutationFn: (runId: string) => api.abortRun(runId),
    onSuccess: () => activeRunQuery.refetch()
  });
  const frontMutation = useMutation({
    mutationFn: (runId: string) => api.bringRunToFront(runId)
  });

  const activeRun = activeRunQuery.data?.activeRun ?? null;
  const control = activeRunQuery.data?.control ?? null;

  const liveHref = useMemo(() => {
    if (!activeRun) {
      return "/runs";
    }
    return `/runs/${activeRun.id}`;
  }, [activeRun]);

  if (!activeRun || !control) {
    return null;
  }

  const isOnLivePage = location.pathname === liveHref;
  const needsManualHelp = control.manualRequired || control.phase === "manual";
  const isPaused = control.paused || control.phase === "paused";
  const phaseLabel = describePhase(control.phase, pick);
  const primaryAction =
    needsManualHelp || isPaused
      ? {
          label: needsManualHelp
            ? pick("Resume After Solved", "处理完成后继续")
            : pick("Resume", "继续"),
          onClick: () => resumeMutation.mutate(activeRun.id),
          busy: resumeMutation.isPending,
          tone: "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
        }
      : {
          label: pick("Pause", "暂停"),
          onClick: () => pauseMutation.mutate(activeRun.id),
          busy: pauseMutation.isPending,
          tone: "border-sky-300 bg-sky-500 text-white hover:bg-sky-600"
        };
  const primaryStatusLabel = needsManualHelp
    ? pick("Needs your help", "等待你处理")
    : isPaused
      ? pick("Paused", "已暂停")
      : pick("Running", "运行中");
  const primaryStatusTone = needsManualHelp
    ? "border-amber-200 bg-amber-50 text-amber-800"
    : isPaused
      ? "border-slate-300 bg-slate-100 text-slate-700"
      : "border-sky-200 bg-sky-50 text-sky-700";
  const summaryText = needsManualHelp
    ? pick(
        `Step #${control.stepIndex ?? 0} stopped intentionally. Finish the blocking page, then resume.`,
        `第 ${control.stepIndex ?? 0} 步已主动停住。请先处理阻塞页面，再继续。`
      )
    : isPaused
      ? pick(
          `Step #${control.stepIndex ?? 0} is paused right now.`,
          `当前停在第 ${control.stepIndex ?? 0} 步。`
        )
      : control.message ??
        pick(
          `Currently working on step #${control.stepIndex ?? 0}.`,
          `当前正在处理第 ${control.stepIndex ?? 0} 步。`
        );
  const pageLabel = activeRun.currentPageTitle ?? activeRun.currentPageUrl ?? activeRun.targetUrl;
  const freshnessLabel = formatRelativeTime(control.lastEventAt, pick("just now", "刚刚"));

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-[rgba(248,250,252,0.96)] backdrop-blur">
      <div className="mx-auto flex max-w-[1640px] flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">
            {pick("Desktop Run Assistant", "桌面运行助手")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-3 py-1 text-xs font-medium shadow-sm ${primaryStatusTone}`}
            >
              {primaryStatusLabel}
            </span>
            <p className="min-w-0 truncate text-sm font-semibold text-slate-900">
              {activeRun.goal}
            </p>
          </div>
          <p className="mt-2 text-sm text-slate-700">{summaryText}</p>
          <p className="mt-1 truncate text-xs text-slate-500">
            {pick(`Current page: ${pageLabel}`, `当前页面：${pageLabel}`)}
            {" · "}
            {pick(`Updated ${freshnessLabel}`, `更新于${freshnessLabel}`)}
            {" · "}
            {phaseLabel}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isOnLivePage ? (
            <Link
              to={liveHref}
                className="console-button-secondary px-3 py-1 text-xs"
            >
              {pick("Open Live", "打开实时页")}
            </Link>
          ) : null}
          {activeRun.headed ? (
            <button
              type="button"
              onClick={() => frontMutation.mutate(activeRun.id)}
              disabled={frontMutation.isPending}
               className="console-button-secondary px-3 py-1 text-xs disabled:opacity-60"
            >
              {frontMutation.isPending
                ? pick("Focusing...", "前置中...")
                : pick("Bring Browser Front", "前置浏览器")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={primaryAction.onClick}
            disabled={primaryAction.busy}
            className={`rounded-full border px-3 py-1 text-xs font-medium shadow-sm transition disabled:opacity-60 ${primaryAction.tone}`}
          >
            {primaryAction.busy ? `${primaryAction.label}...` : primaryAction.label}
          </button>
          <button
            type="button"
            onClick={() => abortMutation.mutate(activeRun.id)}
            disabled={abortMutation.isPending}
            className="console-button-danger px-3 py-1 text-xs disabled:opacity-60"
          >
            {abortMutation.isPending ? pick("Stopping...", "停止中...") : pick("Abort", "停止运行")}
          </button>
        </div>
      </div>
    </div>
  );
};
