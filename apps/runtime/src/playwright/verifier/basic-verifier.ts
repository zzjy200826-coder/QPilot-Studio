import type {
  Action,
  ApiVerificationResult,
  InteractiveElement,
  Language,
  PageState,
  VerificationResult,
  VerificationRule
} from "@qpilot/shared";
import type { Page } from "playwright";
import { collectInteractiveElements } from "../collector/interactive-elements.js";
import { summarizePageState } from "../collector/page-state.js";

const STOPWORDS = new Set([
  "the",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "is",
  "are",
  "be",
  "page",
  "should",
  "does",
  "whether"
]);

const SEARCH_ENGINE_HOSTS = [
  "baidu.com",
  "google.com",
  "bing.com",
  "sogou.com",
  "so.com",
  "yahoo.com"
];

const ZH_LOGIN = "\u767b\u5f55";
const ZH_ACCOUNT = "\u8d26\u53f7";
const ZH_PASSWORD = "\u5bc6\u7801";
const ZH_EMAIL = "\u90ae\u7bb1";
const ZH_USERNAME = "\u7528\u6237\u540d";
const ZH_PHONE = "\u624b\u673a\u53f7";
const AUTH_ROUTE_PATTERN = /login|log in|sign in|signin|auth|oauth|authorize|passport|xlogin|captcha|challenge|verify/i;

interface VerificationContext {
  goal?: string;
  targetUrl?: string;
  currentElements?: InteractiveElement[];
  language?: Language;
  action?: Action;
}

const localize = (
  language: Language | undefined,
  english: string,
  chinese: string
): string => (language === "zh-CN" ? chinese : english);

const safeHost = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const isSearchEngineHost = (host: string | null): boolean =>
  Boolean(host && SEARCH_ENGINE_HOSTS.some((item) => host === item || host.endsWith(`.${item}`)));

