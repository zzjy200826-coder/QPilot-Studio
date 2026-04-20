import { and, desc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  ActionSchema,
  BenchmarkSummarySchema,
  CaseTemplateRepairDraftSchema,
  ExecutionModeSchema,
  RunConfigSchema,
  RunComparisonSchema,
  RunDiagnosisSchema,
  type CaseTemplateRepairDraft,
  type ExecutionMode,
  type NetworkEvidenceEntry,
  type ReplayCaseStep,
  type Run,
  type RunConfig,
  type Step
} from "@qpilot/shared";
import {
  buildBenchmarkSummary,
  buildRunComparison,
  buildRunDiagnosis
} from "../../analytics/run-insights.js";
import { buildReplayCaseFromTemplate } from "../../cases/replay-case.js";
import { buildCaseTemplateRepairDraft } from "../../cases/template-repair-draft.js";
import { env } from "../../config/env.js";
import { caseTemplatesTable, projectsTable, reportsTable, runsTable, stepsTable, testCasesTable } from "../../db/schema.js";
import { encryptText } from "../../security/credentials.js";
import { resolveUtf8TextInput } from "../utf8-payload.js";
import {
  mapCaseTemplateRow,
  mapRunRow,
  mapStepRow,
  mapTestCaseRow,
  type CaseTemplateRow,
  type RunRow,
  type StepRow,
  type TestCaseRow
} from "../../utils/mappers.js";
import type { AppFastify } from "../types.js";

const DEFAULT_RUN_GOAL = "Explore and validate page behavior.";

const createRunSchema = z.object({
  projectId: z.string(),
  targetUrl: z.string().url(),
  username: z.string().optional(),
  usernameBase64: z.string().optional(),
  password: z.string().optional(),
  passwordBase64: z.string().optional(),
  mode: z.enum(["general", "login", "admin"]).default("general"),
  language: z.enum(["en", "zh-CN"]).default("en"),
  executionMode: z.enum(["auto_batch", "stepwise_replan"]).default("auto_batch"),
  confirmDraft: z.boolean().default(false),
  goal: z.string().optional(),
  goalBase64: z.string().optional(),
  maxSteps: z.coerce.number().int().positive().max(30).default(12),
  model: z.string().optional(),
  headed: z.boolean().default(false),
  manualTakeover: z.boolean().default(false),
  sessionProfile: z.string().trim().min(1).max(80).optional(),
  saveSession: z.boolean().default(false)
});

const runIdParamsSchema = z.object({
  runId: z.string()
});

const runStepParamsSchema = z.object({
  runId: z.string(),
  stepRef: z.string()
});

const executionModeSchema = z.object({
  executionMode: ExecutionModeSchema
});

const draftActionSchema = z.object({
  action: ActionSchema.optional()
});

const runControlSchema = z.discriminatedUnion("command", [
  z.object({
    command: z.literal("approve"),
    action: ActionSchema.optional()
  }),
  z.object({
    command: z.literal("edit_and_run"),
    action: ActionSchema
  }),
  z.object({
    command: z.literal("skip")
  }),
  z.object({
    command: z.literal("retry")
  }),
  z.object({
    command: z.literal("switch_mode"),
    executionMode: ExecutionModeSchema
  }),
  z.object({
    command: z.literal("pause")
  }),
  z.object({
    command: z.literal("resume")
  }),
  z.object({
    command: z.literal("abort")
  })
]);

const extractCasesSchema = z.object({
  runId: z.string()
});

const replayCaseParamsSchema = z.object({
  caseId: z.string()
});

const replayCaseBodySchema = z.object({
  language: z.enum(["en", "zh-CN"]).default("en"),
  executionMode: ExecutionModeSchema.default("stepwise_replan"),
  confirmDraft: z.boolean().default(true),
  headed: z.boolean().default(true),
  manualTakeover: z.boolean().default(true),
  sessionProfile: z.string().trim().min(1).max(80).optional(),
  saveSession: z.boolean().default(false),
  maxSteps: z.coerce.number().int().positive().max(60).optional()
});

const repairDraftBodySchema = z.object({
  runId: z.string(),
  replay: replayCaseBodySchema.partial().optional()
});

const rerunRunBodySchema = z.object({
  language: z.enum(["en", "zh-CN"]).optional(),
  executionMode: ExecutionModeSchema.optional(),
  confirmDraft: z.boolean().optional(),
  headed: z.boolean().optional(),
  manualTakeover: z.boolean().optional(),
  sessionProfile: z.string().trim().min(1).max(80).optional(),
  saveSession: z.boolean().optional(),
  maxSteps: z.coerce.number().int().positive().max(60).optional()
});

const listRunsQuerySchema = z.object({
  projectId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50)
});

const listCasesQuerySchema = z.object({
  projectId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(100)
});

const benchmarkQuerySchema = z.object({
  projectId: z.string().optional(),
  lang: z.enum(["en", "zh-CN"]).optional()
});

const compareRunsQuerySchema = z.object({
  baseRunId: z.string(),
  candidateRunId: z.string(),
  lang: z.enum(["en", "zh-CN"]).optional()
});

const diagnosisQuerySchema = z.object({
  lang: z.enum(["en", "zh-CN"]).optional()
});

