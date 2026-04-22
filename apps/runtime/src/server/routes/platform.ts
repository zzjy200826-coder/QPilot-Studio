import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  ControlTowerSummarySchema,
  EnvironmentTopologySchema,
  EnvironmentRegistrySchema,
  EnvironmentRiskLevelSchema,
  EnvironmentTargetSchema,
  GatePolicySchema,
  GatePolicyVersionSchema,
  InjectorPoolSchema,
  LoadArrivalModelSchema,
  LoadExecutionModeSchema,
  LoadHttpMethodSchema,
  LoadPatternSchema,
  LoadProfileSchema,
  LoadProfileVersionSchema,
  LoadRunCompareSchema,
  OpsSummarySchema,
  LoadRunDetailSchema,
  LoadRunSeriesSchema,
  LoadRunSampleWindowSchema,
  LoadRunSchema,
  PlatformInfrastructureSummarySchema,
  ReleaseCandidateSchema,
  ReleaseAuditSchema,
  ReleaseGateDetailSchema,
  WaiverSchema
} from "@qpilot/shared";
import { z } from "zod";
import { buildLoadRunCompare, buildLoadRunDetail } from "../../analytics/load-insights.js";
import { buildBenchmarkSummary } from "../../analytics/run-insights.js";
import { requireAuth, requireMinimumRole, requireRoleOrScope } from "../../auth/guards.js";
import {
  getTenantEnvironmentRow,
  getTenantGatePolicyRow,
  getTenantLoadProfileRow,
  getTenantLoadRunRow,
  getTenantProjectRow,
  getTenantReleaseRow
} from "../../auth/tenant-access.js";
import { env } from "../../config/env.js";
import {
  approvalEventsTable,
  caseTemplatesTable,
  environmentServiceNodesTable,
  environmentTargetsTable,
  gatePoliciesTable,
  gatePolicyVersionsTable,
  injectorPoolsTable,
  injectorWorkersTable,
  loadProfileBaselineEventsTable,
  loadProfilesTable,
  loadProfileVersionsTable,
  loadRunSampleWindowsTable,
  loadRunWorkersTable,
  loadRunsTable,
  projectsTable,
  releaseCandidatesTable,
  releaseGateResultsTable,
  runsTable,
  waiversTable
} from "../../db/schema.js";
import {
  buildControlTowerSummary,
  buildReleaseGateResult,
  scopeReleaseEvidence
} from "../../platform/gate-center.js";
import { getPlatformInfrastructureSummary } from "../../platform/infra-health.js";
import {
  createPlatformLoadRunRecord,
  executePersistedPlatformLoadRun,
  recoverTimedOutPlatformLoadRuns,
  stopQueuedPlatformLoadRun
} from "../../platform/load-control-plane.js";
import { buildOpsSummary } from "../../platform/ops-alerts.js";
import {
  buildPlatformQueueSummary,
  listInjectorWorkers
} from "../../platform/queue-health.js";
import {
  buildCachedLoadRunSeries,
  fetchPrometheusLoadRunSeries
} from "../../platform/prometheus-series.js";
import {
  createGatePolicyVersionSnapshot,
  createLoadProfileVersionSnapshot,
  listGatePolicyVersions,
  listLoadProfileVersions,
  rollbackLoadProfileVersion
} from "../../platform/versioning.js";
import {
  enrichLoadRunWorkersWithHeartbeat
} from "../../platform/worker-heartbeat.js";
import {
  mapApprovalEventRow,
  mapCaseTemplateRow,
  mapEnvironmentServiceNodeRow,
  mapEnvironmentTargetRow,
  mapGatePolicyRow,
  mapGatePolicyVersionRow,
  mapGateResultRow,
  mapInjectorPoolRow,
  mapInjectorWorkerRow,
  mapLoadProfileBaselineEventRow,
  mapLoadProfileRow,
  mapLoadProfileVersionRow,
  mapLoadRunRow,
  mapLoadRunSampleWindowRow,
  mapLoadRunWorkerRow,
  mapReleaseCandidateRow,
  mapRunRow,
  mapWaiverRow,
  type ApprovalEventRow,
  type CaseTemplateRow,
  type EnvironmentServiceNodeRow,
  type EnvironmentTargetRow,
  type GatePolicyRow,
  type GatePolicyVersionRow,
  type GateResultRow,
  type InjectorPoolRow,
  type InjectorWorkerRow,
  type LoadProfileBaselineEventRow,
  type LoadProfileRow,
  type LoadProfileVersionRow,
  type LoadRunRow,
  type LoadRunSampleWindowRow,
  type LoadRunWorkerRow,
  type ReleaseCandidateRow,
  type RunRow,
  type WaiverRow
} from "../../utils/mappers.js";
import type { AppFastify } from "../types.js";

const listQuerySchema = z.object({
  projectId: z.string().optional(),
  profileId: z.string().optional(),
  releaseId: z.string().optional(),
  environmentId: z.string().optional(),
  status: z.string().optional(),
  verdict: z.string().optional(),
  baselineRunId: z.string().optional(),
  candidateRunId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(40)
});

const loadRunCompareQuerySchema = z.object({
  baselineRunId: z.string().optional(),
  candidateRunId: z.string().optional()
});

const createEnvironmentSchema = z.object({
  projectId: z.string().optional(),
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().url(),
  authType: z.string().trim().min(1).max(40).default("none"),
  owner: z.string().trim().max(80).optional(),
  riskLevel: EnvironmentRiskLevelSchema.default("medium"),
  serviceNodes: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        protocol: z.string().trim().min(1).max(24).default("http"),
        baseUrl: z.string().url(),
        healthPath: z.string().trim().max(120).optional(),
        dependsOnIds: z.array(z.string()).default([]),
        tags: z.array(z.string()).default([])
      })
    )
    .default([])
});

const createInjectorPoolSchema = z.object({
  name: z.string().trim().min(1).max(80),
  region: z.string().trim().min(1).max(40),
  capacity: z.coerce.number().int().positive().max(10_000),
  concurrencyLimit: z.coerce.number().int().positive().max(10_000),
  tags: z.array(z.string()).default([]),
  workers: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        capacity: z.coerce.number().int().positive().max(10_000)
      })
    )
    .default([])
});

const createGatePolicySchema = z.object({
  projectId: z.string(),
  name: z.string().trim().min(1).max(80),
  requiredFunctionalFlows: z.array(z.string()).default([]),
  minBenchmarkCoveragePct: z.coerce.number().min(0).max(100).default(0),
  minBenchmarkPassRate: z.coerce.number().min(0).max(100).default(0),
  requiredLoadProfileIds: z.array(z.string()).default([]),
  minimumLoadVerdict: z.enum(["ship", "watch", "hold"]).default("watch"),
  allowWaiver: z.boolean().default(false),
  approverRoles: z.array(z.string()).default([]),
  expiresAt: z.string().datetime().optional()
});

const bindingIdListSchema = z
  .array(z.string().trim().min(1).max(120))
  .default([])
  .transform((items) => [...new Set(items)]);

const createReleaseSchema = z.object({
  projectId: z.string(),
  environmentId: z.string().optional(),
  gatePolicyId: z.string(),
  name: z.string().trim().min(1).max(80),
  buildLabel: z.string().trim().min(1).max(120),
  buildId: z.string().trim().min(1).max(120).optional(),
  commitSha: z.string().trim().min(7).max(64).optional(),
  sourceRunIds: bindingIdListSchema,
  sourceLoadRunIds: bindingIdListSchema,
  notes: z.string().trim().max(400).optional()
});

