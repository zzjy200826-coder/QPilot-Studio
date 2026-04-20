import type { Action, PageState, StepFailureCategory } from "@qpilot/shared";

export interface GeneralFlowAttempt {
  action: Action;
  pageUrl: string;
  pageState?: PageState;
  failureCategory?: StepFailureCategory;
  hasPlannedFollowUp?: boolean;
}

export interface RepeatedAttemptGuard {
  streakLength: number;
  host?: string;
  surface?: PageState["surface"];
}

const REPLAN_CATEGORIES = new Set<StepFailureCategory>([
  "locator_miss",
  "element_not_interactable",
  "wrong_target",
  "no_effect",
  "api_mismatch"
]);

const safeHost = (value: string): string | null => {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const normalizeActionKey = (action: Action): string =>
  `${action.type}:${(action.target ?? "").trim().toLowerCase()}`;

export const detectCredentialValidationFailure = (
  attempt: Pick<GeneralFlowAttempt, "action" | "pageState">
): string | undefined => {
  const authErrorText = attempt.pageState?.authErrorText?.trim();
  if (!authErrorText) {
    return undefined;
  }

  if (attempt.action.type === "wait" || attempt.action.type === "navigate") {
    return undefined;
  }

  return authErrorText;
};

export const shouldReplanAfterRecoverableStep = (attempt: GeneralFlowAttempt): boolean => {
  if (detectCredentialValidationFailure(attempt)) {
    return false;
  }

  if (!attempt.failureCategory || !REPLAN_CATEGORIES.has(attempt.failureCategory)) {
    return false;
  }

  if (
    attempt.failureCategory === "no_effect" &&
    attempt.action.type === "input" &&
    attempt.hasPlannedFollowUp
  ) {
    return false;
  }

  if (attempt.failureCategory === "api_mismatch") {
    return attempt.action.type === "click" || attempt.action.type === "navigate";
  }

  return true;
};

export const shouldClearFlowFailuresAfterSuccess = (input: {
  isFinished: boolean;
  latestVerificationPassed?: boolean;
  haltReason?: string;
}): boolean =>
  Boolean(
    input.isFinished &&
      input.latestVerificationPassed &&
      !input.haltReason
  );

export const detectRepeatedIneffectiveAttempts = (
  attempts: GeneralFlowAttempt[],
  minimumStreak = 3
): RepeatedAttemptGuard | null => {
  const streak: GeneralFlowAttempt[] = [];

  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const attempt = attempts[index];
    if (!attempt) {
      continue;
    }
    if (!attempt.failureCategory || !REPLAN_CATEGORIES.has(attempt.failureCategory)) {
      break;
    }
    if (
      attempt.failureCategory === "no_effect" &&
      attempt.action.type === "input" &&
      attempt.hasPlannedFollowUp
    ) {
      continue;
    }
    streak.unshift(attempt);
  }

  const lastSurface = streak[streak.length - 1]?.pageState?.surface;
  const effectiveMinimumStreak =
    lastSurface === "security_challenge" ? Math.min(minimumStreak, 2) : minimumStreak;

  if (streak.length < effectiveMinimumStreak) {
    return null;
  }

  const hosts = new Set(
    streak.map((attempt) => safeHost(attempt.pageUrl) ?? "unknown")
  );
  if (hosts.size !== 1) {
    return null;
  }

  const surfaces = new Set(
    streak.map((attempt) => attempt.pageState?.surface ?? "generic")
  );
  const urls = new Set(streak.map((attempt) => attempt.pageUrl));
  const nonWaitActionKeys = streak
    .filter((attempt) => attempt.action.type !== "wait")
    .map((attempt) => normalizeActionKey(attempt.action))
    .filter((value) => value.length > 0);
  const repeatedTarget =
    nonWaitActionKeys.length > 0 && new Set(nonWaitActionKeys).size === 1;
  const stableSurface = surfaces.size === 1;
  const stableUrl = urls.size === 1;

  if (!repeatedTarget && !(stableSurface && stableUrl)) {
    return null;
  }

  const [host] = Array.from(hosts);
  const [surface] = Array.from(surfaces);

  return {
    streakLength: streak.length,
    host: host === "unknown" ? undefined : host,
    surface
  };
};
