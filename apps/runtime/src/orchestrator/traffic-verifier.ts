import type {
  ApiVerificationRequest,
  ApiVerificationResult,
  NetworkEvidenceEntry,
  TrafficAssertion,
  VerificationRule
} from "@qpilot/shared";

const RELEVANT_RESOURCE_TYPES = new Set(["xhr", "fetch", "document"]);
const TOKEN_PATTERN = /\b(access_token|refresh_token|id_token|token)\b/i;
const SESSION_PATTERN = /\b(session|sessionid|session_id|sid|jsessionid)\b/i;

const toUrl = (value?: string): URL | null => {
  if (!value) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const isRelevantEntry = (entry: NetworkEvidenceEntry): boolean =>
  entry.phase === "failed" ||
  !entry.resourceType ||
  RELEVANT_RESOURCE_TYPES.has(entry.resourceType);

const includesMarker = (value: string | undefined, pattern: RegExp): boolean =>
  Boolean(value && pattern.test(value));

const matchesExpectedRequest = (
  expected: TrafficAssertion,
  entry: NetworkEvidenceEntry
): boolean => {
  if (expected.method && expected.method.toUpperCase() !== entry.method.toUpperCase()) {
    return false;
  }
  if (expected.host && expected.host !== entry.host) {
    return false;
  }
  if (expected.pathname && expected.pathname !== entry.pathname) {
    return false;
  }
  if (expected.resourceType && expected.resourceType !== entry.resourceType) {
    return false;
  }
  if (
    typeof expected.status === "number" &&
    typeof entry.status === "number" &&
    expected.status !== entry.status
  ) {
    return false;
  }
  if (
    typeof expected.status === "number" &&
    typeof entry.status !== "number" &&
    entry.phase !== "failed"
  ) {
    return false;
  }
  return true;
};

const toVerificationRequest = (
  entry: NetworkEvidenceEntry,
  expectedRequests: TrafficAssertion[]
): ApiVerificationRequest => {
  const tokenLike =
    includesMarker(entry.bodyPreview, TOKEN_PATTERN) ||
    includesMarker(entry.pathname, TOKEN_PATTERN);
  const sessionLike =
    includesMarker(entry.bodyPreview, SESSION_PATTERN) ||
    includesMarker(entry.pathname, SESSION_PATTERN);

  return {
    method: entry.method,
    url: entry.url,
    host: entry.host,
    pathname: entry.pathname,
    resourceType: entry.resourceType,
    status: entry.status,
    ok: entry.ok,
    phase: entry.phase,
    contentType: entry.contentType,
    bodyPreview: entry.bodyPreview,
    tokenLike,
    sessionLike,
    matchedExpected:
      expectedRequests.length > 0 &&
      expectedRequests.some((expected) => matchesExpectedRequest(expected, entry))
  };
};

export const buildApiVerification = (input: {
  networkEntries: NetworkEvidenceEntry[];
  expectedRequests?: TrafficAssertion[];
  previousUrl?: string;
  currentUrl?: string;
}): ApiVerificationResult => {
  const expectedRequests = input.expectedRequests ?? [];
  const relevantEntries = input.networkEntries.filter(isRelevantEntry);
  const keyRequests = relevantEntries.map((entry) =>
    toVerificationRequest(entry, expectedRequests)
  );
  const failedRequests = keyRequests.filter(
    (entry) => entry.phase === "failed" || typeof entry.status === "number" && entry.status >= 400
  );
  const matchedRequestCount = expectedRequests.reduce((count, expected) => {
    return count + (relevantEntries.some((entry) => matchesExpectedRequest(expected, entry)) ? 1 : 0);
  }, 0);
  const tokenSignals = keyRequests.filter((entry) => entry.tokenLike).length;
  const sessionSignals = keyRequests.filter((entry) => entry.sessionLike).length;
  const previousHost = toUrl(input.previousUrl)?.host;
  const currentHost = toUrl(input.currentUrl)?.host;

  let status: ApiVerificationResult["status"];
  let note: string;

  if (expectedRequests.length > 0) {
    if (matchedRequestCount === expectedRequests.length && failedRequests.length === 0) {
      status = "passed";
      note = `Matched ${matchedRequestCount}/${expectedRequests.length} expected request assertions.`;
    } else {
      status = "failed";
      note = `Matched ${matchedRequestCount}/${expectedRequests.length} expected request assertions with ${failedRequests.length} failed request(s).`;
    }
  } else if (keyRequests.length === 0) {
    status = "neutral";
    note = "No step-linked XHR, fetch, or document traffic was captured.";
  } else if (failedRequests.length > 0) {
    status = "failed";
    note = `${failedRequests.length} request(s) failed or returned HTTP >= 400.`;
  } else {
    status = "passed";
    note = `Captured ${keyRequests.length} relevant request(s) with healthy responses.`;
  }

  return {
    status,
    requestCount: keyRequests.length,
    matchedRequestCount,
    failedRequestCount: failedRequests.length,
    expectedRequestCount: expectedRequests.length,
    tokenSignals,
    sessionSignals,
    hostTransition:
      previousHost || currentHost
        ? {
            from: previousHost,
            to: currentHost,
            changed:
              Boolean(previousHost && currentHost) && previousHost !== currentHost
          }
        : undefined,
    note,
    keyRequests: keyRequests.slice(-8)
  };
};

export const buildApiVerificationRules = (
  verification: ApiVerificationResult
): VerificationRule[] => {
  const requestRule: VerificationRule = {
    id: "api_request_capture",
    label: "API traffic",
    status:
      verification.requestCount > 0
        ? verification.failedRequestCount > 0
          ? "failed"
          : "passed"
        : "neutral",
    detail:
      verification.requestCount > 0
        ? `${verification.requestCount} relevant request(s) were linked to this step.`
        : "No relevant step-linked network request was captured."
  };

  const expectedRule: VerificationRule = {
    id: "api_expected_requests",
    label: "Expected requests",
    status:
      verification.expectedRequestCount === 0
        ? "neutral"
        : verification.matchedRequestCount === verification.expectedRequestCount
          ? "passed"
          : "failed",
    detail:
      verification.expectedRequestCount === 0
        ? "No explicit API assertions were attached to this step."
        : `${verification.matchedRequestCount}/${verification.expectedRequestCount} expected request assertion(s) matched.`
  };

  const authRule: VerificationRule = {
    id: "api_auth_signals",
    label: "Session or token signals",
    status:
      verification.tokenSignals > 0 || verification.sessionSignals > 0 ? "passed" : "neutral",
    detail:
      verification.tokenSignals > 0 || verification.sessionSignals > 0
        ? `Detected ${verification.tokenSignals} token signal(s) and ${verification.sessionSignals} session signal(s) in captured responses.`
        : "No token or session markers were detected in captured response previews."
  };

  return [requestRule, expectedRule, authRule];
};
