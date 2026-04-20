import { describe, expect, it } from "vitest";
import type { VerificationResult } from "@qpilot/shared";
import { decideTemplateReplayFallback } from "../orchestrator/template-replay-policy.js";

const baseVerification = (): VerificationResult => ({
  urlChanged: false,
  checks: [],
  passed: false
});

describe("decideTemplateReplayFallback", () => {
  it("falls back to planner for recoverable template drift", () => {
    const decision = decideTemplateReplayFallback({
      hasFailures: true,
      verification: {
        ...baseVerification(),
        execution: {
          failureCategory: "locator_miss",
          failureReason: "missing replay selector"
        }
      }
    });

    expect(decision).toEqual({
      category: "locator_miss",
      reason: "missing replay selector"
    });
  });

  it("does not fall back when the step halted on a hard stop", () => {
    const decision = decideTemplateReplayFallback({
      hasFailures: true,
      haltReason: "Captcha detected",
      verification: {
        ...baseVerification(),
        execution: {
          failureCategory: "security_challenge"
        }
      }
    });

    expect(decision).toBeNull();
  });

  it("ignores blocked_high_risk failures", () => {
    const decision = decideTemplateReplayFallback({
      hasFailures: true,
      verification: {
        ...baseVerification(),
        execution: {
          failureCategory: "blocked_high_risk",
          failureSuggestion: "manual approval required"
        }
      }
    });

    expect(decision).toBeNull();
  });

  it("uses verification notes when no structured category is available", () => {
    const decision = decideTemplateReplayFallback({
      hasFailures: true,
      verification: {
        ...baseVerification(),
        note: "template replay drifted after the page changed"
      }
    });

    expect(decision).toEqual({
      reason: "template replay drifted after the page changed"
    });
  });
});
