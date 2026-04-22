import { afterEach, describe, expect, it, vi } from "vitest";

const previousEnv = new Map<string, string | undefined>();

const applyEnv = (overrides: Record<string, string | undefined>) => {
  previousEnv.clear();
  for (const [key, value] of Object.entries(overrides)) {
    previousEnv.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

const restoreEnv = () => {
  for (const [key, value] of previousEnv.entries()) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  previousEnv.clear();
};

describe.sequential("metrics route access policy", () => {
  afterEach(() => {
    restoreEnv();
    vi.resetModules();
  });

  it("rejects production metrics when no bearer token is configured", async () => {
    applyEnv({
      NODE_ENV: "production",
      PLATFORM_METRICS_ENABLED: "true",
      METRICS_BEARER_TOKEN: undefined,
      CREDENTIAL_MASTER_KEY:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    });

    const module = await import("../server/routes/metrics.js");
    expect(module.checkMetricsAccess()).toMatchObject({
      allowed: false,
      statusCode: 403
    });
  });

  it("requires a matching bearer token when one is configured", async () => {
    applyEnv({
      NODE_ENV: "production",
      PLATFORM_METRICS_ENABLED: "true",
      METRICS_BEARER_TOKEN: "metrics-token-123456",
      CREDENTIAL_MASTER_KEY:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    });

    const module = await import("../server/routes/metrics.js");

    expect(module.checkMetricsAccess()).toMatchObject({
      allowed: false,
      statusCode: 401
    });
    expect(
      module.checkMetricsAccess("Bearer metrics-token-123456")
    ).toMatchObject({
      allowed: true
    });
  });

  it("keeps development metrics open when no token is configured", async () => {
    applyEnv({
      NODE_ENV: "development",
      PLATFORM_METRICS_ENABLED: "true",
      METRICS_BEARER_TOKEN: undefined,
      CREDENTIAL_MASTER_KEY:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    });

    const module = await import("../server/routes/metrics.js");
    expect(module.checkMetricsAccess()).toMatchObject({
      allowed: true
    });
  });
});
