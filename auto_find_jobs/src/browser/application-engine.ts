import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type {
  ApplicationAttempt,
  ApplicationAutomationDecision,
  ApplicationEvent,
  CandidateProfile,
  DiscoveredJob,
  FillPlan,
  FormField,
  ReviewResolution
} from "../domain/schemas.js";
import { CandidateProfileSchema, FillPlanSchema } from "../domain/schemas.js";
import { FieldMapperService } from "../domain/mapping.js";
import type { JobAssistantDatabase } from "../server/db.js";
import type { ApplicationEventHub } from "../server/events.js";
import { resolveAdapterForJob } from "./adapters/index.js";
import { ManualInterventionRequiredError, type SiteAdapter } from "./adapters/types.js";

interface ActiveAttemptSession {
  attemptId: string;
  job: DiscoveredJob;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  adapter: SiteAdapter;
  nextDecisionIndex: number;
  siteKey: string;
  storageStatePath: string;
}

interface CapturedArtifacts {
  screenshotPath: string;
  htmlArtifactPath?: string;
  pageUrl: string;
}

interface ApplicationEngineDeps {
  artifactsRoot: string;
  sessionsRoot: string;
  db: JobAssistantDatabase;
  eventHub: ApplicationEventHub;
  fieldMapper: FieldMapperService;
  browserHeadless: boolean;
}

const highRiskSourceKeys = new Set([
  "workAuthorization",
  "sponsorship",
  "expectedSalary",
  "startDate",
  "gender",
  "race",
  "veteran",
  "disability",
  "relocation"
]);

const buildDefaultFillPlan = (): FillPlan =>
  FillPlanSchema.parse({
    decisions: [],
    reviewItems: [],
    requiresSubmitConfirmation: true,
    generatedAt: new Date().toISOString()
  });

const mergeFields = (currentFields: FormField[], incomingFields: FormField[]): FormField[] => {
  const merged = [...currentFields];
  for (const incomingField of incomingFields) {
    const existingIndex = merged.findIndex((field) => field.fieldId === incomingField.fieldId);
    if (existingIndex >= 0) {
      merged[existingIndex] = incomingField;
      continue;
    }
    merged.push(incomingField);
  }
  return merged;
};

export class ApplicationEngine {
  private activeSession: ActiveAttemptSession | null = null;

  constructor(private readonly deps: ApplicationEngineDeps) {}

  getActiveAttemptId(): string | undefined {
    return this.activeSession?.attemptId;
  }

  async prepareAttempt(
    attempt: ApplicationAttempt,
    job: DiscoveredJob,
    profile: CandidateProfile,
    answers: ReturnType<JobAssistantDatabase["listAnswers"]>
  ): Promise<ApplicationAttempt> {
    try {
      const session = await this.ensureSession(attempt, job, profile);
      return this.prepareWithSession(attempt, session, profile, answers);
    } catch (error) {
      if (error instanceof ManualInterventionRequiredError && this.activeSession?.attemptId === attempt.id) {
        return this.pauseForManual(attempt, this.activeSession, error.prompt, {
          adapterKind: this.activeSession.adapter.kind
        });
      }

      if (this.activeSession?.attemptId === attempt.id) {
        return this.failAttempt(attempt, this.activeSession, {
          phase: "error",
          label: "prepare-open-failed",
          message: error instanceof Error ? error.message : "打开申请页面时发生了未知错误。"
        });
      }

      throw error;
    }
  }

