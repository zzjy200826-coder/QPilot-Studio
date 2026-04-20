import type {
  Action,
  InteractiveElement,
  LLMDecision,
  PageSnapshot,
  RunConfig,
  RunWorkingMemory
} from "@qpilot/shared";
import {
  assessTextAgainstGoal,
  deriveGoalAnchorProfile,
  goalRequiresActionableDestination,
  isGoalIntermediaryAuthSurface,
  parseGoalGuardMemory,
  snapshotLooksLikeContentPage,
  type GoalAnchorProfile
} from "./goal-alignment.js";

type LoginProvider = "qq" | "wechat";
type SearchNavigationIntent = {
  query: string;
  terms: string[];
  resultTerms: string[];
  goalProfile: GoalAnchorProfile | null;
  requiresActionableDestination: boolean;
};

const SEARCH_HOSTS = ["baidu.com", "google.com", "bing.com", "sogou.com", "so.com", "yahoo.com"];
const SEARCH_CONTENT_SUBDOMAIN_PATTERN =
  /^(?:wenwen|zhidao|baike|wiki|answers?)\./i;
const SEARCH_QUERY_PARAM_KEYS = ["wd", "word", "q", "query", "keyword", "search", "p"] as const;

const PROVIDER_LABELS: Record<LoginProvider, string> = {
  qq: "\u0051\u0051\u767b\u5f55",
  wechat: "\u5fae\u4fe1\u767b\u5f55"
};

const PROVIDER_SELECTORS: Record<LoginProvider, string[]> = {
  qq: [
    "#modalIconqq",
    "a:has-text('QQ\\u8d26\\u53f7')",
    "a:has-text('QQ\\u767b\\u5f55')",
    "li:has-text('QQ\\u8d26\\u53f7')",
    "[title='QQ\\u8d26\\u53f7']",
    "[aria-label*='QQ']",
    "[id*='qqlogin']",
    "[class*='qq-login']",
    "[class*='qzone']"
  ],
  wechat: [
    "#modalIconWechat",
    "a:has-text('\\u5fae\\u4fe1')",
    "a:has-text('\\u5fae\\u4fe1\\u767b\\u5f55')",
    "li:has-text('\\u5fae\\u4fe1')",
    "[title='\\u5fae\\u4fe1']",
    "[aria-label*='\\u5fae\\u4fe1']",
    "[id*='wechat']",
    "[class*='wechat-login']"
  ]
};

const defaultProviderSelector = (provider: LoginProvider): string =>
  PROVIDER_SELECTORS[provider][0] ??
  (provider === "qq" ? "#modalIconqq" : "#modalIconWechat");

