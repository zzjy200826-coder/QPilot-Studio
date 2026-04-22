import {
  RestoreVerificationResultSchema,
  type RestoreVerificationCheck,
  type RestoreVerificationResult
} from "./schemas.js";

type EvaluatedCheck = Omit<RestoreVerificationCheck, "key" | "label" | "checkedAt">;

export interface PlatformSmokeOptions {
  baseUrl: string;
  publicBaseUrl?: string;
  metricsToken?: string;
  expectRegistrationClosed?: boolean;
  timeoutMs?: number;
}

const fetchWithTimeout = async (
  input: string,
  init: RequestInit | undefined,
  timeoutMs: number
): Promise<Response> => {
  const signal = AbortSignal.timeout(timeoutMs);
  return await fetch(input, {
    ...init,
    redirect: init?.redirect ?? "manual",
    signal
  });
};

const createCheck = (input: {
  key: string;
  label: string;
  state: RestoreVerificationCheck["state"];
  detail: string;
  status?: number;
}): RestoreVerificationCheck => ({
  ...input,
  checkedAt: new Date().toISOString()
});

const pushResponseCheck = async (
  checks: RestoreVerificationCheck[],
  input: {
    key: string;
    label: string;
    baseUrl: string;
    path: string;
    timeoutMs: number;
    init?: RequestInit;
    evaluate: (response: Response, body: string) => EvaluatedCheck;
  }
): Promise<Response> => {
  try {
    const response = await fetchWithTimeout(
      `${input.baseUrl}${input.path}`,
      input.init,
      input.timeoutMs
    );
    const body = await response.text();
    checks.push(
      createCheck({
        key: input.key,
        label: input.label,
        ...input.evaluate(response, body)
      })
    );
    return response;
  } catch (error) {
    checks.push(
      createCheck({
        key: input.key,
        label: input.label,
        state: "failed",
        detail: error instanceof Error ? error.message : String(error)
      })
    );
    throw error;
  }
};

