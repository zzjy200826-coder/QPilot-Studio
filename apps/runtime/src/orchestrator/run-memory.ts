import type {
  PageSnapshot,
  PageState,
  RunStage,
  RunWorkingMemory,
  StepOutcome,
  VerificationResult
} from "@qpilot/shared";
import {
  assessGoalStageTransition,
  deriveGoalAnchorProfile,
  parseGoalGuardMemory
} from "./goal-alignment.js";

const unique = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

const collectGoalAnchors = (goal: string): string[] => {
  const profile = deriveGoalAnchorProfile(goal);
  if (!profile) {
    return [];
  }

  return unique([...profile.anchorPhrases, ...profile.entityTokens]);
};

const collectSuccessSignals = (input: {
  snapshot: PageSnapshot;
  pageState?: PageState;
  verification?: VerificationResult;
}): string[] => {
  const signals = new Set<string>();
  const pageState = input.pageState ?? input.snapshot.pageState;

  if (pageState?.surface === "dashboard_like") {
    signals.add("dashboard_like");
  }
  if (pageState?.matchedSignals.includes("post-login-copy")) {
    signals.add("post-login-copy");
  }
  if (input.verification?.api?.sessionSignals) {
    signals.add("session_signals");
  }
  if (input.verification?.api?.tokenSignals) {
    signals.add("token_signals");
  }
  if (/inbox|compose|\u6536\u4ef6\u7bb1|\u5199\u4fe1/i.test(input.snapshot.title)) {
    signals.add("app_title");
  }

  return Array.from(signals);
};

export const deriveRunStage = (input: {
  goal: string;
  snapshot: PageSnapshot;
  pageState?: PageState;
  outcome?: StepOutcome;
}): RunStage => {
  return assessGoalStageTransition(input).stage;
};

export const deriveStepOutcome = (input: {
  verification: VerificationResult;
  haltReason?: string;
  actionStatus: "success" | "failed" | "blocked_high_risk";
  credentialValidationReason?: string;
}): StepOutcome => {
  if (input.credentialValidationReason) {
    return "terminal_failure";
  }
  if (input.haltReason) {
    return input.verification.pageState?.surface === "security_challenge"
      ? "blocking_failure"
      : "terminal_failure";
  }
  if (input.verification.passed) {
    return "progressed";
  }
  if (input.actionStatus === "blocked_high_risk") {
    return "blocking_failure";
  }
  if (
    input.verification.pageState?.surface === "security_challenge" ||
    input.verification.execution?.failureCategory === "security_challenge"
  ) {
    return "blocking_failure";
  }
  if (input.actionStatus === "failed") {
    return "recoverable_failure";
  }

  return "recoverable_failure";
};

export const buildRunWorkingMemory = (input: {
  goal: string;
  snapshot: PageSnapshot;
  pageState?: PageState;
  verification?: VerificationResult;
  previousMemory?: RunWorkingMemory;
  goalGuardObservation?: string;
  outcome?: StepOutcome;
}): RunWorkingMemory => {
  const pageState = input.pageState ?? input.snapshot.pageState;
  const guardMemory = parseGoalGuardMemory(input.goalGuardObservation);
  const transition = assessGoalStageTransition({
    goal: input.goal,
    snapshot: input.snapshot,
    pageState,
    outcome: input.outcome
  });

  return {
    stage: transition.stage,
    alignment: transition.alignment ?? guardMemory.alignment ?? "unknown",
    transitionReason: transition.reason ?? guardMemory.transitionReason,
    goalAnchors:
      input.previousMemory?.goalAnchors?.length
        ? input.previousMemory.goalAnchors
        : collectGoalAnchors(input.goal),
    avoidHosts: unique([
      ...(input.previousMemory?.avoidHosts ?? []),
      ...guardMemory.avoidHosts,
      ...transition.avoidHosts
    ]),
    avoidLabels: unique([
      ...(input.previousMemory?.avoidLabels ?? []),
      ...guardMemory.avoidLabels,
      ...transition.avoidLabels
    ]),
    blockedStage: transition.blockedStage,
    avoidRepeatCredentialSubmission:
      transition.shouldAvoidRepeatCredentialSubmission ||
      guardMemory.avoidRepeatCredentialSubmission ||
      Boolean(pageState?.authErrorText),
    lastOutcome: input.outcome,
    lastStepUrl: input.snapshot.url,
    successSignals: collectSuccessSignals({
      snapshot: input.snapshot,
      pageState,
      verification: input.verification
    })
  };
};

export const summarizeRunWorkingMemory = (
  memory: RunWorkingMemory | undefined
): string | undefined => {
  if (!memory) {
    return undefined;
  }

  const parts = [`memory_stage=${memory.stage}`];
  parts.push(`memory_align=${memory.alignment}`);
  if (memory.transitionReason) {
    parts.push(`memory_reason=${memory.transitionReason}`);
  }
  if (memory.lastOutcome) {
    parts.push(`memory_outcome=${memory.lastOutcome}`);
  }
  if (memory.goalAnchors.length > 0) {
    parts.push(`memory_goal=${memory.goalAnchors.slice(0, 3).join(",")}`);
  }
  if (memory.successSignals.length > 0) {
    parts.push(`memory_success=${memory.successSignals.join(",")}`);
  }
  if (memory.blockedStage) {
    parts.push(`memory_blocked=${memory.blockedStage}`);
  }

  return parts.join("; ");
};

export const markRunWorkingMemoryCompleted = (
  memory: RunWorkingMemory | undefined
): RunWorkingMemory | undefined =>
  memory
    ? {
        ...memory,
        stage: "completed",
        alignment: "aligned",
        transitionReason: "completed",
        lastOutcome: "terminal_success"
      }
    : undefined;
