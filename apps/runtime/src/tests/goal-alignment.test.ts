import { describe, expect, it } from "vitest";
import {
  assessGoalStageTransition,
  buildGoalGuardObservation
} from "../orchestrator/goal-alignment.js";

describe("goal alignment", () => {
  it("does not flag authenticated dashboard pages as wrong targets for login goals", () => {
    const observation = buildGoalGuardObservation({
      goal: "\u6253\u5f00QQ\u90ae\u7bb1\uff0c\u5982\u679c\u5df2\u7ecf\u8fdb\u5165\u767b\u5f55\u540e\u7684\u5e94\u7528\u754c\u9762\u6216\u6536\u4ef6\u7bb1\u5219\u76f4\u63a5\u5224\u5b9a\u6210\u529f\uff0c\u5426\u5219\u7ee7\u7eed\u5b8c\u6210\u767b\u5f55",
      snapshot: {
        url: "https://wx.mail.qq.com/home/index?sid=abc#/list/1/1",
        title: "QQ\u90ae\u7bb1",
        screenshotPath: "/artifacts/fake.png",
        elements: [
          {
            tag: "div",
            text: "\u7802\u7cd6 2307159441@qq.com \u666e\u901a\u7528\u6237",
            selector: "div.profile"
          },
          {
            tag: "div",
            text: "\u6536\u4ef6\u7bb1 539",
            selector: "div.inbox"
          },
          {
            tag: "div",
            text: "\u5199\u4fe1",
            selector: "div.compose"
          },
          {
            tag: "div",
            text: "\u8bbe\u7f6e",
            selector: "div.settings"
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
      }
    });

    expect(observation).toBeUndefined();
  });

  it("classifies content-style answer pages as wrong-target detours", () => {
    const transition = assessGoalStageTransition({
      goal: "搜索qq邮箱，点击qq邮箱并登录",
      snapshot: {
        url: "https://wenwen.sogou.com/z/q735970201.htm",
        title: "qq邮箱的正确书写格式",
        screenshotPath: "/artifacts/fake.png",
        elements: [
          {
            tag: "span",
            text: "qq邮箱的正确书写格式",
            selector: "#question_title_val"
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
      }
    });

    expect(transition.stage).toBe("content_detour");
    expect(transition.alignment).toBe("wrong_target");
    expect(transition.reason).toBe("content_detour");
    expect(transition.avoidHosts).toContain("wenwen.sogou.com");
  });

  it("classifies provider authorization pages as intermediate auth instead of wrong target", () => {
    const transition = assessGoalStageTransition({
      goal: "打开QQ邮箱并用QQ登录",
      snapshot: {
        url: "https://graph.qq.com/oauth2.0/show?which=Login",
        title: "QQ登录",
        screenshotPath: "/artifacts/fake.png",
        elements: [
          {
            tag: "iframe",
            id: "ptlogin_iframe",
            selector: "#ptlogin_iframe",
            title: "QQ登录"
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
      }
    });

    expect(transition.stage).toBe("provider_auth");
    expect(transition.alignment).toBe("intermediate_auth");
    expect(transition.reason).toBe("provider_auth");
  });
});
