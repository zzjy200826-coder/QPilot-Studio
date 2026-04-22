import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GateSignal, ReleaseCandidate, ReleaseGateDetail, Waiver } from "@qpilot/shared";
import { Link, useParams } from "react-router-dom";
import { useI18n } from "../i18n/I18nProvider";
import { api } from "../lib/api";
import { PlatformBadge } from "../platform/PlatformBadge";
import { usePlatformDensity } from "../platform/PlatformDensity";
import { PlatformDrawer } from "../platform/PlatformDrawer";
import { PlatformEmptyState } from "../platform/PlatformEmptyState";
import { PlatformErrorBanner } from "../platform/PlatformErrorBanner";
import { PlatformFormField } from "../platform/PlatformFormField";
import { PlatformMetricCard } from "../platform/PlatformMetricCard";
import { PlatformPageShell } from "../platform/PlatformPageShell";
import { PlatformSectionHeader } from "../platform/PlatformSectionHeader";

type DrawerKind = "waiver" | "approval" | null;

const verdictTone: Record<string, "success" | "warning" | "danger" | "neutral" | "violet"> = {
  ship: "success",
  watch: "warning",
  hold: "danger",
  draft: "neutral",
  waived: "violet"
};

const signalTone: Record<string, "success" | "warning" | "danger" | "violet"> = {
  passed: "success",
  warning: "warning",
  failed: "danger",
  waived: "violet"
};

const waiverTone: Record<Waiver["status"], "violet" | "neutral" | "danger"> = {
  active: "violet",
  expired: "neutral",
  revoked: "danger"
};

const kindOrder: GateSignal["kind"][] = ["functional", "benchmark", "load"];

const releaseStatusLabel = (status: string, language: "en" | "zh-CN"): string => {
  if (language !== "zh-CN") {
    return status.toUpperCase();
  }

  switch (status) {
    case "ship":
      return "\u53ef\u53d1\u5e03";
    case "watch":
      return "\u89c2\u5bdf";
    case "hold":
      return "\u963b\u585e";
    case "draft":
      return "\u8349\u7a3f";
    case "waived":
      return "\u5df2\u8c41\u514d";
    default:
      return status;
  }
};

const signalStatusLabel = (status: GateSignal["status"], language: "en" | "zh-CN"): string => {
  if (language !== "zh-CN") {
    return status.toUpperCase();
  }

  switch (status) {
    case "passed":
      return "\u901a\u8fc7";
    case "warning":
      return "\u5173\u6ce8";
    case "failed":
      return "\u5931\u8d25";
    case "waived":
      return "\u5df2\u8c41\u514d";
    default:
      return status;
  }
};

const signalKindLabel = (kind: GateSignal["kind"], language: "en" | "zh-CN"): string => {
  if (language !== "zh-CN") {
    switch (kind) {
      case "functional":
        return "Functional";
      case "benchmark":
        return "Benchmark";
      case "load":
        return "Load";
      default:
        return kind;
    }
  }

  switch (kind) {
    case "functional":
      return "\u529f\u80fd";
    case "benchmark":
      return "\u57fa\u51c6";
    case "load":
      return "\u538b\u6d4b";
    default:
      return kind;
  }
};

const waiverStatusLabel = (status: Waiver["status"], language: "en" | "zh-CN"): string => {
  if (language !== "zh-CN") {
    return status.toUpperCase();
  }

  switch (status) {
    case "active":
      return "\u751f\u6548\u4e2d";
    case "expired":
      return "\u5df2\u8fc7\u671f";
    case "revoked":
      return "\u5df2\u64a4\u9500";
    default:
      return status;
  }
};

const approvalActionLabel = (action: string, language: "en" | "zh-CN"): string => {
  if (language !== "zh-CN") {
    return action.replace(/_/g, " ");
  }

  switch (action) {
    case "release_approved":
      return "\u53d1\u5e03\u5df2\u6279\u51c6";
    case "release_reviewed":
      return "\u53d1\u5e03\u5df2\u5ba1\u9605";
    case "waiver_requested":
      return "\u8c41\u514d\u5df2\u53d1\u8d77";
    case "waiver_approved":
      return "\u8c41\u514d\u5df2\u6279\u51c6";
    default:
      return action.replace(/_/g, " ");
  }
};

