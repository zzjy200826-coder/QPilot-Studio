import type { Action, Language } from "@qpilot/shared";

const zhActionTypeLabels: Record<Action["type"], string> = {
  click: "点击",
  input: "输入",
  select: "选择",
  navigate: "导航",
  wait: "等待"
};

const exactSentenceReplacements = new Map<string, string>([
  ["Reports generated.", "报告已生成。"],
  ["Reports generated", "报告已生成。"],
  ["Run passed.", "运行已通过。"],
  ["Run failed.", "运行失败。"],
  ["Run stopped.", "运行已停止。"],
  ["Mailbox shell rendered and the session bootstrap request returned 200.", "邮箱壳已渲染，session bootstrap 请求返回了 200。"],
  ["Candidate replay recovered the mailbox flow.", "候选运行修复了邮箱链路。"],
  ["Candidate replay reached the authenticated mailbox shell.", "候选运行已经到达认证后的邮箱壳。"],
  ["Candidate replay opened the provider handoff.", "候选运行已打开提供商交接页。"],
  ["Candidate replay filled the recovery account field.", "候选运行已填写找回账号输入框。"],
  ["Candidate replay pivoted to the OTP form instead of the consent wall.", "候选运行没有停在授权确认墙，而是转到了 OTP 表单。"],
  ["Candidate replay verified the OTP challenge and moved past the auth checkpoint.", "候选运行已通过 OTP 校验，并越过了认证检查点。"],
  ["Baseline replay encountered a consent checkpoint that requested extra verification.", "基线回放遇到了需要额外校验的授权确认检查点。"],
  ["The consent checkpoint appeared instead of the mailbox shell.", "出现的是授权确认检查点，而不是邮箱壳。"],
  ["The consent wall blocked any further safe automation.", "授权确认墙阻止了后续的安全自动化操作。"],
  ["Approval button remained behind the consent challenge.", "Approve 按钮仍然卡在授权确认挑战后面。"],
  ["Consent wall requested a human verification token.", "授权确认墙要求人工提供校验令牌。"],
  ["The rerun recovered by switching to the OTP form.", "这次重跑通过切换到 OTP 表单完成了恢复。"],
  ["OTP verification returned 200 and advanced the auth state.", "OTP 校验返回了 200，并推进了认证状态。"],
  ["Wait for the mailbox shell to render.", "等待邮箱壳渲染完成。"],
  ["Wait for the consent screen to settle.", "等待授权确认页面稳定下来。"],
  ["Fill the mailbox recovery account.", "填写邮箱找回账号。"],
  ["Fill the recovery OTP.", "填写找回 OTP。"],
  ["Open the SSO provider handoff.", "打开 SSO 提供商交接页。"],
  ["Submit the OTP challenge.", "提交 OTP 校验。"],
  ["Attempt to finish the consent step.", "尝试完成授权确认步骤。"],
  ["Open the mailbox login page.", "打开邮箱登录页。"],
  ["Complete the stable login flow.", "完成这条稳定的登录链路。"],
  ["Source run opened the mailbox login page.", "源运行已打开邮箱登录页。"],
  ["Source run reached the authenticated mailbox shell.", "源运行已到达认证后的邮箱壳。"],
  ["Source run captured the stable mailbox login shell.", "源运行已捕获稳定的邮箱登录壳。"],
  ["Baseline replay drifted into a consent challenge.", "基线回放漂移到了授权确认挑战。"],
  [
    "The candidate replay recovered the mailbox flow after the baseline stalled on a consent challenge.",
    "候选运行在基线卡在授权确认挑战之后，成功修复了邮箱链路。"
  ]
]);

const phraseReplacements: Array<[RegExp, string]> = [
  [/\bMailbox shell\b/g, "邮箱壳"],
  [/\bmailbox shell\b/g, "邮箱壳"],
  [/\bMailbox home\b/g, "邮箱首页"],
  [/\bMailbox sign in\b/g, "邮箱登录"],
  [/\bRecovery verification\b/g, "找回验证"],
  [/\bConsent challenge\b/g, "授权确认挑战"],
  [/\bconsent challenge\b/g, "授权确认挑战"],
  [/\bConsent wall\b/g, "授权确认墙"],
  [/\bconsent wall\b/g, "授权确认墙"],
  [/\bConsent checkpoint\b/g, "授权确认检查点"],
  [/\bconsent checkpoint\b/g, "授权确认检查点"],
  [/\bauthenticated mailbox shell\b/g, "已认证的邮箱壳"],
  [/\bauthenticated shell\b/g, "认证后的应用壳"],
  [/\bauth checkpoint\b/g, "认证检查点"],
  [/\bOTP form\b/g, "OTP 表单"],
  [/\bOTP challenge\b/g, "OTP 校验"],
  [/\bOTP verification\b/g, "OTP 校验"],
  [/\brecovery OTP\b/g, "找回 OTP"],
  [/\bprovider handoff\b/g, "提供商交接页"],
  [/\bSSO provider handoff\b/g, "SSO 提供商交接页"],
  [/\brecovery account field\b/g, "找回账号输入框"],
  [/\bmailbox recovery account\b/g, "邮箱找回账号"]
];

