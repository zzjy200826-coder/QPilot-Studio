import { describe, expect, it } from "vitest";
import type { OpenAICompatibleClient } from "@qpilot/ai-gateway";
import { Planner } from "../llm/planner.js";

describe("Planner retry", () => {
  it("retries once when schema validation fails", async () => {
    let called = 0;
    const fakeClient = {
      async createChatCompletion(): Promise<string> {
        called += 1;
        if (called === 1) {
          return `{"bad": true}`;
        }
        return JSON.stringify({
          goal: "test",
          page_assessment: {
            page_type: "generic",
            risk_level: "low",
            key_elements: []
          },
          plan: { strategy: "safe", reason: "retry success" },
          actions: [{ type: "wait", ms: 1000 }],
          expected_checks: [],
          test_case_candidate: { generate: false },
          is_finished: true
        });
      }
    } as unknown as OpenAICompatibleClient;

    const planner = new Planner(fakeClient);
    const result = await planner.plan({
      snapshot: {
        url: "https://example.com",
        title: "Example",
        screenshotPath: "/artifacts/x.png",
        elements: []
      },
      runConfig: {
        targetUrl: "https://example.com",
        mode: "general",
        language: "en",
        executionMode: "auto_batch",
        confirmDraft: false,
        goal: "smoke",
        maxSteps: 3,
        headed: false,
        manualTakeover: false,
        saveSession: false
      },
      stepIndex: 1,
      seedPrompt: "seed"
    });

    expect(called).toBe(2);
    expect(result.decision.is_finished).toBe(true);
  });
});
