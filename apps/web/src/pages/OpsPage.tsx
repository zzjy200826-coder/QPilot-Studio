import { useQuery } from "@tanstack/react-query";
import type {
  BackupHealthSummary,
  OpsAlertEvent,
  OpsDependencyStatus
} from "@qpilot/shared";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useI18n } from "../i18n/I18nProvider";
import { api, ApiError } from "../lib/api";
import { PlatformBadge } from "../platform/PlatformBadge";
import { usePlatformDensity } from "../platform/PlatformDensity";
import { PlatformEmptyState } from "../platform/PlatformEmptyState";
import { PlatformErrorBanner } from "../platform/PlatformErrorBanner";
import { PlatformMetricCard } from "../platform/PlatformMetricCard";
import { PlatformPageShell } from "../platform/PlatformPageShell";
import { PlatformSectionHeader } from "../platform/PlatformSectionHeader";

const dependencyTone = (
  state: OpsDependencyStatus["state"]
): "success" | "warning" | "danger" | "neutral" => {
  switch (state) {
    case "ready":
      return "success";
    case "warning":
      return "warning";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
};

const alertTone = (
  severity: OpsAlertEvent["severity"]
): "neutral" | "warning" | "danger" => {
  switch (severity) {
    case "critical":
      return "danger";
    case "warning":
      return "warning";
    default:
      return "neutral";
  }
};

const backupHealthTone = (
  state: BackupHealthSummary["state"]
): "success" | "warning" | "danger" | "neutral" => {
  switch (state) {
    case "ready":
      return "success";
    case "warning":
      return "warning";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
};

const dependencyStateLabel = (
  state: OpsDependencyStatus["state"],
  language: "en" | "zh-CN"
): string => {
  if (language !== "zh-CN") {
    return state.replace(/_/g, " ");
  }

  switch (state) {
    case "ready":
      return "就绪";
    case "warning":
      return "警告";
    case "failed":
      return "失败";
    case "disabled":
      return "未启用";
    default:
      return state;
  }
};

const backupHealthStateLabel = (
  state: BackupHealthSummary["state"],
  language: "en" | "zh-CN"
): string => {
  if (language !== "zh-CN") {
    return state.replace(/_/g, " ");
  }

  switch (state) {
    case "ready":
      return "健康";
    case "warning":
      return "告警";
    case "failed":
      return "失败";
    case "not_configured":
      return "未配置";
    default:
      return state;
  }
};

const alertStatusLabel = (
  status: OpsAlertEvent["status"],
  language: "en" | "zh-CN"
): string => {
  if (language !== "zh-CN") {
    return status.toUpperCase();
  }

  return status === "active" ? "生效中" : "已恢复";
};

const alertSeverityLabel = (
  severity: OpsAlertEvent["severity"],
  language: "en" | "zh-CN"
): string => {
  if (language !== "zh-CN") {
    return severity.toUpperCase();
  }

  switch (severity) {
    case "critical":
      return "严重";
    case "warning":
      return "警告";
    default:
      return "提示";
  }
};

const renderValue = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "object" && value) {
    return JSON.stringify(value);
  }
  return String(value);
};