const extractQuotedTokens = (value: string): string[] => {
  const matches = value.match(/["'“”‘’](.+?)["'“”‘’]/g) ?? [];
  return matches
    .map((item) => item.replace(/^["'“”‘’]|["'“”‘’]$/g, "").trim())
    .filter((item) => item.length > 0);
};

const deriveKeywords = (expected: string): string[] => {
  const quoted = extractQuotedTokens(expected);
  if (quoted.length > 0) {
    return quoted;
  }

  const tokens = expected
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !STOPWORDS.has(item));

  if (tokens.length === 0) {
    return [expected.toLowerCase().trim()];
  }

  return tokens.slice(0, 6);
};

const deriveExpectedHosts = (
  expectedChecks: string[],
  context?: VerificationContext
): string[] => {
  const hosts = new Set<string>();
  for (const value of expectedChecks) {
    const matches = value.match(/[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
    for (const match of matches) {
      hosts.add(match.toLowerCase().replace(/^www\./, ""));
    }
  }

  const targetHost = safeHost(context?.targetUrl);
  if (targetHost && !isSearchEngineHost(targetHost)) {
    hosts.add(targetHost.replace(/^www\./, ""));
  }

  return Array.from(hosts);
};

const isLoginIntent = (expectedChecks: string[], context?: VerificationContext): boolean => {
  const combined = `${context?.goal ?? ""} ${expectedChecks.join(" ")}`.toLowerCase();
  return new RegExp(
    `login|log in|sign in|signin|mail|qq|wechat|${ZH_LOGIN}|${ZH_ACCOUNT}|${ZH_PASSWORD}|${ZH_EMAIL}`,
    "i"
  ).test(combined);
};

const hasPasswordField = (elements?: InteractiveElement[]): boolean =>
  Boolean(
    elements?.some(
      (item) =>
        item.tag.toLowerCase() === "input" &&
        typeof item.type === "string" &&
        item.type.toLowerCase() === "password"
    )
  );

const hasAccountField = (elements?: InteractiveElement[]): boolean =>
  Boolean(
    elements?.some((item) => {
      if (item.tag.toLowerCase() !== "input" && item.tag.toLowerCase() !== "textarea") {
        return false;
      }

      const haystack = [
        item.id,
        item.name,
        item.placeholder,
        item.ariaLabel,
        item.selector,
        item.text,
        item.type,
        item.nearbyText
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return new RegExp(
        `user|account|email|phone|login|${ZH_ACCOUNT}|${ZH_EMAIL}|${ZH_USERNAME}|${ZH_PHONE}`,
        "i"
      ).test(haystack);
    })
  );

const looksLikeAuthRoute = (value: string): boolean => AUTH_ROUTE_PATTERN.test(value);

const hasAuthenticatedShellSignals = (pageState: PageState | undefined): boolean =>
  Boolean(
    pageState &&
      (pageState.surface === "dashboard_like" ||
        pageState.matchedSignals.includes("post-login-copy"))
  );

const isAuthenticatedLanding = (input: {
  pageState: PageState;
  currentUrl: string;
  currentHost: string | null;
  passwordDetected: boolean;
  urlChanged: boolean;
}): boolean => {
  const { pageState, currentUrl, currentHost, passwordDetected, urlChanged } = input;
  if (pageState.authErrorText || pageState.surface === "security_challenge") {
    return false;
  }
  if (isSearchEngineHost(currentHost) || pageState.hasProviderChooser || passwordDetected) {
    return false;
  }
  if (!hasAuthenticatedShellSignals(pageState)) {
    return false;
  }
  return !looksLikeAuthRoute(currentUrl) || urlChanged;
};

const canPromoteAuthenticatedLandingFromApi = (input: {
  pageState: PageState;
  apiVerification: ApiVerificationResult;
  currentUrl: string;
  currentHost: string | null;
  verification: VerificationResult;
}): boolean => {
  const { pageState, apiVerification, currentUrl, currentHost, verification } = input;
  const hasAuthSignals =
    apiVerification.sessionSignals > 0 || apiVerification.tokenSignals > 0;
  if (!hasAuthSignals || pageState.authErrorText || pageState.surface === "security_challenge") {
    return false;
  }
  if (
    isSearchEngineHost(currentHost) ||
    pageState.hasLoginForm ||
    pageState.hasProviderChooser ||
    pageState.surface === "provider_auth"
  ) {
    return false;
  }

  return (
    hasAuthenticatedShellSignals(pageState) ||
    (!looksLikeAuthRoute(currentUrl) &&
      (verification.urlChanged || Boolean(apiVerification.hostTransition?.changed)))
  );
};

const describeSurface = (surface: PageState["surface"], language?: Language): string => {
  switch (surface) {
    case "login_chooser":
      return localize(language, "login chooser", "\u767b\u5f55\u65b9\u5f0f\u9009\u62e9");
    case "login_form":
      return localize(language, "login form", "\u767b\u5f55\u8868\u5355");
    case "provider_auth":
      return localize(language, "provider authorization page", "\u7b2c\u4e09\u65b9\u6388\u6743\u9875");
    case "search_results":
      return localize(language, "search results page", "\u641c\u7d22\u7ed3\u679c\u9875");
    case "security_challenge":
      return localize(language, "security challenge page", "\u5b89\u5168\u9a8c\u8bc1\u9875");
    case "modal_dialog":
      return localize(language, "modal dialog", "\u5f39\u7a97");
    case "dashboard_like":
      return localize(language, "post-login page", "\u767b\u5f55\u540e\u9875\u9762");
    case "generic":
    default:
      return localize(language, "generic page", "\u901a\u7528\u9875\u9762");
  }
};

const buildOperationRule = (input: {
  action?: Action;
  previousUrl: string;
  currentUrl: string;
  pageState: PageState;
  language?: Language;
}): VerificationRule => {
  const { action, previousUrl, currentUrl, pageState, language } = input;
  if (!action) {
    return {
      id: "operation_effect",
      label: localize(language, "Operation effect", "\u52a8\u4f5c\u7ed3\u679c\u5224\u65ad"),
      status: "neutral",
      detail: localize(language, "No action context was provided.", "\u5f53\u524d\u6ca1\u6709\u52a8\u4f5c\u4e0a\u4e0b\u6587\u3002")
    };
  }

  const changedUrl = previousUrl !== currentUrl;
  const targetText = `${action.target ?? ""} ${action.note ?? ""}`.toLowerCase();
  let passed = false;
  let detail = localize(
    language,
    `Current page looks like ${describeSurface(pageState.surface, language)}.`,
    `\u5f53\u524d\u9875\u9762\u88ab\u5224\u65ad\u4e3a${describeSurface(pageState.surface, language)}\u3002`
  );

  if (pageState.authErrorText) {
    return {
      id: "operation_effect",
      label: localize(language, "Operation effect", "\u52a8\u4f5c\u7ed3\u679c\u5224\u65ad"),
      status: "failed",
      detail: localize(
        language,
        `The page shows a credential validation error: ${pageState.authErrorText}.`,
        `\u5f53\u524d\u9875\u9762\u51fa\u73b0\u4e86\u8d26\u53f7\u6821\u9a8c\u9519\u8bef\uff1a${pageState.authErrorText}\u3002`
      )
    };
  }

  if (action.type === "click") {
    if (new RegExp(`login|sign in|qq|wechat|weixin|${ZH_LOGIN}`, "i").test(targetText)) {
      passed =
        pageState.hasProviderChooser ||
        pageState.hasLoginForm ||
        pageState.surface === "provider_auth" ||
        pageState.surface === "dashboard_like";
      detail = passed
        ? localize(
            language,
            `The click exposed a login-related surface: ${describeSurface(pageState.surface, language)}.`,
            `\u70b9\u51fb\u540e\u8fdb\u5165\u4e86\u767b\u5f55\u76f8\u5173\u754c\u9762\uff1a${describeSurface(pageState.surface, language)}\u3002`
          )
        : localize(
            language,
            `The click finished, but the page still looks like ${describeSurface(pageState.surface, language)} instead of a login surface.`,
            `\u70b9\u51fb\u52a8\u4f5c\u6267\u884c\u4e86\uff0c\u4f46\u5f53\u524d\u4ecd\u50cf${describeSurface(pageState.surface, language)}\uff0c\u8fd8\u4e0d\u662f\u76ee\u6807\u767b\u5f55\u754c\u9762\u3002`
          );
    } else if (changedUrl) {
      passed = true;
      detail = localize(
        language,
        `The click caused navigation to ${currentUrl}.`,
        `\u70b9\u51fb\u540e\u53d1\u751f\u4e86\u8df3\u8f6c\uff1a${currentUrl}\u3002`
      );
    }
  } else if (action.type === "navigate") {
    passed = changedUrl;
    detail = passed
      ? localize(language, `Navigation reached ${currentUrl}.`, `\u5bfc\u822a\u5df2\u5230\u8fbe ${currentUrl}\u3002`)
      : localize(language, "Navigation did not change the URL yet.", "\u5bfc\u822a\u540e URL \u6682\u672a\u53d8\u5316\u3002");
  } else if (action.type === "wait") {
    passed =
      pageState.surface !== "generic" ||
      pageState.hasModal ||
      pageState.hasLoginForm ||
      pageState.hasProviderChooser;
    detail = passed
      ? localize(
          language,
          `Wait produced a meaningful page state: ${describeSurface(pageState.surface, language)}.`,
          `\u7b49\u5f85\u540e\u9875\u9762\u51fa\u73b0\u4e86\u6709\u610f\u4e49\u7684\u72b6\u6001\uff1a${describeSurface(pageState.surface, language)}\u3002`
        )
      : localize(
          language,
          "Wait completed, but no obvious state transition was detected.",
          "\u7b49\u5f85\u5b8c\u6210\u540e\uff0c\u6682\u672a\u68c0\u6d4b\u5230\u660e\u663e\u7684\u72b6\u6001\u53d8\u5316\u3002"
        );
  } else if (action.type === "input") {
    passed =
      pageState.hasLoginForm ||
      pageState.hasProviderChooser ||
      pageState.surface === "provider_auth";
    detail = localize(
      language,
      `Input executed while the page looked like ${describeSurface(pageState.surface, language)}.`,
      `\u8f93\u5165\u6267\u884c\u65f6\uff0c\u9875\u9762\u72b6\u6001\u4e3a${describeSurface(pageState.surface, language)}\u3002`
    );
  }

  return {
    id: "operation_effect",
    label: localize(language, "Operation effect", "\u52a8\u4f5c\u7ed3\u679c\u5224\u65ad"),
    status: passed ? "passed" : "failed",
    detail
  };
};

export const buildVerificationResult = (
  previousUrl: string,
  currentUrl: string,
  pageText: string,
  expectedChecks: string[],
  context?: VerificationContext
): VerificationResult => {
  const normalized = pageText.toLowerCase();
  const checks = expectedChecks.map((expected) => ({
    expected,
    found: deriveKeywords(expected).some((keyword) => normalized.includes(keyword.toLowerCase()))
  }));

  const currentPageState = summarizePageState({
    url: currentUrl,
    title: "",
    elements: context?.currentElements ?? []
  });

  const urlChanged = previousUrl !== currentUrl;
  const matchedCount = checks.filter((item) => item.found).length;
  const totalCount = checks.length;
  let passed = totalCount > 0 ? checks.every((item) => item.found) : false;
  let note: string | undefined;

  const rules: VerificationRule[] = [
    {
      id: "url_changed",
      label: localize(context?.language, "URL changed", "URL \u662f\u5426\u53d8\u5316"),
      status: urlChanged ? "passed" : "neutral",
      detail: urlChanged
        ? localize(context?.language, `Navigated to ${currentUrl}`, `\u5df2\u8df3\u8f6c\u5230 ${currentUrl}`)
        : localize(context?.language, "Still on the same URL after the action.", "\u52a8\u4f5c\u540e\u4ecd\u505c\u7559\u5728\u540c\u4e00 URL\u3002")
    },
    {
      id: "expected_checks",
      label: localize(context?.language, "Expected text checks", "\u9884\u671f\u6587\u672c\u6821\u9a8c"),
      status:
        totalCount === 0 ? "neutral" : matchedCount === totalCount ? "passed" : "failed",
      detail:
        totalCount === 0
          ? localize(context?.language, "No explicit text checks were configured.", "\u5f53\u524d\u6ca1\u6709\u914d\u7f6e\u663e\u5f0f\u6587\u672c\u6821\u9a8c\u3002")
          : localize(
              context?.language,
              `${matchedCount}/${totalCount} expected checks matched.`,
              `${matchedCount}/${totalCount} \u9879\u9884\u671f\u6821\u9a8c\u5df2\u547d\u4e2d\u3002`
            )
    },
    {
      id: "page_state",
      label: localize(context?.language, "Current page state", "\u5f53\u524d\u9875\u9762\u72b6\u6001"),
      status:
        currentPageState.surface === "security_challenge"
          ? "failed"
          : currentPageState.surface === "generic"
            ? "neutral"
            : "passed",
      detail: localize(
        context?.language,
        `Detected ${describeSurface(currentPageState.surface, context?.language)} with signals: ${currentPageState.matchedSignals.join(", ") || "none"}.`,
        `\u68c0\u6d4b\u5230${describeSurface(currentPageState.surface, context?.language)}\uff0c\u4fe1\u53f7\uff1a${currentPageState.matchedSignals.join("\u3001") || "\u65e0"}\u3002`
      )
    },
    buildOperationRule({
      action: context?.action,
      previousUrl,
      currentUrl,
      pageState: currentPageState,
      language: context?.language
    })
  ];

  if (currentPageState.authErrorText) {
    rules.push({
      id: "auth_validation",
      label: localize(context?.language, "Credential validation", "\u8d26\u53f7\u6821\u9a8c"),
      status: "failed",
      detail: localize(
        context?.language,
        `The provider rejected the submitted credentials: ${currentPageState.authErrorText}.`,
        `\u767b\u5f55\u63d0\u4f9b\u65b9\u5df2\u62d2\u7edd\u5f53\u524d\u63d0\u4ea4\u7684\u8d26\u53f7\uff1a${currentPageState.authErrorText}\u3002`
      )
    });
  }

  if (isLoginIntent(expectedChecks, context)) {
    const currentHost = safeHost(currentUrl);
    const expectedHosts = deriveExpectedHosts(expectedChecks, context);
    const hostMatched = expectedHosts.some((host) => {
      const normalizedHost = host.replace(/^www\./, "");
      return Boolean(
        currentHost &&
          (currentHost === normalizedHost ||
            currentHost.endsWith(`.${normalizedHost}`) ||
            normalizedHost.endsWith(`.${currentHost}`))
      );
    });
    const passwordDetected = hasPasswordField(context?.currentElements);
    const accountDetected = hasAccountField(context?.currentElements);
    const authenticatedLanding = isAuthenticatedLanding({
      pageState: currentPageState,
      currentUrl,
      currentHost,
      passwordDetected,
      urlChanged
    });
    const loginSurfaceReached =
      authenticatedLanding ||
      hostMatched ||
      currentPageState.hasLoginForm ||
      currentPageState.hasProviderChooser ||
      currentPageState.surface === "provider_auth" ||
      passwordDetected ||
      (accountDetected && !isSearchEngineHost(currentHost));

    rules.push(
      {
        id: "target_host",
        label: localize(context?.language, "Target host reached", "\u76ee\u6807\u57df\u540d\u547d\u4e2d"),
        status: authenticatedLanding || hostMatched ? "passed" : "failed",
        detail: authenticatedLanding
          ? localize(
              context?.language,
              `Authenticated application shell detected on ${currentHost ?? "the current host"}.`,
              `\u5df2\u5728${currentHost ?? "\u5f53\u524d\u57df\u540d"}\u68c0\u6d4b\u5230\u8ba4\u8bc1\u540e\u7684\u5e94\u7528\u754c\u9762\u3002`
            )
          : hostMatched
            ? localize(context?.language, `Current host: ${currentHost ?? "unknown"}`, `\u5f53\u524d\u57df\u540d\uff1a${currentHost ?? "\u672a\u77e5"}`)
            : localize(
                context?.language,
                `Expected one of: ${expectedHosts.join(", ") || "n/a"}`,
                `\u671f\u671b\u547d\u4e2d\u57df\u540d\uff1a${expectedHosts.join("\u3001") || "\u672a\u914d\u7f6e"}`
              )
      },
      {
        id: "authenticated_outcome",
        label: localize(
          context?.language,
          "Authenticated destination",
          "\u5df2\u8fdb\u5165\u8ba4\u8bc1\u540e\u9875\u9762"
        ),
        status: authenticatedLanding ? "passed" : "neutral",
        detail: authenticatedLanding
          ? localize(
              context?.language,
              `Detected an authenticated application shell at ${currentUrl}.`,
              `\u5df2\u5728 ${currentUrl} \u68c0\u6d4b\u5230\u8ba4\u8bc1\u540e\u7684\u5e94\u7528\u754c\u9762\u3002`
            )
          : localize(
              context?.language,
              "The current page still needs a stronger authenticated landing signal.",
              "\u5f53\u524d\u9875\u9762\u8fd8\u9700\u8981\u66f4\u660e\u786e\u7684\u767b\u5f55\u6210\u529f\u4fe1\u53f7\u3002"
            )
      },
      {
        id: "account_field",
        label: localize(context?.language, "Account field visible", "\u8d26\u53f7\u8f93\u5165\u6846\u53ef\u89c1"),
        status: authenticatedLanding ? "neutral" : accountDetected ? "passed" : "failed",
        detail: authenticatedLanding
          ? localize(
              context?.language,
              "The flow has already moved beyond account entry.",
              "\u5f53\u524d\u6d41\u7a0b\u5df2\u7ecf\u8d8a\u8fc7\u8d26\u53f7\u8f93\u5165\u9636\u6bb5\u3002"
            )
          : accountDetected
          ? localize(context?.language, "Detected a visible account or email field.", "\u5df2\u68c0\u6d4b\u5230\u53ef\u89c1\u7684\u8d26\u53f7\u6216\u90ae\u7bb1\u8f93\u5165\u6846\u3002")
          : localize(context?.language, "No visible account field detected yet.", "\u6682\u672a\u68c0\u6d4b\u5230\u53ef\u89c1\u7684\u8d26\u53f7\u8f93\u5165\u6846\u3002")
      },
      {
        id: "password_field",
        label: localize(context?.language, "Password field visible", "\u5bc6\u7801\u8f93\u5165\u6846\u53ef\u89c1"),
        status: authenticatedLanding ? "neutral" : passwordDetected ? "passed" : "failed",
        detail: authenticatedLanding
          ? localize(
              context?.language,
              "The flow has already moved beyond password entry.",
              "\u5f53\u524d\u6d41\u7a0b\u5df2\u7ecf\u8d8a\u8fc7\u5bc6\u7801\u8f93\u5165\u9636\u6bb5\u3002"
            )
          : passwordDetected
          ? localize(context?.language, "Detected a visible password field.", "\u5df2\u68c0\u6d4b\u5230\u53ef\u89c1\u7684\u5bc6\u7801\u8f93\u5165\u6846\u3002")
          : localize(context?.language, "No visible password field detected yet.", "\u6682\u672a\u68c0\u6d4b\u5230\u53ef\u89c1\u7684\u5bc6\u7801\u8f93\u5165\u6846\u3002")
      },
      {
        id: "login_surface",
        label: localize(context?.language, "Login surface reached", "\u5df2\u5230\u8fbe\u767b\u5f55\u754c\u9762"),
        status: loginSurfaceReached ? "passed" : "failed",
        detail: authenticatedLanding
          ? localize(
              context?.language,
              "The flow has progressed past the login form into an authenticated application shell.",
              "\u5f53\u524d\u6d41\u7a0b\u5df2\u7ecf\u8d8a\u8fc7\u767b\u5f55\u8868\u5355\uff0c\u8fdb\u5165\u4e86\u8ba4\u8bc1\u540e\u7684\u5e94\u7528\u754c\u9762\u3002"
            )
          : loginSurfaceReached
          ? localize(
              context?.language,
              `The current page is now a real login-related surface: ${describeSurface(currentPageState.surface, context?.language)}.`,
              `\u5f53\u524d\u5df2\u7ecf\u5230\u8fbe\u771f\u5b9e\u767b\u5f55\u76f8\u5173\u754c\u9762\uff1a${describeSurface(currentPageState.surface, context?.language)}\u3002`
            )
          : localize(
              context?.language,
              "The current page still looks like an intermediate page instead of a real login surface.",
              "\u5f53\u524d\u9875\u9762\u4ecd\u66f4\u50cf\u4e2d\u95f4\u9875\uff0c\u8fd8\u4e0d\u662f\u771f\u6b63\u7684\u767b\u5f55\u754c\u9762\u3002"
            )
      }
    );

    if (authenticatedLanding) {
      passed = true;
      note = undefined;
    } else if (passed && !loginSurfaceReached) {
      passed = false;
      note = localize(
        context?.language,
        "Potential false positive: login-related text was found, but no real login form or target host was detected.",
        "\u53ef\u80fd\u51fa\u73b0\u8bef\u5224\uff1a\u9875\u9762\u547d\u4e2d\u4e86\u767b\u5f55\u76f8\u5173\u6587\u6848\uff0c\u4f46\u8fd8\u6ca1\u6709\u68c0\u6d4b\u5230\u771f\u5b9e\u767b\u5f55\u8868\u5355\u6216\u76ee\u6807\u57df\u540d\u3002"
      );
    }
  }

  if (currentPageState.authErrorText) {
    passed = false;
    note = localize(
      context?.language,
      `Credential validation failed: ${currentPageState.authErrorText}.`,
      `\u8d26\u53f7\u6821\u9a8c\u5931\u8d25\uff1a${currentPageState.authErrorText}\u3002`
    );
  }

  if (!passed && !note && currentPageState.surface === "security_challenge") {
    note = localize(
      context?.language,
      "A security challenge is currently blocking the intended action outcome.",
      "\u5f53\u524d\u6709\u5b89\u5168\u9a8c\u8bc1\u9875\u9762\uff0c\u6b63\u5728\u963b\u65ad\u76ee\u6807\u52a8\u4f5c\u7684\u8fbe\u6210\u3002"
    );
  }

  return {
    urlChanged,
    checks,
    matchedCount,
    totalCount,
    rules,
    pageState: currentPageState,
    passed,
    note
  };
};

export const reconcileVerificationWithApiSignals = (input: {
  verification: VerificationResult;
  apiVerification?: ApiVerificationResult;
  previousUrl: string;
  currentUrl: string;
  expectedChecks: string[];
  goal?: string;
  targetUrl?: string;
  language?: Language;
  action?: Action;
}): VerificationResult => {
  const { verification, apiVerification } = input;
  if (!verification.pageState || !apiVerification) {
    return verification;
  }

  const context: VerificationContext = {
    goal: input.goal,
    targetUrl: input.targetUrl,
    language: input.language,
    action: input.action
  };
  if (!isLoginIntent(input.expectedChecks, context)) {
    return verification;
  }

  const pageState = verification.pageState;
  const currentHost = safeHost(input.currentUrl);
  const promoted = canPromoteAuthenticatedLandingFromApi({
    pageState,
    apiVerification,
    currentUrl: input.currentUrl,
    currentHost,
    verification
  });
  const hasApiAuthSignals =
    apiVerification.sessionSignals > 0 || apiVerification.tokenSignals > 0;

  const authenticatedSessionRule: VerificationRule = {
    id: "authenticated_session",
    label: localize(
      input.language,
      "Authenticated session signals",
      "\u5df2\u8bc6\u522b\u8ba4\u8bc1\u4f1a\u8bdd\u4fe1\u53f7"
    ),
    status: promoted ? "passed" : "neutral",
    detail: promoted
      ? localize(
          input.language,
          "Session or token signals confirm that the flow has reached an authenticated application state.",
          "\u63a5\u53e3\u91cc\u7684 session \u6216 token \u4fe1\u53f7\u8868\u660e\uff0c\u5f53\u524d\u6d41\u7a0b\u5df2\u8fdb\u5165\u8ba4\u8bc1\u540e\u7684\u5e94\u7528\u72b6\u6001\u3002"
        )
      : hasApiAuthSignals
        ? localize(
            input.language,
            "Session or token signals were captured, but the visible page has not yet shown a stable authenticated app shell.",
            "\u5df2\u6355\u83b7\u5230 session \u6216 token \u4fe1\u53f7\uff0c\u4f46\u53ef\u89c1\u9875\u9762\u8fd8\u6ca1\u6709\u7a33\u5b9a\u5730\u8868\u73b0\u4e3a\u767b\u5f55\u540e\u7684\u5e94\u7528\u754c\u9762\u3002"
          )
        : localize(
            input.language,
            "No session or token markers were captured for this step.",
            "\u8fd9\u4e00\u6b65\u6682\u672a\u6355\u83b7\u5230 session \u6216 token \u4fe1\u53f7\u3002"
          )
  };
  const rules: VerificationRule[] = [
    ...(verification.rules ?? []),
    authenticatedSessionRule
  ];

  if (!promoted) {
    return {
      ...verification,
      rules
    };
  }

  return {
    ...verification,
    rules,
    passed: true,
    note: undefined
  };
};

export const verifyPageOutcome = async (
  page: Page,
  previousUrl: string,
  expectedChecks: string[],
  context?: VerificationContext
): Promise<VerificationResult> => {
  const pageText = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
  const currentElements = await collectInteractiveElements(page).catch(() => undefined);

  const semanticPageText = [
    pageText,
    ...(currentElements ?? []).flatMap((element) =>
      [
        element.text,
        element.ariaLabel,
        element.placeholder,
        element.id,
        element.contextLabel,
        element.nearbyText,
        element.frameTitle
      ].filter((value): value is string => Boolean(value && value.trim()))
    )
  ].join("\n");

  return buildVerificationResult(previousUrl, page.url(), semanticPageText, expectedChecks, {
    ...context,
    currentElements
  });
};
