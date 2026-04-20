import {
  ActionSchema,
  TrafficAssertionSchema,
  type Action,
  type CaseTemplateRepairDraft,
  type TrafficAssertion
} from "@qpilot/shared";
import type { CaseTemplateRow, StepRow } from "../utils/mappers.js";
import { mapStepRow } from "../utils/mappers.js";

interface CaseTemplateJsonPayload {
  executionMode?: string;
  goal?: string;
  entryUrl?: string;
  steps?: Array<Record<string, unknown>>;
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
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => {
      const parsed = TrafficAssertionSchema.safeParse(item);
      return parsed.success ? parsed.data : null;
    })
    .filter((item): item is TrafficAssertion => Boolean(item));
};

interface RepairCandidateInput {
  stepRow: StepRow;
  step: ReturnType<typeof mapStepRow>;
  confidence: number;
  reason?: string;
  repairHint?: string;
  action: Action;
  suggestedExpectedChecks: string[];
  suggestedExpectedRequests: TrafficAssertion[];
  templateStepIndex: number;
}

const selectBestRepairCandidates = (
  caseId: string,
  stepRows: StepRow[]
): Map<number, RepairCandidateInput> => {
  const map = new Map<number, RepairCandidateInput>();

  for (const stepRow of stepRows) {
    const step = mapStepRow(stepRow);
    const candidate = step.verificationResult.execution?.templateRepairCandidate;
    if (!candidate || candidate.templateId !== caseId) {
      continue;
    }

    const next: RepairCandidateInput = {
      stepRow,
      step,
      confidence: candidate.confidence,
      reason: candidate.reason,
      repairHint: candidate.repairHint,
      action: candidate.action,
      suggestedExpectedChecks: candidate.suggestedExpectedChecks,
      suggestedExpectedRequests: candidate.suggestedExpectedRequests,
      templateStepIndex: candidate.templateStepIndex
    };

    const current = map.get(candidate.templateStepIndex);
    if (
      !current ||
      next.confidence > current.confidence ||
      (next.confidence === current.confidence && next.step.index > current.step.index)
    ) {
      map.set(candidate.templateStepIndex, next);
    }
  }

  return map;
};

export const buildCaseTemplateRepairDraft = (input: {
  caseTemplate: CaseTemplateRow;
  runId: string;
  stepRows: StepRow[];
}): CaseTemplateRepairDraft | null => {
  if (input.caseTemplate.type === "api") {
    return null;
  }

  const parsed = parseCaseJson(input.caseTemplate);
  const steps = parsed.steps ?? [];
  if (steps.length === 0) {
    return null;
  }

  const candidateMap = selectBestRepairCandidates(input.caseTemplate.id, input.stepRows);
  if (candidateMap.size === 0) {
    return null;
  }

  const changes: CaseTemplateRepairDraft["changes"] = [];
  const nextSteps = steps.map((rawStep, index) => {
    const stepIndex =
      typeof rawStep.index === "number" && Number.isInteger(rawStep.index) && rawStep.index > 0
        ? rawStep.index
        : index + 1;
    const candidate = candidateMap.get(stepIndex);
    if (!candidate) {
      return rawStep;
    }

    const previousAction =
      ActionSchema.safeParse(rawStep.action).success
        ? ActionSchema.parse(rawStep.action)
        : candidate.step.action;
    const previousExpectedChecks = toExpectedChecks(rawStep);
    const previousExpectedRequests = toExpectedRequests(rawStep);
    const nextExpectedChecks =
      candidate.suggestedExpectedChecks.length > 0
        ? candidate.suggestedExpectedChecks
        : previousExpectedChecks;
    const nextExpectedRequests =
      candidate.suggestedExpectedRequests.length > 0
        ? candidate.suggestedExpectedRequests
        : previousExpectedRequests;

    changes.push({
      templateStepIndex: stepIndex,
      sourceRunId: input.runId,
      sourceStepId: candidate.step.id,
      confidence: candidate.confidence,
      previousAction,
      nextAction: candidate.action,
      previousExpectedChecks,
      nextExpectedChecks,
      previousExpectedRequests,
      nextExpectedRequests,
      reason: candidate.reason,
      repairHint: candidate.repairHint
    });

    return {
      ...rawStep,
      action: candidate.action,
      expectedChecks: nextExpectedChecks,
      ...(input.caseTemplate.type === "hybrid"
        ? {
            expectedRequests: nextExpectedRequests
          }
        : {})
    };
  });

  if (changes.length === 0) {
    return null;
  }

  return {
    caseId: input.caseTemplate.id,
    caseTitle: input.caseTemplate.title,
    templateType: input.caseTemplate.type === "hybrid" ? "hybrid" : "ui",
    runId: input.runId,
    generatedAt: new Date().toISOString(),
    changeCount: changes.length,
    changes,
    nextCaseJson: JSON.stringify({
      ...parsed,
      steps: nextSteps
    })
  };
};
