import { buildEmptyProfile, ApplicationEngine } from "../../browser/application-engine.js";
import { JobDiscoveryService, discoveryUtils } from "../../domain/discovery.js";
import { FieldMapperService } from "../../domain/mapping.js";
import {
  CandidateProfileSchema,
  ReviewResolutionSchema,
  type ApplicationAttempt,
  type CandidateProfile,
  type DiscoveredJob,
  type JobSource
} from "../../domain/schemas.js";
import type { JobAssistantDatabase } from "../db.js";
import type { ApplicationEventHub } from "../events.js";

export class RuntimeInputError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "RuntimeInputError";
  }
}

export class DuplicateApplicationError extends Error {
  readonly statusCode = 409;
  readonly code = "duplicate_application";

  constructor(
    message: string,
    readonly existingAttempt: ApplicationAttempt
  ) {
    super(message);
    this.name = "DuplicateApplicationError";
  }
}

export class JobAssistantRuntime {
  private readonly discovery: JobDiscoveryService;
  private readonly mapper: FieldMapperService;
  readonly engine: ApplicationEngine;
  private readonly llmConfigured: boolean;
  private readonly llmModel?: string;

  constructor(
    private readonly db: JobAssistantDatabase,
    eventHub: ApplicationEventHub,
    paths: { artifactsRoot: string; sessionsRoot: string },
    options?: {
      ai?: {
        baseURL: string;
        apiKey: string;
        model: string;
        timeoutMs?: number;
      };
      discovery?: {
        greenhouseApiBase?: string;
        leverApiBase?: string;
      };
      browser?: {
        headless?: boolean;
      };
    }
  ) {
    this.discovery = new JobDiscoveryService({
      greenhouseApiBase: options?.discovery?.greenhouseApiBase,
      leverApiBase: options?.discovery?.leverApiBase,
      browser: {
        headless: options?.browser?.headless ?? false,
        sessionsRoot: paths.sessionsRoot,
        getStorageStatePath: (siteKey) => this.db.getSessionState(siteKey),
        saveStorageStatePath: (siteKey, storagePath) => {
          this.db.upsertSessionState(siteKey, storagePath);
        }
      }
    });
    this.mapper = new FieldMapperService({
      ai: options?.ai
    });
    this.engine = new ApplicationEngine({
      artifactsRoot: paths.artifactsRoot,
      sessionsRoot: paths.sessionsRoot,
      db,
      eventHub,
      fieldMapper: this.mapper,
      browserHeadless: options?.browser?.headless ?? false
    });
    this.llmConfigured = Boolean(options?.ai?.apiKey);
    this.llmModel = options?.ai?.model;
  }

  getHealth() {
    return {
      ok: true as const,
      activeAttemptId: this.engine.getActiveAttemptId(),
      llmConfigured: this.llmConfigured,
      llmModel: this.llmConfigured ? this.llmModel : undefined
    };
  }

  getProfile(): CandidateProfile {
    return this.db.getProfile() ?? buildEmptyProfile();
  }

  saveProfile(input: CandidateProfile): CandidateProfile {
    return this.db.saveProfile(CandidateProfileSchema.parse(input));
  }

  listAnswers() {
    return this.db.listAnswers();
  }

  upsertAnswer(input: Parameters<JobAssistantDatabase["upsertAnswer"]>[0]) {
    return this.db.upsertAnswer(input);
  }

  deleteAnswer(id: string): void {
    this.db.deleteAnswer(id);
  }

  listSources() {
    return this.db.listSources();
  }

  createSource(input: { label: string; seedUrl: string; kind?: JobSource["kind"] }) {
    const seedUrl = input.seedUrl.trim();
    const detectedKind = input.kind ?? this.discovery.detectSourceKind(seedUrl);

    if (!seedUrl) {
      throw new RuntimeInputError("请先填写来源 URL。");
    }

    if (
      detectedKind === "feishu_sheet" &&
      !discoveryUtils.isFeishuSheetUrl(seedUrl) &&
      !isLocalFixtureUrl(seedUrl)
    ) {
      throw new RuntimeInputError("飞书表格导入只支持飞书 /sheets/ 链接。");
    }

    if (isUnsupportedSpreadsheetSource(seedUrl) && detectedKind !== "feishu_sheet") {
      throw new RuntimeInputError(
        "这类表格链接目前还不能直接当作职位源。飞书表格请显式选择“飞书表格导入”，其他情况请填写具体招聘页、Greenhouse 职位板或 Lever feed。"
      );
    }

    const label =
      input.label.trim() ||
      (detectedKind === "feishu_sheet" ? "飞书岗位表" : deriveSourceLabel(seedUrl));

    return this.db.createSource({
      label,
      seedUrl,
      kind: detectedKind
    });
  }

  deleteSource(id: string): void {
    this.db.deleteSource(id);
  }