interface StepDigestRow {
  runId: string;
  stepIndex: number;
  pageUrl: string;
  pageTitle: string;
}

type ReplayCasePayload = z.infer<typeof replayCaseBodySchema>;
type RerunRunPayload = z.infer<typeof rerunRunBodySchema>;

const STALE_RUN_MESSAGE = "Runtime restarted before this run could finish.";

const mergeRunExecutionMode = (run: Run, executionMode?: ExecutionMode): Run =>
  executionMode
    ? {
        ...run,
        executionMode
      }
    : run;

const getOverlayExecutionMode = (
  app: AppFastify,
  runId: string
): ExecutionMode | undefined => {
  const active = app.appContext.orchestrator.getActiveRunSnapshot();
  if (active?.runId !== runId) {
    return undefined;
  }
  return active.control.executionMode;
};

const buildRunConfig = (payload: {
  targetUrl: string;
  mode: "general" | "login" | "admin";
  language: "en" | "zh-CN";
  executionMode: ExecutionMode;
  confirmDraft: boolean;
  goal: string;
  maxSteps: number;
  model?: string;
  headed: boolean;
  manualTakeover: boolean;
  sessionProfile?: string;
  saveSession: boolean;
  replayCase?: RunConfig["replayCase"];
}): RunConfig => ({
  targetUrl: payload.targetUrl,
  mode: payload.mode,
  language: payload.language,
  executionMode: payload.executionMode,
  confirmDraft: payload.confirmDraft,
  goal: payload.goal,
  maxSteps: payload.maxSteps,
  model: payload.model,
  headed: payload.headed,
  manualTakeover: payload.manualTakeover,
  sessionProfile: payload.sessionProfile,
  saveSession: payload.saveSession,
  replayCase: payload.replayCase
});

const insertRun = async (
  app: AppFastify,
  payload: {
    projectId: string;
    status?: Run["status"];
    mode: "general" | "login" | "admin";
    targetUrl: string;
    goal: string;
    model?: string;
    config: RunConfig;
  }
): Promise<RunRow> => {
  const id = nanoid();
  const now = Date.now();

  await app.appContext.db.insert(runsTable).values({
    id,
    projectId: payload.projectId,
    status: payload.status ?? "queued",
    mode: payload.mode,
    targetUrl: payload.targetUrl,
    goal: payload.goal,
    model: payload.model ?? env.OPENAI_MODEL,
    configJson: JSON.stringify(payload.config),
    startupPageUrl: null,
    startupPageTitle: null,
    startupScreenshotPath: null,
    startupObservation: null,
    challengeKind: null,
    challengeReason: null,
    recordedVideoPath: null,
    llmLastJson: null,
    errorMessage: null,
    startedAt: null,
    endedAt: null,
    createdAt: now
  });

  const runRows = await app.appContext.db
    .select()
    .from(runsTable)
    .where(eq(runsTable.id, id))
    .limit(1);
  const runRow = runRows[0] as RunRow | undefined;
  if (!runRow) {
    throw new Error("Failed to create run");
  }

  return runRow;
};

const persistExecutionMode = async (
  app: AppFastify,
  runRow: RunRow,
  executionMode: ExecutionMode
): Promise<void> => {
  const parsedConfig = RunConfigSchema.parse(JSON.parse(runRow.configJson ?? "{}")) as RunConfig;
  const nextConfig: RunConfig = {
    ...parsedConfig,
    executionMode
  };

  await app.appContext.db
    .update(runsTable)
    .set({
      configJson: JSON.stringify(nextConfig)
    })
    .where(eq(runsTable.id, runRow.id));
};

const loadRepairDraftContext = async (
  app: AppFastify,
  input: { caseId: string; runId: string }
): Promise<{
  caseRow?: CaseTemplateRow;
  runRow?: RunRow;
  stepRows: StepRow[];
  draft: CaseTemplateRepairDraft | null;
}> => {
  const caseRows = (await app.appContext.db
    .select()
    .from(caseTemplatesTable)
    .where(eq(caseTemplatesTable.id, input.caseId))
    .limit(1)) as CaseTemplateRow[];
  const caseRow = caseRows[0];
  if (!caseRow) {
    return {
      stepRows: [],
      draft: null
    };
  }

  const runRows = (await app.appContext.db
    .select()
    .from(runsTable)
      .where(eq(runsTable.id, input.runId))
      .limit(1)) as RunRow[];
  const runRow = runRows[0];
  if (!runRow) {
    return {
      caseRow,
      stepRows: [],
      draft: null
    };
  }

  const stepRows = (await app.appContext.db
    .select()
    .from(stepsTable)
    .where(eq(stepsTable.runId, input.runId))
    .orderBy(stepsTable.stepIndex)) as StepRow[];

  return {
    caseRow,
    runRow,
    stepRows,
    draft: buildCaseTemplateRepairDraft({
      caseTemplate: caseRow,
      runId: input.runId,
      stepRows
    })
  };
};

