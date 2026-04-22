import { describe, expect, it } from "vitest";
import { isProbablyCorruptedTranslation } from "./corruption";

describe("isProbablyCorruptedTranslation", () => {
  it("returns false for normal English and Chinese strings", () => {
    expect(isProbablyCorruptedTranslation("Release details")).toBe(false);
    expect(isProbablyCorruptedTranslation("\u53d1\u5e03\u8be6\u60c5")).toBe(false);
  });

  it("detects replacement-character corruption", () => {
    expect(isProbablyCorruptedTranslation("\u53d1\u5e03\uFFFD\u8be6\u60c5")).toBe(true);
  });

  it("detects common mojibake fragments still present in the repo", () => {
    expect(isProbablyCorruptedTranslation("鍒涘缓鍙戝竷")).toBe(true);
    expect(isProbablyCorruptedTranslation("鏆傛棤闃诲椤")).toBe(true);
  });
});
