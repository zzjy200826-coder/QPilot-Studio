import type { Action, Language } from "@qpilot/shared";

const zhActionTypeLabels: Record<Action["type"], string> = {
  click: "\u70b9\u51fb",
  input: "\u8f93\u5165",
  select: "\u9009\u62e9",
  navigate: "\u5bfc\u822a",
  wait: "\u7b49\u5f85"
};

const exactSentenceReplacements = new Map<string, string>([
  ["Reports generated.", "\u62a5\u544a\u5df2\u751f\u6210\u3002"],
  ["Reports generated", "\u62a5\u544a\u5df2\u751f\u6210"],
  ["Run passed.", "\u8fd0\u884c\u5df2\u901a\u8fc7\u3002"],
  ["Run failed.", "\u8fd0\u884c\u5931\u8d25\u3002"],
  ["Run stopped.", "\u8fd0\u884c\u5df2\u505c\u6b62\u3002"],
  [
    "Mailbox shell rendered and the session bootstrap request returned 200.",
    "\u90ae\u7bb1\u58f3\u5df2\u6e32\u67d3\uff0csession bootstrap \u8bf7\u6c42\u8fd4\u56de 200\u3002"
  ],
  [
    "Candidate replay recovered the mailbox flow.",
    "\u5019\u9009\u56de\u653e\u6062\u590d\u4e86\u90ae\u7bb1\u6d41\u7a0b\u3002"
  ],
  [
    "Candidate replay reached the authenticated mailbox shell.",
    "\u5019\u9009\u56de\u653e\u5230\u8fbe\u4e86\u5df2\u767b\u5f55\u7684\u90ae\u7bb1\u58f3\u3002"
  ],
  [
    "Candidate replay opened the provider handoff.",
    "\u5019\u9009\u56de\u653e\u6253\u5f00\u4e86\u8eab\u4efd\u63d0\u4f9b\u65b9\u8df3\u8f6c\u9875\u3002"
  ],
  [
    "Candidate replay filled the recovery account field.",
    "\u5019\u9009\u56de\u653e\u586b\u5199\u4e86\u627e\u56de\u8d26\u53f7\u8f93\u5165\u6846\u3002"
  ],
  [
    "Candidate replay pivoted to the OTP form instead of the consent wall.",
    "\u5019\u9009\u56de\u653e\u6ca1\u6709\u505c\u5728\u6388\u6743\u786e\u8ba4\u5899\uff0c\u800c\u662f\u8f6c\u5230\u4e86 OTP \u8868\u5355\u3002"
  ],
  [
    "Candidate replay verified the OTP challenge and moved past the auth checkpoint.",
    "\u5019\u9009\u56de\u653e\u901a\u8fc7\u4e86 OTP \u6821\u9a8c\uff0c\u5e76\u8d8a\u8fc7\u4e86\u8ba4\u8bc1\u68c0\u67e5\u70b9\u3002"
  ],
  [
    "Baseline replay encountered a consent checkpoint that requested extra verification.",
    "\u57fa\u7ebf\u56de\u653e\u9047\u5230\u4e86\u9700\u8981\u989d\u5916\u6821\u9a8c\u7684\u6388\u6743\u68c0\u67e5\u70b9\u3002"
  ],
  [
    "The consent checkpoint appeared instead of the mailbox shell.",
    "\u51fa\u73b0\u7684\u662f\u6388\u6743\u68c0\u67e5\u70b9\uff0c\u800c\u4e0d\u662f\u90ae\u7bb1\u58f3\u3002"
  ],
  [
    "The consent wall blocked any further safe automation.",
    "\u6388\u6743\u786e\u8ba4\u5899\u963b\u6b62\u4e86\u540e\u7eed\u7684\u5b89\u5168\u81ea\u52a8\u5316\u3002"
  ],
  [
    "Approval button remained behind the consent challenge.",
    "Approve \u6309\u94ae\u4ecd\u7136\u5361\u5728\u6388\u6743\u6311\u6218\u4e4b\u540e\u3002"
  ],
  [
    "Consent wall requested a human verification token.",
    "\u6388\u6743\u786e\u8ba4\u5899\u8981\u6c42\u4eba\u5de5\u63d0\u4f9b\u6821\u9a8c\u4ee4\u724c\u3002"
  ],
  [
    "The rerun recovered by switching to the OTP form.",
    "\u8fd9\u6b21\u91cd\u8dd1\u901a\u8fc7\u5207\u6362\u5230 OTP \u8868\u5355\u5b8c\u6210\u4e86\u6062\u590d\u3002"
  ],
  [
    "OTP verification returned 200 and advanced the auth state.",
    "OTP \u6821\u9a8c\u8fd4\u56de 200\uff0c\u5e76\u63a8\u8fdb\u4e86\u8ba4\u8bc1\u72b6\u6001\u3002"
  ],
  [
    "Wait for the mailbox shell to render.",
    "\u7b49\u5f85\u90ae\u7bb1\u58f3\u6e32\u67d3\u5b8c\u6210\u3002"
  ],
  [
    "Wait for the consent screen to settle.",
    "\u7b49\u5f85\u6388\u6743\u786e\u8ba4\u9875\u7a33\u5b9a\u4e0b\u6765\u3002"
  ],
  [
    "Fill the mailbox recovery account.",
    "\u586b\u5199\u90ae\u7bb1\u627e\u56de\u8d26\u53f7\u3002"
  ],
  ["Fill the recovery OTP.", "\u586b\u5199\u627e\u56de OTP\u3002"],
  [
    "Open the SSO provider handoff.",
    "\u6253\u5f00 SSO \u63d0\u4f9b\u65b9\u8df3\u8f6c\u9875\u3002"
  ],
  ["Submit the OTP challenge.", "\u63d0\u4ea4 OTP \u6821\u9a8c\u3002"],
  [
    "Attempt to finish the consent step.",
    "\u5c1d\u8bd5\u5b8c\u6210\u6388\u6743\u786e\u8ba4\u6b65\u9aa4\u3002"
  ],
  ["Open the mailbox login page.", "\u6253\u5f00\u90ae\u7bb1\u767b\u5f55\u9875\u3002"],
  [
    "Complete the stable login flow.",
    "\u5b8c\u6210\u8fd9\u6761\u7a33\u5b9a\u7684\u767b\u5f55\u6d41\u7a0b\u3002"
  ],
  [
    "Source run opened the mailbox login page.",
    "\u6e90\u8fd0\u884c\u6253\u5f00\u4e86\u90ae\u7bb1\u767b\u5f55\u9875\u3002"
  ],
  [
    "Source run reached the authenticated mailbox shell.",
    "\u6e90\u8fd0\u884c\u5230\u8fbe\u4e86\u5df2\u767b\u5f55\u7684\u90ae\u7bb1\u58f3\u3002"
  ],
  [
    "Source run captured the stable mailbox login shell.",
    "\u6e90\u8fd0\u884c\u6355\u83b7\u4e86\u7a33\u5b9a\u7684\u90ae\u7bb1\u767b\u5f55\u58f3\u3002"
  ],
  [
    "Baseline replay drifted into a consent challenge.",
    "\u57fa\u7ebf\u56de\u653e\u6f02\u79fb\u5230\u4e86\u6388\u6743\u6311\u6218\u3002"
  ],
  [
    "The candidate replay recovered the mailbox flow after the baseline stalled on a consent challenge.",
    "\u57fa\u7ebf\u5361\u5728\u6388\u6743\u6311\u6218\u4e4b\u540e\uff0c\u5019\u9009\u56de\u653e\u6062\u590d\u4e86\u90ae\u7bb1\u6d41\u7a0b\u3002"
  ]
]);

