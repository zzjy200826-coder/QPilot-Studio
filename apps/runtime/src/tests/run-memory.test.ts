import { describe, expect, it } from "vitest";
import {
  buildRunWorkingMemory,
  deriveRunStage,
  deriveStepOutcome,
  summarizeRunWorkingMemory
} from "../orchestrator/run-memory.js";

describe("run memory", () => {
  it("derives searching stage from search result pages", () => {
    const stage = deriveRunStage({
      goal: "\u641c\u7d22qq\u90ae\u7bb1\u5e76\u767b\u5f55",
      snapshot: {
        url: "https://www.baidu.com/s?wd=qq%E9%82%AE%E7%AE%B1",
        title: "qq\u90ae\u7bb1_\u767e\u5ea6\u641c\u7d22",
        screenshotPath: "/tmp/search.png",
        elements: [],
        pageState: {
          surface: "search_results",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: true,
          matchedSignals: ["search-ui"]
        }
      }
    });

    expect(stage).toBe("searching");
  });

  it("builds authenticated-app working memory and merges wrong-target memory", () => {
    const memory = buildRunWorkingMemory({
      goal: "\u6253\u5f00QQ\u90ae\u7bb1\uff0c\u5982\u679c\u5df2\u7ecf\u8fdb\u5165\u6536\u4ef6\u7bb1\u5219\u76f4\u63a5\u5224\u5b9a\u6210\u529f",
      snapshot: {
        url: "https://wx.mail.qq.com/home/index?sid=abc#/list/1/1",
        title: "QQ\u90ae\u7bb1",
        screenshotPath: "/tmp/app.png",
        elements: [
          { tag: "div", text: "\u6536\u4ef6\u7bb1", selector: "div.inbox" },
          { tag: "div", text: "\u5199\u4fe1", selector: "div.compose" },
          { tag: "div", text: "\u8bbe\u7f6e", selector: "div.settings" }
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
      goalGuardObservation:
        "goal_guard=wrong_target; avoid_host=webmail30.189.cn; avoid_label=189\u90ae\u7bb1",
      outcome: "progressed"
    });

    expect(memory.stage).toBe("authenticated_app");
    expect(memory.alignment).toBe("aligned");
    expect(memory.transitionReason).toBe("authenticated_app");
    expect(memory.goalAnchors).toContain("qq\u90ae\u7bb1");
    expect(memory.avoidHosts).toContain("webmail30.189.cn");
    expect(memory.avoidLabels).toContain("189\u90ae\u7bb1");
    expect(memory.successSignals).toContain("dashboard_like");
    expect(summarizeRunWorkingMemory(memory)).toContain("memory_stage=authenticated_app");
    expect(summarizeRunWorkingMemory(memory)).toContain("memory_align=aligned");
    expect(summarizeRunWorkingMemory(memory)).toContain("memory_reason=authenticated_app");
  });

  it("classifies blocking and recoverable step outcomes", () => {
    expect(
      deriveStepOutcome({
        verification: {
          urlChanged: false,
          checks: [],
          passed: false,
          pageState: {
            surface: "security_challenge",
            hasModal: false,
            hasIframe: true,
            frameCount: 1,
            hasLoginForm: true,
            hasProviderChooser: false,
            hasSearchResults: false,
            matchedSignals: ["security-copy"]
          }
        },
        haltReason: "\u9700\u8981\u4eba\u5de5\u9a8c\u8bc1",
        actionStatus: "success"
      })
    ).toBe("blocking_failure");

    expect(
      deriveStepOutcome({
        verification: {
          urlChanged: false,
          checks: [],
          passed: false,
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
        actionStatus: "failed"
      })
    ).toBe("recoverable_failure");
  });
});
