import {
  MaintenanceStatusSchema,
  type
  Action,
  ApiTokenCreateResult,
  AuthMe,
  BackupConfigStatus,
  BackupOperation,
  BackupPreflightResult,
  BackupSnapshot,
  ControlTowerSummary,
  BenchmarkSummary,
  CaseTemplate,
  CaseTemplateRepairDraft,
  DraftActionState,
  EnvironmentRegistry,
  EnvironmentTarget,
  EnvironmentTopology,
  ExecutionMode,
  GatePolicy,
  GatePolicyVersion,
  InjectorPool,
  InjectorWorker,
  Language,
  LoadProfile,
  LoadProfileVersion,
  LoadRunCompare,
  LoadRun,
  LoadRunDetail,
  LoadRunSeries,
  LoadStudioSummary,
  MaintenanceStatus,
  NetworkEvidenceEntry,
  OpsSummary,
  PlatformInfrastructureSummary,
  PlatformLoadQueueSummary,
  Project,
  ReleaseCandidate,
  ReleaseAudit,
  ReleaseGateDetail,
  RuntimeMaintenanceStatus,
  Run,
  RunComparison,
  RunDiagnosis,
  RunEvidence,
  RunLivePhase,
  Step,
  TestCase,
  Waiver
} from "@qpilot/shared";

export interface ReportResponse {
  runId: string;
  htmlPath: string;
  xlsxPath: string;
  videoPath?: string;
  challengeKind?: Run["challengeKind"];
  challengeReason?: string;
  createdAt: string;
}

export interface ActiveRunResponse {
  activeRun: Run | null;
  control: {
    phase: RunLivePhase | "idle";
    message?: string;
    stepIndex?: number;
    paused: boolean;
    manualRequired: boolean;
    executionMode?: ExecutionMode;
    draft?: DraftActionState | null;
    lastEventAt?: string;
  } | null;
}

export type RunControlCommand =
  | { command: "approve"; action?: Action }
  | { command: "edit_and_run"; action: Action }
  | { command: "skip" }
  | { command: "retry" }
  | { command: "switch_mode"; executionMode: ExecutionMode }
  | { command: "pause" }
  | { command: "resume" }
  | { command: "abort" };

const runtimeBase = import.meta.env.VITE_RUNTIME_BASE_URL ?? "http://localhost:8787";
const runtimeWsBase = runtimeBase.replace(/^http/i, "ws");
const runtimeRequestTimeoutMs = Number(
  import.meta.env.VITE_RUNTIME_REQUEST_TIMEOUT_MS ?? 8_000
);

type ApiErrorCode = "http_error" | "runtime_unavailable" | "maintenance_mode";
export const maintenanceEventName = "qpilot:maintenance";

export class ApiError extends Error {
  code: ApiErrorCode;
  url: string;
  status?: number;
  cause?: unknown;
  maintenance?: MaintenanceStatus;
  details?: unknown;

  constructor(
    message: string,
    options: {
      code: ApiErrorCode;
      url: string;
      status?: number;
      cause?: unknown;
      maintenance?: MaintenanceStatus;
      details?: unknown;
    }
  ) {
    super(message);
    this.name = "ApiError";
    this.code = options.code;
    this.url = options.url;
    this.status = options.status;
    this.cause = options.cause;
    this.maintenance = options.maintenance;
    this.details = options.details;
  }
}

export const isRuntimeUnavailableError = (error: unknown): error is ApiError =>
  error instanceof ApiError && error.code === "runtime_unavailable";

export const isUnauthorizedError = (error: unknown): error is ApiError =>
  error instanceof ApiError && error.status === 401;

export const isMaintenanceError = (error: unknown): error is ApiError =>
  error instanceof ApiError && error.code === "maintenance_mode";

const parseMaintenancePayload = (value: unknown): MaintenanceStatus | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const maintenance = candidate.maintenance;
  if (!maintenance || typeof maintenance !== "object") {
    return null;
  }

  try {
    return MaintenanceStatusSchema.parse(maintenance);
  } catch {
    return null;
  }
};

