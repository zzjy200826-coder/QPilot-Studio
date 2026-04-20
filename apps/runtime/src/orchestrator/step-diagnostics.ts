import type {
  Action,
  ExecutionDiagnostics,
  Language,
  StepFailureCategory,
  TemplateRepairCandidate,
  TemplateReplayDiagnostics,
  TrafficAssertion,
  VerificationResult
} from "@qpilot/shared";
import type { ActionExecutionResult } from "../playwright/executor/action-executor.js";

const localize = (language: Language | undefined, english: string, chinese: string): string =>
  language === "zh-CN" ? chinese : english;

const classifyFailureCategory = (
  actionResult: ActionExecutionResult,
  verification: VerificationResult
): StepFailureCategory | undefined => {
  const reason =
    `${actionResult.failureReason ?? ""} ${actionResult.blockingReason ?? ""} ${verification.note ?? ""}`.toLowerCase();

  if (actionResult.status === "blocked_high_risk") {
    return "blocked_high_risk";
  }
  if (actionResult.challenge?.detected || reason.includes("challenge") || reason.includes("验证码")) {
    return "security_challenge";
  }
  if (
    reason.includes("unable to locate target") ||
    reason.includes("cannot find") ||
    reason.includes("未能在当前页面") ||
    reason.includes("requires a target")
  ) {
    return "locator_miss";
  }
  if (
    reason.includes("not visible") ||
    reason.includes("intercepts pointer events") ||
    reason.includes("not enabled") ||
    reason.includes("outside of the viewport") ||
    reason.includes("timeout 6000ms exceeded")
  ) {
    return "element_not_interactable";
  }
  if (actionResult.status === "success" && verification.api?.status === "failed") {
    return "api_mismatch";
  }
  if (
    actionResult.status === "success" &&
    !verification.passed &&
    actionResult.resolutionMethod === "generic_fallback"
  ) {
    return "wrong_target";
  }
  if (actionResult.status === "success" && !verification.passed) {
    return "no_effect";
  }
  if (actionResult.status === "failed") {
    return "unexpected_runtime";
  }
  return undefined;
};

const buildFailureSuggestion = (
  category: StepFailureCategory | undefined,
  language?: Language
): string | undefined => {
  switch (category) {
    case "blocked_high_risk":
      return localize(
        language,
        "Refine the goal or switch to manual takeover before attempting high-risk actions.",
        "先收窄目标，或切到人工接管后再执行高风险动作。"
      );
    case "security_challenge":
      return localize(
        language,
        "Keep the visible browser open and let a human solve the checkpoint before resuming.",
        "保持可见浏览器打开，先由人工处理验证码或安全校验，再继续执行。"
      );
    case "locator_miss":
      return localize(
        language,
        "Capture more stable text, accessible labels, or iframe context for this control before retrying.",
        "先补充更稳定的文本、无障碍标签或 iframe 上下文，再重试这个控件。"
      );
    case "element_not_interactable":
      return localize(
        language,
        "Wait for the control to become visible, dismiss overlays, or switch to manual takeover for this page state.",
        "先等待控件可见、关闭遮罩，必要时切到人工接管后再操作。"
      );
    case "wrong_target":
      return localize(
        language,
        "The fallback target may be too generic. Prefer a stronger selector or explicit text hint.",
        "当前命中的备用目标过于宽泛，建议补充更明确的选择器或文本提示。"
      );
    case "api_mismatch":
      return localize(
        language,
        "The UI action fired, but the backend response did not match expectations. Inspect step traffic before retrying.",
        "UI 动作已经触发，但接口结果不符合预期。建议先检查这一步的流量再重试。"
      );
    case "no_effect":
      return localize(
        language,
        "The action completed but did not change the business state. Tighten the expected checks or target hint.",
        "动作执行完了，但业务状态没有变化。建议收紧预期校验或目标提示。"
      );
    case "unexpected_runtime":
      return localize(
        language,
        "Open the developer evidence for this step and inspect the raw error before retrying.",
        "先打开这一步的开发者证据查看原始错误，再决定是否重试。"
      );
    default:
      return undefined;
  }
};

const buildTemplateReplayRepairSuggestion = (
  category: StepFailureCategory | undefined,
  language?: Language
): string | undefined => {
  switch (category) {
    case "locator_miss":
      return localize(
        language,
        "Refresh this template step with a stronger selector, visible text, or iframe hint from the live page.",
        "用当前页面里的更稳定 selector、可见文本或 iframe 上下文刷新这个模板步骤。"
      );
    case "wrong_target":
    case "no_effect":
      return localize(
        language,
        "Tighten the stored target and expected checks before reusing this template step again.",
        "下次复用这个模板步骤前，先把目标定位和预期校验收紧一些。"
      );
    case "api_mismatch":
      return localize(
        language,
        "Keep the UI step, but refresh the expected API assertions captured from the latest successful run.",
        "保留这个 UI 步骤，但用最近一次成功运行刷新它的 API 断言。"
      );
    case "element_not_interactable":
      return localize(
        language,
        "Add a precondition for overlays, animation settle time, or the correct iframe before replaying this step.",
        "给这个模板步骤补上遮罩处理、动画稳定等待或正确 iframe 前置条件。"
      );
    default:
      return undefined;
  }
};

const clampConfidence = (value: number): number =>
  Math.max(0, Math.min(1, Number(value.toFixed(2))));

