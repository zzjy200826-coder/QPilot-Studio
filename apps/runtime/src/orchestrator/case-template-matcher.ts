import type { PageSnapshot, ReplayCase, RunConfig } from "@qpilot/shared";
import {
  buildReplayCaseFromTemplate,
  extractCaseTemplateEntrySignature
} from "../cases/replay-case.js";
import type { CaseTemplateRow } from "../utils/mappers.js";

export interface CaseTemplateMatch {
  replayCase: ReplayCase;
  score: number;
  reasons: string[];
}

interface MatchInput {
  snapshot: PageSnapshot;
  runConfig: RunConfig;
  templates: CaseTemplateRow[];
  minScore?: number;
}

const MIN_CASE_TEMPLATE_MATCH_SCORE = 0.56;
const STRONG_INTENT_GROUPS = {
  search: ["search", "find", "query", "搜索", "查找", "查询", "检索"],
  login: [
    "login",
    "sign in",
    "signin",
    "log in",
    "auth",
    "authenticate",
    "登录",
    "登陆",
    "认证",
    "账号",
    "密码",
    "qq登录",
    "微信登录",
    "qq",
    "wechat",
    "weixin"
  ],
  download: ["download", "下载"],
  upload: ["upload", "上传"],
  payment: ["payment", "pay", "checkout", "billing", "购买", "支付", "结算"],
  submit: ["submit", "save", "create", "confirm", "提交", "保存", "创建", "确认"],
  admin: ["admin", "dashboard", "console", "后台", "管理台", "控制台"]
} as const;

const normalizeText = (value: string | undefined): string =>
  (value ?? "").toLowerCase().replace(/[\s_\-:|/\\]+/g, "");

const uniqueChars = (value: string): Set<string> => new Set(Array.from(value));

const scoreCharOverlap = (left: string | undefined, right: string | undefined): number => {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }

  if (
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  ) {
    return 1;
  }

  const leftChars = uniqueChars(normalizedLeft);
  const rightChars = uniqueChars(normalizedRight);
  let shared = 0;
  for (const char of leftChars) {
    if (rightChars.has(char)) {
      shared += 1;
    }
  }
  return shared / Math.max(Math.max(leftChars.size, rightChars.size), 1);
};

const urlMeta = (value: string | undefined): { host?: string; pathname?: string } => {
  if (!value) {
    return {};
  }

  try {
    const parsed = new URL(value);
    return {
      host: parsed.host.toLowerCase(),
      pathname: parsed.pathname || "/"
    };
  } catch {
    return {};
  }
};

const rootDomain = (host: string | undefined): string | undefined => {
  if (!host) {
    return undefined;
  }

  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) {
    return labels.join(".");
  }
  return labels.slice(-2).join(".");
};

const sameOrNestedPath = (
  currentPath: string | undefined,
  templatePath: string | undefined
): boolean => {
  if (!currentPath || !templatePath) {
    return false;
  }

  const normalizedCurrent = currentPath === "" ? "/" : currentPath;
  const normalizedTemplate = templatePath === "" ? "/" : templatePath;
  return (
    normalizedCurrent === normalizedTemplate ||
    normalizedCurrent.startsWith(`${normalizedTemplate}/`) ||
    normalizedTemplate.startsWith(`${normalizedCurrent}/`)
  );
};

