import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useI18n } from "../i18n/I18nProvider";
import { api } from "../lib/api";
import { buildSparklinePath } from "../lib/sparkline";
import { usePlatformDensity } from "../platform/PlatformDensity";

const serviceTone: Record<string, string> = {
  online: "border-emerald-200 bg-emerald-50 text-emerald-700",
  degraded: "border-amber-200 bg-amber-50 text-amber-700",
  offline: "border-rose-200 bg-rose-50 text-rose-700",
  not_configured: "border-slate-200 bg-slate-100 text-slate-600"
};

const verdictTone: Record<string, string> = {
  ship: "border-emerald-200 bg-emerald-50 text-emerald-700",
  watch: "border-amber-200 bg-amber-50 text-amber-800",
  hold: "border-rose-200 bg-rose-50 text-rose-700",
  draft: "border-slate-200 bg-slate-100 text-slate-600",
  waived: "border-violet-200 bg-violet-50 text-violet-700"
};

const serviceLabel = (id: string) => {
  switch (id) {
    case "postgres":
      return "Postgres";
    case "redis":
      return "Redis";
    case "prometheus":
      return "Prometheus";
    case "artifacts":
      return "Artifact Store";
    default:
      return id;
  }
};

const MetricCard = ({
  label,
  value,
  dense
}: {
  label: string;
  value: string | number;
  dense: boolean;
}) => (
  <article
    className={`rounded-2xl border border-slate-200 bg-slate-50 ${
      dense ? "px-3 py-2.5" : "px-4 py-3"
    }`}
  >
    <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
    <p className={`font-semibold text-slate-950 ${dense ? "mt-1 text-xl" : "mt-2 text-2xl"}`}>
      {value}
    </p>
  </article>
);

