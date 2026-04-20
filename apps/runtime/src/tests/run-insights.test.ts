import { describe, expect, it } from "vitest";
import type { CaseTemplate, Run, Step } from "@qpilot/shared";
import {
  buildBenchmarkSummary,
  buildRunComparison,
  buildRunDiagnosis
} from "../analytics/run-insights.js";

const baseRun = (overrides: Partial<Run> = {}): Run => ({
  id: "run-1",
  projectId: "project-1",
  status: "failed",
  mode: "general",
  targetUrl: "https://example.com/login",
  goal: "Login and reach inbox",
  createdAt: "2026-04-17T00:00:00.000Z",
  currentPageUrl: "https://example.com/login",
  currentPageTitle: "Example Login",
  stepCount: 2,
  language: "en",
  ...overrides
});

const baseStep = (overrides: Partial<Step> = {}): Step => ({
  id: "step-1",
  runId: "run-1",
  index: 1,
  pageUrl: "https://example.com/login",
  pageTitle: "Example Login",
  domSummary: [],
  screenshotPath: "/artifacts/runs/run-1/step-0001.png",
  action: {
    type: "click",
    target: "#login"
  },
  actionStatus: "failed",
  observationSummary: "Login button did not continue the flow.",
  verificationResult: {
    urlChanged: false,
    checks: [],
    passed: false,
    outcome: "recoverable_failure",
    pageState: {
      surface: "login_form",
      hasModal: false,
      hasIframe: false,
      frameCount: 0,
      hasLoginForm: true,
      hasProviderChooser: false,
      hasSearchResults: false,
      matchedSignals: [],
      authErrorText: "Incorrect password"
    },
    execution: {
      failureCategory: "no_effect",
      failureReason: "The page showed an inline credential error."
    },
    api: {
      status: "failed",
      requestCount: 1,
      matchedRequestCount: 0,
      failedRequestCount: 1,
      expectedRequestCount: 1,
      tokenSignals: 0,
      sessionSignals: 0,
      note: "The login API returned 401.",
      keyRequests: [
        {
          method: "POST",
          url: "https://api.example.com/login",
          pathname: "/login",
          status: 401,
          phase: "response",
          ok: false
        }
      ]
    }
  },
  createdAt: "2026-04-17T00:00:10.000Z",
  ...overrides
});

