import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BackupConfigStatus,
  BackupHealthSummary,
  BackupOperation,
  BackupOperationDetail,
  BackupPreflightCheckStatus,
  BackupPreflightResult,
  BackupSnapshot,
  RestorePhase,
  RestoreVerificationResult
} from "@qpilot/shared";
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

const formatBytes = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const toneForOperation = (
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

const toneForVerificationState = (
  state: RestoreVerificationResult["checks"][number]["state"]
): "success" | "warning" | "danger" => {
  switch (state) {
    case "passed":
      return "success";
    case "skipped":
      return "warning";
    default:
      return "danger";
  }
};

const toneForPreflight = (
  status: BackupPreflightCheckStatus
): "success" | "warning" | "danger" => {
  switch (status) {
    case "passed":
      return "success";
    case "warning":
      return "warning";
    default:
      return "danger";
  }
};

const toneForBackupHealth = (
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

const healthLabel = (
  state: BackupHealthSummary["state"],
  pick: (en: string, zh: string) => string
): string => {
  switch (state) {
    case "ready":
      return pick("Healthy", "健康");
    case "warning":
      return pick("Warning", "告警");
    case "failed":
      return pick("Failed", "失败");
    default:
      return pick("Not configured", "未配置");
  }
};

const snapshotKindLabel = (
  kind: BackupSnapshot["kind"],
  pick: (en: string, zh: string) => string
): string => {
  switch (kind) {
    case "scheduled":
      return pick("Scheduled", "定时");
    case "manual":
      return pick("Manual", "手动");
    default:
      return pick("Pre-restore", "恢复前救援");
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
      return pick("Idle", "空闲");
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
      return pick("Rollback", "自动回滚");
    case "completed":
      return pick("Completed", "已结束");
    default:
      return pick("Not started", "尚未开始");
  }
};

const restoreOutcomeLabel = (
  operation: BackupOperation,
  pick: (en: string, zh: string) => string
): string => {
  if (operation.status === "succeeded") {
    return pick("Restore succeeded", "恢复成功");
  }
  if (operation.detail.rollbackSucceeded === true) {
    return pick(
      "Restore failed, auto rollback succeeded",
      "恢复失败，但自动回滚已成功"
    );
  }
  if (operation.detail.rollbackSucceeded === false) {
    return pick(
      "Restore failed, auto rollback failed",
      "恢复失败，且自动回滚也失败"
    );
  }
  return pick("Restore failed", "恢复失败");
};

const renderVerificationCard = (
  input: {
    title: string;
    result: RestoreVerificationResult;
    dense: boolean;
    pick: (en: string, zh: string) => string;
    formatDateTime: (value?: string | null, emptyText?: string) => string;
  }
) => (
  <article className="rounded-3xl border border-slate-200 bg-slate-50/80 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-slate-900">{input.title}</p>
        <p className="mt-1 text-xs text-slate-500">
          {input.pick("Checked at", "检查时间")} {input.formatDateTime(input.result.checkedAt)}
        </p>
      </div>
      <PlatformBadge tone={input.result.ok ? "success" : "danger"}>
        {input.result.ok ? input.pick("Passed", "通过") : input.pick("Failed", "失败")}
      </PlatformBadge>
    </div>
    <div className={`mt-4 grid gap-3 ${input.dense ? "" : "md:grid-cols-2"}`}>
      {input.result.checks.map((check) => (
        <div
          key={`${input.title}-${check.key}-${check.checkedAt}`}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-900">{check.label}</p>
            <PlatformBadge tone={toneForVerificationState(check.state)}>
              {check.state}
            </PlatformBadge>
          </div>
          <p className="mt-2 text-xs text-slate-500">{check.detail}</p>
          {typeof check.status === "number" ? (
            <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-slate-400">
              HTTP {check.status}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  </article>
);

export const BackupsPage = () => {
  const { auth } = useAuth();
  const { isDense } = usePlatformDensity();
  const { language, pick, formatDateTime, formatRelativeTime } = useI18n();
  const queryClient = useQueryClient();
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [preflightResult, setPreflightResult] = useState<BackupPreflightResult | null>(null);
  const [pendingOperationId, setPendingOperationId] = useState<string | null>(null);
  const [localMessage, setLocalMessage] = useState<string | null>(null);

  const configQuery = useQuery({
    queryKey: ["platform", "ops", "backups", "config"],
    queryFn: () => api.getBackupConfigStatus(),
    refetchInterval: (query) =>
      query.state.data?.activeOperation || pendingOperationId ? 3_000 : false
  });
  const snapshotsQuery = useQuery({
    queryKey: ["platform", "ops", "backups", "snapshots"],
    queryFn: () => api.listBackupSnapshots(),
    refetchInterval: configQuery.data?.activeOperation || pendingOperationId ? 5_000 : false
  });
  const operationQuery = useQuery({
    queryKey: ["platform", "ops", "backups", "operation", pendingOperationId],
    queryFn: () => api.getBackupOperation(pendingOperationId!),
    enabled: Boolean(pendingOperationId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "succeeded" || status === "failed" ? false : 3_000;
    }
  });

  useEffect(() => {
    const operation = operationQuery.data;
    if (!operation) {
      return;
    }
    if (operation.status === "succeeded" || operation.status === "failed") {
      setLocalMessage(
        operation.type === "restore"
          ? restoreOutcomeLabel(operation, pick)
          : operation.status === "succeeded"
            ? pick("Backup operation finished.", "备份操作已完成。")
            : operation.error ?? pick("Backup operation failed.", "备份操作失败。")
      );
      setPendingOperationId(null);
      void queryClient.invalidateQueries({
        queryKey: ["platform", "ops", "backups"]
      });
    }
  }, [operationQuery.data, pick, queryClient]);

  const runBackupMutation = useMutation({
    mutationFn: () => api.runBackupNow(),
    onSuccess: (operation) => {
      setPendingOperationId(operation.id);
      setLocalMessage(pick("Backup job queued. Polling operation status...", "备份任务已入队，正在轮询执行状态。"));
      void queryClient.invalidateQueries({
        queryKey: ["platform", "ops", "backups", "config"]
      });
    },
    onError: (error) => {
      setLocalMessage(error instanceof Error ? error.message : String(error));
    }
  });

  const previewRestoreMutation = useMutation({
    mutationFn: (snapshotId: string) => api.previewBackupRestore(snapshotId),
    onSuccess: (result) => {
      setPreflightResult(result);
      setLocalMessage(
        result.ok
          ? pick("Restore preflight passed.", "恢复预检查已通过。")
          : pick("Restore preflight found blockers.", "恢复预检查发现阻塞项。")
      );
    },
    onError: (error) => {
      setLocalMessage(error instanceof Error ? error.message : String(error));
    }
  });

  const startRestoreMutation = useMutation({
    mutationFn: (snapshotId: string) => api.startBackupRestore(snapshotId),
    onSuccess: (operation) => {
      setPendingOperationId(operation.id);
      setLocalMessage(
        pick(
          "Restore operation queued. The runtime will enter a maintenance window during restore and verification.",
          "恢复任务已入队。恢复和验收期间 runtime 会进入维护窗口。"
        )
      );
      void queryClient.invalidateQueries({
        queryKey: ["platform", "ops", "backups", "config"]
      });
    },
    onError: (error) => {
      setLocalMessage(error instanceof Error ? error.message : String(error));
    }
  });

  const config = configQuery.data ?? null;
  const snapshots = snapshotsQuery.data ?? [];
  const selectedSnapshot = useMemo(
    () => snapshots.find((snapshot) => snapshot.snapshotId === selectedSnapshotId) ?? null,
    [selectedSnapshotId, snapshots]
  );
  const activeOperation = operationQuery.data ?? config?.activeOperation ?? null;
  const operationDetail: BackupOperationDetail | null = activeOperation?.detail ?? null;
  const healthSummary = config?.health ?? null;
  const restoreHistory = config?.restoreHistory ?? [];
  const configCheck = healthSummary?.checks.find((check) => check.key === "config") ?? null;
  const storageCheck = healthSummary?.checks.find((check) => check.key === "storage") ?? null;
  const freshnessCheck = healthSummary?.checks.find((check) => check.key === "freshness") ?? null;
  const schedulerCheck = healthSummary?.checks.find((check) => check.key === "scheduler") ?? null;
  const latestFailedOperation = healthSummary?.lastFailedOperation ?? null;

  const queryError =
    configQuery.error instanceof ApiError && configQuery.error.status === 403
      ? pick("Backup operations are available to tenant owners only.", "备份与恢复仅对当前租户的 owner 开放。")
      : configQuery.error instanceof Error
        ? configQuery.error.message
        : snapshotsQuery.error instanceof Error
          ? snapshotsQuery.error.message
          : null;

  const primaryError =
    localMessage &&
    (localMessage.toLowerCase().includes("failed") ||
      localMessage.includes("失败") ||
      localMessage.toLowerCase().includes("error"))
      ? localMessage
      : queryError;
  const statusMessage = localMessage && localMessage !== primaryError ? localMessage : null;
  const statusToneClass =
    preflightResult?.ok || operationQuery.data?.status === "succeeded"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-sky-200 bg-sky-50 text-sky-700";

  return (
    <PlatformPageShell
      dense={isDense}
      accent="emerald"
      badge={
        <PlatformBadge tone={healthSummary ? toneForBackupHealth(healthSummary.state) : "neutral"} uppercase>
          {healthSummary ? healthLabel(healthSummary.state, pick) : pick("Checking", "检查中")}
        </PlatformBadge>
      }
      projectLabel={
        auth ? (
          <PlatformBadge tone="neutral">
            {pick("Owner scope", "Owner 视角")} · {auth.tenant.name}
          </PlatformBadge>
        ) : null
      }
      title={pick("Instance Backups & Restore", "实例级备份与恢复")}
      actions={
        <>
          <button
            type="button"
            onClick={() => runBackupMutation.mutate()}
            disabled={!config?.configured || runBackupMutation.isPending}
            className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {runBackupMutation.isPending
              ? pick("Queuing backup...", "正在创建备份...")
              : pick("Run backup now", "立即备份")}
          </button>
          <button
            type="button"
            onClick={() => selectedSnapshot && previewRestoreMutation.mutate(selectedSnapshot.snapshotId)}
            disabled={!selectedSnapshot || previewRestoreMutation.isPending}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {previewRestoreMutation.isPending
              ? pick("Checking restore...", "正在检查恢复...")
              : pick("Preview restore", "预检查恢复")}
          </button>
          <button
            type="button"
            onClick={() => selectedSnapshot && startRestoreMutation.mutate(selectedSnapshot.snapshotId)}
            disabled={!selectedSnapshot || startRestoreMutation.isPending}
            className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 transition hover:border-amber-300 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {startRestoreMutation.isPending
              ? pick("Starting restore...", "正在启动恢复...")
              : pick("Start restore", "开始恢复")}
          </button>
        </>
      }
      metrics={
        <>
          <PlatformMetricCard
            dense={isDense}
            label={pick("Snapshots", "快照总数")}
            value={snapshots.length}
          />
          <PlatformMetricCard
            dense={isDense}
            label={pick("Active operation", "当前操作")}
            value={operationStatusLabel(activeOperation?.status, pick)}
          />
          <PlatformMetricCard
            dense={isDense}
            label={pick("Last successful backup", "最近成功备份")}
            value={
              config?.lastSuccessfulBackupAt
                ? formatRelativeTime(config.lastSuccessfulBackupAt)
                : pick("Never", "暂无")
            }
          />
        </>
      }
    >
      <div className={isDense ? "space-y-4" : "space-y-6"}>
        <PlatformErrorBanner messages={primaryError ? [primaryError] : []} />
        {statusMessage ? (
          <div role="status" className={`rounded-2xl border px-4 py-3 text-sm ${statusToneClass}`}>
            {statusMessage}
          </div>
        ) : null}

        <section className="console-panel p-5">
          <PlatformSectionHeader
            dense={isDense}
            eyebrow={pick("Backup config", "备份配置")}
            title={pick("Storage, encryption, and backup health", "存储、加密与备份健康面")}
            description={pick(
              "This section explains whether the instance can create encrypted shared-directory backups right now.",
              "这里展示当前实例是否已经具备创建加密 shared 全量备份的条件。"
            )}
          />
          {config ? (
            <div className={`mt-5 grid gap-4 ${isDense ? "" : "lg:grid-cols-[1.1fr,0.9fr,0.9fr]"}`}>
              <article className="rounded-3xl border border-slate-200 bg-slate-50/80 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {pick("Configuration and storage", "配置与存储")}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {pick("S3 reachability and application-layer encryption", "S3 连通性与应用层加密")}
                    </p>
                  </div>
                  <PlatformBadge tone={healthSummary ? toneForBackupHealth(healthSummary.state) : "neutral"}>
                    {healthSummary ? healthLabel(healthSummary.state, pick) : pick("Unknown", "未知")}
                  </PlatformBadge>
                </div>
                <dl className="mt-4 space-y-2 text-sm text-slate-600">
                  <div className="flex justify-between gap-4">
                    <dt>{pick("Configured", "已配置")}</dt>
                    <dd>{config.configured ? pick("Yes", "是") : pick("No", "否")}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>{pick("Bucket", "Bucket")}</dt>
                    <dd>{config.bucket ?? "--"}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>{pick("Prefix", "前缀")}</dt>
                    <dd>{config.prefix}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>{pick("Encryption", "加密状态")}</dt>
                    <dd>
                      {config.encryptionConfigured
                        ? pick("AES-256-GCM ready", "AES-256-GCM 已就绪")
                        : pick("Missing key", "缺少密钥")}
                    </dd>
                  </div>
                </dl>
                {configCheck ? (
                  <p className="mt-4 text-xs text-slate-500">{configCheck.detail}</p>
                ) : null}
                {storageCheck ? (
                  <p className="mt-2 text-xs text-slate-500">{storageCheck.detail}</p>
                ) : null}
              </article>

              <article className="rounded-3xl border border-slate-200 bg-slate-50/80 p-5">
                <p className="text-sm font-semibold text-slate-900">
                  {pick("Scheduler and freshness", "调度与新鲜度")}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {pick(
                    "How the daily backup timer and snapshot freshness currently look.",
                    "这里展示每日定时备份和最近一次成功快照的新鲜度。"
                  )}
                </p>
                <dl className="mt-4 space-y-2 text-sm text-slate-600">
                  <div className="flex justify-between gap-4">
                    <dt>{pick("Schedule", "调度周期")}</dt>
                    <dd>{config.schedule}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>{pick("Retention", "保留策略")}</dt>
                    <dd>
                      {config.retentionDays} {pick("days", "天")}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>{pick("Timer enabled", "Timer 已启用")}</dt>
                    <dd>
                      {healthSummary?.scheduler.supported
                        ? healthSummary.scheduler.enabled
                          ? pick("Yes", "是")
                          : pick("No", "否")
                        : pick("Unavailable", "不可用")}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>{pick("Next run", "下一次执行")}</dt>
                    <dd>
                      {healthSummary?.scheduler.nextTriggerAt
                        ? formatDateTime(healthSummary.scheduler.nextTriggerAt)
                        : pick("Unknown", "未知")}
                    </dd>
                  </div>
                </dl>
                {schedulerCheck ? (
                  <p className="mt-4 text-xs text-slate-500">{schedulerCheck.detail}</p>
                ) : null}
                {freshnessCheck ? (
                  <p className="mt-2 text-xs text-slate-500">{freshnessCheck.detail}</p>
                ) : null}
              </article>

              <article className="rounded-3xl border border-slate-200 bg-slate-50/80 p-5">
                <p className="text-sm font-semibold text-slate-900">
                  {pick("Last failure and evidence", "最近失败与证据")}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {pick(
                    "Use this card to decide whether the latest backup problem needs manual intervention.",
                    "用这张卡快速判断最近一次失败是否需要人工介入。"
                  )}
                </p>
                {latestFailedOperation ? (
                  <div className="mt-4 space-y-3 text-sm text-slate-600">
                    <p>
                      <span className="font-medium text-slate-900">{pick("Operation", "操作")}: </span>
                      {latestFailedOperation.operationId}
                    </p>
                    <p>
                      <span className="font-medium text-slate-900">{pick("Updated", "更新时间")}: </span>
                      {formatDateTime(latestFailedOperation.updatedAt)}
                    </p>
                    <p>
                      <span className="font-medium text-slate-900">{pick("Error", "错误")}: </span>
                      {latestFailedOperation.error}
                    </p>
                    <p>
                      <span className="font-medium text-slate-900">{pick("Snapshot", "快照")}: </span>
                      {latestFailedOperation.snapshotId ?? "--"}
                    </p>
                  </div>
                ) : (
                  <PlatformEmptyState
                    message={pick(
                      "No recent backup execution failures were recorded.",
                      "最近没有记录到备份执行失败。"
                    )}
                  />
                )}
              </article>
            </div>
          ) : null}
        </section>

        <section className="console-panel p-5">
          <PlatformSectionHeader
            dense={isDense}
            eyebrow={pick("Snapshots", "快照列表")}
            title={pick("Remote encrypted snapshots", "远端加密快照")}
            description={pick(
              "Choose a snapshot to preview restore blockers or start a full shared-directory restore.",
              "选择一个快照后，可以先做恢复预检查，再决定是否发起完整的 shared 全量恢复。"
            )}
          />
          {snapshots.length > 0 ? (
            <div className={`mt-5 grid gap-3 ${isDense ? "" : "md:grid-cols-2 xl:grid-cols-3"}`}>
              {snapshots.map((snapshot) => {
                const selected = selectedSnapshotId === snapshot.snapshotId;
                return (
                  <button
                    key={snapshot.snapshotId}
                    type="button"
                    onClick={() => {
                      setSelectedSnapshotId(snapshot.snapshotId);
                      setPreflightResult(null);
                    }}
                    className={`rounded-3xl border px-5 py-4 text-left transition ${
                      selected
                        ? "border-emerald-300 bg-emerald-50 shadow-sm"
                        : "border-slate-200 bg-slate-50/80 hover:border-slate-300 hover:bg-white"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <PlatformBadge tone={selected ? "success" : "neutral"}>
                        {snapshotKindLabel(snapshot.kind, pick)}
                      </PlatformBadge>
                      <span className="text-xs text-slate-400">
                        {formatRelativeTime(snapshot.createdAt)}
                      </span>
                    </div>
                    <p className="mt-4 text-sm font-semibold text-slate-950">{snapshot.snapshotId}</p>
                    <div className="mt-3 space-y-1 text-xs text-slate-500">
                      <p>{pick("Archive size", "归档大小")}: {formatBytes(snapshot.archiveBytes)}</p>
                      <p>{pick("Schema", "Schema")}: v{snapshot.schemaVersion}</p>
                      <p>{pick("App version", "应用版本")}: {snapshot.appVersion}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-5">
              <PlatformEmptyState
                message={pick("No encrypted snapshots have been uploaded yet.", "当前还没有上传任何加密快照。")}
              />
            </div>
          )}
        </section>

        <section className="console-panel p-5">
          <PlatformSectionHeader
            dense={isDense}
            eyebrow={pick("Active operation", "当前操作")}
            title={pick("Restore phase, verification, and rollback", "恢复阶段、验收结果与回滚情况")}
            description={pick(
              "This area tracks the live restore controller, including smoke verification and any automatic rollback.",
              "这里用于跟踪当前恢复控制器，包括平台验收和自动回滚结果。"
            )}
          />
          {activeOperation ? (
            <div className="mt-5 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <PlatformBadge tone={toneForOperation(activeOperation.status)}>
                  {operationStatusLabel(activeOperation.status, pick)}
                </PlatformBadge>
                <PlatformBadge tone={activeOperation.detail.phase === "rollback" ? "warning" : "info"}>
                  {phaseLabel(activeOperation.detail.phase, pick)}
                </PlatformBadge>
                {activeOperation.detail.rollbackSucceeded === true ? (
                  <PlatformBadge tone="success">
                    {pick("Rollback recovered the instance", "回滚已恢复实例")}
                  </PlatformBadge>
                ) : null}
                {activeOperation.detail.rollbackSucceeded === false ? (
                  <PlatformBadge tone="danger">
                    {pick("Rollback still failed", "回滚仍然失败")}
                  </PlatformBadge>
                ) : null}
              </div>

              <div className={`grid gap-4 ${isDense ? "" : "md:grid-cols-2 xl:grid-cols-4"}`}>
                <PlatformMetricCard
                  dense={isDense}
                  label={pick("Operation", "操作 ID")}
                  value={activeOperation.id}
                />
                <PlatformMetricCard
                  dense={isDense}
                  label={pick("Snapshot", "目标快照")}
                  value={activeOperation.snapshotId ?? "--"}
                />
                <PlatformMetricCard
                  dense={isDense}
                  label={pick("Updated", "最近更新")}
                  value={formatRelativeTime(activeOperation.updatedAt)}
                />
                <PlatformMetricCard
                  dense={isDense}
                  label={pick("Rollback snapshot", "回滚快照")}
                  value={activeOperation.detail.rollbackSnapshotId ?? "--"}
                />
              </div>

              <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-5">
                <p className="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">
                  {pick("Controller message", "控制器消息")}
                </p>
                <p className="mt-3 text-sm font-semibold leading-6 text-slate-900">
                  {activeOperation.message ?? pick("Waiting for an update...", "等待下一条状态更新...")}
                </p>
                {activeOperation.error ? (
                  <p className="mt-3 text-sm text-rose-700">{activeOperation.error}</p>
                ) : null}
              </div>

              {activeOperation.detail.verification
                ? renderVerificationCard({
                    title: pick("Restore verification", "恢复后平台验收"),
                    result: activeOperation.detail.verification,
                    dense: isDense,
                    pick,
                    formatDateTime
                  })
                : null}

              {activeOperation.detail.rollbackVerification
                ? renderVerificationCard({
                    title: pick("Auto rollback verification", "自动回滚后的平台验收"),
                    result: activeOperation.detail.rollbackVerification,
                    dense: isDense,
                    pick,
                    formatDateTime
                  })
                : null}
            </div>
          ) : (
            <div className="mt-5">
              <PlatformEmptyState
                message={pick(
                  "No backup or restore operation is currently active.",
                  "当前没有正在执行的备份或恢复任务。"
                )}
              />
            </div>
          )}
        </section>

        <section className="console-panel p-5">
          <PlatformSectionHeader
            dense={isDense}
            eyebrow={pick("Restore preflight", "恢复预检查")}
            title={pick("Preview blockers before maintenance", "在进入维护窗口前先看阻塞项")}
            description={pick(
              "Preview checks validate storage, disk headroom, running jobs, and snapshot compatibility.",
              "预检查会确认存储可达、磁盘空间、运行中任务以及快照兼容性。"
            )}
          />
          {selectedSnapshot ? (
            <div className="mt-5 space-y-4">
              <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-5 text-sm text-slate-600">
                <p className="font-semibold text-slate-900">{selectedSnapshot.snapshotId}</p>
                <p className="mt-2">
                  {pick("Selected snapshot kind", "已选快照类型")}:{" "}
                  {snapshotKindLabel(selectedSnapshot.kind, pick)}
                </p>
                <p className="mt-1">
                  {pick("Created", "创建时间")}: {formatDateTime(selectedSnapshot.createdAt)}
                </p>
              </div>

              {preflightResult ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <PlatformBadge tone={preflightResult.ok ? "success" : "danger"}>
                      {preflightResult.ok ? pick("Preflight passed", "预检查通过") : pick("Blocked", "存在阻塞")}
                    </PlatformBadge>
                    <span className="text-sm text-slate-500">
                      {pick("Required scratch space", "预计临时空间")}{" "}
                      {formatBytes(preflightResult.estimatedRequiredBytes)}
                    </span>
                    {typeof preflightResult.availableBytes === "number" ? (
                      <span className="text-sm text-slate-500">
                        {pick("Available", "可用空间")} {formatBytes(preflightResult.availableBytes)}
                      </span>
                    ) : null}
                  </div>

                  <div className={`grid gap-3 ${isDense ? "" : "md:grid-cols-2"}`}>
                    {preflightResult.checks.map((check) => (
                      <div
                        key={`${check.key}-${check.detail}`}
                        className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-slate-900">{check.label}</p>
                          <PlatformBadge tone={toneForPreflight(check.status)}>
                            {check.status}
                          </PlatformBadge>
                        </div>
                        <p className="mt-2 text-xs text-slate-500">{check.detail}</p>
                      </div>
                    ))}
                  </div>

                  {preflightResult.blockers.length > 0 ? (
                    <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
                      <p className="font-semibold">{pick("Blocking conditions", "阻塞条件")}</p>
                      <ul className="mt-2 space-y-1">
                        {preflightResult.blockers.map((blocker) => (
                          <li key={blocker}>• {blocker}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {preflightResult.warnings.length > 0 ? (
                    <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
                      <p className="font-semibold">{pick("Warnings", "警告")}</p>
                      <ul className="mt-2 space-y-1">
                        {preflightResult.warnings.map((warning) => (
                          <li key={warning}>• {warning}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : (
                <PlatformEmptyState
                  message={pick(
                    "Click “Preview restore” to generate a full restore preflight for the selected snapshot.",
                    "点击“预检查恢复”后，会为当前选中的快照生成完整的恢复预检查结果。"
                  )}
                />
              )}
            </div>
          ) : (
            <div className="mt-5">
              <PlatformEmptyState
                message={pick(
                  "Select a snapshot above to inspect its restore preflight.",
                  "请先从上面的快照列表里选择一个目标快照。"
                )}
              />
            </div>
          )}
        </section>

        <section className="console-panel p-5">
          <PlatformSectionHeader
            dense={isDense}
            eyebrow={pick("Restore history", "恢复历史")}
            title={pick("Recent restore outcomes", "最近的恢复结果")}
            description={pick(
              "This history distinguishes full restore success, rollback-assisted recovery, and rollback failures.",
              "这里会清楚区分恢复成功、恢复失败但已回滚成功，以及恢复失败且回滚也失败三种情况。"
            )}
          />
          {restoreHistory.length > 0 ? (
            <div className="mt-5 space-y-3">
              {restoreHistory.map((operation) => (
                <article
                  key={operation.id}
                  className="rounded-3xl border border-slate-200 bg-slate-50/80 p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <PlatformBadge tone={toneForOperation(operation.status)}>
                          {restoreOutcomeLabel(operation, pick)}
                        </PlatformBadge>
                        <PlatformBadge tone={operation.detail.phase === "rollback" ? "warning" : "neutral"}>
                          {phaseLabel(operation.detail.phase, pick)}
                        </PlatformBadge>
                      </div>
                      <p className="mt-3 text-sm font-semibold text-slate-950">
                        {operation.snapshotId ?? "--"}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {pick("Updated", "更新时间")} {formatDateTime(operation.updatedAt)}
                      </p>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      <p>{pick("Operation", "操作")} {operation.id}</p>
                      {operation.detail.rollbackSnapshotId ? (
                        <p className="mt-1">
                          {pick("Rollback snapshot", "回滚快照")} {operation.detail.rollbackSnapshotId}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className={`mt-4 grid gap-4 ${isDense ? "" : "md:grid-cols-3"}`}>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                        {pick("Restore verification", "恢复验收")}
                      </p>
                      <p className="mt-2 text-sm font-medium text-slate-900">
                        {operation.detail.verification
                          ? operation.detail.verification.ok
                            ? pick("Passed", "通过")
                            : pick("Failed", "失败")
                          : pick("Not recorded", "未记录")}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                        {pick("Auto rollback", "自动回滚")}
                      </p>
                      <p className="mt-2 text-sm font-medium text-slate-900">
                        {operation.detail.rollbackSucceeded === true
                          ? pick("Recovered", "已恢复")
                          : operation.detail.rollbackSucceeded === false
                            ? pick("Failed", "失败")
                            : pick("Not needed", "未触发")}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                        {pick("Failure reason", "失败原因")}
                      </p>
                      <p className="mt-2 text-sm font-medium text-slate-900">
                        {operation.detail.failureReason ?? pick("None", "无")}
                      </p>
                    </div>
                  </div>
                  {operation.error ? (
                    <p className="mt-4 text-sm text-rose-700">{operation.error}</p>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-5">
              <PlatformEmptyState
                message={pick("No restore operations have been recorded yet.", "当前还没有记录到任何恢复操作。")}
              />
            </div>
          )}
        </section>
      </div>
    </PlatformPageShell>
  );
};
