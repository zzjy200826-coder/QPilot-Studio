import { describe, expect, it } from "vitest";
import {
  detectCredentialValidationFailure,
  detectRepeatedIneffectiveAttempts,
  shouldClearFlowFailuresAfterSuccess,
  shouldReplanAfterRecoverableStep
} from "../orchestrator/general-flow-guard.js";

describe("general flow guard", () => {
  it("requests replanning after a recoverable no-effect click", () => {
    expect(
      shouldReplanAfterRecoverableStep({
        action: {
          type: "click",
          target: "#navLoginBox"
        },
        pageUrl: "https://rocom.qq.com/",
        failureCategory: "no_effect"
      })
    ).toBe(true);
  });

  it("does not request replanning after an input no-effect step that still has a planned follow-up", () => {
    expect(
      shouldReplanAfterRecoverableStep({
        action: {
          type: "input",
          target: "#chat-textarea",
          value: "\u6d1b\u514b\u738b\u56fd"
        },
        pageUrl: "https://www.baidu.com/",
        failureCategory: "no_effect",
        hasPlannedFollowUp: true
      })
    ).toBe(false);
  });

  it("does not request replanning when the page already shows a credential validation error", () => {
    expect(
      shouldReplanAfterRecoverableStep({
        action: {
          type: "click",
          target: "#login_button"
        },
        pageUrl: "https://xui.ptlogin2.qq.com/cgi-bin/xlogin",
        pageState: {
          surface: "provider_auth",
          hasModal: false,
          hasIframe: true,
          frameCount: 1,
          hasLoginForm: true,
          hasProviderChooser: false,
          hasSearchResults: false,
          matchedSignals: ["auth-validation-error"],
          authErrorText: "\u8bf7\u8f93\u5165\u6b63\u786e\u7684\u8d26\u53f7\uff01"
        },
        failureCategory: "no_effect"
      })
    ).toBe(false);

    expect(
      detectCredentialValidationFailure({
        action: {
          type: "click",
          target: "#login_button"
        },
        pageState: {
          surface: "provider_auth",
          hasModal: false,
          hasIframe: true,
          frameCount: 1,
          hasLoginForm: true,
          hasProviderChooser: false,
          hasSearchResults: false,
          matchedSignals: ["auth-validation-error"],
          authErrorText: "\u8bf7\u8f93\u5165\u6b63\u786e\u7684\u8d26\u53f7\uff01"
        }
      })
    ).toContain("\u8bf7\u8f93\u5165\u6b63\u786e\u7684\u8d26\u53f7");
  });

  it("detects a repeated ineffective streak on the same surface", () => {
    const guard = detectRepeatedIneffectiveAttempts([
      {
        action: { type: "click", target: "#navLoginBox" },
        pageUrl: "https://rocom.qq.com/",
        pageState: {
          surface: "generic",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: false,
          matchedSignals: []
        },
        failureCategory: "no_effect"
      },
      {
        action: { type: "wait", ms: 1200 },
        pageUrl: "https://rocom.qq.com/",
        pageState: {
          surface: "generic",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: false,
          matchedSignals: []
        },
        failureCategory: "no_effect"
      },
      {
        action: { type: "click", target: "#navLoginBox" },
        pageUrl: "https://rocom.qq.com/",
        pageState: {
          surface: "generic",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: false,
          matchedSignals: []
        },
        failureCategory: "no_effect"
      }
    ]);

    expect(guard).toEqual({
      streakLength: 3,
      host: "rocom.qq.com",
      surface: "generic"
    });
  });

  it("does not trigger the streak guard when the host changes", () => {
    const guard = detectRepeatedIneffectiveAttempts([
      {
        action: { type: "click", target: "#submit" },
        pageUrl: "https://www.baidu.com/",
        failureCategory: "api_mismatch"
      },
      {
        action: { type: "wait", ms: 1000 },
        pageUrl: "https://rocom.qq.com/",
        failureCategory: "no_effect"
      },
      {
        action: { type: "click", target: "#navLoginBox" },
        pageUrl: "https://rocom.qq.com/",
        failureCategory: "no_effect"
      }
    ]);

    expect(guard).toBeNull();
  });

  it("does not trigger the streak guard when the flow is still progressing across different URLs", () => {
    const guard = detectRepeatedIneffectiveAttempts([
      {
        action: {
          type: "input",
          target: "#chat-textarea",
          value: "\u6d1b\u514b\u738b\u56fd"
        },
        pageUrl: "https://www.baidu.com/",
        pageState: {
          surface: "search_results",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: true,
          matchedSignals: ["search-ui"]
        },
        failureCategory: "no_effect",
        hasPlannedFollowUp: true
      },
      {
        action: { type: "click", target: "#chat-submit-button" },
        pageUrl: "https://www.baidu.com/s?wd=%E6%B4%9B%E5%85%8B%E7%8E%8B%E5%9B%BD",
        pageState: {
          surface: "search_results",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: true,
          matchedSignals: ["search-query"]
        },
        failureCategory: "api_mismatch"
      },
      {
        action: { type: "click", target: "a.cos-no-underline.c-invoke-class" },
        pageUrl: "https://www.baidu.com/s?wd=%E3%80%8A%E6%B4%9B%E5%85%8B%E7%8E%8B%E5%9B%BD%3A%E4%B8%96%E7%95%8C%E3%80%8B%E5%AE%98%E7%BD%91",
        pageState: {
          surface: "search_results",
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: true,
          matchedSignals: ["search-query"]
        },
        failureCategory: "api_mismatch"
      }
    ]);

    expect(guard).toBeNull();
  });

  it("triggers the streak guard earlier on a security challenge surface", () => {
    const guard = detectRepeatedIneffectiveAttempts([
      {
        action: { type: "input", target: "#p", value: "11111" },
        pageUrl: "https://xui.ptlogin2.qq.com/cgi-bin/xlogin",
        pageState: {
          surface: "security_challenge",
          hasModal: false,
          hasIframe: true,
          frameCount: 1,
          hasLoginForm: true,
          hasProviderChooser: false,
          hasSearchResults: false,
          matchedSignals: ["security-challenge"]
        },
        failureCategory: "no_effect"
      },
      {
        action: { type: "click", target: "#login_button" },
        pageUrl: "https://xui.ptlogin2.qq.com/cgi-bin/xlogin",
        pageState: {
          surface: "security_challenge",
          hasModal: false,
          hasIframe: true,
          frameCount: 1,
          hasLoginForm: true,
          hasProviderChooser: false,
          hasSearchResults: false,
          matchedSignals: ["security-challenge"]
        },
        failureCategory: "no_effect"
      }
    ]);

    expect(guard).toEqual({
      streakLength: 2,
      host: "xui.ptlogin2.qq.com",
      surface: "security_challenge"
    });
  });

  it("clears recoverable flow failures after a terminal success", () => {
    expect(
      shouldClearFlowFailuresAfterSuccess({
        isFinished: true,
        latestVerificationPassed: true
      })
    ).toBe(true);

    expect(
      shouldClearFlowFailuresAfterSuccess({
        isFinished: true,
        latestVerificationPassed: false
      })
    ).toBe(false);

    expect(
      shouldClearFlowFailuresAfterSuccess({
        isFinished: true,
        latestVerificationPassed: true,
        haltReason: "blocked"
      })
    ).toBe(false);
  });
});
