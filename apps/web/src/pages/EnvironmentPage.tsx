import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useI18n } from "../i18n/I18nProvider";
import { api } from "../lib/api";
import { PlatformAdvancedPanel } from "../platform/PlatformAdvancedPanel";
import { PlatformBadge } from "../platform/PlatformBadge";
import { usePlatformDensity } from "../platform/PlatformDensity";
import { PlatformDrawer } from "../platform/PlatformDrawer";
import { PlatformEmptyState } from "../platform/PlatformEmptyState";
import { PlatformErrorBanner } from "../platform/PlatformErrorBanner";
import { PlatformMetricCard } from "../platform/PlatformMetricCard";
import { PlatformPageShell } from "../platform/PlatformPageShell";

type DrawerKind = "environment" | "pool" | null;

const workerTone = {
  online: "success",
  busy: "warning",
  offline: "danger",
  stale: "warning",
  draining: "violet"
} as const;

export const EnvironmentPage = () => {
  const { formatRelativeTime, pick } = useI18n();
  const { isDense } = usePlatformDensity();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [showEnvironmentAdvanced, setShowEnvironmentAdvanced] = useState(false);

  const [environmentName, setEnvironmentName] = useState("Staging Cluster");
  const [environmentBaseUrl, setEnvironmentBaseUrl] = useState("https://staging.example.com");
  const [environmentOwner, setEnvironmentOwner] = useState("QA Platform");
  const [serviceNodesJson, setServiceNodesJson] = useState(
    JSON.stringify(
      [
        {
          name: "gateway",
          protocol: "https",
          baseUrl: "https://staging.example.com",
          healthPath: "/health",
          dependsOnIds: [],
          tags: ["edge", "api"]
        }
      ],
      null,
      2
    )
  );
  const [environmentFormError, setEnvironmentFormError] = useState<string | null>(null);
  const [poolName, setPoolName] = useState("AP East Injectors");
  const [region, setRegion] = useState("ap-east");
  const [capacity, setCapacity] = useState("4");
  const [concurrencyLimit, setConcurrencyLimit] = useState("200");

  const projectId = searchParams.get("projectId") ?? "";
  const selectedEnvironmentId = searchParams.get("environmentId") ?? "";

  const setProject = (nextProjectId: string) => {
    const next = new URLSearchParams(
      typeof window === "undefined" ? searchParams.toString() : window.location.search
    );
    if (nextProjectId) {
      next.set("projectId", nextProjectId);
    } else {
      next.delete("projectId");
    }
    next.delete("environmentId");
    setSearchParams(next, { replace: true });
  };

  const setEnvironment = (environmentId: string) => {
    const next = new URLSearchParams(
      typeof window === "undefined" ? searchParams.toString() : window.location.search
    );
    if (environmentId) {
      next.set("environmentId", environmentId);
    } else {
      next.delete("environmentId");
    }
    setSearchParams(next, { replace: true });
  };

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
  const registryQuery = useQuery({
    queryKey: ["platform", "environments", projectId || "all"],
    queryFn: () => api.getEnvironmentRegistry(projectId || undefined)
  });
  const topologyQuery = useQuery({
    queryKey: ["platform", "environment-topology", selectedEnvironmentId || "none"],
    queryFn: () => api.getEnvironmentTopology(selectedEnvironmentId),
    enabled: Boolean(selectedEnvironmentId)
  });

  useEffect(() => {
    if (!projectId && (projectsQuery.data?.length ?? 0) > 0) {
      const project = projectsQuery.data?.[0];
      setProject(project?.id ?? "");
      setEnvironmentBaseUrl(project?.baseUrl ?? "https://staging.example.com");
    }
  }, [projectId, projectsQuery.data]);

  useEffect(() => {
    if (!selectedEnvironmentId && (registryQuery.data?.environments.length ?? 0) > 0) {
      setEnvironment(registryQuery.data?.environments[0]?.id ?? "");
    }
  }, [registryQuery.data, selectedEnvironmentId]);

  const createEnvironmentMutation = useMutation({
    mutationFn: api.createEnvironment,
    onSuccess: async (environment) => {
      setEnvironmentFormError(null);
      setDrawer(null);
      setEnvironment(environment.id);
      await queryClient.invalidateQueries({ queryKey: ["platform", "environments"] });
      await queryClient.invalidateQueries({ queryKey: ["platform", "environment-topology"] });
    }
  });

  const createPoolMutation = useMutation({
    mutationFn: api.createInjectorPool,
    onSuccess: async () => {
      setDrawer(null);
      await queryClient.invalidateQueries({ queryKey: ["platform", "environments"] });
      await queryClient.invalidateQueries({ queryKey: ["platform", "environment-topology"] });
    }
  });

  const projects = projectsQuery.data ?? [];
  const environments = registryQuery.data?.environments ?? [];
  const injectorPools = registryQuery.data?.injectorPools ?? [];
  const injectorWorkers = registryQuery.data?.injectorWorkers ?? [];
  const topology = topologyQuery.data;
  const hasProjects = projects.length > 0;
  const projectSelectPlaceholder = projectsQuery.isLoading
    ? pick("Loading projects...", "正在加载项目...")
    : hasProjects
      ? pick("Select a project", "选择项目")
      : pick("No project yet", "还没有项目");
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId),
    [projectId, projects]
  );

  const formErrors = [
    environmentFormError,
    createEnvironmentMutation.error instanceof Error ? createEnvironmentMutation.error.message : null,
    createPoolMutation.error instanceof Error ? createPoolMutation.error.message : null
  ].filter((value): value is string => Boolean(value));

  const inputClass = "console-input text-sm";
  const panelClass = `rounded-[28px] border border-slate-200 bg-white ${isDense ? "p-4" : "p-5"}`;
  const pageGap = isDense ? "gap-4" : "gap-6";
  const tableCellClass = isDense ? "py-3 pr-4" : "py-4 pr-4";

  const saveEnvironment = () => {
    setEnvironmentFormError(null);

    let serviceNodes: Array<{
      name: string;
      protocol: string;
      baseUrl: string;
      healthPath?: string;
      dependsOnIds?: string[];
      tags?: string[];
    }>;

    if (showEnvironmentAdvanced) {
      try {
        serviceNodes = JSON.parse(serviceNodesJson);
      } catch {
        setEnvironmentFormError(pick("Environment JSON is invalid.", "环境 JSON 不是有效格式。"));
        return;
      }
    } else {
      serviceNodes = [
        {
          name: "gateway",
          protocol: "https",
          baseUrl: environmentBaseUrl,
          healthPath: "/health",
          dependsOnIds: [],
          tags: ["edge", "api"]
        }
      ];
    }

    createEnvironmentMutation.mutate({
      projectId: projectId || undefined,
      name: environmentName,
      baseUrl: environmentBaseUrl,
      owner: environmentOwner,
      authType: "none",
      riskLevel: "medium",
      serviceNodes
    });
  };

  const savePool = () =>
    createPoolMutation.mutate({
      name: poolName,
      region,
      capacity: Number(capacity),
      concurrencyLimit: Number(concurrencyLimit)
    });

  return (
    <PlatformPageShell
      dense={isDense}
      accent="emerald"
      badge={<PlatformBadge tone="success" uppercase dense={isDense}>{pick("Environment Registry", "环境注册")}</PlatformBadge>}
      projectLabel={
        selectedProject ? (
          <PlatformBadge dense={isDense}>{selectedProject.name}</PlatformBadge>
        ) : undefined
      }
      title={pick("Targets, topology, and injector capacity.", "目标、拓扑与注入容量")}
      actions={
        <>
          <select
            className={`console-input min-w-[220px] rounded-full px-4 py-2 text-sm ${
              !hasProjects ? "text-slate-400" : ""
            }`}
            value={hasProjects ? projectId : ""}
            onChange={(event) => setProject(event.target.value)}
            disabled={!hasProjects || projectsQuery.isLoading}
            aria-label={pick("Project filter", "项目筛选")}
          >
            <option value="" disabled={hasProjects}>
              {projectSelectPlaceholder}
            </option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <Link
            to="/platform/load"
            className="console-button-secondary text-sm"
          >
            {pick("Open Load Studio", "打开压测台")}
          </Link>
          {!hasProjects ? (
            <Link to="/projects" className="console-button-primary text-sm">
              {pick("Create project", "创建项目")}
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => setDrawer("environment")}
            className="console-button-primary text-sm"
            disabled={!hasProjects}
          >
            {pick("Create environment", "创建环境")}
          </button>
          <button
            type="button"
            onClick={() => setDrawer("pool")}
            className="console-button-secondary text-sm"
            disabled={!hasProjects}
          >
            {pick("Create injector pool", "创建注入池")}
          </button>
        </>
      }
      metrics={
        <>
          <PlatformMetricCard label={pick("Environments", "环境")} value={environments.length} dense={isDense} />
          <PlatformMetricCard label={pick("Services", "服务")} value={topology?.serviceNodes.length ?? 0} dense={isDense} />
          <PlatformMetricCard label={pick("Pools", "池")} value={injectorPools.length} dense={isDense} />
        </>
      }
    >
      <PlatformErrorBanner messages={formErrors} />
      {!hasProjects && !projectsQuery.isLoading ? (
        <div className="console-panel-subtle px-4 py-4 text-sm text-slate-600">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>
              {pick(
                "Create a project first, then bind environments, topology, and injector pools to it.",
                "请先创建项目，再把环境、拓扑和注入池绑定到这个项目下。"
              )}
            </p>
            <Link to="/projects" className="console-button-primary text-sm">
              {pick("Open projects", "打开项目")}
            </Link>
          </div>
        </div>
      ) : null}

      <div className={`grid xl:grid-cols-[minmax(0,1fr)_380px] ${pageGap}`}>
        <div className={isDense ? "space-y-4" : "space-y-6"}>
          <section className={panelClass}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                  {pick("Inventory", "清单")}
                </p>
                <h3 className={`font-semibold text-slate-950 ${isDense ? "mt-1 text-xl" : "mt-2 text-2xl"}`}>
                  {pick("Environments", "环境")}
                </h3>
              </div>
              <PlatformBadge dense={isDense}>{`${environments.length} ${pick("records", "条记录")}`}</PlatformBadge>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-[0.22em] text-slate-400">
                    <th className="pb-3 pr-4">{pick("Environment", "环境")}</th>
                    <th className="pb-3 pr-4">URL</th>
                    <th className="pb-3 pr-4">{pick("Owner", "负责人")}</th>
                    <th className="pb-3 pr-4">{pick("Risk", "风险")}</th>
                    <th className="pb-3">{pick("Action", "动作")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {environments.length > 0 ? (
                    environments.map((environment) => (
                      <tr key={environment.id}>
                        <td className={tableCellClass}>
                          <p className="font-medium text-slate-900">{environment.name}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {formatRelativeTime(environment.updatedAt)}
                          </p>
                        </td>
                        <td className={`${tableCellClass} text-slate-600`}>{environment.baseUrl}</td>
                        <td className={`${tableCellClass} text-slate-600`}>{environment.owner ?? "—"}</td>
                        <td className={tableCellClass}>
                          <PlatformBadge
                            dense
                            tone={
                              environment.riskLevel === "critical"
                                ? "danger"
                                : environment.riskLevel === "high"
                                  ? "warning"
                                  : "neutral"
                            }
                          >
                            {environment.riskLevel.toUpperCase()}
                          </PlatformBadge>
                        </td>
                        <td className={isDense ? "py-3" : "py-4"}>
                          <button
                            type="button"
                            onClick={() => setEnvironment(environment.id)}
                            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700"
                          >
                            {selectedEnvironmentId === environment.id
                              ? pick("Selected", "已选中")
                              : pick("Inspect", "查看")}
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-6">
                        <PlatformEmptyState message={pick("No environment.", "暂无环境。")} />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className={panelClass}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                  {pick("Topology", "拓扑")}
                </p>
                <h3 className={`font-semibold text-slate-950 ${isDense ? "mt-1 text-xl" : "mt-2 text-2xl"}`}>
                  {topology?.environment.name ?? pick("No environment selected", "未选择环境")}
                </h3>
              </div>
              {topology ? (
                <PlatformBadge dense tone="info">
                  {`${topology.serviceNodes.length} ${pick("services", "服务")}`}
                </PlatformBadge>
              ) : null}
            </div>

            <div className={`mt-4 grid xl:grid-cols-2 ${pageGap}`}>
              {topology?.serviceNodes.length ? (
                topology.serviceNodes.map((node) => (
                  <article
                    key={node.id}
                    className={`rounded-2xl border border-slate-200 bg-slate-50 ${isDense ? "px-3 py-2.5" : "px-4 py-3"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-900">{node.name}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {`${node.protocol.toUpperCase()} · ${node.baseUrl}`}
                        </p>
                      </div>
                      <PlatformBadge dense>{node.healthPath ?? "—"}</PlatformBadge>
                    </div>
                    {node.tags.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {node.tags.map((tag) => (
                          <PlatformBadge key={tag} dense tone="neutral">
                            {tag}
                          </PlatformBadge>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))
              ) : (
                <PlatformEmptyState message={pick("No topology data.", "暂无拓扑数据。")} />
              )}
            </div>
          </section>

          <section className={panelClass}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                  {pick("Capacity", "容量")}
                </p>
                <h3 className={`font-semibold text-slate-950 ${isDense ? "mt-1 text-xl" : "mt-2 text-2xl"}`}>
                  {pick("Injector pools", "注入池")}
                </h3>
              </div>
              <PlatformBadge dense>{`${injectorPools.length} ${pick("pools", "个池")}`}</PlatformBadge>
            </div>

            <div className={`mt-4 grid xl:grid-cols-2 ${pageGap}`}>
              {injectorPools.length > 0 ? (
                injectorPools.map((pool) => {
                  const workers = injectorWorkers.filter((worker) => worker.poolId === pool.id);
                  return (
                    <article
                      key={pool.id}
                      className={`rounded-[24px] border border-slate-200 bg-slate-50 ${isDense ? "p-3" : "p-4"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className={`${isDense ? "text-base" : "text-lg"} font-semibold text-slate-900`}>
                            {pool.name}
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            {`${pool.region} · ${pool.capacity} cap`}
                          </p>
                        </div>
                        <PlatformBadge dense>{`${pool.concurrencyLimit} conc.`}</PlatformBadge>
                      </div>
                      <div className="mt-4 space-y-2">
                        {workers.map((worker) => (
                          <div
                            key={worker.id}
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <p className="font-medium text-slate-900">{worker.name}</p>
                              <PlatformBadge
                                dense
                                tone={workerTone[(worker.status as keyof typeof workerTone) ?? "online"]}
                              >
                                {worker.status.toUpperCase()}
                              </PlatformBadge>
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              {`${worker.capacity} cap · ${worker.currentRunCount} active`}
                            </p>
                          </div>
                        ))}
                        {workers.length === 0 ? (
                          <PlatformEmptyState message={pick("No worker.", "暂无 worker。")} />
                        ) : null}
                      </div>
                    </article>
                  );
                })
              ) : (
                <PlatformEmptyState message={pick("No injector pool.", "暂无注入池。")} />
              )}
            </div>
          </section>
        </div>

        <aside className={isDense ? "space-y-4" : "space-y-6"}>
          <section className={panelClass}>
            <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
              {pick("Actions", "动作")}
            </p>
            <div className="mt-4 flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setDrawer("environment")}
                className="rounded-lg border border-slate-900 bg-slate-900 px-4 py-3 text-sm font-medium text-white"
              >
                {pick("Create environment", "创建环境")}
              </button>
              <button
                type="button"
                onClick={() => setDrawer("pool")}
                className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700"
              >
                {pick("Create injector pool", "创建注入池")}
              </button>
            </div>
          </section>
        </aside>
      </div>

      <PlatformDrawer
        open={drawer !== null}
        title={
          drawer === "environment"
            ? pick("Create environment", "创建环境")
            : pick("Create injector pool", "创建注入池")
        }
        description={
          drawer === "environment"
            ? pick("Target and topology", "目标与拓扑")
            : pick("Capacity and concurrency", "容量与并发")
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
              onClick={drawer === "environment" ? saveEnvironment : savePool}
              disabled={
                drawer === "environment"
                  ? createEnvironmentMutation.isPending
                  : createPoolMutation.isPending
              }
              className="rounded-lg border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {drawer === "environment"
                ? createEnvironmentMutation.isPending
                  ? pick("Saving...", "保存中...")
                  : pick("Save environment", "保存环境")
                : createPoolMutation.isPending
                  ? pick("Saving...", "保存中...")
                  : pick("Save pool", "保存注入池")}
            </button>
          </>
        }
      >
        {drawer === "environment" ? (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {pick("Name", "名称")}
              </label>
              <input className={inputClass} value={environmentName} onChange={(event) => setEnvironmentName(event.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Base URL</label>
              <input className={inputClass} value={environmentBaseUrl} onChange={(event) => setEnvironmentBaseUrl(event.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {pick("Owner", "负责人")}
              </label>
              <input className={inputClass} value={environmentOwner} onChange={(event) => setEnvironmentOwner(event.target.value)} />
            </div>
            <PlatformAdvancedPanel
              title={pick("Advanced JSON", "高级 JSON")}
              description={pick("Service nodes", "服务节点")}
              open={showEnvironmentAdvanced}
              onToggle={() => setShowEnvironmentAdvanced((value) => !value)}
            >
              <textarea
                className={`${inputClass} min-h-[220px] font-mono`}
                value={serviceNodesJson}
                onChange={(event) => setServiceNodesJson(event.target.value)}
              />
            </PlatformAdvancedPanel>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {pick("Name", "名称")}
              </label>
              <input className={inputClass} value={poolName} onChange={(event) => setPoolName(event.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {pick("Region", "区域")}
              </label>
              <input className={inputClass} value={region} onChange={(event) => setRegion(event.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  {pick("Capacity", "容量")}
                </label>
                <input className={inputClass} value={capacity} onChange={(event) => setCapacity(event.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  {pick("Concurrency", "并发")}
                </label>
                <input className={inputClass} value={concurrencyLimit} onChange={(event) => setConcurrencyLimit(event.target.value)} />
              </div>
            </div>
          </div>
        )}
      </PlatformDrawer>
    </PlatformPageShell>
  );
};
