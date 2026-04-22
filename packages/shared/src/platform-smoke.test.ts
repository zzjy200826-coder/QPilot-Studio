import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runPlatformSmokeVerification } from "./platform-smoke.js";

const servers: Array<ReturnType<typeof createServer>> = [];

const startFixtureServer = async (input: {
  readyStatus?: number;
  metricsMode?: "enabled" | "disabled";
  validToken?: string;
  publicMode?: boolean;
  registrationClosed?: boolean;
}) => {
  const server = createServer((request, response) => {
    const url = request.url ?? "/";
    if (input.publicMode) {
      if (url === "/") {
        response.statusCode = 200;
        response.setHeader("content-type", "text/html");
        response.end("<html><body><h1>QPilot Public</h1></body></html>");
        return;
      }
      if (url === "/api/platform/ops/summary") {
        response.statusCode = 404;
        response.end("not found");
        return;
      }
      response.statusCode = 404;
      response.end("not found");
      return;
    }
    if (url === "/health") {
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url === "/health/ready") {
      response.statusCode = input.readyStatus ?? 200;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ready: (input.readyStatus ?? 200) === 200 }));
      return;
    }
    if (url === "/login") {
      response.statusCode = 200;
      response.setHeader("content-type", "text/html");
      response.end("<html><body><h1>QPilot Login</h1></body></html>");
      return;
    }
    if (url === "/api/platform/ops/summary") {
      response.statusCode = 401;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ error: "Authentication required." }));
      return;
    }
    if (url === "/api/auth/register") {
      response.statusCode = input.registrationClosed ? 403 : 200;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify(
          input.registrationClosed
            ? { error: "Self-service registration is disabled." }
            : { ok: true }
        )
      );
      return;
    }
    if (url === "/metrics") {
      if (input.metricsMode === "disabled") {
        response.statusCode = 404;
        response.end("disabled");
        return;
      }
      const token = request.headers.authorization;
      if (token === `Bearer ${input.validToken}`) {
        response.statusCode = 200;
        response.end("# HELP qpilot_fixture Fixture metrics");
        return;
      }
      response.statusCode = 401;
      response.end("missing token");
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  });

  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start smoke fixture server.");
  }

  return `http://127.0.0.1:${address.port}`;
};

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        })
    )
  );
});

describe("platform smoke verification", () => {
  it("passes the full smoke suite when the instance is healthy", async () => {
    const baseUrl = await startFixtureServer({
      metricsMode: "enabled",
      validToken: "metrics-token",
      registrationClosed: true
    });
    const publicBaseUrl = await startFixtureServer({
      publicMode: true
    });

    const result = await runPlatformSmokeVerification({
      baseUrl,
      publicBaseUrl,
      metricsToken: "metrics-token",
      expectRegistrationClosed: true,
      timeoutMs: 2_000
    });

    expect(result.ok).toBe(true);
    expect(result.checks.every((check) => check.state !== "failed")).toBe(true);
    expect(result.checks.find((check) => check.key === "metrics_authorized")?.state).toBe(
      "passed"
    );
    expect(result.checks.find((check) => check.key === "public_api_blocked")?.state).toBe(
      "passed"
    );
  });

  it("captures a failing readiness probe without throwing away the rest of the report", async () => {
    const baseUrl = await startFixtureServer({
      readyStatus: 503,
      metricsMode: "enabled",
      validToken: "metrics-token",
      registrationClosed: true
    });

    const result = await runPlatformSmokeVerification({
      baseUrl,
      metricsToken: "metrics-token",
      expectRegistrationClosed: true,
      timeoutMs: 2_000
    });

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.key === "ready")?.state).toBe("failed");
    expect(result.checks.find((check) => check.key === "metrics_authorized")?.state).toBe(
      "passed"
    );
  });

  it("skips the authorized metrics probe when metrics are disabled", async () => {
    const baseUrl = await startFixtureServer({
      metricsMode: "disabled",
      registrationClosed: true
    });

    const result = await runPlatformSmokeVerification({
      baseUrl,
      expectRegistrationClosed: true,
      timeoutMs: 2_000
    });

    expect(result.ok).toBe(true);
    expect(result.checks.find((check) => check.key === "metrics_denied")?.status).toBe(404);
    expect(result.checks.find((check) => check.key === "metrics_authorized")?.state).toBe(
      "skipped"
    );
  });

  it("skips the authorized metrics probe when no bearer token is supplied", async () => {
    const baseUrl = await startFixtureServer({
      metricsMode: "enabled",
      validToken: "metrics-token",
      registrationClosed: true
    });

    const result = await runPlatformSmokeVerification({
      baseUrl,
      expectRegistrationClosed: true,
      timeoutMs: 2_000
    });

    expect(result.ok).toBe(true);
    expect(result.checks.find((check) => check.key === "metrics_denied")?.state).toBe("passed");
    expect(result.checks.find((check) => check.key === "metrics_authorized")?.state).toBe(
      "skipped"
    );
  });
});
