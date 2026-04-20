import { describe, expect, it } from "vitest";
import type { VerificationResult } from "@qpilot/shared";
import { buildExecutionDiagnostics } from "../orchestrator/step-diagnostics.js";

const baseVerification = (): VerificationResult => ({
  urlChanged: false,
  checks: [],
  passed: false
});

describe("buildExecutionDiagnostics", () => {
  it("classifies missing locator errors", () => {
    const diagnostics = buildExecutionDiagnostics({
      action: {
        type: "click",
        target: "#missing-login"
      },
      actionResult: {
        status: "failed",
        observation: "click failed",
        failureReason: "Unable to locate target in the current page or embedded frames: #missing-login"
      },
      verification: baseVerification(),
      language: "en"
    });

    expect(diagnostics?.failureCategory).toBe("locator_miss");
  });

  it("classifies no-effect actions after a successful click", () => {
    const diagnostics = buildExecutionDiagnostics({
      action: {
        type: "click",
        target: "#submit"
      },
      actionResult: {
        status: "success",
        observation: "click completed",
        targetUsed: "#submit",
        resolutionMethod: "dom_selector"
      },
      verification: {
        ...baseVerification(),
        checks: [{ expected: "登录成功", found: false }]
      },
      language: "zh-CN"
    });

    expect(diagnostics?.failureCategory).toBe("no_effect");
  });

  it("classifies api mismatches after the ui action succeeded", () => {
    const diagnostics = buildExecutionDiagnostics({
      action: {
        type: "click",
        target: "#login"
      },
      actionResult: {
        status: "success",
        observation: "click completed",
        targetUsed: "#login",
        resolutionMethod: "dom_selector"
      },
      verification: {
        ...baseVerification(),
        api: {
          status: "failed",
          requestCount: 1,
          matchedRequestCount: 0,
          failedRequestCount: 1,
          expectedRequestCount: 1,
          tokenSignals: 0,
          sessionSignals: 0,
          keyRequests: []
        }
      },
      language: "en"
    });

    expect(diagnostics?.failureCategory).toBe("api_mismatch");
  });

  it("attaches template replay diagnostics for matched replay steps", () => {
    const diagnostics = buildExecutionDiagnostics({
      action: {
        type: "click",
        target: "#login"
      },
      actionResult: {
        status: "success",
        observation: "click completed",
        targetUsed: "#login",
        resolutionMethod: "dom_selector"
      },
      verification: {
        ...baseVerification(),
        passed: true,
        api: {
          status: "passed",
          requestCount: 1,
          matchedRequestCount: 1,
          failedRequestCount: 0,
          expectedRequestCount: 1,
          tokenSignals: 0,
          sessionSignals: 0,
          keyRequests: []
        }
      },
      templateReplay: {
        templateId: "case-1",
        templateTitle: "Login template",
        templateType: "hybrid",
        stepIndex: 2,
        stepCount: 5
      },
      language: "en"
    });

    expect(diagnostics?.templateReplay).toEqual({
      templateId: "case-1",
      templateTitle: "Login template",
      templateType: "hybrid",
      stepIndex: 2,
      stepCount: 5,
      outcome: "matched"
    });
    expect(diagnostics?.templateRepairCandidate).toBeUndefined();
  });

  it("adds template repair guidance when replay steps drift", () => {
    const diagnostics = buildExecutionDiagnostics({
      action: {
        type: "click",
        target: "#missing-login"
      },
      actionResult: {
        status: "failed",
        observation: "click failed",
        failureReason: "Unable to locate target in the current page or embedded frames: #missing-login"
      },
      verification: baseVerification(),
      templateReplay: {
        templateId: "case-1",
        templateTitle: "Login template",
          templateType: "ui",
          stepIndex: 3,
          stepCount: 5
        },
        expectedChecks: ["密码登录"],
        expectedRequests: [
          {
            method: "POST",
            pathname: "/login"
          }
        ],
        language: "en"
      });

    expect(diagnostics?.templateReplay?.outcome).toBe("drifted");
    expect(diagnostics?.templateReplay?.repairSuggestion).toContain("stronger selector");
    expect(diagnostics?.templateRepairCandidate).toMatchObject({
      templateId: "case-1",
      templateStepIndex: 3,
      suggestedTarget: "#missing-login",
      suggestedExpectedChecks: ["密码登录"]
    });
    expect(diagnostics?.templateRepairCandidate?.confidence).toBeGreaterThan(0);
  });
});
