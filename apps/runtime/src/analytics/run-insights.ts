import type {
  ApiVerificationRequest,
  BenchmarkScenarioSummary,
  BenchmarkSummary,
  CaseTemplate,
  FailureCategory,
  Language,
  NetworkEvidenceEntry,
  Run,
  RunComparison,
  RunComparisonStep,
  RunDiagnosis,
  Step
} from "@qpilot/shared";

const preferredLanguage = (
  run: Pick<Run, "language">,
  language?: Language
): Language => language ?? run.language ?? "en";

const localized = (
  run: Pick<Run, "language">,
  english: string,
  chinese: string,
  language?: Language
): string => (preferredLanguage(run, language) === "zh-CN" ? chinese : english);

const labelFailureCategory = (
  category: FailureCategory | undefined,
  run: Pick<Run, "language">,
  language?: Language
): string | undefined => {
  switch (category) {
    case "ai_timeout":
      return localized(run, "the planner timed out", "规划模型超时", language);
    case "security_challenge":
      return localized(run, "the flow hit a security challenge", "流程遇到了安全校验", language);
    case "element_visibility":
      return localized(run, "the page controls were not safely interactable", "页面控件当前无法稳定交互", language);
    case "navigation_error":
      return localized(run, "navigation drifted away from the intended route", "导航偏离了预期路径", language);
    case "max_steps":
      return localized(run, "the run used up its step budget", "运行耗尽了步数预算", language);
    case "manual_timeout":
      return localized(run, "manual takeover was not completed in time", "人工接管未能在时限内完成", language);
    case "run_aborted":
      return localized(run, "the run was stopped before completion", "运行在完成前被停止了", language);
    case "runtime_error":
      return localized(run, "the runtime surfaced an execution error", "runtime 抛出了执行错误", language);
    default:
      return undefined;
  }
};

const labelRunStatus = (
  status: Run["status"],
  run: Pick<Run, "language">,
  language?: Language
): string => {
  switch (status) {
    case "queued":
      return localized(run, "queued", "排队中", language);
    case "running":
      return localized(run, "running", "运行中", language);
    case "passed":
      return localized(run, "passed", "已通过", language);
    case "failed":
      return localized(run, "failed", "失败", language);
    case "stopped":
      return localized(run, "stopped", "已停止", language);
    default:
      return status;
  }
};

const summarizeAction = (step: Step | undefined): string | undefined => {
  if (!step) {
    return undefined;
  }
  return [step.action.type, step.action.target ?? step.action.value ?? ""]
    .join(" ")
    .trim();
};

const pickLastRelevantStep = (steps: Step[]): Step | undefined =>
  [...steps]
    .reverse()
    .find((step) => step.actionStatus !== "success" || step.verificationResult.passed === false) ??
  steps.at(-1);

const pickKeyRequest = (
  step: Step | undefined,
  traffic: NetworkEvidenceEntry[]
): ApiVerificationRequest | undefined => {
  const direct =
    step?.verificationResult.api?.keyRequests.find((item) => item.phase === "failed" || item.ok === false) ??
    step?.verificationResult.api?.keyRequests[0];
  if (direct) {
    return direct;
  }

  const trafficHit = [...traffic]
    .reverse()
    .find(
      (entry) =>
        (step ? entry.stepIndex === step.index : true) &&
        (entry.phase === "failed" || entry.ok === false || (entry.status ?? 200) >= 400)
    );
  if (!trafficHit) {
    return undefined;
  }

  return {
    method: trafficHit.method,
    url: trafficHit.url,
    host: trafficHit.host,
    pathname: trafficHit.pathname,
    resourceType: trafficHit.resourceType,
    status: trafficHit.status,
    ok: trafficHit.ok,
    phase: trafficHit.phase,
    contentType: trafficHit.contentType,
    bodyPreview: trafficHit.bodyPreview
  };
};

