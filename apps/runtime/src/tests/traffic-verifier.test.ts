import { describe, expect, it } from "vitest";
import { buildApiVerification, buildApiVerificationRules } from "../orchestrator/traffic-verifier.js";

describe("buildApiVerification", () => {
  it("passes when healthy step-linked traffic is captured", () => {
    const verification = buildApiVerification({
      networkEntries: [
        {
          id: "1",
          ts: new Date().toISOString(),
          phase: "response",
          stepIndex: 1,
          method: "POST",
          url: "https://example.com/api/login",
          host: "example.com",
          pathname: "/api/login",
          resourceType: "fetch",
          status: 200,
          ok: true,
          contentType: "application/json",
          bodyPreview: "{\"token\":\"abc\"}"
        }
      ],
      previousUrl: "https://example.com/login",
      currentUrl: "https://example.com/dashboard"
    });

    expect(verification.status).toBe("passed");
    expect(verification.requestCount).toBe(1);
    expect(verification.tokenSignals).toBe(1);
  });

  it("fails when expected requests are missing", () => {
    const verification = buildApiVerification({
      networkEntries: [
        {
          id: "1",
          ts: new Date().toISOString(),
          phase: "response",
          stepIndex: 2,
          method: "GET",
          url: "https://example.com/api/profile",
          host: "example.com",
          pathname: "/api/profile",
          resourceType: "xhr",
          status: 200,
          ok: true
        }
      ],
      expectedRequests: [
        {
          method: "POST",
          pathname: "/api/login",
          status: 200
        }
      ]
    });

    expect(verification.status).toBe("failed");
    expect(verification.matchedRequestCount).toBe(0);
    expect(verification.expectedRequestCount).toBe(1);
  });

  it("returns neutral when no relevant traffic is linked to the step", () => {
    const verification = buildApiVerification({
      networkEntries: [
        {
          id: "1",
          ts: new Date().toISOString(),
          phase: "response",
          stepIndex: 3,
          method: "GET",
          url: "https://example.com/logo.svg",
          host: "example.com",
          pathname: "/logo.svg",
          resourceType: "image",
          status: 200,
          ok: true
        }
      ]
    });

    expect(verification.status).toBe("neutral");
    expect(verification.requestCount).toBe(0);
  });
});

describe("buildApiVerificationRules", () => {
  it("creates API validation rules from a traffic summary", () => {
    const rules = buildApiVerificationRules({
      status: "passed",
      requestCount: 2,
      matchedRequestCount: 1,
      failedRequestCount: 0,
      expectedRequestCount: 1,
      tokenSignals: 0,
      sessionSignals: 1,
      note: "ok",
      keyRequests: []
    });

    expect(rules).toHaveLength(3);
    expect(rules[0]?.id).toBe("api_request_capture");
    expect(rules[1]?.status).toBe("passed");
    expect(rules[2]?.status).toBe("passed");
  });
});