const buildTemplateRepairCandidateConfidence = (
  actionResult: ActionExecutionResult,
  failureCategory: StepFailureCategory | undefined
): number => {
  let confidence = 0.52;

  switch (actionResult.resolutionMethod) {
    case "dom_selector":
      confidence = 0.86;
      break;
    case "text_match":
      confidence = 0.74;
      break;
    case "ocr":
      confidence = 0.66;
      break;
    case "generic_fallback":
      confidence = 0.38;
      break;
    default:
      confidence = 0.52;
      break;
  }

  if (actionResult.visualMatch?.confidence) {
    confidence = Math.max(confidence, Math.min(0.94, actionResult.visualMatch.confidence));
  }

  if (failureCategory === "locator_miss" || failureCategory === "unexpected_runtime") {
    confidence -= 0.18;
  } else if (failureCategory === "wrong_target") {
    confidence -= 0.12;
  } else if (failureCategory === "no_effect" || failureCategory === "api_mismatch") {
    confidence -= 0.08;
  }

  return clampConfidence(confidence);
};

const buildTemplateRepairCandidate = (input: {
  templateReplay?: {
    templateId: string;
    templateTitle: string;
    templateType: "ui" | "hybrid";
    stepIndex: number;
    stepCount: number;
  };
  action: Action;
  actionResult: ActionExecutionResult;
  expectedChecks: string[];
  expectedRequests: TrafficAssertion[];
  failureCategory?: StepFailureCategory;
  failureReason?: string;
  repairSuggestion?: string;
}): TemplateRepairCandidate | undefined => {
  if (!input.templateReplay) {
    return undefined;
  }

  const matched =
    input.actionResult.status === "success" &&
    !input.failureCategory;
  if (matched) {
    return undefined;
  }

  const suggestedTarget = input.actionResult.targetUsed ?? input.action.target;
  const action: Action =
    suggestedTarget && suggestedTarget !== input.action.target
      ? {
          ...input.action,
          target: suggestedTarget
        }
      : input.action;

  return {
    templateId: input.templateReplay.templateId,
    templateTitle: input.templateReplay.templateTitle,
    templateType: input.templateReplay.templateType,
    templateStepIndex: input.templateReplay.stepIndex,
    templateStepCount: input.templateReplay.stepCount,
    confidence: buildTemplateRepairCandidateConfidence(
      input.actionResult,
      input.failureCategory
    ),
    action,
    suggestedTarget,
    suggestedExpectedChecks: input.expectedChecks,
    suggestedExpectedRequests: input.expectedRequests,
    reason: input.failureReason,
    repairHint: input.repairSuggestion
  };
};

const buildTemplateReplayDiagnostics = (input: {
  templateReplay?: {
    templateId: string;
    templateTitle: string;
    templateType: "ui" | "hybrid";
    stepIndex: number;
    stepCount: number;
  };
  actionResult: ActionExecutionResult;
  verification: VerificationResult;
  failureCategory?: StepFailureCategory;
  language?: Language;
}): TemplateReplayDiagnostics | undefined => {
  if (!input.templateReplay) {
    return undefined;
  }

  const matched =
    input.actionResult.status === "success" &&
    input.verification.passed &&
    input.verification.api?.status !== "failed";

  return {
    templateId: input.templateReplay.templateId,
    templateTitle: input.templateReplay.templateTitle,
    templateType: input.templateReplay.templateType,
    stepIndex: input.templateReplay.stepIndex,
    stepCount: input.templateReplay.stepCount,
    outcome: matched ? "matched" : "drifted",
    repairSuggestion:
      matched
        ? undefined
        : buildTemplateReplayRepairSuggestion(input.failureCategory, input.language) ??
          buildFailureSuggestion(input.failureCategory, input.language)
  };
};

export const buildExecutionDiagnostics = (input: {
  action: Action;
  actionResult: ActionExecutionResult;
  verification: VerificationResult;
  language?: Language;
  expectedChecks?: string[];
  expectedRequests?: TrafficAssertion[];
  templateReplay?: {
    templateId: string;
    templateTitle: string;
    templateType: "ui" | "hybrid";
    stepIndex: number;
    stepCount: number;
  };
}): ExecutionDiagnostics | undefined => {
  const failureCategory = classifyFailureCategory(input.actionResult, input.verification);
  const failureReason =
    input.actionResult.failureReason ??
    input.actionResult.blockingReason ??
    input.verification.note;
  const templateReplay = buildTemplateReplayDiagnostics({
    templateReplay: input.templateReplay,
    actionResult: input.actionResult,
    verification: input.verification,
    failureCategory,
    language: input.language
  });
  const failureSuggestion = buildFailureSuggestion(failureCategory, input.language);
  const templateRepairCandidate = buildTemplateRepairCandidate({
    templateReplay: input.templateReplay,
    action: input.action,
    actionResult: input.actionResult,
    expectedChecks: input.expectedChecks ?? [],
    expectedRequests: input.expectedRequests ?? [],
    failureCategory,
    failureReason,
    repairSuggestion:
      templateReplay?.repairSuggestion ?? failureSuggestion
  });

  const diagnostics: ExecutionDiagnostics = {
    targetUsed: input.actionResult.targetUsed,
    resolutionMethod: input.actionResult.resolutionMethod,
    failureCategory,
    failureSuggestion,
    failureReason,
    visualMatch: input.actionResult.visualMatch,
    templateReplay,
    templateRepairCandidate
  };

  if (
    !diagnostics.targetUsed &&
    !diagnostics.resolutionMethod &&
    !diagnostics.failureCategory &&
    !diagnostics.failureSuggestion &&
    !diagnostics.failureReason &&
    !diagnostics.visualMatch &&
    !diagnostics.templateReplay &&
    !diagnostics.templateRepairCandidate
  ) {
    return undefined;
  }

  return diagnostics;
};
