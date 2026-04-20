import { z } from "zod";

export const RunModeSchema = z.enum(["general", "login", "admin"]);
export const LanguageSchema = z.enum(["en", "zh-CN"]);
export const ExecutionModeSchema = z.enum(["auto_batch", "stepwise_replan"]);
export const RunStatusSchema = z.enum([
  "queued",
  "running",
  "passed",
  "failed",
  "stopped"
]);

export const RunLivePhaseSchema = z.enum([
  "queued",
  "booting",
  "sensing",
  "planning",
  "drafting",
  "executing",
  "verifying",
  "paused",
  "manual",
  "persisting",
  "reporting",
  "finished"
]);

export const FailureCategorySchema = z.enum([
  "ai_timeout",
  "security_challenge",
  "element_visibility",
  "navigation_error",
  "max_steps",
  "manual_timeout",
  "run_aborted",
  "runtime_error"
]);

export const StepFailureCategorySchema = z.enum([
  "locator_miss",
  "element_not_interactable",
  "wrong_target",
  "no_effect",
  "api_mismatch",
  "security_challenge",
  "blocked_high_risk",
  "unexpected_runtime"
]);

export const RunStageSchema = z.enum([
  "unknown",
  "searching",
  "target_site",
  "provider_auth",
  "credential_form",
  "authenticated_app",
  "security_challenge",
  "content_detour",
  "completed"
]);

export const StepOutcomeSchema = z.enum([
  "progressed",
  "recoverable_failure",
  "blocking_failure",
  "terminal_success",
  "terminal_failure"
]);

export const GoalAlignmentStatusSchema = z.enum([
  "unknown",
  "aligned",
  "wrong_target",
  "intermediate_auth",
  "blocked"
]);

export const StageTransitionReasonSchema = z.enum([
  "unknown",
  "search_surface",
  "target_site",
  "provider_auth",
  "credential_form",
  "authenticated_app",
  "security_challenge",
  "content_detour",
  "goal_mismatch",
  "completed"
]);

export const ActionResolutionMethodSchema = z.enum([
  "dom_selector",
  "text_match",
  "generic_fallback",
  "ocr",
  "direct_navigation",
  "timer"
]);

export const ChallengeKindSchema = z.enum([
  "captcha",
  "security_check",
  "login_wall",
  "unknown"
]);

export const ActionTypeSchema = z.enum([
  "click",
  "input",
  "select",
  "navigate",
  "wait"
]);

export const ActionSchema = z.object({
  type: ActionTypeSchema,
  target: z.string().optional(),
  value: z.string().optional(),
  ms: z.number().int().positive().optional(),
  note: z.string().optional()
});

export const ActionExecutionStatusSchema = z.enum([
  "success",
  "failed",
  "blocked_high_risk"
]);

export const CheckResultSchema = z.object({
  expected: z.string(),
  found: z.boolean()
});

export const VerificationRuleSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["passed", "failed", "neutral"]),
  detail: z.string()
});

export const VisualMatchSchema = z.object({
  matchedText: z.string(),
  surfaceLabel: z.string(),
  confidence: z.number()
});

export const TemplateReplayStepOutcomeSchema = z.enum([
  "matched",
  "drifted",
  "recovered"
]);

export const TemplateReplayDiagnosticsSchema = z.object({
  templateId: z.string(),
  templateTitle: z.string(),
  templateType: z.enum(["ui", "hybrid"]),
  stepIndex: z.number().int().positive(),
  stepCount: z.number().int().positive(),
  outcome: TemplateReplayStepOutcomeSchema,
  repairSuggestion: z.string().optional()
});

export const TrafficAssertionSchema = z.object({
  method: z.string().optional(),
  pathname: z.string().optional(),
  host: z.string().optional(),
  status: z.number().int().nonnegative().optional(),
  resourceType: z.string().optional()
});

export const TemplateRepairCandidateSchema = z.object({
  templateId: z.string(),
  templateTitle: z.string(),
  templateType: z.enum(["ui", "hybrid"]),
  templateStepIndex: z.number().int().positive(),
  templateStepCount: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
  action: ActionSchema,
  suggestedTarget: z.string().optional(),
  suggestedExpectedChecks: z.array(z.string()).default([]),
  suggestedExpectedRequests: z.array(TrafficAssertionSchema).default([]),
  reason: z.string().optional(),
  repairHint: z.string().optional()
});

export const ExecutionDiagnosticsSchema = z.object({
  targetUsed: z.string().optional(),
  resolutionMethod: ActionResolutionMethodSchema.optional(),
  failureCategory: StepFailureCategorySchema.optional(),
  failureSuggestion: z.string().optional(),
  failureReason: z.string().optional(),
  visualMatch: VisualMatchSchema.optional(),
  templateReplay: TemplateReplayDiagnosticsSchema.optional(),
  templateRepairCandidate: TemplateRepairCandidateSchema.optional()
});

export const ApiVerificationRequestSchema = z.object({
  method: z.string(),
  url: z.string(),
  host: z.string().optional(),
  pathname: z.string().optional(),
  resourceType: z.string().optional(),
  status: z.number().int().nonnegative().optional(),
  ok: z.boolean().optional(),
  phase: z.enum(["response", "failed"]),
  contentType: z.string().optional(),
  bodyPreview: z.string().optional(),
  tokenLike: z.boolean().optional(),
  sessionLike: z.boolean().optional(),
  matchedExpected: z.boolean().optional()
});

export const ApiVerificationResultSchema = z.object({
  status: z.enum(["passed", "failed", "neutral"]),
  requestCount: z.number().int().nonnegative(),
  matchedRequestCount: z.number().int().nonnegative(),
  failedRequestCount: z.number().int().nonnegative(),
  expectedRequestCount: z.number().int().nonnegative().default(0),
  tokenSignals: z.number().int().nonnegative().default(0),
  sessionSignals: z.number().int().nonnegative().default(0),
  hostTransition: z
    .object({
      from: z.string().optional(),
      to: z.string().optional(),
      changed: z.boolean().optional()
    })
    .optional(),
  note: z.string().optional(),
  keyRequests: z.array(ApiVerificationRequestSchema)
});