const deriveRootCause = (
  run: Run,
  step: Step | undefined,
  language?: Language
): string => {
  const execution = step?.verificationResult.execution;
  const api = step?.verificationResult.api;

  return (
    step?.verificationResult.pageState?.authErrorText ??
    execution?.failureReason ??
    execution?.failureSuggestion ??
    api?.note ??
    run.challengeReason ??
    labelFailureCategory(run.failureCategory, run, language) ??
    run.errorMessage ??
    run.failureSuggestion ??
    localized(
      run,
      "The run stopped without a richer structured root-cause signal.",
      "这次运行停止了，但还没有更结构化的根因信号。",
      language
    )
  );
};

const deriveStopReason = (
  run: Run,
  step: Step | undefined,
  language?: Language
): string => {
  if (run.status === "passed") {
    return localized(run, "The run reached an aligned success surface.", "运行到达了对齐的成功页面。", language);
  }
  if (run.challengeKind) {
    return localized(
      run,
      `The run paused on ${run.challengeKind.replaceAll("_", " ")}.`,
      `运行停在了 ${run.challengeKind.replaceAll("_", " ")} 阶段。`,
      language
    );
  }
  if (step?.verificationResult.outcome === "blocking_failure") {
    return localized(
      run,
      "The current page state blocked further safe automation.",
      "当前页面状态阻止了后续安全自动化。",
      language
    );
  }
  if (run.status === "stopped") {
    return localized(run, "The run was intentionally stopped.", "这次运行被主动停止了。", language);
  }
  if (run.failureCategory) {
    return localized(
      run,
      `The run ended as ${run.failureCategory.replaceAll("_", " ")}.`,
      `运行最终以 ${labelFailureCategory(run.failureCategory, run, language) ?? run.failureCategory.replaceAll("_", " ")} 结束。`,
      language
    );
  }
  return localized(
    run,
    "The run ended before reaching a success state.",
    "运行在到达成功态之前结束了。",
    language
  );
};

const deriveNextBestAction = (
  run: Run,
  step: Step | undefined,
  language?: Language
): string => {
  if (run.status === "passed") {
    return localized(
      run,
      "Use this run as the benchmark baseline or extract a reusable case template.",
      "可以把这次运行沉淀成 benchmark 基线，或者提取成可复用的 Case 模板。",
      language
    );
  }
  if (run.failureSuggestion) {
    return run.failureSuggestion;
  }
  if (run.challengeKind) {
    return localized(
      run,
      "Resume from a visible session after the human checkpoint is solved.",
      "先在可见浏览器里完成人工校验，再恢复运行。",
      language
    );
  }
  if (step?.verificationResult.execution?.failureSuggestion) {
    return step.verificationResult.execution.failureSuggestion;
  }
  return localized(
    run,
    "Compare this run against the latest stable run before retrying.",
    "先和最近一次稳定运行做对比，再决定是否重试。",
    language
  );
};

const deriveUserImpact = (run: Run, language?: Language): string => {
  if (run.status === "passed") {
    return localized(
      run,
      "The target user journey completed and the platform captured evidence for it.",
      "目标用户链路已经走通，并且平台已经为它保留了证据。",
      language
    );
  }
  if (run.challengeKind) {
    return localized(
      run,
      "A real user would be blocked at the same challenge gate until manual verification succeeds.",
      "真实用户也会卡在同一个校验关口，直到人工验证通过。",
      language
    );
  }
  return localized(
    run,
    "The intended business flow did not complete, so this path still needs investigation before release.",
    "目标业务链路没有完成，因此这条路径在发版前仍需要继续排查。",
    language
  );
};

