import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { LoadProfile, LoadRun, LoadStudioSummary } from "@qpilot/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { useI18n } from "../i18n/I18nProvider";
import { PlatformAdvancedPanel } from "../platform/PlatformAdvancedPanel";
import { PlatformBadge } from "../platform/PlatformBadge";
import { usePlatformDensity } from "../platform/PlatformDensity";
import { PlatformDrawer } from "../platform/PlatformDrawer";
import { PlatformEmptyState } from "../platform/PlatformEmptyState";
import { PlatformErrorBanner } from "../platform/PlatformErrorBanner";
import { PlatformFiltersBar } from "../platform/PlatformFiltersBar";
import { PlatformFormField } from "../platform/PlatformFormField";
import { PlatformMetricCard } from "../platform/PlatformMetricCard";
import { PlatformPageShell } from "../platform/PlatformPageShell";
import { PlatformSectionHeader } from "../platform/PlatformSectionHeader";
import { PlatformTable } from "../platform/PlatformTable";

const emptySummary: LoadStudioSummary = {
  projectId: undefined,
  profileCount: 0,
  runCount: 0,
  activeRunCount: 0,
  avgP95Ms: 0,
  avgErrorRatePct: 0,
  latestVerdict: undefined,
  profiles: [],
  recentRuns: [],
  topAlerts: []
};

type StudioMode = "setup" | "run";
type DrawerKind = "environment" | "pool" | "gate" | "profile" | null;

const verdictTone: Record<LoadRun["verdict"], "success" | "warning" | "danger"> = {
  ship: "success",
  watch: "warning",
  hold: "danger"
};

const statusTone: Record<
  LoadRun["status"],
  "warning" | "info" | "success" | "danger" | "neutral"
> = {
  queued: "warning",
  running: "info",
  passed: "success",
  failed: "danger",
  stopped: "neutral"
};

const terminalStatuses = new Set<LoadRun["status"]>(["passed", "failed", "stopped"]);
const inputClass = "console-input text-sm";
const primaryButtonClass =
  "console-button-primary text-sm disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButtonClass =
  "console-button-secondary text-sm disabled:cursor-not-allowed disabled:opacity-50";
const actionChipClass =
  "console-button-subtle px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50";

const parseEmbeddedMessage = (message: string): string | null => {
  try {
    const parsed = JSON.parse(message) as { message?: string; error?: string };
    return parsed.message ?? parsed.error ?? null;
  } catch {
    return null;
  }
};

const humanizeStudioError = (error: unknown): string | null => {
  if (!error) return null;
  if (error instanceof ApiError) {
    if (error.status === 404) return "The connected runtime is missing this platform route.";
    return parseEmbeddedMessage(error.message) ?? error.message;
  }
  if (error instanceof Error) return parseEmbeddedMessage(error.message) ?? error.message;
  return null;
};

const shortId = (id: string) => id.slice(0, 8);
const sourceLabel = (source: LoadRun["source"]) => (source === "k6" ? "Real k6" : "Synthetic");
const summarizeThresholds = (profile: LoadProfile) =>
  `P95 <= ${profile.thresholds.maxP95Ms} ms | errors <= ${profile.thresholds.maxErrorRatePct}% | throughput >= ${profile.thresholds.minThroughputRps} rps`;

const SetupCard = ({
  label,
  state,
  resource,
  action
}: {
  label: string;
  state: "Ready" | "Missing" | "Optional" | "Required";
  resource: string;
  action: ReactNode;
}) => (
  <article className="console-panel-subtle px-4 py-4">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900">{label}</p>
        <p className="mt-1 truncate text-xs text-slate-500">{resource}</p>
      </div>
      <PlatformBadge
        dense
        tone={state === "Ready" ? "success" : state === "Missing" || state === "Required" ? "warning" : "neutral"}
      >
        {state}
      </PlatformBadge>
    </div>
    <div className="mt-4">{action}</div>
  </article>
);