const startReplayRunFromCase = async (
  app: AppFastify,
  caseRow: CaseTemplateRow,
  payload: ReplayCasePayload
): Promise<RunRow> => {
  if (caseRow.type === "api") {
    throw new Error("API-only case replay is not supported yet. Replay a UI or Hybrid case instead.");
  }

  const replayCase = buildReplayCaseFromTemplate(caseRow);
  if (!replayCase) {
    throw new Error("This case does not contain replayable UI actions.");
  }

  const replayType = caseRow.type === "hybrid" ? "hybrid" : "ui";
  const replaySteps: ReplayCaseStep[] = replayCase.steps;
  const maxSteps = payload.maxSteps ?? Math.max(replaySteps.length + 2, replaySteps.length);
  const config = buildRunConfig({
    targetUrl: caseRow.entryUrl,
    mode: "general",
    language: payload.language,
    executionMode: payload.executionMode,
    confirmDraft: payload.confirmDraft,
    goal: `Replay case: ${caseRow.title}`,
    maxSteps,
    model: env.OPENAI_MODEL,
    headed: payload.headed || payload.manualTakeover,
    manualTakeover: payload.manualTakeover,
    sessionProfile: payload.sessionProfile,
    saveSession: payload.saveSession,
    replayCase: {
      ...replayCase,
      type: replayType
    }
  });
  const runRow = await insertRun(app, {
    projectId: caseRow.projectId,
    mode: "general",
    targetUrl: caseRow.entryUrl,
    goal: `Replay case: ${caseRow.title}`,
    model: env.OPENAI_MODEL,
    config
  });

  setTimeout(() => {
    app.appContext.orchestrator.start(runRow.id).catch((error: unknown) => {
      app.log.error(error);
    });
  }, 0);

  return runRow;
};

const parseStoredRunConfig = (row: RunRow): RunConfig => {
  try {
    return RunConfigSchema.parse(JSON.parse(row.configJson ?? "{}"));
  } catch {
    return buildRunConfig({
      targetUrl: row.targetUrl,
      mode: row.mode as "general" | "login" | "admin",
      language: "en",
      executionMode: "auto_batch",
      confirmDraft: false,
      goal: row.goal,
      maxSteps: 12,
      model: row.model ?? env.OPENAI_MODEL,
      headed: false,
      manualTakeover: false,
      saveSession: false
    });
  }
};

const startRerunFromRun = async (
  app: AppFastify,
  sourceRunRow: RunRow,
  payload: RerunRunPayload
): Promise<RunRow> => {
  const sourceConfig = parseStoredRunConfig(sourceRunRow);
  const manualTakeover = payload.manualTakeover ?? sourceConfig.manualTakeover ?? false;
  const headed = (payload.headed ?? sourceConfig.headed ?? false) || manualTakeover;
  const sessionProfile = payload.sessionProfile ?? sourceConfig.sessionProfile;
  const saveSession =
    payload.saveSession ?? sourceConfig.saveSession ?? Boolean(sessionProfile?.trim().length);

  const config = buildRunConfig({
    targetUrl: sourceRunRow.targetUrl,
    mode: sourceRunRow.mode as "general" | "login" | "admin",
    language: payload.language ?? sourceConfig.language ?? "en",
    executionMode: payload.executionMode ?? sourceConfig.executionMode ?? "auto_batch",
    confirmDraft: payload.confirmDraft ?? sourceConfig.confirmDraft ?? false,
    goal: sourceRunRow.goal,
    maxSteps: payload.maxSteps ?? sourceConfig.maxSteps ?? 12,
    model: sourceRunRow.model ?? sourceConfig.model ?? env.OPENAI_MODEL,
    headed,
    manualTakeover,
    sessionProfile,
    saveSession,
    replayCase: sourceConfig.replayCase
  });

  const runRow = await insertRun(app, {
    projectId: sourceRunRow.projectId,
    mode: sourceRunRow.mode as "general" | "login" | "admin",
    targetUrl: sourceRunRow.targetUrl,
    goal: sourceRunRow.goal,
    model: sourceRunRow.model ?? env.OPENAI_MODEL,
    config
  });

  setTimeout(() => {
    app.appContext.orchestrator.start(runRow.id).catch((error: unknown) => {
      app.log.error(error);
    });
  }, 0);

  return runRow;
};

const reconcileDetachedRun = async (
  app: AppFastify,
  runRow: RunRow
): Promise<RunRow> => {
  if (runRow.status !== "running") {
    return runRow;
  }

  const active = app.appContext.orchestrator.getActiveRunSnapshot();
  if (active?.runId === runRow.id) {
    return runRow;
  }

  const endedAt = Date.now();
  const errorMessage = runRow.errorMessage ?? STALE_RUN_MESSAGE;
  await app.appContext.db
    .update(runsTable)
    .set({
      status: "stopped",
      endedAt,
      errorMessage
    })
    .where(eq(runsTable.id, runRow.id));

  return {
    ...runRow,
    status: "stopped",
    endedAt,
    errorMessage
  };
};

const resolveStepIndex = async (
  app: AppFastify,
  runId: string,
  stepRef: string
): Promise<number | null> => {
  const numeric = Number(stepRef);
  if (Number.isInteger(numeric) && numeric > 0) {
    return numeric;
  }

  const rows = (await app.appContext.db
    .select({ stepIndex: stepsTable.stepIndex })
    .from(stepsTable)
    .where(and(eq(stepsTable.id, stepRef), eq(stepsTable.runId, runId)))
    .limit(1)) as Array<{ stepIndex: number }>;

  const first = rows[0];
  if (!first) {
    return null;
  }
  return first.stepIndex;
};