const QUOTED_SEGMENT_PATTERN =
  /["'\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f\u300a\u300b](.+?)["'\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f\u300a\u300b]/g;
const SEARCH_INTENT_PATTERN =
  /\b(?:search|find|look\s+up)\b|\u641c\u7d22|\u67e5\u627e|\u641c\u4e00\u4e0b|\u767e\u5ea6\u4e00\u4e0b/i;
const SEARCH_QUERY_PATTERN =
  /(?:search|find|look\s+up|\u641c\u7d22|\u67e5\u627e|\u641c\u4e00\u4e0b|\u767e\u5ea6\u4e00\u4e0b)\s*[:\uff1a]?\s*(.+?)(?=(?:,|\uff0c|\.|\u3002|;|\uff1b|\bthen\b|\u7136\u540e|\u518d|\u5e76|\u5e76\u4e14|click|open|enter|go\s+to|login|sign\s*in|\u70b9\u51fb|\u6253\u5f00|\u8fdb\u5165|\u627e\u5230|\u767b\u5f55|$))/i;
const GOAL_NOISE_PATTERN =
  /(?:official\s+site|official|website|\u5b98\u7f51\u5165\u53e3|\u5b98\u65b9\u7f51\u7ad9|\u5b98\u7f51|\u5b98\u65b9|login|sign\s*in|\u767b\u5f55|\u0051\u0051\u767b\u5f55|\u5fae\u4fe1\u767b\u5f55|\u8d26\u53f7|\u5bc6\u7801|\u70b9\u51fb|\u6253\u5f00|\u8fdb\u5165|\u627e\u5230|\u4f7f\u7528|\u7136\u540e|\u5e76|\u5e76\u4e14|\u6d41\u7a0b|\u8fdb\u53bb)/gi;
const OFFICIAL_RESULT_PATTERN = /official|\u5b98\u7f51|\u5b98\u65b9/i;
const RESULT_NOISE_PATTERN =
  /\u5e7f\u544a|wiki|\u767e\u79d1|pan\.baidu\.com|\u667a\u80fd\u4e3a\u60a8\u5b9e\u65f6\u56de\u7b54|realtime/i;
const SEARCH_REFINEMENT_SELECTOR_PATTERN =
  /c-invoke-class|cos-no-underline|result-item_|recommend|bdsug|s-tab-item|toplist|ec-description-link|ec-footer|game-link|game-ad-link/i;
const SEARCH_RESULT_QUERY_NOISE_PATTERN =
  /\u5165\u53e3\u7f51\u5740|\u5165\u53e3|wiki|\u767e\u79d1|4399|\u56fe\u9274|\u89d2\u8272|\u5ba0\u7269|\u9886\u53d6|\u5927\u5168|\u597d\u73a9\u5417|\u54ea\u4e00\u5e74|\u4e0b\u8f7d|\u653b\u7565|\u793c\u5305|t0|\u4e0a\u5cb8\u86d9/i;
const SEARCH_RESULT_PUBLISHER_PATTERN =
  /\u817e\u8baf|tencent|\u9b54\u65b9|\u5de5\u4f5c\u5ba4|\u81ea\u7814/i;
const SEARCH_RESULT_DIRECT_SITE_PATTERN =
  /\u73b0\u5df2\u4e0a\u7ebf|\u5168\u5e73\u53f0|\u7acb\u5373\u4e0b\u8f7d|\u591a\u7aef\u4e92\u901a|\u5f00\u653e\u4e16\u754c|\u7eed\u4f5c/i;
const SEARCH_RESULT_PRIMARY_TITLE_SELECTOR_PATTERN =
  /tenon_pc_comp_tlink|sc-link|title-link|result-title|result-main|c-title/i;
const SEARCH_RESULT_OFFICIAL_REFINEMENT_TEXT_PATTERN =
  /(?:\u5b98\u7f51|\u5b98\u65b9\u7f51\u7ad9|\u5b98\u65b9\u5165\u53e3|\u5b98\u7f51\u5165\u53e3)$/i;
const SEARCH_RESULT_ACTIONABLE_ENTRY_PATTERN =
  /(?:login|sign\s*in|log\s*in|open|enter|official|website|mail\.[a-z0-9.-]+|\u767b\u5f55|\u5b98\u7f51|\u5b98\u65b9|\u7f51\u9875\u7248|\u5165\u53e3)/i;
const SEARCH_RESULT_CONTENT_PATTERN =
  /(?:wiki|baike|wenwen|zhidao|faq|guide|tutorial|article|blog|realtime|\u5b9e\u65f6\u667a\u80fd\u56de\u590d|\u95ee\u7b54|\u767e\u79d1|\u77e5\u9053|\u6559\u7a0b|\u653b\u7565|\u683c\u5f0f|\u5199\u6cd5|\u662f\u4ec0\u4e48|\u600e\u4e48|\u5982\u4f55|\u65b9\u5f0f|\u53f7\u7801\u52a0\u4ec0\u4e48)/i;
const SEARCH_RESULT_SOURCE_LINK_SELECTOR_PATTERN =
  /cosc-source|source-link|source-a|pc-app-name|brand|app-name/i;
const LOW_SIGNAL_RESULT_TEXT_PATTERN = /^(?:link|\u94fe\u63a5|\u5b98\u65b9|\u5b98\u7f51|\u4e0b\u8f7d|\u767b\u5f55)$/i;
const GENERIC_LINK_LABEL_PATTERN = /^(?:link|\u94fe\u63a5)$/i;
const ACCOUNT_FIELD_PATTERN =
  /account|user(?:name)?|email|phone|mobile|qq\s*(?:account|\u53f7)|\u8d26\u53f7|\u8d26\u6237|\u90ae\u7bb1|\u7528\u6237\u540d|\u624b\u673a/i;
const PASSWORD_FIELD_PATTERN = /password|pwd|\u5bc6\u7801/i;
const LOGIN_SUBMIT_PATTERN =
  /login_button|sign.?in|log.?in|submit|authorize|continue|\u767b\u5f55|\u6388\u6743\u767b\u5f55|\u7ee7\u7eed/i;
const QQ_AUTH_CONTEXT_PATTERN =
  /graph\.qq\.com|ptlogin2\.qq\.com|login\.qq\.com|xui\.ptlogin2\.qq\.com|ptlogin_iframe|switcher_plogin|login_button/i;

const hasKeyword = (value: string | undefined, pattern: RegExp): boolean =>
  Boolean(value && pattern.test(value));

const safeHost = (value: string): string | null => {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const normalizeText = (value: string | undefined): string =>
  (value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");

const stripWrapperQuotes = (value: string): string =>
  value.replace(
    /^["'\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f\u300a\u300b]+|["'\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f\u300a\u300b]+$/gu,
    ""
  );

const escapeForHasText = (value: string): string => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

const isSearchHost = (url: string): boolean => {
  const host = safeHost(url);
  if (!host || SEARCH_CONTENT_SUBDOMAIN_PATTERN.test(host)) {
    return false;
  }
  return SEARCH_HOSTS.some((item) => host === item || host.endsWith(`.${item}`));
};

const hasCommittedSearchUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    if (SEARCH_QUERY_PARAM_KEYS.some((key) => parsed.searchParams.has(key))) {
      return true;
    }

    const pathname = parsed.pathname.trim();
    return pathname.length > 1 && pathname !== "/";
  } catch {
    return false;
  }
};

const extractQuotedSegments = (value?: string): string[] =>
  Array.from((value ?? "").matchAll(QUOTED_SEGMENT_PATTERN))
    .map((match) => stripWrapperQuotes(match[1] ?? "").trim())
    .filter((item) => item.length >= 2);

const sanitizeSearchQuery = (value: string): string =>
  stripWrapperQuotes(value)
    .replace(GOAL_NOISE_PATTERN, " ")
    .replace(/\s+/g, " ")
    .replace(/^[,.;:\uff0c\uff1b\uff1a]+|[,.;:\uff0c\uff1b\uff1a]+$/g, "")
    .trim();

const buildSearchTerms = (query: string): string[] => {
  const values = new Set<string>();
  const normalized = sanitizeSearchQuery(query);
  if (normalized.length >= 2) {
    values.add(normalized);
  }

  const withoutOfficial = normalized
    .replace(/official|website|\u5b98\u7f51|\u5b98\u65b9/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (withoutOfficial.length >= 2) {
    values.add(withoutOfficial);
  }

  return Array.from(values);
};

const buildSearchResultTerms = (
  query: string,
  goalProfile: GoalAnchorProfile | null
): string[] => {
  const values = new Set<string>(buildSearchTerms(query));
  for (const item of goalProfile?.anchorPhrases ?? []) {
    const normalized = stripWrapperQuotes(item).trim();
    if (normalized.length >= 2) {
      values.add(normalized);
    }
  }
  for (const item of goalProfile?.entityTokens ?? []) {
    const normalized = stripWrapperQuotes(item).trim();
    if (normalized.length >= 2) {
      values.add(normalized);
    }
  }
  return Array.from(values);
};

const matchesSearchIntentQuery = (
  candidate: string | undefined,
  intent: SearchNavigationIntent
): boolean => {
  const normalizedCandidate = normalizeText(sanitizeSearchQuery(candidate ?? ""));
  if (!normalizedCandidate) {
    return false;
  }

  return intent.terms
    .map((term) => normalizeText(term))
    .some(
      (term) =>
        term.length >= 2 &&
        normalizedCandidate.includes(term)
    );
};

const deriveSearchNavigationIntent = (goal: string): SearchNavigationIntent | null => {
  if (!SEARCH_INTENT_PATTERN.test(goal)) {
    return null;
  }

  const candidates = [
    ...extractQuotedSegments(goal),
    SEARCH_QUERY_PATTERN.exec(goal)?.[1] ?? ""
  ]
    .map((item) => sanitizeSearchQuery(item))
    .filter((item) => item.length >= 2);

  const query = candidates[0];
  if (!query) {
    return null;
  }

  const goalProfile = deriveGoalAnchorProfile(query) ?? deriveGoalAnchorProfile(goal);

  return {
    query,
    terms: buildSearchTerms(query),
    resultTerms: buildSearchResultTerms(query, goalProfile),
    goalProfile,
    requiresActionableDestination: goalRequiresActionableDestination(goal)
  };
};

const extractSearchQueryFromUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    for (const key of SEARCH_QUERY_PARAM_KEYS) {
      const value = sanitizeSearchQuery(parsed.searchParams.get(key) ?? "");
      if (value.length >= 2) {
        return value;
      }
    }
  } catch {
    return null;
  }

  return null;
};

const isSearchInputElement = (element: InteractiveElement): boolean =>
  element.isVisible !== false &&
  element.isEnabled !== false &&
  (element.tag === "input" || element.tag === "textarea") &&
  /search|\u641c\u7d22|wd|kw|query|keyword|\u5173\u952e\u8bcd|\u767e\u5ea6\u4e00\u4e0b|chat-textarea|text\s*area/.test(
    `${element.id ?? ""} ${element.name ?? ""} ${element.placeholder ?? ""} ${element.selector ?? ""} ${
      element.ariaLabel ?? ""
    }`.toLowerCase()
  );

const extractSearchQueryFromElements = (snapshot: PageSnapshot): string | null => {
  for (const element of snapshot.elements) {
    if (!isSearchInputElement(element)) {
      continue;
    }

    const value = sanitizeSearchQuery(element.value ?? element.text ?? "");
    if (value.length >= 2) {
      return value;
    }
  }

  return null;
};

const extractCurrentSearchQuery = (snapshot: PageSnapshot): string | null =>
  extractSearchQueryFromElements(snapshot) ?? extractSearchQueryFromUrl(snapshot.url);

const inferPreferredProvider = (goal: string): LoginProvider | null => {
  const normalized = goal.toLowerCase();
  if (/qq|qzone|qq\u767b\u5f55/.test(normalized)) {
    return "qq";
  }
  if (/wechat|weixin|\u5fae\u4fe1\u767b\u5f55/.test(normalized)) {
    return "wechat";
  }
  return null;
};

const isGenericLoginTrigger = (action: Action): boolean => {
  const haystack = `${action.target ?? ""} ${action.note ?? ""}`.toLowerCase();
  return /login|sign.?in|unlogin|\u767b\u5f55/.test(haystack);
};

const isQqEcosystemHost = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "qq.com" ||
      host.endsWith(".qq.com") ||
      host === "tencent.com" ||
      host.endsWith(".tencent.com")
    );
  } catch {
    return false;
  }
};

