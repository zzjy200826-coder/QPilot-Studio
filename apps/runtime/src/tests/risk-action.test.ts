import { describe, expect, it } from "vitest";
import { isHighRiskAction } from "../utils/risk-action.js";

describe("isHighRiskAction", () => {
  it("flags dangerous operations", () => {
    expect(
      isHighRiskAction({
        type: "click",
        target: "button.delete-order"
      })
    ).toBe(true);
  });

  it("allows normal form actions", () => {
    expect(
      isHighRiskAction({
        type: "input",
        target: "input[name='email']",
        value: "user@example.com"
      })
    ).toBe(false);
  });
});
