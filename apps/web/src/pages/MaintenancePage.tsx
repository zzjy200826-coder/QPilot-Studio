import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BackupOperation, RestorePhase, RestoreVerificationResult } from "@qpilot/shared";
import { useAuth } from "../auth/AuthProvider";
import { useI18n } from "../i18n/I18nProvider";
import { api } from "../lib/api";

const operationTone = (
  status?: BackupOperation["status"]
): "neutral" | "info" | "success" | "warning" | "danger" => {
  switch (status) {
    case "running":
      return "info";
    case "succeeded":
      return "success";
    case "failed":
      return "danger";
    case "queued":
      return "warning";
    default:
      return "neutral";
  }
};

const operationStatusLabel = (
  status: BackupOperation["status"] | undefined,
  pick: (en: string, zh: string) => string
): string => {
  switch (status) {
    case "queued":
      return pick("Queued", "排队中");
    case "running":
      return pick("Running", "执行中");
    case "succeeded":
      return pick("Succeeded", "已完成");
    case "failed":
      return pick("Failed", "失败");
    default:
      return pick("Pending", "等待中");
  }
};

const phaseLabel = (
  phase: RestorePhase | undefined,
  pick: (en: string, zh: string) => string
): string => {
  switch (phase) {
    case "pre_restore_snapshot":
      return pick("Pre-restore snapshot", "创建恢复前救援快照");
    case "download":
      return pick("Download", "下载快照");
    case "decrypt":
      return pick("Decrypt", "解密归档");
    case "extract":
      return pick("Extract", "解压 shared");
    case "swap":
      return pick("Swap", "切换 shared 目录");
    case "restart":
      return pick("Restart", "重启 runtime");
    case "verify":
      return pick("Verify", "平台验收");
    case "rollback":
      return pick("Auto rollback", "自动回滚");
    case "completed":
      return pick("Completed", "已结束");
    default:
      return pick("Preparing", "准备中");
  }
};

const verificationTone = (
  state: RestoreVerificationResult["checks"][number]["state"]
): string => {
  switch (state) {
    case "passed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "skipped":
      return "border-amber-200 bg-amber-50 text-amber-800";
    default:
      return "border-rose-200 bg-rose-50 text-rose-700";
  }
};

const renderVerificationResult = (
  input: {
    title: string;
    result: RestoreVerificationResult;
    pick: (en: string, zh: string) => string;
    formatDateTime: (value?: string | null, emptyText?: string) => string;
  }
) => (
  <article className="console-panel-subtle p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-slate-900">{input.title}</p>
        <p className="mt-1 text-xs text-slate-500">
          {input.pick("Checked at", "检查时间")} {input.formatDateTime(input.result.checkedAt)}
        </p>
      </div>
      <span
        className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${
          input.result.ok
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-rose-200 bg-rose-50 text-rose-700"
        }`}
      >
        {input.result.ok ? input.pick("Passed", "通过") : input.pick("Failed", "失败")}
      </span>
    </div>
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      {input.result.checks.map((check) => (
        <div
          key={`${input.title}-${check.key}-${check.checkedAt}`}
          className={`rounded-[18px] border px-4 py-3 text-sm ${verificationTone(check.state)}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">{check.label}</p>
            <span className="text-[11px] uppercase tracking-[0.18em]">{check.state}</span>
          </div>
          <p className="mt-2 text-xs">{check.detail}</p>
          {typeof check.status === "number" ? (
            <p className="mt-2 text-[11px] uppercase tracking-[0.2em]">HTTP {check.status}</p>
          ) : null}
        </div>
      ))}
    </div>
  </article>
);

