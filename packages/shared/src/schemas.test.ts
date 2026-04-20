import { describe, expect, it } from "vitest";
import {
  CaseTemplateRepairDraftSchema,
  ExecutionDiagnosticsSchema,
  LLMDecisionSchema,
  RunConfigSchema
} from "./schemas.js";

describe("LLMDecisionSchema", () => {
  it("accepts valid decision", () => {
    const decision = LLMDecisionSchema.parse({
      goal: "test",
      page_assessment: {
        page_type: "login",
        risk_level: "high",
        key_elements: ["input", "button"]
      },
      plan: {
        strategy: "abnormal-first",
        reason: "cover validations first"
      },
      actions: [{ type: "wait", ms: 1000 }],
      expected_checks: ["required"],
      test_case_candidate: {
        generate: true,
        title: "empty login",
        module: "auth"
      },
      is_finished: false
    });
    expect(decision.actions[0]?.type).toBe("wait");
  });

  it("rejects invalid action type", () => {
    expect(() =>
      LLMDecisionSchema.parse({
        goal: "test",
        page_assessment: {
          page_type: "login",
          risk_level: "high",
          key_elements: ["input", "button"]
        },
        plan: {
          strategy: "abnormal-first",
          reason: "cover validations first"
        },
        actions: [{ type: "scroll" }],
        expected_checks: [],
        test_case_candidate: {
          generate: false
        },
        is_finished: true
      })
    ).toThrow();
  });

  it("accepts headed runs with manual takeover and session reuse config", () => {
    const config = RunConfigSchema.parse({
      targetUrl: "https://example.com",
      mode: "general",
      language: "zh-CN",
      goal: "Observe the page",
      maxSteps: 8,
      headed: true,
      manualTakeover: true,
      sessionProfile: "default-login",
      saveSession: true
    });

    expect(config.headed).toBe(true);
    expect(config.language).toBe("zh-CN");
    expect(config.manualTakeover).toBe(true);
    expect(config.sessionProfile).toBe("default-login");
    expect(config.saveSession).toBe(true);
  });

  it("accepts replay case config with expected requests", () => {
    const config = RunConfigSchema.parse({
      targetUrl: "https://example.com",
      mode: "general",
      executionMode: "stepwise_replan",
      confirmDraft: true,
      goal: "Replay a login case",
      maxSteps: 4,
      replayCase: {
        templateId: "case-1",
        title: "Login replay",
        type: "hybrid",
        steps: [
          {
            index: 1,
            action: {
              type: "click",
              target: "[data-testid='login']"
            },
            expectedChecks: ["dashboard"],
            expectedRequests: [
              {
                method: "POST",
                pathname: "/api/login",
                status: 200
              }
            ]
          }
        ]
      }
    });

    expect(config.replayCase?.steps[0]?.expectedRequests[0]?.pathname).toBe("/api/login");
  });

  it("accepts template repair candidates in execution diagnostics", () => {
    const diagnostics = ExecutionDiagnosticsSchema.parse({
      failureCategory: "locator_miss",
      templateReplay: {
        templateId: "case-1",
        templateTitle: "Login replay",
        templateType: "ui",
        stepIndex: 2,
        stepCount: 4,
        outcome: "drifted"
      },
      templateRepairCandidate: {
        templateId: "case-1",
        templateTitle: "Login replay",
        templateType: "ui",
        templateStepIndex: 2,
        templateStepCount: 4,
        confidence: 0.64,
        action: {
          type: "click",
          target: "#switcher_plogin"
        },
        suggestedTarget: "#switcher_plogin",
        suggestedExpectedChecks: ["密码登录"],
        suggestedExpectedRequests: [
          {
            method: "POST",
            pathname: "/login"
          }
        ]
      }
    });

    expect(diagnostics.templateRepairCandidate?.confidence).toBe(0.64);
    expect(diagnostics.templateRepairCandidate?.suggestedExpectedRequests[0]?.pathname).toBe("/login");
  });

  it("accepts case template repair draft payloads", () => {
    const draft = CaseTemplateRepairDraftSchema.parse({
      caseId: "case-1",
      caseTitle: "Login replay",
      templateType: "hybrid",
      runId: "run-1",
      generatedAt: "2026-04-16T00:00:00.000Z",
      changeCount: 1,
      changes: [
        {
          templateStepIndex: 2,
          sourceRunId: "run-1",
          sourceStepId: "step-2",
          confidence: 0.72,
          previousAction: {
            type: "click",
            target: "#login"
          },
          nextAction: {
            type: "click",
            target: "#switcher_plogin"
          },
          previousExpectedChecks: ["登录"],
          nextExpectedChecks: ["密码登录"]
        }
      ],
      nextCaseJson: "{\"steps\":[]}"
    });

    expect(draft.changes[0]?.nextAction.target).toBe("#switcher_plogin");
  });
});
