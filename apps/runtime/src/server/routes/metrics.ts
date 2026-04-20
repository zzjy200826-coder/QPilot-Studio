import { env } from "../../config/env.js";
import { getPlatformInfrastructureSummary } from "../../platform/infra-health.js";
import {
  buildPrometheusMetricsDocument,
  collectPlatformMetricsSnapshot
} from "../../platform/metrics.js";
import type { AppFastify } from "../types.js";

export const registerMetricsRoutes = (app: AppFastify): void => {
  app.get("/metrics", async (_request, reply) => {
    if (!env.PLATFORM_METRICS_ENABLED) {
      return reply.status(404).send({ error: "Prometheus metrics are disabled." });
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