const phraseReplacements: Array<[RegExp, string]> = [
  [/\bSSO provider handoff\b/g, "SSO \u63d0\u4f9b\u65b9\u8df3\u8f6c\u9875"],
  [/\bprovider handoff\b/g, "\u8eab\u4efd\u63d0\u4f9b\u65b9\u8df3\u8f6c\u9875"],
  [/\bauthenticated mailbox shell\b/g, "\u5df2\u767b\u5f55\u7684\u90ae\u7bb1\u58f3"],
  [/\bauthenticated shell\b/g, "\u5df2\u767b\u5f55\u7684\u5e94\u7528\u58f3"],
  [/\bMailbox shell\b/g, "\u90ae\u7bb1\u58f3"],
  [/\bmailbox shell\b/g, "\u90ae\u7bb1\u58f3"],
  [/\bMailbox home\b/g, "\u90ae\u7bb1\u9996\u9875"],
  [/\bMailbox sign in\b/g, "\u90ae\u7bb1\u767b\u5f55"],
  [/\bRecovery verification\b/g, "\u627e\u56de\u6821\u9a8c"],
  [/\bConsent challenge\b/g, "\u6388\u6743\u6311\u6218"],
  [/\bconsent challenge\b/g, "\u6388\u6743\u6311\u6218"],
  [/\bConsent wall\b/g, "\u6388\u6743\u786e\u8ba4\u5899"],
  [/\bconsent wall\b/g, "\u6388\u6743\u786e\u8ba4\u5899"],
  [/\bConsent checkpoint\b/g, "\u6388\u6743\u68c0\u67e5\u70b9"],
  [/\bconsent checkpoint\b/g, "\u6388\u6743\u68c0\u67e5\u70b9"],
  [/\bauth checkpoint\b/g, "\u8ba4\u8bc1\u68c0\u67e5\u70b9"],
  [/\bOTP form\b/g, "OTP \u8868\u5355"],
  [/\bOTP challenge\b/g, "OTP \u6821\u9a8c"],
  [/\bOTP verification\b/g, "OTP \u6821\u9a8c"],
  [/\brecovery OTP\b/g, "\u627e\u56de OTP"],
  [/\brecovery account field\b/g, "\u627e\u56de\u8d26\u53f7\u8f93\u5165\u6846"],
  [/\bmailbox recovery account\b/g, "\u90ae\u7bb1\u627e\u56de\u8d26\u53f7"]
];

