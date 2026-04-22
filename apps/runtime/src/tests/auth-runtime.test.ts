import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tempDir = mkdtempSync(join(tmpdir(), "qpilot-auth-runtime-"));
const databasePath = join(tempDir, "runtime.db");
const artifactsRoot = join(tempDir, "artifacts");
const reportsRoot = join(tempDir, "reports");
const sessionsRoot = join(tempDir, "sessions");
const plannerCacheRoot = join(tempDir, "planner-cache");
const previousEnv = new Map<string, string | undefined>();

let app: any;
let hashPassword: (password: string) => Promise<string>;
let usersTable: any;
let membershipsTable: any;

const ownerEmail = "owner.one@example.test";
const ownerPassword = "Password123!";
const outsiderEmail = "owner.two@example.test";
const outsiderPassword = "Password123!";
const memberEmail = "member.one@example.test";
const memberPassword = "Password123!";

const extractCookie = (setCookieHeader?: string | string[]): string => {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  return raw?.split(";")[0] ?? "";
};

const parseJson = <T>(response: { body: string }): T => JSON.parse(response.body) as T;

describe.sequential("runtime auth and tenant isolation", () => {
  beforeAll(async () => {
    const envOverrides: Record<string, string> = {
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: "8898",
      CORS_ORIGIN: "http://127.0.0.1:4198",
      DATABASE_URL: databasePath,
      ARTIFACTS_DIR: artifactsRoot,
      REPORTS_DIR: reportsRoot,
      SESSIONS_DIR: sessionsRoot,
      PLANNER_CACHE_DIR: plannerCacheRoot,
      CREDENTIAL_MASTER_KEY:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      PLATFORM_REDIS_URL: "",
      PLATFORM_REDIS_WORKER_ENABLED: "false"
    };

    for (const [key, value] of Object.entries(envOverrides)) {
      previousEnv.set(key, process.env[key]);
      process.env[key] = value;
    }

    vi.resetModules();
    const serverModule = await import("../server.js");
    const authServiceModule = await import("../auth/service.js");
    const schemaModule = await import("../db/schema.js");

    app = await serverModule.createServer();
    await app.ready();
    hashPassword = authServiceModule.hashPassword;
    usersTable = schemaModule.usersTable;
    membershipsTable = schemaModule.membershipsTable;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    for (const [key, value] of previousEnv.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore Windows file-handle cleanup races in CI and local runs.
    }
  });

  it("blocks anonymous access, registers the first tenant owner, and creates a project", async () => {
    const anonymousProjects = await app.inject({
      method: "GET",
      url: "/api/projects"
    });
    expect(anonymousProjects.statusCode).toBe(401);

    const registerResponse = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: ownerEmail,
        password: ownerPassword,
        displayName: "Owner One",
        tenantName: "Release Team"
      }
    });
    expect(registerResponse.statusCode).toBe(200);
    const ownerAuth = parseJson<any>(registerResponse);
    expect(ownerAuth.tenant.name).toBe("Release Team");
    expect(ownerAuth.membership.role).toBe("owner");

    const ownerCookie = extractCookie(registerResponse.headers["set-cookie"]);
    expect(ownerCookie).toContain("qpilot_session=");

    const meResponse = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: ownerCookie }
    });
    expect(meResponse.statusCode).toBe(200);
    expect(parseJson<any>(meResponse).user.email).toBe(ownerEmail);

    const createProjectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie: ownerCookie },
      payload: {
        name: "Gateway Control",
        baseUrl: "https://gateway.example.test"
      }
    });
    expect(createProjectResponse.statusCode).toBe(200);

    const projectsResponse = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { cookie: ownerCookie }
    });
    const projects = parseJson<Array<{ id: string; name: string }>>(projectsResponse);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe("Gateway Control");
  });

  it("keeps tenants isolated across project reads and writes", async () => {
    const ownerProjectsResponse = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: {
        cookie: extractCookie(
          (
            await app.inject({
              method: "POST",
              url: "/api/auth/login",
              payload: { email: ownerEmail, password: ownerPassword }
            })
          ).headers["set-cookie"]
        )
      }
    });
    const ownerProjects = parseJson<Array<{ id: string }>>(ownerProjectsResponse);
    const projectId = ownerProjects[0]?.id;
    expect(projectId).toBeTruthy();

    const outsiderRegisterResponse = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: outsiderEmail,
        password: outsiderPassword,
        displayName: "Owner Two",
        tenantName: "Blue Team"
      }
    });
    expect(outsiderRegisterResponse.statusCode).toBe(200);
    const outsiderCookie = extractCookie(outsiderRegisterResponse.headers["set-cookie"]);

    const outsiderProjectsResponse = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { cookie: outsiderCookie }
    });
    expect(parseJson<Array<unknown>>(outsiderProjectsResponse)).toHaveLength(0);

    const outsiderPatchResponse = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/credentials`,
      headers: { cookie: outsiderCookie },
      payload: {
        username: "automation@example.test",
        password: "secret-value"
      }
    });
    expect(outsiderPatchResponse.statusCode).toBe(404);
  });

  it("enforces owner-only actions and tenant-scoped API token scopes", async () => {
    const ownerLoginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: ownerEmail, password: ownerPassword }
    });
    const ownerCookie = extractCookie(ownerLoginResponse.headers["set-cookie"]);
    const ownerAuth = parseJson<any>(ownerLoginResponse);

    const now = Date.now();
    await app.appContext.db.insert(usersTable).values({
      id: "user-member-one",
      email: memberEmail,
      passwordHash: await hashPassword(memberPassword),
      displayName: "Member One",
      createdAt: now,
      updatedAt: now
    });
    await app.appContext.db.insert(membershipsTable).values({
      id: "membership-member-one",
      tenantId: ownerAuth.tenant.id,
      userId: "user-member-one",
      role: "member",
      createdAt: now,
      updatedAt: now
    });

    const memberLoginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: memberEmail, password: memberPassword }
    });
    expect(memberLoginResponse.statusCode).toBe(200);
    const memberCookie = extractCookie(memberLoginResponse.headers["set-cookie"]);

    const ownerProjectsResponse = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { cookie: ownerCookie }
    });
    const ownerProjects = parseJson<Array<{ id: string }>>(ownerProjectsResponse);
    const projectId = ownerProjects[0]?.id;
    expect(projectId).toBeTruthy();

    const memberPatchResponse = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/credentials`,
      headers: { cookie: memberCookie },
      payload: {
        username: "member@example.test",
        password: "secret-value"
      }
    });
    expect(memberPatchResponse.statusCode).toBe(403);

    const tokenResponse = await app.inject({
      method: "POST",
      url: "/api/auth/tokens",
      headers: { cookie: ownerCookie },
      payload: {
        label: "Gate Reader",
        scopes: ["gate:read"]
      }
    });
    expect(tokenResponse.statusCode).toBe(200);
    const tokenBody = parseJson<any>(tokenResponse);
    expect(tokenBody.plainTextToken).toContain("qpt_");

    const tokenListReleasesResponse = await app.inject({
      method: "GET",
      url: "/api/platform/releases",
      headers: {
        authorization: `Bearer ${tokenBody.plainTextToken}`
      }
    });
    expect(tokenListReleasesResponse.statusCode).toBe(200);

    const tokenCreateReleaseResponse = await app.inject({
      method: "POST",
      url: "/api/platform/releases",
      headers: {
        authorization: `Bearer ${tokenBody.plainTextToken}`
      },
      payload: {}
    });
    expect(tokenCreateReleaseResponse.statusCode).toBe(403);
  });
});
