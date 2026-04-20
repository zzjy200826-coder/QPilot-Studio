import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projectsTable = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  usernameCipher: text("username_cipher"),
  usernameIv: text("username_iv"),
  usernameTag: text("username_tag"),
  passwordCipher: text("password_cipher"),
  passwordIv: text("password_iv"),
  passwordTag: text("password_tag"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const runsTable = sqliteTable("runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id),
  status: text("status").notNull(),
  mode: text("mode").notNull(),
  targetUrl: text("target_url").notNull(),
  goal: text("goal").notNull(),
  model: text("model"),
  configJson: text("config_json").notNull(),
  startupPageUrl: text("startup_page_url"),
  startupPageTitle: text("startup_page_title"),
  startupScreenshotPath: text("startup_screenshot_path"),
  startupObservation: text("startup_observation"),
  challengeKind: text("challenge_kind"),
  challengeReason: text("challenge_reason"),
  recordedVideoPath: text("recorded_video_path"),
  llmLastJson: text("llm_last_json"),
  errorMessage: text("error_message"),
  startedAt: integer("started_at"),
  endedAt: integer("ended_at"),
  createdAt: integer("created_at").notNull()
});

export const stepsTable = sqliteTable("steps", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runsTable.id),
  stepIndex: integer("step_index").notNull(),
  pageUrl: text("page_url").notNull(),
  pageTitle: text("page_title").notNull(),
  domSummaryJson: text("dom_summary_json").notNull(),
  screenshotPath: text("screenshot_path").notNull(),
  actionJson: text("action_json").notNull(),
  actionStatus: text("action_status").notNull(),
  observationSummary: text("observation_summary").notNull(),
  verificationJson: text("verification_json").notNull(),
  createdAt: integer("created_at").notNull()
});

export const testCasesTable = sqliteTable("test_cases", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runsTable.id),
  module: text("module").notNull(),
  title: text("title").notNull(),
  preconditions: text("preconditions"),
  stepsJson: text("steps_json").notNull(),
  expected: text("expected"),
  actual: text("actual"),
  status: text("status").notNull(),
  priority: text("priority"),
  method: text("method"),
  createdAt: integer("created_at").notNull()
});

export const reportsTable = sqliteTable("reports", {
  runId: text("run_id")
    .notNull()
    .primaryKey()
    .references(() => runsTable.id),
  htmlPath: text("html_path").notNull(),
  xlsxPath: text("xlsx_path").notNull(),
  createdAt: integer("created_at").notNull()
});

export const caseTemplatesTable = sqliteTable("case_templates", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id),
  runId: text("run_id")
    .notNull()
    .references(() => runsTable.id),
  type: text("type").notNull(),
  title: text("title").notNull(),
  goal: text("goal").notNull(),
  entryUrl: text("entry_url").notNull(),
  status: text("status").notNull(),
  summary: text("summary"),
  caseJson: text("case_json").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const loadProfilesTable = sqliteTable("load_profiles", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id),
  name: text("name").notNull(),
  scenarioLabel: text("scenario_label").notNull(),
  targetBaseUrl: text("target_base_url").notNull(),
  environmentTargetId: text("environment_target_id"),
  engine: text("engine").notNull(),
  pattern: text("pattern").notNull(),
  requestPath: text("request_path"),
  httpMethod: text("http_method"),
  headersJson: text("headers_json"),
  bodyTemplate: text("body_template"),
  executionMode: text("execution_mode").notNull().default("local"),
  workerCount: integer("worker_count").notNull().default(1),
  injectorPoolId: text("injector_pool_id"),
  arrivalModel: text("arrival_model").notNull().default("closed"),
  phasePlanJson: text("phase_plan_json"),
  requestMixJson: text("request_mix_json"),
  evidencePolicyJson: text("evidence_policy_json"),
  gatePolicyId: text("gate_policy_id"),
  tagsJson: text("tags_json"),
  baselineRunId: text("baseline_run_id"),
  virtualUsers: integer("virtual_users").notNull(),
  durationSec: integer("duration_sec").notNull(),
  rampUpSec: integer("ramp_up_sec").notNull(),
  targetRps: integer("target_rps"),
  thresholdsJson: text("thresholds_json").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const loadRunsTable = sqliteTable("load_runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id),
  profileId: text("profile_id")
    .notNull()
    .references(() => loadProfilesTable.id),
  profileName: text("profile_name").notNull(),
  scenarioLabel: text("scenario_label").notNull(),
  targetBaseUrl: text("target_base_url").notNull(),
  environmentId: text("environment_id"),
  engine: text("engine").notNull(),
  pattern: text("pattern").notNull(),
  environmentLabel: text("environment_label").notNull(),
  status: text("status").notNull(),
  verdict: text("verdict").notNull(),
  source: text("source").notNull().default("synthetic"),
  metricsJson: text("metrics_json").notNull(),
  notes: text("notes"),
  engineVersion: text("engine_version"),
  executorLabel: text("executor_label"),
  rawSummaryPath: text("raw_summary_path"),
  compareBaselineRunId: text("compare_baseline_run_id"),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at"),
  createdAt: integer("created_at").notNull()
});

export const loadProfileBaselineEventsTable = sqliteTable("load_profile_baseline_events", {
  id: text("id").primaryKey(),
  profileId: text("profile_id")
    .notNull()
    .references(() => loadProfilesTable.id),
  runId: text("run_id")
    .notNull()
    .references(() => loadRunsTable.id),
  action: text("action").notNull(),
  note: text("note"),
  createdAt: integer("created_at").notNull()
});