export const PageStateSchema = z.object({
  surface: z.enum([
    "generic",
    "modal_dialog",
    "login_chooser",
    "login_form",
    "provider_auth",
    "search_results",
    "security_challenge",
    "dashboard_like"
  ]),
  hasModal: z.boolean(),
  hasIframe: z.boolean(),
  frameCount: z.number().int().nonnegative(),
  hasLoginForm: z.boolean(),
  hasProviderChooser: z.boolean(),
  hasSearchResults: z.boolean(),
  matchedSignals: z.array(z.string()),
  primaryContext: z.string().optional(),
  authErrorText: z.string().optional()
});

export const RunWorkingMemorySchema = z.object({
  stage: RunStageSchema,
  alignment: GoalAlignmentStatusSchema.default("unknown"),
  transitionReason: StageTransitionReasonSchema.optional(),
  goalAnchors: z.array(z.string()).default([]),
  avoidHosts: z.array(z.string()).default([]),
  avoidLabels: z.array(z.string()).default([]),
  blockedStage: RunStageSchema.optional(),
  avoidRepeatCredentialSubmission: z.boolean().default(false),
  lastOutcome: StepOutcomeSchema.optional(),
  lastStepUrl: z.string().optional(),
  successSignals: z.array(z.string()).default([])
});

export const VerificationResultSchema = z.object({
  urlChanged: z.boolean(),
  checks: z.array(CheckResultSchema),
  matchedCount: z.number().int().nonnegative().optional(),
  totalCount: z.number().int().nonnegative().optional(),
  rules: z.array(VerificationRuleSchema).optional(),
  pageState: PageStateSchema.optional(),
  api: ApiVerificationResultSchema.optional(),
  execution: ExecutionDiagnosticsSchema.optional(),
  outcome: StepOutcomeSchema.optional(),
  workingMemory: RunWorkingMemorySchema.optional(),
  passed: z.boolean(),
  note: z.string().optional()
});

export const InteractiveElementSchema = z.object({
  tag: z.string(),
  id: z.string().optional(),
  className: z.string().optional(),
  selector: z.string().optional(),
  text: z.string().optional(),
  type: z.string().optional(),
  placeholder: z.string().optional(),
  name: z.string().optional(),
  ariaLabel: z.string().optional(),
  role: z.string().optional(),
  title: z.string().optional(),
  testId: z.string().optional(),
  value: z.string().optional(),
  nearbyText: z.string().optional(),
  contextType: z.enum(["page", "modal", "dialog", "iframe", "iframe-modal"]).optional(),
  contextLabel: z.string().optional(),
  framePath: z.string().optional(),
  frameUrl: z.string().optional(),
  frameTitle: z.string().optional(),
  isVisible: z.boolean().optional(),
  isEnabled: z.boolean().optional()
});

export const PageSnapshotSchema = z.object({
  url: z.string(),
  title: z.string(),
  screenshotPath: z.string(),
  elements: z.array(InteractiveElementSchema),
  pageState: PageStateSchema.optional()
});

export const TestCaseCandidateSchema = z.object({
  generate: z.boolean(),
  module: z.string().optional(),
  title: z.string().optional(),
  preconditions: z.string().optional(),
  expected: z.string().optional(),
  priority: z.string().optional(),
  method: z.string().optional()
});

export const LLMDecisionSchema = z.object({
  goal: z.string(),
  page_assessment: z.object({
    page_type: z.string(),
    risk_level: z.enum(["low", "medium", "high"]).or(z.string()),
    key_elements: z.array(z.string())
  }),
  plan: z.object({
    strategy: z.string(),
    reason: z.string()
  }),
  actions: z.array(ActionSchema),
  expected_checks: z.array(z.string()),
  test_case_candidate: TestCaseCandidateSchema,
  is_finished: z.boolean()
});

export const RuntimeEventNameSchema = z.enum([
  "run.status",
  "run.llm",
  "step.created",
  "testcase.created",
  "run.finished",
  "run.error"
]);

export const LiveStreamFrameSchema = z.object({
  mimeType: z.literal("image/jpeg"),
  imageData: z.string(),
  frameSeq: z.number().int().nonnegative(),
  transport: z.enum(["screencast", "snapshot"]).default("snapshot"),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  phase: RunLivePhaseSchema.optional(),
  stepIndex: z.number().int().nonnegative().optional(),
  pageUrl: z.string().optional(),
  pageTitle: z.string().optional(),
  message: z.string().optional()
});

export const LiveStreamMetricSchema = z.object({
  fps: z.number().nonnegative(),
  captureMs: z.number().nonnegative(),
  viewerCount: z.number().int().nonnegative(),
  transport: z.enum(["screencast", "snapshot"]).default("snapshot"),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  phase: RunLivePhaseSchema.optional(),
  stepIndex: z.number().int().nonnegative().optional(),
  pageUrl: z.string().optional(),
  pageTitle: z.string().optional()
});

export const LiveStreamMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("run.frame"),
    runId: z.string(),
    ts: z.string(),
    data: LiveStreamFrameSchema
  }),
  z.object({
    type: z.literal("run.metric"),
    runId: z.string(),
    ts: z.string(),
    data: LiveStreamMetricSchema
  })
]);

export const RuntimeEventSchema = z.object({
  event: RuntimeEventNameSchema,
  runId: z.string(),
  ts: z.string(),
  data: z.unknown()
});

export const EncryptedTextSchema = z.object({
  ciphertext: z.string(),
  iv: z.string(),
  tag: z.string()
});

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  encryptedUsername: EncryptedTextSchema.optional(),
  encryptedPassword: EncryptedTextSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const ReplayCaseStepSchema = z.object({
  index: z.number().int().positive(),
  action: ActionSchema,
  expectedChecks: z.array(z.string()).default([]),
  expectedRequests: z.array(TrafficAssertionSchema).default([]),
  note: z.string().optional()
});

export const ReplayCaseSchema = z.object({
  templateId: z.string(),
  title: z.string(),
  type: z.enum(["ui", "hybrid"]),
  sourceRunId: z.string().optional(),
  steps: z.array(ReplayCaseStepSchema).min(1)
});

