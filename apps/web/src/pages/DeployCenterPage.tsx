import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DeployConfigStatus,
  DeployOperation,
  DeployOperationStep,
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

const toneForOperation = (
  status: DeployOperation["status"]
): "neutral" | "info" | "success" | "danger" => {
  switch (status) {
    case "running":
      return "info";
    case "succeeded":
      return "success";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
};

const toneForStep = (
  status: DeployOperationStep["status"]
): "neutral" | "info" | "success" | "warning" | "danger" => {
  switch (status) {
    case "running":
      return "info";
    case "succeeded":
      return "success";
    case "failed":
      return "danger";
    case "skipped":
      return "warning";
    default:
      return "neutral";
  }
};

const statusLabel = (
  status: DeployOperation["status"],
  pick: (en: string, zh: string) => string
): string => {
  switch (status) {
    case "queued":
      return pick("Queued", "已排队");
    case "running":
      return pick("Running", "执行中");
    case "succeeded":
      return pick("Succeeded", "已完成");
    case "failed":
      return pick("Failed", "失败");
  }
};

const executionModeLabel = (
  mode: DeployConfigStatus["executionMode"] | DeployOperation["detail"]["executionMode"],
  pick: (en: string, zh: string) => string
): string => (mode === "remote_ssh" ? pick("Remote SSH", "远程 SSH") : pick("Local host", "本机"));

const renderSmokeSummary = (input: {
  result: RestoreVerificationResult;
  pick: (en: string, zh: string) => string;
  formatDateTime: (value?: string | null, emptyText?: string) => string;
}) => (
  <article className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-slate-900">
          {input.pick("Smoke verification", "Smoke 验收")}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {input.pick("Checked at", "检查时间")} {input.formatDateTime(input.result.checkedAt)}
        </p>
      </div>
      <PlatformBadge tone={input.result.ok ? "success" : "danger"}>
        {input.result.ok ? input.pick("Passed", "通过") : input.pick("Failed", "失败")}
      </PlatformBadge>
    </div>

    <div className="mt-4 grid gap-3 md:grid-cols-2">
      {input.result.checks.map((check) => (
        <div
          key={`${check.key}-${check.checkedAt}`}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-900">{check.label}</p>
            <PlatformBadge
              tone={
                check.state === "passed"
                  ? "success"
                  : check.state === "skipped"
                    ? "warning"
                    : "danger"
              }
            >
              {check.state}
            </PlatformBadge>
          </div>
          <p className="mt-2 text-xs text-slate-500">{check.detail}</p>
        </div>
      ))}
    </div>
  </article>
);

export const DeployCenterPage = () => {
  const { auth } = useAuth();
  const { isDense } = usePlatformDensity();
  const { pick, formatDateTime, formatRelativeTime } = useI18n();
  const queryClient = useQueryClient();
  const [targetRef, setTargetRef] = useState("main");
  const [pendingOperationId, setPendingOperationId] = useState<string | null>(null);
  const [localMessage, setLocalMessage] = useState<string | null>(null);

  const configQuery = useQuery({
    queryKey: ["platform", "ops", "deploy", "config"],
    queryFn: () => api.getDeployConfigStatus(),
    refetchInterval: (query) =>
      query.state.data?.activeOperation || pendingOperationId ? 4_000 : false
  });

  const trackedOperationId = pendingOperationId ?? configQuery.data?.activeOperation?.id ?? null;

  const operationQuery = useQuery({
    queryKey: ["platform", "ops", "deploy", "operation", trackedOperationId],
    queryFn: () => api.getDeployOperation(trackedOperationId!),
    enabled: Boolean(trackedOperationId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "succeeded" || status === "failed" ? false : 4_000;
    }
  });

  useEffect(() => {
    if (configQuery.data?.gitBranch && targetRef === "main") {
      setTargetRef(configQuery.data.gitBranch);
    }
  }, [configQuery.data?.gitBranch, targetRef]);

  useEffect(() => {
    const operation = operationQuery.data;
    if (!operation) {
      return;
    }

    if (operation.status === "succeeded" || operation.status === "failed") {
      setLocalMessage(
        operation.status === "succeeded"
          ? pick("Deploy completed successfully.", "部署已完成。")
          : operation.error ?? pick("Deploy failed.", "部署失败。")
      );
      setPendingOperationId(null);
      void queryClient.invalidateQueries({
        queryKey: ["platform", "ops", "deploy"]
      });
    }
  }, [operationQuery.data, pick, queryClient]);

  const runDeployMutation = useMutation({
    mutationFn: (ref: string) => api.runDeployNow({ ref }),
    onSuccess: (operation) => {
      setPendingOperationId(operation.id);
      setLocalMessage(
        pick(
          "Deploy queued. Watch the operation log while the target host refreshes itself.",
          "部署任务已排队。目标主机刷新期间，可以继续在这里跟踪日志。"
        )
      );
      void queryClient.invalidateQueries({
        queryKey: ["platform", "ops", "deploy", "config"]
      });
    },
    onError: (error) => {
      setLocalMessage(error instanceof Error ? error.message : String(error));
    }
  });

  const config = configQuery.data ?? null;
  const activeOperation = operationQuery.data ?? config?.activeOperation ?? null;
  const recentOperations = config?.recentOperations ?? [];
  const isRemoteMode = config?.executionMode === "remote_ssh";

  const currentError =
    configQuery.error instanceof ApiError && configQuery.error.status === 403
      ? pick(
          "Deploy Center is available to tenant owners only.",
          "Deploy Center 目前仅对当前租户的 owner 开放。"
        )
      : configQuery.error instanceof Error
        ? configQuery.error.message
        : null;

  const primaryError =
    localMessage &&
    (localMessage.toLowerCase().includes("failed") ||
      localMessage.toLowerCase().includes("error") ||
      localMessage.includes("失败"))
      ? localMessage
      : currentError;

  const statusMessage = localMessage && localMessage !== primaryError ? localMessage : null;

  const deployDisabledReason = useMemo(() => {
    if (!config) {
      return pick("Loading deploy status...", "正在加载部署状态...");
    }
    if (!config.supported) {
      return config.detail;
    }
    if (config.executionMode === "local" && config.gitDirty) {
      return pick(
        "The local server workspace has uncommitted changes. Clean it before running a managed deploy.",
        "本机部署工作区存在未提交改动，先清理再执行托管部署。"
      );
    }
    if (config.activeOperation) {
      return pick("Another deploy is already running.", "已有另一条部署任务在执行。");
    }
    return null;
  }, [config, pick]);

  return (
    <PlatformPageShell
      dense={isDense}
      accent="sky"
      badge={
        <PlatformBadge tone={config?.supported ? "info" : "warning"} uppercase>
          {config
            ? `${executionModeLabel(config.executionMode, pick)} / ${
                config.supported ? pick("ready", "就绪") : pick("manual", "仅手工")
              }`
            : pick("Loading", "加载中")}
        </PlatformBadge>
      }
      projectLabel={
        auth ? (
          <PlatformBadge tone="neutral">
            {pick("Owner scope", "Owner 视角")} / {auth.tenant.name}
          </PlatformBadge>
        ) : null
      }
      title={pick("Deploy Center", "部署中心")}
      actions={
        <div className="flex flex-wrap gap-3">
          <div className="flex min-w-[280px] flex-1 items-center gap-2 rounded-2xl border border-slate-200 bg-white/80 px-3 py-2">
            <label
              htmlFor="deploy-target-ref"
              className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400"
            >
              {pick("Target ref", "目标分支")}
            </label>
            <input
              id="deploy-target-ref"
              value={targetRef}
              onChange={(event) => setTargetRef(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-900 outline-none"
              placeholder="main"
            />
          </div>

          <button
            type="button"
            onClick={() => runDeployMutation.mutate(targetRef.trim() || "main")}
            disabled={Boolean(deployDisabledReason) || runDeployMutation.isPending}
            className="console-button-primary"
          >
            {runDeployMutation.isPending
              ? pick("Queueing deploy...", "正在创建部署...")
              : pick("Deploy this ref", "部署这个分支")}
          </button>
        </div>
      }
      metrics={
        <>
          <PlatformMetricCard
            dense={isDense}
            label={pick("Current branch", "当前分支")}
            value={config?.gitBranch ?? "--"}
          />
          <PlatformMetricCard
            dense={isDense}
            label={isRemoteMode ? pick("Target host", "目标主机") : pick("Current commit", "当前提交")}
            value={isRemoteMode ? config?.targetHost ?? "--" : config?.gitCommit?.slice(0, 12) ?? "--"}
          />
          <PlatformMetricCard
            dense={isDense}
            label={isRemoteMode ? pick("SSH identity", "SSH 身份") : pick("Workspace clean", "工作区干净")}
            value={
              isRemoteMode
                ? config?.targetSshUser ?? "--"
                : config
                  ? config.gitDirty
                    ? pick("No", "否")
                    : pick("Yes", "是")
                  : "--"
            }
          />
          <PlatformMetricCard
            dense={isDense}
            label={pick("Last successful deploy", "最近成功部署")}
            value={
              config?.lastSuccessfulAt
                ? formatRelativeTime(config.lastSuccessfulAt)
                : pick("None yet", "暂无")
            }
          />
        </>
      }
    >
      <div className={isDense ? "space-y-4" : "space-y-6"}>
        <PlatformErrorBanner
          messages={[
            ...(primaryError ? [primaryError] : []),
            ...(deployDisabledReason && !primaryError ? [deployDisabledReason] : [])
          ]}
        />

        {statusMessage ? (
          <div className="rounded-3xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700">
            {statusMessage}
          </div>
        ) : null}

        <section className="console-panel p-5">
          <PlatformSectionHeader
            dense={isDense}
            eyebrow={pick("Deploy posture", "部署姿态")}
            title={
              isRemoteMode
                ? pick(
                    "Use this workspace as the operator console for the configured SSH target",
                    "用当前工作区作为已配置 SSH 目标的部署操作台"
                  )
                : pick(
                    "Use the current host workspace as the release source of truth",
                    "直接用当前主机工作区作为发布源"
                  )
            }
            description={
              isRemoteMode
                ? pick(
                    "This mode calls deploy:update from the current workspace, pushes the update to the configured Linux host, and then tracks the result here.",
                    "这个模式会从当前工作区调用 deploy:update，把更新推到已配置的 Linux 主机，然后在这里继续跟踪结果。"
                  )
                : pick(
                    "This mode updates the checked-out repository on the host, rebuilds the web bundle, restarts the runtime, reloads nginx, and then runs smoke verification.",
                    "这个模式会直接在当前主机更新仓库、重建 web、重启 runtime、reload nginx，然后执行 smoke 验收。"
                  )
            }
          />

          <div className="mt-5 grid gap-4 lg:grid-cols-4">
            <PlatformMetricCard
              dense={isDense}
              label={pick("Operator workspace", "操作工作区")}
              value={config?.workspaceRoot ?? "--"}
            />
            <PlatformMetricCard
              dense={isDense}
              label={pick("Repository remote", "仓库远端")}
              value={config?.gitRemote ?? "--"}
            />
            <PlatformMetricCard
              dense={isDense}
              label={isRemoteMode ? pick("Remote root", "远端根目录") : pick("Mode", "模式")}
              value={
                isRemoteMode
                  ? config?.targetDeployRoot ?? "--"
                  : config
                    ? executionModeLabel(config.executionMode, pick)
                    : "--"
              }
            />
            <PlatformMetricCard
              dense={isDense}
              label={pick("App smoke target", "应用验收地址")}
              value={config?.appBaseUrl ?? "--"}
            />
          </div>
        </section>

        <section className="console-panel p-5">
          <PlatformSectionHeader
            dense={isDense}
            eyebrow={pick("Active operation", "当前部署任务")}
            title={pick("Follow each deploy step and its smoke result", "跟踪每一步部署与 smoke 结果")}
            description={
              isRemoteMode
                ? pick(
                    "Remote mode launches the deploy worker in the background and keeps the SSH session details in the operation log.",
                    "远程模式会在后台启动部署 worker，并把 SSH 触发过程持续写进操作日志。"
                  )
                : pick(
                    "Local mode continues outside the runtime service, so it can survive the runtime restart that it triggers.",
                    "本机模式会在 runtime service 之外继续执行，所以不会被它自己触发的重启一起杀掉。"
                  )
            }
          />

          {activeOperation ? (
            <div className="mt-5 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <PlatformBadge tone={toneForOperation(activeOperation.status)}>
                  {statusLabel(activeOperation.status, pick)}
                </PlatformBadge>
                <PlatformBadge tone="neutral">
                  {executionModeLabel(activeOperation.detail.executionMode ?? config?.executionMode, pick)}
                </PlatformBadge>
                <span className="console-data-pill px-3 py-1 text-xs">
                  {pick("Ref", "分支")} {activeOperation.targetRef}
                </span>
                {activeOperation.detail.targetHost ? (
                  <span className="console-data-pill px-3 py-1 text-xs">
                    {pick("Target", "目标")} {activeOperation.detail.targetHost}
                  </span>
                ) : null}
                <span className="console-data-pill px-3 py-1 text-xs">
                  {pick("Started", "开始时间")} {formatDateTime(activeOperation.startedAt)}
                </span>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                {(activeOperation.detail.steps ?? []).map((step) => (
                  <article
                    key={step.key}
                    className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900">{step.label}</p>
                      <PlatformBadge tone={toneForStep(step.status)}>{step.status}</PlatformBadge>
                    </div>
                    {step.detail ? (
                      <p className="mt-2 text-xs leading-6 text-slate-500">{step.detail}</p>
                    ) : null}
                    <p className="mt-3 text-[11px] uppercase tracking-[0.22em] text-slate-400">
                      {step.startedAt
                        ? `${pick("Started", "开始")} ${formatDateTime(step.startedAt)}`
                        : pick("Waiting", "等待中")}
                    </p>
                  </article>
                ))}
              </div>

              {activeOperation.detail.smokeVerification ? (
                renderSmokeSummary({
                  result: activeOperation.detail.smokeVerification,
                  pick,
                  formatDateTime
                })
              ) : null}

              <article className="rounded-3xl border border-slate-200 bg-slate-950 p-4 text-slate-100">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">
                    {pick("Recent log tail", "最近日志尾部")}
                  </p>
                  <span className="font-data text-[11px] uppercase tracking-[0.24em] text-slate-400">
                    {activeOperation.detail.logTail?.length ?? 0} lines
                  </span>
                </div>

                {activeOperation.detail.logTail?.length ? (
                  <pre className="mt-4 max-h-[24rem] overflow-auto rounded-2xl bg-black/30 p-4 text-xs leading-6 text-slate-200">
                    {activeOperation.detail.logTail.join("\n")}
                  </pre>
                ) : (
                  <div className="mt-4">
                    <PlatformEmptyState
                      message={pick(
                        "The operation journal exists, but no command output has been captured yet.",
                        "部署日志文件已经创建，但还没有捕获到命令输出。"
                      )}
                    />
                  </div>
                )}
              </article>
            </div>
          ) : (
            <div className="mt-5">
              <PlatformEmptyState
                message={pick(
                  "No deploy is active right now. Queue one from the target ref when you are ready.",
                  "当前没有活动中的部署。准备好以后，可以从目标分支发起一条部署任务。"
                )}
              />
            </div>
          )}
        </section>

        <section className="console-panel p-5">
          <PlatformSectionHeader
            dense={isDense}
            eyebrow={pick("Recent history", "最近历史")}
            title={pick("Previous deploy attempts stay visible", "之前的部署尝试都会保留在这里")}
            description={pick(
              "Use this to confirm which commit is on the host, who triggered it, and whether smoke checks passed.",
              "你可以在这里确认主机部署到了哪个提交、由谁触发，以及 smoke 是否通过。"
            )}
          />

          {recentOperations.length > 0 ? (
            <div className="mt-5 overflow-hidden rounded-3xl border border-slate-200">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                  <thead className="bg-slate-50/90 text-xs uppercase tracking-[0.18em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3">{pick("Status", "状态")}</th>
                      <th className="px-4 py-3">{pick("Mode", "模式")}</th>
                      <th className="px-4 py-3">{pick("Ref", "分支")}</th>
                      <th className="px-4 py-3">{pick("Target", "目标")}</th>
                      <th className="px-4 py-3">{pick("Before", "之前")}</th>
                      <th className="px-4 py-3">{pick("After", "之后")}</th>
                      <th className="px-4 py-3">{pick("Finished", "完成时间")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {recentOperations.map((operation) => (
                      <tr key={operation.id}>
                        <td className="px-4 py-3">
                          <PlatformBadge tone={toneForOperation(operation.status)}>
                            {statusLabel(operation.status, pick)}
                          </PlatformBadge>
                        </td>
                        <td className="px-4 py-3">
                          <PlatformBadge tone="neutral">
                            {executionModeLabel(operation.detail.executionMode, pick)}
                          </PlatformBadge>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {operation.targetRef}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {operation.detail.targetHost ?? pick("Current host", "当前主机")}
                        </td>
                        <td className="px-4 py-3 font-data text-xs text-slate-500">
                          {operation.commitBefore?.slice(0, 12) ?? "--"}
                        </td>
                        <td className="px-4 py-3 font-data text-xs text-slate-500">
                          {operation.commitAfter?.slice(0, 12) ?? "--"}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {operation.finishedAt
                            ? formatRelativeTime(operation.finishedAt)
                            : pick("Still running", "仍在执行")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="mt-5">
              <PlatformEmptyState
                message={pick(
                  "No deploy history yet. The first successful run will appear here after update and smoke verification finish.",
                  "还没有部署历史。等第一次更新和 smoke 完成后，这里就会出现记录。"
                )}
              />
            </div>
          )}
        </section>
      </div>
    </PlatformPageShell>
  );
};
