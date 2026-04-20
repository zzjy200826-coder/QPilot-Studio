import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { OpenAICompatibleClient } from "@qpilot/ai-gateway";
import { Planner } from "../llm/planner.js";
import { PlannerCache } from "../llm/planner-cache.js";

describe("Planner cache", () => {
  it("reuses a cached decision for the same page signature", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "qpilot-planner-cache-"));
    let called = 0;
    const fakeClient = {
      async createChatCompletion(): Promise<string> {
        called += 1;
        return JSON.stringify({
          goal: "test",
          page_assessment: {
            page_type: "generic",
            risk_level: "low",
            key_elements: []
          },
          plan: { strategy: "safe", reason: "cacheable" },
          actions: [{ type: "wait", ms: 1000 }],
          expected_checks: [],
          test_case_candidate: { generate: false },
          is_finished: true
        });
      }
    } as unknown as OpenAICompatibleClient;

    const planner = new Planner(fakeClient, new PlannerCache(cacheDir));
    const input = {
      snapshot: {
        url: "https://example.com",
        title: "Example",
        screenshotPath: "/artifacts/x.png",
        elements: [
          {
            tag: "button",
            selector: "#login",
            text: "Login",
            contextType: "page" as const,
            isVisible: true,
            isEnabled: true
          }
        ],
        pageState: {
          surface: "generic" as const,
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: false,
          matchedSignals: []
        }
      },
      runConfig: {
        targetUrl: "https://example.com",
        mode: "general" as const,
        language: "en" as const,
        executionMode: "auto_batch" as const,
        confirmDraft: false,
        goal: "smoke",
        maxSteps: 3,
        headed: false,
        manualTakeover: false,
        saveSession: false
      },
      stepIndex: 1,
      lastObservation: "first look",
      seedPrompt: "seed"
    };

    const first = await planner.plan(input);
    const second = await planner.plan(input);

    expect(called).toBe(1);
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);

    await rm(cacheDir, { recursive: true, force: true });
  });

  it("treats a different observation as a different cache key", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "qpilot-planner-cache-"));
    let called = 0;
    const fakeClient = {
      async createChatCompletion(): Promise<string> {
        called += 1;
        return JSON.stringify({
          goal: "test",
          page_assessment: {
            page_type: "generic",
            risk_level: "low",
            key_elements: []
          },
          plan: { strategy: "safe", reason: "cacheable" },
          actions: [{ type: "wait", ms: 1000 }],
          expected_checks: [],
          test_case_candidate: { generate: false },
          is_finished: true
        });
      }
    } as unknown as OpenAICompatibleClient;

    const planner = new Planner(fakeClient, new PlannerCache(cacheDir));
    const sharedInput = {
      snapshot: {
        url: "https://example.com",
        title: "Example",
        screenshotPath: "/artifacts/x.png",
        elements: [],
        pageState: {
          surface: "generic" as const,
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: false,
          matchedSignals: []
        }
      },
      runConfig: {
        targetUrl: "https://example.com",
        mode: "general" as const,
        language: "en" as const,
        executionMode: "auto_batch" as const,
        confirmDraft: false,
        goal: "smoke",
        maxSteps: 3,
        headed: false,
        manualTakeover: false,
        saveSession: false
      },
      stepIndex: 2,
      seedPrompt: "seed"
    };

    await planner.plan({
      ...sharedInput,
      lastObservation: "diagnosis=no_effect"
    });
    await planner.plan({
      ...sharedInput,
      lastObservation: "diagnosis=api_mismatch"
    });

    expect(called).toBe(2);

    await rm(cacheDir, { recursive: true, force: true });
  });

  it("treats different structured working memory as a different cache key", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "qpilot-planner-cache-"));
    let called = 0;
    const fakeClient = {
      async createChatCompletion(): Promise<string> {
        called += 1;
        return JSON.stringify({
          goal: "test",
          page_assessment: {
            page_type: "generic",
            risk_level: "low",
            key_elements: []
          },
          plan: { strategy: "safe", reason: "cacheable" },
          actions: [{ type: "wait", ms: 1000 }],
          expected_checks: [],
          test_case_candidate: { generate: false },
          is_finished: true
        });
      }
    } as unknown as OpenAICompatibleClient;

    const planner = new Planner(fakeClient, new PlannerCache(cacheDir));
    const sharedInput = {
      snapshot: {
        url: "https://example.com/app",
        title: "Example App",
        screenshotPath: "/artifacts/x.png",
        elements: [],
        pageState: {
          surface: "dashboard_like" as const,
          hasModal: false,
          hasIframe: false,
          frameCount: 0,
          hasLoginForm: false,
          hasProviderChooser: false,
          hasSearchResults: false,
          matchedSignals: ["post-login-copy"]
        }
      },
      runConfig: {
        targetUrl: "https://example.com",
        mode: "general" as const,
        language: "en" as const,
        executionMode: "auto_batch" as const,
        confirmDraft: false,
        goal: "smoke",
        maxSteps: 3,
        headed: false,
        manualTakeover: false,
        saveSession: false
      },
      stepIndex: 1,
      seedPrompt: "seed"
    };

    await planner.plan({
      ...sharedInput,
      workingMemory: {
        stage: "target_site",
        alignment: "aligned",
        transitionReason: "target_site",
        goalAnchors: ["example"],
        avoidHosts: [],
        avoidLabels: [],
        avoidRepeatCredentialSubmission: false,
        successSignals: []
      }
    });
    await planner.plan({
      ...sharedInput,
      workingMemory: {
        stage: "authenticated_app",
        alignment: "aligned",
        transitionReason: "authenticated_app",
        goalAnchors: ["example"],
        avoidHosts: [],
        avoidLabels: [],
        avoidRepeatCredentialSubmission: false,
        successSignals: ["dashboard_like"]
      }
    });

    expect(called).toBe(2);

    await rm(cacheDir, { recursive: true, force: true });
  });
});