export const loadProfileVersionsTable = sqliteTable("load_profile_versions", {
  id: text("id").primaryKey(),
  profileId: text("profile_id")
    .notNull()
    .references(() => loadProfilesTable.id),
  versionNumber: integer("version_number").notNull(),
  reason: text("reason"),
  snapshotJson: text("snapshot_json").notNull(),
  createdAt: integer("created_at").notNull()
});

export const loadRunWorkersTable = sqliteTable("load_run_workers", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => loadRunsTable.id),
  workerIndex: integer("worker_index").notNull(),
  workerLabel: text("worker_label").notNull(),
  injectorPoolId: text("injector_pool_id"),
  injectorWorkerId: text("injector_worker_id"),
  status: text("status").notNull(),
  metricsJson: text("metrics_json").notNull(),
  notes: text("notes"),
  engineVersion: text("engine_version"),
  executorLabel: text("executor_label"),
  rawSummaryPath: text("raw_summary_path"),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at"),
  createdAt: integer("created_at").notNull()
});

export const loadRunSampleWindowsTable = sqliteTable("load_run_sample_windows", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => loadRunsTable.id),
  ts: integer("ts").notNull(),
  p95Ms: integer("p95_ms").notNull(),
  errorRatePct: integer("error_rate_pct").notNull(),
  throughputRps: integer("throughput_rps").notNull(),
  activeWorkers: integer("active_workers").notNull(),
  note: text("note")
});

export const environmentTargetsTable = sqliteTable("environment_targets", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projectsTable.id),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  authType: text("auth_type").notNull().default("none"),
  owner: text("owner"),
  riskLevel: text("risk_level").notNull().default("medium"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const environmentServiceNodesTable = sqliteTable("environment_service_nodes", {
  id: text("id").primaryKey(),
  environmentId: text("environment_id")
    .notNull()
    .references(() => environmentTargetsTable.id),
  name: text("name").notNull(),
  protocol: text("protocol").notNull(),
  baseUrl: text("base_url").notNull(),
  healthPath: text("health_path"),
  dependsOnJson: text("depends_on_json").notNull().default("[]"),
  tagsJson: text("tags_json").notNull().default("[]"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const injectorPoolsTable = sqliteTable("injector_pools", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  region: text("region").notNull(),
  capacity: integer("capacity").notNull(),
  concurrencyLimit: integer("concurrency_limit").notNull(),
  tagsJson: text("tags_json").notNull().default("[]"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const injectorWorkersTable = sqliteTable("injector_workers", {
  id: text("id").primaryKey(),
  poolId: text("pool_id")
    .notNull()
    .references(() => injectorPoolsTable.id),
  name: text("name").notNull(),
  status: text("status").notNull().default("online"),
  currentRunCount: integer("current_run_count").notNull().default(0),
  capacity: integer("capacity").notNull(),
  lastHeartbeatAt: integer("last_heartbeat_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const gatePoliciesTable = sqliteTable("gate_policies", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id),
  name: text("name").notNull(),
  requiredFunctionalFlowsJson: text("required_functional_flows_json").notNull().default("[]"),
  minBenchmarkCoveragePct: integer("min_benchmark_coverage_pct").notNull().default(0),
  minBenchmarkPassRate: integer("min_benchmark_pass_rate").notNull().default(0),
  requiredLoadProfileIdsJson: text("required_load_profile_ids_json").notNull().default("[]"),
  minimumLoadVerdict: text("minimum_load_verdict").notNull().default("watch"),
  allowWaiver: integer("allow_waiver").notNull().default(0),
  approverRolesJson: text("approver_roles_json").notNull().default("[]"),
  expiresAt: integer("expires_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const gatePolicyVersionsTable = sqliteTable("gate_policy_versions", {
  id: text("id").primaryKey(),
  policyId: text("policy_id")
    .notNull()
    .references(() => gatePoliciesTable.id),
  versionNumber: integer("version_number").notNull(),
  status: text("status").notNull().default("active"),
  reason: text("reason"),
  snapshotJson: text("snapshot_json").notNull(),
  createdAt: integer("created_at").notNull()
});

export const releaseCandidatesTable = sqliteTable("release_candidates", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projectsTable.id),
  environmentId: text("environment_id").references(() => environmentTargetsTable.id),
  gatePolicyId: text("gate_policy_id")
    .notNull()
    .references(() => gatePoliciesTable.id),
  name: text("name").notNull(),
  buildLabel: text("build_label").notNull(),
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const releaseGateResultsTable = sqliteTable("release_gate_results", {
  id: text("id").primaryKey(),
  releaseId: text("release_id")
    .notNull()
    .references(() => releaseCandidatesTable.id),
  verdict: text("verdict").notNull(),
  summary: text("summary").notNull(),
  blockersJson: text("blockers_json").notNull().default("[]"),
  signalsJson: text("signals_json").notNull().default("[]"),
  waiverCount: integer("waiver_count").notNull().default(0),
  evaluatedAt: integer("evaluated_at").notNull()
});

export const waiversTable = sqliteTable("waivers", {
  id: text("id").primaryKey(),
  releaseId: text("release_id")
    .notNull()
    .references(() => releaseCandidatesTable.id),
  blockerKey: text("blocker_key").notNull(),
  reason: text("reason").notNull(),
  requestedBy: text("requested_by").notNull(),
  approvedBy: text("approved_by"),
  expiresAt: integer("expires_at").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const approvalEventsTable = sqliteTable("approval_events", {
  id: text("id").primaryKey(),
  releaseId: text("release_id")
    .notNull()
    .references(() => releaseCandidatesTable.id),
  waiverId: text("waiver_id").references(() => waiversTable.id),
  actor: text("actor").notNull(),
  role: text("role").notNull(),
  action: text("action").notNull(),
  detail: text("detail"),
  createdAt: integer("created_at").notNull()
});