export const MaintenancePage = () => {
  const { maintenance, refresh } = useAuth();
  const { formatDateTime, formatRelativeTime, pick } = useI18n();

  const maintenanceQuery = useQuery({
    queryKey: ["runtime", "maintenance"],
    queryFn: () => api.getMaintenanceStatus(),
    refetchInterval: 2_500,
    retry: 1
  });

  const liveMaintenance = maintenanceQuery.data?.maintenance ?? maintenance;
  const operation = maintenanceQuery.data?.operation ?? null;
  const isActive = maintenanceQuery.data?.active ?? liveMaintenance?.active ?? false;
  const phase = liveMaintenance?.phase ?? operation?.detail.phase;
  const verification = operation?.detail.verification;
  const rollbackVerification = operation?.detail.rollbackVerification;
  const latestStep =
    operation?.message ??
    liveMaintenance?.message ??
    pick(
      "The restore controller is still preparing the instance.",
      "恢复控制器仍在准备当前实例。"
    );

  useEffect(() => {
    if (!maintenanceQuery.data || maintenanceQuery.data.active) {
      return;
    }

    const timer = window.setTimeout(() => {
      void refresh().catch(() => {
        window.location.reload();
      });
    }, 900);

    return () => {
      window.clearTimeout(timer);
    };
  }, [maintenanceQuery.data, refresh]);

  const queryError =
    maintenanceQuery.error instanceof Error ? maintenanceQuery.error.message : null;

  const lastCheckedLabel = maintenanceQuery.data?.checkedAt
    ? `${pick("Last checked", "最近检查")} ${formatRelativeTime(maintenanceQuery.data.checkedAt)}`
    : pick("Polling every 2.5 seconds.", "每 2.5 秒自动轮询一次。");

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.12),transparent_24%),linear-gradient(180deg,#eef4f8_0%,#e7edf5_100%)] px-6 py-10 text-slate-900">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.02fr,0.98fr]">
        <section className="console-sidebar overflow-hidden rounded-[32px] p-8">
          <div className="inline-flex items-center rounded-full border border-amber-300/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-100">
            {pick("Maintenance window", "维护窗口")}
          </div>
          <h1 className="mt-6 max-w-xl text-4xl font-semibold tracking-tight text-white">
            {pick(
              "QPilot is temporarily protected while restore and verification are running",
              "QPilot 正在执行恢复与验收任务，当前已进入保护模式"
            )}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
            {liveMaintenance?.message ??
              pick(
                "The runtime is in a planned maintenance window. API traffic is paused until restore, verification, and any rollback work finish.",
                "当前 runtime 处于计划内维护窗口。恢复、验收以及必要的回滚完成前，API 流量会统一暂停。"
              )}
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              {
                title: pick("Current phase", "当前阶段"),
                description: phaseLabel(phase, pick)
              },
              {
                title: pick("Health probe", "健康探针"),
                description: pick(
                  "`/health` keeps responding, while `/health/ready` remains unavailable until the platform is healthy again.",
                  "`/health` 会持续可用，而 `/health/ready` 会在平台重新恢复健康前保持不可用。"
                )
              },
              {
                title: pick("What to do now", "当前建议"),
                description:
                  phase === "rollback"
                    ? pick(
                        "Keep this page open. The controller is attempting to roll back to the rescue snapshot.",
                        "保持此页面打开即可，控制器正在尝试回滚到救援快照。"
                      )
                    : pick(
                        "Keep this page open. The console will reconnect automatically when the platform exits maintenance.",
                        "保持此页面打开即可；平台退出维护后，系统会自动尝试重新连接。"
                      )
              }
            ].map((item) => (
              <article
                key={item.title}
                className="rounded-[22px] border border-white/10 bg-white/6 p-5"
              >
                <h2 className="text-sm font-semibold text-white">{item.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-300">{item.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="console-shell-surface rounded-[32px] p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-data text-[11px] uppercase tracking-[0.28em] text-slate-400">
                {pick("Current restore context", "当前恢复上下文")}
              </p>
              <h2 className="mt-2 text-[1.9rem] font-semibold tracking-tight text-slate-950">
                {pick("Live status from the runtime", "来自 runtime 的实时状态")}
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] ${
                  operationTone(operation?.status) === "success"
                    ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                    : operationTone(operation?.status) === "danger"
                      ? "border border-rose-200 bg-rose-50 text-rose-700"
                      : operationTone(operation?.status) === "info"
                        ? "border border-sky-200 bg-sky-50 text-sky-700"
                        : "border border-amber-200 bg-amber-50 text-amber-700"
                }`}
              >
                {isActive
                  ? operationStatusLabel(operation?.status, pick)
                  : pick("Reconnecting", "重新连接中")}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-slate-600">
                {phaseLabel(phase, pick)}
              </span>
            </div>
          </div>

          {!isActive ? (
            <div className="mt-6 rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700">
              {pick(
                "Maintenance marker cleared. Reconnecting you to the workspace now...",
                "维护标记已清除，正在把你重新连接回工作区..."
              )}
            </div>
          ) : null}

          {queryError ? (
            <div className="mt-6 rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
              {queryError}
            </div>
          ) : null}

          <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50/80 p-5">
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">
              {pick("Latest step", "最新阶段")}
            </p>
            <p className="mt-3 text-sm font-semibold leading-6 text-slate-900">{latestStep}</p>
            <p className="mt-2 text-xs text-slate-500">{lastCheckedLabel}</p>
            {phase === "rollback" ? (
              <p className="mt-3 text-sm text-amber-800">
                {pick(
                  "The controller is attempting to roll back to the pre-restore rescue snapshot.",
                  "控制器正在尝试回滚到恢复前生成的救援快照。"
                )}
              </p>
            ) : null}
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {[
              {
                title: pick("Operation", "操作"),
                value: liveMaintenance?.operationId ?? "--"
              },
              {
                title: pick("Snapshot", "快照"),
                value: liveMaintenance?.snapshotId ?? "--"
              },
              {
                title: pick("Entered at", "进入时间"),
                value: liveMaintenance?.createdAt
                  ? formatDateTime(liveMaintenance.createdAt)
                  : pick("Unknown", "未知")
              },
              {
                title: pick("Phase updated", "阶段更新时间"),
                value: liveMaintenance?.phaseUpdatedAt
                  ? formatDateTime(liveMaintenance.phaseUpdatedAt)
                  : pick("Unknown", "未知")
              }
            ].map((item) => (
              <article
                key={item.title}
                className="rounded-3xl border border-slate-200 bg-slate-50/80 p-5"
              >
                <p className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">
                  {item.title}
                </p>
                <p className="mt-3 text-sm font-semibold text-slate-900">{item.value}</p>
              </article>
            ))}
          </div>
        </section>
      </div>

      <div className="mx-auto mt-8 max-w-6xl space-y-6">
        {verification
          ? renderVerificationResult({
              title: pick("Latest restore verification", "最近一次恢复验收"),
              result: verification,
              pick,
              formatDateTime
            })
          : null}
        {rollbackVerification
          ? renderVerificationResult({
              title: pick("Latest auto rollback verification", "最近一次自动回滚验收"),
              result: rollbackVerification,
              pick,
              formatDateTime
            })
          : null}

        <div className="rounded-[32px] border border-slate-200/80 bg-white p-8 shadow-[0_20px_60px_rgba(15,23,42,0.10)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-500">
                {pick("Manual controls", "手动控制")}
              </p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
                {pick("Poll and keep watching", "继续观察状态")}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => {
                void maintenanceQuery.refetch();
              }}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
            >
              {pick("Poll status", "刷新状态")}
            </button>
          </div>

          <p className="mt-4 text-sm leading-7 text-slate-600">
            {pick(
              "If this page stays longer than expected, the runtime may still be restarting, running platform smoke verification, or waiting for rollback recovery checks.",
              "如果这个页面停留时间明显超出预期，说明 runtime 可能仍在重启、执行平台验收，或等待回滚恢复检查完成。"
            )}
          </p>
        </div>
      </div>
    </div>
  );
};
