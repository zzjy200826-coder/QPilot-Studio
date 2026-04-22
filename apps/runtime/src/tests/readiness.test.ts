import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe.sequential("runtime readiness", () => {
  afterEach(() => {
    restoreEnv();
    vi.resetModules();
  });

  it("marks sqlite and filesystem as ready while keeping optional dependencies as disabled or warning", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "qpilot-readiness-ok-"));
    applyEnv({
      NODE_ENV: "test",
      DATABASE_URL: join(tempDir, "runtime.db"),
      ARTIFACTS_DIR: join(tempDir, "artifacts"),
      REPORTS_DIR: join(tempDir, "reports"),
      SESSIONS_DIR: join(tempDir, "sessions"),
      PLANNER_CACHE_DIR: join(tempDir, "planner-cache"),
      PLATFORM_REDIS_URL: "",
      PLATFORM_PROMETHEUS_URL: "",
      OPENAI_API_KEY: "",
      CREDENTIAL_MASTER_KEY:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    });

    try {
      const readinessModule = await import("../platform/readiness.js");
      const dependencies = await readinessModule.getRuntimeDependencies({
        dbClient: {
          execute: vi.fn().mockResolvedValue({})
        } as any
      });
      const readiness = readinessModule.buildReadinessStatus(dependencies);

      expect(dependencies.find((entry) => entry.key === "sqlite")?.state).toBe("ready");
      expect(dependencies.find((entry) => entry.key === "filesystem")?.state).toBe("ready");
      expect(dependencies.find((entry) => entry.key === "redis")?.state).toBe("disabled");
      expect(dependencies.find((entry) => entry.key === "prometheus")?.state).toBe("disabled");
      expect(dependencies.find((entry) => entry.key === "openai")?.state).toBe("warning");
      expect(readiness.ready).toBe(true);
      expect(readiness.failedComponents).toHaveLength(0);
      expect(readiness.warnings).toContain("OpenAI");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("fails readiness on sqlite and redis errors while keeping prometheus as a warning", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "qpilot-readiness-fail-"));
    applyEnv({
      NODE_ENV: "test",
      DATABASE_URL: join(tempDir, "runtime.db"),
      ARTIFACTS_DIR: join(tempDir, "artifacts"),
      REPORTS_DIR: join(tempDir, "reports"),
      SESSIONS_DIR: join(tempDir, "sessions"),
      PLANNER_CACHE_DIR: join(tempDir, "planner-cache"),
      PLATFORM_REDIS_URL: "redis://127.0.0.1:1",
      PLATFORM_PROMETHEUS_URL: "http://127.0.0.1:1",
      OPENAI_API_KEY: "",
      CREDENTIAL_MASTER_KEY:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    });

    try {
      const readinessModule = await import("../platform/readiness.js");
      const dependencies = await readinessModule.getRuntimeDependencies({
        dbClient: {
          execute: vi.fn().mockRejectedValue(new Error("db unavailable"))
        } as any
      });
      const readiness = readinessModule.buildReadinessStatus(dependencies);

      expect(dependencies.find((entry) => entry.key === "sqlite")?.state).toBe("failed");
      expect(dependencies.find((entry) => entry.key === "redis")?.state).toBe("failed");
      expect(dependencies.find((entry) => entry.key === "prometheus")?.state).toBe("warning");
      expect(readiness.ready).toBe(false);
      expect(readiness.failedComponents).toEqual(expect.arrayContaining(["SQLite", "Redis"]));
      expect(readiness.warnings).toContain("Prometheus");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
