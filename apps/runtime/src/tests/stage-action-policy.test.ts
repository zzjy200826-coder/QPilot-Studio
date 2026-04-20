import { describe, expect, it } from "vitest";
import type { LLMDecision } from "@qpilot/shared";
import { applyStageActionPolicy } from "../orchestrator/stage-action-policy.js";

const baseDecision: LLMDecision = {
  goal: "Open QQ mail and continue login",
  page_assessment: {
    page_type: "generic",
    risk_level: "low",
    key_elements: ["login"]
  },
  plan: {
    strategy: "Continue login",
    reason: "Need to complete the flow"
  },
  actions: [
    {
      type: "click",
      target: "#login_button",
      note: "continue login"
    }
  ],
  expected_checks: ["QQ邮箱"],
  test_case_candidate: {
    generate: false
  },
  is_finished: false
};

const baseRunConfig = {
  targetUrl: "https://mail.qq.com/",
  mode: "general" as const,
  language: "zh-CN" as const,
  executionMode: "auto_batch" as const,
  confirmDraft: false,
  goal: "打开QQ邮箱并登录",
  maxSteps: 8,
  headed: false,
  manualTakeover: false,
  saveSession: false
};

describe("stage action policy", () => {
  it("replaces credential actions with wait on a security challenge surface", () => {
    const decision = applyStageActionPolicy({
      runConfig: baseRunConfig,
      snapshot: {
        url: "https://xui.ptlogin2.qq.com/cgi-bin/xlogin",
        title: "QQ登录",
        screenshotPath: "/tmp/s.png",
        elements: [],
        pageState: {
          surface: "security_challenge",
          hasModal: false,
          hasIframe: true,
          frameCount: 1,
          hasLoginForm: true,
          hasProviderChooser: false,
          hasSearchResults: false,
          matchedSignals: ["security-challenge"]
        }
      },
      decision: baseDecision
    });

    expect(decision.actions).toMatchObject([
      {
        type: "wait",
        ms: 1500
      }
    ]);
    expect(decision.is_finished).toBe(false);
  });

  it("navigates back to the target entry when memory says the current site is wrong", () => {
    const decision = applyStageActionPolicy({
      runConfig: baseRunConfig,
      workingMemory: {
        stage: "target_site",
        alignment: "wrong_target",
        transitionReason: "goal_mismatch",
        goalAnchors: ["qq邮箱"],
        avoidHosts: ["webmail30.189.cn"],
        avoidLabels: ["189邮箱"],
        avoidRepeatCredentialSubmission: false,
        successSignals: []
      },
      snapshot: {
        url: "https://webmail30.189.cn/w2/",
        title: "Loading",
        screenshotPath: "/tmp/s.png",
        elements: [],
        pageState: {
          surface: "generic",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: false,
          matchedSignals: []
        }
      },
      decision: baseDecision
    });

    expect(decision.actions).toMatchObject([
      {
        type: "navigate",
        target: "https://mail.qq.com/"
      },
      {
        type: "wait",
        ms: 1500
      }
    ]);
    expect(decision.actions[0]?.note).toContain("webmail30.189.cn");
  });

  it("finishes directly on an aligned authenticated app surface instead of repeating login actions", () => {
    const decision = applyStageActionPolicy({
      runConfig: {
        ...baseRunConfig,
        goal: "打开QQ邮箱，如果已经进入登录后的应用界面则直接判定成功"
      },
      snapshot: {
        url: "https://wx.mail.qq.com/home/index?sid=abc#/list/1/1",
        title: "QQ邮箱",
        screenshotPath: "/tmp/s.png",
        elements: [
          {
            tag: "div",
            text: "收件箱",
            selector: "div.inbox"
          },
          {
            tag: "div",
            text: "写信",
            selector: "div.compose"
          }
        ],
        pageState: {
          surface: "dashboard_like",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: false,
          matchedSignals: ["post-login-copy"]
        }
      },
      decision: baseDecision
    });

    expect(decision.actions).toEqual([]);
    expect(decision.is_finished).toBe(true);
    expect(decision.plan.reason).toContain("成功态");
  });
});