export const RunConfigSchema = z.object({
  targetUrl: z.string(),
  mode: RunModeSchema.default("general"),
  language: LanguageSchema.default("en"),
  executionMode: ExecutionModeSchema.default("auto_batch"),
  confirmDraft: z.boolean().default(false),
  goal: z.string().default("Explore and validate page behavior."),
  maxSteps: z.number().int().positive().default(12),
  model: z.string().optional(),
  headed: z.boolean().default(false),
  manualTakeover: z.boolean().default(false),
  sessionProfile: z.string().trim().min(1).max(80).optional(),
  saveSession: z.boolean().default(false),
  replayCase: ReplayCaseSchema.optional(),
  username: z.string().optional(),
  password: z.string().optional()
});

export const RunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  status: RunStatusSchema,
  mode: RunModeSchema,
  language: LanguageSchema.optional(),
  executionMode: ExecutionModeSchema.optional(),
  confirmDraft: z.boolean().optional(),
  targetUrl: z.string(),
  currentPageUrl: z.string().optional(),
  currentPageTitle: z.string().optional(),
  goal: z.string(),
  model: z.string().optional(),
  maxSteps: z.number().int().positive().optional(),
  headed: z.boolean().optional(),
  manualTakeover: z.boolean().optional(),
  sessionProfile: z.string().optional(),
  saveSession: z.boolean().optional(),
  replayCaseId: z.string().optional(),
  replayCaseTitle: z.string().optional(),
  replayCaseType: z.enum(["ui", "hybrid"]).optional(),
  stepCount: z.number().int().nonnegative().optional(),
  lastStepIndex: z.number().int().nonnegative().optional(),
  startupPageUrl: z.string().optional(),
  startupPageTitle: z.string().optional(),
  startupScreenshotPath: z.string().optional(),
  startupObservation: z.string().optional(),
  challengeKind: ChallengeKindSchema.optional(),
  challengeReason: z.string().optional(),
  recordedVideoPath: z.string().optional(),
  failureCategory: FailureCategorySchema.optional(),
  failureSuggestion: z.string().optional(),
  llmLastJson: LLMDecisionSchema.optional(),
  errorMessage: z.string().optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  createdAt: z.string()
});

export const StepSchema = z.object({
  id: z.string(),
  runId: z.string(),
  index: z.number().int().positive(),
  pageUrl: z.string(),
  pageTitle: z.string(),
  domSummary: z.array(InteractiveElementSchema),
  screenshotPath: z.string(),
  action: ActionSchema,
  actionStatus: ActionExecutionStatusSchema,
  observationSummary: z.string(),
  verificationResult: VerificationResultSchema,
  createdAt: z.string()
});

export const TestCaseSchema = z.object({
  id: z.string(),
  runId: z.string(),
  module: z.string().default("General"),
  title: z.string(),
  preconditions: z.string().optional(),
  stepsJson: z.string(),
  expected: z.string().optional(),
  actual: z.string().optional(),
  status: z.enum(["pending", "passed", "failed"]),
  priority: z.string().optional(),
  method: z.string().optional(),
  createdAt: z.string()
});

export const ReportSchema = z.object({
  runId: z.string(),
  htmlPath: z.string(),
  xlsxPath: z.string(),
  videoPath: z.string().optional(),
  challengeKind: ChallengeKindSchema.optional(),
  challengeReason: z.string().optional(),
  createdAt: z.string()
});

export const RunDiagnosisSchema = z.object({
  runId: z.string(),
  status: RunStatusSchema,
  headline: z.string(),
  rootCause: z.string(),
  stopReason: z.string(),
  nextBestAction: z.string(),
  userImpact: z.string(),
  failureCategory: FailureCategorySchema.optional(),
  heroScreenshotPath: z.string().optional(),
  keyRequest: ApiVerificationRequestSchema.optional(),
  pageUrl: z.string().optional(),
  pageTitle: z.string().optional(),
  stepCount: z.number().int().nonnegative().default(0)
});

export const RunComparisonStepSchema = z.object({
  index: z.number().int().positive(),
  change: z.enum(["changed", "missing", "added"]),
  baseAction: z.string().optional(),
  candidateAction: z.string().optional(),
  baseUrl: z.string().optional(),
  candidateUrl: z.string().optional(),
  summary: z.string()
});

export const RunComparisonSchema = z.object({
  baseRun: RunSchema,
  candidateRun: RunSchema,
  baseDiagnosis: RunDiagnosisSchema,
  candidateDiagnosis: RunDiagnosisSchema,
  headline: z.string(),
  summary: z.string(),
  statusChanged: z.boolean(),
  stepDelta: z.number().int(),
  firstDivergenceStep: z.number().int().positive().optional(),
  changedSignals: z.array(z.string()).default([]),
  stepChanges: z.array(RunComparisonStepSchema).default([])
});

export const BenchmarkFailureBucketSchema = z.object({
  category: z.string(),
  count: z.number().int().nonnegative()
});

export const BenchmarkScenarioSummarySchema = z.object({
  caseId: z.string(),
  title: z.string(),
  type: z.enum(["ui", "api", "hybrid"]),
  goal: z.string(),
  entryUrl: z.string(),
  runCount: z.number().int().nonnegative(),
  passCount: z.number().int().nonnegative(),
  passRate: z.number().min(0).max(1),
  avgSteps: z.number().nonnegative(),
  lastRunId: z.string().optional(),
  lastRunStatus: RunStatusSchema.optional(),
  lastRunAt: z.string().optional(),
  latestPassedRunId: z.string().optional(),
  latestPassedRunAt: z.string().optional(),
  latestFailedRunId: z.string().optional(),
  latestFailedRunAt: z.string().optional(),
  lastDiagnosisHeadline: z.string().optional(),
  topFailureCategory: z.string().optional()
});

