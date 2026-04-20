import { describe, expect, it } from "vitest";
import { buildCaseTemplateRepairDraft } from "../cases/template-repair-draft.js";
import type { CaseTemplateRow, StepRow } from "../utils/mappers.js";

const buildCaseTemplateRow = (patch?: Partial<CaseTemplateRow>): CaseTemplateRow => ({
  id: "case-1",
  projectId: "project-1",
  runId: "source-run",
  type: "hybrid",
  title: "Login template",
  goal: "Login with password",
  entryUrl: "https://example.com/login",
  status: "active",
  summary: "summary",
  caseJson: JSON.stringify({
    steps: [
      {
        index: 1,
        action: {
          type: "click",
          target: "#login"
        },
        expectedChecks: ["打开登录弹窗"],
        expectedRequests: [
          {
            method: "POST",
            pathname: "/login/init"
          }
        ]
      },
      {
        index: 2,
        action: {
          type: "click",
          target: "#switcher_qr"
        },
        expectedChecks: ["扫码登录"]
      }
    ]
  }),
  createdAt: 1,
  updatedAt: 1,
  ...patch
});

const buildStepRow = (patch?: Partial<StepRow>): StepRow => ({
  id: "step-2",
  runId: "run-1",
  stepIndex: 2,
  pageUrl: "https://example.com/login",
  pageTitle: "Login",
  domSummaryJson: "[]",
  screenshotPath: "/tmp/step-2.png",
  actionJson: JSON.stringify({
    type: "click",
    target: "#switcher_qr"
  }),
  actionStatus: "failed",
  observationSummary: "template drifted",
  verificationJson: JSON.stringify({
    urlChanged: false,
    checks: [],
    passed: false,
    execution: {
      failureCategory: "locator_miss",
      templateReplay: {
        templateId: "case-1",
        templateTitle: "Login template",
        templateType: "hybrid",
        stepIndex: 2,
        stepCount: 2,
        outcome: "drifted"
      },
      templateRepairCandidate: {
        templateId: "case-1",
        templateTitle: "Login template",
        templateType: "hybrid",
        templateStepIndex: 2,
        templateStepCount: 2,
        confidence: 0.74,
        action: {
          type: "click",
          target: "#switcher_plogin"
        },
        suggestedTarget: "#switcher_plogin",
        suggestedExpectedChecks: ["密码登录"],
        suggestedExpectedRequests: [
          {
            method: "POST",
            pathname: "/login/password"
          }
        ],
        reason: "locator drifted",
        repairHint: "refresh selector"
      }
    }
  }),
  createdAt: 2,
  ...patch
});

describe("buildCaseTemplateRepairDraft", () => {
  it("builds a patch draft from the best repair candidate", () => {
    const draft = buildCaseTemplateRepairDraft({
      caseTemplate: buildCaseTemplateRow(),
      runId: "run-1",
      stepRows: [buildStepRow()]
    });

    expect(draft?.changeCount).toBe(1);
    expect(draft?.changes[0]?.templateStepIndex).toBe(2);
    expect(draft?.changes[0]?.nextAction.target).toBe("#switcher_plogin");

    const nextCase = JSON.parse(draft?.nextCaseJson ?? "{}") as {
      steps?: Array<{ action?: { target?: string }; expectedChecks?: string[]; expectedRequests?: Array<{ pathname?: string }> }>;
    };
    expect(nextCase.steps?.[1]?.action?.target).toBe("#switcher_plogin");
    expect(nextCase.steps?.[1]?.expectedChecks).toEqual(["密码登录"]);
    expect(nextCase.steps?.[1]?.expectedRequests?.[0]?.pathname).toBe("/login/password");
  });

  it("returns null when no repair candidates match the template", () => {
    const draft = buildCaseTemplateRepairDraft({
      caseTemplate: buildCaseTemplateRow({ id: "case-2" }),
      runId: "run-1",
      stepRows: [buildStepRow()]
    });

    expect(draft).toBeNull();
  });
});
