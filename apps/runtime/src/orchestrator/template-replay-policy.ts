import type { StepFailureCategory, VerificationResult } from "@qpilot/shared";

export interface TemplateReplayFallbackDecision {
  category?: StepFailureCategory;
  reason: string;
}

const NON_FALLBACK_CATEGORIES = new Set<StepFailureCategory>([
  "security_challenge",
  "blocked_high_risk"
]);

export const decideTemplateReplayFallback = (input: {
  hasFailures: boolean;
  haltReason?: string;
  verification: VerificationResult;
}): TemplateReplayFallbackDecision | null => {
  if (!input.hasFailures || input.haltReason) {
    return null;
  }

  const category = input.verification.execution?.failureCategory;
  if (category && NON_FALLBACK_CATEGORIES.has(category)) {
    return null;
  }

  if (category) {
    return {
      category,
      reason:
        input.verification.execution?.failureReason ??
        input.verification.execution?.failureSuggestion ??
        input.verification.note ??
        category
    };
  }

  return {
    reason: input.verification.note ?? "template replay drifted from the live page state"
  };
};