export const BenchmarkSummarySchema = z.object({
  projectId: z.string().optional(),
  scenarioCount: z.number().int().nonnegative(),
  coveredScenarioCount: z.number().int().nonnegative(),
  replayRunCount: z.number().int().nonnegative(),
  passRate: z.number().min(0).max(1),
  avgSteps: z.number().nonnegative(),
  recentFailureCategories: z.array(BenchmarkFailureBucketSchema).default([]),
  scenarios: z.array(BenchmarkScenarioSummarySchema).default([])
});

export const LoadEngineSchema = z.enum(["synthetic", "browser_probe", "k6_http"]);

export const LoadPatternSchema = z.enum([
  "ramp",
  "steady",
  "spike",
  "soak",
  "breakpoint"
]);

export const LoadRunSourceSchema = z.enum(["synthetic", "k6"]);
export const WorkerHeartbeatStateSchema = z.enum(["fresh", "stale", "missing"]);

export const LoadExecutionModeSchema = z.enum(["local", "distributed"]);

export const LoadArrivalModelSchema = z.enum(["closed", "open"]);

export const LoadHttpMethodSchema = z.enum([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS"
]);

export const LoadRunVerdictSchema = z.enum(["ship", "watch", "hold"]);

export const LoadAlertSeveritySchema = z.enum(["info", "warning", "critical"]);

export const LoadThresholdSchema = z.object({
  maxP95Ms: z.number().positive(),
  maxErrorRatePct: z.number().min(0),
  minThroughputRps: z.number().nonnegative()
});

export const LoadProfileSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  scenarioLabel: z.string(),
  targetBaseUrl: z.string().url(),
  environmentTargetId: z.string().optional(),
  engine: LoadEngineSchema,
  pattern: LoadPatternSchema,
  requestPath: z.string().optional(),
  httpMethod: LoadHttpMethodSchema.optional(),
  headersJson: z.string().optional(),
  bodyTemplate: z.string().optional(),
  executionMode: LoadExecutionModeSchema.default("local"),
  workerCount: z.number().int().positive().default(1),
  injectorPoolId: z.string().optional(),
  arrivalModel: LoadArrivalModelSchema.default("closed"),
  phasePlanJson: z.string().optional(),
  requestMixJson: z.string().optional(),
  evidencePolicyJson: z.string().optional(),
  gatePolicyId: z.string().optional(),
  tagsJson: z.string().optional(),
  baselineRunId: z.string().optional(),
  virtualUsers: z.number().int().positive(),
  durationSec: z.number().int().positive(),
  rampUpSec: z.number().int().nonnegative(),
  targetRps: z.number().positive().optional(),
  thresholds: LoadThresholdSchema,
  createdAt: z.string(),
  updatedAt: z.string()
});

export const LoadRunMetricsSchema = z.object({
  p50Ms: z.number().nonnegative(),
  p95Ms: z.number().nonnegative(),
  p99Ms: z.number().nonnegative(),
  errorRatePct: z.number().min(0),
  throughputRps: z.number().nonnegative(),
  peakVus: z.number().int().nonnegative(),
  requestCount: z.number().int().nonnegative(),
  totalErrors: z.number().int().nonnegative()
});

export const LoadRunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  profileId: z.string(),
  profileName: z.string(),
  scenarioLabel: z.string(),
  targetBaseUrl: z.string().url(),
  environmentId: z.string().optional(),
  engine: LoadEngineSchema,
  pattern: LoadPatternSchema,
  environmentLabel: z.string(),
  status: RunStatusSchema,
  verdict: LoadRunVerdictSchema,
  source: LoadRunSourceSchema,
  metrics: LoadRunMetricsSchema,
  notes: z.string().optional(),
  engineVersion: z.string().optional(),
  executorLabel: z.string().optional(),
  rawSummaryPath: z.string().optional(),
  compareBaselineRunId: z.string().optional(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  createdAt: z.string()
});

export const LoadAlertSchema = z.object({
  id: z.string(),
  severity: LoadAlertSeveritySchema,
  title: z.string(),
  detail: z.string(),
  profileId: z.string().optional(),
  runId: z.string().optional()
});

export const LoadStudioSummarySchema = z.object({
  projectId: z.string().optional(),
  profileCount: z.number().int().nonnegative(),
  runCount: z.number().int().nonnegative(),
  activeRunCount: z.number().int().nonnegative(),
  avgP95Ms: z.number().nonnegative(),
  avgErrorRatePct: z.number().min(0),
  latestVerdict: LoadRunVerdictSchema.optional(),
  profiles: z.array(LoadProfileSchema).default([]),
  recentRuns: z.array(LoadRunSchema).default([]),
  topAlerts: z.array(LoadAlertSchema).default([])
});

export const LoadThresholdCheckSchema = z.object({
  id: z.enum(["latency", "error_rate", "throughput"]),
  label: z.string(),
  status: z.enum(["passed", "warning", "failed"]),
  actual: z.number().nonnegative(),
  target: z.number().nonnegative(),
  summary: z.string()
});

export const LoadRunWorkerSchema = z.object({
  id: z.string(),
  runId: z.string(),
  workerIndex: z.number().int().positive(),
  workerLabel: z.string(),
  injectorPoolId: z.string().optional(),
  injectorWorkerId: z.string().optional(),
  status: RunStatusSchema,
  metrics: LoadRunMetricsSchema,
  notes: z.string().optional(),
  engineVersion: z.string().optional(),
  executorLabel: z.string().optional(),
  rawSummaryPath: z.string().optional(),
  lastHeartbeatAt: z.string().optional(),
  heartbeatState: WorkerHeartbeatStateSchema.optional(),
  heartbeatAgeMs: z.number().int().nonnegative().optional(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  createdAt: z.string()
});

export const LoadRunSampleWindowSchema = z.object({
  id: z.string(),
  runId: z.string(),
  ts: z.string(),
  p95Ms: z.number().nonnegative(),
  errorRatePct: z.number().min(0),
  throughputRps: z.number().nonnegative(),
  activeWorkers: z.number().int().nonnegative(),
  note: z.string().optional()
});

export const LoadLinkedArtifactSchema = z.object({
  id: z.string(),
  type: z.enum(["summary", "worker_summary", "raw_export"]),
  label: z.string(),
  path: z.string()
});

export const LoadDegradationEventSchema = z.object({
  id: z.string(),
  severity: LoadAlertSeveritySchema,
  title: z.string(),
  detail: z.string(),
  startedAt: z.string(),
  endedAt: z.string().optional()
});

export const LoadGateInputSchema = z.object({
  id: z.string(),
  source: z.enum(["threshold", "workers", "artifacts"]),
  status: z.enum(["passed", "warning", "failed"]),
  label: z.string(),
  detail: z.string()
});

export const LoadGateDecisionSchema = z.object({
  verdict: LoadRunVerdictSchema,
  summary: z.string(),
  blockerCount: z.number().int().nonnegative(),
  watchCount: z.number().int().nonnegative()
});

export const LoadThresholdDiffSchema = z.object({
  id: z.enum(["latency", "error_rate", "throughput"]),
  label: z.string(),
  baseValue: z.number().nonnegative(),
  candidateValue: z.number().nonnegative(),
  delta: z.number(),
  target: z.number().nonnegative(),
  direction: z.enum(["better", "worse", "unchanged"]),
  summary: z.string()
});

export const LoadWorkerHealthSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  healthy: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  stale: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative()
});