const enrichRunsWithLatestStep = async (
  app: AppFastify,
  rows: RunRow[]
): Promise<Run[]> => {
  if (rows.length === 0) {
    return [];
  }

  const runIds = rows.map((row) => row.id);
  const stepRows = (await app.appContext.db
    .select({
      runId: stepsTable.runId,
      stepIndex: stepsTable.stepIndex,
      pageUrl: stepsTable.pageUrl,
      pageTitle: stepsTable.pageTitle
    })
    .from(stepsTable)
    .where(inArray(stepsTable.runId, runIds))
    .orderBy(desc(stepsTable.stepIndex))) as StepDigestRow[];

  const latestByRunId = new Map<string, StepDigestRow>();
  const countByRunId = new Map<string, number>();

  for (const step of stepRows) {
    countByRunId.set(step.runId, (countByRunId.get(step.runId) ?? 0) + 1);
    if (!latestByRunId.has(step.runId)) {
      latestByRunId.set(step.runId, step);
    }
  }

  return rows.map((row) => {
    const mapped = mapRunRow(row);
    const latestStep = latestByRunId.get(row.id);
    const stepCount = countByRunId.get(row.id) ?? 0;

    return {
      ...mapped,
      currentPageUrl: latestStep?.pageUrl ?? mapped.startupPageUrl,
      currentPageTitle: latestStep?.pageTitle ?? mapped.startupPageTitle,
      stepCount,
      lastStepIndex: latestStep?.stepIndex
    };
  });
};

const loadRunAnalysisContext = async (
  app: AppFastify,
  runId: string
): Promise<
  | {
      runRow: RunRow;
      run: Run;
      steps: Step[];
      traffic: NetworkEvidenceEntry[];
    }
  | undefined
> => {
  const runRows = (await app.appContext.db
    .select()
    .from(runsTable)
    .where(eq(runsTable.id, runId))
    .limit(1)) as RunRow[];
  const runRow = runRows[0];
  if (!runRow) {
    return undefined;
  }

  const effectiveRunRow = await reconcileDetachedRun(app, runRow);
  const [run] = await enrichRunsWithLatestStep(app, [effectiveRunRow]);
  if (!run) {
    return undefined;
  }

  const stepRows = (await app.appContext.db
    .select()
    .from(stepsTable)
    .where(eq(stepsTable.runId, runId))
    .orderBy(stepsTable.stepIndex)) as StepRow[];
  const evidence = await app.appContext.evidenceStore.readRunEvidence(runId);

  return {
    runRow: effectiveRunRow,
    run,
    steps: stepRows.map(mapStepRow),
    traffic: evidence?.network ?? []
  };
};