const createWaiverSchema = z.object({
  releaseId: z.string(),
  blockerKey: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(400),
  requestedBy: z.string().trim().min(1).max(80),
  approvedBy: z.string().trim().max(80).optional(),
  role: z.string().trim().max(80).default("release-manager"),
  expiresAt: z.string().datetime()
});

const createApprovalSchema = z.object({
  actor: z.string().trim().min(1).max(80),
  role: z.string().trim().min(1).max(80),
  action: z.string().trim().min(1).max(80),
  detail: z.string().trim().max(400).optional()
});

const createPlatformLoadProfileSchema = z
  .object({
    projectId: z.string(),
    name: z.string().trim().min(1).max(80),
    scenarioLabel: z.string().trim().min(1).max(120),
    targetBaseUrl: z.string().url(),
    environmentTargetId: z.string().optional(),
    engine: z.enum(["synthetic", "browser_probe", "k6_http"]).default("synthetic"),
    pattern: LoadPatternSchema.default("steady"),
    requestPath: z.string().trim().min(1).max(280).optional(),
    httpMethod: LoadHttpMethodSchema.optional(),
    headersJson: z.string().trim().max(4_000).optional(),
    bodyTemplate: z.string().max(20_000).optional(),
    executionMode: LoadExecutionModeSchema.default("local"),
    workerCount: z.coerce.number().int().positive().max(128).default(1),
    injectorPoolId: z.string().optional(),
    arrivalModel: LoadArrivalModelSchema.default("closed"),
    phasePlanJson: z.string().max(20_000).optional(),
    requestMixJson: z.string().max(20_000).optional(),
    evidencePolicyJson: z.string().max(20_000).optional(),
    gatePolicyId: z.string().optional(),
    tagsJson: z.string().max(4_000).optional(),
    virtualUsers: z.coerce.number().int().positive().max(10_000),
    durationSec: z.coerce.number().int().positive().max(86_400),
    rampUpSec: z.coerce.number().int().nonnegative().max(14_400),
    targetRps: z.coerce.number().positive().max(100_000).optional(),
    thresholds: z.object({
      maxP95Ms: z.number().positive(),
      maxErrorRatePct: z.number().min(0),
      minThroughputRps: z.number().nonnegative()
    })
  })
  .superRefine((payload, context) => {
    if (payload.engine === "k6_http") {
      if (!payload.requestPath) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["requestPath"],
          message: "requestPath is required for k6_http profiles."
        });
      }
      if (!payload.httpMethod) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["httpMethod"],
          message: "httpMethod is required for k6_http profiles."
        });
      }
    }
    if (payload.executionMode === "distributed" && payload.workerCount < 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workerCount"],
        message: "distributed profiles must schedule at least 2 workers."
      });
    }
  });

const createPlatformLoadRunSchema = z.object({
  profileId: z.string(),
  environmentId: z.string().optional(),
  environmentLabel: z.string().trim().min(1).max(60).default("staging"),
  notes: z.string().trim().max(280).optional()
});

const setBaselineSchema = z.object({
  runId: z.string()
});

const paramsWithIdSchema = z.object({
  id: z.string()
});

const rollbackVersionSchema = z.object({
  versionId: z.string()
});

const runIdParamsSchema = z.object({
  runId: z.string()
});

const retryPlatformLoadRunSchema = z.object({
  notes: z.string().trim().max(280).optional()
});

const releaseIdParamsSchema = z.object({
  releaseId: z.string()
});

const buildCondition = (
  values: Array<ReturnType<typeof eq> | undefined>
): ReturnType<typeof and> | ReturnType<typeof eq> | undefined => {
  const clauses = values.filter(Boolean);
  if (clauses.length === 0) {
    return undefined;
  }
  if (clauses.length === 1) {
    return clauses[0];
  }
  return and(...clauses);
};

const toEpoch = (value: string): number => Date.parse(value);

const validateReleaseBindings = async (
  app: AppFastify,
  tenantId: string,
  payload: z.infer<typeof createReleaseSchema>
): Promise<string | null> => {
  const policyRow = await getTenantGatePolicyRow(
    app.appContext.db,
    tenantId,
    payload.gatePolicyId
  );
  if (!policyRow) {
    return "Gate policy not found.";
  }
  if (policyRow.projectId !== payload.projectId) {
    return "Gate policy does not belong to the selected project.";
  }

  if (payload.environmentId) {
    const environmentRow = await getTenantEnvironmentRow(
      app.appContext.db,
      tenantId,
      payload.environmentId
    );
    if (!environmentRow) {
      return "Environment not found.";
    }
    if (environmentRow.projectId && environmentRow.projectId !== payload.projectId) {
      return "Environment does not belong to the selected project.";
    }
  }

  if (payload.sourceRunIds.length > 0) {
    const runRows = (await app.appContext.db
      .select()
      .from(runsTable)
      .where(and(eq(runsTable.projectId, payload.projectId), eq(runsTable.tenantId, tenantId)))) as RunRow[];
    const projectRunIds = new Set(runRows.map((row) => row.id));
    const invalidIds = payload.sourceRunIds.filter((id) => !projectRunIds.has(id));
    if (invalidIds.length > 0) {
      return `Some source runs do not belong to this project: ${invalidIds.join(", ")}.`;
    }
  }

  if (payload.sourceLoadRunIds.length > 0) {
    const loadRunRows = (await app.appContext.db
      .select()
      .from(loadRunsTable)
      .where(and(eq(loadRunsTable.projectId, payload.projectId), eq(loadRunsTable.tenantId, tenantId)))) as LoadRunRow[];
    const projectLoadRunIds = new Set(loadRunRows.map((row) => row.id));
    const invalidIds = payload.sourceLoadRunIds.filter((id) => !projectLoadRunIds.has(id));
    if (invalidIds.length > 0) {
      return `Some source load runs do not belong to this project: ${invalidIds.join(", ")}.`;
    }
  }

  return null;
};

const upsertGateResult = async (
  app: AppFastify,
  tenantId: string,
  gateResult: z.infer<typeof ReleaseGateDetailSchema>["result"]
) => {
  await app.appContext.db
    .delete(releaseGateResultsTable)
    .where(eq(releaseGateResultsTable.releaseId, gateResult.releaseId));

  await app.appContext.db.insert(releaseGateResultsTable).values({
    id: gateResult.id,
    tenantId,
    releaseId: gateResult.releaseId,
    verdict: gateResult.verdict,
    summary: gateResult.summary,
    blockersJson: JSON.stringify(gateResult.blockers),
    signalsJson: JSON.stringify(gateResult.signals),
    waiverCount: gateResult.waiverCount,
    evaluatedAt: toEpoch(gateResult.evaluatedAt)
  });
};