const collectElementText = (element: InteractiveElement): string =>
  [
    element.id,
    element.name,
    element.selector,
    element.text,
    element.title,
    element.placeholder,
    element.ariaLabel,
    element.nearbyText,
    element.contextLabel,
    element.className,
    element.frameUrl,
    element.frameTitle
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const isVisibleEnabled = (element: InteractiveElement): boolean =>
  element.isVisible !== false && element.isEnabled !== false;

const isPlainSelector = (selector: string | undefined): boolean =>
  !selector || /^(?:a|button|li|div|span|input|textarea|select)$/i.test(selector.trim());

const buildElementSelector = (
  element: InteractiveElement,
  fallback: string
): string => {
  if (element.id) {
    return `#${element.id}`;
  }
  if (element.name && element.tag) {
    return `${element.tag}[name='${element.name}']`;
  }
  if (element.text?.trim() && element.tag && /^(?:a|button|li)$/i.test(element.tag)) {
    return `${element.tag}:has-text('${escapeForHasText(element.text.trim())}')`;
  }
  if (element.selector && !isPlainSelector(element.selector)) {
    return element.selector;
  }
  return fallback;
};

const matchesProviderElement = (
  element: InteractiveElement,
  provider: LoginProvider
): boolean => {
  const haystack = [
    element.id,
    element.className,
    element.selector,
    element.text,
    element.ariaLabel,
    element.name,
    element.title
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (provider === "qq") {
    return /qq/.test(haystack);
  }
  return /wechat|weixin|\u5fae\u4fe1/.test(haystack);
};

const findVisibleProviderElement = (
  elements: InteractiveElement[],
  provider: LoginProvider
): InteractiveElement | undefined =>
  elements.find(
    (element) =>
      element.isVisible !== false &&
      element.isEnabled !== false &&
      matchesProviderElement(element, provider)
  );

const isQqAccountField = (element: InteractiveElement): boolean => {
  if (!isVisibleEnabled(element) || (element.tag !== "input" && element.tag !== "textarea")) {
    return false;
  }

  const haystack = collectElementText(element);
  if (
    element.type?.toLowerCase() === "password" ||
    PASSWORD_FIELD_PATTERN.test(haystack) ||
    element.id === "p" ||
    element.name === "p" ||
    (element.selector?.includes("#p") ?? false)
  ) {
    return false;
  }

  return (
    ACCOUNT_FIELD_PATTERN.test(haystack) ||
    element.id === "u" ||
    element.name === "u" ||
    (element.selector?.includes("#u") ?? false)
  );
};

const isQqPasswordField = (element: InteractiveElement): boolean => {
  if (!isVisibleEnabled(element) || element.tag !== "input") {
    return false;
  }

  const haystack = collectElementText(element);
  return (
    element.type?.toLowerCase() === "password" ||
    PASSWORD_FIELD_PATTERN.test(haystack) ||
    element.id === "p" ||
    element.name === "p" ||
    (element.selector?.includes("#p") ?? false)
  );
};

const isLoginSubmitElement = (element: InteractiveElement): boolean => {
  if (!isVisibleEnabled(element)) {
    return false;
  }

  const haystack = collectElementText(element);
  const inputType = element.type?.toLowerCase();
  const isInteractive =
    element.tag === "button" ||
    element.tag === "a" ||
    (element.tag === "input" && (inputType === "submit" || inputType === "button"));
  if (!isInteractive) {
    return false;
  }

  if (
    /switcher|password\s*login|\u5bc6\u7801\u767b\u5f55/.test(haystack) &&
    !/login_button/.test(haystack)
  ) {
    return false;
  }

  return (
    LOGIN_SUBMIT_PATTERN.test(haystack) ||
    element.id === "login_button" ||
    element.name === "login_button" ||
    (element.selector?.includes("#login_button") ?? false)
  );
};

const snapshotShowsQqCredentialForm = (snapshot: PageSnapshot): boolean => {
  const surface = snapshot.pageState?.surface;
  if (surface !== "provider_auth" && surface !== "login_form") {
    return false;
  }

  const qqAuthContext =
    snapshot.pageState?.matchedSignals.includes("provider-auth-frame") ||
    isQqEcosystemHost(snapshot.url) ||
    snapshot.elements.some((element) => QQ_AUTH_CONTEXT_PATTERN.test(collectElementText(element)));

  if (!qqAuthContext) {
    return false;
  }

  return (
    snapshot.elements.some(isQqAccountField) &&
    snapshot.elements.some(isQqPasswordField)
  );
};

const sharesFrameContext = (
  element: InteractiveElement,
  reference: InteractiveElement
): boolean => {
  if (reference.framePath && element.framePath && reference.framePath === element.framePath) {
    return true;
  }
  if (reference.frameUrl && element.frameUrl && reference.frameUrl === element.frameUrl) {
    return true;
  }
  return false;
};

const buildDirectCredentialActions = (input: {
  snapshot: PageSnapshot;
  runConfig: RunConfig;
  language: RunConfig["language"];
}): Action[] | null => {
  if (!input.runConfig.username || !input.runConfig.password) {
    return null;
  }

  const accountField = input.snapshot.elements.find(isQqAccountField);
  const passwordField = input.snapshot.elements.find(isQqPasswordField);
  if (!accountField || !passwordField) {
    return null;
  }

  const submitElement =
    input.snapshot.elements.find(
      (element) =>
        sharesFrameContext(element, accountField) &&
        sharesFrameContext(element, passwordField) &&
        isLoginSubmitElement(element)
    ) ??
    input.snapshot.elements.find(
      (element) =>
        (sharesFrameContext(element, accountField) ||
          sharesFrameContext(element, passwordField)) &&
        isLoginSubmitElement(element)
    );
  const accountSelector = buildElementSelector(accountField, "#u");
  const passwordSelector = buildElementSelector(passwordField, "#p");
  const submitSelector = submitElement
    ? buildElementSelector(submitElement, "#login_button")
    : "#login_button";

  return [
    {
      type: "input",
      target: accountSelector,
      value: input.runConfig.username,
      note:
        input.language === "zh-CN"
          ? "\u5728QQ\u5bc6\u7801\u767b\u5f55\u8868\u5355\u76f4\u63a5\u8f93\u5165\u8d26\u53f7"
          : "Fill the QQ account field directly on the password login form"
    },
    {
      type: "input",
      target: passwordSelector,
      value: input.runConfig.password,
      note:
        input.language === "zh-CN"
          ? "\u5728QQ\u5bc6\u7801\u767b\u5f55\u8868\u5355\u76f4\u63a5\u8f93\u5165\u5bc6\u7801"
          : "Fill the QQ password field directly on the password login form"
    },
    {
      type: "click",
      target: submitSelector,
      note:
        input.language === "zh-CN"
          ? "\u63d0\u4ea4QQ\u5bc6\u7801\u767b\u5f55"
          : "Submit the QQ password login form"
    },
    {
      type: "wait",
      ms: 1200,
      note:
        input.language === "zh-CN"
          ? "\u7b49\u5f85QQ\u767b\u5f55\u7ed3\u679c\u6216\u6821\u9a8c\u63d0\u793a"
          : "Wait for the QQ login result or validation feedback"
    }
  ];
};

const actionTargetsSelector = (action: Action, selector: string): boolean => {
  const target = (action.target ?? "").trim().toLowerCase();
  return target === selector.toLowerCase() || target.includes(selector.toLowerCase());
};

const decisionAlreadyTargetsCredentialForm = (
  actions: Action[],
  directActions: Action[]
): boolean => {
  const [accountAction, passwordAction, submitAction] = directActions;
  if (!accountAction?.target || !passwordAction?.target || !submitAction?.target) {
    return false;
  }

  return actions.some(
    (action) => action.type === "input" && actionTargetsSelector(action, accountAction.target!)
  ) &&
  actions.some(
    (action) => action.type === "input" && actionTargetsSelector(action, passwordAction.target!)
  ) &&
  actions.some(
    (action) => action.type === "click" && actionTargetsSelector(action, submitAction.target!)
  );
};

const inferProviderSelector = (
  provider: LoginProvider,
  element?: InteractiveElement
): string | undefined => {
  if (!element) {
    return undefined;
  }

  const defaultSelector = defaultProviderSelector(provider);

  if (element.id || (element.selector && !isPlainSelector(element.selector))) {
    return buildElementSelector(element, defaultSelector);
  }

  if (element.text?.trim() && element.tag && /^(?:a|button|li)$/i.test(element.tag)) {
    return `${element.tag}:has-text('${escapeForHasText(element.text.trim())}')`;
  }
  if (element.ariaLabel?.trim() && element.tag && /^(?:a|button|li)$/i.test(element.tag)) {
    return `${element.tag}:has-text('${escapeForHasText(element.ariaLabel.trim())}')`;
  }

  return buildElementSelector(element, defaultSelector);
};

const hasProviderAction = (actions: Action[], provider: LoginProvider): boolean => {
  const notePattern = provider === "qq" ? /qq|qq\u767b\u5f55/i : /wechat|weixin|\u5fae\u4fe1\u767b\u5f55/i;

  return actions.some((action) => {
    const normalizedTarget = (action.target ?? "").toLowerCase();
    return (
      PROVIDER_SELECTORS[provider].some((selector) =>
        normalizedTarget.includes(selector.toLowerCase().replace(/['"]/g, ""))
      ) || hasKeyword(action.note, notePattern)
    );
  });
};

const pageAlreadyShowsProviderChooser = (snapshot: PageSnapshot): boolean =>
  Boolean(
    snapshot.pageState?.hasProviderChooser ||
      snapshot.pageState?.hasModal ||
      snapshot.pageState?.surface === "login_chooser" ||
      snapshot.pageState?.surface === "provider_auth" ||
      snapshot.pageState?.surface === "login_form"
  );

const createProviderFollowUp = (
  provider: LoginProvider,
  language: RunConfig["language"],
  selector: string
): Action[] => {
  const label = PROVIDER_LABELS[provider];

  return [
    {
      type: "wait",
      ms: 900,
      note:
        language === "zh-CN"
          ? "\u7b49\u5f85\u767b\u5f55\u65b9\u5f0f\u9009\u62e9\u5668\u51fa\u73b0"
          : "Wait for the provider chooser to appear"
    },
    {
      type: "click",
      target: selector,
      note:
        language === "zh-CN"
          ? `\u70b9\u51fb${label}\u5165\u53e3\uff0c\u7ee7\u7eed\u6388\u6743\u6d41\u7a0b`
          : `Click the ${label} entry to continue the provider auth flow`
    },
    {
      type: "wait",
      ms: 1200,
      note:
        language === "zh-CN"
          ? `\u7b49\u5f85${label}\u6388\u6743\u9875\u52a0\u8f7d`
          : `Wait for the ${label} authorization page to load`
    }
  ];
};

const ensureProviderChecks = (
  checks: string[],
  provider: LoginProvider
): string[] => {
  const next = [...checks];
  const preferredChecks =
    provider === "qq"
      ? ["QQ\u767b\u5f55", "\u8d26\u53f7", "\u5bc6\u7801", "\u6388\u6743\u767b\u5f55"]
      : ["\u5fae\u4fe1\u767b\u5f55", "\u626b\u7801\u767b\u5f55", "\u786e\u8ba4\u767b\u5f55"];

  for (const item of preferredChecks) {
    if (!next.some((existing) => existing.toLowerCase() === item.toLowerCase())) {
      next.push(item);
    }
  }

  return next;
};

const isSearchHomeSurface = (snapshot: PageSnapshot): boolean =>
  isSearchHost(snapshot.url) &&
  !(
    snapshot.pageState?.hasSearchResults &&
    ((snapshot.pageState?.matchedSignals.includes("search-results") ?? false) ||
      hasCommittedSearchUrl(snapshot.url))
  ) &&
  (snapshot.pageState?.matchedSignals.includes("search-ui") ?? false);

const isCommittedSearchResultsSurface = (snapshot: PageSnapshot): boolean =>
  isSearchHost(snapshot.url) &&
  hasCommittedSearchUrl(snapshot.url) &&
  (Boolean(snapshot.pageState?.hasSearchResults) ||
    snapshot.pageState?.surface === "search_results" ||
    snapshot.elements.some(
      (element) =>
        element.tag === "a" &&
        element.isVisible !== false &&
        element.isEnabled !== false &&
        Boolean(element.text?.trim() || element.nearbyText?.trim())
    ));

const buildSearchHomeActions = (
  snapshot: PageSnapshot,
  intent: SearchNavigationIntent,
  language: RunConfig["language"],
  options?: {
    queryAlreadyPresent?: boolean;
  }
): Action[] | null => {
  const inputElement = snapshot.elements.find((element) => isSearchInputElement(element));
  const submitElement = snapshot.elements.find(
    (element) =>
      element.isVisible !== false &&
      element.isEnabled !== false &&
      (element.tag === "button" || element.tag === "input" || element.tag === "a") &&
      /search|\u641c\u7d22|\u767e\u5ea6\u4e00\u4e0b|submit/.test(
        `${element.text ?? ""} ${element.ariaLabel ?? ""} ${element.id ?? ""} ${element.selector ?? ""}`.toLowerCase()
      )
  );

  if (!inputElement || !submitElement) {
    return null;
  }

  const actions: Action[] = [];
  if (!options?.queryAlreadyPresent) {
    actions.push({
      type: "input",
      target: buildElementSelector(inputElement, "#kw"),
      value: intent.query,
      note:
        language === "zh-CN"
          ? `\u5148\u641c\u7d22 "${intent.query}"\uff0c\u4e0d\u8981\u5728\u6765\u6e90\u641c\u7d22\u9875\u63d0\u524d\u8fdb\u5165\u767b\u5f55\u6d41\u7a0b`
          : `Search for "${intent.query}" before entering any login flow on the source search page`
    });
  }

  actions.push(
    {
      type: "click",
      target: buildElementSelector(submitElement, "#su"),
      note:
        language === "zh-CN"
          ? `\u63d0\u4ea4 "${intent.query}" \u7684\u641c\u7d22`
          : `Submit the search for "${intent.query}"`
    },
    {
      type: "wait",
      ms: 1500,
      note:
        language === "zh-CN"
          ? "\u7b49\u5f85\u641c\u7d22\u7ed3\u679c\u52a0\u8f7d"
          : "Wait for the search results to load"
    }
  );

  return actions;
};

const scoreSearchResultCandidate = (
  element: InteractiveElement,
  intent: SearchNavigationIntent,
  memory: ReturnType<typeof parseGoalGuardMemory>
): number => {
  if (element.tag !== "a" || element.isVisible === false || element.isEnabled === false) {
    return Number.NEGATIVE_INFINITY;
  }

  const identity = `${element.id ?? ""} ${element.selector ?? ""} ${element.text ?? ""}`
    .toLowerCase()
    .trim();
  const primaryLabel = [element.text, element.title]
    .filter(Boolean)
    .join(" ")
    .trim();
  const genericAccessibleLabel = GENERIC_LINK_LABEL_PATTERN.test(element.ariaLabel?.trim() ?? "");

  if (/result_logo|logo/.test(identity)) {
    return Number.NEGATIVE_INFINITY;
  }
  if (!primaryLabel && genericAccessibleLabel && !(element.nearbyText ?? "").trim()) {
    return Number.NEGATIVE_INFINITY;
  }
  if (primaryLabel && LOW_SIGNAL_RESULT_TEXT_PATTERN.test(primaryLabel) && genericAccessibleLabel) {
    return Number.NEGATIVE_INFINITY;
  }

  const displayText = [element.text, element.ariaLabel, element.title]
    .filter(Boolean)
    .join(" ")
    .trim();
  const supportText = [element.nearbyText, element.contextLabel].filter(Boolean).join(" ").trim();
  const haystack = [displayText, supportText].filter(Boolean).join(" ");
  const normalizedDisplayText = normalizeText(displayText);
  const normalizedHaystack = normalizeText(haystack);
  const selectorHaystack = `${element.selector ?? ""} ${element.className ?? ""} ${element.id ?? ""}`.toLowerCase();
  const normalizedIntentTerms = intent.resultTerms.map((item) => normalizeText(item)).filter(Boolean);
  const mentionsIntentInDisplay = normalizedIntentTerms.some(
    (term) => term.length >= 2 && normalizedDisplayText.includes(term)
  );
  const goalAssessment = intent.goalProfile
    ? assessTextAgainstGoal(haystack, intent.goalProfile)
    : null;
  const hasStrongGoalAlignment = Boolean(
    goalAssessment?.aligned || (goalAssessment?.matchedPhrases.length ?? 0) > 0
  );
  const matchesAvoidedHost = memory.avoidHosts.some((host) =>
    normalizedHaystack.includes(normalizeText(host))
  );
  const matchesAvoidedLabel = memory.avoidLabels.some((label) =>
    normalizedHaystack.includes(normalizeText(label))
  );
  const hasPublisherContext = SEARCH_RESULT_PUBLISHER_PATTERN.test(haystack);
  const hasDirectSiteContext = SEARCH_RESULT_DIRECT_SITE_PATTERN.test(haystack);
  const hasOfficialSupportContext = OFFICIAL_RESULT_PATTERN.test(supportText);
  const isPrimaryTitleSelector = SEARCH_RESULT_PRIMARY_TITLE_SELECTOR_PATTERN.test(selectorHaystack);
  const isActionableEntry = SEARCH_RESULT_ACTIONABLE_ENTRY_PATTERN.test(haystack);
  const isContentLikeResult = SEARCH_RESULT_CONTENT_PATTERN.test(haystack);
  const isLikelySourceLink = SEARCH_RESULT_SOURCE_LINK_SELECTOR_PATTERN.test(selectorHaystack);
  const isShortBrandOnlyLink =
    displayText.trim().length <= 6 &&
    mentionsIntentInDisplay &&
    !isActionableEntry &&
    !hasPublisherContext &&
    !hasDirectSiteContext &&
    !hasOfficialSupportContext;
  const isLikelyOfficialRefinementLink =
    mentionsIntentInDisplay &&
    SEARCH_RESULT_OFFICIAL_REFINEMENT_TEXT_PATTERN.test(displayText) &&
    /c-invoke-class|cos-no-underline|result-item_/i.test(selectorHaystack) &&
    !hasPublisherContext &&
    !hasDirectSiteContext &&
    !hasOfficialSupportContext;

  if (!normalizedHaystack || LOW_SIGNAL_RESULT_TEXT_PATTERN.test(displayText)) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;
  for (const term of normalizedIntentTerms) {
    if (!term) {
      continue;
    }
    if (normalizedDisplayText.includes(term)) {
      score += term.length >= 4 ? 6 : 3;
    } else if (normalizedHaystack.includes(term)) {
      score += term.length >= 4 ? 3 : 1;
    }
  }

  if (
    normalizedDisplayText &&
    normalizedIntentTerms.some((term) => term.length >= 2 && normalizedDisplayText.startsWith(term))
  ) {
    score += 2;
  }
  if (goalAssessment?.matchedPhrases.length) {
    score += 8;
  }
  score += (goalAssessment?.matchedTokens.length ?? 0) * 4;

  if (OFFICIAL_RESULT_PATTERN.test(displayText)) {
    score += isLikelyOfficialRefinementLink ? 1 : 5;
  } else if (OFFICIAL_RESULT_PATTERN.test(haystack)) {
    score += 2;
  }
  if (hasPublisherContext) {
    score += 4;
  }
  if (hasDirectSiteContext) {
    score += 4;
  }
  if (isPrimaryTitleSelector) {
    score += hasPublisherContext || hasDirectSiteContext || hasOfficialSupportContext ? 5 : 3;
  }
  if (intent.requiresActionableDestination && isActionableEntry) {
    score += 8;
  }
  if (isLikelyOfficialRefinementLink) {
    score -= 10;
  }
  if (intent.requiresActionableDestination && isLikelySourceLink) {
    score -= 10;
  }
  if (intent.requiresActionableDestination && isShortBrandOnlyLink) {
    score -= 6;
  }
  if (intent.requiresActionableDestination && isContentLikeResult) {
    score -= 12;
  }
  if (goalAssessment && !goalAssessment.aligned) {
    score -= 8;
  }
  if (!hasStrongGoalAlignment && (goalAssessment?.conflictingTokens.length ?? 0) > 0) {
    score -= goalAssessment!.conflictingTokens.length * 4;
  }
  if (
    !hasStrongGoalAlignment &&
    (goalAssessment?.missingTokens.length ?? 0) > 0 &&
    (goalAssessment?.matchedPhrases.length ?? 0) === 0
  ) {
    score -= goalAssessment!.missingTokens.length * 3;
  }
  if (matchesAvoidedLabel) {
    score -= 20;
  }
  if (matchesAvoidedHost) {
    score -= 16;
  }
  if (RESULT_NOISE_PATTERN.test(haystack)) {
    score -= 5;
  }
  if (SEARCH_RESULT_QUERY_NOISE_PATTERN.test(haystack)) {
    score -= 8;
  }
  if (SEARCH_REFINEMENT_SELECTOR_PATTERN.test(selectorHaystack)) {
    score -= 4;
  }
  if (element.selector && !isPlainSelector(element.selector)) {
    score += 1;
  }
  if (displayText.length >= 10) {
    score += 1;
  }
  if (element.title?.trim()) {
    score += 1;
  }
  if (element.text?.trim()) {
    score += 1;
  }

  return score;
};

const findOfficialSearchResult = (
  snapshot: PageSnapshot,
  intent: SearchNavigationIntent,
  memory: ReturnType<typeof parseGoalGuardMemory>
): InteractiveElement | undefined =>
  snapshot.elements
    .filter((element) => element.tag === "a")
    .sort(
      (left, right) =>
        scoreSearchResultCandidate(right, intent, memory) -
        scoreSearchResultCandidate(left, intent, memory)
    )
    .find((element) => scoreSearchResultCandidate(element, intent, memory) >= 5);

const buildSearchResultActions = (
  result: InteractiveElement,
  language: RunConfig["language"]
): Action[] => {
  const resultText = (result.text ?? result.ariaLabel ?? result.title ?? "").trim();
  const selector = buildElementSelector(result, result.selector ?? "a");

  return [
    {
      type: "click",
      target: selector,
      note:
        language === "zh-CN"
          ? `\u5148\u70b9\u51fb\u641c\u7d22\u7ed3\u679c "${resultText}"\uff0c\u79bb\u5f00\u6765\u6e90\u641c\u7d22\u7ad9`
          : `Open the search result "${resultText}" and leave the source search page first`
    },
    {
      type: "wait",
      ms: 2000,
      note:
        language === "zh-CN"
          ? "\u7b49\u5f85\u76ee\u6807\u7ad9\u70b9\u52a0\u8f7d"
          : "Wait for the target site to load"
    }
  ];
};

const ensureSearchChecks = (checks: string[], intent: SearchNavigationIntent): string[] => {
  const next = [...checks];
  if (!next.some((item) => normalizeText(item) === normalizeText(intent.query))) {
    next.unshift(intent.query);
  }
  return next;
};

const collectSnapshotGoalText = (snapshot: PageSnapshot): string =>
  [
    snapshot.url,
    snapshot.title,
    ...snapshot.elements.slice(0, 40).flatMap((element) =>
      [
        element.text,
        element.title,
        element.ariaLabel,
        element.nearbyText,
        element.contextLabel,
        element.frameTitle
      ].filter((value): value is string => Boolean(value && value.trim()))
    )
  ].join(" ");

const buildReturnToSearchActions = (
  intent: SearchNavigationIntent,
  language: RunConfig["language"],
  targetUrl: string,
  currentHost?: string | null
): Action[] | null => {
  if (!isSearchHost(targetUrl)) {
    return null;
  }

  return [
    {
      type: "navigate",
      target: targetUrl,
      note:
        language === "zh-CN"
          ? currentHost
            ? `\u5f53\u524d\u7ad9\u70b9 "${currentHost}" \u4e0e\u76ee\u6807\u4e0d\u4e00\u81f4\uff0c\u5148\u8fd4\u56de\u641c\u7d22\u9636\u6bb5\u91cd\u65b0\u5bfb\u627e "${intent.query}"`
            : `\u5f53\u524d\u9875\u9762\u4e0e\u76ee\u6807\u4e0d\u4e00\u81f4\uff0c\u5148\u8fd4\u56de\u641c\u7d22\u9636\u6bb5\u91cd\u65b0\u5bfb\u627e "${intent.query}"`
          : currentHost
            ? `The current site "${currentHost}" does not match the goal. Return to the source search page and search for "${intent.query}" again.`
            : `The current page does not match the goal. Return to the source search page and search for "${intent.query}" again.`
    },
    {
      type: "wait",
      ms: 1500,
      note:
        language === "zh-CN"
          ? "\u7b49\u5f85\u6765\u6e90\u641c\u7d22\u9875\u52a0\u8f7d"
          : "Wait for the source search page to load"
    }
  ];
};

const readGoalGuardMemory = (input: {
  lastObservation?: string;
  workingMemory?: RunWorkingMemory;
}) => {
  const fallback = parseGoalGuardMemory(input.lastObservation);
  return {
    avoidHosts: Array.from(
      new Set([...(fallback.avoidHosts ?? []), ...(input.workingMemory?.avoidHosts ?? [])])
    ),
    avoidLabels: Array.from(
      new Set([...(fallback.avoidLabels ?? []), ...(input.workingMemory?.avoidLabels ?? [])])
    ),
    alignment: input.workingMemory?.alignment ?? fallback.alignment,
    transitionReason: input.workingMemory?.transitionReason ?? fallback.transitionReason,
    blockedStage:
      input.workingMemory?.blockedStage === "security_challenge"
        ? "security_challenge"
        : fallback.blockedStage,
    avoidRepeatCredentialSubmission:
      input.workingMemory?.avoidRepeatCredentialSubmission ??
      fallback.avoidRepeatCredentialSubmission
  };
};

const refineDecisionForSearchNavigation = (input: {
  snapshot: PageSnapshot;
  runConfig: RunConfig;
  decision: LLMDecision;
  lastObservation?: string;
  workingMemory?: RunWorkingMemory;
}): LLMDecision => {
  const intent = deriveSearchNavigationIntent(input.runConfig.goal);
  if (!intent) {
    return input.decision;
  }

  const expectedChecks = ensureSearchChecks(input.decision.expected_checks, intent);
  const goalGuardMemory = readGoalGuardMemory(input);
  const currentHost = safeHost(input.snapshot.url);
  const currentPageAssessment = intent.goalProfile
    ? assessTextAgainstGoal(collectSnapshotGoalText(input.snapshot), intent.goalProfile)
    : null;

  if (!isSearchHost(input.snapshot.url)) {
    if (goalGuardMemory.alignment === "wrong_target") {
      const recoveryActions = buildReturnToSearchActions(
        intent,
        input.runConfig.language,
        input.runConfig.targetUrl,
        currentHost
      );
      if (recoveryActions) {
        return {
          ...input.decision,
          actions: recoveryActions,
          expected_checks: expectedChecks,
          is_finished: false
        };
      }
    }

    if (
      isGoalIntermediaryAuthSurface({
        goal: input.runConfig.goal,
        snapshot: input.snapshot
      }) ||
      goalGuardMemory.alignment === "intermediate_auth"
    ) {
      return input.decision;
    }

    if (
      intent.requiresActionableDestination &&
      snapshotLooksLikeContentPage(input.snapshot)
    ) {
      const recoveryActions = buildReturnToSearchActions(
        intent,
        input.runConfig.language,
        input.runConfig.targetUrl,
        currentHost
      );
      if (recoveryActions) {
        return {
          ...input.decision,
          actions: recoveryActions,
          expected_checks: expectedChecks,
          is_finished: false
        };
      }
    }

    if (currentPageAssessment && !currentPageAssessment.aligned) {
      const recoveryActions = buildReturnToSearchActions(
        intent,
        input.runConfig.language,
        input.runConfig.targetUrl,
        currentHost
      );
      if (recoveryActions) {
        return {
          ...input.decision,
          actions: recoveryActions,
          expected_checks: expectedChecks,
          is_finished: false
        };
      }
    }
    return input.decision;
  }

  const currentQuery = extractCurrentSearchQuery(input.snapshot);

  if (isCommittedSearchResultsSurface(input.snapshot)) {
    if (!matchesSearchIntentQuery(currentQuery ?? undefined, intent)) {
      const searchActions = buildSearchHomeActions(input.snapshot, intent, input.runConfig.language);
      if (searchActions) {
        return {
          ...input.decision,
          actions: searchActions,
          expected_checks: expectedChecks,
          is_finished: false
        };
      }
    }

    const officialResult = findOfficialSearchResult(input.snapshot, intent, goalGuardMemory);
    if (!officialResult) {
      const recoveryActions = buildReturnToSearchActions(
        intent,
        input.runConfig.language,
        input.runConfig.targetUrl
      );
      if (recoveryActions) {
        return {
          ...input.decision,
          actions: recoveryActions,
          expected_checks: expectedChecks,
          is_finished: false
        };
      }
      return input.decision;
    }

    return {
      ...input.decision,
      actions: buildSearchResultActions(officialResult, input.runConfig.language),
      expected_checks: expectedChecks,
      is_finished: false
    };
  }

  if (!isSearchHomeSurface(input.snapshot)) {
    return input.decision;
  }

  const searchActions = buildSearchHomeActions(input.snapshot, intent, input.runConfig.language, {
    queryAlreadyPresent: matchesSearchIntentQuery(currentQuery ?? undefined, intent)
  });
  if (!searchActions) {
    return input.decision;
  }

  return {
    ...input.decision,
    actions: searchActions,
    expected_checks: expectedChecks,
    is_finished: false
  };
};

const refineDecisionForBlockedStage = (input: {
  snapshot: PageSnapshot;
  runConfig: RunConfig;
  decision: LLMDecision;
  lastObservation?: string;
  workingMemory?: RunWorkingMemory;
}): LLMDecision => {
  const memory = readGoalGuardMemory(input);
  if (
    input.snapshot.pageState?.surface !== "security_challenge" &&
    memory.blockedStage !== "security_challenge" &&
    memory.alignment !== "blocked"
  ) {
    return input.decision;
  }

  return {
    ...input.decision,
    actions: [
      {
        type: "wait",
        ms: 1500,
        note:
          input.runConfig.language === "zh-CN"
            ? "\u5f53\u524d\u5904\u4e8e\u5b89\u5168\u9a8c\u8bc1\u9636\u6bb5\uff0c\u5148\u7b49\u5f85\u4eba\u5de5\u5904\u7406\u6216\u72b6\u6001\u53d8\u5316\uff0c\u4e0d\u8981\u91cd\u590d\u63d0\u4ea4\u76f8\u540c\u7684\u8d26\u53f7\u5bc6\u7801\u52a8\u4f5c"
            : "A security challenge is blocking progress. Wait for manual resolution or a visible state change before repeating the same credential actions."
      }
    ],
    is_finished: false
  };
};

export const refineDecisionForAuthProvider = (input: {
  snapshot: PageSnapshot;
  runConfig: RunConfig;
  decision: LLMDecision;
  lastObservation?: string;
  workingMemory?: RunWorkingMemory;
}): LLMDecision => {
  const blockedStageDecision = refineDecisionForBlockedStage(input);
  const searchRefinedDecision = refineDecisionForSearchNavigation({
    ...input,
    decision: blockedStageDecision
  });
  const provider = inferPreferredProvider(input.runConfig.goal);
  if (!provider) {
    return searchRefinedDecision;
  }

  if (
    readGoalGuardMemory(input).avoidRepeatCredentialSubmission &&
    input.snapshot.pageState?.surface === "security_challenge"
  ) {
    return searchRefinedDecision;
  }

  if (provider === "qq" && snapshotShowsQqCredentialForm(input.snapshot)) {
    const directActions = buildDirectCredentialActions({
      snapshot: input.snapshot,
      runConfig: input.runConfig,
      language: input.runConfig.language
    });
    if (
      directActions &&
      !decisionAlreadyTargetsCredentialForm(searchRefinedDecision.actions, directActions)
    ) {
      return {
        ...searchRefinedDecision,
        actions: directActions,
        expected_checks: ensureProviderChecks(searchRefinedDecision.expected_checks, provider),
        is_finished: false
      };
    }
  }

  const actions = [...searchRefinedDecision.actions];
  if (actions.length === 0 || hasProviderAction(actions, provider)) {
    return searchRefinedDecision;
  }

  const loginActionIndex = actions.findIndex(isGenericLoginTrigger);
  if (loginActionIndex < 0) {
    return searchRefinedDecision;
  }

  const providerElement = findVisibleProviderElement(input.snapshot.elements, provider);
  const providerSelector =
    inferProviderSelector(provider, providerElement) ??
    (pageAlreadyShowsProviderChooser(input.snapshot) && isQqEcosystemHost(input.snapshot.url)
      ? defaultProviderSelector(provider)
      : undefined);

  if (!providerSelector) {
    return searchRefinedDecision;
  }

  const insertAfterWait =
    actions[loginActionIndex + 1]?.type === "wait" ? loginActionIndex + 2 : loginActionIndex + 1;
  const followUp = createProviderFollowUp(provider, input.runConfig.language, providerSelector);
  const nextActions = [
    ...actions.slice(0, insertAfterWait),
    ...followUp,
    ...actions.slice(insertAfterWait)
  ];

  return {
    ...searchRefinedDecision,
    actions: nextActions,
    expected_checks: ensureProviderChecks(searchRefinedDecision.expected_checks, provider)
  };
};
