import type { Frame, Locator, Page } from "playwright";
import type {
  Action,
  ActionExecutionStatus,
  ActionResolutionMethod,
  Language,
  VisualMatch
} from "@qpilot/shared";
import {
  type SecurityChallengeResult,
  detectSecurityChallenge,
  dismissBlockingOverlays
} from "../collector/page-guards.js";
import { resolveVisualClickTarget } from "../ocr/visual-targeting.js";
import { runtimeText } from "../../i18n/runtime-text.js";
import { isHighRiskAction } from "../../utils/risk-action.js";

export interface ActionExecutionResult {
  status: ActionExecutionStatus;
  observation: string;
  shouldHalt?: boolean;
  blockingReason?: string;
  failureReason?: string;
  challenge?: SecurityChallengeResult;
  challengePhase?: "before" | "after";
  targetUsed?: string;
  resolutionMethod?: ActionResolutionMethod;
  visualMatch?: VisualMatch;
}

export interface ActionExecutionProgress {
  phase:
    | "guard"
    | "resolving"
    | "acting"
    | "waiting"
    | "navigating"
    | "completed";
  message: string;
  progress?: number;
}

export type ActionExecutionProgressReporter = (
  progress: ActionExecutionProgress
) => Promise<void> | void;

export interface ActionExecutionContext {
  goal?: string;
}

interface FrameLocatorMatch {
  locator: Locator;
  frame: Frame;
  frameLabel: string;
  visibleCount: number;
}

type LoginProvider = "qq" | "wechat";
type AccessibleRole = "link" | "button";

