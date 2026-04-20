import { describe, expect, it } from "vitest";
import type { LLMDecision } from "@qpilot/shared";
import { refineDecisionForAuthProvider } from "../orchestrator/decision-refiner.js";

const searchGoal =
  "\u641c\u7d22\u6d1b\u514b\u738b\u56fd\uff0c\u70b9\u51fb\u8fdb\u53bb\uff0c\u627e\u5230\u767b\u5f55\u5e76\u4e14\u7528qq\u767b\u5f55\uff0c\u8d26\u53f71111\uff0c\u5bc6\u780111111";

const baseRunConfig = {
  targetUrl: "https://baidu.com",
  mode: "general" as const,
  language: "zh-CN" as const,
  executionMode: "auto_batch" as const,
  confirmDraft: false,
  goal: searchGoal,
  maxSteps: 16,
  headed: true,
  manualTakeover: true,
  saveSession: true
};

const baseDecision: LLMDecision = {
  goal: "Open the page and continue with QQ login",
  page_assessment: {
    page_type: "game website",
    risk_level: "low",
    key_elements: ["login trigger"]
  },
  plan: {
    strategy: "Click the login trigger",
    reason: "Need to enter the login flow"
  },
  actions: [
    {
      type: "click",
      target: "#unloginArea",
      note: "Open the login flow"
    }
  ],
  expected_checks: ["QQ login"],
  test_case_candidate: {
    generate: true
  },
  is_finished: false
};

