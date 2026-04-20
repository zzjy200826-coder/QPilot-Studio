import { describe, expect, it } from "vitest";
import {
  detectSecurityChallengeFromText,
  shouldPreserveDialog
} from "../playwright/collector/page-guards.js";

describe("page guards", () => {
  it("preserves login chooser dialogs that are part of the auth flow", () => {
    expect(
      shouldPreserveDialog(
        "Please choose your login platform. QQ login / WeChat login",
        "loginModal modal-close modalIconqq"
      )
    ).toBe(true);
  });

  it("does not preserve generic promotional popups", () => {
    expect(
      shouldPreserveDialog(
        "Subscribe for updates and close this popup later",
        "promo-modal close"
      )
    ).toBe(false);
  });

  it("does not treat authenticated app shell text as a captcha challenge", () => {
    expect(
      detectSecurityChallengeFromText(
        "https://wx.mail.qq.com/home/index",
        "QQ邮箱 收件箱 写信 退出 当前会话安全验证码设置"
      )
    ).toEqual({ detected: false });
  });

  it("still treats explicit captcha URLs as a challenge even with app-shell text present", () => {
    expect(
      detectSecurityChallengeFromText(
        "https://example.com/captcha",
        "收件箱 写信 退出"
      )
    ).toMatchObject({
      detected: true,
      kind: "captcha"
    });
  });
});
