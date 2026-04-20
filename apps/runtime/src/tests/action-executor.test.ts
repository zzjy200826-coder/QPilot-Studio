import { describe, expect, it, vi } from "vitest";
import {
  derivePreferredClickTexts,
  findVisibleLocatorAcrossFrames
} from "../playwright/executor/action-executor.js";

describe("derivePreferredClickTexts", () => {
  it("extracts quoted result text from Chinese notes", () => {
    const texts = derivePreferredClickTexts({
      type: "click",
      target: "a.cos-no-underline.c-invoke-class",
      note:
        '\u70b9\u51fb\u641c\u7d22\u7ed3\u679c\u4e2d"\u6d1b\u514b\u738b\u56fd\u5b98\u65b9\u7f51\u7ad9"\u94fe\u63a5\uff0c\u8fdb\u5165\u5b98\u7f51'
    });

    expect(texts).toContain("\u6d1b\u514b\u738b\u56fd\u5b98\u65b9\u7f51\u7ad9");
  });

  it("keeps a plain text target when the target is not a CSS selector", () => {
    const texts = derivePreferredClickTexts({
      type: "click",
      target: "\u5b98\u65b9\u7f51\u7ad9",
      note: "\u70b9\u51fb\u5b98\u65b9\u7f51\u7ad9"
    });

    expect(texts[0]).toBe("\u5b98\u65b9\u7f51\u7ad9");
  });

  it("extracts selector literal text hints from provider selectors", () => {
    const texts = derivePreferredClickTexts({
      type: "click",
      target: "a[title='QQ\u8d26\u53f7']",
      note: "\u70b9\u51fbQQ\u767b\u5f55\u5165\u53e3"
    });

    expect(texts).toContain("QQ\u8d26\u53f7");
  });

  it("re-polls frames so late login iframes can still be located", async () => {
    const mainFrame = {
      url: () => "https://rocom.qq.com/"
    };
    const loginFrame = {
      url: () => "https://xui.ptlogin2.qq.com/cgi-bin/xlogin"
    };

    const hiddenLocator = {
      evaluateAll: vi.fn().mockResolvedValue([])
    };
    const visibleLocator = {
      evaluateAll: vi.fn().mockResolvedValue([0]),
      nth: vi.fn().mockReturnThis(),
      waitFor: vi.fn().mockResolvedValue(undefined)
    };

    const frames = vi
      .fn()
      .mockReturnValueOnce([mainFrame])
      .mockReturnValue([mainFrame, loginFrame]);
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);
    const page = {
      frames,
      mainFrame: () => mainFrame,
      waitForTimeout
    };

    const match = await findVisibleLocatorAcrossFrames(
      page as never,
      (frame) => (frame === loginFrame ? (visibleLocator as never) : (hiddenLocator as never)),
      300
    );

    expect(match?.frameLabel).toBe("xui.ptlogin2.qq.com");
    expect(waitForTimeout).toHaveBeenCalled();
    expect(frames).toHaveBeenCalledTimes(2);
  });
});
