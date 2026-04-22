import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const buildEnv = (databasePath: string, root: string, overrides?: Record<string, string>) => ({
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: "8897",
  CORS_ORIGIN: "http://127.0.0.1:4197",
  DATABASE_URL: databasePath,
  ARTIFACTS_DIR: join(root, "artifacts"),
  REPORTS_DIR: join(root, "reports"),
  SESSIONS_DIR: join(root, "sessions"),
  PLANNER_CACHE_DIR: join(root, "planner-cache"),
  CREDENTIAL_MASTER_KEY:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  PLATFORM_REDIS_URL: "",
  PLATFORM_REDIS_WORKER_ENABLED: "false",
  ...overrides
});

const withBootstrapContext = async (
  envOverrides: Record<string, string>,
  run: (context: {
    db: any;
    schema: any;
    lib: typeof import("../scripts/auth-bootstrap-owner-lib.js");
  }) => Promise<void>
) => {
  const tempDir = mkdtempSync(join(tmpdir(), "qpilot-bootstrap-owner-"));
  const previousEnv = new Map<string, string | undefined>();
  const runtimeEnv = buildEnv(join(tempDir, "runtime.db"), tempDir, envOverrides);

  for (const [key, value] of Object.entries(runtimeEnv)) {
    previousEnv.set(key, process.env[key]);
    process.env[key] = value;
  }

  vi.resetModules();
  const migrateModule = await import("../db/migrate.js");
  const envModule = await import("../config/env.js");
  const dbModule = await import("../db/client.js");
  const schemaModule = await import("../db/schema.js");
  const libModule = await import("../scripts/auth-bootstrap-owner-lib.js");

  await migrateModule.migrateDatabase();
  const databaseUrl = dbModule.resolveDatabasePath(
    envModule.env.DATABASE_URL,
    envModule.RUNTIME_ROOT
  );
  const { client, db } = await dbModule.createDatabase(databaseUrl);

  try {
    await run({
      db,
      schema: schemaModule,
      lib: libModule
    });
  } finally {
    client.close();
    for (const [key, value] of previousEnv.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    try {
      rmSync(tempDir, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100
      });
    } catch (error) {
      if (!(error instanceof Error) || !String(error).includes("EPERM")) {
        throw error;
      }
    }
  }
};

describe.sequential("auth bootstrap owner", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("requires an email argument", async () => {
    const module = await import("../scripts/auth-bootstrap-owner-lib.js");

    expect(() =>
      module.parseBootstrapOwnerArgs([], {
        AUTH_BOOTSTRAP_OWNER_PASSWORD: "Password123!"
      })
    ).toThrow("Missing required argument --email.");
  });

  it("requires the bootstrap password from the environment", async () => {
    const module = await import("../scripts/auth-bootstrap-owner-lib.js");

    expect(() =>
      module.parseBootstrapOwnerArgs(["--email", "owner@example.test"], {})
    ).toThrow("Missing required AUTH_BOOTSTRAP_OWNER_PASSWORD environment variable.");
  });

  it("creates the first owner inside the default tenant", async () => {
    await withBootstrapContext(
      {
        AUTH_ALLOWED_EMAILS: "owner@example.test",
        AUTH_BOOTSTRAP_OWNER_PASSWORD: "Password123!"
      },
      async ({ db, schema, lib }) => {
        const result = await lib.bootstrapOwnerAccount(db, {
          email: "owner@example.test",
          password: "Password123!",
          displayName: "Owner One",
          tenantName: "Solo Console"
        });

        expect(result.email).toBe("owner@example.test");
        expect(result.tenantId).toBe("tenant-default");

        const users = await db.select().from(schema.usersTable);
        expect(users).toHaveLength(1);
        expect(users[0]?.email).toBe("owner@example.test");

        const memberships = await db.select().from(schema.membershipsTable);
        expect(memberships).toHaveLength(1);
        expect(memberships[0]?.role).toBe("owner");

        const tenants = await db.select().from(schema.tenantsTable);
        expect(tenants[0]?.name).toBe("Solo Console");
        expect(tenants[0]?.slug).toBe("solo-console");
      }
    );
  });

  it("refuses to create another initial owner after bootstrap", async () => {
    await withBootstrapContext(
      {
        AUTH_ALLOWED_EMAILS: "owner@example.test",
        AUTH_BOOTSTRAP_OWNER_PASSWORD: "Password123!"
      },
      async ({ db, lib }) => {
        await lib.bootstrapOwnerAccount(db, {
          email: "owner@example.test",
          password: "Password123!",
          displayName: "Owner One"
        });

        await expect(
          lib.bootstrapOwnerAccount(db, {
            email: "owner@example.test",
            password: "Password123!",
            displayName: "Owner Again"
          })
        ).rejects.toThrow("Owner already bootstrapped.");
      }
    );
  });

  it("rejects a bootstrap email that is outside the allowlist", async () => {
    await withBootstrapContext(
      {
        AUTH_ALLOWED_EMAILS: "owner@example.test",
        AUTH_BOOTSTRAP_OWNER_PASSWORD: "Password123!"
      },
      async ({ db, lib, schema }) => {
        await expect(
          lib.bootstrapOwnerAccount(db, {
            email: "outsider@example.test",
            password: "Password123!",
            displayName: "Outsider"
          })
        ).rejects.toThrow("Bootstrap owner email is not included in AUTH_ALLOWED_EMAILS.");

        const users = await db.select().from(schema.usersTable);
        expect(users).toHaveLength(0);
      }
    );
  });
});