export const LoadStudioPage = () => {
  const { formatRelativeTime } = useI18n();
  const { isDense } = usePlatformDensity();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [showEnvironmentAdvanced, setShowEnvironmentAdvanced] = useState(false);
  const [showProfileAdvanced, setShowProfileAdvanced] = useState(false);
  const [environmentName, setEnvironmentName] = useState("Staging Cluster");
  const [environmentBaseUrl, setEnvironmentBaseUrl] = useState("https://staging.example.com");
  const [environmentOwner, setEnvironmentOwner] = useState("QA Platform");
  const [environmentNodesJson, setEnvironmentNodesJson] = useState(
    '[{"name":"gateway","protocol":"https","baseUrl":"https://staging.example.com","healthPath":"/health","dependsOnIds":[],"tags":["edge","api"]}]'
  );
  const [environmentFormError, setEnvironmentFormError] = useState<string | null>(null);
  const [poolName, setPoolName] = useState("AP East Injectors");
  const [poolRegion, setPoolRegion] = useState("ap-east");
  const [poolCapacity, setPoolCapacity] = useState("4");
  const [poolConcurrencyLimit, setPoolConcurrencyLimit] = useState("200");
  const [gatePolicyName, setGatePolicyName] = useState("release gate");
  const [requiredFlows, setRequiredFlows] = useState("core-login\ncore-checkout");
  const [profileName, setProfileName] = useState("Checkout API steady gate");
  const [scenarioLabel, setScenarioLabel] = useState("Checkout release readiness");
  const [targetBaseUrl, setTargetBaseUrl] = useState("https://example.com");
  const [engine, setEngine] = useState<LoadProfile["engine"]>("k6_http");
  const [pattern, setPattern] = useState<LoadProfile["pattern"]>("steady");
  const [executionMode, setExecutionMode] = useState<LoadProfile["executionMode"]>("local");
  const [workerCount, setWorkerCount] = useState("1");
  const [requestPath, setRequestPath] = useState("/health");
  const [httpMethod, setHttpMethod] = useState<NonNullable<LoadProfile["httpMethod"]>>("GET");
  const [headersJson, setHeadersJson] = useState('{"Accept":"application/json"}');
  const [bodyTemplate, setBodyTemplate] = useState("");
  const [tagsJson, setTagsJson] = useState('["smoke","api"]');
  const [maxP95Ms, setMaxP95Ms] = useState("650");
  const [maxErrorRatePct, setMaxErrorRatePct] = useState("1.5");
  const [minThroughputRps, setMinThroughputRps] = useState("180");
  const [launchNotes, setLaunchNotes] = useState("");

  const projectId = searchParams.get("projectId") ?? "";
  const studioModeParam = searchParams.get("studioMode") as StudioMode | null;
  const studioMode = studioModeParam ?? "run";
  const runVerdictFilter =
    (searchParams.get("runVerdictFilter") as LoadRun["verdict"] | "all" | null) ?? "all";
  const selectedEnvironmentId = searchParams.get("selectedEnvironmentId") ?? "";
  const selectedGatePolicyId = searchParams.get("selectedGatePolicyId") ?? "";
  const selectedInjectorPoolId = searchParams.get("selectedInjectorPoolId") ?? "";
  const baselineRunId = searchParams.get("baselineRunId") ?? "";
  const compareRunId = searchParams.get("compareRunId") ?? "";

  const updateSearch = (entries: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(entries)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace: true });
  };

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
  const summaryQuery = useQuery({
    queryKey: ["load-studio", "summary", projectId || "all"],
    queryFn: () => api.getLoadStudioSummary(projectId || undefined),
    refetchInterval: 15_000
  });
  const profilesQuery = useQuery({
    queryKey: ["platform", "load-profiles", projectId || "all"],
    queryFn: () => api.listPlatformLoadProfiles(projectId || undefined),
    refetchInterval: 15_000
  });
  const runsQuery = useQuery({
    queryKey: ["platform", "load-runs", projectId || "all", runVerdictFilter],
    queryFn: () =>
      api.listPlatformLoadRuns({
        projectId: projectId || undefined,
        verdict: runVerdictFilter === "all" ? undefined : runVerdictFilter,
        limit: 20
      }),
    refetchInterval: 15_000
  });
  const queueQuery = useQuery({
    queryKey: ["platform", "load-queue"],
    queryFn: api.getPlatformLoadQueueSummary,
    refetchInterval: 5_000
  });
  const registryQuery = useQuery({
    queryKey: ["platform", "environments", projectId || "all"],
    queryFn: () => api.getEnvironmentRegistry(projectId || undefined)
  });
  const gatePoliciesQuery = useQuery({
    queryKey: ["platform", "gate-policies", projectId || "all"],
    queryFn: () => api.listGatePolicies(projectId || undefined)
  });
  const compareQuery = useQuery({
    queryKey: ["platform", "load-run-compare", compareRunId || "none", baselineRunId || "none"],
    queryFn: () => api.getPlatformLoadRunCompare({ runId: compareRunId, baselineRunId }),
    enabled: Boolean(compareRunId && baselineRunId && compareRunId !== baselineRunId)
  });

  const environments = registryQuery.data?.environments ?? [];
  const injectorPools = registryQuery.data?.injectorPools ?? [];
  const gatePolicies = gatePoliciesQuery.data ?? [];
  const profiles = profilesQuery.data ?? [];
  const allRuns = runsQuery.data ?? [];
  const summary = summaryQuery.data ?? emptySummary;
  const resolvedProjectId = projectId || projectsQuery.data?.[0]?.id || "";

  const selectedProject = useMemo(
    () => projectsQuery.data?.find((project) => project.id === resolvedProjectId),
    [resolvedProjectId, projectsQuery.data]
  );
  const selectedEnvironment = environments.find((environment) => environment.id === selectedEnvironmentId);
  const environmentNameById = useMemo(
    () => Object.fromEntries(environments.map((environment) => [environment.id, environment.name] as const)),
    [environments]
  );
  const runsByProfile = useMemo(() => {
    const next = new Map<string, LoadRun[]>();
    for (const run of allRuns) {
      const items = next.get(run.profileId) ?? [];
      items.push(run);
      next.set(run.profileId, items);
    }
    for (const items of next.values()) {
      items.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    }
    return next;
  }, [allRuns]);
  const profileRows = useMemo(
    () =>
      [...profiles]
        .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
        .map((profile) => {
          const runs = runsByProfile.get(profile.id) ?? [];
          const latestRun = runs[0] ?? null;
          const activeRun = runs.find((run) => run.status === "queued" || run.status === "running") ?? null;
          const latestFinishedRun = runs.find((run) => terminalStatuses.has(run.status)) ?? null;
          const latestGreenRun = runs.find((run) => terminalStatuses.has(run.status) && run.verdict === "ship") ?? null;
          const baselineRun = runs.find((run) => run.id === profile.baselineRunId) ?? latestGreenRun ?? null;
          const compareCandidate =
            latestFinishedRun && baselineRun && latestFinishedRun.id !== baselineRun.id ? latestFinishedRun : null;
          const openRun = activeRun ?? latestRun ?? null;
          return { profile, activeRun, latestGreenRun, baselineRun, compareCandidate, openRun };
        }),
    [profiles, runsByProfile]
  );

  useEffect(() => {
    if (!projectId && (projectsQuery.data?.length ?? 0) > 0) {
      const project = projectsQuery.data?.[0];
      updateSearch({ projectId: project?.id ?? null });
      if (project?.baseUrl) {
        setTargetBaseUrl(project.baseUrl);
        setEnvironmentBaseUrl(project.baseUrl);
      }
    }
  }, [projectId, projectsQuery.data]);

  useEffect(() => {
    const nextEntries: Record<string, string | null> = {};
    if (!selectedEnvironmentId && environments[0]) nextEntries.selectedEnvironmentId = environments[0].id;
    if (!selectedInjectorPoolId && injectorPools[0]) nextEntries.selectedInjectorPoolId = injectorPools[0].id;
    if (!selectedGatePolicyId && gatePolicies[0]) nextEntries.selectedGatePolicyId = gatePolicies[0].id;
    if (Object.keys(nextEntries).length > 0) updateSearch(nextEntries);
  }, [selectedEnvironmentId, selectedInjectorPoolId, selectedGatePolicyId, environments, injectorPools, gatePolicies]);

  useEffect(() => {
    if (studioModeParam) return;
    const hasProject = Boolean(projectId);
    const hasAssets = profiles.length > 0 || allRuns.length > 0;
    const hasEnvironment = environments.length > 0;
    if (!hasProject || (!hasEnvironment && !hasAssets)) {
      updateSearch({ studioMode: "setup" });
      return;
    }
    if (hasAssets) updateSearch({ studioMode: "run" });
  }, [studioModeParam, projectId, profiles.length, allRuns.length, environments.length]);

  const createEnvironmentMutation = useMutation({
    mutationFn: api.createEnvironment,
    onSuccess: async (environment) => {
      setEnvironmentFormError(null);
      setDrawer(null);
      updateSearch({ selectedEnvironmentId: environment.id, studioMode: "run" });
      await queryClient.invalidateQueries({ queryKey: ["platform", "environments"] });
    }
  });
  const createPoolMutation = useMutation({
    mutationFn: api.createInjectorPool,
    onSuccess: async (pool) => {
      setDrawer(null);
      updateSearch({ selectedInjectorPoolId: pool.id });
      await queryClient.invalidateQueries({ queryKey: ["platform", "environments"] });
    }
  });
  const createGatePolicyMutation = useMutation({
    mutationFn: api.createGatePolicy,
    onSuccess: async (policy) => {
      setDrawer(null);
      updateSearch({ selectedGatePolicyId: policy.id });
      await queryClient.invalidateQueries({ queryKey: ["platform", "gate-policies"] });
    }
  });
  const createProfileMutation = useMutation({
    mutationFn: api.createPlatformLoadProfile,
    onSuccess: async () => {
      setDrawer(null);
      updateSearch({ studioMode: "run" });
      await queryClient.invalidateQueries({ queryKey: ["platform", "load-profiles"] });
      await queryClient.invalidateQueries({ queryKey: ["load-studio", "summary"] });
    }
  });
  const launchRunMutation = useMutation({
    mutationFn: api.createPlatformLoadRun,
    onSuccess: async (run) => {
      await queryClient.invalidateQueries({ queryKey: ["platform", "load-runs"] });
      await queryClient.invalidateQueries({ queryKey: ["platform", "load-queue"] });
      navigate(`/platform/load/runs/${run.id}`);
    }
  });
  const retryRunMutation = useMutation({
    mutationFn: ({ runId }: { runId: string }) => api.retryPlatformLoadRun(runId, "Retry from Load Studio"),
    onSuccess: async (run) => {
      await queryClient.invalidateQueries({ queryKey: ["platform", "load-runs"] });
      await queryClient.invalidateQueries({ queryKey: ["platform", "load-queue"] });
      navigate(`/platform/load/runs/${run.id}`);
    }
  });
  const cancelRunMutation = useMutation({
    mutationFn: ({ runId }: { runId: string }) => api.cancelPlatformLoadRun(runId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["platform", "load-runs"] });
      await queryClient.invalidateQueries({ queryKey: ["platform", "load-queue"] });
    }
  });
  const promoteBaselineMutation = useMutation({
    mutationFn: ({ profileId, runId }: { profileId: string; runId: string }) =>
      api.promotePlatformLoadBaseline(profileId, runId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["platform", "load-profiles"] });
      await queryClient.invalidateQueries({ queryKey: ["platform", "load-runs"] });
    }
  });

  const launchPendingProfileId = launchRunMutation.isPending ? launchRunMutation.variables?.profileId ?? null : null;
  const promotePendingProfileId = promoteBaselineMutation.isPending ? promoteBaselineMutation.variables?.profileId ?? null : null;
  const retryPendingRunId = retryRunMutation.isPending ? retryRunMutation.variables?.runId ?? null : null;
  const cancelPendingRunId = cancelRunMutation.isPending ? cancelRunMutation.variables?.runId ?? null : null;

  const setupDiagnostics = [
    environmentFormError,
    humanizeStudioError(createEnvironmentMutation.error),
    humanizeStudioError(createPoolMutation.error),
    humanizeStudioError(createGatePolicyMutation.error),
    humanizeStudioError(createProfileMutation.error),
    humanizeStudioError(summaryQuery.error),
    humanizeStudioError(profilesQuery.error),
    humanizeStudioError(runsQuery.error),
    humanizeStudioError(queueQuery.error),
    humanizeStudioError(registryQuery.error),
    humanizeStudioError(gatePoliciesQuery.error)
  ].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);

  const saveEnvironment = () => {
    setEnvironmentFormError(null);
    let serviceNodes;
    if (showEnvironmentAdvanced) {
      try {
        serviceNodes = JSON.parse(environmentNodesJson);
      } catch {
        setEnvironmentFormError("Environment JSON is invalid.");
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
      region: poolRegion,
      capacity: Number(poolCapacity),
      concurrencyLimit: Number(poolConcurrencyLimit)
    });

  const saveGatePolicy = () =>
    createGatePolicyMutation.mutate({
      projectId: resolvedProjectId,
      name: gatePolicyName,
      requiredFunctionalFlows: requiredFlows.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      minBenchmarkCoveragePct: 50,
      minBenchmarkPassRate: 70,
      requiredLoadProfileIds: [],
      minimumLoadVerdict: "watch",
      allowWaiver: true,
      approverRoles: ["release-manager", "qa-lead"]
    });

  const saveProfile = () =>
    createProfileMutation.mutate({
      projectId: resolvedProjectId,
      name: profileName,
      scenarioLabel,
      targetBaseUrl,
      environmentTargetId: selectedEnvironmentId || undefined,
      engine,
      pattern,
      requestPath: engine === "k6_http" ? requestPath : undefined,
      httpMethod: engine === "k6_http" ? httpMethod : undefined,
      headersJson: showProfileAdvanced ? headersJson : undefined,
      bodyTemplate: showProfileAdvanced && bodyTemplate.trim() ? bodyTemplate : undefined,
      executionMode,
      workerCount: Number(workerCount),
      injectorPoolId: executionMode === "distributed" ? selectedInjectorPoolId || undefined : undefined,
      arrivalModel: "closed",
      gatePolicyId: selectedGatePolicyId || undefined,
      tagsJson: showProfileAdvanced ? tagsJson : undefined,
      virtualUsers: 120,
      durationSec: 300,
      rampUpSec: 45,
      targetRps: 240,
      thresholds: {
        maxP95Ms: Number(maxP95Ms),
        maxErrorRatePct: Number(maxErrorRatePct),
        minThroughputRps: Number(minThroughputRps)
      }
    });

  const resolveEnvironmentLabel = (profile: LoadProfile): string => {
    const environmentLabel = profile.environmentTargetId
      ? environmentNameById[profile.environmentTargetId]
      : undefined;
    if (environmentLabel) {
      return environmentLabel;
    }
    if (selectedEnvironment?.name) return selectedEnvironment.name;
    try {
      return new URL(profile.targetBaseUrl).host;
    } catch {
      return "default";
    }
  };

  const launchProfile = (profile: LoadProfile) =>
    launchRunMutation.mutate({
      profileId: profile.id,
      environmentId: profile.environmentTargetId,
      environmentLabel: resolveEnvironmentLabel(profile),
      notes: launchNotes.trim() || undefined
    });

  const canCreateProfile =
    Boolean(resolvedProjectId) &&
    Boolean(selectedEnvironmentId) &&
    (executionMode !== "distributed" || Boolean(selectedInjectorPoolId));
  const pageGap = isDense ? "gap-4" : "gap-6";
  const panelClass = `rounded-[28px] border border-slate-200 bg-white ${isDense ? "p-4" : "p-5"}`;

  return (
    <PlatformPageShell
      dense={isDense}
      accent="sky"
      badge={<PlatformBadge tone="info" uppercase dense={isDense}>Load Studio</PlatformBadge>}
      projectLabel={selectedProject ? <PlatformBadge dense={isDense}>{selectedProject.name}</PlatformBadge> : undefined}
      title="Load Studio"
      actions={
        <>
          <select className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700" value={resolvedProjectId} onChange={(event) => updateSearch({ projectId: event.target.value, studioMode: null })}>
            {(projectsQuery.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <button type="button" onClick={() => updateSearch({ studioMode: "setup" })} className={studioMode === "setup" ? primaryButtonClass : secondaryButtonClass}>Setup</button>
          <button type="button" onClick={() => updateSearch({ studioMode: "run" })} className={studioMode === "run" ? primaryButtonClass : secondaryButtonClass}>Runs</button>
          <button type="button" onClick={() => setDrawer("profile")} disabled={!resolvedProjectId} className={primaryButtonClass}>New profile</button>
        </>
      }
      metrics={
        <>
          <PlatformMetricCard label="Profiles" value={summary.profileCount} dense={isDense} />
          <PlatformMetricCard label="Active runs" value={summary.activeRunCount} dense={isDense} />
          <PlatformMetricCard label="AVG P95" value={`${summary.avgP95Ms} ms`} dense={isDense} />
          <PlatformMetricCard label="Latest verdict" value={summary.latestVerdict ? summary.latestVerdict.toUpperCase() : "-"} dense={isDense} />
        </>
      }
    >
      <PlatformErrorBanner messages={setupDiagnostics} />
      {studioMode === "setup" ? (
        <section className={panelClass}>
          <PlatformSectionHeader dense={isDense} eyebrow="Setup" title="Platform setup" description="Project, environment, pool, and gate resources." />
          <div className={`mt-5 grid xl:grid-cols-2 ${pageGap}`}>
            <SetupCard label="Project" state={resolvedProjectId ? "Ready" : "Required"} resource={selectedProject?.name ?? "No project selected"} action={<Link to="/projects" className="console-button-secondary px-3 py-1.5 text-xs">Open</Link>} />
            <SetupCard label="Environment" state={environments.length > 0 ? "Ready" : "Missing"} resource={selectedEnvironment?.name ?? environments[0]?.name ?? "No environment"} action={<button type="button" onClick={() => setDrawer("environment")} className={actionChipClass}>Create</button>} />
            <SetupCard label="Injector pool" state={injectorPools.length > 0 ? "Ready" : "Optional"} resource={injectorPools[0]?.name ?? "No pool"} action={<button type="button" onClick={() => setDrawer("pool")} className={actionChipClass}>Create</button>} />
            <SetupCard label="Gate policy" state={gatePolicies.length > 0 ? "Ready" : "Optional"} resource={gatePolicies[0]?.name ?? "No policy"} action={<button type="button" onClick={() => setDrawer("gate")} disabled={!resolvedProjectId} className={actionChipClass}>Create</button>} />
          </div>
        </section>
      ) : (
        <div className={`grid xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.95fr)] ${pageGap}`}>
          <div className={isDense ? "space-y-4" : "space-y-6"}>
            <section className={panelClass}>
              <PlatformSectionHeader dense={isDense} eyebrow="Dispatch" title="Queue dispatch" description="Queue health and launch notes." />
              <div className={`mt-5 grid md:grid-cols-4 ${pageGap}`}>
                <PlatformMetricCard label="Waiting" value={queueQuery.data?.counts.waiting ?? 0} dense={isDense} />
                <PlatformMetricCard label="Active" value={queueQuery.data?.counts.active ?? 0} dense={isDense} />
                <PlatformMetricCard label="Failed" value={queueQuery.data?.counts.failed ?? 0} dense={isDense} />
                <PlatformMetricCard label="Retries" value={queueQuery.data?.retryPolicy.attempts ?? 0} dense={isDense} />
              </div>
              <div className={`mt-5 grid lg:grid-cols-[minmax(0,1fr)_220px_220px] ${pageGap}`}>
                <PlatformFormField label="Launch notes"><input className={inputClass} value={launchNotes} onChange={(event) => setLaunchNotes(event.target.value)} placeholder="Optional notes for the next launch" /></PlatformFormField>
                <PlatformFormField label="Queue mode"><div className="flex h-[42px] items-center"><PlatformBadge dense>{queueQuery.data?.mode ?? "inline"}</PlatformBadge></div></PlatformFormField>
                <PlatformFormField label="Worker health"><div className="flex h-[42px] items-center gap-2"><PlatformBadge dense tone="info">{`${queueQuery.data?.workerHealth.busyWorkers ?? 0} busy`}</PlatformBadge><PlatformBadge dense tone={(queueQuery.data?.workerHealth.staleWorkers ?? 0) > 0 ? "warning" : "success"}>{`${queueQuery.data?.workerHealth.staleWorkers ?? 0} stale`}</PlatformBadge></div></PlatformFormField>
              </div>
            </section>
            <section className={panelClass}>
              <PlatformSectionHeader dense={isDense} eyebrow="Profiles" title="Profile inventory" description="Launch, inspect, compare, and pin baselines." actions={<button type="button" onClick={() => setDrawer("profile")} className={secondaryButtonClass}>New profile</button>} />
              <div className="mt-4">
                <PlatformTable dense={isDense} columns={["Profile", "Engine", "Mode", "Baseline", "Actions"]}>
                  {profileRows.length > 0 ? profileRows.map(({ profile, activeRun, latestGreenRun, baselineRun, compareCandidate, openRun }) => {
                    const launchDisabled = Boolean(activeRun) || launchPendingProfileId === profile.id;
                    const canCompare = Boolean(compareCandidate && baselineRun);
                    const canPromote = Boolean(latestGreenRun) && latestGreenRun?.id !== profile.baselineRunId && latestGreenRun?.status === "passed";
                    return (
                      <tr key={profile.id}>
                        <td className={isDense ? "py-3 pr-4" : "py-4 pr-4"}>
                          <div className="flex flex-wrap items-center gap-2"><p className="font-medium text-slate-900">{profile.name}</p>{activeRun ? <PlatformBadge dense tone="info">{activeRun.status}</PlatformBadge> : null}</div>
                          <p className="mt-1 text-xs text-slate-500">{profile.scenarioLabel}</p>
                          <p className="mt-1 text-[11px] text-slate-400">{`#${shortId(profile.id)} • ${environmentNameById[profile.environmentTargetId ?? ""] ?? "No environment"} • updated ${formatRelativeTime(profile.updatedAt)}`}</p>
                        </td>
                        <td className={`${isDense ? "py-3 pr-4" : "py-4 pr-4"} text-slate-600`}>{profile.engine}</td>
                        <td className={`${isDense ? "py-3 pr-4" : "py-4 pr-4"} text-slate-600`}><p>{`${profile.pattern} • ${profile.executionMode}`}</p><p className="mt-1 text-xs text-slate-400">{`${profile.workerCount} worker${profile.workerCount > 1 ? "s" : ""}`}</p></td>
                        <td className={`${isDense ? "py-3 pr-4" : "py-4 pr-4"}`}>
                          {baselineRun ? <div className="space-y-2"><div className="flex items-center gap-2"><PlatformBadge dense tone={profile.baselineRunId ? "success" : "info"}>{profile.baselineRunId ? "Pinned" : "Latest green"}</PlatformBadge><span className="text-xs text-slate-500">{formatRelativeTime(baselineRun.createdAt)}</span></div><Link to={`/platform/load/runs/${baselineRun.id}`} className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700">Open</Link></div> : <PlatformBadge dense tone="warning">Missing</PlatformBadge>}
                        </td>
                        <td className={isDense ? "py-3" : "py-4"}>
                          <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => launchProfile(profile)} disabled={launchDisabled} className={primaryButtonClass.replace("px-4 py-2 text-sm", "px-3 py-1.5 text-xs")}>{launchPendingProfileId === profile.id ? "Launching..." : activeRun ? "Running" : "Launch"}</button>
                            {openRun ? <Link to={`/platform/load/runs/${openRun.id}`} className={actionChipClass}>Open latest</Link> : null}
                            <button type="button" onClick={() => canCompare && compareCandidate && baselineRun ? updateSearch({ compareRunId: compareCandidate.id, baselineRunId: baselineRun.id }) : undefined} disabled={!canCompare} className={actionChipClass}>Compare</button>
                            <button type="button" onClick={() => canPromote && latestGreenRun ? promoteBaselineMutation.mutate({ profileId: profile.id, runId: latestGreenRun.id }) : undefined} disabled={!canPromote || promotePendingProfileId === profile.id} className={actionChipClass}>{promotePendingProfileId === profile.id ? "Saving..." : profile.baselineRunId ? "Update baseline" : "Set baseline"}</button>
                          </div>
                          <p className="mt-2 text-[11px] text-slate-400">{summarizeThresholds(profile)}</p>
                        </td>
                      </tr>
                    );
                  }) : <tr><td colSpan={5} className={isDense ? "py-5" : "py-6"}><PlatformEmptyState message="No profile." action={<button type="button" onClick={() => setDrawer("profile")} className={actionChipClass}>New profile</button>} /></td></tr>}
                </PlatformTable>
              </div>
            </section>
            <section className={panelClass}>
              <PlatformSectionHeader dense={isDense} eyebrow="Runs" title="Recent runs" description="Inspect, compare, retry, or cancel active work." />
              <div className="mt-4">
                <PlatformFiltersBar dense={isDense} filters={<select className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700" value={runVerdictFilter} onChange={(event) => updateSearch({ runVerdictFilter: event.target.value })}><option value="all">All verdicts</option><option value="ship">SHIP</option><option value="watch">WATCH</option><option value="hold">HOLD</option></select>} />
                <PlatformTable dense={isDense} columns={["Scenario", "Source", "Status", "Verdict", "Actions"]}>
                  {allRuns.length > 0 ? allRuns.map((run) => {
                    const runProfile = profiles.find((profile) => profile.id === run.profileId);
                    const baselineForRun = allRuns.find((entry) => entry.id === run.compareBaselineRunId) ?? allRuns.find((entry) => entry.id === runProfile?.baselineRunId) ?? null;
                    const canCompare = Boolean(baselineForRun && baselineForRun.id !== run.id && terminalStatuses.has(run.status));
                    return (
                      <tr key={run.id}>
                        <td className={isDense ? "py-3 pr-4" : "py-4 pr-4"}><p className="font-medium text-slate-900">{run.scenarioLabel}</p><p className="mt-1 text-xs text-slate-500">{`${formatRelativeTime(run.createdAt)} • #${shortId(run.id)}`}</p></td>
                        <td className={`${isDense ? "py-3 pr-4" : "py-4 pr-4"} text-slate-600`}>{sourceLabel(run.source)}</td>
                        <td className={isDense ? "py-3 pr-4" : "py-4 pr-4"}><PlatformBadge dense tone={statusTone[run.status]}>{run.status.toUpperCase()}</PlatformBadge></td>
                        <td className={isDense ? "py-3 pr-4" : "py-4 pr-4"}><PlatformBadge dense tone={verdictTone[run.verdict]}>{run.verdict.toUpperCase()}</PlatformBadge></td>
                        <td className={isDense ? "py-3" : "py-4"}>
                          <div className="flex flex-wrap gap-2">
                            <Link to={`/platform/load/runs/${run.id}`} className={actionChipClass}>Open</Link>
                            <button type="button" onClick={() => canCompare && baselineForRun ? updateSearch({ compareRunId: run.id, baselineRunId: baselineForRun.id }) : undefined} disabled={!canCompare} className={actionChipClass}>Compare</button>
                            {run.status === "queued" ? <button type="button" onClick={() => cancelRunMutation.mutate({ runId: run.id })} disabled={cancelPendingRunId === run.id} className={actionChipClass}>{cancelPendingRunId === run.id ? "Cancelling..." : "Cancel"}</button> : <button type="button" onClick={() => retryRunMutation.mutate({ runId: run.id })} disabled={retryPendingRunId === run.id} className={actionChipClass}>{retryPendingRunId === run.id ? "Retrying..." : "Retry"}</button>}
                          </div>
                        </td>
                      </tr>
                    );
                  }) : <tr><td colSpan={5} className={isDense ? "py-5" : "py-6"}><PlatformEmptyState message="No run." /></td></tr>}
                </PlatformTable>
              </div>
            </section>
          </div>
          <aside className={isDense ? "space-y-4" : "space-y-6"}>
            <section className={panelClass}>
              <PlatformSectionHeader dense={isDense} eyebrow="Actions" title="Side rail" description="Create shared resources without leaving the studio." />
              <div className="mt-4 flex flex-col gap-3">
                <button type="button" onClick={() => setDrawer("environment")} className={secondaryButtonClass}>Create environment</button>
                <button type="button" onClick={() => setDrawer("pool")} className={secondaryButtonClass}>Create injector pool</button>
                <button type="button" onClick={() => setDrawer("gate")} disabled={!resolvedProjectId} className={secondaryButtonClass}>Create gate policy</button>
              </div>
            </section>
            <section className={panelClass}>
              <PlatformSectionHeader dense={isDense} eyebrow="Compare" title="Baseline and candidate" description="Select a pair from the profile or run tables." />
              <div className="mt-4">
                {compareQuery.data ? <div className="space-y-3"><div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"><p className="text-sm font-medium text-slate-900">{compareQuery.data.degradationDiff.summary}</p><p className="mt-1 text-xs text-slate-500">{`${compareQuery.data.baselineRun.scenarioLabel} -> ${compareQuery.data.candidateRun.scenarioLabel}`}</p></div>{compareQuery.data.thresholdDiff.map((diff) => <div key={diff.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3"><div className="flex items-center justify-between gap-3"><p className="text-sm font-medium text-slate-900">{diff.label}</p><PlatformBadge dense tone={diff.direction === "worse" ? "danger" : diff.direction === "better" ? "success" : "neutral"}>{diff.direction.toUpperCase()}</PlatformBadge></div><p className="mt-2 text-xs text-slate-500">{diff.summary}</p></div>)}</div> : <PlatformEmptyState message="Pick a finished run and a baseline." />}
              </div>
            </section>
          </aside>
        </div>
      )}
      <PlatformDrawer
        open={drawer !== null}
        title={drawer === "environment" ? "Create environment" : drawer === "pool" ? "Create injector pool" : drawer === "gate" ? "Create gate policy" : "New profile"}
        description={drawer === "profile" ? "Target, execution, and thresholds" : "Platform resource"}
        onClose={() => setDrawer(null)}
        footer={<><button type="button" onClick={() => setDrawer(null)} className={secondaryButtonClass}>Close</button><button type="button" onClick={drawer === "environment" ? saveEnvironment : drawer === "pool" ? savePool : drawer === "gate" ? saveGatePolicy : saveProfile} disabled={drawer === "profile" ? !canCreateProfile : drawer === "gate" ? !resolvedProjectId : false} className={primaryButtonClass}>{drawer === "profile" ? "Save profile" : "Create"}</button></>}
      >
        {drawer === "environment" ? <div className="space-y-4"><PlatformFormField label="Name"><input className={inputClass} value={environmentName} onChange={(event) => setEnvironmentName(event.target.value)} /></PlatformFormField><PlatformFormField label="Base URL"><input className={inputClass} value={environmentBaseUrl} onChange={(event) => setEnvironmentBaseUrl(event.target.value)} /></PlatformFormField><PlatformFormField label="Owner"><input className={inputClass} value={environmentOwner} onChange={(event) => setEnvironmentOwner(event.target.value)} /></PlatformFormField><PlatformAdvancedPanel title="Advanced JSON" description="Service node payload" open={showEnvironmentAdvanced} onToggle={() => setShowEnvironmentAdvanced((value) => !value)}><textarea className={`${inputClass} min-h-[160px] font-mono`} value={environmentNodesJson} onChange={(event) => setEnvironmentNodesJson(event.target.value)} /></PlatformAdvancedPanel></div> : drawer === "pool" ? <div className="space-y-4"><PlatformFormField label="Name"><input className={inputClass} value={poolName} onChange={(event) => setPoolName(event.target.value)} /></PlatformFormField><PlatformFormField label="Region"><input className={inputClass} value={poolRegion} onChange={(event) => setPoolRegion(event.target.value)} /></PlatformFormField><div className="grid grid-cols-2 gap-4"><PlatformFormField label="Capacity"><input className={inputClass} value={poolCapacity} onChange={(event) => setPoolCapacity(event.target.value)} /></PlatformFormField><PlatformFormField label="Concurrency"><input className={inputClass} value={poolConcurrencyLimit} onChange={(event) => setPoolConcurrencyLimit(event.target.value)} /></PlatformFormField></div></div> : drawer === "gate" ? <div className="space-y-4"><PlatformFormField label="Name"><input className={inputClass} value={gatePolicyName} onChange={(event) => setGatePolicyName(event.target.value)} /></PlatformFormField><PlatformFormField label="Required flows"><textarea className={`${inputClass} min-h-[120px]`} value={requiredFlows} onChange={(event) => setRequiredFlows(event.target.value)} /></PlatformFormField></div> : <div className="space-y-4"><PlatformFormField label="Name"><input className={inputClass} value={profileName} onChange={(event) => setProfileName(event.target.value)} /></PlatformFormField><PlatformFormField label="Scenario"><input className={inputClass} value={scenarioLabel} onChange={(event) => setScenarioLabel(event.target.value)} /></PlatformFormField><PlatformFormField label="Target URL"><input className={inputClass} value={targetBaseUrl} onChange={(event) => setTargetBaseUrl(event.target.value)} /></PlatformFormField><div className="grid grid-cols-2 gap-4"><PlatformFormField label="Environment"><select className={inputClass} value={selectedEnvironmentId} onChange={(event) => updateSearch({ selectedEnvironmentId: event.target.value })}>{environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}</select></PlatformFormField><PlatformFormField label="Gate policy"><select className={inputClass} value={selectedGatePolicyId} onChange={(event) => updateSearch({ selectedGatePolicyId: event.target.value || null })}><option value="">No gate policy</option>{gatePolicies.map((policy) => <option key={policy.id} value={policy.id}>{policy.name}</option>)}</select></PlatformFormField></div><div className="grid grid-cols-2 gap-4"><PlatformFormField label="Engine"><select className={inputClass} value={engine} onChange={(event) => setEngine(event.target.value as LoadProfile["engine"])}><option value="k6_http">k6 HTTP</option><option value="synthetic">Synthetic</option><option value="browser_probe">Browser probe</option></select></PlatformFormField><PlatformFormField label="Pattern"><select className={inputClass} value={pattern} onChange={(event) => setPattern(event.target.value as LoadProfile["pattern"])}><option value="steady">steady</option><option value="ramp">ramp</option><option value="spike">spike</option><option value="soak">soak</option><option value="breakpoint">breakpoint</option></select></PlatformFormField></div><div className="grid grid-cols-2 gap-4"><PlatformFormField label="Execution mode"><select className={inputClass} value={executionMode} onChange={(event) => setExecutionMode(event.target.value as LoadProfile["executionMode"])}><option value="local">local</option><option value="distributed">distributed</option></select></PlatformFormField><PlatformFormField label="Workers"><input className={inputClass} value={workerCount} onChange={(event) => setWorkerCount(event.target.value)} /></PlatformFormField></div>{executionMode === "distributed" ? <PlatformFormField label="Injector pool"><select className={inputClass} value={selectedInjectorPoolId} onChange={(event) => updateSearch({ selectedInjectorPoolId: event.target.value || null })}><option value="">Select a pool</option>{injectorPools.map((pool) => <option key={pool.id} value={pool.id}>{`${pool.name} (${pool.region})`}</option>)}</select></PlatformFormField> : null}<div className="grid grid-cols-[120px_minmax(0,1fr)] gap-4"><PlatformFormField label="Method"><select className={inputClass} value={httpMethod} onChange={(event) => setHttpMethod(event.target.value as NonNullable<LoadProfile["httpMethod"]>)}><option value="GET">GET</option><option value="POST">POST</option></select></PlatformFormField><PlatformFormField label="Path"><input className={inputClass} value={requestPath} onChange={(event) => setRequestPath(event.target.value)} /></PlatformFormField></div><div className="grid grid-cols-3 gap-4"><PlatformFormField label="P95 ms"><input className={inputClass} value={maxP95Ms} onChange={(event) => setMaxP95Ms(event.target.value)} /></PlatformFormField><PlatformFormField label="Error rate %"><input className={inputClass} value={maxErrorRatePct} onChange={(event) => setMaxErrorRatePct(event.target.value)} /></PlatformFormField><PlatformFormField label="Throughput rps"><input className={inputClass} value={minThroughputRps} onChange={(event) => setMinThroughputRps(event.target.value)} /></PlatformFormField></div><PlatformAdvancedPanel title="Advanced" description="Headers, body, and tags" open={showProfileAdvanced} onToggle={() => setShowProfileAdvanced((value) => !value)}><div className="space-y-4"><PlatformFormField label="Headers"><textarea className={`${inputClass} min-h-[120px] font-mono`} value={headersJson} onChange={(event) => setHeadersJson(event.target.value)} /></PlatformFormField><PlatformFormField label="Body"><textarea className={`${inputClass} min-h-[80px] font-mono`} value={bodyTemplate} onChange={(event) => setBodyTemplate(event.target.value)} placeholder="Optional request body" /></PlatformFormField><PlatformFormField label="Tags"><input className={inputClass} value={tagsJson} onChange={(event) => setTagsJson(event.target.value)} /></PlatformFormField></div></PlatformAdvancedPanel></div>}
      </PlatformDrawer>
    </PlatformPageShell>
  );
};
