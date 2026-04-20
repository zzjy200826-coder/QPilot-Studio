import { z } from "zod";
import { ActionSchema, type ReplayCase, type ReplayCaseStep, type TrafficAssertion } from "@qpilot/shared";
import type { CaseTemplateRow } from "../utils/mappers.js";

const TrafficAssertionLikeSchema = z.object({
  method: z.string().optional(),
  pathname: z.string().optional(),
  host: z.string().optional(),
  status: z.number().int().nonnegative().optional(),
  resourceType: z.string().optional()
});

interface CaseTemplateJsonPayload {
  steps?: Array<Record<string, unknown>>;
}

export interface CaseTemplateEntrySignature {
  pageUrl?: string;
  pageTitle?: string;
  surface?: string;
  matchedSignals: string[];
  stepCount: number;
}

const parseCaseJson = (
  row: Pick<CaseTemplateRow, "caseJson">
): CaseTemplateJsonPayload => {
  try {
    return JSON.parse(row.caseJson) as CaseTemplateJsonPayload;
  } catch {
    return {};
  }
};

const toExpectedChecks = (step: Record<string, unknown>): string[] => {
  const raw = step.expectedChecks;
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === "string" && item.length > 0);
  }

  const verification = step.verification as
    | {
        checks?: Array<{ expected?: string }>;
      }
    | undefined;

  return (
    verification?.checks
      ?.map((item) => item.expected)
      .filter((item): item is string => typeof item === "string" && item.length > 0) ?? []
  );
};

const toExpectedRequests = (step: Record<string, unknown>): TrafficAssertion[] => {
  const raw = step.expectedRequests;
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        const parsed = TrafficAssertionLikeSchema.safeParse(item);
        return parsed.success ? parsed.data : null;
      })
      .filter((item): item is TrafficAssertion => Boolean(item));
  }

  const traffic = step.traffic;
  if (!Array.isArray(traffic)) {
    return [];
  }

  return traffic
    .map((item) => {
      const parsed = TrafficAssertionLikeSchema.safeParse(item);
      return parsed.success ? parsed.data : null;
    })
    .filter((item): item is TrafficAssertion => Boolean(item));
};

export const normalizeReplaySteps = (
  row: Pick<CaseTemplateRow, "caseJson">
): ReplayCaseStep[] => {
  const parsed = parseCaseJson(row);
  const steps = parsed.steps ?? [];

  return steps.reduce<ReplayCaseStep[]>((all, step, index) => {
    const action = ActionSchema.safeParse(step.action);
    if (!action.success) {
      return all;
    }

    const nextIndex =
      typeof step.index === "number" && Number.isInteger(step.index) && step.index > 0
        ? step.index
        : index + 1;

    all.push({
      index: nextIndex,
      action: action.data,
      expectedChecks: toExpectedChecks(step),
      expectedRequests: toExpectedRequests(step),
      note: typeof step.note === "string" ? step.note : undefined
    });
    return all;
  }, []);
};

export const buildReplayCaseFromTemplate = (
  row: CaseTemplateRow
): ReplayCase | null => {
  if (row.type === "api") {
    return null;
  }

  const steps = normalizeReplaySteps(row);
  if (steps.length === 0) {
    return null;
  }

  return {
    templateId: row.id,
    title: row.title,
    type: row.type === "hybrid" ? "hybrid" : "ui",
    sourceRunId: row.runId,
    steps
  };
};

export const extractCaseTemplateEntrySignature = (
  row: Pick<CaseTemplateRow, "caseJson">
): CaseTemplateEntrySignature => {
  const parsed = parseCaseJson(row);
  const steps = parsed.steps ?? [];
  const firstStep = steps[0];
  const verification = firstStep?.verification as
    | {
        pageState?: {
          surface?: unknown;
          matchedSignals?: unknown[];
        };
      }
    | undefined;

  return {
    pageUrl: typeof firstStep?.pageUrl === "string" ? firstStep.pageUrl : undefined,
    pageTitle: typeof firstStep?.pageTitle === "string" ? firstStep.pageTitle : undefined,
    surface:
      typeof verification?.pageState?.surface === "string"
        ? verification.pageState.surface
        : undefined,
    matchedSignals: Array.isArray(verification?.pageState?.matchedSignals)
      ? verification.pageState.matchedSignals.filter(
          (item): item is string => typeof item === "string" && item.length > 0
        )
      : [],
    stepCount: steps.length
  };
};