const buildReleaseGateDetail = async (
  app: AppFastify,
  tenantId: string,
  releaseId: string
): Promise<z.infer<typeof ReleaseGateDetailSchema>> => {
  const releaseRow = await getTenantReleaseRow(app.appContext.db, tenantId, releaseId);
  if (!releaseRow) {
    throw new Error("Release not found.");
  }

  const policyRow = await getTenantGatePolicyRow(
    app.appContext.db,
    tenantId,
    releaseRow.gatePolicyId
  );
  if (!policyRow) {
    throw new Error("Gate policy not found.");
  }

  const runRows = (await app.appContext.db
    .select()
    .from(runsTable)
    .where(and(eq(runsTable.projectId, releaseRow.projectId), eq(runsTable.tenantId, tenantId)))
    .orderBy(desc(runsTable.createdAt))) as RunRow[];
  const caseRows = (await app.appContext.db
    .select()
    .from(caseTemplatesTable)
    .where(and(eq(caseTemplatesTable.projectId, releaseRow.projectId), eq(caseTemplatesTable.tenantId, tenantId)))) as CaseTemplateRow[];
  const loadProfileRows = (await app.appContext.db
    .select()
    .from(loadProfilesTable)
    .where(and(eq(loadProfilesTable.projectId, releaseRow.projectId), eq(loadProfilesTable.tenantId, tenantId)))) as LoadProfileRow[];
  const loadRunRows = (await app.appContext.db
    .select()
    .from(loadRunsTable)
    .where(and(eq(loadRunsTable.projectId, releaseRow.projectId), eq(loadRunsTable.tenantId, tenantId)))
    .orderBy(desc(loadRunsTable.createdAt))) as LoadRunRow[];
  const waiverRows = (await app.appContext.db
    .select()
    .from(waiversTable)
    .where(and(eq(waiversTable.releaseId, releaseId), eq(waiversTable.tenantId, tenantId)))
    .orderBy(desc(waiversTable.createdAt))) as WaiverRow[];
  const approvalRows = (await app.appContext.db
    .select()
    .from(approvalEventsTable)
    .where(and(eq(approvalEventsTable.releaseId, releaseId), eq(approvalEventsTable.tenantId, tenantId)))
    .orderBy(desc(approvalEventsTable.createdAt))) as ApprovalEventRow[];

  const release = mapReleaseCandidateRow(releaseRow);
  const policy = mapGatePolicyRow(policyRow);
  const mappedRuns = runRows.map(mapRunRow);
  const mappedLoadRuns = loadRunRows.map(mapLoadRunRow);
  const mappedCaseTemplates = caseRows.map(mapCaseTemplateRow);
  const scopedEvidence = scopeReleaseEvidence({
    release,
    projectRuns: mappedRuns,
    loadRuns: mappedLoadRuns
  });
  const benchmark = buildBenchmarkSummary({
    projectId: release.projectId,
    caseTemplates: mappedCaseTemplates,
    runs: scopedEvidence.projectRuns
  });
  const result = buildReleaseGateResult({
    release,
    policy,
    projectRuns: scopedEvidence.projectRuns,
    caseTemplates: mappedCaseTemplates,
    benchmark,
    loadProfiles: loadProfileRows.map(mapLoadProfileRow),
    loadRuns: scopedEvidence.loadRuns,
    waivers: waiverRows.map(mapWaiverRow)
  });

  await upsertGateResult(app, tenantId, result);

  const nextStatus =
    result.verdict === "hold"
      ? "hold"
      : result.verdict === "watch" && result.waiverCount > 0
        ? "waived"
        : result.verdict;

  await app.appContext.db
    .update(releaseCandidatesTable)
    .set({
      status: nextStatus,
      updatedAt: Date.now()
    })
    .where(eq(releaseCandidatesTable.id, releaseId));

  return ReleaseGateDetailSchema.parse({
    release: {
      ...release,
      status: nextStatus
    },
    policy,
    result,
    waivers: waiverRows.map(mapWaiverRow),
    approvalTimeline: approvalRows.map(mapApprovalEventRow)
  });
};

const getLoadProfileRowById = async (
  app: AppFastify,
  tenantId: string,
  profileId: string
): Promise<LoadProfileRow | undefined> => {
  return getTenantLoadProfileRow(app.appContext.db, tenantId, profileId);
};

const getLoadRunRowById = async (
  app: AppFastify,
  tenantId: string,
  runId: string
): Promise<LoadRunRow | undefined> => {
  return getTenantLoadRunRow(app.appContext.db, tenantId, runId);
};

const listBaselineEvents = async (
  app: AppFastify,
  tenantId: string,
  profileId: string
) => {
  const rows = (await app.appContext.db
    .select()
    .from(loadProfileBaselineEventsTable)
    .where(and(eq(loadProfileBaselineEventsTable.profileId, profileId), eq(loadProfileBaselineEventsTable.tenantId, tenantId)))
    .orderBy(desc(loadProfileBaselineEventsTable.createdAt))) as LoadProfileBaselineEventRow[];
  return rows.map(mapLoadProfileBaselineEventRow);
};