export const buildRunDiagnosis = (input: {
  run: Run;
  steps: Step[];
  traffic?: NetworkEvidenceEntry[];
  language?: Language;
}): RunDiagnosis => {
  const step = pickLastRelevantStep(input.steps);
  const heroScreenshotPath = step?.screenshotPath ?? input.run.startupScreenshotPath;
  const pageUrl = step?.pageUrl ?? input.run.currentPageUrl ?? input.run.startupPageUrl;
  const pageTitle = step?.pageTitle ?? input.run.currentPageTitle ?? input.run.startupPageTitle;
  const rootCause = deriveRootCause(input.run, step, input.language);
  const stopReason = deriveStopReason(input.run, step, input.language);

  return {
    runId: input.run.id,
    status: input.run.status,
    headline:
      input.run.status === "passed"
        ? localized(
            input.run,
            `Scenario passed on ${pageTitle ?? pageUrl ?? input.run.targetUrl}.`,
            `场景已在 ${pageTitle ?? pageUrl ?? input.run.targetUrl} 走通。`,
            input.language
          )
        : localized(
            input.run,
            `Run stopped on ${pageTitle ?? pageUrl ?? input.run.targetUrl}.`,
            `运行停在了 ${pageTitle ?? pageUrl ?? input.run.targetUrl}。`,
            input.language
          ),
    rootCause,
    stopReason,
    nextBestAction: deriveNextBestAction(input.run, step, input.language),
    userImpact: deriveUserImpact(input.run, input.language),
    failureCategory: input.run.failureCategory,
    heroScreenshotPath,
    keyRequest: pickKeyRequest(step, input.traffic ?? []),
    pageUrl,
    pageTitle,
    stepCount: input.steps.length
  };
};

const compareStrings = (left: string | undefined, right: string | undefined): boolean =>
  (left ?? "").trim() === (right ?? "").trim();