  private async prepareWithSession(
    attempt: ApplicationAttempt,
    session: ActiveAttemptSession,
    profile: CandidateProfile,
    answers: ReturnType<JobAssistantDatabase["listAnswers"]>
  ): Promise<ApplicationAttempt> {
    try {
      const fields = await session.adapter.extractFields(session.page);
      const fillPlan = await this.deps.fieldMapper.buildPlan(fields, profile, answers);
      const artifacts = await this.capturePageArtifacts(session.page, attempt.id, "prepared");
      const status = fillPlan.reviewItems.length > 0 ? "awaiting_review" : "ready_to_fill";
      const updatedAttempt = this.deps.db.updateAttempt(attempt.id, {
        status,
        adapterKind: session.adapter.kind,
        formFields: fields,
        fillPlan,
        currentScreenshotPath: artifacts.screenshotPath,
        errorMessage: null,
        manualPrompt: null,
        submitGateMessage: null,
        startedAt: attempt.startedAt ?? new Date().toISOString()
      });

      await this.persistSessionState(session);
      this.publish(
        attempt.id,
        "review",
        fillPlan.reviewItems.length > 0 ? "已生成待确认字段队列。" : "申请准备完成，可以开始自动填写。",
        {
          reviewItemCount: fillPlan.reviewItems.length,
          pageUrl: artifacts.pageUrl,
          htmlArtifactPath: artifacts.htmlArtifactPath
        },
        artifacts.screenshotPath
      );

      return updatedAttempt;
    } catch (error) {
      if (error instanceof ManualInterventionRequiredError) {
        return this.pauseForManual(attempt, session, error.prompt, {
          adapterKind: session.adapter.kind
        });
      }

      return this.failAttempt(attempt, session, {
        phase: "error",
        label: "prepare-failed",
        message: error instanceof Error ? error.message : "申请准备流程发生了未知错误。"
      });
    }
  }

  async applyReviewResolutions(
    attempt: ApplicationAttempt,
    resolutions: ReviewResolution[]
  ): Promise<ApplicationAttempt> {
    const fillPlan = FillPlanSchema.parse(attempt.fillPlan ?? buildDefaultFillPlan());
    const nextPlan: FillPlan = {
      ...fillPlan,
      decisions: [...fillPlan.decisions],
      reviewItems: fillPlan.reviewItems.filter(
        (item) => !resolutions.some((resolution) => resolution.fieldId === item.fieldId)
      ),
      generatedAt: new Date().toISOString()
    };

    for (const resolution of resolutions) {
      const existingDecisionIndex = nextPlan.decisions.findIndex(
        (decision) => decision.fieldId === resolution.fieldId
      );
      if (existingDecisionIndex >= 0) {
        nextPlan.decisions[existingDecisionIndex] = {
          ...nextPlan.decisions[existingDecisionIndex],
          fieldId: resolution.fieldId,
          value: resolution.value,
          sourceType: "manual",
          confidence: 1,
          needsHumanReview: false
        };
      } else {
        nextPlan.decisions.push({
          fieldId: resolution.fieldId,
          value: resolution.value,
          sourceType: "manual",
          confidence: 1,
          needsHumanReview: false
        });
      }
    }

    const fieldOrder = new Map(attempt.formFields.map((field, index) => [field.fieldId, index]));
    nextPlan.decisions.sort(
      (left, right) =>
        (fieldOrder.get(left.fieldId) ?? Number.MAX_SAFE_INTEGER) -
        (fieldOrder.get(right.fieldId) ?? Number.MAX_SAFE_INTEGER)
    );

    this.deps.db.addReviewConfirmation(attempt.id, "field_review", { resolutions });

    const updated = this.deps.db.updateAttempt(attempt.id, {
      status: nextPlan.reviewItems.length > 0 ? "awaiting_review" : "ready_to_fill",
      fillPlan: nextPlan
    });

    this.publish(
      attempt.id,
      "review",
      nextPlan.reviewItems.length > 0
        ? "确认答案已保存，仍有其他字段等待处理。"
        : "确认答案已保存，可以继续申请流程。",
      {
        remainingReviewItems: nextPlan.reviewItems.length
      }
    );

    return updated;
  }

