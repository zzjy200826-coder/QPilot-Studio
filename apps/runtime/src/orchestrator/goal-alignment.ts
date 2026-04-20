import type {
  Action,
  GoalAlignmentStatus,
  InteractiveElement,
  PageSnapshot,
  PageState,
  RunStage,
  StageTransitionReason,
  StepOutcome
} from "@qpilot/shared";

export interface GoalAnchorProfile {
  source: string;
  query?: string;
  anchorPhrases: string[];
  entityTokens: string[];
}

export interface GoalTextAssessment {
  matchedPhrases: string[];
  matchedTokens: string[];
  missingTokens: string[];
  conflictingTokens: string[];
  aligned: boolean;
}

export interface GoalGuardMemory {
  avoidHosts: string[];
  avoidLabels: string[];
  alignment?: GoalAlignmentStatus;
  transitionReason?: StageTransitionReason;
  blockedStage?: string;
  avoidRepeatCredentialSubmission: boolean;
}

export interface GoalStageTransitionAssessment {
  stage: RunStage;
  alignment: GoalAlignmentStatus;
  reason: StageTransitionReason;
  blockedStage?: RunStage;
  avoidHosts: string[];
  avoidLabels: string[];
  missingTokens: string[];
  conflictingTokens: string[];
  shouldAvoidRepeatCredentialSubmission: boolean;
}

const SEARCH_HOSTS = ["baidu.com", "google.com", "bing.com", "sogou.com", "so.com", "yahoo.com"];
const SEARCH_CONTENT_SUBDOMAIN_PATTERN =
  /^(?:wenwen|zhidao|baike|wiki|answers?)\./i;
const AUTH_INTENT_PATTERN =
  /\b(?:login|sign\s*in|authorize|authorization|auth|account|password|username)\b|\u767b\u5f55|\u6388\u6743|\u8d26\u53f7|\u5bc6\u7801|\u7528\u6237\u540d|qq|\u5fae\u4fe1|wechat|weixin/i;
const ACTIONABLE_GOAL_PATTERN =
  /\b(?:login|sign\s*in|authorize|authorization|auth|open|enter|go\s+to|visit|click)\b|\u767b\u5f55|\u6388\u6743|\u6253\u5f00|\u8fdb\u5165|\u70b9\u51fb|\u8d26\u53f7|\u5bc6\u7801|\u5165\u53e3|\u5b98\u7f51/i;
const PROVIDER_CONTEXT_PATTERN =
  /\b(?:oauth|authorize|authorization|auth|provider|ptlogin|xlogin|login\.qq|graph\.qq|wechat|weixin|qq)\b|\u6388\u6743|\u626b\u7801|\u5fae\u4fe1|\u0051\u0051/i;
const CONTENT_PAGE_PATTERN =
  /\b(?:wiki|encyclopedia|faq|guide|tutorial|article|blog|wenwen|zhidao|quora)\b|\u95ee\u7b54|\u77e5\u9053|\u767e\u79d1|\u6559\u7a0b|\u653b\u7565|\u683c\u5f0f|\u5199\u6cd5|\u662f\u4ec0\u4e48|\u600e\u4e48|\u5982\u4f55|\u6b63\u786e\u4e66\u5199|\u5b9e\u65f6\u667a\u80fd\u56de\u590d/i;