export const buildRunComparison = (input: {
  baseRun: Run;
  baseSteps: Step[];
  baseTraffic?: NetworkEvidenceEntry[];
  candidateRun: Run;
  candidateSteps: Step[];
  candidateTraffic?: NetworkEvidenceEntry[];
  language?: Language;
}): RunComparison => {
  const baseDiagnosis = buildRunDiagnosis({
    run: input.baseRun,
    steps: input.baseSteps,
    traffic: input.baseTraffic,
    language: input.language
  });
  const candidateDiagnosis = buildRunDiagnosis({
    run: input.candidateRun,
    steps: input.candidateSteps,
    traffic: input.candidateTraffic,
    language: input.language
  });

  const maxLength = Math.max(input.baseSteps.length, input.candidateSteps.length);
  const stepChanges: RunComparisonStep[] = [];
  let firstDivergenceStep: number | undefined;

  for (let index = 0; index < maxLength; index += 1) {
    const baseStep = input.baseSteps[index];
    const candidateStep = input.candidateSteps[index];
    const stepNumber = index + 1;

    if (!baseStep && candidateStep) {
      firstDivergenceStep ??= stepNumber;
      stepChanges.push({
        index: stepNumber,
        change: "added",
        candidateAction: summarizeAction(candidateStep),
        candidateUrl: candidateStep.pageUrl,
        summary: localized(
          input.candidateRun,
          `Candidate run adds step ${stepNumber}: ${summarizeAction(candidateStep) ?? "unknown action"}.`,
          `候选运行新增了第 ${stepNumber} 步：${summarizeAction(candidateStep) ?? "未知动作"}。`,
          input.language
        )
      });
      continue;
    }

    if (baseStep && !candidateStep) {
      firstDivergenceStep ??= stepNumber;
      stepChanges.push({
        index: stepNumber,
        change: "missing",
        baseAction: summarizeAction(baseStep),
        baseUrl: baseStep.pageUrl,
        summary: localized(
          input.baseRun,
          `Candidate run no longer reaches step ${stepNumber}: ${summarizeAction(baseStep) ?? "unknown action"}.`,
          `候选运行没有再走到第 ${stepNumber} 步：${summarizeAction(baseStep) ?? "未知动作"}。`,
          input.language
        )
      });
      continue;
    }

    if (!baseStep || !candidateStep) {
      continue;
    }

    const sameAction =
      compareStrings(summarizeAction(baseStep), summarizeAction(candidateStep)) &&
      compareStrings(baseStep.actionStatus, candidateStep.actionStatus);
    const sameUrl = compareStrings(baseStep.pageUrl, candidateStep.pageUrl);

    if (!sameAction || !sameUrl) {
      firstDivergenceStep ??= stepNumber;
      stepChanges.push({
        index: stepNumber,
        change: "changed",
        baseAction: summarizeAction(baseStep),
        candidateAction: summarizeAction(candidateStep),
        baseUrl: baseStep.pageUrl,
        candidateUrl: candidateStep.pageUrl,
        summary: localized(
          input.baseRun,
          `Step ${stepNumber} changed from "${summarizeAction(baseStep) ?? "unknown"}" to "${summarizeAction(candidateStep) ?? "unknown"}".`,
          `第 ${stepNumber} 步从“${summarizeAction(baseStep) ?? "未知"}”变成了“${summarizeAction(candidateStep) ?? "未知"}”。`,
          input.language
        )
      });
    }
  }

  const changedSignals: string[] = [];
  if (input.baseRun.status !== input.candidateRun.status) {
    changedSignals.push("status");
  }
  if (input.baseSteps.length !== input.candidateSteps.length) {
    changedSignals.push("step_count");
  }
  if (!compareStrings(baseDiagnosis.pageUrl, candidateDiagnosis.pageUrl)) {
    changedSignals.push("final_page");
  }
  if (!compareStrings(input.baseRun.failureCategory, input.candidateRun.failureCategory)) {
    changedSignals.push("failure_category");
  }

  const headline =
    input.baseRun.status !== input.candidateRun.status
      ? localized(
          input.candidateRun,
          `Outcome changed from ${labelRunStatus(input.baseRun.status, input.candidateRun, input.language)} to ${labelRunStatus(input.candidateRun.status, input.candidateRun, input.language)}.`,
          `结果从 ${labelRunStatus(input.baseRun.status, input.candidateRun, input.language)} 变成了 ${labelRunStatus(input.candidateRun.status, input.candidateRun, input.language)}。`,
          input.language
        )
      : firstDivergenceStep
        ? localized(
            input.candidateRun,
            `Runs diverged at step ${firstDivergenceStep}.`,
            `两次运行从第 ${firstDivergenceStep} 步开始分叉。`,
            input.language
          )
        : localized(
            input.candidateRun,
            "Runs produced the same outcome.",
            "两次运行得到了同样的结果。",
            input.language
          );

  const summary =
    input.candidateRun.status === "passed" && input.baseRun.status !== "passed"
      ? localized(
          input.candidateRun,
          "The candidate run recovered the flow and reached a success state.",
          "候选运行修复了这条链路，并成功走到了完成态。",
          input.language
        )
      : input.candidateRun.status !== "passed" && input.baseRun.status === "passed"
        ? localized(
            input.candidateRun,
            "The candidate run regressed away from the previously stable result.",
            "候选运行相对之前稳定结果发生了回退。",
            input.language
          )
        : localized(
            input.candidateRun,
            "Use the changed signals and step-level diffs below to inspect where the path drifted.",
            "可以结合下面的变化信号和步骤差异，定位链路是从哪里开始漂移的。",
            input.language
          );

  return {
    baseRun: input.baseRun,
    candidateRun: input.candidateRun,
    baseDiagnosis,
    candidateDiagnosis,
    headline,
    summary,
    statusChanged: input.baseRun.status !== input.candidateRun.status,
    stepDelta: input.candidateSteps.length - input.baseSteps.length,
    firstDivergenceStep,
    changedSignals,
    stepChanges: stepChanges.slice(0, 6)
  };
};

const toTimestamp = (value: string | undefined): number => (value ? new Date(value).getTime() : 0);

