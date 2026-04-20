import { describe, expect, it } from "vitest";
import {
  buildVerificationResult,
  reconcileVerificationWithApiSignals
} from "../playwright/verifier/basic-verifier.js";

describe("buildVerificationResult", () => {
  it("detects url change and expected checks", () => {
    const result = buildVerificationResult(
      "https://example.com/login",
      "https://example.com/dashboard",
      "Welcome back admin",
      ["welcome", "admin"]
    );
    expect(result.urlChanged).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.matchedCount).toBe(2);
    expect(result.rules?.some((item) => item.id === "url_changed")).toBe(true);
    expect(result.pageState?.surface).toBe("generic");
  });

  it("marks missing checks", () => {
    const result = buildVerificationResult(
      "https://example.com/login",
      "https://example.com/login",
      "Invalid password",
      ["welcome"]
    );
    expect(result.passed).toBe(false);
    expect(result.checks[0]?.found).toBe(false);
  });

  it("rejects login false positives on search result pages", () => {
    const result = buildVerificationResult(
      "https://www.baidu.com/s?wd=qq邮箱",
      "https://www.baidu.com/s?wd=qq邮箱网页版",
      "QQ邮箱 登录 账号 密码 mail.qq.com",
      ["QQ邮箱", "登录", "账号", "密码", "mail.qq.com"],
      {
        goal: "帮我搜索qq邮箱并且登录进去",
        targetUrl: "https://www.baidu.com",
        currentElements: [
          { tag: "a", text: "登录QQ邮箱", selector: "a" },
          { tag: "a", text: "mail.qq.com", selector: "a" }
        ]
      }
    );

    expect(result.urlChanged).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.note).toContain("false positive");
    expect(result.rules?.some((item) => item.id === "login_surface" && item.status === "failed")).toBe(true);
    expect(result.pageState?.surface).toBe("search_results");
  });

  it("fails verification when the provider returns an inline credential validation error", () => {
    const result = buildVerificationResult(
      "https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=716027609",
      "https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=716027609",
      "\u8d26\u53f7 \u5bc6\u7801 \u8bf7\u8f93\u5165\u6b63\u786e\u7684\u8d26\u53f7\uff01",
      ["\u8d26\u53f7", "\u5bc6\u7801"],
      {
        goal: "\u7528QQ\u767b\u5f55",
        language: "zh-CN",
        targetUrl: "https://www.baidu.com/",
        currentElements: [
          { tag: "input", id: "u", selector: "#u", nearbyText: "\u8d26\u53f7" },
          { tag: "input", id: "p", selector: "#p", type: "password", nearbyText: "\u5bc6\u7801" },
          { tag: "div", text: "\u8bf7\u8f93\u5165\u6b63\u786e\u7684\u8d26\u53f7\uff01" }
        ]
      }
    );

    expect(result.passed).toBe(false);
    expect(result.note).toContain("\u8d26\u53f7\u6821\u9a8c\u5931\u8d25");
    expect(result.rules?.some((item) => item.id === "auth_validation" && item.status === "failed")).toBe(true);
    expect(result.pageState?.authErrorText).toContain("\u8bf7\u8f93\u5165\u6b63\u786e\u7684\u8d26\u53f7");
  });

  it("treats authenticated application shells as a successful login outcome", () => {
    const result = buildVerificationResult(
      "https://mail.qq.com/cgi-bin/loginpage",
      "https://wx.mail.qq.com/home/index",
      "QQ\u90ae\u7bb1 \u6536\u4ef6\u7bb1 \u5199\u4fe1 \u9000\u51fa",
      ["QQ\u90ae\u7bb1", "\u767b\u5f55"],
      {
        goal: "\u767b\u5f55QQ\u90ae\u7bb1",
        language: "zh-CN",
        targetUrl: "https://mail.qq.com/",
        currentElements: [
          { tag: "a", text: "\u6536\u4ef6\u7bb1", selector: "a.inbox" },
          { tag: "button", text: "\u5199\u4fe1", selector: "button.compose" },
          { tag: "a", text: "\u9000\u51fa", selector: "a.logout" }
        ]
      }
    );

    expect(result.passed).toBe(true);
    expect(result.pageState?.surface).toBe("dashboard_like");
    expect(
      result.rules?.some(
        (item) => item.id === "authenticated_outcome" && item.status === "passed"
      )
    ).toBe(true);
    expect(
      result.rules?.some((item) => item.id === "password_field" && item.status === "neutral")
    ).toBe(true);
  });

  it("promotes login verification when api session signals confirm an authenticated landing", () => {
    const base = buildVerificationResult(
      "https://auth.example.com/login",
      "https://app.example.com/home",
      "Home Notifications Help Center",
      ["login"],
      {
        goal: "Sign in and continue",
        targetUrl: "https://auth.example.com/login",
        currentElements: [
          { tag: "a", text: "Home", selector: "a.home" },
          { tag: "button", text: "Notifications", selector: "button.notifications" }
        ]
      }
    );

    const result = reconcileVerificationWithApiSignals({
      verification: base,
      apiVerification: {
        status: "passed",
        requestCount: 2,
        matchedRequestCount: 0,
        failedRequestCount: 0,
        expectedRequestCount: 0,
        tokenSignals: 0,
        sessionSignals: 2,
        hostTransition: {
          from: "auth.example.com",
          to: "app.example.com",
          changed: true
        },
        note: "Captured session activity.",
        keyRequests: []
      },
      previousUrl: "https://auth.example.com/login",
      currentUrl: "https://app.example.com/home",
      expectedChecks: ["login"],
      goal: "Sign in and continue"
    });

    expect(base.passed).toBe(false);
    expect(result.passed).toBe(true);
    expect(
      result.rules?.some(
        (item) => item.id === "authenticated_session" && item.status === "passed"
      )
    ).toBe(true);
  });
});