const dispatchMaintenanceEvent = (maintenance: MaintenanceStatus): void => {
  if (
    typeof window === "undefined" ||
    typeof window.dispatchEvent !== "function" ||
    typeof CustomEvent === "undefined"
  ) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<MaintenanceStatus>(maintenanceEventName, {
      detail: maintenance
    })
  );
};

const buildRuntimeUrl = (path: string): string => `${runtimeBase}${path}`;

const encodeUtf8Base64 = (value?: string): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    let chunkBinary = "";
    for (const byte of chunk) {
      chunkBinary += String.fromCharCode(byte);
    }
    binary += chunkBinary;
  }

  return btoa(binary);
};

const runtimeFetch = async (path: string, init?: RequestInit): Promise<Response> => {
  const url = buildRuntimeUrl(path);
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), runtimeRequestTimeoutMs);

  try {
    return await fetch(url, {
      ...init,
      credentials: init?.credentials ?? "include",
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(
        `Unable to reach QPilot runtime at ${runtimeBase}. Request timed out after ${Math.round(
          runtimeRequestTimeoutMs / 1000
        )}s.`,
        {
          code: "runtime_unavailable",
          url,
          cause: error
        }
      );
    }

    if (error instanceof TypeError) {
      throw new ApiError(`Unable to reach QPilot runtime at ${runtimeBase}.`, {
        code: "runtime_unavailable",
        url,
        cause: error
      });
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
};

const toJson = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const body = await response.text();
    let details: unknown = null;
    try {
      details = body ? JSON.parse(body) : null;
    } catch {
      details = null;
    }
    const maintenance = parseMaintenancePayload(details);
    if (response.status === 503 && maintenance) {
      dispatchMaintenanceEvent(maintenance);
      throw new ApiError(
        (details as { error?: string } | null)?.error ??
          maintenance.message ??
          body ??
          "Runtime maintenance window is active.",
        {
          code: "maintenance_mode",
          url: response.url,
          status: response.status,
          maintenance,
          details
        }
      );
    }
    throw new ApiError(
      (details as { error?: string } | null)?.error || body || `HTTP ${response.status}`,
      {
        code: "http_error",
        url: response.url,
        status: response.status,
        details
      }
    );
  }
  return (await response.json()) as T;
};

