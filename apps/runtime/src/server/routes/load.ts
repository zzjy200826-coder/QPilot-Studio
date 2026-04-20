import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  LoadEngineSchema,
  LoadHttpMethodSchema,
  LoadPatternSchema,
  LoadProfileSchema,
  LoadRunSchema,
  LoadRunDetailSchema,
  LoadStudioSummarySchema,
  LoadThresholdSchema
} from "@qpilot/shared";
import { buildLoadRunDetail, buildLoadStudioSummary } from "../../analytics/load-insights.js";
import { loadProfilesTable, loadRunsTable, projectsTable } from "../../db/schema.js";
import { executeLoadRun } from "../../load/runner.js";
import {
  mapLoadProfileRow,
  mapLoadRunRow,
  type LoadProfileRow,
  type LoadRunRow
} from "../../utils/mappers.js";
import type { AppFastify } from "../types.js";

const listProfilesQuerySchema = z.object({
  projectId: z.string().optional()
});

const createProfileSchema = z.object({
  projectId: z.string(),
  name: z.string().trim().min(1).max(80),
  scenarioLabel: z.string().trim().min(1).max(120),
  targetBaseUrl: z.string().url(),
  engine: LoadEngineSchema.default("synthetic"),
  pattern: LoadPatternSchema.default("steady"),
  virtualUsers: z.coerce.number().int().positive().max(10_000),
  durationSec: z.coerce.number().int().positive().max(14_400),
  rampUpSec: z.coerce.number().int().nonnegative().max(7_200),
  targetRps: z.coerce.number().positive().max(100_000).optional(),
  requestPath: z.string().trim().min(1).max(280).optional(),
  httpMethod: LoadHttpMethodSchema.optional(),
  headersJson: z.string().trim().max(4_000).optional(),
  bodyTemplate: z.string().max(20_000).optional(),
  thresholds: LoadThresholdSchema
}).superRefine((payload, context) => {
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
});

const listRunsQuerySchema = z.object({
  projectId: z.string().optional(),
  profileId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(40)
});

const createRunSchema = z.object({
  profileId: z.string(),
  environmentLabel: z.string().trim().min(1).max(60).default("staging"),
  notes: z.string().trim().max(280).optional()
});