describe("run insights", () => {
  it("builds a productized diagnosis from the latest relevant step", () => {
    const diagnosis = buildRunDiagnosis({
      run: baseRun({
        failureCategory: "runtime_error",
        failureSuggestion: "Compare with the last passing run before retrying."
      }),
      steps: [baseStep()]
    });

    expect(diagnosis.headline).toContain("Run stopped");
    expect(diagnosis.rootCause).toContain("Incorrect password");
    expect(diagnosis.stopReason).toContain("runtime error");
    expect(diagnosis.nextBestAction).toContain("last passing run");
    expect(diagnosis.keyRequest?.status).toBe(401);
    expect(diagnosis.heroScreenshotPath).toContain("step-0001");
  });

  it("detects divergence and outcome changes between runs", () => {
    const comparison = buildRunComparison({
      baseRun: baseRun({
        id: "run-base",
        status: "failed",
        failureCategory: "runtime_error"
      }),
      baseSteps: [baseStep()],
      candidateRun: baseRun({
        id: "run-candidate",
        status: "passed",
        currentPageUrl: "https://example.com/inbox",
        currentPageTitle: "Inbox",
        failureCategory: undefined,
        stepCount: 3
      }),
      candidateSteps: [
        baseStep({
          id: "step-candidate-1",
          runId: "run-candidate",
          actionStatus: "success",
          action: {
            type: "click",
            target: "#sign-in"
          },
          pageUrl: "https://example.com/login",
          verificationResult: {
            urlChanged: true,
            checks: [],
            passed: true,
            outcome: "progressed"
          }
        }),
        baseStep({
          id: "step-candidate-2",
          runId: "run-candidate",
          index: 2,
          actionStatus: "success",
          action: {
            type: "wait",
            ms: 1500
          },
          pageUrl: "https://example.com/inbox",
          pageTitle: "Inbox",
          verificationResult: {
            urlChanged: true,
            checks: [],
            passed: true,
            outcome: "terminal_success"
          }
        })
      ]
    });

    expect(comparison.statusChanged).toBe(true);
    expect(comparison.firstDivergenceStep).toBe(1);
    expect(comparison.changedSignals).toContain("status");
    expect(comparison.stepChanges[0]?.summary).toContain("Step 1 changed");
  });

  it("localizes diagnosis and comparison copy using the requested language override", () => {
    const diagnosis = buildRunDiagnosis({
      run: baseRun({
        language: "en",
        failureCategory: "runtime_error"
      }),
      steps: [baseStep()],
      language: "zh-CN"
    });
    const comparison = buildRunComparison({
      baseRun: baseRun({
        id: "run-base-zh",
        language: "en",
        status: "failed"
      }),
      baseSteps: [baseStep()],
      candidateRun: baseRun({
        id: "run-candidate-zh",
        language: "en",
        status: "passed",
        currentPageUrl: "https://example.com/inbox",
        currentPageTitle: "Inbox"
      }),
      candidateSteps: [baseStep({ id: "step-candidate-zh", runId: "run-candidate-zh", actionStatus: "success" })],
      language: "zh-CN"
    });

    expect(diagnosis.headline).toContain("运行停在了");
    expect(diagnosis.stopReason).toContain("runtime 抛出了执行错误");
    expect(comparison.headline).toContain("结果从 失败 变成了 已通过");
    expect(comparison.summary).toContain("候选运行修复了这条链路");
  });

  it("aggregates replay scenarios into a benchmark summary", () => {
    const caseTemplates: CaseTemplate[] = [
      {
        id: "case-1",
        projectId: "project-1",
        runId: "run-template-1",
        type: "ui",
        title: "Login case",
        goal: "Login and reach inbox",
        entryUrl: "https://example.com/login",
        status: "active",
        caseJson: "{}",
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:00:00.000Z"
      }
    ];
    const runs: Run[] = [
      baseRun({
        id: "run-replay-1",
        replayCaseId: "case-1",
        replayCaseTitle: "Login case",
        replayCaseType: "ui",
        status: "passed",
        stepCount: 4,
        createdAt: "2026-04-17T01:00:00.000Z"
      }),
      baseRun({
        id: "run-replay-2",
        replayCaseId: "case-1",
        replayCaseTitle: "Login case",
        replayCaseType: "ui",
        status: "failed",
        stepCount: 2,
        failureCategory: "runtime_error",
        createdAt: "2026-04-17T02:00:00.000Z"
      })
    ];

    const summary = buildBenchmarkSummary({
      projectId: "project-1",
      caseTemplates,
      runs
    });

    expect(summary.scenarioCount).toBe(1);
    expect(summary.coveredScenarioCount).toBe(1);
    expect(summary.replayRunCount).toBe(2);
    expect(summary.passRate).toBe(0.5);
    expect(summary.recentFailureCategories[0]).toEqual({
      category: "runtime_error",
      count: 1
    });
    expect(summary.scenarios[0]?.lastRunId).toBe("run-replay-2");
    expect(summary.scenarios[0]?.latestPassedRunId).toBe("run-replay-1");
    expect(summary.scenarios[0]?.latestFailedRunId).toBe("run-replay-2");
  });

  it("localizes benchmark diagnosis headlines using the requested language override", () => {
    const summary = buildBenchmarkSummary({
      projectId: "project-1",
      language: "zh-CN",
      caseTemplates: [
        {
          id: "case-zh",
          projectId: "project-1",
          runId: "run-template-zh",
          type: "ui",
          title: "Login case",
          goal: "Login and reach inbox",
          entryUrl: "https://example.com/login",
          status: "active",
          caseJson: "{}",
          createdAt: "2026-04-16T00:00:00.000Z",
          updatedAt: "2026-04-16T00:00:00.000Z"
        }
      ],
      runs: [
        baseRun({
          id: "run-replay-zh",
          language: "en",
          replayCaseId: "case-zh",
          replayCaseTitle: "Login case",
          replayCaseType: "ui",
          status: "passed",
          currentPageTitle: "Inbox"
        })
      ]
    });

    expect(summary.scenarios[0]?.lastDiagnosisHeadline).toContain("场景已在");
  });

  it("prioritizes uncovered and regressed scenarios ahead of already-green ones", () => {
    const summary = buildBenchmarkSummary({
      projectId: "project-1",
      caseTemplates: [
        {
          id: "case-uncovered",
          projectId: "project-1",
          runId: "run-template-1",
          type: "ui",
          title: "Uncovered smoke",
          goal: "Visit the dashboard",
          entryUrl: "https://example.com/dashboard",
          status: "active",
          caseJson: "{}",
          createdAt: "2026-04-16T00:00:00.000Z",
          updatedAt: "2026-04-16T00:00:00.000Z"
        },
        {
          id: "case-regressed",
          projectId: "project-1",
          runId: "run-template-2",
          type: "ui",
          title: "Regressed smoke",
          goal: "Login and open inbox",
          entryUrl: "https://example.com/login",
          status: "active",
          caseJson: "{}",
          createdAt: "2026-04-16T00:00:00.000Z",
          updatedAt: "2026-04-16T00:00:00.000Z"
        },
        {
          id: "case-green",
          projectId: "project-1",
          runId: "run-template-3",
          type: "ui",
          title: "Stable smoke",
          goal: "Open the healthy path",
          entryUrl: "https://example.com/healthy",
          status: "active",
          caseJson: "{}",
          createdAt: "2026-04-16T00:00:00.000Z",
          updatedAt: "2026-04-16T00:00:00.000Z"
        }
      ],
      runs: [
        baseRun({
          id: "run-regressed-pass",
          replayCaseId: "case-regressed",
          status: "passed",
          createdAt: "2026-04-17T01:00:00.000Z"
        }),
        baseRun({
          id: "run-regressed-fail",
          replayCaseId: "case-regressed",
          status: "failed",
          createdAt: "2026-04-17T02:00:00.000Z"
        }),
        baseRun({
          id: "run-green-pass",
          replayCaseId: "case-green",
          status: "passed",
          createdAt: "2026-04-17T03:00:00.000Z"
        })
      ]
    });

    expect(summary.scenarios.map((scenario) => scenario.caseId)).toEqual([
      "case-uncovered",
      "case-regressed",
      "case-green"
    ]);
  });
});