export const api = {
  runtimeBase,
  runtimeWsBase,
  async getMe(): Promise<AuthMe> {
    return toJson<AuthMe>(await runtimeFetch("/api/auth/me"));
  },
  async register(payload: {
    email: string;
    password: string;
    displayName?: string;
    tenantName?: string;
  }): Promise<AuthMe> {
    return toJson<AuthMe>(
      await runtimeFetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
    );
  },
  async login(payload: { email: string; password: string }): Promise<AuthMe> {
    return toJson<AuthMe>(
      await runtimeFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
    );
  },
  async logout(): Promise<void> {
    await toJson<{ ok: true }>(
      await runtimeFetch("/api/auth/logout", {
        method: "POST"
      })
    );
  },
  async createApiToken(payload: {
    label: string;
    scopes: Array<"release:create" | "gate:read">;
    expiresAt?: string;
  }): Promise<ApiTokenCreateResult> {
    return toJson<ApiTokenCreateResult>(
      await runtimeFetch("/api/auth/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
    );
  },
  async listRuns(projectId?: string): Promise<Run[]> {
    const query = new URLSearchParams();
    if (projectId) {
      query.set("projectId", projectId);
    }
    return toJson<Run[]>(
      await runtimeFetch(`/api/runs${query.size ? `?${query.toString()}` : ""}`)
    );
  },
  async listProjects(): Promise<Project[]> {
    return toJson<Project[]>(await runtimeFetch("/api/projects"));
  },
  async createProject(payload: {
    name: string;
    baseUrl: string;
    username?: string;
    password?: string;
  }): Promise<Project> {
    const body = {
      ...payload,
      nameBase64: encodeUtf8Base64(payload.name),
      usernameBase64: encodeUtf8Base64(payload.username),
      passwordBase64: encodeUtf8Base64(payload.password)
    };
    return toJson<Project>(
      await runtimeFetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      })
    );
  },
  async createRun(payload: {
    projectId: string;
    targetUrl: string;
    username?: string;
    password?: string;
    mode: "general" | "login" | "admin";
    language: Language;
    goal: string;
    maxSteps: number;
    executionMode: ExecutionMode;
    confirmDraft: boolean;
    headed: boolean;
    manualTakeover: boolean;
    sessionProfile?: string;
    saveSession: boolean;
  }): Promise<Run> {
    const body = {
      ...payload,
      goalBase64: encodeUtf8Base64(payload.goal),
      usernameBase64: encodeUtf8Base64(payload.username),
      passwordBase64: encodeUtf8Base64(payload.password)
    };
    return toJson<Run>(
      await runtimeFetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      })
    );
  },
  async rerunRun(
    runId: string,
    payload?: Partial<{
      language: Language;
      executionMode: ExecutionMode;
      confirmDraft: boolean;
      headed: boolean;
      manualTakeover: boolean;
      sessionProfile: string;
      saveSession: boolean;
      maxSteps: number;
    }>
  ): Promise<Run> {
    return toJson<Run>(
      await runtimeFetch(`/api/runs/${runId}/rerun`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? {})
      })
    );
  },
  async getRun(runId: string): Promise<Run> {
    return toJson<Run>(await runtimeFetch(`/api/runs/${runId}`));
  },
  async getRunSteps(runId: string): Promise<Step[]> {
    return toJson<Step[]>(await runtimeFetch(`/api/runs/${runId}/steps`));
  },
  async getRunTestCases(runId: string): Promise<TestCase[]> {
    return toJson<TestCase[]>(await runtimeFetch(`/api/runs/${runId}/testcases`));
  },
  async getRunEvidence(runId: string): Promise<RunEvidence> {
    return toJson<RunEvidence>(await runtimeFetch(`/api/runs/${runId}/evidence`));
  },
  async getRunTraffic(runId: string): Promise<NetworkEvidenceEntry[]> {
    return toJson<NetworkEvidenceEntry[]>(await runtimeFetch(`/api/runs/${runId}/traffic`));
  },
  async getStepTraffic(runId: string, stepIndex: number): Promise<NetworkEvidenceEntry[]> {
    return toJson<NetworkEvidenceEntry[]>(
      await runtimeFetch(`/api/runs/${runId}/steps/${stepIndex}/traffic`)
    );
  },
  async getStepTrafficByRef(
    runId: string,
    stepRef: number | string
  ): Promise<NetworkEvidenceEntry[]> {
    return toJson<NetworkEvidenceEntry[]>(
      await runtimeFetch(`/api/runs/${runId}/steps/${stepRef}/traffic`)
    );
  },
  async getRunCases(runId: string): Promise<CaseTemplate[]> {
    return toJson<CaseTemplate[]>(await runtimeFetch(`/api/runs/${runId}/cases`));
  },
  async getBenchmarkSummary(projectId?: string, language?: Language): Promise<BenchmarkSummary> {
    const query = new URLSearchParams();
    if (projectId) {
      query.set("projectId", projectId);
    }
    if (language) {
      query.set("lang", language);
    }
    return toJson<BenchmarkSummary>(
      await runtimeFetch(`/api/benchmarks/summary${query.size ? `?${query.toString()}` : ""}`)
    );
  },
  async getLoadStudioSummary(projectId?: string): Promise<LoadStudioSummary> {
    const query = new URLSearchParams();
    if (projectId) {
      query.set("projectId", projectId);
    }
    return toJson<LoadStudioSummary>(
      await runtimeFetch(`/api/load/summary${query.size ? `?${query.toString()}` : ""}`)
    );
  },
  async listLoadProfiles(projectId?: string): Promise<LoadProfile[]> {
    const query = new URLSearchParams();
    if (projectId) {
      query.set("projectId", projectId);
    }
    return toJson<LoadProfile[]>(
      await runtimeFetch(`/api/load/profiles${query.size ? `?${query.toString()}` : ""}`)
    );
  },
  async createLoadProfile(payload: {
    projectId: string;
    name: string;
    scenarioLabel: string;
    targetBaseUrl: string;
    engine: LoadProfile["engine"];
    pattern: LoadProfile["pattern"];
    requestPath?: string;
    httpMethod?: LoadProfile["httpMethod"];
    headersJson?: string;
    bodyTemplate?: string;
    virtualUsers: number;
    durationSec: number;
    rampUpSec: number;
    targetRps?: number;
    thresholds: LoadProfile["thresholds"];
  }): Promise<LoadProfile> {
    return toJson<LoadProfile>(
      await runtimeFetch("/api/load/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
    );
  },
  async listLoadRuns(filters?: {
    projectId?: string;
    profileId?: string;
    limit?: number;
  }): Promise<LoadRun[]> {
    const query = new URLSearchParams();
    if (filters?.projectId) {
      query.set("projectId", filters.projectId);
    }
    if (filters?.profileId) {
      query.set("profileId", filters.profileId);
    }
    if (filters?.limit) {
      query.set("limit", String(filters.limit));
    }
    return toJson<LoadRun[]>(
      await runtimeFetch(`/api/load/runs${query.size ? `?${query.toString()}` : ""}`)
    );
  },
  async createLoadRun(payload: {
    profileId: string;
    environmentLabel: string;
    notes?: string;
  }): Promise<LoadRun> {
    return toJson<LoadRun>(
      await runtimeFetch("/api/load/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
    );
  },
  async getLoadRunDetail(runId: string): Promise<LoadRunDetail> {
    return toJson<LoadRunDetail>(await runtimeFetch(`/api/load/runs/${runId}`));
  },
  async getControlTowerSummary(projectId?: string): Promise<ControlTowerSummary> {
    const query = new URLSearchParams();
    if (projectId) {
      query.set("projectId", projectId);
    }
    return toJson<ControlTowerSummary>(
      await runtimeFetch(`/api/platform/control-tower${query.size ? `?${query.toString()}` : ""}`)
    );
  },
  async getPlatformInfrastructure(): Promise<PlatformInfrastructureSummary> {
    return toJson<PlatformInfrastructureSummary>(await runtimeFetch("/api/platform/infra"));
  },
  async getPlatformLoadQueueSummary(): Promise<PlatformLoadQueueSummary> {
    return toJson<PlatformLoadQueueSummary>(await runtimeFetch("/api/platform/load/queue"));
  },
  async getOpsSummary(): Promise<OpsSummary> {
    return toJson<OpsSummary>(await runtimeFetch("/api/platform/ops/summary"));
  },
  async getBackupConfigStatus(): Promise<BackupConfigStatus> {
    return toJson<BackupConfigStatus>(await runtimeFetch("/api/platform/ops/backups/config"));
  },
  async listBackupSnapshots(): Promise<BackupSnapshot[]> {
    return toJson<BackupSnapshot[]>(await runtimeFetch("/api/platform/ops/backups/snapshots"));
  },
  async runBackupNow(): Promise<BackupOperation> {
    return toJson<BackupOperation>(
      await runtimeFetch("/api/platform/ops/backups/run", {
        method: "POST"
      })
    );
  },
  async previewBackupRestore(snapshotId: string): Promise<BackupPreflightResult> {
    return toJson<BackupPreflightResult>(
      await runtimeFetch("/api/platform/ops/backups/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotId })
      })
    );
  },
  async startBackupRestore(snapshotId: string): Promise<BackupOperation> {
    return toJson<BackupOperation>(
      await runtimeFetch("/api/platform/ops/backups/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotId })
      })
    );
  },
  async getBackupOperation(operationId: string): Promise<BackupOperation> {
    return toJson<BackupOperation>(
      await runtimeFetch(`/api/platform/ops/backups/operations/${operationId}`)
    );
  },
  async getEnvironmentRegistry(projectId?: string): Promise<EnvironmentRegistry> {
    const query = new URLSearchParams();
    if (projectId) {
      query.set("projectId", projectId);
    }
    return toJson<EnvironmentRegistry>(
      await runtimeFetch(`/api/platform/environments${query.size ? `?${query.toString()}` : ""}`)
    );
  },
  async getEnvironmentTopology(environmentId: string): Promise<EnvironmentTopology> {
    return toJson<EnvironmentTopology>(
      await runtimeFetch(`/api/platform/environments/${environmentId}/topology`)
    );
  },
  async createEnvironment(payload: {
    projectId?: string;
    name: string;
    baseUrl: string;
    authType?: string;
    owner?: string;
    riskLevel?: EnvironmentTarget["riskLevel"];
    serviceNodes?: Array<{
      name: string;
      protocol: string;
      baseUrl: string;
      healthPath?: string;
      dependsOnIds?: string[];
      tags?: string[];
    }>;
  }): Promise<EnvironmentTarget> {
    return toJson<EnvironmentTarget>(
      await runtimeFetch("/api/platform/environments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
    );
  },
  async getPlatformInjectors(): Promise<{
    pools: InjectorPool[];
    workers: InjectorWorker[];
  }> {
    return toJson<{ pools: InjectorPool[]; workers: InjectorWorker[] }>(
      await runtimeFetch("/api/platform/injectors")
    );
  },
  async createInjectorPool(payload: {
    name: string;
    region: string;
    capacity: number;
    concurrencyLimit: number;
    tags?: string[];
    workers?: Array<{ name: string; capacity: number }>;
  }): Promise<InjectorPool> {
    return toJson<InjectorPool>(
      await runtimeFetch("/api/platform/injectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
    );
  },
  async listGatePolicies(projectId?: string): Promise<GatePolicy[]> {
    const query = new URLSearchParams();
    if (projectId) {
      query.set("projectId", projectId);
    }
    return toJson<GatePolicy[]>(
      await runtimeFetch(`/api/platform/gate-policies${query.size ? `?${query.toString()}` : ""}`)
    );
  },
  async createGatePolicy(payload: {
    projectId: string;
    name: string;
    requiredFunctionalFlows: string[];
    minBenchmarkCoveragePct: number;
    minBenchmarkPassRate: number;
    requiredLoadProfileIds: string[];
    minimumLoadVerdict: LoadRun["verdict"];
    allowWaiver: boolean;
    approverRoles: string[];
    expiresAt?: string;
  }): Promise<GatePolicy> {
    return toJson<GatePolicy>(
      await runtimeFetch("/api/platform/gate-policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
    );
  },
  async listPlatformLoadProfiles(projectId?: string): Promise<LoadProfile[]> {
    const query = new URLSearchParams();
    if (projectId) {
      query.set("projectId", projectId);
    }
    return toJson<LoadProfile[]>(
      await runtimeFetch(`/api/platform/load/profiles${query.size ? `?${query.toString()}` : ""}`)
    );
  },
  async createPlatformLoadProfile(payload: {
    projectId: string;
    name: string;
    scenarioLabel: string;
    targetBaseUrl: string;
    environmentTargetId?: string;
    engine: LoadProfile["engine"];
    pattern: LoadProfile["pattern"];
    requestPath?: string;
    httpMethod?: LoadProfile["httpMethod"];
    headersJson?: string;
    bodyTemplate?: string;
    executionMode: LoadProfile["executionMode"];
    workerCount: number;
    injectorPoolId?: string;
    arrivalModel: LoadProfile["arrivalModel"];
    phasePlanJson?: string;
    requestMixJson?: string;
    evidencePolicyJson?: string;
    gatePolicyId?: string;
    tagsJson?: string;
    virtualUsers: number;
    durationSec: number;
    rampUpSec: number;
    targetRps?: number;
    thresholds: LoadProfile["thresholds"];
  }): Promise<LoadProfile> {
    return toJson<LoadProfile>(
      await runtimeFetch("/api/platform/load/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
    );
  },
  async pinPlatformLoadBaseline(profileId: string, runId: string): Promise<LoadProfile> {
    return toJson<LoadProfile>(
      await runtimeFetch(`/api/platform/load/profiles/${profileId}/baseline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId })
      })
    );
  },
  async promotePlatformLoadBaseline(profileId: string, runId: string): Promise<LoadProfile> {
    return toJson<LoadProfile>(
      await runtimeFetch(`/api/platform/load/profiles/${profileId}/promote-baseline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId })
      })
    );
  },
  async listPlatformLoadRuns(filters?: {
    projectId?: string;
    profileId?: string;
    environmentId?: string;
    status?: LoadRun["status"];
    verdict?: LoadRun["verdict"];
    limit?: number;
  }): Promise<LoadRun[]> {
    const query = new URLSearchParams();
    if (filters?.projectId) {
      query.set("projectId", filters.projectId);
    }
    if (filters?.profileId) {
      query.set("profileId", filters.profileId);
    }
    if (filters?.environmentId) {
      query.set("environmentId", filters.environmentId);
    }
    if (filters?.status) {
      query.set("status", filters.status);
    }
    if (filters?.verdict) {
      query.set("verdict", filters.verdict);
    }
    if (filters?.limit) {
      query.set("limit", String(filters.limit));
    }
    return toJson<LoadRun[]>(
      await runtimeFetch(`/api/platform/load/runs${query.size ? `?${query.toString()}` : ""}`)
    );
  },
  async createPlatformLoadRun(payload: {
    profileId: string;
    environmentId?: string;
    environmentLabel: string;
    notes?: string;
  }): Promise<LoadRun> {
    return toJson<LoadRun>(
      await runtimeFetch("/api/platform/load/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
    );
  },
  async getPlatformLoadRunDetail(runId: string): Promise<LoadRunDetail> {
    return toJson<LoadRunDetail>(await runtimeFetch(`/api/platform/load/runs/${runId}`));
  },
  async retryPlatformLoadRun(runId: string, notes?: string): Promise<LoadRun> {
    return toJson<LoadRun>(
      await runtimeFetch(`/api/platform/load/runs/${runId}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notes ? { notes } : {})
      })
    );
  },
  async cancelPlatformLoadRun(runId: string): Promise<LoadRun> {
    return toJson<LoadRun>(
      await runtimeFetch(`/api/platform/load/runs/${runId}/cancel`, {
        method: "POST"
      })
    );
  },
  async getPlatformLoadRunSeries(runId: string): Promise<LoadRunSeries> {
    return toJson<LoadRunSeries>(
      await runtimeFetch(`/api/platform/load/runs/${runId}/series`)
    );
  },
  async getPlatformLoadRunCompare(input: {
    runId: string;
    baselineRunId?: string;
    candidateRunId?: string;
  }): Promise<LoadRunCompare> {
    const query = new URLSearchParams();
    if (input.baselineRunId) {
      query.set("baselineRunId", input.baselineRunId);
    }
    if (input.candidateRunId) {
      query.set("candidateRunId", input.candidateRunId);
    }
    return toJson<LoadRunCompare>(
      await runtimeFetch(
        `/api/platform/load/runs/${input.runId}/compare${query.size ? `?${query.toString()}` : ""}`
      )
    );
  },
  async listPlatformLoadProfileVersions(profileId: string): Promise<LoadProfileVersion[]> {
    return toJson<LoadProfileVersion[]>(
      await runtimeFetch(`/api/platform/load/profiles/${profileId}/versions`)
    );
  },
  async rollbackPlatformLoadProfile(
    profileId: string,
    versionId: string
  ): Promise<LoadProfile> {
    return toJson<LoadProfile>(
      await runtimeFetch(`/api/platform/load/profiles/${profileId}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId })
      })
    );
  },
  async listGatePolicyVersions(policyId: string): Promise<GatePolicyVersion[]> {
    return toJson<GatePolicyVersion[]>(
      await runtimeFetch(`/api/platform/gate-policies/${policyId}/versions`)
    );
  },
  async listReleases(projectId?: string): Promise<ReleaseCandidate[]> {
    const query = new URLSearchParams();
    if (projectId) {
      query.set("projectId", projectId);
    }
    return toJson<ReleaseCandidate[]>(
      await runtimeFetch(`/api/platform/releases${query.size ? `?${query.toString()}` : ""}`)
    );
  },
  async createRelease(payload: {
    projectId: string;
    environmentId?: string;
    gatePolicyId: string;
    name: string;
    buildLabel: string;
    buildId?: string;
    commitSha?: string;
    sourceRunIds?: string[];
    sourceLoadRunIds?: string[];
    notes?: string;
  }): Promise<ReleaseCandidate> {
    return toJson<ReleaseCandidate>(
      await runtimeFetch("/api/platform/releases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
    );
  },
  async getReleaseGateDetail(releaseId: string): Promise<ReleaseGateDetail> {
    return toJson<ReleaseGateDetail>(
      await runtimeFetch(`/api/platform/releases/${releaseId}/gates`)
    );
  },
  async getReleaseAudit(releaseId: string): Promise<ReleaseAudit> {
    return toJson<ReleaseAudit>(await runtimeFetch(`/api/platform/releases/${releaseId}/audit`));
  },
  async createReleaseApproval(payload: {
    releaseId: string;
    actor: string;
    role: string;
    action: string;
    detail?: string;
  }): Promise<ReleaseAudit> {
    return toJson<ReleaseAudit>(
      await runtimeFetch(`/api/platform/releases/${payload.releaseId}/approvals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actor: payload.actor,
          role: payload.role,
          action: payload.action,
          detail: payload.detail
        })
      })
    );
  },
  async listWaivers(releaseId?: string): Promise<Waiver[]> {
    const query = new URLSearchParams();
    if (releaseId) {
      query.set("releaseId", releaseId);
    }
    return toJson<Waiver[]>(
      await runtimeFetch(`/api/platform/waivers${query.size ? `?${query.toString()}` : ""}`)
    );
  },
  async createWaiver(payload: {
    releaseId: string;
    blockerKey: string;
    reason: string;
    requestedBy: string;
    approvedBy?: string;
    role?: string;
    expiresAt: string;
  }): Promise<ReleaseGateDetail> {
    return toJson<ReleaseGateDetail>(
      await runtimeFetch("/api/platform/waivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
    );
  },
  async listCases(projectId?: string): Promise<CaseTemplate[]> {
    const query = new URLSearchParams();
    if (projectId) {
      query.set("projectId", projectId);
    }
    return toJson<CaseTemplate[]>(
      await runtimeFetch(`/api/cases${query.size ? `?${query.toString()}` : ""}`)
    );
  },
  async getReport(runId: string): Promise<ReportResponse> {
    return toJson<ReportResponse>(await runtimeFetch(`/api/reports/${runId}`));
  },
  async getRunDiagnosis(runId: string, language?: Language): Promise<RunDiagnosis> {
    const query = new URLSearchParams();
    if (language) {
      query.set("lang", language);
    }
    return toJson<RunDiagnosis>(
      await runtimeFetch(`/api/runs/${runId}/diagnosis${query.size ? `?${query.toString()}` : ""}`)
    );
  },
  async compareRuns(
    baseRunId: string,
    candidateRunId: string,
    language?: Language
  ): Promise<RunComparison> {
    const query = new URLSearchParams({
      baseRunId,
      candidateRunId
    });
    if (language) {
      query.set("lang", language);
    }
    return toJson<RunComparison>(await runtimeFetch(`/api/runs/compare?${query.toString()}`));
  },
  async resumeRun(runId: string): Promise<{ ok: true; runId: string }> {
    return toJson<{ ok: true; runId: string }>(
      await runtimeFetch(`/api/runs/${runId}/resume`, {
        method: "POST"
      })
    );
  },
  async pauseRun(runId: string): Promise<{ ok: true; runId: string }> {
    return toJson<{ ok: true; runId: string }>(
      await runtimeFetch(`/api/runs/${runId}/pause`, {
        method: "POST"
      })
    );
  },
  async abortRun(runId: string): Promise<{ ok: true; runId: string }> {
    return toJson<{ ok: true; runId: string }>(
      await runtimeFetch(`/api/runs/${runId}/abort`, {
        method: "POST"
      })
    );
  },
  async bringRunToFront(runId: string): Promise<{ ok: true; runId: string }> {
    return toJson<{ ok: true; runId: string }>(
      await runtimeFetch(`/api/runs/${runId}/bring-to-front`, {
        method: "POST"
      })
    );
  },
  async switchExecutionMode(
    runId: string,
    executionMode: ExecutionMode
  ): Promise<{ ok: true; runId: string; executionMode: ExecutionMode }> {
    return toJson<{ ok: true; runId: string; executionMode: ExecutionMode }>(
      await runtimeFetch(`/api/runs/${runId}/execution-mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executionMode })
      })
    );
  },
  async approveDraft(runId: string, action?: Action): Promise<{ ok: true; runId: string }> {
    return toJson<{ ok: true; runId: string }>(
      await runtimeFetch(`/api/runs/${runId}/draft/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      })
    );
  },
  async skipDraft(runId: string): Promise<{ ok: true; runId: string }> {
    return toJson<{ ok: true; runId: string }>(
      await runtimeFetch(`/api/runs/${runId}/draft/skip`, {
        method: "POST"
      })
    );
  },
  async controlRun(
    runId: string,
    payload: RunControlCommand
  ): Promise<{ ok: true; runId: string; command: string; executionMode?: ExecutionMode }> {
    return toJson<{ ok: true; runId: string; command: string; executionMode?: ExecutionMode }>(
      await runtimeFetch(`/api/runs/${runId}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
    );
  },
  async extractCases(runId: string): Promise<CaseTemplate[]> {
    return toJson<CaseTemplate[]>(
      await runtimeFetch("/api/cases/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId })
      })
    );
  },
  async replayCase(
    caseId: string,
    payload?: Partial<{
      language: Language;
      executionMode: ExecutionMode;
      confirmDraft: boolean;
      headed: boolean;
      manualTakeover: boolean;
      sessionProfile: string;
      saveSession: boolean;
      maxSteps: number;
    }>
  ): Promise<Run> {
    return toJson<Run>(
      await runtimeFetch(`/api/cases/${caseId}/replay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? {})
      })
    );
  },
  async previewCaseRepairDraft(
    caseId: string,
    runId: string
  ): Promise<CaseTemplateRepairDraft> {
    return toJson<CaseTemplateRepairDraft>(
      await runtimeFetch(`/api/cases/${caseId}/repair-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId })
      })
    );
  },
  async applyCaseRepairDraft(
    caseId: string,
    runId: string,
    replay?: Partial<{
      language: Language;
      executionMode: ExecutionMode;
      confirmDraft: boolean;
      headed: boolean;
      manualTakeover: boolean;
      sessionProfile: string;
      saveSession: boolean;
      maxSteps: number;
    }>
  ): Promise<{
    ok: true;
    draft: CaseTemplateRepairDraft;
    caseTemplate: CaseTemplate;
    replayRun?: Run;
  }> {
    return toJson<{
      ok: true;
      draft: CaseTemplateRepairDraft;
      caseTemplate: CaseTemplate;
      replayRun?: Run;
    }>(
      await runtimeFetch(`/api/cases/${caseId}/apply-repair-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, replay })
      })
    );
  },
  createRunStream(runId: string): EventSource {
    return new EventSource(buildRuntimeUrl(`/api/runs/${runId}/stream`));
  },
  async getActiveRun(): Promise<ActiveRunResponse> {
    return toJson<ActiveRunResponse>(await runtimeFetch("/api/runtime/active-run"));
  },
  async getMaintenanceStatus(): Promise<RuntimeMaintenanceStatus> {
    return toJson<RuntimeMaintenanceStatus>(await runtimeFetch("/api/runtime/maintenance"));
  },
  createRunLiveSocket(runId: string): WebSocket {
    return new WebSocket(`${runtimeWsBase}/api/runs/${runId}/live`);
  }
};