export const registerPlatformRoutes = (app: AppFastify): void => {
  app.get("/api/platform/control-tower", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) {
      return;
    }
    const query = listQuerySchema.parse(request.query);
    if (query.projectId) {
      const projectRow = await getTenantProjectRow(app.appContext.db, auth.tenant.id, query.projectId);
      if (!projectRow) {
        return reply.status(404).send({ error: "Project not found." });
      }
    }
    const releaseRows = (await app.appContext.db
      .select()
      .from(releaseCandidatesTable)
      .where(
        buildCondition([
          eq(releaseCandidatesTable.tenantId, auth.tenant.id),
          query.projectId ? eq(releaseCandidatesTable.projectId, query.projectId) : undefined
        ])
      )
      .orderBy(desc(releaseCandidatesTable.createdAt))) as ReleaseCandidateRow[];
    const gateRows = (await app.appContext.db
      .select()
      .from(releaseGateResultsTable)
      .where(eq(releaseGateResultsTable.tenantId, auth.tenant.id))
      .orderBy(desc(releaseGateResultsTable.evaluatedAt))) as GateResultRow[];
    const loadRunRows = (await app.appContext.db
      .select()
      .from(loadRunsTable)
      .where(
        buildCondition([
          eq(loadRunsTable.tenantId, auth.tenant.id),
          query.projectId ? eq(loadRunsTable.projectId, query.projectId) : undefined
        ])
      )
      .orderBy(desc(loadRunsTable.createdAt))) as LoadRunRow[];
    const injectorWorkers = await listInjectorWorkers(app.appContext.db, auth.tenant.id);

    return ControlTowerSummarySchema.parse(
      buildControlTowerSummary({
        releases: releaseRows.map(mapReleaseCandidateRow),
        gateResults: gateRows.map(mapGateResultRow),
        loadRuns: loadRunRows.map(mapLoadRunRow),
        injectorWorkers
      })
    );
  });

  app.get("/api/platform/infra", async () =>
    PlatformInfrastructureSummarySchema.parse(await getPlatformInfrastructureSummary())
  );

  app.get("/api/platform/load/queue", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) {
      return;
    }
    return buildPlatformQueueSummary({
      db: app.appContext.db,
      platformLoadQueue: app.appContext.platformLoadQueue,
      tenantId: auth.tenant.id
    });
  });

  app.get("/api/platform/ops/summary", async (request, reply) => {
    const auth = requireMinimumRole(request, reply, "owner");
    if (!auth) {
      return;
    }

    return OpsSummarySchema.parse(
      await buildOpsSummary(
        {
          db: app.appContext.db,
          dbClient: app.appContext.dbClient,
          platformLoadQueue: app.appContext.platformLoadQueue,
          maintenanceState: () => app.appContext.backupRuntime.getMaintenanceState()
        },
        auth.tenant.id
      )
    );
  });

  app.get("/api/platform/environments", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) {
      return;
    }
    const query = listQuerySchema.parse(request.query);
    if (query.projectId) {
      const projectRow = await getTenantProjectRow(app.appContext.db, auth.tenant.id, query.projectId);
      if (!projectRow) {
        return reply.status(404).send({ error: "Project not found." });
      }
    }
    const environmentRows = (await app.appContext.db
      .select()
      .from(environmentTargetsTable)
      .where(
        buildCondition([
          eq(environmentTargetsTable.tenantId, auth.tenant.id),
          query.projectId ? eq(environmentTargetsTable.projectId, query.projectId) : undefined
        ])
      )
      .orderBy(desc(environmentTargetsTable.updatedAt))) as EnvironmentTargetRow[];
    const serviceRows = (await app.appContext.db
      .select()
      .from(environmentServiceNodesTable)
      .where(eq(environmentServiceNodesTable.tenantId, auth.tenant.id))
      .orderBy(desc(environmentServiceNodesTable.updatedAt))) as EnvironmentServiceNodeRow[];
    const poolRows = (await app.appContext.db
      .select()
      .from(injectorPoolsTable)
      .where(eq(injectorPoolsTable.tenantId, auth.tenant.id))
      .orderBy(desc(injectorPoolsTable.updatedAt))) as InjectorPoolRow[];
    const workerRows = (await app.appContext.db
      .select()
      .from(injectorWorkersTable)
      .where(eq(injectorWorkersTable.tenantId, auth.tenant.id))
      .orderBy(desc(injectorWorkersTable.updatedAt))) as InjectorWorkerRow[];

    return EnvironmentRegistrySchema.parse({
      environments: environmentRows.map(mapEnvironmentTargetRow),
      serviceNodes: serviceRows.map(mapEnvironmentServiceNodeRow),
      injectorPools: poolRows.map(mapInjectorPoolRow),
      injectorWorkers: workerRows.map(mapInjectorWorkerRow)
    });
  });

  app.get("/api/platform/environments/:id/topology", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) {
      return;
    }
    const params = paramsWithIdSchema.parse(request.params);
    const environmentRow = await getTenantEnvironmentRow(
      app.appContext.db,
      auth.tenant.id,
      params.id
    );
    if (!environmentRow) {
      return reply.status(404).send({ error: "Environment not found." });
    }

    const serviceRows = (await app.appContext.db
      .select()
      .from(environmentServiceNodesTable)
      .where(and(eq(environmentServiceNodesTable.environmentId, params.id), eq(environmentServiceNodesTable.tenantId, auth.tenant.id)))
      .orderBy(desc(environmentServiceNodesTable.updatedAt))) as EnvironmentServiceNodeRow[];
    const poolRows = (await app.appContext.db
      .select()
      .from(injectorPoolsTable)
      .where(eq(injectorPoolsTable.tenantId, auth.tenant.id))
      .orderBy(desc(injectorPoolsTable.updatedAt))) as InjectorPoolRow[];
    const workerRows = (await app.appContext.db
      .select()
      .from(injectorWorkersTable)
      .where(eq(injectorWorkersTable.tenantId, auth.tenant.id))
      .orderBy(desc(injectorWorkersTable.updatedAt))) as InjectorWorkerRow[];

    return EnvironmentTopologySchema.parse({
      environment: mapEnvironmentTargetRow(environmentRow),
      serviceNodes: serviceRows.map(mapEnvironmentServiceNodeRow),
      injectorPools: poolRows.map(mapInjectorPoolRow),
      injectorWorkers: workerRows.map(mapInjectorWorkerRow)
    });
  });

  app.post("/api/platform/environments", async (request, reply) => {
    const auth = requireMinimumRole(request, reply, "owner");
    if (!auth) {
      return;
    }
    const payload = createEnvironmentSchema.parse(request.body);
    if (payload.projectId) {
      const projectRow = await getTenantProjectRow(app.appContext.db, auth.tenant.id, payload.projectId);
      if (!projectRow) {
        return reply.status(404).send({ error: "Project not found." });
      }
    }
    const now = Date.now();
    const environmentId = nanoid();

    await app.appContext.db.insert(environmentTargetsTable).values({
      id: environmentId,
      tenantId: auth.tenant.id,
      projectId: payload.projectId ?? null,
      name: payload.name,
      baseUrl: payload.baseUrl,
      authType: payload.authType,
      owner: payload.owner ?? null,
      riskLevel: payload.riskLevel,
      createdAt: now,
      updatedAt: now
    });

    for (const serviceNode of payload.serviceNodes) {
      await app.appContext.db.insert(environmentServiceNodesTable).values({
        id: nanoid(),
        tenantId: auth.tenant.id,
        environmentId,
        name: serviceNode.name,
        protocol: serviceNode.protocol,
        baseUrl: serviceNode.baseUrl,
        healthPath: serviceNode.healthPath ?? null,
        dependsOnJson: JSON.stringify(serviceNode.dependsOnIds),
        tagsJson: JSON.stringify(serviceNode.tags),
        createdAt: now,
        updatedAt: now
      });
    }

    const rows = (await app.appContext.db
      .select()
      .from(environmentTargetsTable)
      .where(eq(environmentTargetsTable.id, environmentId))
      .limit(1)) as EnvironmentTargetRow[];
    const row = rows[0];
    if (!row) {
      return reply.status(500).send({ error: "Failed to create environment." });
    }
    return EnvironmentTargetSchema.parse(mapEnvironmentTargetRow(row));
  });

  app.get("/api/platform/injectors", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) {
      return;
    }
    const poolRows = (await app.appContext.db
      .select()
      .from(injectorPoolsTable)
      .where(eq(injectorPoolsTable.tenantId, auth.tenant.id))
      .orderBy(desc(injectorPoolsTable.updatedAt))) as InjectorPoolRow[];
    const workerRows = (await app.appContext.db
      .select()
      .from(injectorWorkersTable)
      .where(eq(injectorWorkersTable.tenantId, auth.tenant.id))
      .orderBy(desc(injectorWorkersTable.updatedAt))) as InjectorWorkerRow[];

    return {
      pools: poolRows.map(mapInjectorPoolRow),
      workers: workerRows.map(mapInjectorWorkerRow)
    };
  });

  app.post("/api/platform/injectors", async (request, reply) => {
    const auth = requireMinimumRole(request, reply, "owner");
    if (!auth) {
      return;
    }
    const payload = createInjectorPoolSchema.parse(request.body);
    const now = Date.now();
    const poolId = nanoid();

    await app.appContext.db.insert(injectorPoolsTable).values({
      id: poolId,
      tenantId: auth.tenant.id,
      name: payload.name,
      region: payload.region,
      capacity: payload.capacity,
      concurrencyLimit: payload.concurrencyLimit,
      tagsJson: JSON.stringify(payload.tags),
      createdAt: now,
      updatedAt: now
    });

    const workers =
      payload.workers.length > 0
        ? payload.workers
        : Array.from({ length: Math.min(payload.capacity, 2) }, (_, index) => ({
            name: `${payload.name}-worker-${index + 1}`,
            capacity: Math.max(
              1,
              Math.round(payload.concurrencyLimit / Math.max(1, payload.capacity))
            )
          }));

    for (const worker of workers) {
      await app.appContext.db.insert(injectorWorkersTable).values({
        id: nanoid(),
        tenantId: auth.tenant.id,
        poolId,
        name: worker.name,
        status: "online",
        currentRunCount: 0,
        capacity: worker.capacity,
        lastHeartbeatAt: now,
        createdAt: now,
        updatedAt: now
      });
    }

    const rows = (await app.appContext.db
      .select()
      .from(injectorPoolsTable)
      .where(eq(injectorPoolsTable.id, poolId))
      .limit(1)) as InjectorPoolRow[];
    return InjectorPoolSchema.parse(mapInjectorPoolRow(rows[0]!));
  });

  app.get("/api/platform/gate-policies", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) {
      return;
    }
    const query = listQuerySchema.parse(request.query);
    if (query.projectId) {
      const projectRow = await getTenantProjectRow(app.appContext.db, auth.tenant.id, query.projectId);
      if (!projectRow) {
        return reply.status(404).send({ error: "Project not found." });
      }
    }
    const rows = (await app.appContext.db
      .select()
      .from(gatePoliciesTable)
      .where(
        buildCondition([
          eq(gatePoliciesTable.tenantId, auth.tenant.id),
          query.projectId ? eq(gatePoliciesTable.projectId, query.projectId) : undefined
        ])
      )
      .orderBy(desc(gatePoliciesTable.updatedAt))) as GatePolicyRow[];

    return rows.map((row) => GatePolicySchema.parse(mapGatePolicyRow(row)));
  });

  app.post("/api/platform/gate-policies", async (request, reply) => {
    const auth = requireMinimumRole(request, reply, "owner");
    if (!auth) {
      return;
    }
    const payload = createGatePolicySchema.parse(request.body);
    const project = await getTenantProjectRow(app.appContext.db, auth.tenant.id, payload.projectId);
    if (!project) {
      return reply.status(404).send({ error: "Project not found." });
    }

    const now = Date.now();
    const id = nanoid();
    await app.appContext.db.insert(gatePoliciesTable).values({
      id,
      tenantId: auth.tenant.id,
      projectId: payload.projectId,
      name: payload.name,
      requiredFunctionalFlowsJson: JSON.stringify(payload.requiredFunctionalFlows),
      minBenchmarkCoveragePct: Math.round(payload.minBenchmarkCoveragePct),
      minBenchmarkPassRate: Math.round(payload.minBenchmarkPassRate),
      requiredLoadProfileIdsJson: JSON.stringify(payload.requiredLoadProfileIds),
      minimumLoadVerdict: payload.minimumLoadVerdict,
      allowWaiver: payload.allowWaiver ? 1 : 0,
      approverRolesJson: JSON.stringify(payload.approverRoles),
      expiresAt: payload.expiresAt ? toEpoch(payload.expiresAt) : null,
      createdAt: now,
      updatedAt: now
    });

    const rows = (await app.appContext.db
      .select()
      .from(gatePoliciesTable)
      .where(eq(gatePoliciesTable.id, id))
      .limit(1)) as GatePolicyRow[];
    const policy = GatePolicySchema.parse(mapGatePolicyRow(rows[0]!));
    await createGatePolicyVersionSnapshot({
      db: app.appContext.db,
      policy,
      status: "active",
      reason: "Initial policy snapshot."
    });
    return policy;
  });

  app.get("/api/platform/gate-policies/:id/versions", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) {
      return;
    }
    const params = paramsWithIdSchema.parse(request.params);
    const policyRow = await getTenantGatePolicyRow(app.appContext.db, auth.tenant.id, params.id);
    if (!policyRow) {
      return reply.status(404).send({ error: "Gate policy not found." });
    }

    const versions = await listGatePolicyVersions(app.appContext.db, params.id);
    return versions.map((version) => GatePolicyVersionSchema.parse(version));
  });

  app.get("/api/platform/load/profiles", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) {
      return;
    }
    const query = listQuerySchema.parse(request.query);
    if (query.projectId) {
      const projectRow = await getTenantProjectRow(app.appContext.db, auth.tenant.id, query.projectId);
      if (!projectRow) {
        return reply.status(404).send({ error: "Project not found." });
      }
    }
    const rows = (await app.appContext.db
      .select()
      .from(loadProfilesTable)
      .where(
        buildCondition([
          eq(loadProfilesTable.tenantId, auth.tenant.id),
          query.projectId ? eq(loadProfilesTable.projectId, query.projectId) : undefined
        ])
      )
      .orderBy(desc(loadProfilesTable.updatedAt))) as LoadProfileRow[];

    return rows.map((row) => LoadProfileSchema.parse(mapLoadProfileRow(row)));
  });

  app.post("/api/platform/load/profiles", async (request, reply) => {
    const auth = requireMinimumRole(request, reply, "member");
    if (!auth) {
      return;
    }
    const payload = createPlatformLoadProfileSchema.parse(request.body);
    const project = await getTenantProjectRow(app.appContext.db, auth.tenant.id, payload.projectId);
    if (!project) {
      return reply.status(404).send({ error: "Project not found." });
    }

    const now = Date.now();
    const id = nanoid();
    await app.appContext.db.insert(loadProfilesTable).values({
      id,
      tenantId: auth.tenant.id,
      projectId: payload.projectId,
      name: payload.name,
      scenarioLabel: payload.scenarioLabel,
      targetBaseUrl: payload.targetBaseUrl,
      environmentTargetId: payload.environmentTargetId ?? null,
      engine: payload.engine,
      pattern: payload.pattern,
      requestPath: payload.requestPath ?? null,
      httpMethod: payload.httpMethod ?? null,
      headersJson: payload.headersJson ?? null,
      bodyTemplate: payload.bodyTemplate ?? null,
      executionMode: payload.executionMode,
      workerCount: payload.workerCount,
      injectorPoolId: payload.injectorPoolId ?? null,
      arrivalModel: payload.arrivalModel,
      phasePlanJson: payload.phasePlanJson ?? null,
      requestMixJson: payload.requestMixJson ?? null,
      evidencePolicyJson: payload.evidencePolicyJson ?? null,
      gatePolicyId: payload.gatePolicyId ?? null,
      tagsJson: payload.tagsJson ?? null,
      baselineRunId: null,
      virtualUsers: payload.virtualUsers,
      durationSec: payload.durationSec,
      rampUpSec: payload.rampUpSec,
      targetRps: payload.targetRps ? Math.round(payload.targetRps) : null,
      thresholdsJson: JSON.stringify(payload.thresholds),
      createdAt: now,
      updatedAt: now
    });

    const rows = (await app.appContext.db
      .select()
      .from(loadProfilesTable)
      .where(eq(loadProfilesTable.id, id))
      .limit(1)) as LoadProfileRow[];
    const profile = LoadProfileSchema.parse(mapLoadProfileRow(rows[0]!));
    await createLoadProfileVersionSnapshot({
      db: app.appContext.db,
      profile,
      reason: "Initial profile snapshot."
    });
    return profile;
  });

  app.get("/api/platform/load/profiles/:id/versions", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) {
      return;
    }
    const params = paramsWithIdSchema.parse(request.params);
    const profileRow = await getLoadProfileRowById(app, auth.tenant.id, params.id);
    if (!profileRow) {
      return reply.status(404).send({ error: "Load profile not found." });
    }

    const versions = await listLoadProfileVersions(app.appContext.db, params.id);
    return versions.map((version) => LoadProfileVersionSchema.parse(version));
  });

  app.post("/api/platform/load/profiles/:id/rollback", async (request, reply) => {
    const auth = requireMinimumRole(request, reply, "member");
    if (!auth) {
      return;
    }
    const params = paramsWithIdSchema.parse(request.params);
    const payload = rollbackVersionSchema.parse(request.body);
    const profileRow = await getLoadProfileRowById(app, auth.tenant.id, params.id);
    if (!profileRow) {
      return reply.status(404).send({ error: "Load profile not found." });
    }
    try {
      const profile = await rollbackLoadProfileVersion({
        db: app.appContext.db,
        profileId: params.id,
        versionId: payload.versionId
      });
      return LoadProfileSchema.parse(profile);
    } catch (error) {
      return reply
        .status(404)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/platform/load/profiles/:id/baseline", async (request, reply) => {
    const auth = requireMinimumRole(request, reply, "member");
    if (!auth) {
      return;
    }
    const params = paramsWithIdSchema.parse(request.params);
    const payload = setBaselineSchema.parse(request.body);
    const profileRow = await getLoadProfileRowById(app, auth.tenant.id, params.id);
    const loadRunRow = await getLoadRunRowById(app, auth.tenant.id, payload.runId);
    if (!profileRow) {
      return reply.status(404).send({ error: "Load profile not found." });
    }
    if (!loadRunRow) {
      return reply.status(404).send({ error: "Load run not found." });
    }
    const now = Date.now();
    await app.appContext.db
      .update(loadProfilesTable)
      .set({
        baselineRunId: payload.runId,
        updatedAt: now
      })
      .where(eq(loadProfilesTable.id, params.id));

    await app.appContext.db.insert(loadProfileBaselineEventsTable).values({
      id: nanoid(),
      tenantId: auth.tenant.id,
      profileId: params.id,
      runId: payload.runId,
      action: "pinned",
      note: "Baseline pinned from platform console.",
      createdAt: now
    });

    const rows = (await app.appContext.db
      .select()
      .from(loadProfilesTable)
      .where(eq(loadProfilesTable.id, params.id))
      .limit(1)) as LoadProfileRow[];
    const row = rows[0];
    if (!row) {
      return reply.status(404).send({ error: "Load profile not found." });
    }
    const profile = LoadProfileSchema.parse(mapLoadProfileRow(row));
    await createLoadProfileVersionSnapshot({
      db: app.appContext.db,
      profile,
      reason: `Baseline pinned to run ${payload.runId}.`
    });
    return profile;
  });

  app.post("/api/platform/load/profiles/:id/promote-baseline", async (request, reply) => {
    const auth = requireMinimumRole(request, reply, "member");
    if (!auth) {
      return;
    }
    const params = paramsWithIdSchema.parse(request.params);
    const payload = setBaselineSchema.parse(request.body);
    const profileRow = await getLoadProfileRowById(app, auth.tenant.id, params.id);
    const loadRunRow = await getLoadRunRowById(app, auth.tenant.id, payload.runId);
    if (!profileRow) {
      return reply.status(404).send({ error: "Load profile not found." });
    }
    if (!loadRunRow) {
      return reply.status(404).send({ error: "Load run not found." });
    }
    const now = Date.now();

    await app.appContext.db
      .update(loadProfilesTable)
      .set({
        baselineRunId: payload.runId,
        updatedAt: now
      })
      .where(eq(loadProfilesTable.id, params.id));

    await app.appContext.db.insert(loadProfileBaselineEventsTable).values({
      id: nanoid(),
      tenantId: auth.tenant.id,
      profileId: params.id,
      runId: payload.runId,
      action: "promoted",
      note: "Latest green run promoted to baseline.",
      createdAt: now
    });

    const row = await getLoadProfileRowById(app, auth.tenant.id, params.id);
    if (!row) {
      return reply.status(404).send({ error: "Load profile not found." });
    }
    const profile = LoadProfileSchema.parse(mapLoadProfileRow(row));
    await createLoadProfileVersionSnapshot({
      db: app.appContext.db,
      profile,
      reason: `Baseline promoted from run ${payload.runId}.`
    });
    return profile;
  });

  app.get("/api/platform/load/runs", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) {
      return;
    }
    const query = listQuerySchema.parse(request.query);
    if (query.projectId) {
      const projectRow = await getTenantProjectRow(app.appContext.db, auth.tenant.id, query.projectId);
      if (!projectRow) {
        return reply.status(404).send({ error: "Project not found." });
      }
    }
    const rows = (await app.appContext.db
      .select()
      .from(loadRunsTable)
      .where(
        buildCondition([
          eq(loadRunsTable.tenantId, auth.tenant.id),
          query.projectId ? eq(loadRunsTable.projectId, query.projectId) : undefined,
          query.profileId ? eq(loadRunsTable.profileId, query.profileId) : undefined,
          query.environmentId ? eq(loadRunsTable.environmentId, query.environmentId) : undefined,
          query.status ? eq(loadRunsTable.status, query.status) : undefined,
          query.verdict ? eq(loadRunsTable.verdict, query.verdict) : undefined
        ])
      )
      .orderBy(desc(loadRunsTable.createdAt))
      .limit(query.limit)) as LoadRunRow[];

    return rows.map((row) => LoadRunSchema.parse(mapLoadRunRow(row)));
  });

  app.post("/api/platform/load/runs", async (request, reply) => {
    const auth = requireMinimumRole(request, reply, "member");
    if (!auth) {
      return;
    }
    const payload = createPlatformLoadRunSchema.parse(request.body);
    const profileRow = await getLoadProfileRowById(app, auth.tenant.id, payload.profileId);
    if (!profileRow) {
      return reply.status(404).send({ error: "Load profile not found." });
    }
    if (payload.environmentId) {
      const environmentRow = await getTenantEnvironmentRow(
        app.appContext.db,
        auth.tenant.id,
        payload.environmentId
      );
      if (!environmentRow) {
        return reply.status(404).send({ error: "Environment not found." });
      }
    }
    const queueMode =
      app.appContext.platformLoadQueue.isAvailable &&
      app.appContext.platformLoadQueue.mode === "bullmq"
        ? "bullmq"
        : "inline";
    const queuedRun = await createPlatformLoadRunRecord({
      db: app.appContext.db,
      profileId: payload.profileId,
      environmentId: payload.environmentId,
      environmentLabel: payload.environmentLabel,
      notes: payload.notes,
      queueMode
    });

    if (queueMode === "bullmq") {
      await app.appContext.platformLoadQueue.enqueue({ runId: queuedRun.id });
      return LoadRunSchema.parse(queuedRun);
    }

    const finalRun = await executePersistedPlatformLoadRun({
      db: app.appContext.db,
      runId: queuedRun.id
    });
    return LoadRunSchema.parse(finalRun);
  });

  app.get("/api/platform/load/runs/:runId", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) {
      return;
    }
    const params = runIdParamsSchema.parse(request.params);
    await recoverTimedOutPlatformLoadRuns({
      db: app.appContext.db,
      heartbeatTimeoutMs: env.PLATFORM_WORKER_HEARTBEAT_TIMEOUT_MS
    });
    const runRow = await getLoadRunRowById(app, auth.tenant.id, params.runId);
    if (!runRow) {
      return reply.status(404).send({ error: "Load run not found." });
    }

    const profileRow = await getLoadProfileRowById(app, auth.tenant.id, runRow.profileId);
    if (!profileRow) {
      return reply.status(404).send({ error: "Load profile not found." });
    }

    const siblingRows = (await app.appContext.db
      .select()
      .from(loadRunsTable)
      .where(and(eq(loadRunsTable.profileId, runRow.profileId), eq(loadRunsTable.tenantId, auth.tenant.id)))
      .orderBy(desc(loadRunsTable.createdAt))
      .limit(12)) as LoadRunRow[];
    const workerRows = (await app.appContext.db
      .select()
      .from(loadRunWorkersTable)
      .where(and(eq(loadRunWorkersTable.runId, params.runId), eq(loadRunWorkersTable.tenantId, auth.tenant.id)))
      .orderBy(desc(loadRunWorkersTable.workerIndex))) as LoadRunWorkerRow[];
    const sampleWindowRows = (await app.appContext.db
      .select()
      .from(loadRunSampleWindowsTable)
      .where(and(eq(loadRunSampleWindowsTable.runId, params.runId), eq(loadRunSampleWindowsTable.tenantId, auth.tenant.id)))
      .orderBy(desc(loadRunSampleWindowsTable.ts))) as LoadRunSampleWindowRow[];

    const injectorWorkers = await listInjectorWorkers(app.appContext.db, auth.tenant.id);
    const baselineHistory = await listBaselineEvents(app, auth.tenant.id, runRow.profileId);

    return LoadRunDetailSchema.parse(
      buildLoadRunDetail({
        run: mapLoadRunRow(runRow),
        profile: mapLoadProfileRow(profileRow),
        siblingRuns: siblingRows.map(mapLoadRunRow),
        workers: enrichLoadRunWorkersWithHeartbeat({
          workers: workerRows.map(mapLoadRunWorkerRow),
          injectorWorkers,
          timeoutMs: env.PLATFORM_WORKER_HEARTBEAT_TIMEOUT_MS
        }),
        sampleWindows: sampleWindowRows.map(mapLoadRunSampleWindowRow).sort((left, right) =>
          left.ts.localeCompare(right.ts)
        ),
        baselineHistory
      })
    );
  });

  app.get("/api/platform/load/runs/:runId/series", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) {
      return;
    }
    const params = runIdParamsSchema.parse(request.params);
    const runRow = await getLoadRunRowById(app, auth.tenant.id, params.runId);
    if (!runRow) {
      return reply.status(404).send({ error: "Load run not found." });
    }

    if (env.PLATFORM_PROMETHEUS_URL) {
      try {
        const prometheusSeries = await fetchPrometheusLoadRunSeries({
          baseUrl: env.PLATFORM_PROMETHEUS_URL,
          runId: params.runId
        });
        if (prometheusSeries) {
          return LoadRunSeriesSchema.parse(prometheusSeries);
        }
      } catch (error) {
        app.log.warn(
          {
            runId: params.runId,
            error: error instanceof Error ? error.message : String(error)
          },
          "Prometheus load series lookup failed, falling back to cached sample windows."
        );
      }
    }

    const rows = (await app.appContext.db
      .select()
      .from(loadRunSampleWindowsTable)
      .where(and(eq(loadRunSampleWindowsTable.runId, params.runId), eq(loadRunSampleWindowsTable.tenantId, auth.tenant.id)))
      .orderBy(desc(loadRunSampleWindowsTable.ts))) as LoadRunSampleWindowRow[];
    if (rows.length === 0) {
      return reply.status(404).send({ error: "No time-series data found for this run." });
    }

    return LoadRunSeriesSchema.parse(
      buildCachedLoadRunSeries({
        runId: params.runId,
        points: rows
          .map((row) => LoadRunSampleWindowSchema.parse(mapLoadRunSampleWindowRow(row)))
          .sort((left, right) => left.ts.localeCompare(right.ts))
      })
    );
  });

  app.get("/api/platform/load/runs/:runId/compare", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) {
      return;
    }
    const params = runIdParamsSchema.parse(request.params);
    const query = loadRunCompareQuerySchema.parse(request.query);
    const candidateRow = await getLoadRunRowById(
      app,
      auth.tenant.id,
      query.candidateRunId ?? params.runId
    );
    if (!candidateRow) {
      return reply.status(404).send({ error: "Candidate run not found." });
    }
    const candidateProfileRow = await getLoadProfileRowById(app, auth.tenant.id, candidateRow.profileId);
    if (!candidateProfileRow) {
      return reply.status(404).send({ error: "Load profile not found." });
    }

    const baselineRunId =
      query.baselineRunId ?? candidateRow.compareBaselineRunId ?? candidateProfileRow.baselineRunId;
    if (!baselineRunId) {
      return reply.status(404).send({ error: "No baseline is configured for this run." });
    }

    const baselineRow = await getLoadRunRowById(app, auth.tenant.id, baselineRunId);
    if (!baselineRow) {
      return reply.status(404).send({ error: "Baseline run not found." });
    }
    const baselineProfileRow = await getLoadProfileRowById(app, auth.tenant.id, baselineRow.profileId);
    if (!baselineProfileRow) {
      return reply.status(404).send({ error: "Baseline profile not found." });
    }

    const baselineWorkerRows = (await app.appContext.db
      .select()
      .from(loadRunWorkersTable)
      .where(and(eq(loadRunWorkersTable.runId, baselineRunId), eq(loadRunWorkersTable.tenantId, auth.tenant.id)))) as LoadRunWorkerRow[];
    const candidateWorkerRows = (await app.appContext.db
      .select()
      .from(loadRunWorkersTable)
      .where(and(eq(loadRunWorkersTable.runId, candidateRow.id), eq(loadRunWorkersTable.tenantId, auth.tenant.id)))) as LoadRunWorkerRow[];
    const baselineWindowRows = (await app.appContext.db
      .select()
      .from(loadRunSampleWindowsTable)
      .where(and(eq(loadRunSampleWindowsTable.runId, baselineRunId), eq(loadRunSampleWindowsTable.tenantId, auth.tenant.id)))) as LoadRunSampleWindowRow[];
    const candidateWindowRows = (await app.appContext.db
      .select()
      .from(loadRunSampleWindowsTable)
      .where(and(eq(loadRunSampleWindowsTable.runId, candidateRow.id), eq(loadRunSampleWindowsTable.tenantId, auth.tenant.id)))) as LoadRunSampleWindowRow[];
    const injectorWorkers = await listInjectorWorkers(app.appContext.db, auth.tenant.id);

    return LoadRunCompareSchema.parse(
      buildLoadRunCompare({
        baselineRun: mapLoadRunRow(baselineRow),
        candidateRun: mapLoadRunRow(candidateRow),
        baselineProfile: mapLoadProfileRow(baselineProfileRow),
        candidateProfile: mapLoadProfileRow(candidateProfileRow),
        baselineWorkers: enrichLoadRunWorkersWithHeartbeat({
          workers: baselineWorkerRows.map(mapLoadRunWorkerRow),
          injectorWorkers,
          timeoutMs: env.PLATFORM_WORKER_HEARTBEAT_TIMEOUT_MS
        }),
        candidateWorkers: enrichLoadRunWorkersWithHeartbeat({
          workers: candidateWorkerRows.map(mapLoadRunWorkerRow),
          injectorWorkers,
          timeoutMs: env.PLATFORM_WORKER_HEARTBEAT_TIMEOUT_MS
        }),
        baselineWindows: baselineWindowRows.map(mapLoadRunSampleWindowRow),
        candidateWindows: candidateWindowRows.map(mapLoadRunSampleWindowRow)
      })
    );
  });

  app.post("/api/platform/load/runs/:runId/retry", async (request, reply) => {
    const auth = requireMinimumRole(request, reply, "member");
    if (!auth) {
      return;
    }
    const params = runIdParamsSchema.parse(request.params);
    const payload = retryPlatformLoadRunSchema.parse(request.body ?? {});
    const sourceRun = await getLoadRunRowById(app, auth.tenant.id, params.runId);
    if (!sourceRun) {
      return reply.status(404).send({ error: "Load run not found." });
    }

    const queueMode =
      app.appContext.platformLoadQueue.isAvailable &&
      app.appContext.platformLoadQueue.mode === "bullmq"
        ? "bullmq"
        : "inline";
    const retryRun = await createPlatformLoadRunRecord({
      db: app.appContext.db,
      profileId: sourceRun.profileId,
      environmentId: sourceRun.environmentId ?? undefined,
      environmentLabel: sourceRun.environmentLabel,
      notes:
        payload.notes ??
        `Retry of ${sourceRun.id}${sourceRun.notes ? `\n${sourceRun.notes}` : ""}`,
      queueMode
    });

    if (queueMode === "bullmq") {
      await app.appContext.platformLoadQueue.enqueue({ runId: retryRun.id });
      return LoadRunSchema.parse(retryRun);
    }

    const finalRun = await executePersistedPlatformLoadRun({
      db: app.appContext.db,
      runId: retryRun.id
    });
    return LoadRunSchema.parse(finalRun);
  });

  app.post("/api/platform/load/runs/:runId/cancel", async (request, reply) => {
    const auth = requireMinimumRole(request, reply, "member");
    if (!auth) {
      return;
    }
    const params = runIdParamsSchema.parse(request.params);
    const sourceRun = await getLoadRunRowById(app, auth.tenant.id, params.runId);
    if (!sourceRun) {
      return reply.status(404).send({ error: "Load run not found." });
    }
    if (sourceRun.status !== "queued") {
      return reply
        .status(409)
        .send({ error: "Only queued runs can be cancelled right now." });
    }

    const cancellation = await app.appContext.platformLoadQueue.cancel(sourceRun.id);
    if (!cancellation.ok && app.appContext.platformLoadQueue.mode === "bullmq") {
      return reply.status(409).send({ error: cancellation.detail });
    }

    const stoppedRun = await stopQueuedPlatformLoadRun({
      db: app.appContext.db,
      runId: sourceRun.id,
      note: cancellation.detail
    });

    return LoadRunSchema.parse(stoppedRun);
  });

  app.get("/api/platform/releases", async (request, reply) => {
    const auth = requireRoleOrScope(request, reply, {
      minimumRole: "viewer",
      scope: "gate:read"
    });
    if (!auth) {
      return;
    }
    const query = listQuerySchema.parse(request.query);
    if (query.projectId) {
      const projectRow = await getTenantProjectRow(app.appContext.db, auth.tenant.id, query.projectId);
      if (!projectRow) {
        return reply.status(404).send({ error: "Project not found." });
      }
    }
    const rows = (await app.appContext.db
      .select()
      .from(releaseCandidatesTable)
      .where(
        buildCondition([
          eq(releaseCandidatesTable.tenantId, auth.tenant.id),
          query.projectId ? eq(releaseCandidatesTable.projectId, query.projectId) : undefined
        ])
      )
      .orderBy(desc(releaseCandidatesTable.createdAt))) as ReleaseCandidateRow[];

    return rows.map((row) => ReleaseCandidateSchema.parse(mapReleaseCandidateRow(row)));
  });

  app.post("/api/platform/releases", async (request, reply) => {
    const auth = requireRoleOrScope(request, reply, {
      minimumRole: "owner",
      scope: "release:create"
    });
    if (!auth) {
      return;
    }
    const payload = createReleaseSchema.parse(request.body);
    const projectRow = await getTenantProjectRow(app.appContext.db, auth.tenant.id, payload.projectId);
    if (!projectRow) {
      return reply.status(404).send({ error: "Project not found." });
    }
    const bindingError = await validateReleaseBindings(app, auth.tenant.id, payload);
    if (bindingError) {
      return reply.status(400).send({ error: bindingError });
    }
    const now = Date.now();
    const id = nanoid();

    await app.appContext.db.insert(releaseCandidatesTable).values({
      id,
      tenantId: auth.tenant.id,
      projectId: payload.projectId,
      environmentId: payload.environmentId ?? null,
      gatePolicyId: payload.gatePolicyId,
      name: payload.name,
      buildLabel: payload.buildLabel,
      buildId: payload.buildId ?? null,
      commitSha: payload.commitSha ?? null,
      sourceRunIdsJson: JSON.stringify(payload.sourceRunIds),
      sourceLoadRunIdsJson: JSON.stringify(payload.sourceLoadRunIds),
      status: "draft",
      notes: payload.notes ?? null,
      createdAt: now,
      updatedAt: now
    });

    const rows = (await app.appContext.db
      .select()
      .from(releaseCandidatesTable)
      .where(eq(releaseCandidatesTable.id, id))
      .limit(1)) as ReleaseCandidateRow[];
    return ReleaseCandidateSchema.parse(mapReleaseCandidateRow(rows[0]!));
  });

  app.get("/api/platform/releases/:releaseId/gates", async (request, reply) => {
    const auth = requireRoleOrScope(request, reply, {
      minimumRole: "viewer",
      scope: "gate:read"
    });
    if (!auth) {
      return;
    }
    try {
      const params = releaseIdParamsSchema.parse(request.params);
      return await buildReleaseGateDetail(app, auth.tenant.id, params.releaseId);
    } catch (error) {
      return reply
        .status(404)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/platform/releases/:releaseId/audit", async (request, reply) => {
    const auth = requireRoleOrScope(request, reply, {
      minimumRole: "viewer",
      scope: "gate:read"
    });
    if (!auth) {
      return;
    }
    try {
      const params = releaseIdParamsSchema.parse(request.params);
      const detail = await buildReleaseGateDetail(app, auth.tenant.id, params.releaseId);
      return ReleaseAuditSchema.parse({
        release: detail.release,
        timeline: detail.approvalTimeline
      });
    } catch (error) {
      return reply
        .status(404)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/platform/releases/:releaseId/approvals", async (request, reply) => {
    const auth = requireMinimumRole(request, reply, "owner");
    if (!auth) {
      return;
    }
    const params = releaseIdParamsSchema.parse(request.params);
    const payload = createApprovalSchema.parse(request.body);
    const releaseRow = await getTenantReleaseRow(app.appContext.db, auth.tenant.id, params.releaseId);
    if (!releaseRow) {
      return reply.status(404).send({ error: "Release not found." });
    }

    await app.appContext.db.insert(approvalEventsTable).values({
      id: nanoid(),
      tenantId: auth.tenant.id,
      releaseId: params.releaseId,
      waiverId: null,
      actor: payload.actor,
      role: payload.role,
      action: payload.action,
      detail: payload.detail ?? null,
      createdAt: Date.now()
    });

    const detail = await buildReleaseGateDetail(app, auth.tenant.id, params.releaseId);
    return ReleaseAuditSchema.parse({
      release: detail.release,
      timeline: detail.approvalTimeline
    });
  });

  app.get("/api/platform/waivers", async (request, reply) => {
    const auth = requireRoleOrScope(request, reply, {
      minimumRole: "viewer",
      scope: "gate:read"
    });
    if (!auth) {
      return;
    }
    const query = listQuerySchema.parse(request.query);
    const rows = (await app.appContext.db
      .select()
      .from(waiversTable)
      .where(
        buildCondition([
          eq(waiversTable.tenantId, auth.tenant.id),
          query.releaseId ? eq(waiversTable.releaseId, query.releaseId) : undefined
        ])
      )
      .orderBy(desc(waiversTable.createdAt))) as WaiverRow[];

    return rows.map((row) => WaiverSchema.parse(mapWaiverRow(row)));
  });

  app.post("/api/platform/waivers", async (request, reply) => {
    const auth = requireMinimumRole(request, reply, "owner");
    if (!auth) {
      return;
    }
    const payload = createWaiverSchema.parse(request.body);
    const releaseRow = await getTenantReleaseRow(app.appContext.db, auth.tenant.id, payload.releaseId);
    if (!releaseRow) {
      return reply.status(404).send({ error: "Release not found." });
    }
    const now = Date.now();
    const waiverId = nanoid();

    await app.appContext.db.insert(waiversTable).values({
      id: waiverId,
      tenantId: auth.tenant.id,
      releaseId: payload.releaseId,
      blockerKey: payload.blockerKey,
      reason: payload.reason,
      requestedBy: payload.requestedBy,
      approvedBy: payload.approvedBy ?? null,
      expiresAt: toEpoch(payload.expiresAt),
      status: "active",
      createdAt: now,
      updatedAt: now
    });

    await app.appContext.db.insert(approvalEventsTable).values({
      id: nanoid(),
      tenantId: auth.tenant.id,
      releaseId: payload.releaseId,
      waiverId,
      actor: payload.approvedBy ?? payload.requestedBy,
      role: payload.role,
      action: payload.approvedBy ? "waiver_approved" : "waiver_requested",
      detail: payload.reason,
      createdAt: now
    });

    return buildReleaseGateDetail(app, auth.tenant.id, payload.releaseId);
  });
};