  async startAttempt(attempt: ApplicationAttempt, job: DiscoveredJob): Promise<ApplicationAttempt> {
    if (!attempt.fillPlan) {
      throw new Error("当前申请尝试还没有完成准备。");
    }
    if (attempt.fillPlan.reviewItems.length > 0) {
      throw new Error("当前申请仍有待确认字段。");
    }

    if (this.activeSession?.attemptId === attempt.id) {
      return this.fillFromCurrentIndex(attempt, this.activeSession);
    }

    try {
      const session = await this.ensureSession(attempt, job, this.deps.db.getProfile() ?? buildEmptyProfile());
      session.nextDecisionIndex = 0;
      return this.fillFromCurrentIndex(attempt, session);
    } catch (error) {
      if (error instanceof ManualInterventionRequiredError && this.activeSession?.attemptId === attempt.id) {
        return this.pauseForManual(attempt, this.activeSession, error.prompt, {
          adapterKind: this.activeSession.adapter.kind
        });
      }

      if (this.activeSession?.attemptId === attempt.id) {
        return this.failAttempt(attempt, this.activeSession, {
          phase: "error",
          label: "start-open-failed",
          message: error instanceof Error ? error.message : "重新打开申请页面时发生了未知错误。"
        });
      }

      throw error;
    }
  }

  async resumeAttempt(attempt: ApplicationAttempt): Promise<ApplicationAttempt> {
    if (!this.activeSession || this.activeSession.attemptId !== attempt.id) {
      throw new Error("当前尝试对应的浏览器会话已经不可用。");
    }

    await this.activeSession.page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);

    if (!attempt.fillPlan || attempt.formFields.length === 0) {
      const preparedAttempt = await this.prepareWithSession(
        attempt,
        this.activeSession,
        this.deps.db.getProfile() ?? buildEmptyProfile(),
        this.deps.db.listAnswers()
      );

      if (preparedAttempt.status === "ready_to_fill") {
        return this.fillFromCurrentIndex(preparedAttempt, this.activeSession);
      }

      return preparedAttempt;
    }