  async discoverSources(sourceId?: string): Promise<DiscoveredJob[]> {
    const source = sourceId ? this.db.getSource(sourceId) : null;
    const sources = source
      ? [source]
      : this.db.listSources().filter((nextSource) => nextSource.enabled);

    const jobs: DiscoveredJob[] = [];
    for (const nextSource of sources) {
      try {
        const discovered = await this.discovery.discover(nextSource);
        const savedJobs = this.db.upsertJobs(discovered);
        this.db.pruneSourceJobs(
          nextSource.id,
          savedJobs.map((job) => job.fingerprint)
        );
        jobs.push(...savedJobs);
        this.db.markSourceScan(nextSource.id);
      } catch (error) {
        this.db.markSourceScan(
          nextSource.id,
          error instanceof Error ? error.message : "职位发现流程发生了未知错误。"
        );
      }
    }

    return jobs;
  }

  listJobs(filters?: { status?: string; query?: string }) {
    return this.db.listJobs(filters);
  }

  updateJobStatus(jobId: string, status: Parameters<JobAssistantDatabase["updateJobStatus"]>[1]) {
    this.db.updateJobStatus(jobId, status);
  }

  listAttempts(statuses?: string[]) {
    return this.db.listAttempts(statuses);
  }

  getAttempt(id: string) {
    return this.db.getAttempt(id);
  }

  listEvents(attemptId: string) {
    return this.db.listEvents(attemptId);
  }

  private findDuplicateAttempt(jobId: string): ApplicationAttempt | undefined {
    return this.db
      .listAttempts()
      .find((attempt) => attempt.jobId === jobId && !["failed", "aborted"].includes(attempt.status));
  }

  private assertJobCanBePrepared(job: DiscoveredJob): void {
    if (!["greenhouse", "lever", "moka", "portal", "jsonld"].includes(job.ats)) {
      throw new RuntimeInputError(
        "当前链接还不在可处理的岗位页面范围内。请先确认它是岗位详情页、职位入口页，或真实申请表。"
      );
    }
  }

  private prepareAttemptForJob(
    job: NonNullable<ReturnType<JobAssistantDatabase["getJob"]>>,
    options?: {
      settings?: Parameters<JobAssistantDatabase["createAttempt"]>[1];
      autoRunIfReady?: boolean;
    }
  ): Promise<ApplicationAttempt> {
    const duplicateAttempt = this.findDuplicateAttempt(job.id);
    if (duplicateAttempt) {
      throw new DuplicateApplicationError(
        `这个岗位已经存在一个申请尝试（${duplicateAttempt.status}）。`,
        duplicateAttempt
      );
    }

    const attempt = this.db.createAttempt(
      {
        jobId: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        applyUrl: job.applyUrl,
        ats: job.ats
      },
      options?.settings
    );

    this.db.addEvent(attempt.id, "status", "正在准备申请流程。");
    return this.engine
      .prepareAttempt(attempt, job, this.getProfile(), this.db.listAnswers())
      .then(async (preparedAttempt) => {
        if (options?.autoRunIfReady && preparedAttempt.status === "ready_to_fill") {
          this.db.addEvent(
            preparedAttempt.id,
            "status",
            "自动投递策略已触发，正在继续浏览器填写流程。"
          );
          return this.engine.startAttempt(preparedAttempt, job);
        }

        return preparedAttempt;
      });
  }

  async prepareApplication(
    jobId: string,
    options?: {
      automationMode?: "manual" | "safe_auto_apply";
      submissionMode?: "submit_enabled" | "prefill_only";
    }
  ): Promise<ApplicationAttempt> {
    const job = this.db.getJob(jobId);
    if (!job) {
      throw new RuntimeInputError("未找到对应岗位。");
    }

    this.assertJobCanBePrepared(job);

    const automationMode = options?.automationMode ?? "manual";
    return this.prepareAttemptForJob(job, {
      settings: {
        automationMode,
        submissionMode:
          automationMode === "safe_auto_apply"
            ? "submit_enabled"
            : (options?.submissionMode ?? "submit_enabled")
      },
      autoRunIfReady: automationMode === "safe_auto_apply"
    });
  }

