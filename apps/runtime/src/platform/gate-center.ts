import { nanoid } from "nanoid";
import type {
  BenchmarkSummary,
  CaseTemplate,
  ControlTowerSummary,
  GatePolicy,
  GateResult,
  GateSignal,
  InjectorWorker,
  LoadProfile,
  LoadRun,
  ReleaseCandidate,
  Run,
  Waiver
} from "@qpilot/shared";

const verdictRank: Record<LoadRun["verdict"], number> = {
  ship: 3,
  watch: 2,
  hold: 1
};

const normalize = (value: string): string => value.trim().toLowerCase();

const isActiveWaiver = (waiver: Waiver, nowIso: string): boolean =>
  waiver.status === "active" && Date.parse(waiver.expiresAt) > Date.parse(nowIso);

const filterBoundEvidence = <T extends { id: string }>(items: T[], boundIds: string[]): T[] => {
  if (boundIds.length === 0) {
    return items;
  }

  const idSet = new Set(boundIds);
  return items.filter((item) => idSet.has(item.id));
};

export const scopeReleaseEvidence = <TRun extends { id: string }, TLoadRun extends { id: string }>(
  params: {
    release: Pick<ReleaseCandidate, "sourceRunIds" | "sourceLoadRunIds">;
    projectRuns: TRun[];
    loadRuns: TLoadRun[];
  }
): { projectRuns: TRun[]; loadRuns: TLoadRun[] } => ({
  projectRuns: filterBoundEvidence(params.projectRuns, params.release.sourceRunIds),
  loadRuns: filterBoundEvidence(params.loadRuns, params.release.sourceLoadRunIds)
});

const matchesFunctionalFlow = (run: Run, flow: string): boolean => {
  const token = normalize(flow);
  return [run.goal, run.replayCaseTitle]
    .filter((value): value is string => Boolean(value))
    .some((value) => normalize(value).includes(token));
};

const buildFunctionalSignals = (
  policy: GatePolicy,
  projectRuns: Run[]
): GateSignal[] =>
  policy.requiredFunctionalFlows.map((flow) => {
    const latest = [...projectRuns]
      .filter((run) => matchesFunctionalFlow(run, flow))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

    if (!latest) {
      return {
        id: `functional:${flow}`,
        kind: "functional",
        status: "failed",
        label: flow,
        detail: "No recent functional run matched this required flow."
      };
    }

    return {
      id: `functional:${flow}`,
      kind: "functional",
      status: latest.status === "passed" ? "passed" : "failed",
      label: flow,
      detail:
        latest.status === "passed"
          ? `Latest matching run ${latest.id} passed.`
          : `Latest matching run ${latest.id} ended as ${latest.status}.`,
      sourceId: latest.id
    };
  });

const buildBenchmarkSignals = (
  policy: GatePolicy,
  benchmark: BenchmarkSummary
): GateSignal[] => {
  const coveragePct =
    benchmark.scenarioCount > 0
      ? (benchmark.coveredScenarioCount / benchmark.scenarioCount) * 100
      : 0;
  const passRatePct = benchmark.passRate * 100;

  return [
    {
      id: "benchmark:coverage",
      kind: "benchmark",
      status:
        coveragePct >= policy.minBenchmarkCoveragePct ? "passed" : "failed",
      label: "Benchmark coverage",
      detail: `Coverage ${coveragePct.toFixed(1)}% vs required ${policy.minBenchmarkCoveragePct.toFixed(1)}%.`
    },
    {
      id: "benchmark:pass-rate",
      kind: "benchmark",
      status:
        passRatePct >= policy.minBenchmarkPassRate ? "passed" : "failed",
      label: "Benchmark pass rate",
      detail: `Pass rate ${passRatePct.toFixed(1)}% vs required ${policy.minBenchmarkPassRate.toFixed(1)}%.`
    }
  ];
};

