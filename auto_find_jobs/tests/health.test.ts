import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";

const cleanupDirs: string[] = [];

const createRuntimeDirs = async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-find-jobs-health-"));
  await Promise.all([mkdir(join(root, "artifacts")), mkdir(join(root, "sessions"))]);
  cleanupDirs.push(root);
  return {
    root,
    databasePath: join(root, "job-assistant.sqlite"),
    artifactsRoot: join(root, "artifacts"),
    sessionsRoot: join(root, "sessions")
  };
};

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("GET /api/health", () => {
  it("reports the active browser state and llm capability flags", async () => {
    const paths = await createRuntimeDirs();
    const app = createApp(paths);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/health"
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();
      expect(payload.ok).toBe(true);
      expect(payload.llmConfigured).toEqual(expect.any(Boolean));
      expect(payload.activeAttemptId).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