const localizeRunStatusWord = (value: string, language: Language): string => {
  if (language !== "zh-CN") {
    return value;
  }

  switch (value.trim().toLowerCase()) {
    case "queued":
      return "排队中";
    case "running":
      return "运行中";
    case "passed":
      return "已通过";
    case "failed":
      return "失败";
    case "stopped":
      return "已停止";
    default:
      return value;
  }
};

export const localizeActionType = (type?: string | null, language: Language = "en"): string => {
  if (!type) {
    return "";
  }
  if (language !== "zh-CN") {
    return type;
  }
  return zhActionTypeLabels[type as Action["type"]] ?? type;
};

export const localizeActionDescriptor = (
  value?: string | null,
  language: Language = "en"
): string => {
  if (!value) {
    return value ?? "";
  }
  if (language !== "zh-CN") {
    return value;
  }

  const match = value.match(/^(click|input|select|navigate|wait)\b(.*)$/i);
  if (!match) {
    return localizeEvidenceText(value, language);
  }

  const actionType = match[1] ?? "";
  const rest = match[2] ?? "";
  return `${localizeActionType(actionType.toLowerCase(), language)}${localizeEvidenceText(rest, language)}`;
};

const localizeGeneratedSentence = (value: string, language: Language): string | null => {
  if (language !== "zh-CN") {
    return value;
  }

  const scenarioPassed = value.match(/^Scenario passed on (.+)\.$/);
  if (scenarioPassed) {
    return `场景已在 ${localizeEvidenceText(scenarioPassed[1], language)} 走通。`;
  }

  const runStopped = value.match(/^Run stopped on (.+)\.$/);
  if (runStopped) {
    return `运行停在了 ${localizeEvidenceText(runStopped[1], language)}。`;
  }

  const outcomeChanged = value.match(/^Outcome changed from (.+) to (.+)\.$/);
  if (outcomeChanged) {
    const fromStatus = outcomeChanged[1] ?? "";
    const toStatus = outcomeChanged[2] ?? "";
    return `结果从 ${localizeRunStatusWord(fromStatus, language)} 变成了 ${localizeRunStatusWord(toStatus, language)}。`;
  }

  const candidateAdds = value.match(/^Candidate run adds step (\d+): (.+)\.$/);
  if (candidateAdds) {
    return `候选运行新增了第 ${candidateAdds[1]} 步：${localizeActionDescriptor(candidateAdds[2], language)}。`;
  }

  const candidateMissing = value.match(/^Candidate run no longer reaches step (\d+): (.+)\.$/);
  if (candidateMissing) {
    return `候选运行不再走到第 ${candidateMissing[1]} 步：${localizeActionDescriptor(candidateMissing[2], language)}。`;
  }

  const stepChanged = value.match(/^Step (\d+) changed from "(.+)" to "(.+)"\.$/);
  if (stepChanged) {
    return `第 ${stepChanged[1]} 步从“${localizeActionDescriptor(stepChanged[2], language)}”变成了“${localizeActionDescriptor(stepChanged[3], language)}”。`;
  }

  return null;
};

const localizeEmbeddedActionDescriptors = (value: string, language: Language): string => {
  if (language !== "zh-CN") {
    return value;
  }

  return value.replace(
    /([“"])(click|input|select|navigate|wait)([^"”]*)([”"])/gi,
    (_match, _openQuote, actionType: string, suffix: string) => {
      return `“${localizeActionType(actionType.toLowerCase(), language)}${localizeEvidenceText(
        suffix,
        language
      )}”`;
    }
  );
};

export const localizeEvidenceText = (value?: string | null, language: Language = "en"): string => {
  if (!value) {
    return value ?? "";
  }
  if (language !== "zh-CN") {
    return value;
  }

  const exactReplacement = exactSentenceReplacements.get(value.trim());
  let localized = exactReplacement ?? localizeGeneratedSentence(value.trim(), language) ?? value;

  for (const [pattern, replacement] of phraseReplacements) {
    localized = localized.replace(pattern, replacement);
  }

  localized = localizeEmbeddedActionDescriptors(localized, language);
  localized = localized.replace(/^Challenge:\s*/i, "挑战：");
  localized = localized.replace(/^Status\s+(queued|running|passed|failed|stopped)$/i, (_match, status) => {
    return `状态 ${localizeRunStatusWord(status, language)}`;
  });

  return localized;
};

export const formatLocalizedActionLabel = (
  action: Action | undefined,
  language: Language = "en",
  emptyLabel?: string
): string => {
  if (!action) {
    return emptyLabel ?? (language === "zh-CN" ? "等待中" : "waiting");
  }

  const typeLabel = localizeActionType(action.type, language);
  const note = localizeEvidenceText(action.note, language);
  return note ? `${typeLabel} · ${note}` : typeLabel;
};

export const formatLocalizedStepTitle = (
  stepIndex: number,
  actionType: string,
  language: Language = "en"
): string => {
  return language === "zh-CN"
    ? `步骤 #${stepIndex} ${localizeActionType(actionType, language)}`
    : `Step #${stepIndex} ${actionType}`;
};

export const localizeComparisonChange = (value: string, language: Language = "en"): string => {
  if (language !== "zh-CN") {
    return value;
  }

  switch (value) {
    case "changed":
      return "已变化";
    case "missing":
      return "已缺失";
    case "added":
      return "已新增";
    default:
      return value;
  }
};
