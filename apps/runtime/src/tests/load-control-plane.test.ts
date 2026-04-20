import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../db/client.js";
import { migrateDatabase } from "../db/migrate.js";
import {
  injectorPoolsTable,
  injectorWorkersTable,
  loadProfilesTable,
  loadRunSampleWindowsTable,
  loadRunWorkersTable,
  loadRunsTable,
  projectsTable
} from "../db/schema.js";
import {
  createPlatformLoadRunRecord,
  executePersistedPlatformLoadRun,
  recoverTimedOutPlatformLoadRuns
} from "../platform/load-control-plane.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows may keep the SQLite handle alive briefly after client.close().
      }
    }
  }
});

const seedDistributedFixture = async (db: any, now: number): Promise<void> => {
  await db.insert(projectsTable).values({
    id: "project-1",
    name: "Load Control Plane Test",
    baseUrl: "https://api.example.test",
    usernameCipher: null,
    usernameIv: null,
    usernameTag: null,
    passwordCipher: null,
    passwordIv: null,
    passwordTag: null,
    createdAt: now,
    updatedAt: now
  });

  await db.insert(injectorPoolsTable).values({
    id: "pool-1",
    name: "test pool",
    region: "local",
    capacity: 10,
    concurrencyLimit: 2,
    tagsJson: JSON.stringify(["test"]),
    createdAt: now,
    updatedAt: now
  });

  await db.insert(injectorWorkersTable).values([
    {
      id: "injector-1",
      poolId: "pool-1",
      name: "injector-1",
      status: "online",
      currentRunCount: 0,
      capacity: 2,
      lastHeartbeatAt: now,
      createdAt: now,
      updatedAt: now
    },
    {
      id: "injector-2",
      poolId: "pool-1",
      name: "injector-2",
      status: "online",
      currentRunCount: 0,
      capacity: 2,
      lastHeartbeatAt: now,
      createdAt: now,
      updatedAt: now
    }
  ]);

  await db.insert(loadProfilesTable).values({
    id: "profile-1",
    projectId: "project-1",
    name: "distributed synthetic profile",
    scenarioLabel: "Distributed queue persistence",
    targetBaseUrl: "https://api.example.test",
    environmentTargetId: null,
    engine: "synthetic",
    pattern: "steady",
    requestPath: null,
    httpMethod: null,
    headersJson: null,
    bodyTemplate: null,
    executionMode: "distributed",
    workerCount: 2,
    injectorPoolId: "pool-1",
    arrivalModel: "closed",
    phasePlanJson: null,
    requestMixJson: null,
    evidencePolicyJson: null,
    gatePolicyId: null,
    tagsJson: null,
    baselineRunId: null,
    virtualUsers: 40,
    durationSec: 30,
    rampUpSec: 5,
    targetRps: 60,
    thresholdsJson: JSON.stringify({
      maxP95Ms: 900,
      maxErrorRatePct: 5,
      minThroughputRps: 10
    }),
    createdAt: now,
    updatedAt: now
  });
};

describe("platform load control plane", () => {
  it("persists distributed sample windows against the queued run id", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "qpilot-load-control-"));
    tempDirs.push(tempDir);
    const databasePath = join(tempDir, "runtime.db");
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databasePath;

    try {
      await migrateDatabase();
      const { client, db } = await createDatabase(`file:${databasePath}`);
      const now = Date.now();

      try {
        await seedDistributedFixture(db, now);

        const queuedRun = await createPlatformLoadRunRecord({
          db,
          profileId: "profile-1",
          environmentLabel: "staging",
          queueMode: "bullmq"
        });

        const completedRun = await executePersistedPlatformLoadRun({
          db,
          runId: queuedRun.id
        });

        expect(completedRun.id).toBe(queuedRun.id);
        expect(completedRun.status).toBe("passed");

        const persistedRunRows = await db
          .select()
          .from(loadRunsTable)
          .where(eq(loadRunsTable.id, queuedRun.id));
        expect(persistedRunRows[0]?.status).toBe("passed");

        const sampleWindows = await db
          .select()
          .from(loadRunSampleWindowsTable)
          .where(eq(loadRunSampleWindowsTable.runId, queuedRun.id));
        expect(sampleWindows.length).toBeGreaterThan(0);
      } finally {
        client.close();
      }
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });

  it("fails stale running distributed runs when worker heartbeat times out", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "qpilot-load-control-"));
    tempDirs.push(tempDir);
    const databasePath = join(tempDir, "runtime.db");
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databasePath;

    try {
      await migrateDatabase();
      const { client, db } = await createDatabase(`file:${databasePath}`);
      const now = Date.now();

      try {
        await seedDistributedFixture(db, now);

        const queuedRun = await createPlatformLoadRunRecord({
          db,
          profileId: "profile-1",
          environmentLabel: "staging",
          queueMode: "bullmq"
        });

        const staleStartedAt = now - 60_000;
        await db
          .update(loadRunsTable)
          .set({
            status: "running",
            startedAt: staleStartedAt,
            endedAt: null
          })
          .where(eq(loadRunsTable.id, queuedRun.id));

        await db
          .update(loadRunWorkersTable)
          .set({
            status: "running",
            startedAt: staleStartedAt,
            endedAt: null,
            notes: "Picked up by BullMQ worker."
          })
          .where(eq(loadRunWorkersTable.runId, queuedRun.id));

        await db
          .update(injectorWorkersTable)
          .set({
            status: "busy",
            currentRunCount: 1,
            lastHeartbeatAt: now - 60_000,
            updatedAt: now
          })
          .where(eq(injectorWorkersTable.poolId, "pool-1"));

        const recoveredRunIds = await recoverTimedOutPlatformLoadRuns({
          db,
          heartbeatTimeoutMs: 15_000
        });

        expect(recoveredRunIds).toContain(queuedRun.id);

        const recoveredRunRows = await db
          .select()
          .from(loadRunsTable)
          .where(eq(loadRunsTable.id, queuedRun.id));
        expect(recoveredRunRows[0]?.status).toBe("failed");
        expect(String(recoveredRunRows[0]?.notes ?? "")).toContain("heartbeat timed out");

        const recoveredWorkers = await db
          .select()
          .from(loadRunWorkersTable)
          .where(eq(loadRunWorkersTable.runId, queuedRun.id));
        expect(recoveredWorkers.every((worker) => worker.status === "failed")).toBe(true);

        const injectorWorkers = await db
          .select()
          .from(injectorWorkersTable)
          .where(eq(injectorWorkersTable.poolId, "pool-1"));
        expect(injectorWorkers.every((worker) => worker.status === "offline")).toBe(true);
      } finally {
        client.close();
      }
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });
});
