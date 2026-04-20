import { describe, expect, it } from "vitest";
import { summarizePageState } from "../playwright/collector/page-state.js";

describe("summarizePageState", () => {
  it("recognizes provider chooser modals even when buttons are identified by ids or classes", () => {
    const state = summarizePageState({
      url: "https://rocom.qq.com/",
      title: "\u300a\u6d1b\u514b\u738b\u56fd\uff1a\u4e16\u754c\u300b\u5b98\u65b9\u7f51\u7ad9",
      elements: [
        {
          tag: "a",
          id: "modalIconqq",
          className: "modal-icon-qq",
          selector: "#modalIconqq",
          contextType: "modal",
          contextLabel: "\u8bf7\u9009\u62e9\u60a8\u7684\u767b\u5f55\u5e73\u53f0"
        },
        {
          tag: "a",
          id: "modalIconWechat",
          className: "modal-icon-wechat",
          selector: "#modalIconWechat",
          contextType: "modal",
          contextLabel: "\u8bf7\u9009\u62e9\u60a8\u7684\u767b\u5f55\u5e73\u53f0"
        }
      ]
    });

    expect(state.hasModal).toBe(true);
    expect(state.hasProviderChooser).toBe(true);
    expect(state.surface).toBe("login_chooser");
  });

  it("does not treat a generic homepage as a post-login dashboard", () => {
    const state = summarizePageState({
      url: "https://rocom.qq.com/",
      title: "\u5b98\u65b9\u7f51\u7ad9",
      elements: [
        { tag: "a", text: "\u9996\u9875", selector: "a.nav-home" },
        { tag: "a", text: "\u65b0\u95fb", selector: "a.nav-news" },
        { tag: "div", text: "\u767b\u5f55", selector: "#unloginArea" }
      ]
    });

    expect(state.matchedSignals).not.toContain("post-login-copy");
    expect(state.surface).toBe("generic");
  });

  it("recognizes embedded provider auth iframes as provider auth", () => {
    const state = summarizePageState({
      url: "https://rocom.qq.com/",
      title: "\u300a\u6d1b\u514b\u738b\u56fd\uff1a\u4e16\u754c\u300b\u5b98\u65b9\u7f51\u7ad9",
      elements: [
        {
          tag: "iframe",
          className: "loginframe",
          selector: "iframe.loginframe",
          title: "https://graph.qq.com/oauth2.0/authorize?...",
          nearbyText: "https://graph.qq.com/oauth2.0/authorize?...",
          contextType: "page"
        },
        {
          tag: "iframe",
          selector: "iframe[data-frame-path='frame-2']",
          text: "Embedded QQ auth frame",
          framePath: "frame-2",
          frameUrl: "https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=716027609",
          frameTitle: "QQ\u5e10\u53f7\u5b89\u5168\u767b\u5f55",
          contextType: "iframe"
        }
      ]
    });

    expect(state.hasIframe).toBe(true);
    expect(state.matchedSignals).toContain("provider-auth-frame");
    expect(state.surface).toBe("provider_auth");
  });

  it("recognizes xui ptlogin hosts as provider auth", () => {
    const state = summarizePageState({
      url: "https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=716027609",
      title: "QQ\u5e10\u53f7\u5b89\u5168\u767b\u5f55",
      elements: []
    });

    expect(state.surface).toBe("provider_auth");
  });

  it("does not misclassify QQ provider auth copy as a security challenge", () => {
    const state = summarizePageState({
      url: "https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=716027609",
      title: "QQ\u5e10\u53f7\u5b89\u5168\u767b\u5f55",
      elements: [
        {
          tag: "input",
          id: "u",
          selector: "#u",
          nearbyText: "\u8d26\u53f7",
          framePath: "frame-1",
          frameUrl: "https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=716027609",
          contextType: "iframe"
        },
        {
          tag: "input",
          id: "p",
          selector: "#p",
          type: "password",
          nearbyText: "\u5bc6\u7801",
          framePath: "frame-1",
          frameUrl: "https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=716027609",
          contextType: "iframe"
        },
        {
          tag: "div",
          selector: "#web_qr_login",
          nearbyText:
            "\u5feb\u6377\u767b\u5f55\u5b89\u5168\u9a8c\u8bc1 \u767b\u5f55\u73af\u5883\u5f02\u5e38\uff08\u5f02\u5730\u767b\u5f55\u6216IP\u5b58\u5728\u98ce\u9669\uff09\u8bf7\u4f7f\u7528QQ\u624b\u673a\u7248\u626b\u7801\u767b\u5f55",
          framePath: "frame-1",
          frameUrl: "https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=716027609",
          contextType: "iframe"
        }
      ]
    });

    expect(state.surface).toBe("provider_auth");
    expect(state.authErrorText).toBeUndefined();
  });

  it("captures inline credential validation errors on provider auth pages", () => {
    const state = summarizePageState({
      url: "https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=716027609",
      title: "QQ\u5e10\u53f7\u5b89\u5168\u767b\u5f55",
      elements: [
        {
          tag: "input",
          id: "u",
          selector: "#u",
          nearbyText: "\u8d26\u53f7",
          framePath: "frame-1",
          frameUrl: "https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=716027609",
          contextType: "iframe"
        },
        {
          tag: "input",
          id: "p",
          selector: "#p",
          type: "password",
          nearbyText: "\u5bc6\u7801",
          framePath: "frame-1",
          frameUrl: "https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=716027609",
          contextType: "iframe"
        },
        {
          tag: "div",
          text: "\u8bf7\u8f93\u5165\u6b63\u786e\u7684\u8d26\u53f7\uff01",
          framePath: "frame-1",
          frameUrl: "https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=716027609",
          contextType: "iframe"
        }
      ]
    });

    expect(state.surface).toBe("provider_auth");
    expect(state.authErrorText).toContain("\u8bf7\u8f93\u5165\u6b63\u786e\u7684\u8d26\u53f7");
    expect(state.matchedSignals).toContain("auth-validation-error");
  });

  it("treats authenticated app shell copy with incidental security text as dashboard_like", () => {
    const state = summarizePageState({
      url: "https://wx.mail.qq.com/home/index",
      title: "QQ\u90ae\u7bb1",
      elements: [
        { tag: "a", text: "\u6536\u4ef6\u7bb1", selector: "a.inbox" },
        { tag: "button", text: "\u5199\u4fe1", selector: "button.compose" },
        { tag: "a", text: "\u9000\u51fa", selector: "a.logout" },
        {
          tag: "div",
          text: "\u5f53\u524d\u4f1a\u8bdd\u5b89\u5168\u9a8c\u8bc1\u7801\u8bbe\u7f6e",
          selector: "div.security-settings"
        }
      ]
    });

    expect(state.surface).toBe("dashboard_like");
    expect(state.matchedSignals).toContain("post-login-copy");
    expect(state.matchedSignals).toContain("security-copy");
    expect(state.authErrorText).toBeUndefined();
  });
});
