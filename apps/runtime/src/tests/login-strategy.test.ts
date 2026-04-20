import { describe, expect, it } from "vitest";
import { buildLoginScenarios } from "../orchestrator/login-strategy.js";

describe("buildLoginScenarios", () => {
  it("returns 6 abnormal-then-normal scenarios", () => {
    const scenarios = buildLoginScenarios("admin", "secret");
    expect(scenarios).toHaveLength(6);
    expect(scenarios[0]?.username).toBe("");
    expect(scenarios[5]?.username).toBe("admin");
    expect(scenarios[5]?.password).toBe("secret");
  });
});