const buildLoadSignals = (
  policy: GatePolicy,
  loadProfiles: LoadProfile[],
  loadRuns: LoadRun[],
  release: ReleaseCandidate
): GateSignal[] =>
  policy.requiredLoadProfileIds.map((profileId) => {
    const profile = loadProfiles.find((entry) => entry.id === profileId);
    const latest = [...loadRuns]
      .filter(
        (run) =>
          run.profileId === profileId &&
          (!release.environmentId || run.environmentId === release.environmentId)
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

    if (!latest) {
      return {
        id: `load:${profileId}`,
        kind: "load",
        status: "failed",
        label: profile?.name ?? profileId,
        detail: "No load run evidence was found for this required profile."
      };
    }

    const meetsMinimum = verdictRank[latest.verdict] >= verdictRank[policy.minimumLoadVerdict];
    const status: GateSignal["status"] =
      !meetsMinimum ? "failed" : latest.verdict === "watch" ? "warning" : "passed";

    return {
      id: `load:${profileId}`,
      kind: "load",
      status,
      label: profile?.name ?? latest.profileName,
      detail: `Latest run ${latest.id} produced ${latest.verdict.toUpperCase()} in ${latest.environmentLabel}.`,
      sourceId: latest.id
    };
  });

export const buildReleaseGateResult = (params: {
  release: ReleaseCandidate;
  policy: GatePolicy;
  projectRuns: Run[];
  caseTemplates: CaseTemplate[];
  benchmark: BenchmarkSummary;
  loadProfiles: LoadProfile[];
  loadRuns: LoadRun[];
  waivers: Waiver[];
  nowIso?: string;
}): GateResult => {
  const nowIso = params.nowIso ?? new Date().toISOString();
  const scopedEvidence = scopeReleaseEvidence({
    release: params.release,
    projectRuns: params.projectRuns,
    loadRuns: params.loadRuns
  });
  const signals = [
    ...buildFunctionalSignals(params.policy, scopedEvidence.projectRuns),
    ...buildBenchmarkSignals(params.policy, params.benchmark),
    ...buildLoadSignals(params.policy, params.loadProfiles, scopedEvidence.loadRuns, params.release)
  ];

  const activeWaivers = params.waivers.filter((waiver) => isActiveWaiver(waiver, nowIso));
  const waivedKeys = new Set(activeWaivers.map((waiver) => waiver.blockerKey));

  const normalizedSignals = signals.map((signal) =>
    signal.status === "failed" && waivedKeys.has(signal.id)
      ? { ...signal, status: "waived" as const }
      : signal
  );

  const blockers = normalizedSignals
    .filter((signal) => signal.status === "failed")
    .map((signal) => signal.label);
  const hasWarnings = normalizedSignals.some(
    (signal) => signal.status === "warning" || signal.status === "waived"
  );

  const verdict: GateResult["verdict"] =
    blockers.length > 0 ? "hold" : hasWarnings ? "watch" : "ship";

  const summary =
    verdict === "ship"
      ? "Release evidence is healthy across functional, benchmark, and load signals."
      : verdict === "watch"
        ? "Release evidence is mostly healthy, but at least one signal still needs attention or waiver review."
        : "Release evidence contains blocking signals that should stop promotion.";

  return {
    id: nanoid(),
    releaseId: params.release.id,
    verdict,
    summary,
    blockers,
    signals: normalizedSignals,
    waiverCount: activeWaivers.length,
    evaluatedAt: nowIso
  };
};

export const buildControlTowerSummary = (params: {
  releases: ReleaseCandidate[];
  gateResults: GateResult[];
  loadRuns: LoadRun[];
  injectorWorkers: InjectorWorker[];
}): ControlTowerSummary => {
  const latestReleases = [...params.releases]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 6);
  const blockers = params.gateResults
    .flatMap((result) => result.blockers)
    .slice(0, 6);

  return {
    activeReleaseCount: params.releases.length,
    blockedReleaseCount: params.gateResults.filter((result) => result.verdict === "hold").length,
    activeLoadRunCount: params.loadRuns.filter(
      (run) => run.status === "queued" || run.status === "running"
    ).length,
    onlineWorkerCount: params.injectorWorkers.filter((worker) => worker.status !== "offline").length,
    topBlockers: blockers,
    latestReleases
  };
};