const localizeSummary = (value: string, language: "en" | "zh-CN"): string => {
  if (language !== "zh-CN") {
    return value;
  }

  switch (value) {
    case "Release evidence is healthy across functional, benchmark, and load signals.":
      return "\u529f\u80fd\u3001\u57fa\u51c6\u548c\u538b\u6d4b\u4fe1\u53f7\u6574\u4f53\u5065\u5eb7\uff0c\u5f53\u524d\u53d1\u5e03\u8bc1\u636e\u53ef\u4ee5\u652f\u6491\u653e\u884c\u3002";
    case "Release evidence is mostly healthy, but at least one signal still needs attention or waiver review.":
      return "\u6574\u4f53\u8bc1\u636e\u57fa\u672c\u5065\u5eb7\uff0c\u4f46\u4ecd\u6709\u81f3\u5c11\u4e00\u4e2a\u4fe1\u53f7\u9700\u8981\u7ee7\u7eed\u5173\u6ce8\u6216\u8c41\u514d\u5ba1\u67e5\u3002";
    case "Release evidence contains blocking signals that should stop promotion.":
      return "\u5f53\u524d\u53d1\u5e03\u8bc1\u636e\u4e2d\u4ecd\u6709\u963b\u585e\u4fe1\u53f7\uff0c\u5e94\u8be5\u505c\u6b62\u7ee7\u7eed\u63a8\u8fdb\u53d1\u5e03\u3002";
    default:
      return value;
  }
};

const localizeSignalDetail = (value: string, language: "en" | "zh-CN"): string => {
  if (language !== "zh-CN") {
    return value;
  }

  if (value === "No recent functional run matched this required flow.") {
    return "\u6700\u8fd1\u6ca1\u6709\u5339\u914d\u5230\u8fd9\u4e2a\u5fc5\u8fc7\u529f\u80fd\u6d41\u7684\u8fd0\u884c\u3002";
  }

  if (value === "No load run evidence was found for this required profile.") {
    return "\u8fd9\u4e2a\u5fc5\u9700\u7684\u538b\u6d4b\u914d\u7f6e\u8fd8\u6ca1\u6709\u5bf9\u5e94\u7684\u8fd0\u884c\u8bc1\u636e\u3002";
  }

  const matchingPass = value.match(/^Latest matching run (.+) passed\.$/);
  if (matchingPass) {
    return `\u6700\u8fd1\u4e00\u6b21\u5339\u914d\u8fd0\u884c ${matchingPass[1]} \u5df2\u901a\u8fc7\u3002`;
  }

  const matchingEnded = value.match(/^Latest matching run (.+) ended as (.+)\.$/);
  if (matchingEnded) {
    return `\u6700\u8fd1\u4e00\u6b21\u5339\u914d\u8fd0\u884c ${matchingEnded[1]} \u7684\u7ed3\u679c\u4e3a ${releaseStatusLabel(
      matchingEnded[2] ?? "",
      language
    )}\u3002`;
  }

  const coverage = value.match(/^Coverage ([\d.]+)% vs required ([\d.]+)%\.$/);
  if (coverage) {
    return `\u8986\u76d6\u7387 ${coverage[1]}%\uff0c\u8981\u6c42\u81f3\u5c11 ${coverage[2]}%\u3002`;
  }

  const passRate = value.match(/^Pass rate ([\d.]+)% vs required ([\d.]+)%\.$/);
  if (passRate) {
    return `\u901a\u8fc7\u7387 ${passRate[1]}%\uff0c\u8981\u6c42\u81f3\u5c11 ${passRate[2]}%\u3002`;
  }

  const latestLoad = value.match(/^Latest run (.+) produced (SHIP|WATCH|HOLD) in (.+)\.$/);
  if (latestLoad) {
    return `\u6700\u8fd1\u4e00\u6b21\u8fd0\u884c ${latestLoad[1]} \u5728 ${latestLoad[3]} \u7684\u7ed3\u8bba\u4e3a ${releaseStatusLabel(
      (latestLoad[2] ?? "").toLowerCase(),
      language
    )}\u3002`;
  }

  return value;
};

const signalSourceHref = (signal: GateSignal): string | null => {
  if (!signal.sourceId) {
    return null;
  }

  switch (signal.kind) {
    case "functional":
      return `/runs/${signal.sourceId}`;
    case "load":
      return `/platform/load/runs/${signal.sourceId}`;
    default:
      return null;
  }
};

const signalSourceLabel = (signal: GateSignal, language: "en" | "zh-CN"): string => {
  if (language !== "zh-CN") {
    return signal.kind === "load" ? "Open load run" : "Open source run";
  }

  return signal.kind === "load" ? "\u6253\u5f00\u538b\u6d4b\u8fd0\u884c" : "\u6253\u5f00\u6e90\u8fd0\u884c";
};

