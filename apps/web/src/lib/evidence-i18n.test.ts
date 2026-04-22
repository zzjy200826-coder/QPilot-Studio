import type { Action } from "@qpilot/shared";
import { describe, expect, it } from "vitest";
import {
  formatLocalizedActionLabel,
  formatLocalizedStepTitle,
  localizeActionType,
  localizeComparisonChange,
  localizeEvidenceText
} from "./evidence-i18n";

describe("evidence-i18n", () => {
  it("keeps English text untouched", () => {
    expect(localizeEvidenceText("Run passed.", "en")).toBe("Run passed.");
  });

  it("localizes exact evidence sentences", () => {
    expect(localizeEvidenceText("Run passed.", "zh-CN")).toBe(
      "\u8fd0\u884c\u5df2\u901a\u8fc7\u3002"
    );
  });

  it("localizes status summaries", () => {
    expect(localizeEvidenceText("Status queued", "zh-CN")).toBe(
      "\u72b6\u6001\uff1a\u6392\u961f\u4e2d"
    );
  });

  it("localizes generated outcome summaries", () => {
    expect(localizeEvidenceText("Outcome changed from passed to failed.", "zh-CN")).toBe(
      "\u7ed3\u679c\u4ece \u5df2\u901a\u8fc7 \u53d8\u6210\u4e86 \u5931\u8d25\u3002"
    );
  });

  it("formats localized action labels", () => {
    const action: Action = {
      type: "wait",
      note: "Wait for the mailbox shell to render."
    };

    expect(formatLocalizedActionLabel(action, "zh-CN")).toBe(
      "\u7b49\u5f85 \u00b7 \u7b49\u5f85\u90ae\u7bb1\u58f3\u6e32\u67d3\u5b8c\u6210\u3002"
    );
  });

  it("localizes step titles and comparison labels", () => {
    expect(formatLocalizedStepTitle(3, "select", "zh-CN")).toBe(
      "\u6b65\u9aa4 #3 \u9009\u62e9"
    );
    expect(localizeActionType("click", "zh-CN")).toBe("\u70b9\u51fb");
    expect(localizeComparisonChange("added", "zh-CN")).toBe("\u5df2\u65b0\u589e");
  });
});
