import type {
  Action,
  ApprovalEvent,
  CaseTemplate,
  ChallengeKind,
  EncryptedText,
  EnvironmentServiceNode,
  EnvironmentTarget,
  ExecutionMode,
  FailureCategory,
  GatePolicy,
  GatePolicyVersion,
  GateResult,
  GateSignal,
  InjectorPool,
  InjectorWorker,
  Language,
  LoadArrivalModel,
  LoadBaselineHistoryEntry,
  LoadExecutionMode,
  LoadProfileVersion,
  LLMDecision,
  LoadProfile,
  LoadRun,
  LoadRunMetrics,
  LoadRunSampleWindow,
  LoadRunWorker,
  LoadThreshold,
  Project,
  ReleaseCandidate,
  Run,
  Step,
  TestCase,
  VerificationResult,
  Waiver
} from "@qpilot/shared";

export interface ProjectRow {
  id: string;
  name: string;
  baseUrl: string;
  usernameCipher: string | null;
  usernameIv: string | null;
  usernameTag: string | null;
  passwordCipher: string | null;
  passwordIv: string | null;
  passwordTag: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface RunRow {
  id: string;
  projectId: string;
  status: string;
  mode: string;
  targetUrl: string;
  goal: string;
  model: string | null;
  configJson?: string | null;
  startupPageUrl: string | null;
  startupPageTitle: string | null;
  startupScreenshotPath: string | null;
  startupObservation: string | null;
  challengeKind: string | null;
  challengeReason: string | null;
  recordedVideoPath: string | null;
  llmLastJson: string | null;
  errorMessage: string | null;
  startedAt: number | null;
  endedAt: number | null;
  createdAt: number;
}

export interface StepRow {
  id: string;
  runId: string;
  stepIndex: number;
  pageUrl: string;
  pageTitle: string;
  domSummaryJson: string;
  screenshotPath: string;
  actionJson: string;
  actionStatus: string;
  observationSummary: string;
  verificationJson: string;
  createdAt: number;
}

export interface TestCaseRow {
  id: string;
  runId: string;
  module: string;
  title: string;
  preconditions: string | null;
  stepsJson: string;
  expected: string | null;
  actual: string | null;
  status: string;
  priority: string | null;
  method: string | null;
  createdAt: number;
}

export interface CaseTemplateRow {
  id: string;
  projectId: string;
  runId: string;
  type: string;
  title: string;
  goal: string;
  entryUrl: string;
  status: string;
  summary: string | null;
  caseJson: string;
  createdAt: number;
  updatedAt: number;
}

export interface LoadProfileRow {
  id: string;
  projectId: string;
  name: string;
  scenarioLabel: string;
  targetBaseUrl: string;
  environmentTargetId: string | null;
  engine: string;
  pattern: string;
  requestPath: string | null;
  httpMethod: string | null;
  headersJson: string | null;
  bodyTemplate: string | null;
  executionMode: string | null;
  workerCount: number | null;
  injectorPoolId: string | null;
  arrivalModel: string | null;
  phasePlanJson: string | null;
  requestMixJson: string | null;
  evidencePolicyJson: string | null;
  gatePolicyId: string | null;
  tagsJson: string | null;
  baselineRunId: string | null;
  virtualUsers: number;
  durationSec: number;
  rampUpSec: number;
  targetRps: number | null;
  thresholdsJson: string;
  createdAt: number;
  updatedAt: number;
}

export interface LoadRunRow {
  id: string;
  projectId: string;
  profileId: string;
  profileName: string;
  scenarioLabel: string;
  targetBaseUrl: string;
  environmentId: string | null;
  engine: string;
  pattern: string;
  environmentLabel: string;
  status: string;
  verdict: string;
  source: string | null;
  metricsJson: string;
  notes: string | null;
  engineVersion: string | null;
  executorLabel: string | null;
  rawSummaryPath: string | null;
  compareBaselineRunId: string | null;
  startedAt: number;
  endedAt: number | null;
  createdAt: number;
}

export interface LoadRunWorkerRow {
  id: string;
  runId: string;
  workerIndex: number;
  workerLabel: string;
  injectorPoolId: string | null;
  injectorWorkerId: string | null;
  status: string;
  metricsJson: string;
  notes: string | null;
  engineVersion: string | null;
  executorLabel: string | null;
  rawSummaryPath: string | null;
  startedAt: number;
  endedAt: number | null;
  createdAt: number;
}

export interface LoadRunSampleWindowRow {
  id: string;
  runId: string;
  ts: number;
  p95Ms: number;
  errorRatePct: number;
  throughputRps: number;
  activeWorkers: number;
  note: string | null;
}

export interface LoadProfileBaselineEventRow {
  id: string;
  profileId: string;
  runId: string;
  action: string;
  note: string | null;
  createdAt: number;
}

export interface LoadProfileVersionRow {
  id: string;
  profileId: string;
  versionNumber: number;
  reason: string | null;
  snapshotJson: string;
  createdAt: number;
}

export interface EnvironmentTargetRow {
  id: string;
  projectId: string | null;
  name: string;
  baseUrl: string;
  authType: string | null;
  owner: string | null;
  riskLevel: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface EnvironmentServiceNodeRow {
  id: string;
  environmentId: string;
  name: string;
  protocol: string;
  baseUrl: string;
  healthPath: string | null;
  dependsOnJson: string;
  tagsJson: string;
  createdAt: number;
  updatedAt: number;
}

export interface InjectorPoolRow {
  id: string;
  name: string;
  region: string;
  capacity: number;
  concurrencyLimit: number;
  tagsJson: string;
  createdAt: number;
  updatedAt: number;
}

export interface InjectorWorkerRow {
  id: string;
  poolId: string;
  name: string;
  status: string;
  currentRunCount: number;
  capacity: number;
  lastHeartbeatAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface GatePolicyRow {
  id: string;
  projectId: string;
  name: string;
  requiredFunctionalFlowsJson: string;
  minBenchmarkCoveragePct: number;
  minBenchmarkPassRate: number;
  requiredLoadProfileIdsJson: string;
  minimumLoadVerdict: string;
  allowWaiver: number;
  approverRolesJson: string;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface GatePolicyVersionRow {
  id: string;
  policyId: string;
  versionNumber: number;
  status: string;
  reason: string | null;
  snapshotJson: string;
  createdAt: number;
}

export interface ReleaseCandidateRow {
  id: string;
  projectId: string;
  environmentId: string | null;
  gatePolicyId: string;
  name: string;
  buildLabel: string;
  status: string;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface GateResultRow {
  id: string;
  releaseId: string;
  verdict: string;
  summary: string;
  blockersJson: string;
  signalsJson: string;
  waiverCount: number;
  evaluatedAt: number;
}

export interface WaiverRow {
  id: string;
  releaseId: string;
  blockerKey: string;
  reason: string;
  requestedBy: string;
  approvedBy: string | null;
  expiresAt: number;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface ApprovalEventRow {
  id: string;
  releaseId: string;
  waiverId: string | null;
  actor: string;
  role: string;
  action: string;
  detail: string | null;
  createdAt: number;
}

const toIso = (value: number | null): string | undefined =>
  value ? new Date(value).toISOString() : undefined;

const encryptedBundle = (
  ciphertext: string | null,
  iv: string | null,
  tag: string | null
): EncryptedText | undefined => {
  if (!ciphertext || !iv || !tag) {
    return undefined;
  }
  return { ciphertext, iv, tag };
};

const parseRunConfig = (
  value?: string | null
): {
  maxSteps?: number;
  headed?: boolean;
  language?: Language;
  executionMode?: ExecutionMode;
  confirmDraft?: boolean;
  manualTakeover?: boolean;
  sessionProfile?: string;
  saveSession?: boolean;
  replayCaseId?: string;
  replayCaseTitle?: string;
  replayCaseType?: Run["replayCaseType"];
} => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as {
      maxSteps?: number;
      headed?: boolean;
      language?: Language;
      executionMode?: ExecutionMode;
      confirmDraft?: boolean;
      manualTakeover?: boolean;
      sessionProfile?: string;
      saveSession?: boolean;
      replayCase?: {
        templateId?: string;
        title?: string;
        type?: Run["replayCaseType"];
      };
    };

    return {
      maxSteps:
        typeof parsed.maxSteps === "number" && parsed.maxSteps > 0
          ? parsed.maxSteps
          : undefined,
      headed: typeof parsed.headed === "boolean" ? parsed.headed : undefined,
      language:
        parsed.language === "zh-CN" || parsed.language === "en"
          ? parsed.language
          : undefined,
      executionMode:
        parsed.executionMode === "auto_batch" || parsed.executionMode === "stepwise_replan"
          ? parsed.executionMode
          : undefined,
      confirmDraft:
        typeof parsed.confirmDraft === "boolean" ? parsed.confirmDraft : undefined,
      manualTakeover:
        typeof parsed.manualTakeover === "boolean" ? parsed.manualTakeover : undefined,
      sessionProfile:
        typeof parsed.sessionProfile === "string" && parsed.sessionProfile.trim().length > 0
          ? parsed.sessionProfile.trim()
          : undefined,
      saveSession: typeof parsed.saveSession === "boolean" ? parsed.saveSession : undefined,
      replayCaseId:
        typeof parsed.replayCase?.templateId === "string" ? parsed.replayCase.templateId : undefined,
      replayCaseTitle:
        typeof parsed.replayCase?.title === "string" ? parsed.replayCase.title : undefined,
      replayCaseType:
        parsed.replayCase?.type === "ui" || parsed.replayCase?.type === "hybrid"
          ? parsed.replayCase.type
          : undefined
    };
  } catch {
    return {};
  }

  return {};
};

const localize = (language: Language | undefined, english: string, chinese: string): string =>
  language === "zh-CN" ? chinese : english;

const classifyRunFailure = (
  row: RunRow,
  language?: Language
): { failureCategory?: FailureCategory; failureSuggestion?: string } => {
  const reason = `${row.errorMessage ?? ""} ${row.challengeReason ?? ""}`.toLowerCase();

  if (row.status === "stopped") {
    return {
      failureCategory: "run_aborted",
      failureSuggestion: localize(
        language,
        "Resume from a fresh run when you are ready, or lower the scope to a smaller scenario.",
        "准备好后重新发起一次新的运行，或者先把目标收窄到更小的场景。"
      )
    };
  }

  if (row.challengeKind) {
    return {
      failureCategory: "security_challenge",
      failureSuggestion: localize(
        language,
        "Use headed mode with manual takeover or a saved session profile so a human can solve the checkpoint.",
        "建议开启可见浏览器和人工接管，或复用已保存的会话，以便人工完成验证关卡。"
      )
    };
  }

  if (reason.includes("ai request timed out") || reason.includes("ai gateway error")) {
    return {
      failureCategory: "ai_timeout",
      failureSuggestion: localize(
        language,
        "Retry with a shorter goal or fewer max steps, or switch to a faster model/provider.",
        "建议缩短目标描述、降低最大步数，或切换到更快的模型和服务提供方后重试。"
      )
    };
  }

  if (reason.includes("maxsteps=") || reason.includes("reaching maxsteps")) {
    return {
      failureCategory: "max_steps",
      failureSuggestion: localize(
        language,
        "Increase max steps for this flow or narrow the goal so the agent can finish within the current cap.",
        "建议提高当前流程的最大步数，或缩小测试目标，让代理能在当前上限内完成。"
      )
    };
  }

  if (
    reason.includes("not visible") ||
    reason.includes("intercepts pointer events") ||
    reason.includes("no node found") ||
    reason.includes("timeout 6000ms exceeded")
  ) {
    return {
      failureCategory: "element_visibility",
      failureSuggestion: localize(
        language,
        "Use headed mode, enable manual takeover, or add a saved session so overlays and hidden controls are easier to resolve.",
        "建议开启可见浏览器、人工接管，或复用已保存会话，以便处理遮罩层和隐藏控件。"
      )
    };
  }

  if (
    reason.includes("navigation") ||
    reason.includes("net::") ||
    reason.includes("err_") ||
    reason.includes("page.goto")
  ) {
    return {
      failureCategory: "navigation_error",
      failureSuggestion: localize(
        language,
        "Check the target URL, network reachability, and whether the page redirects to a blocked or expired route.",
        "请检查目标 URL、网络可达性，以及页面是否跳转到了受限或失效的地址。"
      )
    };
  }

  if (reason.includes("manual intervention timed out")) {
    return {
      failureCategory: "manual_timeout",
      failureSuggestion: localize(
        language,
        "Solve the checkpoint sooner after it appears, or restart in headed mode and keep the browser in view.",
        "建议在人工验证出现后尽快处理，或改用可见浏览器重新运行并保持窗口可见。"
      )
    };
  }

  if (row.status === "failed" && row.errorMessage) {
    return {
      failureCategory: "runtime_error",
      failureSuggestion: localize(
        language,
        "Open the live run detail and inspect the console, network, and latest evidence before retrying.",
        "建议先打开实时运行详情，检查控制台、网络和最新证据，再决定是否重试。"
      )
    };
  }

  return {};
};

export const mapProjectRow = (row: ProjectRow): Project => ({
  id: row.id,
  name: row.name,
  baseUrl: row.baseUrl,
  encryptedUsername: encryptedBundle(row.usernameCipher, row.usernameIv, row.usernameTag),
  encryptedPassword: encryptedBundle(row.passwordCipher, row.passwordIv, row.passwordTag),
  createdAt: new Date(row.createdAt).toISOString(),
  updatedAt: new Date(row.updatedAt).toISOString()
});

export const mapRunRow = (row: RunRow): Run => ({
  ...(() => {
    const parsedConfig = parseRunConfig(row.configJson);
    return {
      ...parsedConfig,
      ...classifyRunFailure(row, parsedConfig.language)
    };
  })(),
  id: row.id,
  projectId: row.projectId,
  status: row.status as Run["status"],
  mode: row.mode as Run["mode"],
  targetUrl: row.targetUrl,
  goal: row.goal,
  model: row.model ?? undefined,
  startupPageUrl: row.startupPageUrl ?? undefined,
  startupPageTitle: row.startupPageTitle ?? undefined,
  startupScreenshotPath: row.startupScreenshotPath ?? undefined,
  startupObservation: row.startupObservation ?? undefined,
  challengeKind: (row.challengeKind as ChallengeKind | null) ?? undefined,
  challengeReason: row.challengeReason ?? undefined,
  recordedVideoPath: row.recordedVideoPath ?? undefined,
  llmLastJson: row.llmLastJson ? (JSON.parse(row.llmLastJson) as LLMDecision) : undefined,
  errorMessage: row.errorMessage ?? undefined,
  startedAt: toIso(row.startedAt),
  endedAt: toIso(row.endedAt),
  createdAt: new Date(row.createdAt).toISOString()
});

export const mapStepRow = (row: StepRow): Step => ({
  id: row.id,
  runId: row.runId,
  index: row.stepIndex,
  pageUrl: row.pageUrl,
  pageTitle: row.pageTitle,
  domSummary: JSON.parse(row.domSummaryJson),
  screenshotPath: row.screenshotPath,
  action: JSON.parse(row.actionJson) as Action,
  actionStatus: row.actionStatus as Step["actionStatus"],
  observationSummary: row.observationSummary,
  verificationResult: JSON.parse(row.verificationJson) as VerificationResult,
  createdAt: new Date(row.createdAt).toISOString()
});

export const mapTestCaseRow = (row: TestCaseRow): TestCase => ({
  id: row.id,
  runId: row.runId,
  module: row.module,
  title: row.title,
  preconditions: row.preconditions ?? undefined,
  stepsJson: row.stepsJson,
  expected: row.expected ?? undefined,
  actual: row.actual ?? undefined,
  status: row.status as TestCase["status"],
  priority: row.priority ?? undefined,
  method: row.method ?? undefined,
  createdAt: new Date(row.createdAt).toISOString()
});

export const mapCaseTemplateRow = (row: CaseTemplateRow): CaseTemplate => ({
  id: row.id,
  projectId: row.projectId,
  runId: row.runId,
  type: row.type as CaseTemplate["type"],
  title: row.title,
  goal: row.goal,
  entryUrl: row.entryUrl,
  status: row.status as CaseTemplate["status"],
  summary: row.summary ?? undefined,
  caseJson: row.caseJson,
  createdAt: new Date(row.createdAt).toISOString(),
  updatedAt: new Date(row.updatedAt).toISOString()
});

export const mapLoadProfileRow = (row: LoadProfileRow): LoadProfile => ({
  id: row.id,
  projectId: row.projectId,
  name: row.name,
  scenarioLabel: row.scenarioLabel,
  targetBaseUrl: row.targetBaseUrl,
  environmentTargetId: row.environmentTargetId ?? undefined,
  engine: row.engine as LoadProfile["engine"],
  pattern: row.pattern as LoadProfile["pattern"],
  requestPath: row.requestPath ?? undefined,
  httpMethod: (row.httpMethod as LoadProfile["httpMethod"]) ?? undefined,
  headersJson: row.headersJson ?? undefined,
  bodyTemplate: row.bodyTemplate ?? undefined,
  executionMode: (row.executionMode as LoadExecutionMode | null) ?? "local",
  workerCount: row.workerCount ?? 1,
  injectorPoolId: row.injectorPoolId ?? undefined,
  arrivalModel: (row.arrivalModel as LoadArrivalModel | null) ?? "closed",
  phasePlanJson: row.phasePlanJson ?? undefined,
  requestMixJson: row.requestMixJson ?? undefined,
  evidencePolicyJson: row.evidencePolicyJson ?? undefined,
  gatePolicyId: row.gatePolicyId ?? undefined,
  tagsJson: row.tagsJson ?? undefined,
  baselineRunId: row.baselineRunId ?? undefined,
  virtualUsers: row.virtualUsers,
  durationSec: row.durationSec,
  rampUpSec: row.rampUpSec,
  targetRps: row.targetRps ?? undefined,
  thresholds: JSON.parse(row.thresholdsJson) as LoadThreshold,
  createdAt: new Date(row.createdAt).toISOString(),
  updatedAt: new Date(row.updatedAt).toISOString()
});

export const mapLoadRunRow = (row: LoadRunRow): LoadRun => ({
  id: row.id,
  projectId: row.projectId,
  profileId: row.profileId,
  profileName: row.profileName,
  scenarioLabel: row.scenarioLabel,
  targetBaseUrl: row.targetBaseUrl,
  environmentId: row.environmentId ?? undefined,
  engine: row.engine as LoadRun["engine"],
  pattern: row.pattern as LoadRun["pattern"],
  environmentLabel: row.environmentLabel,
  status: row.status as LoadRun["status"],
  verdict: row.verdict as LoadRun["verdict"],
  source:
    row.source === "k6" || row.source === "synthetic"
      ? row.source
      : row.engine === "k6_http"
        ? "k6"
        : "synthetic",
  metrics: JSON.parse(row.metricsJson) as LoadRunMetrics,
  notes: row.notes ?? undefined,
  engineVersion: row.engineVersion ?? undefined,
  executorLabel: row.executorLabel ?? undefined,
  rawSummaryPath: row.rawSummaryPath ?? undefined,
  compareBaselineRunId: row.compareBaselineRunId ?? undefined,
  startedAt: new Date(row.startedAt).toISOString(),
  endedAt: toIso(row.endedAt),
  createdAt: new Date(row.createdAt).toISOString()
});

export const mapLoadRunWorkerRow = (row: LoadRunWorkerRow): LoadRunWorker => ({
  id: row.id,
  runId: row.runId,
  workerIndex: row.workerIndex,
  workerLabel: row.workerLabel,
  injectorPoolId: row.injectorPoolId ?? undefined,
  injectorWorkerId: row.injectorWorkerId ?? undefined,
  status: row.status as LoadRunWorker["status"],
  metrics: JSON.parse(row.metricsJson) as LoadRunMetrics,
  notes: row.notes ?? undefined,
  engineVersion: row.engineVersion ?? undefined,
  executorLabel: row.executorLabel ?? undefined,
  rawSummaryPath: row.rawSummaryPath ?? undefined,
  startedAt: new Date(row.startedAt).toISOString(),
  endedAt: toIso(row.endedAt),
  createdAt: new Date(row.createdAt).toISOString()
});

export const mapLoadRunSampleWindowRow = (
  row: LoadRunSampleWindowRow
): LoadRunSampleWindow => ({
  id: row.id,
  runId: row.runId,
  ts: new Date(row.ts).toISOString(),
  p95Ms: row.p95Ms,
  errorRatePct: row.errorRatePct / 100,
  throughputRps: row.throughputRps / 100,
  activeWorkers: row.activeWorkers,
  note: row.note ?? undefined
});

export const mapLoadProfileBaselineEventRow = (
  row: LoadProfileBaselineEventRow
): LoadBaselineHistoryEntry => ({
  id: row.id,
  profileId: row.profileId,
  runId: row.runId,
  action: row.action as LoadBaselineHistoryEntry["action"],
  note: row.note ?? undefined,
  createdAt: new Date(row.createdAt).toISOString()
});

export const mapLoadProfileVersionRow = (
  row: LoadProfileVersionRow
): LoadProfileVersion => ({
  id: row.id,
  profileId: row.profileId,
  versionNumber: row.versionNumber,
  reason: row.reason ?? undefined,
  snapshot: JSON.parse(row.snapshotJson) as LoadProfile,
  createdAt: new Date(row.createdAt).toISOString()
});

export const mapEnvironmentTargetRow = (
  row: EnvironmentTargetRow
): EnvironmentTarget => ({
  id: row.id,
  projectId: row.projectId ?? undefined,
  name: row.name,
  baseUrl: row.baseUrl,
  authType: row.authType ?? "none",
  owner: row.owner ?? undefined,
  riskLevel: (row.riskLevel as EnvironmentTarget["riskLevel"] | null) ?? "medium",
  createdAt: new Date(row.createdAt).toISOString(),
  updatedAt: new Date(row.updatedAt).toISOString()
});

export const mapEnvironmentServiceNodeRow = (
  row: EnvironmentServiceNodeRow
): EnvironmentServiceNode => ({
  id: row.id,
  environmentId: row.environmentId,
  name: row.name,
  protocol: row.protocol,
  baseUrl: row.baseUrl,
  healthPath: row.healthPath ?? undefined,
  dependsOnIds: JSON.parse(row.dependsOnJson) as string[],
  tags: JSON.parse(row.tagsJson) as string[],
  createdAt: new Date(row.createdAt).toISOString(),
  updatedAt: new Date(row.updatedAt).toISOString()
});

export const mapInjectorPoolRow = (row: InjectorPoolRow): InjectorPool => ({
  id: row.id,
  name: row.name,
  region: row.region,
  capacity: row.capacity,
  concurrencyLimit: row.concurrencyLimit,
  tags: JSON.parse(row.tagsJson) as string[],
  createdAt: new Date(row.createdAt).toISOString(),
  updatedAt: new Date(row.updatedAt).toISOString()
});

export const mapInjectorWorkerRow = (
  row: InjectorWorkerRow
): InjectorWorker => ({
  id: row.id,
  poolId: row.poolId,
  name: row.name,
  status: row.status as InjectorWorker["status"],
  currentRunCount: row.currentRunCount,
  capacity: row.capacity,
  lastHeartbeatAt: toIso(row.lastHeartbeatAt),
  createdAt: new Date(row.createdAt).toISOString(),
  updatedAt: new Date(row.updatedAt).toISOString()
});

export const mapGatePolicyRow = (row: GatePolicyRow): GatePolicy => ({
  id: row.id,
  projectId: row.projectId,
  name: row.name,
  requiredFunctionalFlows: JSON.parse(row.requiredFunctionalFlowsJson) as string[],
  minBenchmarkCoveragePct: row.minBenchmarkCoveragePct,
  minBenchmarkPassRate: row.minBenchmarkPassRate,
  requiredLoadProfileIds: JSON.parse(row.requiredLoadProfileIdsJson) as string[],
  minimumLoadVerdict: row.minimumLoadVerdict as GatePolicy["minimumLoadVerdict"],
  allowWaiver: Boolean(row.allowWaiver),
  approverRoles: JSON.parse(row.approverRolesJson) as string[],
  expiresAt: toIso(row.expiresAt),
  createdAt: new Date(row.createdAt).toISOString(),
  updatedAt: new Date(row.updatedAt).toISOString()
});

export const mapGatePolicyVersionRow = (
  row: GatePolicyVersionRow
): GatePolicyVersion => ({
  id: row.id,
  policyId: row.policyId,
  versionNumber: row.versionNumber,
  status: row.status as GatePolicyVersion["status"],
  reason: row.reason ?? undefined,
  snapshot: JSON.parse(row.snapshotJson) as GatePolicy,
  createdAt: new Date(row.createdAt).toISOString()
});

export const mapReleaseCandidateRow = (
  row: ReleaseCandidateRow
): ReleaseCandidate => ({
  id: row.id,
  projectId: row.projectId,
  environmentId: row.environmentId ?? undefined,
  gatePolicyId: row.gatePolicyId,
  name: row.name,
  buildLabel: row.buildLabel,
  status: row.status as ReleaseCandidate["status"],
  notes: row.notes ?? undefined,
  createdAt: new Date(row.createdAt).toISOString(),
  updatedAt: new Date(row.updatedAt).toISOString()
});

export const mapGateResultRow = (row: GateResultRow): GateResult => ({
  id: row.id,
  releaseId: row.releaseId,
  verdict: row.verdict as GateResult["verdict"],
  summary: row.summary,
  blockers: JSON.parse(row.blockersJson) as string[],
  signals: JSON.parse(row.signalsJson) as GateSignal[],
  waiverCount: row.waiverCount,
  evaluatedAt: new Date(row.evaluatedAt).toISOString()
});

export const mapWaiverRow = (row: WaiverRow): Waiver => ({
  id: row.id,
  releaseId: row.releaseId,
  blockerKey: row.blockerKey,
  reason: row.reason,
  requestedBy: row.requestedBy,
  approvedBy: row.approvedBy ?? undefined,
  expiresAt: new Date(row.expiresAt).toISOString(),
  status: row.status as Waiver["status"],
  createdAt: new Date(row.createdAt).toISOString(),
  updatedAt: new Date(row.updatedAt).toISOString()
});

export const mapApprovalEventRow = (row: ApprovalEventRow): ApprovalEvent => ({
  id: row.id,
  releaseId: row.releaseId,
  waiverId: row.waiverId ?? undefined,
  actor: row.actor,
  role: row.role,
  action: row.action,
  detail: row.detail ?? undefined,
  createdAt: new Date(row.createdAt).toISOString()
});