export const runPlatformSmokeVerification = async (
  options: PlatformSmokeOptions
): Promise<RestoreVerificationResult> => {
  const checks: RestoreVerificationCheck[] = [];
  const timeoutMs = options.timeoutMs ?? 8_000;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const publicBaseUrl = options.publicBaseUrl?.replace(/\/+$/, "");

  try {
    await pushResponseCheck(checks, {
      key: "health",
      label: "GET /health",
      baseUrl,
      path: "/health",
      timeoutMs,
      evaluate: (response, body) => ({
        state: response.status === 200 ? "passed" : "failed",
        status: response.status,
        detail: response.status === 200 && body.includes('"ok":true') ? "Runtime liveness OK." : body
      })
    });

    await pushResponseCheck(checks, {
      key: "ready",
      label: "GET /health/ready",
      baseUrl,
      path: "/health/ready",
      timeoutMs,
      evaluate: (response, body) => ({
        state: response.status === 200 ? "passed" : "failed",
        status: response.status,
        detail:
          response.status === 200 && body.includes('"ready":true')
            ? "Runtime readiness OK."
            : body
      })
    });

    await pushResponseCheck(checks, {
      key: "login",
      label: "GET /login",
      baseUrl,
      path: "/login",
      timeoutMs,
      evaluate: (response, body) => ({
        state: response.status === 200 ? "passed" : "failed",
        status: response.status,
        detail:
          response.status === 200 && body.toLowerCase().includes("qpilot")
            ? "Login shell reachable."
            : body.slice(0, 160)
      })
    });

    const metricsDeniedResponse = await pushResponseCheck(checks, {
      key: "protected_ops_denied",
      label: "GET /api/platform/ops/summary denied",
      baseUrl,
      path: "/api/platform/ops/summary",
      timeoutMs,
      evaluate: (response, body) => ({
        state: response.status === 401 || response.status === 403 ? "passed" : "failed",
        status: response.status,
        detail:
          response.status === 401 || response.status === 403
            ? "Protected ops API rejected anonymous access."
            : body
      })
    }).catch(() => null);
    void metricsDeniedResponse;

    if (options.expectRegistrationClosed) {
      await pushResponseCheck(checks, {
        key: "registration_closed",
        label: "POST /api/auth/register denied",
        baseUrl,
        path: "/api/auth/register",
        timeoutMs,
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            email: "smoke-check@example.test",
            password: "Password123!",
            displayName: "Smoke Check"
          })
        },
        evaluate: (response, body) => ({
          state: response.status === 403 ? "passed" : "failed",
          status: response.status,
          detail:
            response.status === 403
              ? "Registration is closed for the private workspace."
              : body.slice(0, 160)
        })
      });
    } else {
      checks.push(
        createCheck({
          key: "registration_closed",
          label: "POST /api/auth/register denied",
          state: "skipped",
          detail: "Skipped because private registration closure was not requested."
        })
      );
    }

    const metricsProbe = await pushResponseCheck(checks, {
      key: "metrics_denied",
      label: "GET /metrics denied without bearer",
      baseUrl,
      path: "/metrics",
      timeoutMs,
      evaluate: (response, body) => {
        if (response.status === 404) {
          return {
            state: "passed",
            status: response.status,
            detail: "Prometheus metrics are disabled for this deployment."
          };
        }
        if (response.status === 401 || response.status === 403) {
          return {
            state: "passed",
            status: response.status,
            detail: "Metrics endpoint requires authentication."
          };
        }
        return {
          state: "failed",
          status: response.status,
          detail: body
        };
      }
    }).catch(() => null);

    if (metricsProbe?.status === 404) {
      checks.push(
        createCheck({
          key: "metrics_authorized",
          label: "GET /metrics with bearer",
          state: "skipped",
          status: 404,
          detail: "Skipped because Prometheus metrics are disabled."
        })
      );
    } else if (!options.metricsToken) {
      checks.push(
        createCheck({
          key: "metrics_authorized",
          label: "GET /metrics with bearer",
          state: "skipped",
          detail: "Skipped because no metrics bearer token was supplied."
        })
      );
    } else {
      await pushResponseCheck(checks, {
        key: "metrics_authorized",
        label: "GET /metrics with bearer",
        baseUrl,
        path: "/metrics",
        timeoutMs,
        init: {
          headers: {
            Authorization: `Bearer ${options.metricsToken}`
          }
        },
        evaluate: (response, body) => ({
          state: response.status === 200 ? "passed" : "failed",
          status: response.status,
          detail:
            response.status === 200 && body.includes("# HELP")
              ? "Prometheus document received."
              : body.slice(0, 160)
        })
      });
    }

    if (publicBaseUrl) {
      await pushResponseCheck(checks, {
        key: "public_home",
        label: "GET public /",
        baseUrl: publicBaseUrl,
        path: "/",
        timeoutMs,
        evaluate: (response, body) => ({
          state: response.status === 200 ? "passed" : "failed",
          status: response.status,
          detail:
            response.status === 200
              ? "Public marketing site reachable."
              : body.slice(0, 160)
        })
      });

      await pushResponseCheck(checks, {
        key: "public_api_blocked",
        label: "GET public /api/platform/ops/summary blocked",
        baseUrl: publicBaseUrl,
        path: "/api/platform/ops/summary",
        timeoutMs,
        evaluate: (response, body) => ({
          state: response.status === 403 || response.status === 404 || response.status === 405 ? "passed" : "failed",
          status: response.status,
          detail:
            response.status === 403 || response.status === 404 || response.status === 405
              ? "Public site does not expose the private runtime API."
              : body.slice(0, 160)
        })
      });
    }
  } catch {
    // Individual failures are already recorded into checks.
  }

  const result = {
    ok: checks.every((check) => check.state !== "failed"),
    checkedAt: new Date().toISOString(),
    baseUrl,
    checks
  };

  return RestoreVerificationResultSchema.parse(result);
};