    return this.fillFromCurrentIndex(attempt, this.activeSession);
  }

  async confirmSubmit(attempt: ApplicationAttempt): Promise<ApplicationAttempt> {
    if (!this.activeSession || this.activeSession.attemptId !== attempt.id) {
      throw new Error("当前尝试对应的浏览器会话已经不可用。");
    }

    this.deps.db.addReviewConfirmation(attempt.id, "submit_confirmation", {
      confirmedAt: new Date().toISOString()
    });

    return this.submitWithSession(attempt, this.activeSession, {
      autoTriggered: false,
      preSubmitMessage: "已收到最终确认，正在提交申请。"
    });
  }

  private async fillFromCurrentIndex(
    attempt: ApplicationAttempt,
    session: ActiveAttemptSession
  ): Promise<ApplicationAttempt> {
    const currentPlan = FillPlanSchema.parse(attempt.fillPlan ?? buildDefaultFillPlan());
    const fillingAttempt = this.deps.db.updateAttempt(attempt.id, {
      status: "filling",
      fillPlan: currentPlan,
      errorMessage: null,
      manualPrompt: null,
      submitGateMessage: null
    });

    try {
      const result = await session.adapter.fill(
        session.page,
        currentPlan,
        fillingAttempt.formFields,
        session.nextDecisionIndex,
        async (message) => {
          const stepShot = await this.captureScreenshot(
            session.page,
            attempt.id,
            `fill-${session.nextDecisionIndex}`
          );
          this.publish(attempt.id, "fill", message, {}, stepShot);
        }
      );

      session.nextDecisionIndex = result.nextDecisionIndex;

      if (result.state === "manual") {
        return this.pauseForManual(
          fillingAttempt,
          session,
          result.manualPrompt ?? "请先在真实浏览器中完成当前人工步骤，然后再继续。",
          {
            nextDecisionIndex: result.nextDecisionIndex
          }
        );
      }

      if (result.state === "advanced") {
        const liveFields = result.newFields ?? [];
        const mergedFields = mergeFields(fillingAttempt.formFields, liveFields);
        const nextPlan = await this.deps.fieldMapper.extendPlan({
          currentPlan,
          existingFields: fillingAttempt.formFields,
          newFields: liveFields,
          profile: this.deps.db.getProfile() ?? buildEmptyProfile(),
          answerLibrary: this.deps.db.listAnswers(),
          reviewReasonPrefix: "这个字段是在下一步流程中新增出现的。"
        });

        const artifacts = await this.capturePageArtifacts(session.page, attempt.id, "advanced");
        const needsReview = nextPlan.reviewItems.length > 0;
        const updatedAttempt = this.deps.db.updateAttempt(fillingAttempt.id, {
          status: needsReview ? "awaiting_review" : "ready_to_fill",
          formFields: mergedFields,
          fillPlan: nextPlan,
          currentScreenshotPath: artifacts.screenshotPath
        });

        await this.persistSessionState(session);
        this.publish(
          attempt.id,
          needsReview ? "review" : "fill",
          needsReview ? "下一步出现了新字段，已进入确认队列。" : "下一步出现了新字段，已扩展填写计划。",
          {
            newFieldCount: liveFields.length,
            reviewItemCount: nextPlan.reviewItems.length,
            pageUrl: artifacts.pageUrl,
            htmlArtifactPath: artifacts.htmlArtifactPath
          },
          artifacts.screenshotPath
        );

        if (needsReview) {
          return updatedAttempt;
        }

        return this.fillFromCurrentIndex(updatedAttempt, session);
      }

      const artifacts = await this.capturePageArtifacts(session.page, attempt.id, "ready-to-submit");
      const automationDecision =
        fillingAttempt.settings.automationMode === "safe_auto_apply"
          ? this.evaluateAutomationDecision(fillingAttempt, currentPlan)
          : undefined;

      const settingsWithDecision =
        fillingAttempt.settings.automationMode === "safe_auto_apply"
          ? {
              ...fillingAttempt.settings,
              automationDecision
            }
          : fillingAttempt.settings;

      if (fillingAttempt.settings.submissionMode === "prefill_only") {
        const nextAttempt = this.deps.db.updateAttempt(fillingAttempt.id, {
          status: "prefill_completed",
          settings: settingsWithDecision,
          currentScreenshotPath: artifacts.screenshotPath,
          submitGateMessage:
            "当前处于仅预填模式。请检查真实浏览器页面，只有在你确认要正式投递时再启用最终提交。"
        });

        await this.persistSessionState(session);
        this.publish(
          attempt.id,
          "submit",
          "表单已完成预填，最终提交仍然锁定。",
          {
            nextDecisionIndex: result.nextDecisionIndex,
            pageUrl: artifacts.pageUrl,
            htmlArtifactPath: artifacts.htmlArtifactPath,
            submissionMode: fillingAttempt.settings.submissionMode
          },
          artifacts.screenshotPath
        );

        return nextAttempt;
      }

      if (fillingAttempt.settings.automationMode === "safe_auto_apply" && automationDecision) {
        if (automationDecision.eligible) {
          const autoReadyAttempt = this.deps.db.updateAttempt(fillingAttempt.id, {
            status: "awaiting_submit_confirmation",
            settings: settingsWithDecision,
            currentScreenshotPath: artifacts.screenshotPath,
            submitGateMessage: "自动投递策略已通过，系统正在自动提交。"
          });

          this.publish(
            attempt.id,
            "submit",
            "自动投递策略已通过，系统正在自动提交。",
            {
              nextDecisionIndex: result.nextDecisionIndex,
              pageUrl: artifacts.pageUrl,
              htmlArtifactPath: artifacts.htmlArtifactPath,
              automationReason: automationDecision.reason
            },
            artifacts.screenshotPath
          );

          return this.submitWithSession(autoReadyAttempt, session, {
            autoTriggered: true,
            preSubmitMessage: "自动投递策略已通过，系统正在自动提交。"
          });
        }

        const blockedAttempt = this.deps.db.updateAttempt(fillingAttempt.id, {
          status: "awaiting_submit_confirmation",
          settings: settingsWithDecision,
          currentScreenshotPath: artifacts.screenshotPath,
          submitGateMessage: `已停止自动提交：${automationDecision.reason}。请检查页面后再手动确认。`
        });

        await this.persistSessionState(session);
        this.publish(
          attempt.id,
          "submit",
          `自动投递未执行：${automationDecision.reason}`,
          {
            nextDecisionIndex: result.nextDecisionIndex,
            pageUrl: artifacts.pageUrl,
            htmlArtifactPath: artifacts.htmlArtifactPath,
            automationReason: automationDecision.reason
          },
          artifacts.screenshotPath
        );

        return blockedAttempt;
      }

      const nextAttempt = this.deps.db.updateAttempt(fillingAttempt.id, {
        status: "awaiting_submit_confirmation",
        settings: settingsWithDecision,
        currentScreenshotPath: artifacts.screenshotPath,
        submitGateMessage: "所有已映射字段都已填写完成，请在检查页面后确认最终提交。"
      });

      await this.persistSessionState(session);
      this.publish(
        attempt.id,
        "submit",
        "表单填写完成，正在等待最终提交确认。",
        {
          nextDecisionIndex: result.nextDecisionIndex,
          pageUrl: artifacts.pageUrl,
          htmlArtifactPath: artifacts.htmlArtifactPath,
          submissionMode: fillingAttempt.settings.submissionMode
        },
        artifacts.screenshotPath
      );
      return nextAttempt;
    } catch (error) {
      if (error instanceof ManualInterventionRequiredError) {
        return this.pauseForManual(fillingAttempt, session, error.prompt, {
          nextDecisionIndex: session.nextDecisionIndex
        });
      }

      return this.failAttempt(fillingAttempt, session, {
        phase: "error",
        label: "fill-failed",
        message: error instanceof Error ? error.message : "自动填写阶段发生了未知错误。"
      });
    }
  }

  private evaluateAutomationDecision(
    attempt: ApplicationAttempt,
    fillPlan: FillPlan
  ): ApplicationAutomationDecision {
    const checkedAt = new Date().toISOString();

    if (attempt.settings.automationMode !== "safe_auto_apply") {
      return {
        checkedAt,
        eligible: false,
        reason: "未启用自动投递策略。"
      };
    }

    if (attempt.settings.submissionMode !== "submit_enabled") {
      return {
        checkedAt,
        eligible: false,
        reason: "当前尝试不允许最终提交。"
      };
    }

    if (!["greenhouse", "lever"].includes(attempt.jobSnapshot.ats)) {
      return {
        checkedAt,
        eligible: false,
        reason: "当前 ATS 不在自动提交白名单内。"
      };
    }

    if (attempt.settings.manualInterventionOccurred) {
      return {
        checkedAt,
        eligible: false,
        reason: "本次流程中出现过人工介入。"
      };
    }

    if (fillPlan.reviewItems.length > 0) {
      return {
        checkedAt,
        eligible: false,
        reason: "仍有字段需要人工确认。"
      };
    }

    if (fillPlan.decisions.some((decision) => decision.sourceType === "llm")) {
      return {
        checkedAt,
        eligible: false,
        reason: "存在依赖 LLM 推断的字段。"
      };
    }

    if (fillPlan.decisions.some((decision) => decision.sourceType === "manual")) {
      return {
        checkedAt,
        eligible: false,
        reason: "存在经人工确认后填写的字段。"
      };
    }

    if (
      fillPlan.decisions.some(
        (decision) => decision.sourceKey && highRiskSourceKeys.has(decision.sourceKey)
      )
    ) {
      return {
        checkedAt,
        eligible: false,
        reason: "存在高风险问题字段。"
      };
    }

    return {
      checkedAt,
      eligible: true,
      reason: "当前表单满足安全自动提交条件。"
    };
  }

  private async submitWithSession(
    attempt: ApplicationAttempt,
    session: ActiveAttemptSession,
    options: {
      autoTriggered: boolean;
      preSubmitMessage: string;
    }
  ): Promise<ApplicationAttempt> {
    const beforeSubmitArtifacts = await this.capturePageArtifacts(
      session.page,
      attempt.id,
      "submit-ready"
    );
    const submittingAttempt = this.deps.db.updateAttempt(attempt.id, {
      status: "submitting",
      currentScreenshotPath: beforeSubmitArtifacts.screenshotPath
    });

    if (options.autoTriggered) {
      this.deps.db.addReviewConfirmation(attempt.id, "auto_submit_execution", {
        confirmedAt: new Date().toISOString()
      });
    }

    this.publish(
      attempt.id,
      "submit",
      options.preSubmitMessage,
      {
        autoTriggered: options.autoTriggered,
        pageUrl: beforeSubmitArtifacts.pageUrl,
        htmlArtifactPath: beforeSubmitArtifacts.htmlArtifactPath
      },
      beforeSubmitArtifacts.screenshotPath
    );

    try {
      const result = await session.adapter.submit(session.page);
      const afterSubmitArtifacts = await this.capturePageArtifacts(
        session.page,
        attempt.id,
        "submitted"
      );
      await this.persistSessionState(session);

      const nextAttempt = this.deps.db.updateAttempt(submittingAttempt.id, {
        status: result.confirmed ? "submitted" : "failed",
        currentScreenshotPath: afterSubmitArtifacts.screenshotPath,
        submitGateMessage: null,
        errorMessage: result.confirmed ? null : result.message,
        endedAt: new Date().toISOString()
      });

      if (result.confirmed) {
        this.deps.db.updateJobStatus(attempt.jobId, "applied");
      }

      this.publish(
        attempt.id,
        result.confirmed ? "submit" : "error",
        result.message,
        {
          autoTriggered: options.autoTriggered,
          confirmed: result.confirmed,
          pageUrl: afterSubmitArtifacts.pageUrl,
          htmlArtifactPath: afterSubmitArtifacts.htmlArtifactPath
        },
        afterSubmitArtifacts.screenshotPath
      );

      await this.closeActiveSession();
      return nextAttempt;
    } catch (error) {
      if (error instanceof ManualInterventionRequiredError) {
        return this.pauseForManual(submittingAttempt, session, error.prompt);
      }

      return this.failAttempt(submittingAttempt, session, {
        phase: "error",
        label: "submit-failed",
        message: error instanceof Error ? error.message : "最终提交阶段发生了未知错误。"
      });
    }
  }

  private async ensureSession(
    attempt: ApplicationAttempt,
    job: DiscoveredJob,
    profile?: CandidateProfile
  ): Promise<ActiveAttemptSession> {
    if (this.activeSession?.attemptId === attempt.id) {
      return this.activeSession;
    }

    if (this.activeSession && this.activeSession.attemptId !== attempt.id) {
      throw new Error(
        `当前还有另一个活动中的申请尝试（${this.activeSession.attemptId}），请先完成它再开始新的尝试。`
      );
    }

    const adapter = resolveAdapterForJob(job);
    const browser = await chromium.launch({ headless: this.deps.browserHeadless });
    const { siteKey, storageStatePath } = this.resolveStorageState(job);
    const context = await browser.newContext({
      storageState: existsSync(storageStatePath) ? storageStatePath : undefined
    });
    const page = await context.newPage();

    const session: ActiveAttemptSession = {
      attemptId: attempt.id,
      job,
      browser,
      context,
      page,
      adapter,
      nextDecisionIndex: 0,
      siteKey,
      storageStatePath
    };

    this.activeSession = session;
    await adapter.openApply(page, job, profile);
    return session;
  }

  private resolveStorageState(job: DiscoveredJob): { siteKey: string; storageStatePath: string } {
    const url = new URL(job.applyUrl);
    const siteKey = `${job.ats}-${url.hostname.replace(/[^a-z0-9.-]/gi, "_")}`;
    const knownPath = this.deps.db.getSessionState(siteKey);
    return {
      siteKey,
      storageStatePath: knownPath ?? resolve(this.deps.sessionsRoot, `${siteKey}.json`)
    };
  }

  private async captureScreenshot(page: Page, attemptId: string, label: string): Promise<string> {
    const directory = resolve(this.deps.artifactsRoot, attemptId);
    await mkdir(directory, { recursive: true });
    const filename = `${Date.now()}-${label}.png`;
    const absolutePath = resolve(directory, filename);
    await page.screenshot({ path: absolutePath, fullPage: true });
    return `/artifacts/${attemptId}/${filename}`;
  }

  private async capturePageArtifacts(
    page: Page,
    attemptId: string,
    label: string
  ): Promise<CapturedArtifacts> {
    const screenshotPath = await this.captureScreenshot(page, attemptId, label);
    const directory = resolve(this.deps.artifactsRoot, attemptId);
    await mkdir(directory, { recursive: true });
    const htmlFilename = `${Date.now()}-${label}.html`;
    const htmlAbsolutePath = resolve(directory, htmlFilename);
    const html = await page.content().catch(() => "");

    if (html) {
      await writeFile(htmlAbsolutePath, html, "utf8");
    }

    return {
      screenshotPath,
      htmlArtifactPath: html ? `/artifacts/${attemptId}/${htmlFilename}` : undefined,
      pageUrl: page.url()
    };
  }

  private async persistSessionState(session: ActiveAttemptSession): Promise<void> {
    await session.context.storageState({ path: session.storageStatePath });
    this.deps.db.upsertSessionState(session.siteKey, session.storageStatePath);
  }

  private async pauseForManual(
    attempt: ApplicationAttempt,
    session: ActiveAttemptSession,
    manualPrompt: string,
    payload: Record<string, unknown> = {}
  ): Promise<ApplicationAttempt> {
    const artifacts = await this.capturePageArtifacts(session.page, attempt.id, "manual");
    const nextAttempt = this.deps.db.updateAttempt(attempt.id, {
      status: "awaiting_manual",
      settings: {
        ...attempt.settings,
        manualInterventionOccurred: true
      },
      adapterKind:
        typeof payload.adapterKind === "string"
          ? (payload.adapterKind as ApplicationAttempt["adapterKind"])
          : session.adapter.kind,
      manualPrompt,
      currentScreenshotPath: artifacts.screenshotPath,
      startedAt: attempt.startedAt ?? new Date().toISOString()
    });

    await this.persistSessionState(session);
    this.publish(
      attempt.id,
      "manual",
      manualPrompt,
      {
        ...payload,
        pageUrl: artifacts.pageUrl,
        htmlArtifactPath: artifacts.htmlArtifactPath
      },
      artifacts.screenshotPath
    );

    return nextAttempt;
  }

  private async failAttempt(
    attempt: ApplicationAttempt,
    session: ActiveAttemptSession,
    details: {
      phase: ApplicationEvent["type"];
      label: string;
      message: string;
    }
  ): Promise<ApplicationAttempt> {
    const artifacts = await this.capturePageArtifacts(session.page, attempt.id, details.label).catch(
      () => undefined
    );
    await this.persistSessionState(session).catch(() => undefined);

    const failedAttempt = this.deps.db.updateAttempt(attempt.id, {
      status: "failed",
      currentScreenshotPath: artifacts?.screenshotPath ?? attempt.currentScreenshotPath ?? null,
      errorMessage: details.message,
      endedAt: new Date().toISOString()
    });

    this.publish(
      attempt.id,
      details.phase,
      details.message,
      {
        pageUrl: artifacts?.pageUrl,
        htmlArtifactPath: artifacts?.htmlArtifactPath
      },
      artifacts?.screenshotPath
    );

    await this.closeActiveSession();
    return failedAttempt;
  }

  private async closeActiveSession(): Promise<void> {
    if (!this.activeSession) {
      return;
    }

    const session = this.activeSession;
    this.activeSession = null;
    await Promise.allSettled([session.page.close(), session.context.close(), session.browser.close()]);
  }

  private publish(
    attemptId: string,
    type: ApplicationEvent["type"],
    message: string,
    payload: Record<string, unknown> = {},
    screenshotPath?: string
  ): void {
    const event = this.deps.db.addEvent(attemptId, type, message, payload, screenshotPath);
    this.deps.eventHub.publish(event);
  }
}

export const buildEmptyProfile = (): CandidateProfile =>
  CandidateProfileSchema.parse({
    basic: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      city: "",
      country: ""
    },
    education: [],
    experience: [],
    preferences: {
      targetKeywords: [],
      preferredLocations: [],
      excludeKeywords: []
    },
    answers: {},
    files: {
      resumePath: "",
      otherFiles: []
    }
  });