export const ReleaseDetailPage = () => {
  const { releaseId = "" } = useParams();
  const { formatDateTime, formatRelativeTime, language, pick } = useI18n();
  const { isDense } = usePlatformDensity();
  const queryClient = useQueryClient();
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [selectedBlockerKey, setSelectedBlockerKey] = useState("");
  const [waiverReason, setWaiverReason] = useState(
    pick(
      "Temporary watch while mitigation is in progress.",
      "\u7f13\u89e3\u63aa\u65bd\u63a8\u8fdb\u4e2d\uff0c\u5148\u4e34\u65f6\u4fdd\u6301\u89c2\u5bdf\u3002"
    )
  );
  const [waiverRequestedBy, setWaiverRequestedBy] = useState("release-manager");
  const [approvalActor, setApprovalActor] = useState("qa-lead");
  const [approvalRole, setApprovalRole] = useState("qa-lead");
  const [approvalDetail, setApprovalDetail] = useState(
    pick(
      "Approved after reviewing load and benchmark evidence.",
      "\u5728\u67e5\u770b\u538b\u6d4b\u548c\u57fa\u51c6\u8bc1\u636e\u540e\u6279\u51c6\u53d1\u7248\u3002"
    )
  );

  const detailQuery = useQuery({
    queryKey: ["platform", "release-gates", releaseId],
    queryFn: () => api.getReleaseGateDetail(releaseId),
    enabled: Boolean(releaseId)
  });

  const auditQuery = useQuery({
    queryKey: ["platform", "release-audit", releaseId],
    queryFn: () => api.getReleaseAudit(releaseId),
    enabled: Boolean(releaseId)
  });

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects
  });

  const relatedReleasesQuery = useQuery({
    queryKey: ["platform", "releases", detailQuery.data?.release.projectId ?? "missing"],
    queryFn: () => api.listReleases(detailQuery.data?.release.projectId),
    enabled: Boolean(detailQuery.data?.release.projectId)
  });

  const environmentsQuery = useQuery({
    queryKey: ["platform", "environments", detailQuery.data?.release.projectId ?? "missing"],
    queryFn: () => api.getEnvironmentRegistry(detailQuery.data?.release.projectId),
    enabled: Boolean(detailQuery.data?.release.projectId)
  });

  const createWaiverMutation = useMutation({
    mutationFn: api.createWaiver,
    onSuccess: async () => {
      setDrawer(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["platform", "release-gates", releaseId] }),
        queryClient.invalidateQueries({ queryKey: ["platform", "release-audit", releaseId] }),
        queryClient.invalidateQueries({ queryKey: ["platform", "releases"] }),
        queryClient.invalidateQueries({ queryKey: ["platform", "control-tower"] })
      ]);
    }
  });

  const createApprovalMutation = useMutation({
    mutationFn: api.createReleaseApproval,
    onSuccess: async () => {
      setDrawer(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["platform", "release-gates", releaseId] }),
        queryClient.invalidateQueries({ queryKey: ["platform", "release-audit", releaseId] }),
        queryClient.invalidateQueries({ queryKey: ["platform", "releases"] }),
        queryClient.invalidateQueries({ queryKey: ["platform", "control-tower"] })
      ]);
    }
  });

  const detail = detailQuery.data;
  const release = detail?.release;
  const blockers = detail?.result.signals.filter((signal) => signal.status === "failed") ?? [];

  useEffect(() => {
    if (!selectedBlockerKey && blockers.length > 0) {
      setSelectedBlockerKey(blockers[0]?.id ?? "");
    }
  }, [blockers, selectedBlockerKey]);

  const project = useMemo(
    () => projectsQuery.data?.find((entry) => entry.id === release?.projectId),
    [projectsQuery.data, release?.projectId]
  );

  const environment = useMemo(
    () =>
      environmentsQuery.data?.environments.find((entry) => entry.id === release?.environmentId),
    [environmentsQuery.data, release?.environmentId]
  );

  const relatedReleases = useMemo(
    () =>
      (relatedReleasesQuery.data ?? [])
        .filter((entry) => entry.id !== releaseId)
        .slice(0, 6),
    [relatedReleasesQuery.data, releaseId]
  );

  const groupedSignals = useMemo(
    () =>
      kindOrder
        .map((kind) => ({
          kind,
          items: detail?.result.signals.filter((signal) => signal.kind === kind) ?? []
        }))
        .filter((group) => group.items.length > 0),
    [detail?.result.signals]
  );

  const approvalTimeline = auditQuery.data?.timeline.length
    ? auditQuery.data.timeline
    : detail?.approvalTimeline ?? [];

  const errors = [
    detailQuery.error instanceof Error ? detailQuery.error.message : null,
    auditQuery.error instanceof Error ? auditQuery.error.message : null,
    createWaiverMutation.error instanceof Error ? createWaiverMutation.error.message : null,
    createApprovalMutation.error instanceof Error ? createApprovalMutation.error.message : null
  ].filter((value): value is string => Boolean(value));

  const panelClass = `console-panel ${isDense ? "p-4" : "p-5"}`;
  const pageGap = isDense ? "gap-4" : "gap-6";
  const stackGap = isDense ? "space-y-4" : "space-y-6";
  const inputClass = "console-input text-sm";

  const saveWaiver = () => {
    if (!release || !selectedBlockerKey) {
      return;
    }

    createWaiverMutation.mutate({
      releaseId: release.id,
      blockerKey: selectedBlockerKey,
      reason: waiverReason,
      requestedBy: waiverRequestedBy,
      approvedBy: waiverRequestedBy,
      role: "release-manager",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    });
  };

  const saveApproval = () => {
    if (!release) {
      return;
    }

    createApprovalMutation.mutate({
      releaseId: release.id,
      actor: approvalActor,
      role: approvalRole,
      action: "release_approved",
      detail: approvalDetail
    });
  };

  const waiverActionLabel = createWaiverMutation.isPending
    ? pick("Applying...", "\u6b63\u5728\u7533\u8bf7...")
    : pick("Apply waiver", "\u7533\u8bf7\u8c41\u514d");
  const approvalActionLabelText = createApprovalMutation.isPending
    ? pick("Recording...", "\u6b63\u5728\u8bb0\u5f55...")
    : pick("Record approval", "\u8bb0\u5f55\u5ba1\u6279");

  return (
    <PlatformPageShell
      dense={isDense}
      accent="rose"
      badge={
        <PlatformBadge tone="danger" uppercase dense={isDense}>
          {pick("Release Detail", "\u53d1\u5e03\u8be6\u60c5")}
        </PlatformBadge>
      }
      projectLabel={project ? <PlatformBadge dense={isDense}>{project.name}</PlatformBadge> : undefined}
      title={
        release
          ? pick(
              `${release.name} release evidence and ship decision.`,
              `${release.name} \u7684\u53d1\u5e03\u8bc1\u636e\u4e0e\u653e\u884c\u5224\u65ad\u3002`
            )
          : pick(
              "Release evidence, blockers, and approvals.",
              "\u53d1\u5e03\u8bc1\u636e\u3001\u963b\u585e\u9879\u4e0e\u5ba1\u6279\u3002"
            )
      }
      actions={
        release ? (
          <>
            <Link
              to={`/platform/gates?projectId=${release.projectId}&releaseId=${release.id}`}
              className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            >
              {pick("Open Gate Center", "\u6253\u5f00\u53d1\u7248\u95e8\u7981")}
            </Link>
            <button
              type="button"
              disabled={blockers.length === 0}
              onClick={() => setDrawer("waiver")}
              className="console-button-primary text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pick("Apply waiver", "\u7533\u8bf7\u8c41\u514d")}
            </button>
            <button
              type="button"
              onClick={() => setDrawer("approval")}
              className="console-button-secondary text-sm"
            >
              {pick("Record approval", "\u8bb0\u5f55\u5ba1\u6279")}
            </button>
          </>
        ) : undefined
      }
      metrics={
        <>
          <PlatformMetricCard
            label={pick("Verdict", "\u7ed3\u8bba")}
            value={release ? releaseStatusLabel(detail?.result.verdict ?? release.status, language) : "-"}
            dense={isDense}
          />
          <PlatformMetricCard
            label={pick("Signals", "\u4fe1\u53f7")}
            value={detail?.result.signals.length ?? 0}
            dense={isDense}
          />
          <PlatformMetricCard
            label={pick("Blockers", "\u963b\u585e\u9879")}
            value={blockers.length}
            dense={isDense}
          />
          <PlatformMetricCard
            label={pick("Waivers", "\u8c41\u514d")}
            value={detail?.waivers.length ?? 0}
            dense={isDense}
          />
        </>
      }
    >
      <PlatformErrorBanner messages={errors} />

      {detailQuery.isLoading ? (
        <section className={panelClass}>
          <PlatformEmptyState
            message={pick("Loading release details...", "\u6b63\u5728\u52a0\u8f7d\u53d1\u5e03\u8be6\u60c5...")}
          />
        </section>
      ) : !detail ? (
        <section className={panelClass}>
          <PlatformEmptyState
            message={pick(
              "Release details are unavailable.",
              "\u6682\u65f6\u65e0\u6cd5\u83b7\u53d6\u8fd9\u6b21\u53d1\u5e03\u7684\u8be6\u60c5\u3002"
            )}
          />
        </section>
      ) : (
        <div className={`grid xl:grid-cols-[minmax(0,1.2fr)_360px] ${pageGap}`}>
          <div className={stackGap}>
            <section className={panelClass}>
              <PlatformSectionHeader
                eyebrow={pick("Overview", "\u603b\u89c8")}
                title={pick("Gate verdict", "\u95e8\u7981\u7ed3\u8bba")}
                description={localizeSummary(detail.result.summary, language)}
                dense={isDense}
                actions={
                  <PlatformBadge dense tone={verdictTone[detail.result.verdict] ?? "neutral"}>
                    {releaseStatusLabel(detail.result.verdict, language)}
                  </PlatformBadge>
                }
              />

              <div className={`mt-4 grid md:grid-cols-2 ${pageGap}`}>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">
                    {pick("Last evaluated", "\u6700\u8fd1\u8bc4\u4f30")}
                  </p>
                  <p className="mt-2 text-sm font-medium text-slate-900">
                    {formatDateTime(detail.result.evaluatedAt)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatRelativeTime(detail.result.evaluatedAt)}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">
                    {pick("Blocking labels", "\u963b\u585e\u6807\u7b7e")}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {detail.result.blockers.length > 0 ? (
                      detail.result.blockers.map((blocker) => (
                        <span
                          key={blocker}
                          className="rounded-full border border-rose-200 bg-white px-3 py-1 text-xs font-medium text-rose-700"
                        >
                          {blocker}
                        </span>
                      ))
                    ) : (
                      <span className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-medium text-emerald-700">
                        {pick("No blocking signal", "\u6ca1\u6709\u963b\u585e\u4fe1\u53f7")}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className={panelClass}>
              <PlatformSectionHeader
                eyebrow={pick("Signals", "\u4fe1\u53f7")}
                title={pick("Release evidence", "\u53d1\u5e03\u8bc1\u636e")}
                description={pick(
                  "Review the functional, benchmark, and load evidence used by the current verdict.",
                  "\u67e5\u770b\u5f53\u524d\u7ed3\u8bba\u4f9d\u8d56\u7684\u529f\u80fd\u3001\u57fa\u51c6\u548c\u538b\u6d4b\u8bc1\u636e\u3002"
                )}
                dense={isDense}
              />

              <div className="mt-4 space-y-4">
                {groupedSignals.map((group) => (
                  <div key={group.kind} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900">
                        {signalKindLabel(group.kind, language)}
                      </p>
                      <span className="text-xs text-slate-500">
                        {pick("Signals", "\u4fe1\u53f7")} {group.items.length}
                      </span>
                    </div>

                    <div className="mt-4 space-y-3">
                      {group.items.map((signal) => {
                        const href = signalSourceHref(signal);

                        return (
                          <article
                            key={signal.id}
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="font-medium text-slate-900">{signal.label}</p>
                                <p className="mt-2 text-xs leading-5 text-slate-600">
                                  {localizeSignalDetail(signal.detail, language)}
                                </p>
                              </div>
                              <PlatformBadge dense tone={signalTone[signal.status] ?? "warning"}>
                                {signalStatusLabel(signal.status, language)}
                              </PlatformBadge>
                            </div>

                            {href ? (
                              <div className="mt-3">
                                <Link
                                  to={href}
                                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700"
                                >
                                  {signalSourceLabel(signal, language)}
                                </Link>
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className={panelClass}>
              <PlatformSectionHeader
                eyebrow={pick("Waivers", "\u8c41\u514d")}
                title={pick("Blockers and waivers", "\u963b\u585e\u9879\u4e0e\u8c41\u514d")}
                description={pick(
                  "Failed signals can be acknowledged temporarily, but the reason and owner should stay visible.",
                  "\u5931\u8d25\u4fe1\u53f7\u53ef\u4ee5\u4e34\u65f6\u8c41\u514d\uff0c\u4f46\u539f\u56e0\u548c\u8d23\u4efb\u4eba\u5fc5\u987b\u4fdd\u6301\u53ef\u89c1\u3002"
                )}
                dense={isDense}
                actions={
                  blockers.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setDrawer("waiver")}
                      className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white"
                    >
                      {pick("Apply waiver", "\u7533\u8bf7\u8c41\u514d")}
                    </button>
                  ) : undefined
                }
              />

              <div className={`mt-4 grid lg:grid-cols-2 ${pageGap}`}>
                <div className="space-y-3">
                  {blockers.length > 0 ? (
                    blockers.map((signal) => (
                      <article
                        key={signal.id}
                        className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium">{signal.label}</p>
                          <button
                            type="button"
                            onClick={() => setSelectedBlockerKey(signal.id)}
                            className="rounded-full border border-rose-200 bg-white px-3 py-1 text-xs font-medium text-rose-700"
                          >
                            {selectedBlockerKey === signal.id
                              ? pick("Selected", "\u5df2\u9009\u4e2d")
                              : pick("Choose", "\u9009\u62e9")}
                          </button>
                        </div>
                        <p className="mt-2 text-xs leading-5">
                          {localizeSignalDetail(signal.detail, language)}
                        </p>
                      </article>
                    ))
                  ) : (
                    <PlatformEmptyState
                      message={pick("No active blocker.", "\u5f53\u524d\u6ca1\u6709\u9700\u8981\u8c41\u514d\u7684\u963b\u585e\u9879\u3002")}
                    />
                  )}
                </div>

                <div className="space-y-3">
                  {detail.waivers.length > 0 ? (
                    detail.waivers.map((waiver) => (
                      <article
                        key={waiver.id}
                        className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-slate-900">{waiver.blockerKey}</p>
                          <PlatformBadge dense tone={waiverTone[waiver.status]}>
                            {waiverStatusLabel(waiver.status, language)}
                          </PlatformBadge>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-slate-600">{waiver.reason}</p>
                        <p className="mt-2 text-xs text-slate-500">
                          {pick("Requested by", "\u7533\u8bf7\u4eba")} {waiver.requestedBy} ·{" "}
                          {pick("expires", "\u5230\u671f")} {formatDateTime(waiver.expiresAt)}
                        </p>
                      </article>
                    ))
                  ) : (
                    <PlatformEmptyState
                      message={pick("No waiver recorded yet.", "\u8fd8\u6ca1\u6709\u8bb0\u5f55\u4efb\u4f55\u8c41\u514d\u3002")}
                    />
                  )}
                </div>
              </div>
            </section>

            <section className={panelClass}>
              <PlatformSectionHeader
                eyebrow={pick("Audit", "\u5ba1\u8ba1")}
                title={pick("Approval timeline", "\u5ba1\u6279\u65f6\u95f4\u7ebf")}
                description={pick(
                  "Keep the release decision traceable with explicit approval events.",
                  "\u7528\u660e\u786e\u7684\u5ba1\u6279\u4e8b\u4ef6\u628a\u8fd9\u6b21\u53d1\u5e03\u51b3\u7b56\u7559\u75d5\u3002"
                )}
                dense={isDense}
                actions={
                  <button
                    type="button"
                    onClick={() => setDrawer("approval")}
                    className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700"
                  >
                    {pick("Record approval", "\u8bb0\u5f55\u5ba1\u6279")}
                  </button>
                }
              />

              <div className="mt-4 space-y-3">
                {approvalTimeline.length > 0 ? (
                  approvalTimeline.map((event) => (
                    <article
                      key={event.id}
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="font-medium text-slate-900">
                          {approvalActionLabel(event.action, language)}
                        </p>
                        <p className="text-xs text-slate-500">{formatDateTime(event.createdAt)}</p>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {event.actor} · {event.role}
                      </p>
                      {event.detail ? (
                        <p className="mt-2 text-xs leading-5 text-slate-600">{event.detail}</p>
                      ) : null}
                    </article>
                  ))
                ) : (
                  <PlatformEmptyState
                    message={pick("No approval event yet.", "\u8fd8\u6ca1\u6709\u5ba1\u6279\u4e8b\u4ef6\u3002")}
                  />
                )}
              </div>
            </section>
          </div>

          <aside className={stackGap}>
            <section className={panelClass}>
              <PlatformSectionHeader
                eyebrow={pick("Release", "\u53d1\u5e03")}
                title={pick("Metadata", "\u5143\u4fe1\u606f")}
                dense={isDense}
              />

              <div className="mt-4 space-y-3 text-sm">
                {[
                  {
                    label: pick("Build label", "\u6784\u5efa\u6807\u7b7e"),
                    value: detail.release.buildLabel
                  },
                  {
                    label: pick("Build ID", "\u6784\u5efa ID"),
                    value: detail.release.buildId ?? pick("Unbound", "\u672a\u7ed1\u5b9a")
                  },
                  {
                    label: pick("Commit SHA", "\u63d0\u4ea4 SHA"),
                    value: detail.release.commitSha ?? pick("Unbound", "\u672a\u7ed1\u5b9a")
                  },
                  {
                    label: pick("Environment", "\u73af\u5883"),
                    value:
                      environment?.name ??
                      release?.environmentId ??
                      pick("Unbound", "\u672a\u7ed1\u5b9a")
                  },
                  {
                    label: pick("Policy", "\u7b56\u7565"),
                    value: detail.policy.name
                  },
                  {
                    label: pick("Created", "\u521b\u5efa\u65f6\u95f4"),
                    value: formatDateTime(detail.release.createdAt)
                  },
                  {
                    label: pick("Updated", "\u66f4\u65b0\u65f6\u95f4"),
                    value: formatDateTime(detail.release.updatedAt)
                  }
                ].map((row) => (
                  <div
                    key={row.label}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                  >
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{row.label}</p>
                    <p className="mt-2 font-medium text-slate-900">{row.value}</p>
                  </div>
                ))}

                {detail.release.notes ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                      {pick("Notes", "\u5907\u6ce8")}
                    </p>
                    <p className="mt-2 leading-6 text-slate-700">{detail.release.notes}</p>
                  </div>
                ) : null}

                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                    {pick("Evidence bindings", "\u8bc1\u636e\u7ed1\u5b9a")}
                  </p>
                  <div className="mt-3 space-y-4">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {pick("Functional source runs", "\u529f\u80fd\u6e90\u8fd0\u884c")}
                      </p>
                      {detail.release.sourceRunIds.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {detail.release.sourceRunIds.map((runId) => (
                            <Link
                              key={runId}
                              to={`/runs/${runId}`}
                              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                            >
                              {runId}
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-slate-500">
                          {pick(
                            "Unbound. Functional gate signals fall back to the latest project runs.",
                            "\u672a\u7ed1\u5b9a\uff0c\u529f\u80fd\u95e8\u7981\u4fe1\u53f7\u4f1a\u56de\u9000\u5230\u9879\u76ee\u6700\u65b0\u8fd0\u884c\u3002"
                          )}
                        </p>
                      )}
                    </div>

                    <div>
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {pick("Load source runs", "\u538b\u6d4b\u6e90\u8fd0\u884c")}
                      </p>
                      {detail.release.sourceLoadRunIds.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {detail.release.sourceLoadRunIds.map((runId) => (
                            <Link
                              key={runId}
                              to={`/platform/load/runs/${runId}`}
                              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                            >
                              {runId}
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-slate-500">
                          {pick(
                            "Unbound. Load gate signals fall back to the latest project load evidence.",
                            "\u672a\u7ed1\u5b9a\uff0c\u538b\u6d4b\u95e8\u7981\u4fe1\u53f7\u4f1a\u56de\u9000\u5230\u9879\u76ee\u6700\u65b0\u538b\u6d4b\u8bc1\u636e\u3002"
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className={panelClass}>
              <PlatformSectionHeader
                eyebrow={pick("Policy", "\u7b56\u7565")}
                title={pick("Policy snapshot", "\u7b56\u7565\u5feb\u7167")}
                description={pick(
                  "This release is evaluated against the current gate policy snapshot.",
                  "\u8fd9\u6b21\u53d1\u5e03\u662f\u6309\u7167\u5f53\u524d\u95e8\u7981\u7b56\u7565\u5feb\u7167\u6765\u8bc4\u4f30\u7684\u3002"
                )}
                dense={isDense}
              />

              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                    {pick("Required functional flows", "\u5fc5\u8fc7\u529f\u80fd\u6d41")}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {detail.policy.requiredFunctionalFlows.length > 0 ? (
                      detail.policy.requiredFunctionalFlows.map((flow) => (
                        <span
                          key={flow}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700"
                        >
                          {flow}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-slate-500">
                        {pick(
                          "No required flow configured.",
                          "\u8fd8\u6ca1\u6709\u914d\u7f6e\u5fc5\u8fc7\u529f\u80fd\u6d41\u3002"
                        )}
                      </span>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                    {pick("Thresholds", "\u9608\u503c")}
                  </p>
                  <div className="mt-3 space-y-2">
                    <p>
                      {pick("Benchmark coverage", "\u57fa\u51c6\u8986\u76d6\u7387")} ·{" "}
                      {detail.policy.minBenchmarkCoveragePct}%
                    </p>
                    <p>
                      {pick("Benchmark pass rate", "\u57fa\u51c6\u901a\u8fc7\u7387")} ·{" "}
                      {detail.policy.minBenchmarkPassRate}%
                    </p>
                    <p>
                      {pick("Minimum load verdict", "\u6700\u4f4e\u538b\u6d4b\u7ed3\u8bba")} ·{" "}
                      {releaseStatusLabel(detail.policy.minimumLoadVerdict, language)}
                    </p>
                    <p>
                      {pick("Waiver allowed", "\u5141\u8bb8\u8c41\u514d")} ·{" "}
                      {detail.policy.allowWaiver ? pick("Yes", "\u662f") : pick("No", "\u5426")}
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                    {pick("Approver roles", "\u5ba1\u6279\u89d2\u8272")}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {detail.policy.approverRoles.length > 0 ? (
                      detail.policy.approverRoles.map((role) => (
                        <span
                          key={role}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700"
                        >
                          {role}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-slate-500">
                        {pick(
                          "No approver role configured.",
                          "\u8fd8\u6ca1\u6709\u914d\u7f6e\u5ba1\u6279\u89d2\u8272\u3002"
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className={panelClass}>
              <PlatformSectionHeader
                eyebrow={pick("Releases", "\u53d1\u5e03")}
                title={pick("Nearby queue", "\u76f8\u90bb\u961f\u5217")}
                description={pick(
                  "Use nearby releases to compare what changed before and after this candidate.",
                  "\u67e5\u770b\u76f8\u90bb\u53d1\u5e03\uff0c\u65b9\u4fbf\u7406\u89e3\u8fd9\u6b21\u5019\u9009\u524d\u540e\u53d1\u751f\u4e86\u4ec0\u4e48\u53d8\u5316\u3002"
                )}
                dense={isDense}
              />

              <div className="mt-4 space-y-3">
                {relatedReleases.length > 0 ? (
                  relatedReleases.map((entry: ReleaseCandidate) => (
                    <Link
                      key={entry.id}
                      to={`/platform/releases/${entry.id}`}
                      className="block rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-slate-300 hover:bg-white"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{entry.name}</p>
                          <p className="mt-1 truncate text-xs text-slate-500">{entry.buildLabel}</p>
                        </div>
                        <PlatformBadge dense tone={verdictTone[entry.status] ?? "neutral"}>
                          {releaseStatusLabel(entry.status, language)}
                        </PlatformBadge>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        {formatRelativeTime(entry.updatedAt)}
                      </p>
                    </Link>
                  ))
                ) : (
                  <PlatformEmptyState
                    message={pick("No nearby release yet.", "\u8fd8\u6ca1\u6709\u53ef\u4f9b\u5bf9\u6bd4\u7684\u76f8\u90bb\u53d1\u5e03\u3002")}
                  />
                )}
              </div>
            </section>
          </aside>
        </div>
      )}

      <PlatformDrawer
        open={drawer !== null}
        title={
          drawer === "waiver"
            ? pick("Apply waiver", "\u7533\u8bf7\u8c41\u514d")
            : pick("Record approval", "\u8bb0\u5f55\u5ba1\u6279")
        }
        description={
          drawer === "waiver"
            ? pick(
                "Temporarily acknowledge a blocker with an explicit reason.",
                "\u7528\u660e\u786e\u539f\u56e0\u4e34\u65f6\u786e\u8ba4\u4e00\u4e2a\u963b\u585e\u9879\u3002"
              )
            : pick(
                "Create an explicit approval event for this release.",
                "\u4e3a\u8fd9\u6b21\u53d1\u5e03\u8865\u4e00\u6761\u660e\u786e\u7684\u5ba1\u6279\u4e8b\u4ef6\u3002"
              )
        }
        onClose={() => setDrawer(null)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setDrawer(null)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700"
            >
              {pick("Cancel", "\u53d6\u6d88")}
            </button>
            <button
              type="button"
              onClick={drawer === "waiver" ? saveWaiver : saveApproval}
              disabled={createWaiverMutation.isPending || createApprovalMutation.isPending}
              className="rounded-lg border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {drawer === "waiver" ? waiverActionLabel : approvalActionLabelText}
            </button>
          </>
        }
      >
        {drawer === "waiver" ? (
          <div className="space-y-4">
            <PlatformFormField label={pick("Blocker", "\u963b\u585e\u9879")}>
              <select
                className={inputClass}
                value={selectedBlockerKey}
                onChange={(event) => setSelectedBlockerKey(event.target.value)}
              >
                {blockers.map((blocker) => (
                  <option key={blocker.id} value={blocker.id}>
                    {blocker.label}
                  </option>
                ))}
              </select>
            </PlatformFormField>

            <PlatformFormField label={pick("Reason", "\u539f\u56e0")}>
              <textarea
                className={`${inputClass} min-h-[140px]`}
                value={waiverReason}
                onChange={(event) => setWaiverReason(event.target.value)}
              />
            </PlatformFormField>

            <PlatformFormField label={pick("Requested by", "\u7533\u8bf7\u4eba")}>
              <input
                className={inputClass}
                value={waiverRequestedBy}
                onChange={(event) => setWaiverRequestedBy(event.target.value)}
              />
            </PlatformFormField>
          </div>
        ) : (
          <div className="space-y-4">
            <PlatformFormField label={pick("Actor", "\u5ba1\u6279\u4eba")}>
              <input
                className={inputClass}
                value={approvalActor}
                onChange={(event) => setApprovalActor(event.target.value)}
              />
            </PlatformFormField>

            <PlatformFormField label={pick("Role", "\u89d2\u8272")}>
              <input
                className={inputClass}
                value={approvalRole}
                onChange={(event) => setApprovalRole(event.target.value)}
              />
            </PlatformFormField>

            <PlatformFormField label={pick("Detail", "\u8bf4\u660e")}>
              <textarea
                className={`${inputClass} min-h-[140px]`}
                value={approvalDetail}
                onChange={(event) => setApprovalDetail(event.target.value)}
              />
            </PlatformFormField>
          </div>
        )}
      </PlatformDrawer>
    </PlatformPageShell>
  );
};
