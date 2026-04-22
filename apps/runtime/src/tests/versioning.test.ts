import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../db/client.js";
import { migrateDatabase } from "../db/migrate.js";
import { gatePoliciesTable, loadProfilesTable, projectsTable } from "../db/schema.js";
import {
  createGatePolicyVersionSnapshot,
  createLoadProfileVersionSnapshot,
  listGatePolicyVersions,
  listLoadProfileVersions,
  rollbackLoadProfileVersion
} from "../platform/versioning.js";
import { mapGatePolicyRow, mapLoadProfileRow, type GatePolicyRow, type LoadProfileRow } from "../utils/mappers.js";

const tempDirs: string[] = [];
const defaultTenantId = "tenant-default";

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup races on Windows.
    }
  }
});

describe("platform versioning", () => {
  it("creates profile snapshots and can roll back to an earlier version", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "qpilot-versioning-"));
    tempDirs.push(tempDir);
    const databasePath = join(tempDir, "runtime.db");
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databasePath;

    try {
      await migrateDatabase();
      const { client, db } = await createDatabase(`file:${databasePath}`);
      const now = Date.now();

      try {
        await db.insert(projectsTable).values({
          id: "project-1",
          tenantId: defaultTenantId,
          name: "Versioning Test",
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

        await db.insert(loadProfilesTable).values({
          id: "profile-1",
          tenantId: defaultTenantId,
          projectId: "project-1",
          name: "Checkout steady",
          scenarioLabel: "Checkout gate",
          targetBaseUrl: "https://api.example.test",
          environmentTargetId: null,
          engine: "k6_http",
          pattern: "steady",
          requestPath: "/health",
          httpMethod: "GET",
          headersJson: null,
          bodyTemplate: null,
          executionMode: "local",
          workerCount: 1,
          injectorPoolId: null,
          arrivalModel: "closed",
          phasePlanJson: null,
          requestMixJson: null,
          evidencePolicyJson: null,
          gatePolicyId: null,
          tagsJson: null,
          baselineRunId: null,
          virtualUsers: 100,
          durationSec: 120,
          rampUpSec: 30,
          targetRps: 160,
          thresholdsJson: JSON.stringify({
            maxP95Ms: 500,
            maxErrorRatePct: 1,
            minThroughputRps: 120
          }),
          createdAt: now,
          updatedAt: now
        });

        const initialProfileRows = (await db
          .select()
          .from(loadProfilesTable)
          .where(eq(loadProfilesTable.id, "profile-1"))
          .limit(1)) as LoadProfileRow[];
        const initialProfile = mapLoadProfileRow(initialProfileRows[0]!);

        await createLoadProfileVersionSnapshot({
          db,
          profile: initialProfile,
          reason: "Initial snapshot."
        });

        await db
          .update(loadProfilesTable)
          .set({
            name: "Checkout spike",
            thresholdsJson: JSON.stringify({
              maxP95Ms: 900,
              maxErrorRatePct: 2,
              minThroughputRps: 90
            }),
            updatedAt: now + 1000
          })
          .where(eq(loadProfilesTable.id, "profile-1"));

        const updatedProfileRows = (await db
          .select()
          .from(loadProfilesTable)
          .where(eq(loadProfilesTable.id, "profile-1"))
          .limit(1)) as LoadProfileRow[];
        const updatedProfile = mapLoadProfileRow(updatedProfileRows[0]!);
        await createLoadProfileVersionSnapshot({
          db,
          profile: updatedProfile,
          reason: "Pattern tuned."
        });

        const versions = await listLoadProfileVersions(db, "profile-1");
        expect(versions).toHaveLength(2);
        expect(versions[0]?.versionNumber).toBe(2);

        const restored = await rollbackLoadProfileVersion({
          db,
          profileId: "profile-1",
          versionId: versions[1]!.id
        });

        expect(restored.name).toBe("Checkout steady");
        expect(restored.thresholds.maxP95Ms).toBe(500);

        const postRollbackVersions = await listLoadProfileVersions(db, "profile-1");
        expect(postRollbackVersions[0]?.versionNumber).toBe(3);
        expect(postRollbackVersions[0]?.reason).toContain("Rollback");
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

  it("records gate policy version snapshots", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "qpilot-versioning-"));
    tempDirs.push(tempDir);
    const databasePath = join(tempDir, "runtime.db");
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databasePath;

    try {
      await migrateDatabase();
      const { client, db } = await createDatabase(`file:${databasePath}`);
      const now = Date.now();

      try {
        await db.insert(projectsTable).values({
          id: "project-2",
          tenantId: defaultTenantId,
          name: "Gate Policy Test",
          baseUrl: "https://release.example.test",
          usernameCipher: null,
          usernameIv: null,
          usernameTag: null,
          passwordCipher: null,
          passwordIv: null,
          passwordTag: null,
          createdAt: now,
          updatedAt: now
        });

        await db.insert(gatePoliciesTable).values({
          id: "policy-1",
          tenantId: defaultTenantId,
          projectId: "project-2",
          name: "release gate",
          requiredFunctionalFlowsJson: JSON.stringify(["login"]),
          minBenchmarkCoveragePct: 60,
          minBenchmarkPassRate: 75,
          requiredLoadProfileIdsJson: JSON.stringify(["profile-1"]),
          minimumLoadVerdict: "watch",
          allowWaiver: 1,
          approverRolesJson: JSON.stringify(["qa-lead"]),
          expiresAt: null,
          createdAt: now,
          updatedAt: now
        });

        const policyRows = (await db
          .select()
          .from(gatePoliciesTable)
          .where(eq(gatePoliciesTable.id, "policy-1"))
          .limit(1)) as GatePolicyRow[];
        const policy = mapGatePolicyRow(policyRows[0]!);

        await createGatePolicyVersionSnapshot({
          db,
          policy,
          status: "active",
          reason: "Initial policy snapshot."
        });

        const versions = await listGatePolicyVersions(db, "policy-1");
        expect(versions).toHaveLength(1);
        expect(versions[0]?.versionNumber).toBe(1);
        expect(versions[0]?.status).toBe("active");
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
