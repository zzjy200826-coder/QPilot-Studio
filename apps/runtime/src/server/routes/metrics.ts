import { env } from "../../config/env.js";
import { getPlatformInfrastructureSummary } from "../../platform/infra-health.js";
import {
  buildPrometheusMetricsDocument,
  collectPlatformMetricsSnapshot
} from "../../platform/metrics.js";
import type { AppFastify } from "../types.js";

const extractBearerToken = (authorization?: string | string[]): string | null => {
  const value = Array.isArray(authorization) ? authorization[0] : authorization;
  if (!value) {
    return null;
  }
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
};

export const checkMetricsAccess = (authorization?: string | string[]) => {
  if (!env.PLATFORM_METRICS_ENABLED) {
    return { allowed: false, statusCode: 404, error: "Prometheus metrics are disabled." };
  }

  const configuredToken = env.METRICS_BEARER_TOKEN?.trim();
  if (env.NODE_ENV === "production" && !configuredToken) {
    return {
      allowed: false,
      statusCode: 403,
      error: "Prometheus metrics require METRICS_BEARER_TOKEN in production."
    };
  }

  if (!configuredToken) {
    return { allowed: true as const };
  }

  const token = extractBearerToken(authorization);
  if (token !== configuredToken) {
    return {
      allowed: false,
      statusCode: 401,
      error: "Prometheus metrics require a valid bearer token."
    };
  }

  return { allowed: true as const };
};

export const registerMetricsRoutes = (app: AppFastify): void => {
  app.get("/metrics", async (request, reply) => {
    const access = checkMetricsAccess(request.headers.authorization);
    if (!access.allowed) {
      return reply.status(access.statusCode).send({ error: access.error });
    }

    const infrastructure = await getPlatformInfrastructureSummary();
    const snapshot = await collectPlatformMetricsSnapshot({
      db: app.appContext.db,
      infrastructure
    });

    return reply
      .type("text/plain; version=0.0.4; charset=utf-8")
      .send(buildPrometheusMetricsDocument(snapshot));
  });
};