export const LoadTimelineEventSchema = z.object({
  id: z.string(),
  at: z.string(),
  kind: z.enum([
    "run_queued",
    "run_started",
    "run_completed",
    "run_failed",
    "threshold_breach",
    "baseline_pinned",
    "baseline_promoted",
    "worker_stale"
  ]),
  title: z.string(),
  detail: z.string()
});

export const LoadBaselineHistoryEntrySchema = z.object({
  id: z.string(),
  profileId: z.string(),
  runId: z.string(),
  action: z.enum(["pinned", "promoted"]),
  note: z.string().optional(),
  createdAt: z.string()
});

export const LoadRunSeriesSourceSchema = z.enum([
  "prometheus",
  "sample_window_cache"
]);

export const LoadRunSeriesSchema = z.object({
  runId: z.string(),
  source: LoadRunSeriesSourceSchema,
  detail: z.string().optional(),
  queriedAt: z.string(),
  points: z.array(LoadRunSampleWindowSchema).default([])
});

export const LoadProfileVersionSchema = z.object({
  id: z.string(),
  profileId: z.string(),
  versionNumber: z.number().int().positive(),
  reason: z.string().optional(),
  snapshot: LoadProfileSchema,
  createdAt: z.string()
});

export const LoadRunDetailSchema = z.object({
  source: LoadRunSourceSchema,
  run: LoadRunSchema,
  profile: LoadProfileSchema,
  alerts: z.array(LoadAlertSchema).default([]),
  thresholdChecks: z.array(LoadThresholdCheckSchema).default([]),
  gateSummary: z.string(),
  executionNotes: z.array(z.string()).default([]),
  recentSiblingRuns: z.array(LoadRunSchema).default([]),
  workers: z.array(LoadRunWorkerSchema).default([]),
  timeSeriesSummary: z.array(LoadRunSampleWindowSchema).default([]),
  linkedArtifacts: z.array(LoadLinkedArtifactSchema).default([]),
  degradationTimeline: z.array(LoadDegradationEventSchema).default([]),
  gateInputs: z.array(LoadGateInputSchema).default([]),
  gateDecision: LoadGateDecisionSchema,
  compareBaselineRunId: z.string().optional(),
  compareBaselineSnapshot: LoadRunSchema.optional(),
  thresholdDiff: z.array(LoadThresholdDiffSchema).default([]),
  workerHealthSummary: LoadWorkerHealthSummarySchema,
  timelineEvents: z.array(LoadTimelineEventSchema).default([]),
  baselineHistory: z.array(LoadBaselineHistoryEntrySchema).default([])
});

export const LoadRunCompareSchema = z.object({
  baselineRun: LoadRunSchema,
  candidateRun: LoadRunSchema,
  baselineProfile: LoadProfileSchema,
  candidateProfile: LoadProfileSchema,
  thresholdDiff: z.array(LoadThresholdDiffSchema).default([]),
  workerDiff: z.object({
    baselineWorkers: z.number().int().nonnegative(),
    candidateWorkers: z.number().int().nonnegative(),
    failedDelta: z.number().int(),
    staleDelta: z.number().int(),
    summary: z.string()
  }),
  degradationDiff: z.object({
    baselineEventCount: z.number().int().nonnegative(),
    candidateEventCount: z.number().int().nonnegative(),
    regression: z.boolean(),
    summary: z.string()
  }),
  compareBaselineRunId: z.string().optional()
});

export const EnvironmentRiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);