export const buildBenchmarkSummary = (input: {
  projectId?: string;
  caseTemplates: CaseTemplate[];
  runs: Run[];
  language?: Language;
}): BenchmarkSummary => {
  const scenarios: BenchmarkScenarioSummary[] = input.caseTemplates.map((item) => {
    const relatedRuns = input.runs
      .filter((run) => run.replayCaseId === item.id)
      .sort((left, right) => toTimestamp(right.createdAt) - toTimestamp(left.createdAt));
    const latestPassedRun = relatedRuns.find((run) => run.status === "passed");
    const latestFailedRun = relatedRuns.find(
      (run) => run.status === "failed" || run.status === "stopped"
    );
    const passCount = relatedRuns.filter((run) => run.status === "passed").length;
    const totalSteps = relatedRuns.reduce((sum, run) => sum + (run.stepCount ?? 0), 0);
    const avgSteps = relatedRuns.length > 0 ? totalSteps / relatedRuns.length : 0;
    const lastRun = relatedRuns[0];
    const failureCounts = new Map<string, number>();

    for (const run of relatedRuns) {
      if (!run.failureCategory) {
        continue;
      }
      failureCounts.set(run.failureCategory, (failureCounts.get(run.failureCategory) ?? 0) + 1);
    }

    const topFailureCategory = Array.from(failureCounts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0];
    const lastDiagnosisHeadline = lastRun
      ? buildRunDiagnosis({
          run: lastRun,
          steps: [],
          language: input.language
        }).headline
      : undefined;

    return {
      caseId: item.id,
      title: item.title,
      type: item.type,
      goal: item.goal,
      entryUrl: item.entryUrl,
      runCount: relatedRuns.length,
      passCount,
      passRate: relatedRuns.length > 0 ? passCount / relatedRuns.length : 0,
      avgSteps,
      lastRunId: lastRun?.id,
      lastRunStatus: lastRun?.status,
      lastRunAt: lastRun?.createdAt,
      latestPassedRunId: latestPassedRun?.id,
      latestPassedRunAt: latestPassedRun?.createdAt,
      latestFailedRunId: latestFailedRun?.id,
      latestFailedRunAt: latestFailedRun?.createdAt,
      lastDiagnosisHeadline,
      topFailureCategory
    };
  });

  const replayRuns = input.runs.filter((run) => Boolean(run.replayCaseId));
  const totalPasses = replayRuns.filter((run) => run.status === "passed").length;
  const totalSteps = replayRuns.reduce((sum, run) => sum + (run.stepCount ?? 0), 0);
  const failureBuckets = new Map<string, number>();

  for (const run of replayRuns) {
    if (!run.failureCategory) {
      continue;
    }
    failureBuckets.set(run.failureCategory, (failureBuckets.get(run.failureCategory) ?? 0) + 1);
  }

  return {
    projectId: input.projectId,
    scenarioCount: input.caseTemplates.length,
    coveredScenarioCount: scenarios.filter((item) => item.runCount > 0).length,
    replayRunCount: replayRuns.length,
    passRate: replayRuns.length > 0 ? totalPasses / replayRuns.length : 0,
    avgSteps: replayRuns.length > 0 ? totalSteps / replayRuns.length : 0,
    recentFailureCategories: Array.from(failureBuckets.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([category, count]) => ({ category, count })),
    scenarios: scenarios.sort((left, right) => {
      const score = (scenario: BenchmarkScenarioSummary): number => {
        if (scenario.runCount === 0) {
          return 3;
        }
        if (scenario.lastRunStatus === "failed" || scenario.lastRunStatus === "stopped") {
          return 2;
        }
        if (scenario.lastRunStatus === "queued" || scenario.lastRunStatus === "running") {
          return 1;
        }
        return 0;
      };

      const priorityDelta = score(right) - score(left);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return toTimestamp(right.lastRunAt) - toTimestamp(left.lastRunAt);
    })
  };
};
