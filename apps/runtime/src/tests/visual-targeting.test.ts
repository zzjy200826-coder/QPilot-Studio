import { describe, expect, it } from "vitest";
import {
  deriveVisualSearchTexts,
  pickBestOcrFragmentMatch,
  type OcrTextFragment
} from "../playwright/ocr/visual-targeting.js";

describe("deriveVisualSearchTexts", () => {
  it("extracts quoted link text from action notes", () => {
    const candidates = deriveVisualSearchTexts({
      type: "click",
      target: "a.cos-no-underline.c-invoke-class",
      note:
        '\u70b9\u51fb\u641c\u7d22\u7ed3\u679c\u4e2d"\u6d1b\u514b\u738b\u56fd\u5b98\u65b9\u7f51\u7ad9"\u94fe\u63a5'
    });

    expect(candidates).toContain("\u6d1b\u514b\u738b\u56fd\u5b98\u65b9\u7f51\u7ad9");
  });

  it("keeps plain text targets for visual lookup", () => {
    const candidates = deriveVisualSearchTexts({
      type: "click",
      target: "\u7acb\u5373\u767b\u5f55",
      note: "\u70b9\u51fb\u7acb\u5373\u767b\u5f55"
    });

    expect(candidates[0]).toBe("\u7acb\u5373\u767b\u5f55");
  });

  it("extracts selector literal text for OCR fallback lookup", () => {
    const candidates = deriveVisualSearchTexts({
      type: "click",
      target: "a[title='QQ\u8d26\u53f7']",
      note: "\u70b9\u51fbQQ\u767b\u5f55\u5165\u53e3"
    });

    expect(candidates).toContain("QQ\u8d26\u53f7");
  });
});

describe("pickBestOcrFragmentMatch", () => {
  it("prefers the strongest line-level text match", () => {
    const fragments: OcrTextFragment[] = [
      {
        text: "\u5bc6\u7801",
        normalizedText: "\u5bc6\u7801",
        confidence: 83,
        kind: "word",
        bbox: { x0: 10, y0: 10, x1: 54, y1: 28 },
        surfaceLabel: "main",
        offsetX: 0,
        offsetY: 0
      },
      {
        text: "\u5bc6\u7801\u767b\u5f55",
        normalizedText: "\u5bc6\u7801\u767b\u5f55",
        confidence: 91,
        kind: "line",
        bbox: { x0: 8, y0: 6, x1: 102, y1: 34 },
        surfaceLabel: "xui.ptlogin2.qq.com",
        offsetX: 120,
        offsetY: 200
      }
    ];

    const match = pickBestOcrFragmentMatch(["\u5bc6\u7801\u767b\u5f55"], fragments);

    expect(match?.candidate).toBe("\u5bc6\u7801\u767b\u5f55");
    expect(match?.fragment.text).toBe("\u5bc6\u7801\u767b\u5f55");
    expect(match?.fragment.surfaceLabel).toBe("xui.ptlogin2.qq.com");
  });
});