const runIdParamsSchema = z.object({
  runId: z.string()
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

export const registerLoadRoutes = (app: AppFastify): void => {
  app.get("/api/load/summary", async (request) => {
    const query = listProfilesQuerySchema.parse(request.query);
    const profileCondition = buildCondition([
      query.projectId ? eq(loadProfilesTable.projectId, query.projectId) : undefined
    ]);
    const runCondition = buildCondition([
      query.projectId ? eq(loadRunsTable.projectId, query.projectId) : undefined
    ]);

    const profileRows = (profileCondition
      ? await app.appContext.db
          .select()
          .from(loadProfilesTable)
          .where(profileCondition)
          .orderBy(desc(loadProfilesTable.updatedAt))
      : await app.appContext.db
          .select()
          .from(loadProfilesTable)
          .orderBy(desc(loadProfilesTable.updatedAt))) as LoadProfileRow[];

    const runRows = (runCondition
      ? await app.appContext.db
          .select()
          .from(loadRunsTable)
          .where(runCondition)
          .orderBy(desc(loadRunsTable.createdAt))
      : await app.appContext.db
          .select()
          .from(loadRunsTable)
          .orderBy(desc(loadRunsTable.createdAt))) as LoadRunRow[];

    return LoadStudioSummarySchema.parse(
      buildLoadStudioSummary(
        profileRows.map(mapLoadProfileRow),
        runRows.map(mapLoadRunRow)
      )
    );
  });

  app.get("/api/load/profiles", async (request) => {
    const query = listProfilesQuerySchema.parse(request.query);
    const condition = buildCondition([
      query.projectId ? eq(loadProfilesTable.projectId, query.projectId) : undefined
    ]);

    const rows = (condition
      ? await app.appContext.db
          .select()
          .from(loadProfilesTable)
          .where(condition)
          .orderBy(desc(loadProfilesTable.updatedAt))
      : await app.appContext.db
          .select()
          .from(loadProfilesTable)
          .orderBy(desc(loadProfilesTable.updatedAt))) as LoadProfileRow[];

    return rows.map((row) => LoadProfileSchema.parse(mapLoadProfileRow(row)));
  });

  app.post("/api/load/profiles", async (request, reply) => {
    const payload = createProfileSchema.parse(request.body);
    const project = await app.appContext.db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.id, payload.projectId))
      .limit(1);

    if (!project[0]) {
      return reply.status(404).send({ error: "Project not found." });
    }

    const now = Date.now();
    const id = nanoid();

    await app.appContext.db.insert(loadProfilesTable).values({
      id,
      projectId: payload.projectId,
      name: payload.name,
      scenarioLabel: payload.scenarioLabel,
      targetBaseUrl: payload.targetBaseUrl,
      engine: payload.engine,
      pattern: payload.pattern,
      requestPath: payload.requestPath ?? null,
      httpMethod: payload.httpMethod ?? null,
      headersJson: payload.headersJson ?? null,
      bodyTemplate: payload.bodyTemplate ?? null,
      virtualUsers: payload.virtualUsers,
      durationSec: payload.durationSec,
      rampUpSec: payload.rampUpSec,
      targetRps: payload.targetRps ? Math.round(payload.targetRps) : null,
      thresholdsJson: JSON.stringify(payload.thresholds),
      createdAt: now,
      updatedAt: now
    });

    const rows = await app.appContext.db
      .select()
      .from(loadProfilesTable)
      .where(eq(loadProfilesTable.id, id))
      .limit(1);
    const row = rows[0] as LoadProfileRow | undefined;

    if (!row) {
      return reply.status(500).send({ error: "Failed to create load profile." });
    }

    return LoadProfileSchema.parse(mapLoadProfileRow(row));
  });

  app.get("/api/load/runs", async (request) => {
    const query = listRunsQuerySchema.parse(request.query);
    const condition = buildCondition([
      query.projectId ? eq(loadRunsTable.projectId, query.projectId) : undefined,
      query.profileId ? eq(loadRunsTable.profileId, query.profileId) : undefined
    ]);

    const rows = (condition
      ? await app.appContext.db
          .select()
          .from(loadRunsTable)
          .where(condition)
          .orderBy(desc(loadRunsTable.createdAt))
          .limit(query.limit)
      : await app.appContext.db
          .select()
          .from(loadRunsTable)
          .orderBy(desc(loadRunsTable.createdAt))
          .limit(query.limit)) as LoadRunRow[];

    return rows.map((row) => LoadRunSchema.parse(mapLoadRunRow(row)));
  });

  app.post("/api/load/runs", async (request, reply) => {
    const payload = createRunSchema.parse(request.body);
    const profileRows = await app.appContext.db
      .select()
      .from(loadProfilesTable)
      .where(eq(loadProfilesTable.id, payload.profileId))
      .limit(1);
    const profileRow = profileRows[0] as LoadProfileRow | undefined;

    if (!profileRow) {
      return reply.status(404).send({ error: "Load profile not found." });
    }

    const profile = mapLoadProfileRow(profileRow);
    const startedAt = new Date().toISOString();
    const executedRun = await executeLoadRun(profile, {
      environmentLabel: payload.environmentLabel,
      notes: payload.notes,
      startedAt
    });
    const run = {
      ...executedRun,
      id: nanoid(),
      createdAt: startedAt
    };

    await app.appContext.db.insert(loadRunsTable).values({
      id: run.id,
      projectId: run.projectId,
      profileId: run.profileId,
      profileName: run.profileName,
      scenarioLabel: run.scenarioLabel,
      targetBaseUrl: run.targetBaseUrl,
      engine: run.engine,
      pattern: run.pattern,
      environmentLabel: run.environmentLabel,
      status: run.status,
      verdict: run.verdict,
      source: run.source,
      metricsJson: JSON.stringify(run.metrics),
      notes: run.notes ?? null,
      engineVersion: run.engineVersion ?? null,
      executorLabel: run.executorLabel ?? null,
      rawSummaryPath: run.rawSummaryPath ?? null,
      startedAt: Date.parse(run.startedAt),
      endedAt: run.endedAt ? Date.parse(run.endedAt) : null,
      createdAt: Date.parse(run.createdAt)
    });

    return LoadRunSchema.parse(run);
  });

  app.get("/api/load/runs/:runId", async (request, reply) => {
    const params = runIdParamsSchema.parse(request.params);
    const runRows = await app.appContext.db
      .select()
      .from(loadRunsTable)
      .where(eq(loadRunsTable.id, params.runId))
      .limit(1);
    const runRow = runRows[0] as LoadRunRow | undefined;

    if (!runRow) {
      return reply.status(404).send({ error: "Load run not found." });
    }

    const profileRows = await app.appContext.db
      .select()
      .from(loadProfilesTable)
      .where(eq(loadProfilesTable.id, runRow.profileId))
      .limit(1);
    const profileRow = profileRows[0] as LoadProfileRow | undefined;

    if (!profileRow) {
      return reply.status(404).send({ error: "Load profile not found." });
    }

    const siblingRows = (await app.appContext.db
      .select()
      .from(loadRunsTable)
      .where(eq(loadRunsTable.profileId, runRow.profileId))
      .orderBy(desc(loadRunsTable.createdAt))
      .limit(12)) as LoadRunRow[];

    return LoadRunDetailSchema.parse(
      buildLoadRunDetail({
        run: mapLoadRunRow(runRow),
        profile: mapLoadProfileRow(profileRow),
        siblingRuns: siblingRows.map(mapLoadRunRow)
      })
    );
  });
};