export const registerRunRoutes = (app: AppFastify): void => {
  app.get("/api/runs", async (request) => {
    const query = listRunsQuerySchema.parse(request.query);

    const rows = (query.projectId
      ? await app.appContext.db
          .select()
          .from(runsTable)
          .where(eq(runsTable.projectId, query.projectId))
          .orderBy(desc(runsTable.createdAt))
          .limit(query.limit)
      : await app.appContext.db
          .select()
          .from(runsTable)
          .orderBy(desc(runsTable.createdAt))
          .limit(query.limit)) as RunRow[];

    return enrichRunsWithLatestStep(app, rows);
  });

  app.get("/api/benchmarks/summary", async (request) => {
    const query = benchmarkQuerySchema.parse(request.query);
    const caseRows = (query.projectId
      ? await app.appContext.db
          .select()
          .from(caseTemplatesTable)
          .where(eq(caseTemplatesTable.projectId, query.projectId))
      : await app.appContext.db.select().from(caseTemplatesTable)) as CaseTemplateRow[];
    const runRows = (query.projectId
      ? await app.appContext.db
          .select()
          .from(runsTable)
          .where(eq(runsTable.projectId, query.projectId))
      : await app.appContext.db.select().from(runsTable)) as RunRow[];

    return BenchmarkSummarySchema.parse(
      buildBenchmarkSummary({
        projectId: query.projectId,
        language: query.lang,
        caseTemplates: caseRows
          .filter((row) => row.status === "active")
          .map(mapCaseTemplateRow),
        runs: await enrichRunsWithLatestStep(app, runRows)
      })
    );
  });

  app.get("/api/cases", async (request) => {
    const query = listCasesQuerySchema.parse(request.query);
    const rows = (query.projectId
      ? await app.appContext.db
          .select()
          .from(caseTemplatesTable)
          .where(eq(caseTemplatesTable.projectId, query.projectId))
          .orderBy(desc(caseTemplatesTable.createdAt))
          .limit(query.limit)
      : await app.appContext.db
          .select()
          .from(caseTemplatesTable)
          .orderBy(desc(caseTemplatesTable.createdAt))
          .limit(query.limit)) as CaseTemplateRow[];
    return rows.map(mapCaseTemplateRow);
  });

  app.post("/api/cases/extract", async (request, reply) => {
    const payload = extractCasesSchema.parse(request.body);
    const runRows = await app.appContext.db
      .select()
      .from(runsTable)
      .where(eq(runsTable.id, payload.runId))
      .limit(1);
    const runRow = runRows[0] as RunRow | undefined;
    if (!runRow) {
      return reply.status(404).send({ error: "Run not found" });
    }
    if (runRow.status !== "passed") {
      return reply.status(409).send({
        error: "Cases can only be extracted from a passed run."
      });
    }

    await app.appContext.orchestrator.extractCasesForRun(payload.runId);
    const rows = (await app.appContext.db
      .select()
      .from(caseTemplatesTable)
      .where(eq(caseTemplatesTable.runId, payload.runId))
      .orderBy(desc(caseTemplatesTable.createdAt))) as CaseTemplateRow[];
    return rows.map(mapCaseTemplateRow);
  });

  app.post("/api/cases/:caseId/replay", async (request, reply) => {
    if (app.appContext.orchestrator.isBusy()) {
      return reply.status(409).send({
        error: `Runtime is busy with run ${app.appContext.orchestrator.getActiveRunId()}`
      });
    }

    const params = replayCaseParamsSchema.parse(request.params);
    const payload = replayCaseBodySchema.parse(request.body ?? {});
    const caseRows = (await app.appContext.db
      .select()
      .from(caseTemplatesTable)
      .where(eq(caseTemplatesTable.id, params.caseId))
      .limit(1)) as CaseTemplateRow[];
    const caseRow = caseRows[0];
    if (!caseRow) {
      return reply.status(404).send({ error: "Case not found" });
    }
    try {
      const runRow = await startReplayRunFromCase(app, caseRow, payload);
      return mapRunRow(runRow);
    } catch (error) {
      return reply.status(409).send({
        error: error instanceof Error ? error.message : "Failed to start case replay."
      });
    }
  });

  app.get("/api/runs/compare", async (request, reply) => {
    const query = compareRunsQuerySchema.parse(request.query);
    if (query.baseRunId === query.candidateRunId) {
      return reply.status(400).send({
        error: "Base run and candidate run must be different."
      });
    }

    const [baseContext, candidateContext] = await Promise.all([
      loadRunAnalysisContext(app, query.baseRunId),
      loadRunAnalysisContext(app, query.candidateRunId)
    ]);

    if (!baseContext || !candidateContext) {
      return reply.status(404).send({ error: "One or both runs could not be found." });
    }
    if (baseContext.run.projectId !== candidateContext.run.projectId) {
      return reply.status(409).send({
        error: "The selected runs belong to different projects."
      });
    }

    return RunComparisonSchema.parse(
      buildRunComparison({
        baseRun: baseContext.run,
        baseSteps: baseContext.steps,
        baseTraffic: baseContext.traffic,
        candidateRun: candidateContext.run,
        candidateSteps: candidateContext.steps,
        candidateTraffic: candidateContext.traffic,
        language: query.lang
      })
    );
  });

  app.post("/api/cases/:caseId/repair-draft", async (request, reply) => {
    const params = replayCaseParamsSchema.parse(request.params);
    const payload = repairDraftBodySchema.parse(request.body ?? {});
    const context = await loadRepairDraftContext(app, {
      caseId: params.caseId,
      runId: payload.runId
    });

    if (!context?.caseRow) {
      return reply.status(404).send({ error: "Case not found" });
    }
    if (!context.runRow) {
      return reply.status(404).send({ error: "Run not found" });
    }
    if (context.caseRow.projectId !== context.runRow.projectId) {
      return reply.status(409).send({
        error: "The selected run and case template belong to different projects."
      });
    }
    if (!context.draft) {
      return reply.status(409).send({
        error: "No template repair draft could be generated from this run."
      });
    }

    return CaseTemplateRepairDraftSchema.parse(context.draft);
  });

  app.post("/api/cases/:caseId/apply-repair-draft", async (request, reply) => {
    const params = replayCaseParamsSchema.parse(request.params);
    const payload = repairDraftBodySchema.parse(request.body ?? {});
    if (payload.replay && app.appContext.orchestrator.isBusy()) {
      return reply.status(409).send({
        error: `Runtime is busy with run ${app.appContext.orchestrator.getActiveRunId()}`
      });
    }
    const context = await loadRepairDraftContext(app, {
      caseId: params.caseId,
      runId: payload.runId
    });

    if (!context?.caseRow) {
      return reply.status(404).send({ error: "Case not found" });
    }
    if (!context.runRow) {
      return reply.status(404).send({ error: "Run not found" });
    }
    if (context.caseRow.projectId !== context.runRow.projectId) {
      return reply.status(409).send({
        error: "The selected run and case template belong to different projects."
      });
    }
    if (!context.draft) {
      return reply.status(409).send({
        error: "No template repair draft could be generated from this run."
      });
    }

    const now = Date.now();
    await app.appContext.db
      .update(caseTemplatesTable)
      .set({
        caseJson: context.draft.nextCaseJson,
        updatedAt: now
      })
      .where(eq(caseTemplatesTable.id, params.caseId));

    const updatedRows = (await app.appContext.db
      .select()
      .from(caseTemplatesTable)
      .where(eq(caseTemplatesTable.id, params.caseId))
      .limit(1)) as CaseTemplateRow[];
    const updatedRow = updatedRows[0];
    if (!updatedRow) {
      return reply.status(500).send({ error: "Failed to reload the updated case template." });
    }

    let replayRun: Run | undefined;
    if (payload.replay) {
      try {
        const replayPayload = replayCaseBodySchema.parse(payload.replay);
        const replayRunRow = await startReplayRunFromCase(app, updatedRow, replayPayload);
        replayRun = mapRunRow(replayRunRow);
      } catch (error) {
        return reply.status(409).send({
          error:
            error instanceof Error
              ? error.message
              : "The template was updated, but replay validation could not be started."
        });
      }
    }

    return {
      ok: true,
      draft: CaseTemplateRepairDraftSchema.parse(context.draft),
      caseTemplate: mapCaseTemplateRow(updatedRow),
      replayRun
    };
  });

  app.post("/api/runs", async (request, reply) => {
    if (app.appContext.orchestrator.isBusy()) {
      return reply.status(409).send({
        error: `Runtime is busy with run ${app.appContext.orchestrator.getActiveRunId()}`
      });
    }

    const payload = createRunSchema.parse(request.body);
    let goal: string;
    let username: string | undefined;
    let password: string | undefined;
    try {
      const resolvedGoal = resolveUtf8TextInput({
        fieldName: "goal",
        value: payload.goal,
        valueBase64: payload.goalBase64
      });
      goal = resolvedGoal?.trim() ? resolvedGoal : DEFAULT_RUN_GOAL;
      username = resolveUtf8TextInput({
        fieldName: "username",
        value: payload.username,
        valueBase64: payload.usernameBase64
      });
      password = resolveUtf8TextInput({
        fieldName: "password",
        value: payload.password,
        valueBase64: payload.passwordBase64
      });
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : "Invalid UTF-8 payload."
      });
    }
    const headed = payload.headed || payload.manualTakeover;
    const projectRows = await app.appContext.db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, payload.projectId))
      .limit(1);
    if (!projectRows[0]) {
      return reply.status(404).send({ error: "Project not found" });
    }

    if (username || password) {
      const encryptedUsername = username
        ? encryptText(username, env.CREDENTIAL_MASTER_KEY)
        : undefined;
      const encryptedPassword = password
        ? encryptText(password, env.CREDENTIAL_MASTER_KEY)
        : undefined;
      await app.appContext.db
        .update(projectsTable)
        .set({
          usernameCipher: encryptedUsername?.ciphertext ?? null,
          usernameIv: encryptedUsername?.iv ?? null,
          usernameTag: encryptedUsername?.tag ?? null,
          passwordCipher: encryptedPassword?.ciphertext ?? null,
          passwordIv: encryptedPassword?.iv ?? null,
          passwordTag: encryptedPassword?.tag ?? null,
          updatedAt: Date.now()
        })
        .where(eq(projectsTable.id, payload.projectId));
    }

    const runConfig = buildRunConfig({
      targetUrl: payload.targetUrl,
      mode: payload.mode,
      language: payload.language,
      executionMode: payload.executionMode,
      confirmDraft: payload.confirmDraft,
      goal,
      maxSteps: payload.maxSteps,
      model: payload.model ?? env.OPENAI_MODEL,
      headed,
      manualTakeover: payload.manualTakeover,
      sessionProfile: payload.sessionProfile,
      saveSession: payload.saveSession
    });
    const runRow = await insertRun(app, {
      projectId: payload.projectId,
      mode: payload.mode,
      targetUrl: payload.targetUrl,
      goal,
      model: payload.model ?? env.OPENAI_MODEL,
      config: runConfig
    });

    setTimeout(() => {
      app.appContext.orchestrator.start(runRow.id).catch((error: unknown) => {
        app.log.error(error);
      });
    }, 0);

    return mapRunRow(runRow);
  });

  app.post("/api/runs/:runId/rerun", async (request, reply) => {
    if (app.appContext.orchestrator.isBusy()) {
      return reply.status(409).send({
        error: `Runtime is busy with run ${app.appContext.orchestrator.getActiveRunId()}`
      });
    }

    const params = runIdParamsSchema.parse(request.params);
    const payload = rerunRunBodySchema.parse(request.body ?? {});
    const runRows = (await app.appContext.db
      .select()
      .from(runsTable)
      .where(eq(runsTable.id, params.runId))
      .limit(1)) as RunRow[];
    const sourceRunRow = runRows[0];
    if (!sourceRunRow) {
      return reply.status(404).send({ error: "Run not found" });
    }

    const rerunRow = await startRerunFromRun(app, sourceRunRow, payload);
    return mapRunRow(rerunRow);
  });

  app.post("/api/runs/:runId/control", async (request, reply) => {
    const params = runIdParamsSchema.parse(request.params);
    const payload = runControlSchema.parse(request.body);

    switch (payload.command) {
      case "approve": {
        const approved = app.appContext.orchestrator.approveDraft(params.runId, payload.action);
        if (!approved) {
          return reply.status(409).send({
            error: "There is no draft action waiting for approval."
          });
        }
        return { ok: true, runId: params.runId, command: payload.command };
      }
      case "edit_and_run": {
        const approved = app.appContext.orchestrator.approveDraft(params.runId, payload.action);
        if (!approved) {
          return reply.status(409).send({
            error: "There is no draft action waiting to be edited and executed."
          });
        }
        return { ok: true, runId: params.runId, command: payload.command };
      }
      case "skip": {
        const skipped = app.appContext.orchestrator.skipDraft(params.runId);
        if (!skipped) {
          return reply.status(409).send({
            error: "There is no draft action waiting to be skipped."
          });
        }
        return { ok: true, runId: params.runId, command: payload.command };
      }
      case "retry": {
        const retried = app.appContext.orchestrator.retryDraft(params.runId);
        if (!retried) {
          return reply.status(409).send({
            error: "There is no draft action waiting to be retried."
          });
        }
        return { ok: true, runId: params.runId, command: payload.command };
      }
      case "switch_mode": {
        const switched = app.appContext.orchestrator.switchExecutionMode(
          params.runId,
          payload.executionMode
        );
        if (!switched) {
          return reply.status(409).send({
            error: "Run is not active or execution mode cannot be changed right now."
          });
        }
        const runRows = await app.appContext.db
          .select()
          .from(runsTable)
          .where(eq(runsTable.id, params.runId))
          .limit(1);
        const runRow = runRows[0] as RunRow | undefined;
        if (runRow) {
          await persistExecutionMode(app, runRow, payload.executionMode);
        }
        return {
          ok: true,
          runId: params.runId,
          command: payload.command,
          executionMode: payload.executionMode
        };
      }
      case "pause": {
        const paused = app.appContext.orchestrator.pauseRun(params.runId);
        if (!paused) {
          return reply.status(409).send({
            error: "Run is not active or cannot be paused."
          });
        }
        return { ok: true, runId: params.runId, command: payload.command };
      }
      case "resume": {
        const resumed = app.appContext.orchestrator.resumeRun(params.runId);
        if (!resumed) {
          return reply.status(409).send({
            error: "Run is not currently paused or waiting for manual intervention."
          });
        }
        return { ok: true, runId: params.runId, command: payload.command };
      }
      case "abort": {
        const aborted = app.appContext.orchestrator.abortRun(params.runId);
        if (!aborted) {
          return reply.status(409).send({
            error: "Run is not active or cannot be aborted."
          });
        }
        return { ok: true, runId: params.runId, command: payload.command };
      }
    }
  });

  app.post("/api/runs/:runId/resume", async (request, reply) => {
    const params = runIdParamsSchema.parse(request.params);
    const resumed = app.appContext.orchestrator.resumeRun(params.runId);
    if (!resumed) {
      return reply.status(409).send({
        error: "Run is not currently paused or waiting for manual intervention."
      });
    }

    return { ok: true, runId: params.runId };
  });

  app.post("/api/runs/:runId/pause", async (request, reply) => {
    const params = runIdParamsSchema.parse(request.params);
    const paused = app.appContext.orchestrator.pauseRun(params.runId);
    if (!paused) {
      return reply.status(409).send({
        error: "Run is not active or cannot be paused."
      });
    }

    return { ok: true, runId: params.runId };
  });

  app.post("/api/runs/:runId/abort", async (request, reply) => {
    const params = runIdParamsSchema.parse(request.params);
    const aborted = app.appContext.orchestrator.abortRun(params.runId);
    if (!aborted) {
      return reply.status(409).send({
        error: "Run is not active or cannot be aborted."
      });
    }

    return { ok: true, runId: params.runId };
  });

  app.post("/api/runs/:runId/bring-to-front", async (request, reply) => {
    const params = runIdParamsSchema.parse(request.params);
    const focused = await app.appContext.orchestrator.bringBrowserToFront(params.runId);
    if (!focused) {
      return reply.status(409).send({
        error: "The run does not currently have a visible browser page to focus."
      });
    }

    return { ok: true, runId: params.runId };
  });

  app.post("/api/runs/:runId/execution-mode", async (request, reply) => {
    const params = runIdParamsSchema.parse(request.params);
    const payload = executionModeSchema.parse(request.body);
    const switched = app.appContext.orchestrator.switchExecutionMode(
      params.runId,
      payload.executionMode as ExecutionMode
    );
    if (!switched) {
      return reply.status(409).send({
        error: "Run is not active or execution mode cannot be changed right now."
      });
    }
    const runRows = await app.appContext.db
      .select()
      .from(runsTable)
      .where(eq(runsTable.id, params.runId))
      .limit(1);
    const runRow = runRows[0] as RunRow | undefined;
    if (runRow) {
      await persistExecutionMode(app, runRow, payload.executionMode as ExecutionMode);
    }
    return { ok: true, runId: params.runId, executionMode: payload.executionMode };
  });

  app.post("/api/runs/:runId/draft/approve", async (request, reply) => {
    const params = runIdParamsSchema.parse(request.params);
    const payload = draftActionSchema.parse(request.body ?? {});
    const approved = app.appContext.orchestrator.approveDraft(params.runId, payload.action);
    if (!approved) {
      return reply.status(409).send({
        error: "There is no draft action waiting for approval."
      });
    }
    return { ok: true, runId: params.runId };
  });

  app.post("/api/runs/:runId/draft/skip", async (request, reply) => {
    const params = runIdParamsSchema.parse(request.params);
    const skipped = app.appContext.orchestrator.skipDraft(params.runId);
    if (!skipped) {
      return reply.status(409).send({
        error: "There is no draft action waiting to be skipped."
      });
    }
    return { ok: true, runId: params.runId };
  });

  app.get("/api/runs/:runId/diagnosis", async (request, reply) => {
    const params = runIdParamsSchema.parse(request.params);
    const query = diagnosisQuerySchema.parse(request.query);
    const context = await loadRunAnalysisContext(app, params.runId);
    if (!context) {
      return reply.status(404).send({ error: "Run not found" });
    }
    return RunDiagnosisSchema.parse(
      buildRunDiagnosis({
        run: context.run,
        steps: context.steps,
        traffic: context.traffic,
        language: query.lang
      })
    );
  });

  app.get("/api/runs/:runId", async (request, reply) => {
    const params = runIdParamsSchema.parse(request.params);
    const runRows = await app.appContext.db
      .select()
      .from(runsTable)
      .where(eq(runsTable.id, params.runId))
      .limit(1);
    const runRow = runRows[0] as RunRow | undefined;
    if (!runRow) {
      return reply.status(404).send({ error: "Run not found" });
    }

    const effectiveRunRow = await reconcileDetachedRun(app, runRow);
    const [enrichedRun] = await enrichRunsWithLatestStep(app, [effectiveRunRow]);
    if (!enrichedRun) {
      return reply.status(500).send({ error: "Run could not be enriched" });
    }
    return mergeRunExecutionMode(enrichedRun, getOverlayExecutionMode(app, params.runId));
  });

  app.get("/api/runs/:runId/steps", async (request) => {
    const params = runIdParamsSchema.parse(request.params);
    const rows = (await app.appContext.db
      .select()
      .from(stepsTable)
      .where(eq(stepsTable.runId, params.runId))
      .orderBy(stepsTable.stepIndex)) as StepRow[];
    return rows.map(mapStepRow);
  });

  app.get("/api/runs/:runId/testcases", async (request) => {
    const params = runIdParamsSchema.parse(request.params);
    const rows = (await app.appContext.db
      .select()
      .from(testCasesTable)
      .where(eq(testCasesTable.runId, params.runId))
      .orderBy(testCasesTable.createdAt)) as TestCaseRow[];
    return rows.map(mapTestCaseRow);
  });

  app.get("/api/runs/:runId/evidence", async (request) => {
    const params = runIdParamsSchema.parse(request.params);
    const evidence = await app.appContext.evidenceStore.readRunEvidence(params.runId);
    return (
      evidence ?? {
        runId: params.runId,
        updatedAt: new Date().toISOString(),
        console: [],
        network: [],
        planners: []
      }
    );
  });

  app.get("/api/runs/:runId/traffic", async (request) => {
    const params = runIdParamsSchema.parse(request.params);
    const evidence = await app.appContext.evidenceStore.readRunEvidence(params.runId);
    return evidence?.network ?? [];
  });

  app.get("/api/runs/:runId/steps/:stepRef/traffic", async (request, reply) => {
    const params = runStepParamsSchema.parse(request.params);
    const stepIndex = await resolveStepIndex(app, params.runId, params.stepRef);
    if (!stepIndex) {
      return reply.status(404).send({ error: "Step not found" });
    }
    const evidence = await app.appContext.evidenceStore.readRunEvidence(params.runId);
    return (evidence?.network ?? []).filter((entry) => entry.stepIndex === stepIndex);
  });

  app.get("/api/runs/:runId/cases", async (request) => {
    const params = runIdParamsSchema.parse(request.params);
    const rows = (await app.appContext.db
      .select()
      .from(caseTemplatesTable)
      .where(eq(caseTemplatesTable.runId, params.runId))
      .orderBy(desc(caseTemplatesTable.createdAt))) as CaseTemplateRow[];
    return rows.map(mapCaseTemplateRow);
  });

  app.get("/api/runs/:runId/report", async (request, reply) => {
    const params = runIdParamsSchema.parse(request.params);
    const rows = await app.appContext.db
      .select()
      .from(reportsTable)
      .where(eq(reportsTable.runId, params.runId))
      .limit(1);
    const report = rows[0];
    if (!report) {
      return reply.status(404).send({ error: "Report not found yet" });
    }
    return {
      runId: report.runId,
      htmlPath: report.htmlPath,
      xlsxPath: report.xlsxPath,
      createdAt: new Date(report.createdAt).toISOString()
    };
  });

  app.get("/api/runs/:runId/stream", async (request, reply) => {
    const params = runIdParamsSchema.parse(request.params);
    const clientId = nanoid();

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no"
    });

    app.appContext.sseHub.subscribe(params.runId, clientId, reply.raw);
    reply.raw.write(
      `event: connected\ndata: ${JSON.stringify({
        runId: params.runId,
        clientId,
        ts: new Date().toISOString()
      })}\n\n`
    );

    request.raw.on("close", () => {
      app.appContext.sseHub.unsubscribe(params.runId, clientId);
    });
  });
};