const QUOTED_SEGMENT_PATTERN =
  /["'\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f\u300a\u300b](.+?)["'\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f\u300a\u300b]/g;
const NOTE_SPLIT_PATTERN = /[,.!?;:()\[\]{}<>/\u3002\uff0c\uff1f\uff01\uff1b\uff1a\u3001]+/;
const ACTION_WORD_PATTERN =
  /\b(?:click|tap|press|open|choose|select|switch(?:\s+to)?|go\s+to|focus|search)\b|\u70b9\u51fb|\u5355\u51fb|\u53cc\u51fb|\u6253\u5f00|\u8fdb\u5165|\u9009\u62e9|\u5207\u6362(?:\u5230)?|\u524d\u5f80|\u805a\u7126|\u641c\u7d22/gi;
const UI_NOISE_PATTERN =
  /\b(?:button|link|entry|option|dialog|modal|popup|tab|page|screen|section|field|result|results)\b|\u6309\u94ae|\u94fe\u63a5|\u5165\u53e3|\u9009\u9879|\u5f39\u7a97|\u7a97\u53e3|\u9875\u7b7e|\u9875\u9762|\u533a\u57df|\u5b57\u6bb5|\u754c\u9762|\u641c\u7d22\u7ed3\u679c/gi;
const SELECTOR_LOOKUP_PREFIX = /^(#|\.|\[|\/|xpath=|text=|css=|id=|name=|role=|nth=|>>)/i;
const UNIQUE_SELECTOR_SIGNAL = /#|\[data-testid=|\[data-test=|\[name=|\[aria-label=|\[title=|\[href=|:has-text\(|:text\(/i;
const SELECTOR_TEXT_PATTERNS = [
  /:has-text\((['"])(.*?)\1\)/gi,
  /\[(?:title|aria-label|name|placeholder|alt)\s*=\s*(['"])(.*?)\1\]/gi,
  /\btext=(['"]?)(.+?)\1$/gi
] as const;

const PROVIDER_LABELS: Record<LoginProvider, { zh: string; en: string }> = {
  qq: {
    zh: "\u0051\u0051\u767b\u5f55",
    en: "QQ login"
  },
  wechat: {
    zh: "\u5fae\u4fe1\u767b\u5f55",
    en: "WeChat login"
  }
};

const PROVIDER_FALLBACK_SELECTORS: Record<LoginProvider, string[]> = {
  qq: [
    "#modalIconqq",
    "a:has-text('QQ\\u8d26\\u53f7')",
    "a:has-text('QQ\\u767b\\u5f55')",
    "li:has-text('QQ\\u8d26\\u53f7')",
    "[title='QQ\\u8d26\\u53f7']",
    "[aria-label*='QQ']",
    "[id*='qq']",
    "[class*='qq']",
    "[class*='qzone']"
  ],
  wechat: [
    "#modalIconWechat",
    "a:has-text('\\u5fae\\u4fe1')",
    "a:has-text('\u5fae\u4fe1\u767b\u5f55')",
    "li:has-text('\\u5fae\\u4fe1')",
    "[title='\\u5fae\\u4fe1']",
    "[aria-label*='\\u5fae\\u4fe1']",
    "[id*='wechat']",
    "[class*='wechat']"
  ]
};

const AUTO_PROVIDER_WAIT_MS = 5_000;
const AUTO_PROVIDER_POLL_MS = 180;
const FRAME_LOOKUP_POLL_MS = 120;

const assertTarget = (action: Action, language?: Language): string => {
  if (!action.target) {
    throw new Error(
      language === "zh-CN"
        ? `\u52a8\u4f5c "${action.type}" \u5fc5\u987b\u63d0\u4f9b target\u3002`
        : `Action "${action.type}" requires a target.`
    );
  }

  return action.target;
};

const waitVisible = async (locator: Locator, timeout = 3_000): Promise<boolean> => {
  try {
    await locator.waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
};

const safeHost = (value: string): string | null => {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const describeFrame = (page: Page, frame: Frame, index: number): string => {
  if (frame === page.mainFrame()) {
    return "main";
  }

  return safeHost(frame.url()) ?? `frame-${index}`;
};

export const findVisibleLocatorAcrossFrames = async (
  page: Page,
  buildLocator: (frame: Frame) => Locator,
  timeout = 600
): Promise<FrameLocatorMatch | null> => {
  const deadline = Date.now() + timeout;

  while (true) {
    const frames = page.frames();

    for (const [index, frame] of frames.entries()) {
      const locator = buildLocator(frame);
      const visibleIndexes = await locator
        .evaluateAll((elements) => {
          const isVisible = (element: Element): boolean => {
            if (!(element instanceof HTMLElement)) {
              return false;
            }
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return (
              style.visibility !== "hidden" &&
              style.display !== "none" &&
              Number(style.opacity || "1") > 0 &&
              rect.width > 1 &&
              rect.height > 1
            );
          };

          return elements
            .map((element, elementIndex) => (isVisible(element) ? elementIndex : -1))
            .filter((elementIndex) => elementIndex >= 0);
        })
        .catch(() => []);

      const firstVisibleIndex = visibleIndexes[0];
      if (firstVisibleIndex === undefined) {
        continue;
      }

      const visibleLocator = locator.nth(firstVisibleIndex);
      if (!(await waitVisible(visibleLocator, Math.max(80, deadline - Date.now())))) {
        continue;
      }

      return {
        locator: visibleLocator,
        frame,
        frameLabel: describeFrame(page, frame, index),
        visibleCount: visibleIndexes.length
      };
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return null;
    }

    await page.waitForTimeout(Math.min(FRAME_LOOKUP_POLL_MS, remainingMs));
  }
};

const withFrameLabel = (target: string, frameLabel: string): string =>
  frameLabel === "main" ? target : `${target} [frame=${frameLabel}]`;

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeHint = (value: string): string =>
  value.toLowerCase().replace(/\s+/g, " ").trim();

const pushUniqueHint = (target: string[], value: string, seen: Set<string>): void => {
  const trimmed = value.trim();
  const normalized = normalizeHint(trimmed);
  if (trimmed.length < 2 || seen.has(normalized)) {
    return;
  }

  seen.add(normalized);
  target.push(trimmed);
};

const extractQuotedNoteTargets = (note?: string): string[] => {
  if (!note) {
    return [];
  }

  const matches = Array.from(note.matchAll(QUOTED_SEGMENT_PATTERN));
  return matches
    .map((match) => match[1]?.trim() ?? "")
    .filter((item) => item.length >= 2);
};

const extractSelectorLiteralTexts = (target?: string): string[] => {
  if (!target) {
    return [];
  }

  const values = new Set<string>();
  for (const pattern of SELECTOR_TEXT_PATTERNS) {
    const matches = Array.from(target.matchAll(pattern));
    for (const match of matches) {
      const rawValue = match[2]?.trim();
      if (!rawValue || rawValue.length < 2) {
        continue;
      }
      values.add(rawValue);
    }
  }

  return Array.from(values);
};

const sanitizeNoteChunk = (value: string): string =>
  value
    .replace(ACTION_WORD_PATTERN, " ")
    .replace(UI_NOISE_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();

export const derivePreferredClickTexts = (action: Action): string[] => {
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const item of extractQuotedNoteTargets(action.note)) {
    pushUniqueHint(candidates, sanitizeNoteChunk(item), seen);
  }

  for (const item of extractSelectorLiteralTexts(action.target)) {
    pushUniqueHint(candidates, sanitizeNoteChunk(item), seen);
  }

  if (action.target && !SELECTOR_LOOKUP_PREFIX.test(action.target.trim())) {
    pushUniqueHint(candidates, sanitizeNoteChunk(action.target), seen);
  }

  if (action.note) {
    for (const chunk of action.note.split(NOTE_SPLIT_PATTERN)) {
      pushUniqueHint(candidates, sanitizeNoteChunk(chunk), seen);
    }
  }

  return candidates;
};

const shouldUseGenericFallback = (action: Action, target: string): boolean => {
  if (action.type === "navigate" || action.type === "wait") {
    return false;
  }

  const normalized = target.trim().toLowerCase();
  return (
    normalized === "a" ||
    normalized === "button" ||
    normalized === "input" ||
    normalized === "select" ||
    normalized === "textarea" ||
    normalized === "summary" ||
    normalized === "[role='button']" ||
    normalized === '[role="button"]' ||
    normalized === "[role='link']" ||
    normalized === '[role="link"]'
  );
};

const isLikelyAmbiguousSelector = (target: string): boolean => {
  const normalized = target.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (UNIQUE_SELECTOR_SIGNAL.test(normalized)) {
    return false;
  }

  if (SELECTOR_LOOKUP_PREFIX.test(normalized) && !normalized.startsWith(".")) {
    return false;
  }

  return /^(?:a|button|input|select|textarea|summary|div|span|li|nav|main|section|article)(?:[.:[].*)?$/i.test(
    normalized
  );
};

const deriveAccessibleRoles = (target: string): AccessibleRole[] => {
  const normalized = target.trim().toLowerCase();
  const roles: AccessibleRole[] = [];
  const pushRole = (role: AccessibleRole): void => {
    if (!roles.includes(role)) {
      roles.push(role);
    }
  };

  if (
    /^a(?=[.#:[\s]|$)/i.test(normalized) ||
    /\[role=['"]link['"]\]/i.test(normalized) ||
    /(?:^|[^\w-])role=link\b/i.test(normalized) ||
    /\[href(?:=|\])/i.test(normalized)
  ) {
    pushRole("link");
  }

  if (
    /^button(?=[.#:[\s]|$)/i.test(normalized) ||
    /\[role=['"]button['"]\]/i.test(normalized) ||
    /(?:^|[^\w-])role=button\b/i.test(normalized) ||
    /input\[[^\]]*type=['"]?(?:submit|button)['"]?[^\]]*\]/i.test(normalized)
  ) {
    pushRole("button");
  }

  if (/qq|wechat|weixin|qzone|login|sign.?in|\u767b\u5f55|\u0051\u0051|\u5fae\u4fe1/.test(normalized)) {
    pushRole("link");
    pushRole("button");
  }

  return roles;
};

const buildLocateError = (
  language: Language | undefined,
  target: string,
  reason?: string
): Error =>
  new Error(
    language === "zh-CN"
      ? `\u672a\u80fd\u7a33\u5b9a\u5b9a\u4f4d\u76ee\u6807\uff1a${target}${reason ? `\uff08${reason}\uff09` : ""}`
      : `Unable to reliably locate target: ${target}${reason ? ` (${reason})` : ""}`
  );

const inferPreferredLoginProvider = (goal?: string): LoginProvider | null => {
  const normalized = goal?.toLowerCase() ?? "";
  if (/qq|qzone|\u0051\u0051\u767b\u5f55/.test(normalized)) {
    return "qq";
  }
  if (/wechat|weixin|\u5fae\u4fe1\u767b\u5f55/.test(normalized)) {
    return "wechat";
  }
  return null;
};

const isGenericLoginTrigger = (action: Action, targetUsed?: string): boolean => {
  const haystack = `${action.target ?? ""} ${action.note ?? ""} ${targetUsed ?? ""}`.toLowerCase();
  return /login|sign.?in|unlogin|\u767b\u5f55/.test(haystack);
};

const providerLabel = (provider: LoginProvider, language?: Language): string =>
  language === "zh-CN"
    ? PROVIDER_LABELS[provider].zh
    : PROVIDER_LABELS[provider].en;

const tryAutoSelectLoginProvider = async (input: {
  page: Page;
  action: Action;
  targetUsed: string;
  language?: Language;
  context?: ActionExecutionContext;
  onProgress?: ActionExecutionProgressReporter;
}): Promise<string | null> => {
  const provider = inferPreferredLoginProvider(input.context?.goal);
  if (!provider || !isGenericLoginTrigger(input.action, input.targetUsed)) {
    return null;
  }

  const label = providerLabel(provider, input.language);

  const deadline = Date.now() + AUTO_PROVIDER_WAIT_MS;
  while (Date.now() < deadline) {
    for (const selector of PROVIDER_FALLBACK_SELECTORS[provider]) {
      const match = await findVisibleLocatorAcrossFrames(
        input.page,
        (frame) => frame.locator(selector),
        Math.min(500, Math.max(120, deadline - Date.now()))
      );
      if (!match) {
        continue;
      }

      await input.onProgress?.({
        phase: "acting",
        message:
          input.language === "zh-CN"
            ? `\u5df2\u51fa\u73b0\u767b\u5f55\u65b9\u5f0f\u9009\u62e9\uff0c\u6b63\u5728\u81ea\u52a8\u70b9\u51fb${label}\u3002`
            : `Login chooser detected. Automatically clicking ${label}.`
      });
      await match.locator
        .click({ timeout: 4_000 })
        .catch(() => match.locator.click({ timeout: 4_000, force: true }));
      await input.onProgress?.({
        phase: "completed",
        message:
          input.language === "zh-CN"
            ? `\u5df2\u81ea\u52a8\u8fdb\u5165${label}\u5165\u53e3\u3002`
            : `Automatically entered the ${label} entry.`
      });
      return withFrameLabel(selector, match.frameLabel);
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs > 0) {
      await input.page.waitForTimeout(Math.min(AUTO_PROVIDER_POLL_MS, remainingMs));
    }
  }

  return null;
};

const resolveLocator = async (
  page: Page,
  action: Action,
  language?: Language
): Promise<{
  locator: Locator;
  targetUsed: string;
  resolutionMethod: ActionResolutionMethod;
}> => {
  const originalTarget = assertTarget(action, language);
  const preferredTexts = action.type === "click" ? derivePreferredClickTexts(action) : [];
  const accessibleRoles = action.type === "click" ? deriveAccessibleRoles(originalTarget) : [];

  const exactMatch = async (): Promise<{
    locator: Locator;
    targetUsed: string;
    resolutionMethod: ActionResolutionMethod;
  } | null> => {
    const match = await findVisibleLocatorAcrossFrames(
      page,
      (frame) => frame.locator(originalTarget),
      700
    );
    if (!match) {
      return null;
    }

    if (match.visibleCount > 1 && isLikelyAmbiguousSelector(originalTarget)) {
      throw buildLocateError(language, originalTarget, "ambiguous selector");
    }

    return {
      locator: match.locator,
      targetUsed: withFrameLabel(originalTarget, match.frameLabel),
      resolutionMethod: "dom_selector"
    };
  };

  for (const preferredText of preferredTexts) {
    for (const role of accessibleRoles) {
      const exactRoleName = new RegExp(`^\\s*${escapeRegex(preferredText)}\\s*$`, "i");
      const exactRoleMatch = await findVisibleLocatorAcrossFrames(
        page,
        (frame) =>
          frame.getByRole(role, {
            name: exactRoleName
          }),
        500
      );
      if (exactRoleMatch && exactRoleMatch.visibleCount === 1) {
        return {
          locator: exactRoleMatch.locator,
          targetUsed: withFrameLabel(
            `[role=${role}][name=${preferredText}]`,
            exactRoleMatch.frameLabel
          ),
          resolutionMethod: "text_match"
        };
      }

      const fuzzyRoleMatch = await findVisibleLocatorAcrossFrames(
        page,
        (frame) =>
          frame.getByRole(role, {
            name: new RegExp(escapeRegex(preferredText), "i")
          }),
        500
      );
      if (fuzzyRoleMatch && fuzzyRoleMatch.visibleCount === 1) {
        return {
          locator: fuzzyRoleMatch.locator,
          targetUsed: withFrameLabel(
            `[role=${role}][name~=${preferredText}]`,
            fuzzyRoleMatch.frameLabel
          ),
          resolutionMethod: "text_match"
        };
      }
    }

    const narrowed = await findVisibleLocatorAcrossFrames(
      page,
      (frame) =>
        frame.locator(originalTarget).filter({
          hasText: new RegExp(escapeRegex(preferredText), "i")
        }),
      500
    );
    if (narrowed && narrowed.visibleCount === 1) {
      return {
        locator: narrowed.locator,
        targetUsed: `${withFrameLabel(originalTarget, narrowed.frameLabel)} [text=${preferredText}]`,
        resolutionMethod: "text_match"
      };
    }

    const directTextMatch = await findVisibleLocatorAcrossFrames(
      page,
      (frame) => frame.getByText(new RegExp(escapeRegex(preferredText), "i")),
      500
    );
    if (directTextMatch && directTextMatch.visibleCount === 1) {
      return {
        locator: directTextMatch.locator,
        targetUsed: withFrameLabel(`[text=${preferredText}]`, directTextMatch.frameLabel),
        resolutionMethod: "text_match"
      };
    }
  }

  const direct = await exactMatch();
  if (direct) {
    return direct;
  }

  await dismissBlockingOverlays(page);
  const afterDismiss = await exactMatch();
  if (afterDismiss) {
    return afterDismiss;
  }

  const fallbackByType: Record<Action["type"], string | null> = {
    input: "input:not([type='hidden']):visible, textarea:visible",
    click: "button:visible, input[type='submit']:visible, [role='button']:visible, a:visible",
    select: "select:visible",
    navigate: null,
    wait: null
  };

  const fallbackSelector = fallbackByType[action.type];
  if (!fallbackSelector || !shouldUseGenericFallback(action, originalTarget)) {
    throw buildLocateError(language, originalTarget);
  }

  const fallback = await findVisibleLocatorAcrossFrames(
    page,
    (frame) => frame.locator(fallbackSelector),
    500
  );
  if (fallback) {
    return {
      locator: fallback.locator,
      targetUsed: withFrameLabel(`[fallback:${fallbackSelector}]`, fallback.frameLabel),
      resolutionMethod: "generic_fallback"
    };
  }

  throw buildLocateError(language, originalTarget);
};

export const executeAction = async (
  page: Page,
  action: Action,
  onProgress?: ActionExecutionProgressReporter,
  language?: Language,
  context?: ActionExecutionContext
): Promise<ActionExecutionResult> => {
  const text = runtimeText(language);

  if (isHighRiskAction(action)) {
    return {
      status: "blocked_high_risk",
      observation: text.blockedHighRiskAction(action),
      failureReason: text.blockedHighRiskAction(action)
    };
  }

  await onProgress?.({
    phase: "guard",
    message: text.checkingChallengesAndOverlays
  });

  const preChallenge = await detectSecurityChallenge(page);
  if (preChallenge.detected) {
    return {
      status: "failed",
      observation: text.executionBlockedBeforeAction(preChallenge.reason ?? "unknown"),
      shouldHalt: true,
      blockingReason: preChallenge.reason,
      failureReason: preChallenge.reason,
      challenge: preChallenge,
      challengePhase: "before"
    };
  }

  try {
    const dismissedBeforeAction = await dismissBlockingOverlays(page);

    switch (action.type) {
      case "click": {
        await onProgress?.({
          phase: "resolving",
          message: text.resolveClickTarget(action.target ?? "(missing target)")
        });
        let locator: Locator | null = null;
        let targetUsed = "";
        let resolutionMethod: ActionResolutionMethod | undefined;
        let visualTarget: Awaited<ReturnType<typeof resolveVisualClickTarget>> | null = null;

        try {
          const resolved = await resolveLocator(page, action, language);
          locator = resolved.locator;
          targetUsed = resolved.targetUsed;
          resolutionMethod = resolved.resolutionMethod;
        } catch (resolveError) {
          await onProgress?.({
            phase: "resolving",
            message: text.tryingVisualTarget(action.note ?? action.target ?? "target")
          });
          visualTarget = await resolveVisualClickTarget(page, action);
          if (!visualTarget) {
            throw resolveError;
          }
          targetUsed = visualTarget.targetUsed;
          await onProgress?.({
            phase: "acting",
            message: text.visualTargetResolved(
              visualTarget.matchedText,
              visualTarget.surfaceLabel
            )
          });
          resolutionMethod = "ocr";
        }

        let finalTargetUsed = targetUsed;
        await onProgress?.({
          phase: "acting",
          message: text.clickingTarget(targetUsed)
        });
        if (locator) {
          try {
            await locator.click({ timeout: 6_000 });
          } catch {
            await dismissBlockingOverlays(page);
            await onProgress?.({
              phase: "acting",
              message: text.retryClickAfterOverlay(targetUsed)
            });
            await locator.click({ timeout: 6_000, force: true });
          }
        } else if (visualTarget) {
          try {
            await page.mouse.click(visualTarget.x, visualTarget.y);
          } catch {
            await dismissBlockingOverlays(page);
            await onProgress?.({
              phase: "acting",
              message: text.retryClickAfterOverlay(targetUsed)
            });
            await page.mouse.click(visualTarget.x, visualTarget.y);
          }
        }
        const autoProviderSelector = await tryAutoSelectLoginProvider({
          page,
          action,
          targetUsed,
          language,
          context,
          onProgress
        });
        if (autoProviderSelector) {
          finalTargetUsed = `${targetUsed} -> ${autoProviderSelector}`;
        }
        await onProgress?.({
          phase: "completed",
          message: text.clickCompleted(finalTargetUsed)
        });
        return {
          status: "success",
          observation: text.actionCompletedObservation(action, finalTargetUsed, dismissedBeforeAction),
          targetUsed: finalTargetUsed,
          resolutionMethod,
          visualMatch: visualTarget
            ? {
                matchedText: visualTarget.matchedText,
                surfaceLabel: visualTarget.surfaceLabel,
                confidence: visualTarget.confidence
              }
            : undefined
        };
      }
      case "input": {
        await onProgress?.({
          phase: "resolving",
          message: text.resolveInputTarget(action.target ?? "(missing target)")
        });
        let locator: Locator | null = null;
        let targetUsed = "";
        let resolutionMethod: ActionResolutionMethod | undefined;
        let visualTarget: Awaited<ReturnType<typeof resolveVisualClickTarget>> | null = null;

        try {
          const resolved = await resolveLocator(page, action, language);
          locator = resolved.locator;
          targetUsed = resolved.targetUsed;
          resolutionMethod = resolved.resolutionMethod;
        } catch (resolveError) {
          await onProgress?.({
            phase: "resolving",
            message: text.tryingVisualTarget(action.note ?? action.target ?? "target")
          });
          visualTarget = await resolveVisualClickTarget(page, action);
          if (!visualTarget) {
            throw resolveError;
          }
          targetUsed = visualTarget.targetUsed;
          await onProgress?.({
            phase: "acting",
            message: text.visualTargetResolved(
              visualTarget.matchedText,
              visualTarget.surfaceLabel
            )
          });
          resolutionMethod = "ocr";
        }

        await onProgress?.({
          phase: "acting",
          message: text.fillingTarget(targetUsed)
        });
        if (locator) {
          try {
            await locator.fill(action.value ?? "", { timeout: 6_000 });
          } catch {
            await locator.click({ timeout: 4_000 });
            await page.keyboard.press("Control+A");
            await page.keyboard.type(action.value ?? "", { delay: 20 });
          }
        } else if (visualTarget) {
          await page.mouse.click(visualTarget.x, visualTarget.y);
          await page.keyboard.press("Control+A").catch(() => undefined);
          await page.keyboard.type(action.value ?? "", { delay: 20 });
        }
        await onProgress?.({
          phase: "completed",
          message: text.inputCompleted(targetUsed)
        });
        return {
          status: "success",
          observation: text.actionCompletedObservation(action, targetUsed, dismissedBeforeAction),
          targetUsed,
          resolutionMethod,
          visualMatch: visualTarget
            ? {
                matchedText: visualTarget.matchedText,
                surfaceLabel: visualTarget.surfaceLabel,
                confidence: visualTarget.confidence
              }
            : undefined
        };
      }
      case "select": {
        await onProgress?.({
          phase: "resolving",
          message: text.resolveSelectTarget(action.target ?? "(missing target)")
        });
        const { locator, targetUsed } = await resolveLocator(page, action, language);
        await onProgress?.({
          phase: "acting",
          message: text.selectingOption(targetUsed)
        });
        await locator.selectOption(action.value ?? "", {
          timeout: 6_000
        });
        await onProgress?.({
          phase: "completed",
          message: text.selectionCompleted(targetUsed)
        });
        return {
          status: "success",
          observation: text.actionCompletedObservation(action, targetUsed, dismissedBeforeAction),
          targetUsed,
          resolutionMethod: "dom_selector"
        };
      }
      case "navigate": {
        const url = action.value ?? action.target;
        if (!url) {
          throw new Error(
            language === "zh-CN"
              ? '\u52a8\u4f5c "navigate" \u5fc5\u987b\u63d0\u4f9b target \u6216 value URL\u3002'
              : 'Action "navigate" requires target or value URL.'
          );
        }
        await onProgress?.({
          phase: "navigating",
          message: text.navigatingTo(url)
        });
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 12_000 });
        await onProgress?.({
          phase: "completed",
          message: text.navigationCompleted(url)
        });
        return {
          status: "success",
          observation: text.actionCompletedObservation(action, url, dismissedBeforeAction),
          targetUsed: url,
          resolutionMethod: "direct_navigation"
        };
      }
      case "wait": {
        const totalMs = action.ms ?? 1_000;
        let elapsedMs = 0;

        while (elapsedMs < totalMs) {
          const chunkMs = Math.min(1_000, totalMs - elapsedMs);
          await onProgress?.({
            phase: "waiting",
            message: text.waitingForSettle(Math.max(totalMs - elapsedMs, chunkMs)),
            progress: totalMs > 0 ? elapsedMs / totalMs : 1
          });
          await page.waitForTimeout(chunkMs);
          elapsedMs += chunkMs;
        }
        await onProgress?.({
          phase: "completed",
          message: text.waitCompleted(totalMs),
          progress: 1
        });
        return {
          status: "success",
          observation: text.actionCompletedObservation(action, undefined, dismissedBeforeAction),
          resolutionMethod: "timer"
        };
      }
      default: {
        const unreachable: never = action.type;
        throw new Error(
          language === "zh-CN"
            ? `\u4e0d\u652f\u6301\u7684\u52a8\u4f5c\u7c7b\u578b\uff1a${String(unreachable)}`
            : `Unsupported action type: ${String(unreachable)}`
        );
      }
    }
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : language === "zh-CN"
          ? "\u672a\u77e5\u6267\u884c\u9519\u8bef"
          : "Unknown execution error";
    return {
      status: "failed",
      observation: text.actionFailed(action, reason),
      failureReason: reason
    };
  }
};
