import type { InteractiveElement, PageState } from "@qpilot/shared";

interface PageStateInput {
  url: string;
  title: string;
  elements: InteractiveElement[];
}

const safeHost = (value: string): string | null => {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const searchHosts = ["baidu.com", "google.com", "bing.com", "sogou.com", "so.com", "yahoo.com"];

const ZH_LOGIN = "\u767b\u5f55";
const ZH_ACCOUNT = "\u8d26\u53f7";
const ZH_ACCOUNT_ALT = "\u8d26\u6237";
const ZH_EMAIL = "\u90ae\u7bb1";
const ZH_USERNAME = "\u7528\u6237\u540d";
const ZH_PASSWORD = "\u5bc6\u7801";
const ZH_SLIDER = "\u6ed1\u5757";
const ZH_WECHAT = "\u5fae\u4fe1";
const ZH_SCAN_LOGIN = "\u626b\u7801\u767b\u5f55";
const ZH_AUTH_LOGIN = "\u6388\u6743\u767b\u5f55";
const ZH_THIRD_PARTY_LOGIN = "\u7b2c\u4e09\u65b9\u767b\u5f55";
const ZH_LOGIN_PLATFORM = "\u767b\u5f55\u5e73\u53f0";
const ZH_LOGIN_METHOD = "\u767b\u5f55\u65b9\u5f0f";
const ZH_LOGIN_CHANNEL = "\u767b\u5f55\u6e20\u9053";
const ZH_PLATFORM = "\u5e73\u53f0";
const ZH_AUTH = "\u6388\u6743";
const ZH_WAY = "\u65b9\u5f0f";
const ZH_CHANNEL = "\u6e20\u9053";
const ZH_SEARCH = "\u641c\u7d22";
const ZH_BAIDU = "\u767e\u5ea6";
const ZH_RESULT = "\u7ed3\u679c";
const ZH_RELATED_SEARCH = "\u76f8\u5173\u641c\u7d22";
const ZH_OFFICIAL = "\u5b98\u65b9";
const ZH_BAIKE = "\u767e\u79d1";
const ZH_CAPTCHA = "\u9a8c\u8bc1\u7801";
const ZH_SECURITY_CHECK = "\u5b89\u5168\u6821\u9a8c";
const ZH_HUMAN_VERIFY = "\u4eba\u673a\u9a8c\u8bc1";
const ZH_COMPLETE_SECURITY_CHECK = "\u5b8c\u6210\u5b89\u5168\u9a8c\u8bc1";
const ZH_PLEASE_COMPLETE_SECURITY_CHECK = "\u8bf7\u5b8c\u6210\u5b89\u5168\u9a8c\u8bc1";
const ZH_SLIDER_VERIFY = "\u62d6\u52a8\u6ed1\u5757";
const ZH_PUZZLE = "\u62fc\u56fe";
const ZH_PROFILE = "\u4e2a\u4eba\u4e2d\u5fc3";
const ZH_ACCOUNT_CENTER = "\u8d26\u53f7\u4e2d\u5fc3";
const ZH_USER_CENTER = "\u7528\u6237\u4e2d\u5fc3";
const ZH_MEMBER_CENTER = "\u4f1a\u5458\u4e2d\u5fc3";
const ZH_CONSOLE = "\u63a7\u5236\u53f0";
const ZH_WORKBENCH = "\u5de5\u4f5c\u53f0";
const ZH_LOGOUT = "\u9000\u51fa";
const ZH_LOGGED_IN = "\u5df2\u767b\u5f55";
const ZH_INBOX = "\u6536\u4ef6\u7bb1";
const ZH_COMPOSE = "\u5199\u4fe1";

const PROVIDER_CHOOSER_PATTERN = new RegExp(
  [
    "qq\\s*login",
    "wechat\\s*login",
    "weixin\\s*login",
    `qq${ZH_LOGIN}`,
    `${ZH_WECHAT}${ZH_LOGIN}`,
    ZH_SCAN_LOGIN,
    ZH_AUTH_LOGIN,
    ZH_THIRD_PARTY_LOGIN,
    "provider",
    "social login",
    "modaliconqq",
    "modaliconwechat",
    "modal-icon-qq",
    "modal-icon-wechat",
    "login platform"
  ].join("|"),
  "i"
);

const PROVIDER_BRAND_PATTERN = /(^|[\s#._-])(qq|wechat|weixin)([\s#._-]|$)/i;

const PROVIDER_CONTEXT_PATTERN = new RegExp(
  [
    "auth",
    "authorize",
    "platform",
    "chooser",
    "provider",
    "social login",
    "scan",
    "qr",
    ZH_PLATFORM,
    ZH_AUTH,
    ZH_SCAN_LOGIN,
    ZH_WAY,
    ZH_CHANNEL
  ].join("|"),
  "i"
);

const PROVIDER_AUTH_PATTERN = new RegExp(
  [
    "graph\\.qq\\.com",
    "ptlogin2\\.qq\\.com",
    "login\\.qq\\.com",
    "oauth2\\.0",
    "authorize",
    "passport",
    "loginframe",
    "qc_login",
    "xlogin",
    ZH_AUTH_LOGIN
  ].join("|"),
  "i"
);

const SECURITY_CHALLENGE_PATTERN = new RegExp(
  [
    "captcha",
    "security check",
    "human verification",
    "verify you are human",
    "are you human",
    "robot",
    "cloudflare",
    "recaptcha",
    "hcaptcha",
    "geetest",
    ZH_CAPTCHA,
    ZH_SLIDER,
    ZH_SECURITY_CHECK,
    ZH_HUMAN_VERIFY,
    ZH_COMPLETE_SECURITY_CHECK,
    ZH_PLEASE_COMPLETE_SECURITY_CHECK,
    ZH_SLIDER_VERIFY,
    ZH_PUZZLE
  ].join("|"),
  "i"
);

const AUTH_VALIDATION_ERROR_PATTERN = new RegExp(
  [
    "\u8bf7\u8f93\u5165\u6b63\u786e\u7684\u8d26\u53f7",
    "\u8bf7\u8f93\u5165\u6b63\u786e\u7684\u7528\u6237\u540d",
    "\u8d26\u53f7(?:\u6216|/)?\u5bc6\u7801\u9519\u8bef",
    "\u7528\u6237\u540d(?:\u6216|/)?\u5bc6\u7801\u9519\u8bef",
    "\u8d26\u53f7\u9519\u8bef",
    "\u8d26\u53f7\u4e0d\u5b58\u5728",
    "\u8d26\u53f7\u683c\u5f0f\u4e0d\u6b63\u786e",
    "\u5bc6\u7801\u9519\u8bef",
    "\u767b\u5f55\u5931\u8d25",
    "invalid account",
    "invalid username",
    "invalid password",
    "wrong password",
    "incorrect account",
    "incorrect password",
    "account or password"
  ].join("|"),
  "i"
);

const POST_LOGIN_PATTERN = new RegExp(
  [
    "logout",
    "sign out",
    "profile",
    "account center",
    "user center",
    "member center",
    "dashboard",
    "workspace",
    "workbench",
    "console",
    "avatar",
    "inbox",
    "compose",
    "mail list",
    ZH_LOGOUT,
    ZH_PROFILE,
    ZH_ACCOUNT_CENTER,
    ZH_USER_CENTER,
    ZH_MEMBER_CENTER,
    ZH_CONSOLE,
    ZH_WORKBENCH,
    ZH_LOGGED_IN,
    ZH_INBOX,
    ZH_COMPOSE
  ].join("|"),
  "i"
);

const textOf = (element: InteractiveElement): string =>
  [
    element.text,
    element.ariaLabel,
    element.placeholder,
    element.contextLabel,
    element.nearbyText,
    element.className,
    element.id,
    element.name,
    element.selector,
    element.title,
    element.frameUrl,
    element.frameTitle
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const challengeTextOf = (element: InteractiveElement): string =>
  [
    element.text,
    element.ariaLabel,
    element.placeholder,
    element.contextLabel,
    element.className,
    element.id,
    element.name,
    element.selector,
    element.title,
    element.frameUrl,
    element.frameTitle
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const hasPattern = (
  elements: InteractiveElement[],
  pattern: RegExp,
  projector: (element: InteractiveElement) => string = textOf
): boolean => elements.some((element) => pattern.test(projector(element)));

const findFirstMatchingField = (
  elements: InteractiveElement[],
  pattern: RegExp
): string | undefined => {
  for (const element of elements) {
    const fields = [
      element.text,
      element.nearbyText,
      element.contextLabel,
      element.ariaLabel,
      element.title,
      element.placeholder
    ];

    for (const field of fields) {
      const normalized = field?.replace(/\s+/g, " ").trim();
      if (normalized && pattern.test(normalized)) {
        return normalized.slice(0, 160);
      }
    }
  }

  return undefined;
};

const detectAuthValidationError = (elements: InteractiveElement[]): string | undefined =>
  findFirstMatchingField(elements, AUTH_VALIDATION_ERROR_PATTERN);

const hasProviderChooserSignals = (elements: InteractiveElement[]): boolean =>
  hasPattern(elements, PROVIDER_CHOOSER_PATTERN) ||
  (hasPattern(elements, PROVIDER_BRAND_PATTERN) &&
    (hasPattern(elements, PROVIDER_CONTEXT_PATTERN) ||
      elements.some((element) => {
        if (
          element.contextType !== "modal" &&
          element.contextType !== "dialog" &&
          element.contextType !== "iframe-modal"
        ) {
          return false;
        }
        return PROVIDER_BRAND_PATTERN.test(textOf(element));
      })));

const hasProviderAuthSignals = (elements: InteractiveElement[]): boolean =>
  hasPattern(elements, PROVIDER_AUTH_PATTERN);

const collectSignals = (input: PageStateInput): string[] => {
  const signals = new Set<string>();
  const host = safeHost(input.url);

  if (host && searchHosts.some((item) => host === item || host.endsWith(`.${item}`))) {
    signals.add("search-host");
  }
  if (/\/s\b|\bwd=|\bq=|\bquery=/.test(input.url)) {
    signals.add("search-query");
  }
  if (hasPattern(input.elements, new RegExp(`search|${ZH_SEARCH}|${ZH_BAIDU}|google|bing`, "i"))) {
    signals.add("search-ui");
  }
  if (hasProviderChooserSignals(input.elements)) {
    signals.add("provider-entry");
  }
  if (hasProviderAuthSignals(input.elements)) {
    signals.add("provider-auth-frame");
  }
  if (
    hasPattern(
      input.elements,
      new RegExp(`login|sign in|${ZH_LOGIN}|${ZH_ACCOUNT}|${ZH_ACCOUNT_ALT}|${ZH_EMAIL}|password|${ZH_PASSWORD}`, "i")
    )
  ) {
    signals.add("login-copy");
  }
  if (hasPattern(input.elements, SECURITY_CHALLENGE_PATTERN, challengeTextOf)) {
    signals.add("security-copy");
  }
  if (detectAuthValidationError(input.elements)) {
    signals.add("auth-validation-error");
  }
  if (
    input.elements.some(
      (element) =>
        element.contextType === "modal" ||
        element.contextType === "dialog" ||
        element.contextType === "iframe-modal"
    )
  ) {
    signals.add("modal-visible");
  }
  if (
    input.elements.some(
      (element) =>
        Boolean(element.framePath && element.framePath !== "main") ||
        element.contextType === "iframe" ||
        element.contextType === "iframe-modal" ||
        element.tag === "iframe"
    )
  ) {
    signals.add("iframe-elements");
  }
  if (input.elements.some((element) => element.type?.toLowerCase() === "password")) {
    signals.add("password-field");
  }
  if (
    input.elements.some((element) => {
      const haystack = textOf(element);
      return element.tag === "input" && new RegExp(`account|user|email|phone|${ZH_ACCOUNT}|${ZH_EMAIL}|${ZH_USERNAME}`, "i").test(haystack);
    })
  ) {
    signals.add("account-field");
  }
  if (hasPattern(input.elements, POST_LOGIN_PATTERN)) {
    signals.add("post-login-copy");
  }

  return Array.from(signals);
};

const inferPrimaryContext = (elements: InteractiveElement[]): string | undefined => {
  const context = elements.find((element) => element.contextLabel)?.contextLabel;
  return context?.trim() ? context.trim() : undefined;
};

export const summarizePageState = (input: PageStateInput): PageState => {
  const host = safeHost(input.url);
  const hasModal = input.elements.some(
    (element) =>
      element.contextType === "modal" ||
      element.contextType === "dialog" ||
      element.contextType === "iframe-modal"
  );
  const frameCount = new Set(
    input.elements
      .map((element) => element.framePath)
      .filter((value): value is string => Boolean(value && value !== "main"))
  ).size;
  const hasIframe =
    frameCount > 0 ||
    input.elements.some(
      (element) =>
        element.tag === "iframe" ||
        element.contextType === "iframe" ||
        element.contextType === "iframe-modal"
    );
  const hasPasswordField = input.elements.some(
    (element) => element.tag === "input" && element.type?.toLowerCase() === "password"
  );
  const hasAccountField = input.elements.some((element) => {
    if (element.tag !== "input" && element.tag !== "textarea") {
      return false;
    }
    return new RegExp(`account|user|email|phone|${ZH_ACCOUNT}|${ZH_EMAIL}|${ZH_USERNAME}`, "i").test(
      textOf(element)
    );
  });
  const hasProviderChooser = hasProviderChooserSignals(input.elements);
  const hasProviderAuth =
    hasProviderAuthSignals(input.elements) ||
    /auth|oauth|authorize|passport|login\.qq\.com|(?:x?ui\.)?ptlogin2\.qq\.com/i.test(input.url);
  const authErrorText = detectAuthValidationError(input.elements);
  const hasSearchResults =
    Boolean(host && searchHosts.some((item) => host === item || host.endsWith(`.${item}`))) &&
    (/\/s\b|\bwd=|\bq=|\bquery=/.test(input.url) ||
      hasPattern(
        input.elements,
        new RegExp(`result|${ZH_RESULT}|${ZH_RELATED_SEARCH}|${ZH_OFFICIAL}|${ZH_BAIKE}|${ZH_BAIDU}|google search`, "i")
      ));
  const signals = collectSignals(input);
  const looksAuthenticatedShell =
    signals.includes("post-login-copy") && !hasPasswordField && !hasProviderChooser;
  const challengeFromUrlOrTitle = SECURITY_CHALLENGE_PATTERN.test(`${input.title} ${input.url}`);
  const challengeFromElements = hasPattern(input.elements, SECURITY_CHALLENGE_PATTERN, challengeTextOf);
  const securityChallenge =
    !authErrorText &&
    (challengeFromUrlOrTitle || (challengeFromElements && !looksAuthenticatedShell));

  let surface: PageState["surface"] = "generic";
  if (securityChallenge) {
    surface = "security_challenge";
  } else if (hasSearchResults) {
    surface = "search_results";
  } else if (
    hasProviderAuth &&
    (hasIframe || hasPasswordField || hasAccountField || hasProviderChooser || hasModal)
  ) {
    surface = "provider_auth";
  } else if (
    hasPasswordField ||
    (hasAccountField && /login|mail|qq\.com|auth|signin/i.test(`${input.title} ${host ?? ""}`))
  ) {
    surface = hasProviderChooser && !hasPasswordField ? "login_chooser" : "login_form";
  } else if (
    hasProviderChooser &&
    (hasModal ||
      hasPattern(
        input.elements,
        new RegExp(`login platform|social login|${ZH_LOGIN_PLATFORM}|${ZH_LOGIN_METHOD}|${ZH_LOGIN_CHANNEL}|choose your login`, "i")
      ))
  ) {
    surface = "login_chooser";
  } else if (hasProviderAuth) {
    surface = "provider_auth";
  } else if (hasModal) {
    surface = "modal_dialog";
  } else if (signals.includes("post-login-copy")) {
    surface = "dashboard_like";
  }

  return {
    surface,
    hasModal,
    hasIframe,
    frameCount,
    hasLoginForm:
      hasPasswordField ||
      (hasAccountField &&
        new RegExp(`login|sign in|${ZH_LOGIN}|auth`, "i").test(`${input.title} ${input.url}`.toLowerCase())),
    hasProviderChooser,
    hasSearchResults,
    matchedSignals: signals,
    primaryContext: inferPrimaryContext(input.elements),
    ...(authErrorText ? { authErrorText } : {})
  };
};
