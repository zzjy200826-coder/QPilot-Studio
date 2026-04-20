import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useI18n } from "../i18n/I18nProvider";
import { api } from "../lib/api";
import { PlatformBadge } from "../platform/PlatformBadge";
import { usePlatformDensity } from "../platform/PlatformDensity";
import { PlatformDrawer } from "../platform/PlatformDrawer";
import { PlatformEmptyState } from "../platform/PlatformEmptyState";
import { PlatformErrorBanner } from "../platform/PlatformErrorBanner";
import { PlatformMetricCard } from "../platform/PlatformMetricCard";
import { PlatformPageShell } from "../platform/PlatformPageShell";

type DrawerKind = "policy" | "release" | "waiver" | "approval" | null;

const signalTone: Record<string, "success" | "warning" | "danger" | "violet"> = {
  passed: "success",
  warning: "warning",
  failed: "danger",
  waived: "violet"
};

const verdictTone: Record<string, "success" | "warning" | "danger" | "neutral" | "violet"> = {
  ship: "success",
  watch: "warning",
  hold: "danger",
  draft: "neutral",
  waived: "violet"
};

export const ReleaseGatePage = () => {
  const { formatDateTime, formatRelativeTime, pick } = useI18n();
  const { isDense } = usePlatformDensity();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [drawer, setDrawer] = useState<DrawerKind>(null);

  const [policyName, setPolicyName] = useState("release gate");
  const [requiredFlows, setRequiredFlows] = useState("核心登录\n核心支付");
  const [releaseName, setReleaseName] = useState("2026.04.18 candidate");
  const [buildLabel, setBuildLabel] = useState("build-2026-04-18.1");
  const [waiverReason, setWaiverReason] = useState("Temporary watch while mitigation is in progress.");
  const [waiverRequestedBy, setWaiverRequestedBy] = useState("release-manager");
  const [approvalActor, setApprovalActor] = useState("qa-lead");
  const [approvalRole, setApprovalRole] = useState("qa-lead");
  const [approvalDetail, setApprovalDetail] = useState("Approved after reviewing load and benchmark evidence.");

  const projectId = searchParams.get("projectId") ?? "";
  const selectedReleaseId = searchParams.get("releaseId") ?? "";
  const selectedEnvironmentId = searchParams.get("environmentId") ?? "";
  const selectedGatePolicyId = searchParams.get("selectedGatePolicyId") ?? "";
  const selectedBlockerKey = searchParams.get("blockerKey") ?? "";

  const updateSearch = (entries: Record<string, string | null>) => {
    const next = new URLSearchParams(
      typeof window === "undefined" ? searchParams.toString() : window.location.search
    );
    for (const [key, value] of Object.entries(entries)) {
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
    }
    setSearchParams(next, { replace: true });
  };

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
  const environmentsQuery = useQuery({
    queryKey: ["platform", "environments", projectId || "all"],
    queryFn: () => api.getEnvironmentRegistry(projectId || undefined)
  });
  const gatePoliciesQuery = useQuery({
    queryKey: ["platform", "gate-policies", projectId || "all"],
    queryFn: () => api.listGatePolicies(projectId || undefined)
  });
  const releasesQuery = useQuery({
    queryKey: ["platform", "releases", projectId || "all"],
    queryFn: () => api.listReleases(projectId || undefined)
  });
  const releaseDetailQuery = useQuery({
    queryKey: ["platform", "release-gates", selectedReleaseId],
    queryFn: () => api.getReleaseGateDetail(selectedReleaseId),
    enabled: Boolean(selectedReleaseId)
  });
  const auditQuery = useQuery({
    queryKey: ["platform", "release-audit", selectedReleaseId],
    queryFn: () => api.getReleaseAudit(selectedReleaseId),
    enabled: Boolean(selectedReleaseId)
  });

  useEffect(() => {
    if (!projectId && (projectsQuery.data?.length ?? 0) > 0) {
      updateSearch({ projectId: projectsQuery.data?.[0]?.id ?? null });
    }
  }, [projectId, projectsQuery.data]);

  useEffect(() => {
    if (!selectedEnvironmentId && (environmentsQuery.data?.environments.length ?? 0) > 0) {
      updateSearch({ environmentId: environmentsQuery.data?.environments[0]?.id ?? null });
    }
  }, [environmentsQuery.data, selectedEnvironmentId]);

  useEffect(() => {
    if (!selectedGatePolicyId && (gatePoliciesQuery.data?.length ?? 0) > 0) {
      updateSearch({ selectedGatePolicyId: gatePoliciesQuery.data?.[0]?.id ?? null });
    }
  }, [gatePoliciesQuery.data, selectedGatePolicyId]);

  const createPolicyMutation = useMutation({
    mutationFn: api.createGatePolicy,
    onSuccess: async (policy) => {
      setDrawer(null);
      updateSearch({ selectedGatePolicyId: policy.id });
      await queryClient.invalidateQueries({ queryKey: ["platform", "gate-policies"] });
    }
  });

  const createReleaseMutation = useMutation({
    mutationFn: api.createRelease,
    onSuccess: async (release) => {
      setDrawer(null);
      updateSearch({ releaseId: release.id });
      await queryClient.invalidateQueries({ queryKey: ["platform", "releases"] });
      await queryClient.invalidateQueries({ queryKey: ["platform", "release-gates"] });
    }
  });

  const createWaiverMutation = useMutation({
    mutationFn: api.createWaiver,
    onSuccess: async () => {
      setDrawer(null);
      await queryClient.invalidateQueries({ queryKey: ["platform", "release-gates", selectedReleaseId] });
      await queryClient.invalidateQueries({ queryKey: ["platform", "release-audit", selectedReleaseId] });
      await queryClient.invalidateQueries({ queryKey: ["platform", "releases"] });
    }
  });

  const createApprovalMutation = useMutation({
    mutationFn: api.createReleaseApproval,
    onSuccess: async () => {
      setDrawer(null);
      await queryClient.invalidateQueries({ queryKey: ["platform", "release-audit", selectedReleaseId] });
      await queryClient.invalidateQueries({ queryKey: ["platform", "release-gates", selectedReleaseId] });
    }
  });

  const releases = releasesQuery.data ?? [];
  const gatePolicies = gatePoliciesQuery.data ?? [];
  const detail = releaseDetailQuery.data;
  const audit = auditQuery.data;
  const selectedProject = useMemo(
    () => projectsQuery.data?.find((project) => project.id === projectId),
    [projectId, projectsQuery.data]
  );
  const blockers = detail?.result.signals.filter((signal) => signal.status === "failed") ?? [];

  useEffect(() => {
    if (!selectedBlockerKey && blockers.length > 0) {
      updateSearch({ blockerKey: blockers[0]?.id ?? null });
    }
  }, [blockers, selectedBlockerKey]);

  const errors = [
    createPolicyMutation.error instanceof Error ? createPolicyMutation.error.message : null,
    createReleaseMutation.error instanceof Error ? createReleaseMutation.error.message : null,
    createWaiverMutation.error instanceof Error ? createWaiverMutation.error.message : null,
    createApprovalMutation.error instanceof Error ? createApprovalMutation.error.message : null
  ].filter((value): value is string => Boolean(value));

  const panelClass = `rounded-[28px] border border-slate-200 bg-white ${isDense ? "p-4" : "p-5"}`;
  const inputClass = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
  const pageGap = isDense ? "gap-4" : "gap-6";

  const savePolicy = () =>
    createPolicyMutation.mutate({
      projectId,
      name: policyName,
      requiredFunctionalFlows: requiredFlows
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean),
      minBenchmarkCoveragePct: 50,
      minBenchmarkPassRate: 70,
      requiredLoadProfileIds: [],
      minimumLoadVerdict: "watch",
      allowWaiver: true,
      approverRoles: ["release-manager", "qa-lead"]
    });

  const saveRelease = () =>
    createReleaseMutation.mutate({
      projectId,
      environmentId: selectedEnvironmentId || undefined,
      gatePolicyId: selectedGatePolicyId,
      name: releaseName,
      buildLabel
    });

  const saveWaiver = () => {
    if (!detail || !selectedBlockerKey) {
      return;
    }
    createWaiverMutation.mutate({
      releaseId: detail.release.id,
      blockerKey: selectedBlockerKey,
      reason: waiverReason,
      requestedBy: waiverRequestedBy,
      approvedBy: waiverRequestedBy,
      role: "release-manager",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    });
  };

  const saveApproval = () => {
    if (!detail) {
      return;
    }
    createApprovalMutation.mutate({
      releaseId: detail.release.id,
      actor: approvalActor,
      role: approvalRole,
      action: "release_approved",
      detail: approvalDetail
    });
  };

  return (
    <PlatformPageShell
      dense={isDense}
      accent="rose"
      badge={<PlatformBadge tone="danger" uppercase dense={isDense}>{pick("Gate Center", "门禁台")}</PlatformBadge>}
      projectLabel={
        selectedProject ? <PlatformBadge dense={isDense}>{selectedProject.name}</PlatformBadge> : undefined
      }
      title={pick("Verdicts, blockers, waivers, and approvals.", "结论、阻塞项、豁免与审批")}
      actions={
        <>
          <select
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700"
            value={projectId}
            onChange={(event) => updateSearch({ projectId: event.target.value, releaseId: null })}
          >
            {(projectsQuery.data ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <Link
            to="/platform/load"
            className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            {pick("Open Load Studio", "打开压测台")}
          </Link>
          <button
            type="button"
            onClick={() => setDrawer("policy")}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700"
          >
            {pick("Create policy", "创建策略")}
          </button>
          <button
            type="button"
            onClick={() => setDrawer("release")}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700"
          >
            {pick("Create release", "创建发布")}
          </button>
        </>
      }
      metrics={
        <>
          <PlatformMetricCard label={pick("Policies", "策略")} value={gatePolicies.length} dense={isDense} />
          <PlatformMetricCard label={pick("Releases", "发布")} value={releases.length} dense={isDense} />
          <PlatformMetricCard label={pick("Blockers", "阻塞项")} value={blockers.length} dense={isDense} />
        </>
      }
    >
      <PlatformErrorBanner messages={errors} />

      <div className={`grid xl:grid-cols-[minmax(0,1fr)_380px] ${pageGap}`}>
        <div className={isDense ? "space-y-4" : "space-y-6"}>
          <section className={panelClass}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                  {pick("Release queue", "发布队列")}
                </p>
                <h3 className={`font-semibold text-slate-950 ${isDense ? "mt-1 text-xl" : "mt-2 text-2xl"}`}>
                  {pick("Release candidates", "发布候选")}
                </h3>
              </div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-[0.22em] text-slate-400">
                    <th className="pb-3 pr-4">{pick("Release", "发布")}</th>
                    <th className="pb-3 pr-4">{pick("Build", "构建")}</th>
                    <th className="pb-3 pr-4">{pick("Status", "状态")}</th>
                    <th className="pb-3">{pick("Action", "动作")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {releases.length > 0 ? (
                    releases.map((release) => (
                      <tr key={release.id}>
                        <td className={isDense ? "py-3 pr-4" : "py-4 pr-4"}>
                          <p className="font-medium text-slate-900">{release.name}</p>
                          <p className="mt-1 text-xs text-slate-500">{formatRelativeTime(release.updatedAt)}</p>
                        </td>
                        <td className={`${isDense ? "py-3 pr-4" : "py-4 pr-4"} text-slate-600`}>
                          {release.buildLabel}
                        </td>
                        <td className={isDense ? "py-3 pr-4" : "py-4 pr-4"}>
                          <PlatformBadge dense tone={verdictTone[release.status] ?? "neutral"}>
                            {release.status.toUpperCase()}
                          </PlatformBadge>
                        </td>
                        <td className={isDense ? "py-3" : "py-4"}>
                          <button
                            type="button"
                            onClick={() => updateSearch({ releaseId: release.id })}
                            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700"
                          >
                            {selectedReleaseId === release.id
                              ? pick("Selected", "已选中")
                              : pick("Inspect", "查看")}
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="py-6">
                        <PlatformEmptyState message={pick("No release.", "暂无发布。")} />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {detail ? (
            <>
              <section className={panelClass}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                      {pick("Verdict", "结论")}
                    </p>
                    <h3 className={`font-semibold text-slate-950 ${isDense ? "mt-1 text-xl" : "mt-2 text-2xl"}`}>
                      {detail.result.verdict.toUpperCase()}
                    </h3>
                  </div>
                  <PlatformBadge dense tone={verdictTone[detail.result.verdict] ?? "neutral"}>
                    {detail.release.status.toUpperCase()}
                  </PlatformBadge>
                </div>
                <div className={`mt-4 grid md:grid-cols-3 ${pageGap}`}>
                  <PlatformMetricCard label={pick("Signals", "信号")} value={detail.result.signals.length} dense={isDense} />
                  <PlatformMetricCard label={pick("Waivers", "豁免")} value={detail.waivers.length} dense={isDense} />
                  <PlatformMetricCard label={pick("Updated", "更新时间")} value={formatDateTime(detail.result.evaluatedAt)} dense={isDense} />
                </div>
              </section>

              <section className={panelClass}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                      {pick("Signals", "信号")}
                    </p>
                    <h3 className={`font-semibold text-slate-950 ${isDense ? "mt-1 text-xl" : "mt-2 text-2xl"}`}>
                      {pick("Gate inputs", "门禁输入")}
                    </h3>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {detail.result.signals.map((signal) => (
                    <div key={signal.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="font-medium text-slate-900">{signal.label}</p>
                        <PlatformBadge dense tone={signalTone[signal.status] ?? "warning"}>
                          {signal.status.toUpperCase()}
                        </PlatformBadge>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-600">{signal.detail}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className={panelClass}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                      {pick("Waivers", "豁免")}
                    </p>
                    <h3 className={`font-semibold text-slate-950 ${isDense ? "mt-1 text-xl" : "mt-2 text-2xl"}`}>
                      {pick("Blockers and waivers", "阻塞项与豁免")}
                    </h3>
                  </div>
                  <div className="flex gap-2">
                    {blockers.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setDrawer("waiver")}
                        className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white"
                      >
                        {pick("Apply waiver", "申请豁免")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setDrawer("approval")}
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                    >
                      {pick("Record approval", "记录审批")}
                    </button>
                  </div>
                </div>
                <div className={`mt-4 grid lg:grid-cols-2 ${pageGap}`}>
                  <div className="space-y-3">
                    {blockers.length > 0 ? (
                      blockers.map((signal) => (
                        <div key={signal.id} className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-medium">{signal.label}</p>
                            <button
                              type="button"
                              onClick={() => updateSearch({ blockerKey: signal.id })}
                              className="rounded-full border border-rose-200 bg-white px-3 py-1 text-xs font-medium text-rose-700"
                            >
                              {selectedBlockerKey === signal.id
                                ? pick("Selected", "已选中")
                                : pick("Choose", "选择")}
                            </button>
                          </div>
                          <p className="mt-2 text-xs">{signal.detail}</p>
                        </div>
                      ))
                    ) : (
                      <PlatformEmptyState message={pick("No blocker.", "暂无阻塞项。")} />
                    )}
                  </div>
                  <div className="space-y-3">
                    {detail.waivers.length > 0 ? (
                      detail.waivers.map((waiver) => (
                        <div key={waiver.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-medium text-slate-900">{waiver.blockerKey}</p>
                            <PlatformBadge dense tone="violet">{waiver.status.toUpperCase()}</PlatformBadge>
                          </div>
                          <p className="mt-2 text-xs text-slate-600">{waiver.reason}</p>
                          <p className="mt-2 text-xs text-slate-500">
                            {`${waiver.requestedBy} · ${formatRelativeTime(waiver.createdAt)}`}
                          </p>
                        </div>
                      ))
                    ) : (
                      <PlatformEmptyState message={pick("No waiver.", "暂无豁免。")} />
                    )}
                  </div>
                </div>
              </section>

              <section className={panelClass}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                      {pick("Audit", "审计")}
                    </p>
                    <h3 className={`font-semibold text-slate-950 ${isDense ? "mt-1 text-xl" : "mt-2 text-2xl"}`}>
                      {pick("Approval timeline", "审批时间线")}
                    </h3>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {(audit?.timeline ?? detail.approvalTimeline).length > 0 ? (
                    (audit?.timeline ?? detail.approvalTimeline).map((event) => (
                      <div key={event.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="font-medium text-slate-900">{event.action}</p>
                          <p className="text-xs text-slate-500">{formatDateTime(event.createdAt)}</p>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">{`${event.actor} · ${event.role}`}</p>
                        {event.detail ? <p className="mt-2 text-xs text-slate-600">{event.detail}</p> : null}
                      </div>
                    ))
                  ) : (
                    <PlatformEmptyState message={pick("No audit event.", "暂无审计事件。")} />
                  )}
                </div>
              </section>
            </>
          ) : null}
        </div>

        <aside className={isDense ? "space-y-4" : "space-y-6"}>
          {!detail ? (
            <section className={panelClass}>
              <PlatformEmptyState message={pick("Select a release.", "请选择一个发布。")} />
            </section>
          ) : null}
        </aside>
      </div>

      <PlatformDrawer
        open={drawer !== null}
        title={
          drawer === "policy"
            ? pick("Create policy", "创建策略")
            : drawer === "release"
              ? pick("Create release", "创建发布")
              : drawer === "waiver"
                ? pick("Apply waiver", "申请豁免")
                : pick("Record approval", "记录审批")
        }
        description={
          drawer === "policy"
            ? pick("Functional, benchmark, and load requirements", "功能、基准与压测要求")
            : drawer === "release"
              ? pick("Release candidate and policy binding", "发布候选与策略绑定")
              : drawer === "waiver"
                ? pick("Blocker override", "阻塞项覆盖")
                : pick("Approval event", "审批事件")
        }
        onClose={() => setDrawer(null)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setDrawer(null)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700"
            >
              {pick("Cancel", "取消")}
            </button>
            <button
              type="button"
              onClick={
                drawer === "policy"
                  ? savePolicy
                  : drawer === "release"
                    ? saveRelease
                    : drawer === "waiver"
                      ? saveWaiver
                      : saveApproval
              }
              className="rounded-lg border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            >
              {drawer === "policy"
                ? pick("Save policy", "保存策略")
                : drawer === "release"
                  ? pick("Save release", "保存发布")
                  : drawer === "waiver"
                    ? pick("Apply waiver", "申请豁免")
                    : pick("Record approval", "记录审批")}
            </button>
          </>
        }
      >
        {drawer === "policy" ? (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {pick("Name", "名称")}
              </label>
              <input className={inputClass} value={policyName} onChange={(event) => setPolicyName(event.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {pick("Required flows", "必过流程")}
              </label>
              <textarea className={`${inputClass} min-h-[140px]`} value={requiredFlows} onChange={(event) => setRequiredFlows(event.target.value)} />
            </div>
          </div>
        ) : drawer === "release" ? (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {pick("Name", "名称")}
              </label>
              <input className={inputClass} value={releaseName} onChange={(event) => setReleaseName(event.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {pick("Build label", "构建标签")}
              </label>
              <input className={inputClass} value={buildLabel} onChange={(event) => setBuildLabel(event.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  {pick("Environment", "环境")}
                </label>
                <select className={inputClass} value={selectedEnvironmentId} onChange={(event) => updateSearch({ environmentId: event.target.value })}>
                  {(environmentsQuery.data?.environments ?? []).map((environment) => (
                    <option key={environment.id} value={environment.id}>
                      {environment.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  {pick("Policy", "策略")}
                </label>
                <select className={inputClass} value={selectedGatePolicyId} onChange={(event) => updateSearch({ selectedGatePolicyId: event.target.value })}>
                  {gatePolicies.map((policy) => (
                    <option key={policy.id} value={policy.id}>
                      {policy.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ) : drawer === "waiver" ? (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {pick("Blocker", "阻塞项")}
              </label>
              <select className={inputClass} value={selectedBlockerKey} onChange={(event) => updateSearch({ blockerKey: event.target.value })}>
                {blockers.map((blocker) => (
                  <option key={blocker.id} value={blocker.id}>
                    {blocker.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {pick("Reason", "原因")}
              </label>
              <textarea className={`${inputClass} min-h-[140px]`} value={waiverReason} onChange={(event) => setWaiverReason(event.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {pick("Requested by", "申请人")}
              </label>
              <input className={inputClass} value={waiverRequestedBy} onChange={(event) => setWaiverRequestedBy(event.target.value)} />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {pick("Actor", "审批人")}
              </label>
              <input className={inputClass} value={approvalActor} onChange={(event) => setApprovalActor(event.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {pick("Role", "角色")}
              </label>
              <input className={inputClass} value={approvalRole} onChange={(event) => setApprovalRole(event.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {pick("Detail", "说明")}
              </label>
              <textarea className={`${inputClass} min-h-[140px]`} value={approvalDetail} onChange={(event) => setApprovalDetail(event.target.value)} />
            </div>
          </div>
        )}
      </PlatformDrawer>
    </PlatformPageShell>
  );
};