export const ControlTowerPage = () => {
  const { formatRelativeTime, pick } = useI18n();
  const { isDense } = usePlatformDensity();
  const [searchParams, setSearchParams] = useSearchParams();
  const [projectId, setProjectId] = useState(searchParams.get("projectId") ?? "");

  const updateProject = (nextProjectId: string) => {
    setProjectId(nextProjectId);
    const next = new URLSearchParams(
      typeof window === "undefined" ? searchParams.toString() : window.location.search
    );
    if (nextProjectId) {
      next.set("projectId", nextProjectId);
    } else {
      next.delete("projectId");
    }
    setSearchParams(next, { replace: true });
  };

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
  const towerQuery = useQuery({
    queryKey: ["platform", "control-tower", projectId || "all"],
    queryFn: () => api.getControlTowerSummary(projectId || undefined),
    refetchInterval: 15_000
  });
  const infrastructureQuery = useQuery({
    queryKey: ["platform", "infra"],
    queryFn: api.getPlatformInfrastructure,
    refetchInterval: 15_000
  });
  const queueQuery = useQuery({
    queryKey: ["platform", "load-queue"],
    queryFn: api.getPlatformLoadQueueSummary,
    refetchInterval: 5_000
  });
  const releasesQuery = useQuery({
    queryKey: ["platform", "releases", projectId || "all"],
    queryFn: () => api.listReleases(projectId || undefined),
    refetchInterval: 15_000
  });
  const loadRunsQuery = useQuery({
    queryKey: ["platform", "load-runs", projectId || "all"],
    queryFn: () => api.listPlatformLoadRuns({ projectId: projectId || undefined, limit: 8 }),
    refetchInterval: 15_000
  });

  useEffect(() => {
    if (!projectId && (projectsQuery.data?.length ?? 0) > 0) {
      updateProject(projectsQuery.data?.[0]?.id ?? "");
    }
  }, [projectId, projectsQuery.data]);

  const summary = towerQuery.data;
  const infrastructure = infrastructureQuery.data;
  const queue = queueQuery.data;
  const releases = releasesQuery.data ?? [];
  const recentLoadRuns = loadRunsQuery.data ?? [];
  const selectedProject = useMemo(
    () => projectsQuery.data?.find((project) => project.id === projectId),
    [projectId, projectsQuery.data]
  );
  const queueTrend = useMemo(() => {
    if (!queue) {
      return null;
    }

    return {
      waiting: buildSparklinePath(queue.samples.map((entry) => entry.waiting), 220, 56),
      active: buildSparklinePath(queue.samples.map((entry) => entry.active), 220, 56),
      failed: buildSparklinePath(queue.samples.map((entry) => entry.failed), 220, 56)
    };
  }, [queue]);

  const panelClass = `rounded-[28px] border border-slate-200 bg-white ${isDense ? "p-4" : "p-5"}`;
  const sectionLabelClass = "text-[11px] uppercase tracking-[0.28em] text-slate-400";
  const heroPadding = isDense ? "p-5" : "p-6";
  const pageGap = isDense ? "space-y-4" : "space-y-6";
  const tableCellClass = isDense ? "py-3 pr-4" : "py-4 pr-4";

  return (
    <section className={pageGap}>
      <div
        className={`rounded-[32px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,#bfdbfe,transparent_35%),linear-gradient(135deg,#ffffff,#f8fafc)] shadow-sm ${heroPadding}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-4xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.28em] text-sky-700">
                {pick("Control Tower", "控制塔")}
              </span>
              {selectedProject ? (
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
                  {selectedProject.name}
                </span>
              ) : null}
            </div>
            <h2 className={`font-semibold tracking-tight text-slate-950 ${isDense ? "mt-3 text-2xl" : "mt-4 text-3xl"}`}>
              {pick("Release, queue, and infra status.", "发布、队列与基础设施状态。")}
            </h2>
            <div className="mt-4 flex flex-wrap gap-3">
              <select
                className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700"
                value={projectId}
                onChange={(event) => updateProject(event.target.value)}
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
              <Link
                to="/platform/gates"
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700"
              >
                {pick("Open Gate Center", "打开门禁台")}
              </Link>
              <a
                href={`${api.runtimeBase}/metrics`}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700"
              >
                /metrics
              </a>
            </div>
          </div>

          <aside className="grid gap-3 rounded-[28px] border border-slate-200 bg-white/90 p-5 sm:grid-cols-2">
            <MetricCard
              label={pick("Active releases", "活动发布")}
              value={summary?.activeReleaseCount ?? 0}
              dense={isDense}
            />
            <MetricCard
              label={pick("Blocked releases", "阻塞发布")}
              value={summary?.blockedReleaseCount ?? 0}
              dense={isDense}
            />
            <MetricCard
              label={pick("Active load runs", "活动压测")}
              value={summary?.activeLoadRunCount ?? 0}
              dense={isDense}
            />
            <MetricCard
              label={pick("Online workers", "在线 worker")}
              value={summary?.onlineWorkerCount ?? 0}
              dense={isDense}
            />
          </aside>
        </div>
      </div>

      <div className={`grid xl:grid-cols-[minmax(0,1.2fr)_360px] ${isDense ? "gap-4" : "gap-6"}`}>
        <div className={pageGap}>
          <section className={panelClass}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className={sectionLabelClass}>{pick("Infrastructure", "基础设施")}</p>
                <h3 className={`font-semibold text-slate-950 ${isDense ? "mt-1 text-xl" : "mt-2 text-2xl"}`}>
                  {pick("Dependencies", "依赖状态")}
                </h3>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                  {`${pick("online", "在线")} ${infrastructure?.onlineCount ?? 0}`}
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                  {`${pick("degraded", "降级")} ${infrastructure?.degradedCount ?? 0}`}
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                  {`${pick("offline", "离线")} ${infrastructure?.offlineCount ?? 0}`}
                </span>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-[0.22em] text-slate-400">
                    <th className="pb-3 pr-4">{pick("Service", "服务")}</th>
                    <th className="pb-3 pr-4">{pick("State", "状态")}</th>
                    <th className="pb-3 pr-4">{pick("Endpoint", "地址")}</th>
                    <th className="pb-3">{pick("Detail", "详情")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(infrastructure?.services ?? []).map((service) => (
                    <tr key={service.id}>
                      <td className={tableCellClass}>
                        <p className="font-medium text-slate-900">{serviceLabel(service.id)}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {service.configured
                            ? pick("configured", "已配置")
                            : pick("not configured", "未配置")}
                        </p>
                      </td>
                      <td className={tableCellClass}>
                        <span
                          className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] ${
                            serviceTone[service.state] ?? serviceTone.not_configured
                          }`}
                        >
                          {service.state.replace("_", " ")}
                        </span>
                      </td>
                      <td className={`${tableCellClass} text-xs text-slate-500`}>
                        {service.endpoint ?? "—"}
                      </td>
                      <td className={`${isDense ? "py-3" : "py-4"} text-slate-600`}>
                        {service.detail}
                        {typeof service.latencyMs === "number" ? (
                          <span className="ml-2 text-xs text-slate-500">{`${service.latencyMs} ms`}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={panelClass}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className={sectionLabelClass}>{pick("Queue", "队列")}</p>
                <h3 className={`font-semibold text-slate-950 ${isDense ? "mt-1 text-xl" : "mt-2 text-2xl"}`}>
                  {pick("Load dispatch", "压测调度")}
                </h3>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                  {`${queue?.mode ?? "inline"} · ${queue?.queueName ?? "platform-load-runs"}`}
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                  {`${pick("retry", "重试")} ${queue?.retryPolicy.attempts ?? 0}x`}
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                  {`${pick("timeout", "超时")} ${queue?.workerHealth.timeoutMs ?? 0} ms`}
                </span>
              </div>
            </div>

            <div className={`mt-4 grid md:grid-cols-2 xl:grid-cols-5 ${isDense ? "gap-3" : "gap-4"}`}>
              {[
                { label: pick("Waiting", "等待"), value: queue?.counts.waiting ?? 0 },
                { label: pick("Active", "执行"), value: queue?.counts.active ?? 0 },
                { label: pick("Completed", "完成"), value: queue?.counts.completed ?? 0 },
                { label: pick("Failed", "失败"), value: queue?.counts.failed ?? 0 },
                {
                  label: pick("Stale workers", "失联 worker"),
                  value: queue?.workerHealth.staleWorkers ?? 0
                }
              ].map((card) => (
                <MetricCard key={card.label} label={card.label} value={card.value} dense={isDense} />
              ))}
            </div>

            {queue?.samples.length ? (
              <div className={`mt-4 grid xl:grid-cols-3 ${isDense ? "gap-3" : "gap-4"}`}>
                {[
                  {
                    label: pick("Waiting trend", "等待趋势"),
                    path: queueTrend?.waiting ?? "",
                    stroke: "#0f172a"
                  },
                  {
                    label: pick("Active trend", "执行趋势"),
                    path: queueTrend?.active ?? "",
                    stroke: "#0284c7"
                  },
                  {
                    label: pick("Failed trend", "失败趋势"),
                    path: queueTrend?.failed ?? "",
                    stroke: "#e11d48"
                  }
                ].map((spark) => (
                  <article
                    key={spark.label}
                    className={`rounded-3xl border border-slate-200 bg-slate-50 ${isDense ? "p-3" : "p-4"}`}
                  >
                    <p className="text-sm font-semibold text-slate-900">{spark.label}</p>
                    <svg viewBox="0 0 220 56" className={`w-full ${isDense ? "mt-2 h-14" : "mt-3 h-16"}`}>
                      <path
                        d={spark.path}
                        fill="none"
                        stroke={spark.stroke}
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        </div>

        <div className={pageGap}>
          <section className={panelClass}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={sectionLabelClass}>{pick("Blockers", "阻塞项")}</p>
                <h3 className={`font-semibold text-slate-950 ${isDense ? "mt-1 text-xl" : "mt-2 text-2xl"}`}>
                  {pick("Current focus", "当前焦点")}
                </h3>
              </div>
              <Link
                to="/platform/gates"
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-700"
              >
                {pick("Open gates", "查看门禁")}
              </Link>
            </div>

            <div className="mt-4 space-y-2">
              {(summary?.topBlockers ?? []).length > 0 ? (
                (summary?.topBlockers ?? []).map((blocker) => (
                  <div
                    key={blocker}
                    className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
                  >
                    {blocker}
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  {pick("No active blocker.", "暂无阻塞项。")}
                </div>
              )}
            </div>
          </section>

          <section className={panelClass}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={sectionLabelClass}>{pick("Releases", "发布")}</p>
                <h3 className={`font-semibold text-slate-950 ${isDense ? "mt-1 text-xl" : "mt-2 text-2xl"}`}>
                  {pick("Latest queue", "最近队列")}
                </h3>
              </div>
              <Link
                to="/platform/gates"
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-700"
              >
                {pick("Gate Center", "门禁台")}
              </Link>
            </div>

            <div className="mt-4 space-y-3">
              {releases.length > 0 ? (
                releases.slice(0, 6).map((release) => (
                  <div
                    key={release.id}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-900">{release.name}</p>
                        <p className="mt-1 text-xs text-slate-500">{release.buildLabel}</p>
                      </div>
                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] ${
                          verdictTone[release.status] ?? verdictTone.draft
                        }`}
                      >
                        {release.status}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  {pick("No release queued.", "暂无发布队列。")}
                </div>
              )}
            </div>
          </section>

          <section className={panelClass}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={sectionLabelClass}>{pick("Load runs", "压测运行")}</p>
                <h3 className={`font-semibold text-slate-950 ${isDense ? "mt-1 text-xl" : "mt-2 text-2xl"}`}>
                  {pick("Recent changes", "最近变化")}
                </h3>
              </div>
              <Link
                to="/platform/load"
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-700"
              >
                {pick("Open studio", "打开压测台")}
              </Link>
            </div>

            <div className="mt-4 space-y-3">
              {recentLoadRuns.length > 0 ? (
                recentLoadRuns.map((run) => (
                  <div
                    key={run.id}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-900">{run.profileName}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {`${run.environmentLabel} · ${formatRelativeTime(run.createdAt)}`}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span
                          className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] ${
                            verdictTone[run.verdict] ?? verdictTone.watch
                          }`}
                        >
                          {run.verdict}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
                          {`${run.metrics.p95Ms.toFixed(0)} ms`}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  {pick("No recent load run.", "暂无压测运行。")}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
};