const QUOTED_SEGMENT_PATTERN =
  /["'\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f\u300a\u300b](.+?)["'\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f\u300a\u300b]/g;
const SEARCH_INTENT_PATTERN =
  /\b(?:search|find|look\s+up)\b|\u641c\u7d22|\u67e5\u627e|\u641c\u4e00\u4e0b|\u767e\u5ea6\u4e00\u4e0b/i;
const SEARCH_QUERY_PATTERN =
  /(?:search|find|look\s+up|\u641c\u7d22|\u67e5\u627e|\u641c\u4e00\u4e0b|\u767e\u5ea6\u4e00\u4e0b)\s*[:\uff1a]?\s*(.+?)(?=(?:,|\uff0c|\.|\u3002|;|\uff1b|\bthen\b|\u7136\u540e|\u518d|\u5e76|\u5e76\u4e14|click|open|enter|go\s+to|login|sign\s*in|\u70b9\u51fb|\u6253\u5f00|\u8fdb\u5165|\u627e\u5230|\u767b\u5f55|$))/i;
const GOAL_NOISE_PATTERN =
  /(?:official\s+site|official|website|\u5b98\u7f51\u5165\u53e3|\u5b98\u65b9\u7f51\u7ad9|\u5b98\u7f51|\u5b98\u65b9|login|sign\s*in|\u767b\u5f55|\u0051\u0051\u767b\u5f55|\u5fae\u4fe1\u767b\u5f55|\u8d26\u53f7|\u5bc6\u7801|\u70b9\u51fb|\u6253\u5f00|\u8fdb\u5165|\u627e\u5230|\u4f7f\u7528|\u7136\u540e|\u5e76|\u5e76\u4e14|\u6d41\u7a0b|\u8fdb\u53bb|\u641c\u7d22|\u67e5\u627e|\u641c\u4e00\u4e0b|\u767e\u5ea6\u4e00\u4e0b)/gi;
const GENERIC_ENTITY_PATTERN =
  /^(?:official|site|website|search|result|results|login|signin|sign|account|password|username|email|mail|website|button|link|open|click|find|use|target|\u5b98\u7f51|\u5b98\u65b9|\u7f51\u7ad9|\u5165\u53e3|\u641c\u7d22|\u7ed3\u679c|\u767b\u5f55|\u8d26\u53f7|\u5bc6\u7801|\u7528\u6237\u540d|\u6253\u5f00|\u70b9\u51fb|\u67e5\u627e|\u4f7f\u7528|\u76ee\u6807)$/i;

const stripWrapperQuotes = (value: string): string =>
  value.replace(
    /^["'\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f\u300a\u300b]+|["'\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f\u300a\u300b]+$/gu,
    ""
  );

export const safeHost = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
};

export const isSearchHost = (url: string): boolean => {
  const host = safeHost(url);
  if (!host || SEARCH_CONTENT_SUBDOMAIN_PATTERN.test(host)) {
    return false;
  }
  return SEARCH_HOSTS.some((item) => host === item || host.endsWith(`.${item}`));
};

export const goalRequiresActionableDestination = (goal: string): boolean =>
  ACTIONABLE_GOAL_PATTERN.test(goal);

export const normalizeSemanticText = (value: string | undefined): string =>
  (value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");

const escapeObservationValue = (value: string): string =>
  value.replace(/[;|]/g, " ").replace(/\s+/g, " ").trim();

const extractQuotedSegments = (value?: string): string[] =>
  Array.from((value ?? "").matchAll(QUOTED_SEGMENT_PATTERN))
    .map((match) => stripWrapperQuotes(match[1] ?? "").trim())
    .filter((item) => item.length >= 2);

const sanitizeGoalFragment = (value: string): string =>
  stripWrapperQuotes(value)
    .replace(GOAL_NOISE_PATTERN, " ")
    .replace(/\s+/g, " ")
    .replace(/^[,.;:\uff0c\uff1b\uff1a]+|[,.;:\uff0c\uff1b\uff1a]+$/g, "")
    .trim();

const overlaps = (left: string, right: string): boolean =>
  left === right || left.includes(right) || right.includes(left);

const pushToken = (target: Set<string>, value: string): void => {
  const trimmed = stripWrapperQuotes(value).trim().toLowerCase();
  if (trimmed.length < 2 || GENERIC_ENTITY_PATTERN.test(trimmed)) {
    return;
  }

  target.add(trimmed);
};

const extractEntityTokens = (value: string): string[] => {
  const values = new Set<string>();
  const chunks = sanitizeGoalFragment(value)
    .split(/[^\p{L}\p{N}.]+/u)
    .map((item) => item.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    pushToken(values, chunk);

    const parts = chunk.match(/[a-z0-9]+(?:\.[a-z0-9]+)*|[\u4e00-\u9fff]{2,}/gi) ?? [];
    for (const part of parts) {
      pushToken(values, part);
    }
  }

  return Array.from(values);
};

export const deriveGoalAnchorProfile = (goal: string): GoalAnchorProfile | null => {
  const query =
    SEARCH_INTENT_PATTERN.test(goal)
      ? extractQuotedSegments(goal)[0] ?? SEARCH_QUERY_PATTERN.exec(goal)?.[1] ?? goal
      : goal;
  const source = sanitizeGoalFragment(query);
  if (source.length < 2) {
    return null;
  }

  const anchorPhrases = new Set<string>();
  anchorPhrases.add(source);

  const withoutOfficial = source
    .replace(/official|website|\u5b98\u7f51|\u5b98\u65b9/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (withoutOfficial.length >= 2) {
    anchorPhrases.add(withoutOfficial);
  }

  const entityTokens = extractEntityTokens(source);
  return {
    source,
    query: SEARCH_INTENT_PATTERN.test(goal) ? source : undefined,
    anchorPhrases: Array.from(anchorPhrases),
    entityTokens
  };
};

export const assessTextAgainstGoal = (
  text: string,
  profile: GoalAnchorProfile
): GoalTextAssessment => {
  const normalizedText = normalizeSemanticText(text);
  const matchedPhrases = profile.anchorPhrases.filter((item) =>
    normalizedText.includes(normalizeSemanticText(item))
  );
  const matchedTokens = profile.entityTokens.filter((item) =>
    normalizedText.includes(normalizeSemanticText(item))
  );
  const missingTokens = profile.entityTokens.filter((item) =>
    !matchedTokens.some((matched) => overlaps(normalizeSemanticText(item), normalizeSemanticText(matched)))
  );
  const candidateTokens = extractEntityTokens(text);
  const conflictingTokens = candidateTokens.filter((token) => {
    const normalizedToken = normalizeSemanticText(token);
    return (
      normalizedToken.length >= 2 &&
      !profile.entityTokens.some((item) => overlaps(normalizedToken, normalizeSemanticText(item)))
    );
  });

  const aligned =
    matchedPhrases.length > 0 ||
    (profile.entityTokens.length > 0 &&
      matchedTokens.length === profile.entityTokens.length) ||
    (profile.entityTokens.length > 0 &&
      matchedTokens.length >= Math.max(1, Math.ceil(profile.entityTokens.length * 0.6)) &&
      conflictingTokens.length === 0);

  return {
    matchedPhrases,
    matchedTokens,
    missingTokens,
    conflictingTokens,
    aligned
  };
};

const collectSnapshotSemanticText = (snapshot: PageSnapshot): string =>
  [
    snapshot.url,
    snapshot.title,
    ...snapshot.elements.slice(0, 40).flatMap((element) =>
      [
        element.text,
        element.title,
        element.ariaLabel,
        element.placeholder,
        element.nearbyText,
        element.contextLabel,
        element.frameTitle
      ].filter((value): value is string => Boolean(value && value.trim()))
    )
  ].join(" ");

export const snapshotLooksLikeContentPage = (snapshot: PageSnapshot): boolean => {
  const host = safeHost(snapshot.url) ?? "";
  const headText = [
    snapshot.url,
    snapshot.title,
    ...snapshot.elements.slice(0, 12).flatMap((element) =>
      [
        element.text,
        element.title,
        element.ariaLabel,
        element.nearbyText,
        element.contextLabel
      ].filter((value): value is string => Boolean(value && value.trim()))
    )
  ].join(" ");

  return /(?:wenwen|zhidao|wiki|baike|faq|guide|tutorial|article|blog)/i.test(host) ||
    CONTENT_PAGE_PATTERN.test(headText);
};

export const isGoalIntermediaryAuthSurface = (input: {
  goal: string;
  snapshot: PageSnapshot;
  pageState?: PageState;
}): boolean => {
  const pageState = input.pageState ?? input.snapshot.pageState;
  if (!pageState || !AUTH_INTENT_PATTERN.test(input.goal)) {
    return false;
  }

  if (pageState.surface === "provider_auth" || pageState.surface === "login_chooser") {
    return true;
  }

  if (pageState.surface === "security_challenge") {
    return true;
  }

  if (pageState.surface !== "login_form") {
    return false;
  }

  const signalText = pageState.matchedSignals.join(" ").toLowerCase();
  const semanticText = collectSnapshotSemanticText(input.snapshot).toLowerCase();
  return (
    pageState.hasIframe ||
    PROVIDER_CONTEXT_PATTERN.test(semanticText) ||
    /provider|oauth|auth|iframe|chooser/.test(signalText)
  );
};

const summarizeSnapshotLabel = (snapshot: PageSnapshot): string | undefined =>
  [
    snapshot.title,
    ...snapshot.elements
      .map((element) => element.text ?? element.title ?? element.ariaLabel)
      .filter((value): value is string => Boolean(value && value.trim()))
  ]
    .map((value) => value.trim())
    .find((value) => value.length >= 2);

const buildWrongTargetAssessment = (input: {
  stage: RunStage;
  reason: Extract<StageTransitionReason, "content_detour" | "goal_mismatch">;
  snapshot: PageSnapshot;
  assessment?: GoalTextAssessment | null;
  shouldAvoidRepeatCredentialSubmission?: boolean;
}): GoalStageTransitionAssessment => {
  const host = safeHost(input.snapshot.url);
  const label = summarizeSnapshotLabel(input.snapshot);

  return {
    stage: input.stage,
    alignment: "wrong_target",
    reason: input.reason,
    blockedStage: undefined,
    avoidHosts: host ? [host] : [],
    avoidLabels: label ? [label] : [],
    missingTokens: input.assessment?.missingTokens ?? [],
    conflictingTokens: input.assessment?.conflictingTokens ?? [],
    shouldAvoidRepeatCredentialSubmission: Boolean(input.shouldAvoidRepeatCredentialSubmission)
  };
};

export const assessGoalStageTransition = (input: {
  goal: string;
  snapshot: PageSnapshot;
  pageState?: PageState;
  action?: Action;
  outcome?: StepOutcome;
}): GoalStageTransitionAssessment => {
  const pageState = input.pageState ?? input.snapshot.pageState;
  const shouldAvoidRepeatCredentialSubmission = Boolean(pageState?.authErrorText);

  if (input.outcome === "terminal_success") {
    return {
      stage: "completed",
      alignment: "aligned",
      reason: "completed",
      blockedStage: undefined,
      avoidHosts: [],
      avoidLabels: [],
      missingTokens: [],
      conflictingTokens: [],
      shouldAvoidRepeatCredentialSubmission
    };
  }

  if (pageState?.surface === "security_challenge") {
    return {
      stage: "security_challenge",
      alignment: "blocked",
      reason: "security_challenge",
      blockedStage: "security_challenge",
      avoidHosts: [],
      avoidLabels: [],
      missingTokens: [],
      conflictingTokens: [],
      shouldAvoidRepeatCredentialSubmission: true
    };
  }

  if (isSearchHost(input.snapshot.url)) {
    return {
      stage: "searching",
      alignment: "unknown",
      reason: "search_surface",
      blockedStage: undefined,
      avoidHosts: [],
      avoidLabels: [],
      missingTokens: [],
      conflictingTokens: [],
      shouldAvoidRepeatCredentialSubmission
    };
  }

  if (isGoalIntermediaryAuthSurface(input)) {
    const stage = pageState?.surface === "login_form" ? "credential_form" : "provider_auth";
    return {
      stage,
      alignment: "intermediate_auth",
      reason: stage === "credential_form" ? "credential_form" : "provider_auth",
      blockedStage: undefined,
      avoidHosts: [],
      avoidLabels: [],
      missingTokens: [],
      conflictingTokens: [],
      shouldAvoidRepeatCredentialSubmission
    };
  }

  const profile = deriveGoalAnchorProfile(input.goal);
  const assessment = profile
    ? assessTextAgainstGoal(collectSnapshotSemanticText(input.snapshot), profile)
    : null;
  const contentDetour =
    goalRequiresActionableDestination(input.goal) &&
    snapshotLooksLikeContentPage(input.snapshot);
  const authenticatedLandingAligned =
    pageState?.surface === "dashboard_like" &&
    AUTH_INTENT_PATTERN.test(input.goal) &&
    ((assessment?.matchedPhrases.length ?? 0) > 0 || (assessment?.matchedTokens.length ?? 0) > 0);

  if (contentDetour) {
    return buildWrongTargetAssessment({
      stage: "content_detour",
      reason: "content_detour",
      snapshot: input.snapshot,
      assessment,
      shouldAvoidRepeatCredentialSubmission
    });
  }

  if (pageState?.surface === "dashboard_like" && authenticatedLandingAligned) {
    return {
      stage: "authenticated_app",
      alignment: "aligned",
      reason: "authenticated_app",
      blockedStage: undefined,
      avoidHosts: [],
      avoidLabels: [],
      missingTokens: [],
      conflictingTokens: [],
      shouldAvoidRepeatCredentialSubmission
    };
  }

  const stage: RunStage =
    pageState?.surface === "login_form"
      ? "credential_form"
      : pageState?.surface === "provider_auth" || pageState?.surface === "login_chooser"
        ? "provider_auth"
        : pageState?.surface === "dashboard_like"
          ? "authenticated_app"
          : input.snapshot.url
            ? "target_site"
            : "unknown";

  if (!profile) {
    return {
      stage,
      alignment: "unknown",
      reason:
        stage === "credential_form"
          ? "credential_form"
          : stage === "provider_auth"
            ? "provider_auth"
            : stage === "authenticated_app"
              ? "authenticated_app"
              : stage === "target_site"
                ? "target_site"
                : "unknown",
      blockedStage: undefined,
      avoidHosts: [],
      avoidLabels: [],
      missingTokens: [],
      conflictingTokens: [],
      shouldAvoidRepeatCredentialSubmission
    };
  }

  const aligned =
    Boolean(assessment?.aligned) &&
    !(goalRequiresActionableDestination(input.goal) && snapshotLooksLikeContentPage(input.snapshot));
  if (aligned) {
    return {
      stage,
      alignment: "aligned",
      reason:
        stage === "credential_form"
          ? "credential_form"
          : stage === "provider_auth"
            ? "provider_auth"
            : stage === "authenticated_app"
              ? "authenticated_app"
              : "target_site",
      blockedStage: undefined,
      avoidHosts: [],
      avoidLabels: [],
      missingTokens: assessment?.missingTokens ?? [],
      conflictingTokens: assessment?.conflictingTokens ?? [],
      shouldAvoidRepeatCredentialSubmission
    };
  }

  return buildWrongTargetAssessment({
    stage,
    reason: "goal_mismatch",
    snapshot: input.snapshot,
    assessment,
    shouldAvoidRepeatCredentialSubmission
  });
};

export const buildGoalGuardObservation = (input: {
  goal: string;
  snapshot: PageSnapshot;
  pageState?: PageState;
  action?: Action;
}): string | undefined => {
  const transition = assessGoalStageTransition(input);
  if (transition.alignment === "blocked") {
    return "goal_guard=blocked_stage; stage=security_challenge; reason=security_challenge; avoid_repeat=credential_submission";
  }

  if (transition.alignment !== "wrong_target") {
    return undefined;
  }

  const parts = ["goal_guard=wrong_target"];
  parts.push(`reason=${transition.reason}`);
  for (const host of transition.avoidHosts) {
    parts.push(`avoid_host=${escapeObservationValue(host)}`);
  }
  for (const label of transition.avoidLabels) {
    parts.push(`avoid_label=${escapeObservationValue(label)}`);
  }
  if (transition.missingTokens.length > 0) {
    parts.push(`required=${escapeObservationValue(transition.missingTokens.slice(0, 3).join(","))}`);
  }
  if (transition.conflictingTokens.length > 0) {
    parts.push(`conflict=${escapeObservationValue(transition.conflictingTokens.slice(0, 3).join(","))}`);
  }

  return parts.join("; ");
};

export const parseGoalGuardMemory = (observation?: string): GoalGuardMemory => {
  const guardValue = Array.from((observation ?? "").matchAll(/goal_guard=([^;|]+)/gi))
    .map((match) => match[1]?.trim().toLowerCase() ?? "")
    .find(Boolean);
  const avoidHosts = Array.from(
    new Set(
      Array.from((observation ?? "").matchAll(/avoid_host=([^;|]+)/gi))
        .map((match) => match[1]?.trim().toLowerCase() ?? "")
        .filter((item) => item.length >= 2)
    )
  );
  const avoidLabels = Array.from(
    new Set(
      Array.from((observation ?? "").matchAll(/avoid_label=([^;|]+)/gi))
        .map((match) => match[1]?.trim() ?? "")
        .filter((item) => item.length >= 2)
    )
  );
  const blockedStage = Array.from((observation ?? "").matchAll(/stage=([^;|]+)/gi))
    .map((match) => match[1]?.trim().toLowerCase() ?? "")
    .find(Boolean);
  const transitionReason = Array.from((observation ?? "").matchAll(/reason=([^;|]+)/gi))
    .map((match) => match[1]?.trim().toLowerCase() ?? "")
    .find(Boolean) as StageTransitionReason | undefined;

  return {
    avoidHosts,
    avoidLabels,
    alignment:
      guardValue === "wrong_target"
        ? "wrong_target"
        : guardValue === "blocked_stage"
          ? "blocked"
          : undefined,
    transitionReason,
    blockedStage,
    avoidRepeatCredentialSubmission: /avoid_repeat=credential_submission/i.test(observation ?? "")
  };
};