export const EnvironmentTargetSchema = z.object({
  id: z.string(),
  projectId: z.string().optional(),
  name: z.string(),
  baseUrl: z.string().url(),
  authType: z.string().default("none"),
  owner: z.string().optional(),
  riskLevel: EnvironmentRiskLevelSchema.default("medium"),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const EnvironmentServiceNodeSchema = z.object({
  id: z.string(),
  environmentId: z.string(),
  name: z.string(),
  protocol: z.string(),
  baseUrl: z.string().url(),
  healthPath: z.string().optional(),
  dependsOnIds: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const InjectorWorkerStatusSchema = z.enum(["online", "busy", "offline"]);

export const InjectorPoolSchema = z.object({
  id: z.string(),
  name: z.string(),
  region: z.string(),
  capacity: z.number().int().positive(),
  concurrencyLimit: z.number().int().positive(),
  tags: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const InjectorWorkerSchema = z.object({
  id: z.string(),
  poolId: z.string(),
  name: z.string(),
  status: InjectorWorkerStatusSchema,
  currentRunCount: z.number().int().nonnegative(),
  capacity: z.number().int().positive(),
  lastHeartbeatAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const GateSignalStatusSchema = z.enum(["passed", "warning", "failed", "waived"]);

export const GateSignalSchema = z.object({
  id: z.string(),
  kind: z.enum(["functional", "benchmark", "load"]),
  status: GateSignalStatusSchema,
  label: z.string(),
  detail: z.string(),
  sourceId: z.string().optional()
});

export const GatePolicySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  requiredFunctionalFlows: z.array(z.string()).default([]),
  minBenchmarkCoveragePct: z.number().min(0).max(100).default(0),
  minBenchmarkPassRate: z.number().min(0).max(100).default(0),
  requiredLoadProfileIds: z.array(z.string()).default([]),
  minimumLoadVerdict: LoadRunVerdictSchema.default("watch"),
  allowWaiver: z.boolean().default(false),
  approverRoles: z.array(z.string()).default([]),
  expiresAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const GatePolicyVersionStatusSchema = z.enum([
  "draft",
  "active",
  "superseded"
]);

export const GatePolicyVersionSchema = z.object({
  id: z.string(),
  policyId: z.string(),
  versionNumber: z.number().int().positive(),
  status: GatePolicyVersionStatusSchema,
  reason: z.string().optional(),
  snapshot: GatePolicySchema,
  createdAt: z.string()
});

export const ReleaseCandidateStatusSchema = z.enum(["draft", "watch", "hold", "ship", "waived"]);

export const ReleaseCandidateSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  environmentId: z.string().optional(),
  gatePolicyId: z.string(),
  name: z.string(),
  buildLabel: z.string(),
  status: ReleaseCandidateStatusSchema,
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const GateResultSchema = z.object({
  id: z.string(),
  releaseId: z.string(),
  verdict: LoadRunVerdictSchema,
  summary: z.string(),
  blockers: z.array(z.string()).default([]),
  signals: z.array(GateSignalSchema).default([]),
  waiverCount: z.number().int().nonnegative(),
  evaluatedAt: z.string()
});

export const WaiverStatusSchema = z.enum(["active", "expired", "revoked"]);

export const WaiverSchema = z.object({
  id: z.string(),
  releaseId: z.string(),
  blockerKey: z.string(),
  reason: z.string(),
  requestedBy: z.string(),
  approvedBy: z.string().optional(),
  expiresAt: z.string(),
  status: WaiverStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string()
});

export const ApprovalEventSchema = z.object({
  id: z.string(),
  releaseId: z.string(),
  waiverId: z.string().optional(),
  actor: z.string(),
  role: z.string(),
  action: z.string(),
  detail: z.string().optional(),
  createdAt: z.string()
});

export const EnvironmentRegistrySchema = z.object({
  environments: z.array(EnvironmentTargetSchema).default([]),
  serviceNodes: z.array(EnvironmentServiceNodeSchema).default([]),
  injectorPools: z.array(InjectorPoolSchema).default([]),
  injectorWorkers: z.array(InjectorWorkerSchema).default([])
});

export const EnvironmentTopologySchema = z.object({
  environment: EnvironmentTargetSchema,
  serviceNodes: z.array(EnvironmentServiceNodeSchema).default([]),
  injectorPools: z.array(InjectorPoolSchema).default([]),
  injectorWorkers: z.array(InjectorWorkerSchema).default([])
});

export const PlatformInfraServiceKindSchema = z.enum([
  "postgres",
  "redis",
  "prometheus",
  "artifacts"
]);

export const PlatformInfraServiceStateSchema = z.enum([
  "online",
  "degraded",
  "offline",
  "not_configured"
]);

export const PlatformInfraServiceStatusSchema = z.object({
  id: z.string(),
  kind: PlatformInfraServiceKindSchema,
  label: z.string(),
  state: PlatformInfraServiceStateSchema,
  configured: z.boolean(),
  endpoint: z.string().optional(),
  detail: z.string(),
  latencyMs: z.number().int().nonnegative().optional(),
  checkedAt: z.string()
});

export const PlatformInfrastructureSummarySchema = z.object({
  services: z.array(PlatformInfraServiceStatusSchema).default([]),
  onlineCount: z.number().int().nonnegative(),
  degradedCount: z.number().int().nonnegative(),
  offlineCount: z.number().int().nonnegative(),
  notConfiguredCount: z.number().int().nonnegative(),
  checkedAt: z.string()
});

export const PlatformLoadQueueSummarySchema = z.object({
  mode: z.enum(["inline", "bullmq"]),
  queueName: z.string(),
  workerEnabled: z.boolean(),
  workerConcurrency: z.number().int().positive(),
  isConnected: z.boolean(),
  counts: z.object({
    waiting: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    delayed: z.number().int().nonnegative()
  }),
  retryPolicy: z.object({
    attempts: z.number().int().positive(),
    backoffMs: z.number().int().nonnegative()
  }),
  workerHealth: z.object({
    timeoutMs: z.number().int().positive(),
    busyWorkers: z.number().int().nonnegative(),
    staleWorkers: z.number().int().nonnegative(),
    freshestHeartbeatAt: z.string().optional()
  }),
  detail: z.string(),
  lastActivityAt: z.string().optional(),
  lastError: z.string().optional(),
  samples: z
    .array(
      z.object({
        ts: z.string(),
        waiting: z.number().int().nonnegative(),
        active: z.number().int().nonnegative(),
        completed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        delayed: z.number().int().nonnegative()
      })
    )
    .default([]),
  checkedAt: z.string()
});

export const ReleaseGateDetailSchema = z.object({
  release: ReleaseCandidateSchema,
  policy: GatePolicySchema,
  result: GateResultSchema,
  waivers: z.array(WaiverSchema).default([]),
  approvalTimeline: z.array(ApprovalEventSchema).default([])
});

export const ReleaseAuditSchema = z.object({
  release: ReleaseCandidateSchema,
  timeline: z.array(ApprovalEventSchema).default([])
});

export const ControlTowerSummarySchema = z.object({
  activeReleaseCount: z.number().int().nonnegative(),
  blockedReleaseCount: z.number().int().nonnegative(),
  activeLoadRunCount: z.number().int().nonnegative(),
  onlineWorkerCount: z.number().int().nonnegative(),
  topBlockers: z.array(z.string()).default([]),
  latestReleases: z.array(ReleaseCandidateSchema).default([])
});

export const ConsoleEvidenceEntrySchema = z.object({
  id: z.string(),
  ts: z.string(),
  type: z.enum(["log", "info", "warning", "error", "debug", "pageerror"]),
  text: z.string(),
  location: z.string().optional()
});

export const NetworkEvidenceEntrySchema = z.object({
  id: z.string(),
  ts: z.string(),
  phase: z.enum(["response", "failed"]),
  stepIndex: z.number().int().positive().optional(),
  method: z.string(),
  url: z.string(),
  host: z.string().optional(),
  pathname: z.string().optional(),
  resourceType: z.string().optional(),
  status: z.number().int().nonnegative().optional(),
  ok: z.boolean().optional(),
  contentType: z.string().optional(),
  bodyPreview: z.string().optional(),
  failureText: z.string().optional()
});

export const PlannerTraceSchema = z.object({
  id: z.string(),
  ts: z.string(),
  stepIndex: z.number().int().nonnegative(),
  prompt: z.string(),
  rawResponse: z.string(),
  decision: LLMDecisionSchema.optional(),
  cacheHit: z.boolean().optional(),
  cacheKey: z.string().optional()
});

export const DraftActionStateSchema = z.object({
  stepIndex: z.number().int().positive(),
  action: ActionSchema,
  expectedChecks: z.array(z.string()),
  reason: z.string().optional(),
  awaitingApproval: z.boolean().default(false)
});

export const CaseTemplateSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  runId: z.string(),
  type: z.enum(["ui", "api", "hybrid"]),
  title: z.string(),
  goal: z.string(),
  entryUrl: z.string(),
  status: z.enum(["active", "archived"]).default("active"),
  summary: z.string().optional(),
  caseJson: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const CaseTemplateRepairDraftChangeSchema = z.object({
  templateStepIndex: z.number().int().positive(),
  sourceRunId: z.string(),
  sourceStepId: z.string(),
  confidence: z.number().min(0).max(1),
  previousAction: ActionSchema,
  nextAction: ActionSchema,
  previousExpectedChecks: z.array(z.string()).default([]),
  nextExpectedChecks: z.array(z.string()).default([]),
  previousExpectedRequests: z.array(TrafficAssertionSchema).default([]),
  nextExpectedRequests: z.array(TrafficAssertionSchema).default([]),
  reason: z.string().optional(),
  repairHint: z.string().optional()
});

export const CaseTemplateRepairDraftSchema = z.object({
  caseId: z.string(),
  caseTitle: z.string(),
  templateType: z.enum(["ui", "hybrid"]),
  runId: z.string(),
  generatedAt: z.string(),
  changeCount: z.number().int().nonnegative(),
  changes: z.array(CaseTemplateRepairDraftChangeSchema),
  nextCaseJson: z.string()
});

export const RunEvidenceSchema = z.object({
  runId: z.string(),
  updatedAt: z.string(),
  console: z.array(ConsoleEvidenceEntrySchema),
  network: z.array(NetworkEvidenceEntrySchema),
  planners: z.array(PlannerTraceSchema)
});

export type Action = z.infer<typeof ActionSchema>;
export type ActionExecutionStatus = z.infer<typeof ActionExecutionStatusSchema>;
export type ApiVerificationRequest = z.infer<typeof ApiVerificationRequestSchema>;
export type ApiVerificationResult = z.infer<typeof ApiVerificationResultSchema>;
export type ConsoleEvidenceEntry = z.infer<typeof ConsoleEvidenceEntrySchema>;
export type FailureCategory = z.infer<typeof FailureCategorySchema>;
export type StepFailureCategory = z.infer<typeof StepFailureCategorySchema>;
export type RunStage = z.infer<typeof RunStageSchema>;
export type StepOutcome = z.infer<typeof StepOutcomeSchema>;
export type GoalAlignmentStatus = z.infer<typeof GoalAlignmentStatusSchema>;
export type StageTransitionReason = z.infer<typeof StageTransitionReasonSchema>;
export type ActionResolutionMethod = z.infer<typeof ActionResolutionMethodSchema>;
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;
export type InteractiveElement = z.infer<typeof InteractiveElementSchema>;
export type Language = z.infer<typeof LanguageSchema>;
export type PageSnapshot = z.infer<typeof PageSnapshotSchema>;
export type PageState = z.infer<typeof PageStateSchema>;
export type LLMDecision = z.infer<typeof LLMDecisionSchema>;
export type NetworkEvidenceEntry = z.infer<typeof NetworkEvidenceEntrySchema>;
export type PlannerTrace = z.infer<typeof PlannerTraceSchema>;
export type DraftActionState = z.infer<typeof DraftActionStateSchema>;
export type ReplayCase = z.infer<typeof ReplayCaseSchema>;
export type ReplayCaseStep = z.infer<typeof ReplayCaseStepSchema>;
export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;
export type ChallengeKind = z.infer<typeof ChallengeKindSchema>;
export type LiveStreamMessage = z.infer<typeof LiveStreamMessageSchema>;
export type LiveStreamFrame = z.infer<typeof LiveStreamFrameSchema>;
export type LiveStreamMetric = z.infer<typeof LiveStreamMetricSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type RunConfig = z.infer<typeof RunConfigSchema>;
export type Run = z.infer<typeof RunSchema>;
export type RunComparison = z.infer<typeof RunComparisonSchema>;
export type RunComparisonStep = z.infer<typeof RunComparisonStepSchema>;
export type RunDiagnosis = z.infer<typeof RunDiagnosisSchema>;
export type RunEvidence = z.infer<typeof RunEvidenceSchema>;
export type RunLivePhase = z.infer<typeof RunLivePhaseSchema>;
export type Step = z.infer<typeof StepSchema>;
export type TestCase = z.infer<typeof TestCaseSchema>;
export type BenchmarkFailureBucket = z.infer<typeof BenchmarkFailureBucketSchema>;
export type BenchmarkScenarioSummary = z.infer<typeof BenchmarkScenarioSummarySchema>;
export type BenchmarkSummary = z.infer<typeof BenchmarkSummarySchema>;
export type LoadAlert = z.infer<typeof LoadAlertSchema>;
export type LoadAlertSeverity = z.infer<typeof LoadAlertSeveritySchema>;
export type LoadBaselineHistoryEntry = z.infer<typeof LoadBaselineHistoryEntrySchema>;
export type LoadEngine = z.infer<typeof LoadEngineSchema>;
export type LoadExecutionMode = z.infer<typeof LoadExecutionModeSchema>;
export type LoadArrivalModel = z.infer<typeof LoadArrivalModelSchema>;
export type LoadHttpMethod = z.infer<typeof LoadHttpMethodSchema>;
export type LoadPattern = z.infer<typeof LoadPatternSchema>;
export type LoadProfile = z.infer<typeof LoadProfileSchema>;
export type LoadProfileVersion = z.infer<typeof LoadProfileVersionSchema>;
export type LoadRun = z.infer<typeof LoadRunSchema>;
export type LoadRunCompare = z.infer<typeof LoadRunCompareSchema>;
export type LoadRunDetail = z.infer<typeof LoadRunDetailSchema>;
export type LoadRunMetrics = z.infer<typeof LoadRunMetricsSchema>;
export type LoadRunSeries = z.infer<typeof LoadRunSeriesSchema>;
export type LoadRunSeriesSource = z.infer<typeof LoadRunSeriesSourceSchema>;
export type LoadRunWorker = z.infer<typeof LoadRunWorkerSchema>;
export type LoadRunSampleWindow = z.infer<typeof LoadRunSampleWindowSchema>;
export type LoadLinkedArtifact = z.infer<typeof LoadLinkedArtifactSchema>;
export type LoadDegradationEvent = z.infer<typeof LoadDegradationEventSchema>;
export type LoadGateInput = z.infer<typeof LoadGateInputSchema>;
export type LoadGateDecision = z.infer<typeof LoadGateDecisionSchema>;
export type LoadRunSource = z.infer<typeof LoadRunSourceSchema>;
export type LoadThresholdDiff = z.infer<typeof LoadThresholdDiffSchema>;
export type LoadTimelineEvent = z.infer<typeof LoadTimelineEventSchema>;
export type LoadWorkerHealthSummary = z.infer<typeof LoadWorkerHealthSummarySchema>;
export type WorkerHeartbeatState = z.infer<typeof WorkerHeartbeatStateSchema>;
export type LoadRunVerdict = z.infer<typeof LoadRunVerdictSchema>;
export type LoadStudioSummary = z.infer<typeof LoadStudioSummarySchema>;
export type LoadThresholdCheck = z.infer<typeof LoadThresholdCheckSchema>;
export type LoadThreshold = z.infer<typeof LoadThresholdSchema>;
export type EnvironmentRiskLevel = z.infer<typeof EnvironmentRiskLevelSchema>;
export type EnvironmentTarget = z.infer<typeof EnvironmentTargetSchema>;
export type EnvironmentServiceNode = z.infer<typeof EnvironmentServiceNodeSchema>;
export type InjectorPool = z.infer<typeof InjectorPoolSchema>;
export type InjectorWorkerStatus = z.infer<typeof InjectorWorkerStatusSchema>;
export type InjectorWorker = z.infer<typeof InjectorWorkerSchema>;
export type GateSignalStatus = z.infer<typeof GateSignalStatusSchema>;
export type GateSignal = z.infer<typeof GateSignalSchema>;
export type GatePolicy = z.infer<typeof GatePolicySchema>;
export type GatePolicyVersion = z.infer<typeof GatePolicyVersionSchema>;
export type GatePolicyVersionStatus = z.infer<typeof GatePolicyVersionStatusSchema>;
export type ReleaseCandidateStatus = z.infer<typeof ReleaseCandidateStatusSchema>;
export type ReleaseCandidate = z.infer<typeof ReleaseCandidateSchema>;
export type GateResult = z.infer<typeof GateResultSchema>;
export type WaiverStatus = z.infer<typeof WaiverStatusSchema>;
export type Waiver = z.infer<typeof WaiverSchema>;
export type ApprovalEvent = z.infer<typeof ApprovalEventSchema>;
export type EnvironmentRegistry = z.infer<typeof EnvironmentRegistrySchema>;
export type EnvironmentTopology = z.infer<typeof EnvironmentTopologySchema>;
export type PlatformInfraServiceKind = z.infer<typeof PlatformInfraServiceKindSchema>;
export type PlatformInfraServiceState = z.infer<typeof PlatformInfraServiceStateSchema>;
export type PlatformInfraServiceStatus = z.infer<typeof PlatformInfraServiceStatusSchema>;
export type PlatformInfrastructureSummary = z.infer<typeof PlatformInfrastructureSummarySchema>;
export type PlatformLoadQueueSummary = z.infer<typeof PlatformLoadQueueSummarySchema>;
export type ReleaseGateDetail = z.infer<typeof ReleaseGateDetailSchema>;
export type ReleaseAudit = z.infer<typeof ReleaseAuditSchema>;
export type ControlTowerSummary = z.infer<typeof ControlTowerSummarySchema>;
export type CaseTemplate = z.infer<typeof CaseTemplateSchema>;
export type CaseTemplateRepairDraft = z.infer<typeof CaseTemplateRepairDraftSchema>;
export type CaseTemplateRepairDraftChange = z.infer<typeof CaseTemplateRepairDraftChangeSchema>;
export type TrafficAssertion = z.infer<typeof TrafficAssertionSchema>;
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
export type ExecutionDiagnostics = z.infer<typeof ExecutionDiagnosticsSchema>;
export type TemplateReplayDiagnostics = z.infer<typeof TemplateReplayDiagnosticsSchema>;
export type TemplateReplayStepOutcome = z.infer<typeof TemplateReplayStepOutcomeSchema>;
export type TemplateRepairCandidate = z.infer<typeof TemplateRepairCandidateSchema>;
export type RunWorkingMemory = z.infer<typeof RunWorkingMemorySchema>;
export type VisualMatch = z.infer<typeof VisualMatchSchema>;
export type Report = z.infer<typeof ReportSchema>;
export type EncryptedText = z.infer<typeof EncryptedTextSchema>;
export type VerificationRule = z.infer<typeof VerificationRuleSchema>;