  prepareDirectApplication(input: {
    applyUrl: string;
    ats?: "greenhouse" | "lever" | "moka" | "portal";
    title?: string;
    company?: string;
    location?: string;
    submissionMode?: "submit_enabled" | "prefill_only";
    automationMode?: "manual" | "safe_auto_apply";
  }): Promise<ApplicationAttempt> {
    const detectedKind = input.ats ?? discoveryUtils.inferAtsFromApplyUrl(input.applyUrl);
    if (
      detectedKind !== "greenhouse" &&
      detectedKind !== "lever" &&
      detectedKind !== "moka" &&
      detectedKind !== "portal"
    ) {
      throw new RuntimeInputError(
        "直接发起真实投递目前只支持 Greenhouse、Lever、Moka，以及通用岗位入口/岗位详情链接。"
      );
    }

    const inferredCompanyToken =
      detectedKind === "greenhouse"
        ? discoveryUtils.deriveGreenhouseToken(input.applyUrl)
        : detectedKind === "lever"
          ? discoveryUtils.deriveLeverSite(input.applyUrl)
          : new URL(input.applyUrl).hostname.split(".")[0] ?? "portal";
    const company = input.company?.trim() || humanizeToken(inferredCompanyToken) || "直接投递";
    const job = this.db.createDirectJob({
      ats: detectedKind,
      applyUrl: input.applyUrl,
      title: input.title?.trim() || "真实投递链接",
      company,
      location: input.location?.trim() || "Remote / Not specified"
    });

    return this.prepareAttemptForJob(job, {
      settings: {
        origin: "direct_url",
        submissionMode:
          input.automationMode === "safe_auto_apply"
            ? "submit_enabled"
            : (input.submissionMode ?? "prefill_only"),
        liveTargetUrl: input.applyUrl,
        automationMode: input.automationMode ?? "manual"
      },
      autoRunIfReady: input.automationMode === "safe_auto_apply"
    });
  }

  async saveReview(attemptId: string, resolutions: unknown): Promise<ApplicationAttempt> {
    const attempt = this.db.getAttempt(attemptId);
    if (!attempt) {
      throw new RuntimeInputError("未找到对应的申请尝试。");
    }
    const parsed = ReviewResolutionSchema.array().parse(resolutions);
    return this.engine.applyReviewResolutions(attempt, parsed);
  }

  async startApplication(attemptId: string): Promise<ApplicationAttempt> {
    const attempt = this.db.getAttempt(attemptId);
    if (!attempt) {
      throw new RuntimeInputError("未找到对应的申请尝试。");
    }
    const job = this.db.getJob(attempt.jobId);
    if (!job) {
      throw new RuntimeInputError("关联岗位不存在。");
    }
    return this.engine.startAttempt(attempt, job);
  }

  async resumeApplication(attemptId: string): Promise<ApplicationAttempt> {
    const attempt = this.db.getAttempt(attemptId);
    if (!attempt) {
      throw new RuntimeInputError("未找到对应的申请尝试。");
    }
    return this.engine.resumeAttempt(attempt);
  }

  async confirmSubmit(attemptId: string): Promise<ApplicationAttempt> {
    const attempt = this.db.getAttempt(attemptId);
    if (!attempt) {
      throw new RuntimeInputError("未找到对应的申请尝试。");
    }
    if (attempt.settings.submissionMode !== "submit_enabled") {
      throw new RuntimeInputError("当前尝试处于仅预填模式，请先启用最终提交。");
    }
    if (attempt.status !== "awaiting_submit_confirmation") {
      throw new RuntimeInputError("当前尝试还没有准备好进行最终提交。");
    }
    return this.engine.confirmSubmit(attempt);
  }

  enableFinalSubmit(attemptId: string): ApplicationAttempt {
    const attempt = this.db.getAttempt(attemptId);
    if (!attempt) {
      throw new RuntimeInputError("未找到对应的申请尝试。");
    }
    if (attempt.status !== "prefill_completed") {
      throw new RuntimeInputError("只有在真实预填完成后，才能启用最终提交。");
    }
    if (this.engine.getActiveAttemptId() !== attempt.id) {
      throw new RuntimeInputError("当前尝试对应的真实浏览器会话已经不再活跃。");
    }

    const updated = this.db.updateAttempt(attempt.id, {
      status: "awaiting_submit_confirmation",
      settings: {
        ...attempt.settings,
        submissionMode: "submit_enabled"
      },
      submitGateMessage:
        "当前真实浏览器会话已经允许最终提交。请先检查页面，再在准备好时确认提交。"
    });
    this.db.addReviewConfirmation(attempt.id, "enable_final_submit", {
      enabledAt: new Date().toISOString()
    });
    this.db.addEvent(attempt.id, "submit", "当前真实浏览器会话已经启用最终提交。");
    return updated;
  }
}

const humanizeToken = (value: string): string =>
  value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const isUnsupportedSpreadsheetSource = (value: string): boolean => {
  try {
    const url = new URL(value);
    const pathname = url.pathname.toLowerCase();
    const hostname = url.hostname.toLowerCase();
    return (
      pathname.includes("/spreadsheets/") ||
      hostname.includes("docs.google.com") ||
      hostname.includes("docs.qq.com")
    );
  } catch {
    return false;
  }
};

const deriveSourceLabel = (value: string): string => {
  try {
    const url = new URL(value);
    const firstPathToken = url.pathname
      .split("/")
      .filter(Boolean)
      .find(Boolean);
    if (firstPathToken) {
      return humanizeToken(firstPathToken);
    }
    return url.hostname;
  } catch {
    return "未命名来源";
  }
};

const isLocalFixtureUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return ["127.0.0.1", "localhost"].includes(url.hostname);
  } catch {
    return false;
  }
};