export const OpsPage = () => {
  const { auth } = useAuth();
  const { isDense } = usePlatformDensity();
  const { formatDateTime, formatRelativeTime, language, pick } = useI18n();

  const summaryQuery = useQuery({
    queryKey: ["platform", "ops", "summary"],
    queryFn: () => api.getOpsSummary()
  });

  const summary = summaryQuery.data;
  const backupCheckMap = new Map(
    (summary?.backupHealth.checks ?? []).map((check) => [check.key, check])
  );
  const failureMessages = summary
    ? [
        ...summary.readiness.failedComponents.map((component) =>
          pick(`Readiness failed: ${component}`, `就绪检查失败：${component}`)
        ),
        ...summary.readiness.warnings.map((component) =>
          pick(`Warning: ${component}`, `告警提示：${component}`)
        )
      ]
    : [];
  const queryError =
    summaryQuery.error instanceof ApiError && summaryQuery.error.status === 403
      ? pick(
          "Ops summary is available to tenant owners only.",
          "运维摘要目前只对当前租户的 owner 开放。"
        )
      : summaryQuery.error instanceof Error
        ? summaryQuery.error.message
        : null;

  return (
    <PlatformPageShell
      dense={isDense}
      accent="emerald"
      badge={
        <PlatformBadge tone={summary?.readiness.ready ? "success" : "danger"} uppercase>
          {summary?.readiness.ready
            ? pick("Ready", "已就绪")
            : pick("Attention Needed", "需要处理")}
        </PlatformBadge>
      }
      projectLabel={
        auth ? (
          <PlatformBadge tone="neutral">
            {pick("Owner scope", "Owner 视角")} · {auth.tenant.name}
          </PlatformBadge>
        ) : null
      }
      title={pick("Runtime Operations & Observability", "运行基建与可观测摘要")}
      actions={
        <div className="flex flex-wrap gap-2 text-sm text-slate-600">
          <Link
            to="/platform/ops/deploy"
            className="console-button-subtle text-sm"
          >
            {pick("Open deploy center", "打开 Deploy Center")}
          </Link>
          <Link
            to="/platform/ops/backups"
            className="console-button-subtle text-sm"
          >
            {pick("Open backups", "打开备份")}
          </Link>
          <span className="console-data-pill px-3 py-2">
            {pick("Generated", "生成时间")} {summary ? formatDateTime(summary.generatedAt) : "--"}
          </span>
          <span className="console-data-pill px-3 py-2">
            {pick("Readiness checked", "就绪检查")}{" "}
            {summary ? formatRelativeTime(summary.readiness.checkedAt) : "--"}
          </span>
        </div>
      }
      metrics={
        <>
          <PlatformMetricCard
            dense={isDense}
            label={pick("Ready", "就绪")}
            value={summary?.readiness.ready ? pick("Yes", "是") : pick("No", "否")}
          />
          <PlatformMetricCard
            dense={isDense}
            label={pick("Queue backlog", "队列积压")}
            value={
              summary
                ? summary.queueHealth.counts.waiting + summary.queueHealth.counts.delayed
                : "--"
            }
          />
          <PlatformMetricCard
            dense={isDense}
            label={pick("Recent alerts", "最近告警")}
            value={summary?.recentAlerts.length ?? "--"}
          />
          <PlatformMetricCard
            dense={isDense}
            label={pick("Backup health", "备份健康")}
            value={
              summary
                ? backupHealthStateLabel(summary.backupHealth.state, language)
                : "--"
            }
          />
        </>
      }
    >
      <div className={isDense ? "space-y-4" : "space-y-6"}>
        <PlatformErrorBanner
          messages={[...(queryError ? [queryError] : []), ...failureMessages]}
        />

        <section className="console-panel p-5">
          <PlatformSectionHeader
            dense={isDense}
            eyebrow={pick("Runtime readiness", "运行就绪")}
            title={pick("Liveness stays shallow, readiness stays honest", "存活探针轻量，就绪探针说真话")}
            description={pick(
              "This view reports whether the runtime can safely accept traffic right now.",
              "这里展示的是 runtime 当前是否真的适合接流量，而不只是进程还活着。"
            )}
          />

          <div className={`mt-5 grid gap-4 ${isDense ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}>
            <PlatformMetricCard
              dense={isDense}
              label={pick("Current state", "当前状态")}
              value={summary?.readiness.ready ? pick("Ready", "已就绪") : pick("Not ready", "未就绪")}
            />
            <PlatformMetricCard
              dense={isDense}
              label={pick("Failed components", "失败组件")}
              value={summary?.readiness.failedComponents.length ?? "--"}
            />
            <PlatformMetricCard
              dense={isDense}
              label={pick("Warnings", "警告数")}
              value={summary?.readiness.warnings.length ?? "--"}
            />
            <PlatformMetricCard
              dense={isDense}
              label={pick("Last check", "最近检查")}
              value={summary ? formatRelativeTime(summary.readiness.checkedAt) : "--"}
            />
          </div>
        </section>

        <section className="console-panel p-5">
          <PlatformSectionHeader
            dense={isDense}
            eyebrow={pick("Backup health", "备份健康")}
            title={pick(
              "Freshness, scheduler status, storage reachability, and last failure",
              "备份窗口、调度状态、存储可达性与最近失败"
            )}
            description={pick(
              "Use this to confirm the instance is still producing encrypted backups on schedule and that the timer, storage, and execution path are all healthy.",
              "这里用来确认实例是否仍在按计划产出加密备份，以及 timer、存储和执行链路是否都健康。"
            )}
          />

          <div className={`mt-5 grid gap-4 ${isDense ? "lg:grid-cols-4" : "lg:grid-cols-4"}`}>
            <PlatformMetricCard
              dense={isDense}
              label={pick("Overall state", "整体状态")}
              value={
                summary
                  ? backupHealthStateLabel(summary.backupHealth.state, language)
                  : "--"
              }
            />
            <PlatformMetricCard
              dense={isDense}
              label={pick("Last success", "最近成功")}
              value={
                summary?.backupHealth.lastSuccessfulBackupAt
                  ? formatRelativeTime(summary.backupHealth.lastSuccessfulBackupAt)
                  : pick("No successful backup yet", "尚无成功备份")
              }
            />
            <PlatformMetricCard
              dense={isDense}
              label={pick("Next run", "下次调度")}
              value={
                summary?.backupHealth.scheduler.nextTriggerAt
                  ? formatDateTime(summary.backupHealth.scheduler.nextTriggerAt)
                  : pick("No next trigger", "暂无下一次触发")
              }
            />
            <PlatformMetricCard
              dense={isDense}
              label={pick("Latest failed operation", "最近失败操作")}
              value={summary?.backupHealth.lastFailedOperation?.operationId ?? pick("None", "无")}
            />
          </div>

          {summary ? (
            <>
              <div className="mt-4 flex flex-wrap gap-2">
                {(["config", "storage", "freshness", "scheduler"] as const).map((key) => {
                  const check = backupCheckMap.get(key);
                  if (!check) {
                    return null;
                  }
                  return (
                    <PlatformBadge key={key} tone={backupHealthTone(check.state)}>
                      {key}: {backupHealthStateLabel(check.state, language)}
                    </PlatformBadge>
                  );
                })}
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <article className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <PlatformBadge tone={backupHealthTone(summary.backupHealth.state)}>
                      {backupHealthStateLabel(summary.backupHealth.state, language)}
                    </PlatformBadge>
                    {summary.backupHealth.scheduler.supported ? (
                      <PlatformBadge
                        tone={summary.backupHealth.scheduler.enabled ? "success" : "warning"}
                      >
                        {summary.backupHealth.scheduler.enabled
                          ? pick("Timer enabled", "Timer 已启用")
                          : pick("Timer disabled", "Timer 未启用")}
                      </PlatformBadge>
                    ) : (
                      <PlatformBadge tone="warning">
                        {pick("No systemd probe", "无 systemd 探测")}
                      </PlatformBadge>
                    )}
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-slate-950">
                    {pick("Scheduler and storage summary", "调度与存储摘要")}
                  </h3>
                  <p className="mt-2 text-sm text-slate-600">
                    {summary.backupHealth.scheduler.detail ?? pick("No scheduler detail.", "暂无调度详情。")}
                  </p>
                  <div className="mt-3 grid gap-2 text-sm text-slate-600">
                    <p>
                      {pick("Storage", "存储")}: {backupCheckMap.get("storage")?.detail ?? "--"}
                    </p>
                    <p>
                      {pick("Freshness", "新鲜度")}: {backupCheckMap.get("freshness")?.detail ?? "--"}
                    </p>
                    <p>
                      {pick("Next trigger", "下一次触发")}:{" "}
                      {summary.backupHealth.scheduler.nextTriggerAt
                        ? formatDateTime(summary.backupHealth.scheduler.nextTriggerAt)
                        : pick("Unavailable", "不可用")}
                    </p>
                  </div>
                </article>

                <article className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
                  <h3 className="text-base font-semibold text-slate-950">
                    {pick("Latest failure and evidence", "最近失败与证据")}
                  </h3>
                  {summary.backupHealth.lastFailedOperation ? (
                    <div className="mt-3 space-y-2 text-sm text-slate-600">
                      <p>
                        {pick("Operation", "操作")}: {summary.backupHealth.lastFailedOperation.operationId}
                      </p>
                      <p>
                        {pick("Updated", "更新时间")}: {formatDateTime(summary.backupHealth.lastFailedOperation.updatedAt)}
                      </p>
                      <p>
                        {pick("Snapshot", "快照")}: {summary.backupHealth.lastFailedOperation.snapshotId ?? "--"}
                      </p>
                      <p className="text-rose-700">
                        {summary.backupHealth.lastFailedOperation.error}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-slate-600">
                      {pick(
                        "No failed backup operation is currently blocking the instance.",
                        "当前没有失败中的备份操作在阻塞这台实例。"
                      )}
                    </p>
                  )}
                </article>
              </div>
            </>
          ) : null}
        </section>

        <section className="console-panel p-5">
          <PlatformSectionHeader
            dense={isDense}
            eyebrow={pick("Dependencies", "依赖检查")}
            title={pick("SQLite, filesystem, queue, metrics, and AI services", "SQLite、文件系统、队列、监控与 AI 服务")}
            description={pick(
              "Hard dependencies can fail readiness. Soft dependencies show up as warnings so we can still see degraded states.",
              "硬依赖会直接影响 readiness，软依赖则以 warning 记录，方便看到降级而不阻塞服务。"
            )}
          />

          <div className={`mt-5 grid gap-4 ${isDense ? "md:grid-cols-2 xl:grid-cols-3" : "lg:grid-cols-3"}`}>
            {summary?.dependencies.map((dependency) => (
              <article
                key={dependency.key}
                className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <PlatformBadge tone={dependencyTone(dependency.state)}>
                    {dependencyStateLabel(dependency.state, language)}
                  </PlatformBadge>
                  {dependency.required ? (
                    <PlatformBadge tone="neutral">
                      {pick("Required", "硬依赖")}
                    </PlatformBadge>
                  ) : (
                    <PlatformBadge tone="info">
                      {pick("Optional", "软依赖")}
                    </PlatformBadge>
                  )}
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-950">{dependency.label}</h3>
                <p className="mt-2 text-sm text-slate-600">{dependency.detail}</p>
                {dependency.endpoint ? (
                  <p className="mt-3 text-xs text-slate-500 break-all">{dependency.endpoint}</p>
                ) : null}
                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  <span>
                    {pick("Checked", "检查时间")} {formatRelativeTime(dependency.checkedAt)}
                  </span>
                  <span>
                    {pick("Latency", "延迟")}{" "}
                    {typeof dependency.latencyMs === "number"
                      ? `${dependency.latencyMs} ms`
                      : pick("n/a", "无")}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="console-panel p-5">
          <PlatformSectionHeader
            dense={isDense}
            eyebrow={pick("Load queue health", "压测队列健康")}
            title={pick("Queue pressure and worker heartbeat", "队列压力与 worker 心跳")}
            description={pick(
              "Use this to spot backlog accumulation, active work, and stale workers before load execution stalls.",
              "这里用来观察积压、执行中任务和 stale worker，避免压测执行悄悄卡住。"
            )}
          />

          <div className={`mt-5 grid gap-4 ${isDense ? "lg:grid-cols-5" : "lg:grid-cols-5"}`}>
            <PlatformMetricCard
              dense={isDense}
              label={pick("Waiting", "等待中")}
              value={summary?.queueHealth.counts.waiting ?? "--"}
            />
            <PlatformMetricCard
              dense={isDense}
              label={pick("Delayed", "延迟中")}
              value={summary?.queueHealth.counts.delayed ?? "--"}
            />
            <PlatformMetricCard
              dense={isDense}
              label={pick("Running", "执行中")}
              value={summary?.queueHealth.counts.active ?? "--"}
            />
            <PlatformMetricCard
              dense={isDense}
              label={pick("Busy workers", "繁忙 worker")}
              value={summary?.queueHealth.workerHealth.busyWorkers ?? "--"}
            />
            <PlatformMetricCard
              dense={isDense}
              label={pick("Stale workers", "超时 worker")}
              value={summary?.queueHealth.workerHealth.staleWorkers ?? "--"}
            />
          </div>

          {summary ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <p>{summary.queueHealth.detail}</p>
              <p className="mt-2 text-xs text-slate-500">
                {pick("Last queue sample", "最近队列采样")} {formatDateTime(summary.queueHealth.checkedAt)}
              </p>
            </div>
          ) : null}
        </section>

        <section className="console-panel p-5">
          <PlatformSectionHeader
            dense={isDense}
            eyebrow={pick("Release risk", "发布风险")}
            title={pick("Recent hold verdicts and blocker pressure", "最近 hold 结论与 blocker 压力")}
            description={pick(
              "This keeps release governance visible without opening Gate Center first.",
              "不进入 Gate Center，也能先看到最近发布风险有没有抬头。"
            )}
          />

          <div className={`mt-5 grid gap-4 ${isDense ? "lg:grid-cols-3" : "lg:grid-cols-3"}`}>
            <PlatformMetricCard
              dense={isDense}
              label={pick("Hold verdicts", "Hold 结论")}
              value={summary?.releaseRisk.holdVerdictsLast24h ?? "--"}
            />
            <PlatformMetricCard
              dense={isDense}
              label={pick("Pending blockers", "待处理 blocker")}
              value={summary?.releaseRisk.pendingBlockers ?? "--"}
            />
            <PlatformMetricCard
              dense={isDense}
              label={pick("Window", "统计窗口")}
              value={
                summary
                  ? pick(
                      `${summary.releaseRisk.lookbackMinutes} min`,
                      `${summary.releaseRisk.lookbackMinutes} 分钟`
                    )
                  : "--"
              }
            />
          </div>
        </section>

        <section className="console-panel p-5">
          <PlatformSectionHeader
            dense={isDense}
            eyebrow={pick("Recent alerts", "最近告警")}
            title={pick("Webhook delivery and recovery trail", "Webhook 投递与恢复轨迹")}
            description={pick(
              "Alerts persist in the runtime so we can inspect trigger, resolution, and delivery errors from one place.",
              "告警事件会落库，这里能同时看到触发、恢复和 webhook 投递错误。"
            )}
          />

          {summary?.recentAlerts.length ? (
            <div className="mt-5 space-y-3">
              {summary.recentAlerts.map((alert) => (
                <article
                  key={alert.id}
                  className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <PlatformBadge tone={alertTone(alert.severity)}>
                      {alertSeverityLabel(alert.severity, language)}
                    </PlatformBadge>
                    <PlatformBadge tone={alert.status === "active" ? "danger" : "success"}>
                      {alertStatusLabel(alert.status, language)}
                    </PlatformBadge>
                    <PlatformBadge tone="neutral">{alert.ruleKey}</PlatformBadge>
                  </div>
                  <h3 className="mt-3 text-base font-semibold text-slate-950">{alert.summary}</h3>
                  <div className="mt-3 grid gap-3 text-sm text-slate-600 md:grid-cols-2">
                    <p>
                      {pick("First triggered", "首次触发")} {formatDateTime(alert.firstTriggeredAt)}
                    </p>
                    <p>
                      {pick("Last triggered", "最近触发")} {formatRelativeTime(alert.lastTriggeredAt)}
                    </p>
                    <p>
                      {pick("Last delivered", "最近投递")}{" "}
                      {alert.lastDeliveredAt
                        ? formatDateTime(alert.lastDeliveredAt)
                        : pick("Not delivered yet", "尚未投递")}
                    </p>
                    <p>
                      {pick("Delivery error", "投递错误")}{" "}
                      {alert.lastDeliveryError ?? pick("None", "无")}
                    </p>
                  </div>
                  {Object.keys(alert.detail).length ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {Object.entries(alert.detail).map(([key, value]) => (
                        <span
                          key={`${alert.id}-${key}`}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600"
                        >
                          {key}: {renderValue(value)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-5">
              <PlatformEmptyState
                message={pick(
                  "No persisted alerts yet. Once rules trigger, webhook delivery and recovery history will appear here.",
                  "当前还没有持久化告警。规则触发后，webhook 投递和恢复记录会出现在这里。"
                )}
              />
            </div>
          )}
        </section>
      </div>
    </PlatformPageShell>
  );
};
