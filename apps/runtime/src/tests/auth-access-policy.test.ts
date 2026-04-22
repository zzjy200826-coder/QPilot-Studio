import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const parseJson = <T>(response: { body: string }): T => JSON.parse(response.body) as T;

const buildEnv = (databasePath: string, root: string, overrides?: Record<string, string>) => ({
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: "8899",
  CORS_ORIGIN: "http://127.0.0.1:4199",
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

const withServer = async (
  envOverrides: Record<string, string>,
  run: (context: { app: any; auditLogsTable: any }) => Promise<void>
) => {
  const tempDir = mkdtempSync(join(tmpdir(), "qpilot-auth-policy-"));
  const previousEnv = new Map<string, string | undefined>();
  const runtimeEnv = buildEnv(join(tempDir, "runtime.db"), tempDir, envOverrides);

  for (const [key, value] of Object.entries(runtimeEnv)) {
    previousEnv.set(key, process.env[key]);
    process.env[key] = value;
  }

  vi.resetModules();
  const serverModule = await import("../server.js");
  const schemaModule = await import("../db/schema.js");
  const app = await serverModule.createServer();
  const auditLogsTable = schemaModule.auditLogsTable;

  try {
    await app.ready();
    await run({ app, auditLogsTable });
  } finally {
    await app.close();
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

describe.sequential("auth access policy", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("blocks self-service registration entirely when disabled", async () => {
    await withServer(
      {
        AUTH_SELF_SERVICE_REGISTRATION: "false",
        AUTH_ALLOWED_EMAILS: "owner@example.test"
      },
      async ({ app }) => {
        const response = await app.inject({
          method: "POST",
          url: "/api/auth/register",
          payload: {
            email: "owner@example.test",
            password: "Password123!",
            displayName: "Owner"
          }
        });

        expect(response.statusCode).toBe(403);
        expect(parseJson<{ error: string }>(response).error).toContain(
          "Self-service registration is disabled"
        );
      }
    );
  }, 15_000);

  it("records audit events for closed registration and allowlist login denials", async () => {
    await withServer(
      {
        AUTH_SELF_SERVICE_REGISTRATION: "false",
        AUTH_ALLOWED_EMAILS: "owner@example.test"
      },
      async ({ app, auditLogsTable }) => {
        const deniedRegister = await app.inject({
          method: "POST",
          url: "/api/auth/register",
          payload: {
            email: "owner@example.test",
            password: "Password123!",
            displayName: "Owner"
          }
        });

        expect(deniedRegister.statusCode).toBe(403);

        const deniedLogin = await app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: {
            email: "outsider@example.test",
            password: "Password123!",
          }
        });

        expect(deniedLogin.statusCode).toBe(403);

        const auditLogs = await app.appContext.db.select().from(auditLogsTable);
        expect(auditLogs.map((entry: { action: string }) => entry.action)).toEqual(
          expect.arrayContaining([
            "auth.register.denied_closed",
            "auth.login.denied_allowlist"
          ])
        );
      }
    );
  }, 15_000);

  it("allows only whitelisted emails to register and log in", async () => {
    await withServer(
      {
        AUTH_SELF_SERVICE_REGISTRATION: "true",
        AUTH_ALLOWED_EMAILS: "owner@example.test"
      },
      async ({ app }) => {
        const blockedRegister = await app.inject({
          method: "POST",
          url: "/api/auth/register",
          payload: {
            email: "outsider@example.test",
            password: "Password123!",
            displayName: "Outsider"
          }
        });

        expect(blockedRegister.statusCode).toBe(403);
        expect(parseJson<{ error: string }>(blockedRegister).error).toContain(
          "restricted to approved accounts"
        );

        const allowedRegister = await app.inject({
          method: "POST",
          url: "/api/auth/register",
          payload: {
            email: "owner@example.test",
            password: "Password123!",
            displayName: "Owner",
            tenantName: "Private Workspace"
          }
        });

        expect(allowedRegister.statusCode).toBe(200);

        const blockedLogin = await app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: {
            email: "outsider@example.test",
            password: "Password123!"
          }
        });

        expect(blockedLogin.statusCode).toBe(403);
        expect(parseJson<{ error: string }>(blockedLogin).error).toContain(
          "restricted to approved accounts"
        );

        const allowedLogin = await app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: {
            email: "owner@example.test",
            password: "Password123!"
          }
        });

        expect(allowedLogin.statusCode).toBe(200);
      }
    );
  }, 15_000);
});