const scoreMatchedSignals = (
  currentSignals: string[] | undefined,
  templateSignals: string[]
): number => {
  if (!currentSignals?.length || templateSignals.length === 0) {
    return 0;
  }

  const current = new Set(currentSignals);
  let overlap = 0;
  for (const signal of templateSignals) {
    if (current.has(signal)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(templateSignals.length, currentSignals.length, 1);
};

const extractStrongIntentTags = (value: string | undefined): Set<string> => {
  const normalized = (value ?? "").toLowerCase();
  const tags = new Set<string>();

  for (const [tag, keywords] of Object.entries(STRONG_INTENT_GROUPS)) {
    if (keywords.some((keyword) => normalized.includes(keyword))) {
      tags.add(tag);
    }
  }

  return tags;
};

const hasIntentConflict = (
  runGoal: string | undefined,
  templateTitle: string | undefined,
  templateGoal: string | undefined
): boolean => {
  const runIntents = extractStrongIntentTags(runGoal);
  if (runIntents.size === 0) {
    return false;
  }

  const templateIntents = new Set<string>([
    ...extractStrongIntentTags(templateTitle),
    ...extractStrongIntentTags(templateGoal)
  ]);

  if (templateIntents.size === 0) {
    return true;
  }

  for (const intent of runIntents) {
    if (templateIntents.has(intent)) {
      return false;
    }
  }

  return true;
};

export const findBestCaseTemplateMatch = (
  input: MatchInput
): CaseTemplateMatch | null => {
  const minScore = input.minScore ?? MIN_CASE_TEMPLATE_MATCH_SCORE;
  const currentUrl = urlMeta(input.snapshot.url);

  let bestMatch: CaseTemplateMatch | null = null;

  for (const template of input.templates) {
    if (template.status !== "active" || template.type === "api") {
      continue;
    }

    const replayCase = buildReplayCaseFromTemplate(template);
    if (!replayCase || replayCase.steps.length > input.runConfig.maxSteps) {
      continue;
    }

    const templateUrl = urlMeta(template.entryUrl);
    const currentRootDomain = rootDomain(currentUrl.host);
    const templateRootDomain = rootDomain(templateUrl.host);
    const sameHost =
      Boolean(currentUrl.host) &&
      Boolean(templateUrl.host) &&
      currentUrl.host === templateUrl.host;
    const sameRoot =
      Boolean(currentRootDomain) &&
      Boolean(templateRootDomain) &&
      currentRootDomain === templateRootDomain;

    if (!sameHost && !sameRoot) {
      continue;
    }

    if (hasIntentConflict(input.runConfig.goal, template.title, template.goal)) {
      continue;
    }

    const entrySignature = extractCaseTemplateEntrySignature(template);
    let score = 0;
    const reasons: string[] = [];

    if (sameHost) {
      score += 0.3;
      reasons.push(`host=${currentUrl.host}`);
    } else if (sameRoot && templateRootDomain) {
      score += 0.18;
      reasons.push(`root=${templateRootDomain}`);
    }

    if (currentUrl.pathname && templateUrl.pathname && currentUrl.pathname === templateUrl.pathname) {
      score += 0.16;
      reasons.push(`path=${currentUrl.pathname}`);
    } else if (sameOrNestedPath(currentUrl.pathname, templateUrl.pathname)) {
      score += 0.08;
      reasons.push("path-family");
    }

    if (
      entrySignature.surface &&
      input.snapshot.pageState?.surface === entrySignature.surface
    ) {
      score += 0.22;
      reasons.push(`surface=${entrySignature.surface}`);
    }

    const signalScore = scoreMatchedSignals(
      input.snapshot.pageState?.matchedSignals,
      entrySignature.matchedSignals
    );
    if (signalScore > 0) {
      score += 0.14 * signalScore;
      reasons.push(`signals=${signalScore.toFixed(2)}`);
    }

    const titleScore = scoreCharOverlap(input.snapshot.title, entrySignature.pageTitle);
    if (titleScore >= 0.3) {
      score += 0.08 * titleScore;
      reasons.push(`title=${titleScore.toFixed(2)}`);
    }

    const goalScore = scoreCharOverlap(input.runConfig.goal, template.goal);
    if (goalScore >= 0.25) {
      score += 0.16 * goalScore;
      reasons.push(`goal=${goalScore.toFixed(2)}`);
    }

    if (score < minScore) {
      continue;
    }

    const match: CaseTemplateMatch = {
      replayCase,
      score,
      reasons
    };

    if (!bestMatch || match.score > bestMatch.score) {
      bestMatch = match;
    }
  }

  return bestMatch;
};