describe("refineDecisionForAuthProvider", () => {
  it("does not inject provider follow-up actions before the chooser is visible", () => {
    const refined = refineDecisionForAuthProvider({
      runConfig: {
        ...baseRunConfig,
        goal: "Search the game and continue with QQ login"
      },
      snapshot: {
        url: "https://rocom.qq.com/",
        title: "Game homepage",
        screenshotPath: "/tmp/s.png",
        elements: [
          {
            tag: "div",
            id: "unloginArea",
            selector: "#unloginArea",
            text: "Login",
            isVisible: true,
            isEnabled: true
          }
        ],
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

    expect(refined.actions.some((item) => item.target === "#modalIconqq")).toBe(false);
  });

  it("injects QQ provider follow-up actions once the chooser is already visible", () => {
    const refined = refineDecisionForAuthProvider({
      runConfig: {
        ...baseRunConfig,
        goal: "Search the game and continue with QQ login"
      },
      snapshot: {
        url: "https://rocom.qq.com/",
        title: "Game homepage",
        screenshotPath: "/tmp/s.png",
        elements: [
          {
            tag: "div",
            id: "unloginArea",
            selector: "#unloginArea",
            text: "Login",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "a",
            id: "modalIconqq",
            selector: "#modalIconqq",
            className: "modal-icon-qq",
            contextType: "modal",
            text: "QQ login",
            isVisible: true,
            isEnabled: true
          }
        ],
        pageState: {
          surface: "login_chooser",
          hasModal: true,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: true,
          hasSearchResults: false,
          matchedSignals: ["provider-entry", "modal-visible"]
        }
      },
      decision: baseDecision
    });

    expect(refined.actions.some((item) => item.target === "#modalIconqq")).toBe(true);
    expect(refined.expected_checks).toContain("\u8d26\u53f7");
  });

  it("rewrites wrong search query inputs on the search home page", () => {
    const refined = refineDecisionForAuthProvider({
      runConfig: baseRunConfig,
      snapshot: {
        url: "https://www.baidu.com/",
        title: "\u767e\u5ea6\u4e00\u4e0b\uff0c\u4f60\u5c31\u77e5\u9053",
        screenshotPath: "/tmp/s.png",
        elements: [
          {
            tag: "textarea",
            id: "chat-textarea",
            selector: "#chat-textarea",
            placeholder: "\u8bf7\u8f93\u5165\u5173\u952e\u8bcd",
            value: "\u817e\u8baf\u89c6\u9891",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "button",
            id: "chat-submit-button",
            selector: "#chat-submit-button",
            text: "\u767e\u5ea6\u4e00\u4e0b",
            isVisible: true,
            isEnabled: true
          }
        ],
        pageState: {
          surface: "generic",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: false,
          matchedSignals: ["search-ui"]
        }
      },
      decision: {
        ...baseDecision,
        actions: [
          {
            type: "input",
            target: "#chat-textarea",
            value: "\u817e\u8baf\u89c6\u9891",
            note: "\u5148\u8f93\u5165\u641c\u7d22\u5173\u952e\u8bcd"
          }
        ]
      }
    });

    expect(refined.actions).toHaveLength(3);
    expect(refined.actions[0]).toMatchObject({
      type: "input",
      target: "#chat-textarea",
      value: "\u6d1b\u514b\u738b\u56fd"
    });
    expect(refined.actions[1]).toMatchObject({
      type: "click",
      target: "#chat-submit-button"
    });
    expect(refined.expected_checks[0]).toBe("\u6d1b\u514b\u738b\u56fd");
  });

  it("preserves qq mail brand terms when rewriting search-home queries", () => {
    const refined = refineDecisionForAuthProvider({
      runConfig: {
        ...baseRunConfig,
        goal:
          "\u641c\u7d22qq\u90ae\u7bb1\uff0c\u70b9\u51fbqq\u90ae\u7bb1\uff0c\u8d26\u53f71430688313\uff0c\u5bc6\u7801zjy200826\u767b\u5f55\u8fdb\u53bb"
      },
      snapshot: {
        url: "https://www.baidu.com/",
        title: "\u767e\u5ea6\u4e00\u4e0b\uff0c\u4f60\u5c31\u77e5\u9053",
        screenshotPath: "/tmp/s.png",
        elements: [
          {
            tag: "textarea",
            id: "chat-textarea",
            selector: "#chat-textarea",
            placeholder: "\u8bf7\u8f93\u5165\u5173\u952e\u8bcd",
            value: "\u90ae\u7bb1",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "button",
            id: "chat-submit-button",
            selector: "#chat-submit-button",
            text: "\u767e\u5ea6\u4e00\u4e0b",
            isVisible: true,
            isEnabled: true
          }
        ],
        pageState: {
          surface: "generic",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: false,
          matchedSignals: ["search-ui"]
        }
      },
      decision: {
        ...baseDecision,
        actions: [
          {
            type: "input",
            target: "#chat-textarea",
            value: "\u90ae\u7bb1",
            note: "\u5148\u8f93\u5165\u641c\u7d22\u5173\u952e\u8bcd"
          }
        ]
      }
    });

    expect(refined.actions).toHaveLength(3);
    expect(refined.actions[0]).toMatchObject({
      type: "input",
      target: "#chat-textarea",
      value: "qq\u90ae\u7bb1"
    });
    expect(refined.actions[1]).toMatchObject({
      type: "click",
      target: "#chat-submit-button"
    });
    expect(refined.expected_checks[0]).toBe("qq\u90ae\u7bb1");
  });

  it("treats pre-submit suggestion overlays as search-home state and clicks submit instead of fake result links", () => {
    const refined = refineDecisionForAuthProvider({
      runConfig: baseRunConfig,
      snapshot: {
        url: "https://www.baidu.com/",
        title: "\u767e\u5ea6\u4e00\u4e0b\uff0c\u4f60\u5c31\u77e5\u9053",
        screenshotPath: "/tmp/s.png",
        elements: [
          {
            tag: "textarea",
            id: "chat-textarea",
            selector: "#chat-textarea",
            value: "\u6d1b\u514b\u738b\u56fd",
            ariaLabel: "Text area",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "button",
            id: "chat-submit-button",
            selector: "#chat-submit-button",
            text: "\u767e\u5ea6\u4e00\u4e0b",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "a",
            id: "result_logo",
            selector: "#result_logo",
            text: "Link",
            nearbyText:
              "\u767e\u5ea6\u4e00\u4e0b \u6d1b\u514b\u738b\u56fd \u4e16\u754c\u5b98\u7f51 \u6d1b\u514b\u738b\u56fd \u7f51\u9875\u7248\u767b\u5f55\u5165\u53e3",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "li",
            selector: "li.bdsug-item.bdsug-ai-upgrade",
            text: "\u6d1b\u514b\u738b\u56fd \u4e16\u754c\u5b98\u7f51",
            isVisible: true,
            isEnabled: true
          }
        ],
        pageState: {
          surface: "search_results",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: true,
          matchedSignals: ["search-host", "search-ui", "login-copy"]
        }
      },
      decision: {
        ...baseDecision,
        actions: [
          {
            type: "click",
            target: "#result_logo",
            note: "\u70b9\u51fb\u641c\u7d22\u7ed3\u679c"
          }
        ]
      }
    });

    expect(refined.actions).toHaveLength(2);
    expect(refined.actions[0]).toMatchObject({
      type: "click",
      target: "#chat-submit-button"
    });
    expect(refined.actions.some((item) => item.target === "#result_logo")).toBe(false);
  });

  it("re-submits the intended query when the current result page was searched with the wrong term", () => {
    const refined = refineDecisionForAuthProvider({
      runConfig: baseRunConfig,
      snapshot: {
        url: "https://www.baidu.com/s?wd=%E8%85%BE%E8%AE%AF%E8%A7%86%E9%A2%91%E5%AE%98%E7%BD%91",
        title: "\u817e\u8baf\u89c6\u9891\u5b98\u7f51_\u767e\u5ea6\u641c\u7d22",
        screenshotPath: "/tmp/s.png",
        elements: [
          {
            tag: "textarea",
            id: "kw",
            name: "wd",
            selector: "#kw",
            value: "\u817e\u8baf\u89c6\u9891\u5b98\u7f51",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "input",
            id: "su",
            selector: "#su",
            text: "\u767e\u5ea6\u4e00\u4e0b",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "a",
            selector: "a.sc-link._link_1iyz5_2",
            text: "\u817e\u8baf\u89c6\u9891-\u4e2d\u56fd\u9886\u5148\u7684\u5728\u7ebf\u89c6\u9891\u5a92\u4f53\u5e73\u53f0\uff0c\u6d77\u91cf\u9ad8\u6e05\u89c6\u9891\u5728\u7ebf\u89c2\u770b",
            nearbyText: "\u817e\u8baf\u89c6\u9891 \u5b98\u7f51",
            isVisible: true,
            isEnabled: true
          }
        ],
        pageState: {
          surface: "search_results",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: true,
          matchedSignals: ["search-results", "search-ui"]
        }
      },
      decision: {
        ...baseDecision,
        actions: [
          {
            type: "click",
            target: "a.sc-link._link_1iyz5_2",
            note: "\u6253\u5f00\u817e\u8baf\u89c6\u9891\u5b98\u7f51"
          }
        ]
      }
    });

    expect(refined.actions).toHaveLength(3);
    expect(refined.actions[0]).toMatchObject({
      type: "input",
      target: "#kw",
      value: "\u6d1b\u514b\u738b\u56fd"
    });
    expect(refined.actions[1]).toMatchObject({
      type: "click",
      target: "#su"
    });
    expect(refined.actions.some((item) => item.target === "a.sc-link._link_1iyz5_2")).toBe(false);
    expect(refined.expected_checks[0]).toBe("\u6d1b\u514b\u738b\u56fd");
  });

  it("rewrites source-search actions into an official-site result click on the intended results page", () => {
    const refined = refineDecisionForAuthProvider({
      runConfig: baseRunConfig,
      snapshot: {
        url: "https://www.baidu.com/s?wd=%E6%B4%9B%E5%85%8B%E7%8E%8B%E5%9B%BD",
        title: "\u6d1b\u514b\u738b\u56fd_\u767e\u5ea6\u641c\u7d22",
        screenshotPath: "/tmp/s.png",
        elements: [
          {
            tag: "textarea",
            id: "kw",
            name: "wd",
            selector: "#kw",
            value: "\u6d1b\u514b\u738b\u56fd",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "input",
            id: "su",
            selector: "#su",
            text: "\u767e\u5ea6\u4e00\u4e0b",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "a",
            selector: "a.cos-no-underline.c-invoke-class",
            text: "\u6d1b\u514b\u738b\u56fd\u5b98\u65b9\u7f51\u7ad9 - \u817e\u8baf\u6e38\u620f",
            nearbyText: "\u5b98\u7f51 \u56de\u5408\u5236\u7f51\u9875\u6e38\u620f",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "a",
            selector: "a.cos-no-underline.c-invoke-class",
            text: "\u6d1b\u514b\u738b\u56fd - \u767e\u5ea6\u767e\u79d1",
            nearbyText: "\u767e\u79d1 \u8bcd\u6761",
            isVisible: true,
            isEnabled: true
          }
        ],
        pageState: {
          surface: "search_results",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: true,
          matchedSignals: ["search-results", "search-ui"]
        }
      },
      decision: {
        ...baseDecision,
        actions: [
          {
            type: "click",
            target: "#s-top-loginbtn",
            note: "\u6253\u5f00\u767b\u5f55\u5165\u53e3"
          }
        ]
      }
    });

    expect(refined.actions).toHaveLength(2);
    expect(refined.actions[0]).toMatchObject({
      type: "click",
      target: "a:has-text('\u6d1b\u514b\u738b\u56fd\u5b98\u65b9\u7f51\u7ad9 - \u817e\u8baf\u6e38\u620f')"
    });
    expect(refined.actions[0]?.note).toContain(
      "\u6d1b\u514b\u738b\u56fd\u5b98\u65b9\u7f51\u7ad9 - \u817e\u8baf\u6e38\u620f"
    );
    expect(refined.expected_checks[0]).toBe("\u6d1b\u514b\u738b\u56fd");
    expect(refined.is_finished).toBe(false);
  });

  it("prefers QQ mail results over wrong-provider mail results", () => {
    const refined = refineDecisionForAuthProvider({
      runConfig: {
        ...baseRunConfig,
        goal:
          "\u641c\u7d22qq\u90ae\u7bb1\uff0c\u70b9\u51fbqq\u90ae\u7bb1\uff0c\u8d26\u53f71430688313\uff0c\u5bc6\u7801zjy200826\u767b\u5f55\u8fdb\u53bb"
      },
      snapshot: {
        url: "https://www.baidu.com/s?wd=qq%E9%82%AE%E7%AE%B1",
        title: "qq\u90ae\u7bb1_\u767e\u5ea6\u641c\u7d22",
        screenshotPath: "/tmp/s.png",
        elements: [
          {
            tag: "textarea",
            id: "kw",
            name: "wd",
            selector: "#kw",
            value: "qq\u90ae\u7bb1",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "input",
            id: "su",
            selector: "#su",
            text: "\u767e\u5ea6\u4e00\u4e0b",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "a",
            selector: "a.result-mail-189",
            text: "189\u90ae\u7bb1",
            nearbyText: "webmail30.189.cn \u4e2d\u56fd\u7535\u4fe1\u90ae\u7bb1",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "a",
            selector: "a.result-mail-qq",
            text: "\u767b\u5f55QQ\u90ae\u7bb1",
            nearbyText: "mail.qq.com \u817e\u8baf\u90ae\u7bb1\u5b98\u65b9\u5165\u53e3",
            isVisible: true,
            isEnabled: true
          }
        ],
        pageState: {
          surface: "search_results",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: true,
          matchedSignals: ["search-results", "search-ui"]
        }
      },
      decision: {
        ...baseDecision,
        actions: [
          {
            type: "click",
            target: "a.result-mail-189",
            note: "\u70b9\u51fb189\u90ae\u7bb1"
          }
        ]
      }
    });

    expect(refined.actions).toHaveLength(2);
    expect(refined.actions[0]).toMatchObject({
      type: "click",
      target: "a:has-text('\u767b\u5f55QQ\u90ae\u7bb1')"
    });
    expect(refined.actions[0]?.note).toContain("\u767b\u5f55QQ\u90ae\u7bb1");
  });

  it("prefers an actionable login entry over brand-only and content-style result links", () => {
    const refined = refineDecisionForAuthProvider({
      runConfig: {
        ...baseRunConfig,
        goal:
          "\u641c\u7d22qq\u90ae\u7bb1\uff0c\u70b9\u51fbqq\u90ae\u7bb1\uff0c\u8d26\u53f71430688313\uff0c\u5bc6\u7801zjy200826\u767b\u5f55\u8fdb\u53bb"
      },
      snapshot: {
        url: "https://www.baidu.com/s?wd=qq%E9%82%AE%E7%AE%B1",
        title: "qq\u90ae\u7bb1_\u767e\u5ea6\u641c\u7d22",
        screenshotPath: "/tmp/s.png",
        elements: [
          {
            tag: "a",
            selector: "a.cosc-source-a.cosc-source-link",
            className: "cosc-source-a cosc-source-link",
            text: "QQ\u90ae\u7bb1",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "a",
            selector: "a.sc-link._link_1iyz5_2",
            className: "sc-link _link_1iyz5_2 -v-color-primary block",
            text: "\u767b\u5f55QQ\u90ae\u7bb1",
            nearbyText: "mail.qq.com \u817e\u8baf\u90ae\u7bb1\u5b98\u65b9\u5165\u53e3",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "a",
            selector: "a.c-gap-top-xsmall.cos-font-medium",
            className: "c-gap-top-xsmall cos-font-medium item_3WKCf",
            text: "qq\u90ae\u7bb1\u662fqq\u53f7\u7801\u52a0\u4ec0\u4e48",
            nearbyText: "qq\u90ae\u7bb1\u767b\u5f55\u65b9\u5f0f",
            isVisible: true,
            isEnabled: true
          }
        ],
        pageState: {
          surface: "search_results",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: true,
          matchedSignals: ["search-results", "search-ui"]
        }
      },
      decision: {
        ...baseDecision,
        actions: [
          {
            type: "click",
            target: "a.cosc-source-a.cosc-source-link",
            note: "\u70b9\u51fbQQ\u90ae\u7bb1"
          }
        ]
      }
    });

    expect(refined.actions[0]).toMatchObject({
      type: "click",
      target: "a:has-text('\u767b\u5f55QQ\u90ae\u7bb1')"
    });
    expect(refined.actions[0]?.note).toContain("\u767b\u5f55QQ\u90ae\u7bb1");
  });

  it("prefers a likely direct official landing result over Baidu refinement links", () => {
    const refined = refineDecisionForAuthProvider({
      runConfig: baseRunConfig,
      snapshot: {
        url: "https://www.baidu.com/s?wd=%E6%B4%9B%E5%85%8B%E7%8E%8B%E5%9B%BD%E6%89%8B%E6%B8%B8%E5%AE%98%E7%BD%91%E5%85%A5%E5%8F%A3%E7%BD%91%E5%9D%80",
        title: "\u6d1b\u514b\u738b\u56fd\u624b\u6e38\u5b98\u7f51\u5165\u53e3\u7f51\u5740_\u767e\u5ea6\u641c\u7d22",
        screenshotPath: "/tmp/s.png",
        elements: [
          {
            tag: "a",
            selector: "a.cos-no-underline.c-invoke-class",
            className: "cos-no-underline c-invoke-class result-item_2RqwZ",
            text: "\u6d1b\u514b\u738b\u56fd\u624b\u6e38\u5b98\u7f51\u5165\u53e3\u7f51\u5740",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "a",
            selector: "a.cos-no-underline.c-invoke-class",
            className: "cos-no-underline c-invoke-class result-item_2RqwZ",
            text: "\u6d1b\u514b\u738b\u56fdwegame\u5b98\u7f51",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "a",
            text: "\u300a\u6d1b\u514b\u738b\u56fd:\u4e16\u754c\u300b\u73b0\u5df2\u4e0a\u7ebf!\u9047\u89c1\u7cbe\u7075,\u91cd\u8fd4\u7ae5\u5e74!\u540d\u4f01",
            nearbyText:
              "\u817e\u8baf\u9b54\u65b9\u5de5\u4f5c\u5ba4\u7fa4\u81ea\u7814,\u201c\u6d1b\u514b\u738b\u56fd\u201dIP\u7eed\u4f5c,\u96c6\u7cbe\u7075\u6536\u96c6\u5bf9\u6218\u4e0e\u5f00\u653e\u4e16\u754c\u4f53\u9a8c\u4e8e\u4e00\u4f53",
            isVisible: true,
            isEnabled: true
          }
        ],
        pageState: {
          surface: "search_results",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: true,
          matchedSignals: ["search-results", "search-ui"]
        }
      },
      decision: {
        ...baseDecision,
        actions: [
          {
            type: "click",
            target: "a.cos-no-underline.c-invoke-class",
            note: "\u70b9\u51fb\u5b98\u7f51\u5165\u53e3"
          }
        ]
      }
    });

    expect(refined.actions[0]).toMatchObject({
      type: "click",
      target:
        "a:has-text('\u300a\u6d1b\u514b\u738b\u56fd:\u4e16\u754c\u300b\u73b0\u5df2\u4e0a\u7ebf!\u9047\u89c1\u7cbe\u7075,\u91cd\u8fd4\u7ae5\u5e74!\u540d\u4f01')"
    });
    expect(refined.actions[0]?.note).toContain(
      "\u300a\u6d1b\u514b\u738b\u56fd:\u4e16\u754c\u300b\u73b0\u5df2\u4e0a\u7ebf"
    );
  });

  it("rewrites committed search-result pages even when pageState under-detects search_results", () => {
    const refined = refineDecisionForAuthProvider({
      runConfig: {
        ...baseRunConfig,
        goal:
          "\u641c\u7d22\u6d1b\u514b\u738b\u56fd\uff0c\u70b9\u51fb\u8fdb\u5165\uff0c\u627e\u5230\u767b\u5f55\u5e76\u4e14\u7528qq\u767b\u5f55\uff0c\u8d26\u53f71111\uff0c\u5bc6\u780111111"
      },
      snapshot: {
        url: "https://www.baidu.com/s?ie=utf-8&wd=%E6%B4%9B%E5%85%8B%E7%8E%8B%E5%9B%BD",
        title: "\u6d1b\u514b\u738b\u56fd_\u767e\u5ea6\u641c\u7d22",
        screenshotPath: "/tmp/s.png",
        elements: [
          {
            tag: "textarea",
            id: "chat-textarea",
            selector: "#chat-textarea",
            value: "\u6d1b\u514b\u738b\u56fd",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "a",
            selector: "a.tenon_pc_comp_tlink",
            text: "\u6d1b\u514b\u738b\u56fd\uff1a\u4e16\u754c",
            nearbyText:
              "\u300a\u6d1b\u514b\u738b\u56fd:\u4e16\u754c\u300b\u73b0\u5df2\u4e0a\u7ebf\uff01\u9047\u89c1\u7cbe\u7075\uff0c\u91cd\u8fd4\u7ae5\u5e74\uff01 \u5b98\u65b9 \u817e\u8baf\u9b54\u65b9\u5de5\u4f5c\u5ba4\u7fa4\u81ea\u7814\uff0c\u201c\u6d1b\u514b\u738b\u56fd\u201dIP\u7eed\u4f5c\uff0c\u96c6\u7cbe\u7075\u6536\u96c6\u5bf9\u6218\u4e0e\u5f00\u653e\u4e16\u754c\u4f53\u9a8c\u4e8e\u4e00\u4f53",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "a",
            selector: "a.cos-no-underline.c-invoke-class",
            className: "cos-no-underline c-invoke-class result-item_2RqwZ",
            text: "\u300a\u6d1b\u514b\u738b\u56fd:\u4e16\u754c\u300b\u5b98\u7f51",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "a",
            selector: "a.cos-no-underline.c-invoke-class",
            className: "cos-no-underline c-invoke-class result-item_2RqwZ",
            text: "\u6d1b\u514b\u738b\u56fd: \u4e16\u754cwiki",
            isVisible: true,
            isEnabled: true
          }
        ],
        pageState: {
          surface: "generic",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: false,
          matchedSignals: ["search-host", "search-ui"]
        }
      },
      decision: {
        ...baseDecision,
        goal:
          "\u641c\u7d22\u6d1b\u514b\u738b\u56fd\uff0c\u70b9\u51fb\u8fdb\u5165\uff0c\u627e\u5230\u767b\u5f55\u5e76\u4e14\u7528qq\u767b\u5f55\uff0c\u8d26\u53f71111\uff0c\u5bc6\u780111111",
        actions: [
          {
            type: "click",
            target: "a.cos-no-underline.c-invoke-class",
            note: "\u70b9\u51fb\u5b98\u7f51"
          }
        ]
      }
    });

    expect(refined.actions[0]).toMatchObject({
      type: "click",
      target: "a:has-text('\u6d1b\u514b\u738b\u56fd\uff1a\u4e16\u754c')"
    });
    expect(refined.actions[0]?.note).toContain("\u6d1b\u514b\u738b\u56fd\uff1a\u4e16\u754c");
    expect(refined.is_finished).toBe(false);
  });

  it("prefers the primary title link over a Baidu official-refinement link on live result cards", () => {
    const refined = refineDecisionForAuthProvider({
      runConfig: baseRunConfig,
      snapshot: {
        url: "https://www.baidu.com/s?wd=%E6%B4%9B%E5%85%8B%E7%8E%8B%E5%9B%BD",
        title: "\u6d1b\u514b\u738b\u56fd_\u767e\u5ea6\u641c\u7d22",
        screenshotPath: "/tmp/s.png",
        elements: [
          {
            tag: "a",
            selector: "a.tenon_pc_comp_tlink",
            text: "\u6d1b\u514b\u738b\u56fd\uff1a\u4e16\u754c",
            nearbyText:
              "\u300a\u6d1b\u514b\u738b\u56fd:\u4e16\u754c\u300b\u73b0\u5df2\u4e0a\u7ebf!\u9047\u89c1\u7cbe\u7075,\u91cd\u8fd4\u7ae5\u5e74! \u5b98\u65b9 \u817e\u8baf\u9b54\u65b9\u5de5\u4f5c\u5ba4\u7fa4\u81ea\u7814,\u201c\u6d1b\u514b\u738b\u56fd\u201dIP\u7eed\u4f5c,\u96c6\u7cbe\u7075\u6536\u96c6\u5bf9\u6218\u4e0e\u5f00\u653e\u4e16\u754c\u4f53\u9a8c\u4e8e\u4e00\u4f53",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "a",
            selector: "a.cos-no-underline.c-invoke-class",
            className: "cos-no-underline c-invoke-class result-item_2RqwZ",
            text: "\u300a\u6d1b\u514b\u738b\u56fd:\u4e16\u754c\u300b\u5b98\u7f51",
            ariaLabel: "Link",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "a",
            selector: "a.cos-no-underline.c-invoke-class",
            className: "cos-no-underline c-invoke-class result-item_2RqwZ",
            text: "\u6d1b\u514b\u738b\u56fd:\u4e16\u754cwiki",
            ariaLabel: "Link",
            isVisible: true,
            isEnabled: true
          }
        ],
        pageState: {
          surface: "search_results",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: true,
          matchedSignals: ["search-results", "search-ui"]
        }
      },
      decision: {
        ...baseDecision,
        actions: [
          {
            type: "click",
            target: "a.cos-no-underline.c-invoke-class",
            note: "\u70b9\u51fb\u5b98\u7f51"
          }
        ]
      }
    });

    expect(refined.actions[0]).toMatchObject({
      type: "click",
      target: "a:has-text('\u6d1b\u514b\u738b\u56fd\uff1a\u4e16\u754c')"
    });
    expect(refined.actions[0]?.note).toContain("\u6d1b\u514b\u738b\u56fd\uff1a\u4e16\u754c");
  });

  it("does not discard real result links just because ariaLabel is the generic Link label", () => {
    const refined = refineDecisionForAuthProvider({
      runConfig: {
        ...baseRunConfig,
        goal:
          "\u641c\u7d22\u6d1b\u514b\u738b\u56fd\uff0c\u70b9\u51fb\u8fdb\u5165\uff0c\u627e\u5230\u767b\u5f55\u5e76\u4e14\u7528qq\u767b\u5f55\uff0c\u8d26\u53f71111\uff0c\u5bc6\u780111111"
      },
      snapshot: {
        url: "https://www.baidu.com/s?wd=%E6%B4%9B%E5%85%8B%E7%8E%8B%E5%9B%BD",
        title: "\u6d1b\u514b\u738b\u56fd_\u767e\u5ea6\u641c\u7d22",
        screenshotPath: "/tmp/s.png",
        elements: [
          {
            tag: "textarea",
            id: "chat-textarea",
            selector: "#chat-textarea",
            value: "\u6d1b\u514b\u738b\u56fd",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "a",
            selector: "a.cos-no-underline.c-invoke-class",
            className: "cos-no-underline c-invoke-class result-item_2RqwZ",
            text: "\u300a\u6d1b\u514b\u738b\u56fd:\u4e16\u754c\u300b\u5b98\u7f51",
            ariaLabel: "Link",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "a",
            selector: "a.cos-no-underline.c-invoke-class",
            className: "cos-no-underline c-invoke-class result-item_2RqwZ",
            text: "\u6d1b\u514b\u738b\u56fd: \u4e16\u754cwiki",
            ariaLabel: "Link",
            isVisible: true,
            isEnabled: true
          }
        ],
        pageState: {
          surface: "search_results",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: true,
          matchedSignals: ["search-host", "search-results", "search-ui"]
        }
      },
      decision: {
        ...baseDecision,
        goal:
          "\u641c\u7d22\u6d1b\u514b\u738b\u56fd\uff0c\u70b9\u51fb\u8fdb\u5165\uff0c\u627e\u5230\u767b\u5f55\u5e76\u4e14\u7528qq\u767b\u5f55\uff0c\u8d26\u53f71111\uff0c\u5bc6\u780111111",
        actions: [
          {
            type: "click",
            target: "a.cos-no-underline.c-invoke-class",
            note: "\u70b9\u51fb\u5b98\u7f51"
          }
        ]
      }
    });

    expect(refined.actions[0]).toMatchObject({
      type: "click",
      target: "a:has-text('\u300a\u6d1b\u514b\u738b\u56fd:\u4e16\u754c\u300b\u5b98\u7f51')"
    });
  });

  it("returns to the source search page when the current site clearly conflicts with the goal", () => {
    const refined = refineDecisionForAuthProvider({
      runConfig: {
        ...baseRunConfig,
        goal:
          "\u641c\u7d22qq\u90ae\u7bb1\uff0c\u70b9\u51fbqq\u90ae\u7bb1\uff0c\u8d26\u53f71430688313\uff0c\u5bc6\u7801zjy200826\u767b\u5f55\u8fdb\u53bb"
      },
      snapshot: {
        url: "https://webmail30.189.cn/w2/",
        title: "189\u90ae\u7bb1",
        screenshotPath: "/tmp/s.png",
        elements: [
          {
            tag: "input",
            id: "userName",
            selector: "#userName",
            placeholder: "\u8bf7\u8f93\u5165189\u90ae\u7bb1\u8d26\u53f7",
            isVisible: true,
            isEnabled: true
          }
        ],
        pageState: {
          surface: "login_form",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: true,
          hasProviderChooser: false,
          hasSearchResults: false,
          matchedSignals: ["account-field"]
        }
      },
      decision: {
        ...baseDecision,
        actions: [
          {
            type: "click",
            target: "a:has-text('\u8fd4\u56de\u767e\u5ea6')",
            note: "\u8fd4\u56de\u641c\u7d22\u91cd\u65b0\u5bfb\u627eQQ\u90ae\u7bb1"
          }
        ]
      }
    });

    expect(refined.actions).toMatchObject([
      {
        type: "navigate",
        target: "https://baidu.com"
      },
      {
        type: "wait",
        ms: 1500
      }
    ]);
    expect(refined.actions[0]?.note).toContain("webmail30.189.cn");
    expect(refined.actions[0]?.note).toContain("qq\u90ae\u7bb1");
  });

  it("returns to the source search page when an actionable goal lands on a content answer page", () => {
    const refined = refineDecisionForAuthProvider({
      runConfig: {
        ...baseRunConfig,
        goal:
          "\u641c\u7d22qq\u90ae\u7bb1\uff0c\u70b9\u51fbqq\u90ae\u7bb1\uff0c\u8d26\u53f71430688313\uff0c\u5bc6\u7801zjy200826\u767b\u5f55\u8fdb\u53bb"
      },
      snapshot: {
        url: "https://wenwen.sogou.com/z/q735970201.htm",
        title: "qq\u90ae\u7bb1\u7684\u6b63\u786e\u4e66\u5199\u683c\u5f0f",
        screenshotPath: "/tmp/s.png",
        elements: [
          {
            tag: "span",
            id: "question_title_val",
            selector: "#question_title_val",
            text: "qq\u90ae\u7bb1\u7684\u6b63\u786e\u4e66\u5199\u683c\u5f0f",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "a",
            selector: "a.btn-aside-login.s_login",
            className: "btn-aside-login s_login",
            text: "QQ\u4e00\u952e\u767b\u5f55",
            nearbyText: "\u95ee\u9898\u5df2\u88ab\u89e3\u51b3",
            isVisible: true,
            isEnabled: true
          }
        ],
        pageState: {
          surface: "dashboard_like",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: true,
          hasSearchResults: false,
          matchedSignals: ["provider-entry", "login-copy", "post-login-copy"]
        }
      },
      decision: {
        ...baseDecision,
        actions: [
          {
            type: "click",
            target: "a.btn-aside-login.s_login",
            note: "\u70b9\u51fbQQ\u4e00\u952e\u767b\u5f55"
          }
        ]
      }
    });

    expect(refined.actions).toMatchObject([
      {
        type: "navigate",
        target: "https://baidu.com"
      },
      {
        type: "wait",
        ms: 1500
      }
    ]);
    expect(refined.actions[0]?.note).toContain("wenwen.sogou.com");
    expect(refined.actions[0]?.note).toContain("qq\u90ae\u7bb1");
  });

  it("uses wrong-target memory to avoid revisiting a disproven search result", () => {
    const refined = refineDecisionForAuthProvider({
      runConfig: {
        ...baseRunConfig,
        goal:
          "\u641c\u7d22qq\u90ae\u7bb1\uff0c\u70b9\u51fbqq\u90ae\u7bb1\uff0c\u8d26\u53f71430688313\uff0c\u5bc6\u7801zjy200826\u767b\u5f55\u8fdb\u53bb"
      },
      lastObservation:
        "goal_guard=wrong_target; avoid_host=webmail30.189.cn; avoid_label=189\u90ae\u7bb1",
      snapshot: {
        url: "https://www.baidu.com/s?wd=qq%E9%82%AE%E7%AE%B1",
        title: "qq\u90ae\u7bb1_\u767e\u5ea6\u641c\u7d22",
        screenshotPath: "/tmp/s.png",
        elements: [
          {
            tag: "textarea",
            id: "kw",
            name: "wd",
            selector: "#kw",
            value: "qq\u90ae\u7bb1",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "a",
            selector: "a.result-mail-189",
            text: "189\u90ae\u7bb1",
            nearbyText:
              "webmail30.189.cn \u4e2d\u56fd\u7535\u4fe1\u90ae\u7bb1 \u767b\u5f55 189\u90ae\u7bb1 \u5b98\u65b9\u5165\u53e3",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "a",
            selector: "a.result-mail-qq",
            text: "\u767b\u5f55QQ\u90ae\u7bb1",
            nearbyText: "mail.qq.com \u817e\u8baf\u90ae\u7bb1\u5b98\u65b9\u5165\u53e3",
            isVisible: true,
            isEnabled: true
          }
        ],
        pageState: {
          surface: "search_results",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: true,
          matchedSignals: ["search-results", "search-ui"]
        }
      },
      decision: {
        ...baseDecision,
        actions: [
          {
            type: "click",
            target: "a.result-mail-189",
            note: "\u70b9\u51fb189\u90ae\u7bb1"
          }
        ]
      }
    });

    expect(refined.actions).toHaveLength(2);
    expect(refined.actions[0]).toMatchObject({
      type: "click",
      target: "a:has-text('\u767b\u5f55QQ\u90ae\u7bb1')"
    });
    expect(refined.actions[0]?.note).toContain("\u767b\u5f55QQ\u90ae\u7bb1");
  });

  it("uses structured working memory to avoid revisiting a disproven search result", () => {
    const refined = refineDecisionForAuthProvider({
      runConfig: {
        ...baseRunConfig,
        goal:
          "\u641c\u7d22qq\u90ae\u7bb1\uff0c\u70b9\u51fbqq\u90ae\u7bb1\uff0c\u8d26\u53f71430688313\uff0c\u5bc6\u7801zjy200826\u767b\u5f55\u8fdb\u53bb"
      },
      workingMemory: {
        stage: "searching",
        alignment: "unknown",
        goalAnchors: ["qq\u90ae\u7bb1"],
        avoidHosts: ["webmail30.189.cn"],
        avoidLabels: ["189\u90ae\u7bb1"],
        avoidRepeatCredentialSubmission: false,
        successSignals: []
      },
      snapshot: {
        url: "https://www.baidu.com/s?wd=qq%E9%82%AE%E7%AE%B1",
        title: "qq\u90ae\u7bb1_\u767e\u5ea6\u641c\u7d22",
        screenshotPath: "/tmp/s.png",
        elements: [
          {
            tag: "textarea",
            id: "kw",
            name: "wd",
            selector: "#kw",
            value: "qq\u90ae\u7bb1",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "a",
            selector: "a.result-mail-189",
            text: "189\u90ae\u7bb1",
            nearbyText:
              "webmail30.189.cn \u4e2d\u56fd\u7535\u4fe1\u90ae\u7bb1 \u767b\u5f55 189\u90ae\u7bb1 \u5b98\u65b9\u5165\u53e3",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "a",
            selector: "a.result-mail-qq",
            text: "\u767b\u5f55QQ\u90ae\u7bb1",
            nearbyText: "mail.qq.com \u817e\u8baf\u90ae\u7bb1\u5b98\u65b9\u5165\u53e3",
            isVisible: true,
            isEnabled: true
          }
        ],
        pageState: {
          surface: "search_results",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: true,
          matchedSignals: ["search-results", "search-ui"]
        }
      },
      decision: {
        ...baseDecision,
        actions: [
          {
            type: "click",
            target: "a.result-mail-189",
            note: "\u70b9\u51fb189\u90ae\u7bb1"
          }
        ]
      }
    });

    expect(refined.actions[0]).toMatchObject({
      type: "click",
      target: "a:has-text('\u767b\u5f55QQ\u90ae\u7bb1')"
    });
  });

  it("uses structured wrong-target memory to return to search even when the current page text is low-signal", () => {
    const refined = refineDecisionForAuthProvider({
      runConfig: {
        ...baseRunConfig,
        goal:
          "\u641c\u7d22qq\u90ae\u7bb1\uff0c\u70b9\u51fbqq\u90ae\u7bb1\uff0c\u8d26\u53f71430688313\uff0c\u5bc6\u7801zjy200826\u767b\u5f55\u8fdb\u53bb"
      },
      workingMemory: {
        stage: "target_site",
        alignment: "wrong_target",
        transitionReason: "goal_mismatch",
        goalAnchors: ["qq\u90ae\u7bb1"],
        avoidHosts: ["webmail30.189.cn"],
        avoidLabels: ["189\u90ae\u7bb1"],
        avoidRepeatCredentialSubmission: false,
        successSignals: []
      },
      snapshot: {
        url: "https://webmail30.189.cn/w2/",
        title: "Loading",
        screenshotPath: "/tmp/s.png",
        elements: [
          {
            tag: "div",
            selector: "div.shell",
            text: "Loading...",
            isVisible: true,
            isEnabled: true
          }
        ],
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
      decision: {
        ...baseDecision,
        actions: [
          {
            type: "click",
            target: "div.shell",
            note: "\u7ee7\u7eed\u7b49\u5f85\u5f53\u524d\u9875"
          }
        ]
      }
    });

    expect(refined.actions).toMatchObject([
      {
        type: "navigate",
        target: "https://baidu.com"
      },
      {
        type: "wait",
        ms: 1500
      }
    ]);
    expect(refined.actions[0]?.note).toContain("webmail30.189.cn");
    expect(refined.actions[0]?.note).toContain("qq\u90ae\u7bb1");
  });

  it("rewrites QQ provider-auth password forms into direct credential submission", () => {
    const refined = refineDecisionForAuthProvider({
      runConfig: {
        ...baseRunConfig,
        username: "1111",
        password: "11111"
      },
      snapshot: {
        url: "https://graph.qq.com/oauth2.0/show?which=Login",
        title: "QQ\u767b\u5f55",
        screenshotPath: "/tmp/s.png",
        elements: [
          {
            tag: "input",
            id: "p",
            selector: "#p",
            type: "password",
            placeholder: "\u8bf7\u8f93\u5165\u5bc6\u7801",
            nearbyText: "\u5bc6\u7801",
            framePath: "frame-3",
            frameUrl: "https://xui.ptlogin2.qq.com/cgi-bin/xlogin",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "a",
            id: "accredit_site_link",
            selector: "#accredit_site_link",
            text: "\u817e\u8baf\u6e38\u620f",
            nearbyText:
              "\u5168\u9009 \u817e\u8baf\u6e38\u620f\u5c06\u83b7\u53d6\u4ee5\u4e0b\u6743\u9650 \u6388\u6743\u5373\u540c\u610f\u670d\u52a1\u534f\u8bae",
            framePath: "frame-2",
            frameUrl: "https://graph.qq.com/oauth2.0/show?which=Login",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "input",
            id: "u",
            selector: "#u",
            placeholder: "\u652f\u6301QQ\u53f7/\u90ae\u7bb1/\u624b\u673a\u53f7\u767b\u5f55",
            nearbyText: "\u8d26\u53f7",
            framePath: "frame-3",
            frameUrl: "https://xui.ptlogin2.qq.com/cgi-bin/xlogin",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "input",
            id: "login_button",
            selector: "#login_button",
            type: "submit",
            value: "\u767b\u5f55",
            framePath: "frame-3",
            frameUrl: "https://xui.ptlogin2.qq.com/cgi-bin/xlogin",
            isVisible: true,
            isEnabled: true
          }
        ],
        pageState: {
          surface: "provider_auth",
          hasModal: false,
          hasIframe: true,
          frameCount: 1,
          hasLoginForm: true,
          hasProviderChooser: false,
          hasSearchResults: false,
          matchedSignals: ["provider-auth-frame", "account-field", "password-field"]
        }
      },
      decision: {
        ...baseDecision,
        actions: [
          {
            type: "wait",
            ms: 800,
            note: "\u7b49\u5f85QQ\u5bc6\u7801\u8868\u5355\u7a33\u5b9a"
          },
          {
            type: "click",
            target: "#ptlogin_iframe",
            note: "\u5148\u70b9\u51fbQQ\u767b\u5f55 iframe"
          }
        ]
      }
    });

    expect(refined.actions).toMatchObject([
      {
        type: "input",
        target: "#u",
        value: "1111"
      },
      {
        type: "input",
        target: "#p",
        value: "11111"
      },
      {
        type: "click",
        target: "#login_button"
      },
      {
        type: "wait",
        ms: 1200
      }
    ]);
    expect(refined.actions.some((item) => item.target === "#ptlogin_iframe")).toBe(false);
  });

  it("does not force QQ credential submission before the password form is visible", () => {
    const refined = refineDecisionForAuthProvider({
      runConfig: {
        ...baseRunConfig,
        username: "1111",
        password: "11111"
      },
      snapshot: {
        url: "https://graph.qq.com/oauth2.0/show?which=Login",
        title: "QQ\u767b\u5f55",
        screenshotPath: "/tmp/s.png",
        elements: [
          {
            tag: "iframe",
            id: "ptlogin_iframe",
            selector: "#ptlogin_iframe",
            title: "QQ\u767b\u5f55",
            isVisible: true,
            isEnabled: true
          }
        ],
        pageState: {
          surface: "provider_auth",
          hasModal: false,
          hasIframe: true,
          frameCount: 1,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: false,
          matchedSignals: ["provider-auth-frame"]
        }
      },
      decision: {
        ...baseDecision,
        actions: [
          {
            type: "wait",
            ms: 800,
            note: "\u7b49\u5f85QQ\u6388\u6743\u9875"
          }
        ]
      }
    });

    expect(refined.actions).toMatchObject([
      {
        type: "wait",
        ms: 800
      }
    ]);
  });

  it("waits instead of repeating credential submission during a security challenge", () => {
    const refined = refineDecisionForAuthProvider({
      runConfig: {
        ...baseRunConfig,
        username: "1111",
        password: "11111"
      },
      snapshot: {
        url: "https://xui.ptlogin2.qq.com/cgi-bin/xlogin",
        title: "QQ\u767b\u5f55",
        screenshotPath: "/tmp/s.png",
        elements: [
          {
            tag: "input",
            id: "u",
            selector: "#u",
            placeholder: "\u652f\u6301QQ\u53f7/\u90ae\u7bb1/\u624b\u673a\u53f7\u767b\u5f55",
            nearbyText: "\u8d26\u53f7",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "input",
            id: "p",
            selector: "#p",
            type: "password",
            placeholder: "\u8bf7\u8f93\u5165\u5bc6\u7801",
            nearbyText: "\u5bc6\u7801",
            isVisible: true,
            isEnabled: true
          },
          {
            tag: "input",
            id: "login_button",
            selector: "#login_button",
            type: "submit",
            value: "\u767b\u5f55",
            isVisible: true,
            isEnabled: true
          }
        ],
        pageState: {
          surface: "security_challenge",
          hasModal: false,
          hasIframe: true,
          frameCount: 1,
          hasLoginForm: true,
          hasProviderChooser: false,
          hasSearchResults: false,
          matchedSignals: ["security-challenge", "provider-auth-frame"]
        }
      },
      decision: {
        ...baseDecision,
        actions: [
          {
            type: "click",
            target: "#login_button",
            note: "\u7ee7\u7eed\u70b9\u51fb\u767b\u5f55"
          }
        ]
      }
    });

    expect(refined.actions).toMatchObject([
      {
        type: "wait",
        ms: 1500
      }
    ]);
    expect(refined.actions).toHaveLength(1);
  });
});