const localizeRunStatusWord = (value: string, language: Language): string => {
  if (language !== "zh-CN") {
    return value;
  }

  switch (value.trim().toLowerCase()) {
    case "queued":
      return "\u6392\u961f\u4e2d";
    case "running":
      return "\u8fd0\u884c\u4e2d";
    case "passed":
      return "\u5df2\u901a\u8fc7";
    case "failed":
      return "\u5931\u8d25";
    case "stopped":
      return "\u5df2\u505c\u6b62";
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
  const rest = (match[2] ?? "").trim();
  if (!rest) {
    return localizeActionType(actionType.toLowerCase(), language);
  }

  return `${localizeActionType(actionType.toLowerCase(), language)} ${localizeEvidenceText(rest, language)}`;
};

const localizeGeneratedSentence = (value: string, language: Language): string | null => {
  if (language !== "zh-CN") {
    return value;
  }

  const scenarioPassed = value.match(/^Scenario passed on (.+)\.$/);
  if (scenarioPassed) {
    return `\u573a\u666f\u5df2\u5728 ${localizeEvidenceText(scenarioPassed[1], language)} \u8d70\u901a\u3002`;
  }

  const runStopped = value.match(/^Run stopped on (.+)\.$/);
  if (runStopped) {
    return `\u8fd0\u884c\u505c\u5728\u4e86 ${localizeEvidenceText(runStopped[1], language)}\u3002`;
  }

  const outcomeChanged = value.match(/^Outcome changed from (.+) to (.+)\.$/);
  if (outcomeChanged) {
    const fromStatus = outcomeChanged[1] ?? "";
    const toStatus = outcomeChanged[2] ?? "";
    return `\u7ed3\u679c\u4ece ${localizeRunStatusWord(fromStatus, language)} \u53d8\u6210\u4e86 ${localizeRunStatusWord(toStatus, language)}\u3002`;
  }

  const candidateAdds = value.match(/^Candidate run adds step (\d+): (.+)\.$/);
  if (candidateAdds) {
    return `\u5019\u9009\u8fd0\u884c\u65b0\u589e\u4e86\u7b2c ${candidateAdds[1]} \u6b65\uff1a${localizeActionDescriptor(candidateAdds[2], language)}\u3002`;
  }

  const candidateMissing = value.match(/^Candidate run no longer reaches step (\d+): (.+)\.$/);
  if (candidateMissing) {
    return `\u5019\u9009\u8fd0\u884c\u4e0d\u518d\u8d70\u5230\u7b2c ${candidateMissing[1]} \u6b65\uff1a${localizeActionDescriptor(candidateMissing[2], language)}\u3002`;
  }

  const stepChanged = value.match(/^Step (\d+) changed from "(.+)" to "(.+)"\.$/);
  if (stepChanged) {
    return `\u7b2c ${stepChanged[1]} \u6b65\u4ece\u201c${localizeActionDescriptor(stepChanged[2], language)}\u201d\u53d8\u6210\u4e86\u201c${localizeActionDescriptor(stepChanged[3], language)}\u201d\u3002`;
  }

  return null;
};

const localizeEmbeddedActionDescriptors = (value: string, language: Language): string => {
  if (language !== "zh-CN") {
    return value;
  }

  return value.replace(
    /(["\u201c])(click|input|select|navigate|wait)([^"\u201d]*)(["\u201d])/gi,
    (_match, _openQuote, actionType: string, suffix: string) => {
      return `\u201c${localizeActionType(actionType.toLowerCase(), language)} ${localizeEvidenceText(
        suffix.trim(),
        language
      )}\u201d`;
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

  const trimmed = value.trim();
  const exactReplacement = exactSentenceReplacements.get(trimmed);
  let localized = exactReplacement ?? localizeGeneratedSentence(trimmed, language) ?? trimmed;

  for (const [pattern, replacement] of phraseReplacements) {
    localized = localized.replace(pattern, replacement);
  }

  localized = localizeEmbeddedActionDescriptors(localized, language);
  localized = localized.replace(/^Challenge:\s*/i, "\u6311\u6218\uff1a");
  localized = localized.replace(/^Status\s+(queued|running|passed|failed|stopped)$/i, (_match, status) => {
    return `\u72b6\u6001\uff1a${localizeRunStatusWord(status, language)}`;
  });

  return localized;
};

export const formatLocalizedActionLabel = (
  action: Action | undefined,
  language: Language = "en",
  emptyLabel?: string
): string => {
  if (!action) {
    return emptyLabel ?? (language === "zh-CN" ? "\u7b49\u5f85\u4e2d" : "waiting");
  }

  const typeLabel = localizeActionType(action.type, language);
  const note = localizeEvidenceText(action.note, language);
  return note ? `${typeLabel} \u00b7 ${note}` : typeLabel;
};

export const formatLocalizedStepTitle = (
  stepIndex: number,
  actionType: string,
  language: Language = "en"
): string => {
  return language === "zh-CN"
    ? `\u6b65\u9aa4 #${stepIndex} ${localizeActionType(actionType, language)}`
    : `Step #${stepIndex} ${actionType}`;
};

export const localizeComparisonChange = (value: string, language: Language = "en"): string => {
  if (language !== "zh-CN") {
    return value;
  }

  switch (value) {
    case "changed":
      return "\u5df2\u53d8\u5316";
    case "missing":
      return "\u5df2\u7f3a\u5931";
    case "added":
      return "\u5df2\u65b0\u589e";
    default:
      return value;
  }
};
