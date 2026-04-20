import type { ChallengeKind } from "@qpilot/shared";
import type { Page } from "playwright";

const CAPTCHA_URL_HINTS = [
  "captcha",
  "challenge",
  "verify",
  "wappass",
  "security",
  "robot",
  "turing",
  "human-check",
  "cloudflare"
];

const CAPTCHA_TEXT_HINTS = [
  "安全验证",
  "验证码",
  "完成验证",
  "请先验证",
  "行为验证",
  "滑块验证",
  "拖动滑块",
  "请完成安全验证",
  "are you human",
  "verify you are human",
  "security check",
  "prove you are human",
  "attention required",
  "cf challenge"
];

const LOGIN_WALL_TEXT_HINTS = [
  "登录后继续",
  "请先登录",
  "登录即可继续",
  "sign in to continue",
  "log in to continue"
];

const AUTHENTICATED_APP_TEXT_HINTS = [
  "logout",
  "sign out",
  "profile",
  "account center",
  "user center",
  "dashboard",
  "workspace",
  "workbench",
  "console",
  "inbox",
  "compose",
  "mail list",
  "收件箱",
  "写信",
  "退出",
  "个人中心",
  "账号中心",
  "用户中心",
  "工作台",
  "控制台",
  "已登录"
];

const AUTH_DIALOG_TEXT_HINTS = [
  "qq鐧诲綍",
  "寰俊鐧诲綍",
  "qq login",
  "wechat login",
  "weixin login",
  "social login",
  "provider login",
  "provider chooser",
  "choose your login",
  "login platform",
  "login method",
  "authorize",
  "oauth",
  "passport",
  "璇烽€夋嫨鎮ㄧ殑鐧诲綍骞冲彴",
  "鐧诲綍骞冲彴",
  "鐧诲綍鏂瑰紡",
  "鐧诲綍娓犻亾",
  "绗笁鏂圭櫥褰?",
  "鎺堟潈鐧诲綍",
  "qq璐﹀彿",
  "寰俊"
];

const AUTH_DIALOG_IDENTITY_HINTS = [
  "login",
  "signin",
  "auth",
  "authorize",
  "oauth",
  "passport",
  "provider",
  "chooser",
  "modalicon",
  "qq",
  "wechat",
  "weixin"
];

const COOKIE_BANNER_SELECTORS = [
  "#onetrust-banner-sdk",
  ".cookie-banner",
  ".cookie-consent",
  ".consent-banner",
  "[data-testid='cookie-banner']"
].join(",");

const DIALOG_HINT_SELECTORS = [
  "[role='dialog']",
  "[aria-modal='true']",
  "[id*='modal']",
  "[id*='dialog']",
  "[id*='popup']",
  ".modal",
  ".dialog",
  ".popup",
  "[class*='modal']",
  "[class*='dialog']",
  "[class*='popup']",
  ".modal-page",
  ".modal-bg",
  ".tang-pass-pop-login",
  "#passport-login-pop"
].join(",");

const CLOSE_BUTTON_SELECTORS = [
  "[aria-label='close']",
  "[aria-label='Close']",
  "[aria-label='关闭']",
  ".close",
  ".close-btn",
  ".modal-close",
  ".modal-btn-close",
  ".dialog-close",
  ".tang-pass-cross",
  ".pass-close",
  "button:has-text('Close')",
  "button:has-text('关闭')",
  "button:has-text('取消')",
  "button:has-text('稍后')",
  "button:has-text('以后再说')"
].join(",");

const ACCEPT_BUTTON_SELECTORS = [
  "button:has-text('Accept')",
  "button:has-text('I agree')",
  "button:has-text('同意')",
  "button:has-text('接受')",
  "button:has-text('知道了')",
  "button:has-text('继续')"
].join(",");

const CAPTCHA_IFRAME_SELECTOR =
  "iframe[src*='captcha'], iframe[src*='verify'], iframe[src*='challenge'], iframe[src*='recaptcha'], iframe[src*='hcaptcha']";

const CAPTCHA_WIDGET_SELECTOR = [
  ".geetest_panel",
  ".geetest_holder",
  ".captcha",
  ".h-captcha",
  ".g-recaptcha",
  "#captcha",
  "[data-sitekey]"
].join(",");

const normalize = (value: string): string => value.toLowerCase().replace(/\s+/g, " ").trim();

const includesAny = (source: string, hints: readonly string[]): boolean => {
  const normalized = normalize(source);
  return hints.some((hint) => normalized.includes(hint.toLowerCase()));
};

export const shouldPreserveDialog = (
  dialogText: string | undefined,
  dialogIdentity?: string
): boolean => {
  const text = dialogText ?? "";
  const identity = dialogIdentity ?? "";
  return (
    includesAny(text, AUTH_DIALOG_TEXT_HINTS) ||
    includesAny(identity, AUTH_DIALOG_IDENTITY_HINTS)
  );
};

export interface SecurityChallengeResult {
  detected: boolean;
  kind?: ChallengeKind;
  reason?: string;
  requiresManual?: boolean;
}

export const detectSecurityChallengeFromText = (
  url: string,
  pageText: string
): SecurityChallengeResult => {
  const urlLooksLikeChallenge = includesAny(url, CAPTCHA_URL_HINTS);
  const textLooksLikeChallenge = includesAny(pageText, CAPTCHA_TEXT_HINTS);
  const looksAuthenticated = includesAny(pageText, AUTHENTICATED_APP_TEXT_HINTS);

  if (urlLooksLikeChallenge || (textLooksLikeChallenge && !looksAuthenticated)) {
    return {
      detected: true,
      kind: "captcha",
      reason: `Captcha or human verification detected at ${url}`,
      requiresManual: true
    };
  }

  if (includesAny(pageText, LOGIN_WALL_TEXT_HINTS) && !looksAuthenticated) {
    return {
      detected: true,
      kind: "login_wall",
      reason: "A login wall is blocking the target content.",
      requiresManual: true
    };
  }

  return { detected: false };
};

export const detectSecurityChallenge = async (
  page: Page
): Promise<SecurityChallengeResult> => {
  const url = page.url();
  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 2_000 })
    .catch(() => "");

  const fromText = detectSecurityChallengeFromText(url, bodyText);
  if (fromText.detected) {
    return fromText;
  }

  const captchaIframeCount = await page.locator(CAPTCHA_IFRAME_SELECTOR).count().catch(() => 0);
  if (captchaIframeCount > 0) {
    return {
      detected: true,
      kind: "captcha",
      reason: `Captcha iframe detected (count=${captchaIframeCount}).`,
      requiresManual: true
    };
  }

  const widgetCount = await page.locator(CAPTCHA_WIDGET_SELECTOR).count().catch(() => 0);
  if (widgetCount > 0) {
    return {
      detected: true,
      kind: "captcha",
      reason: `Captcha widget detected (count=${widgetCount}).`,
      requiresManual: true
    };
  }

  return { detected: false };
};

export const hasBlockingDialog = async (page: Page): Promise<boolean> => {
  const count = await page.locator(`${DIALOG_HINT_SELECTORS}:visible`).count().catch(() => 0);
  return count > 0;
};

export const dismissBlockingOverlays = async (page: Page): Promise<string[]> => {
  const dismissed: string[] = [];

  const cookieBannerCount = await page
    .locator(`${COOKIE_BANNER_SELECTORS}:visible`)
    .count()
    .catch(() => 0);
  if (cookieBannerCount > 0) {
    const acceptButtons = page.locator(`${ACCEPT_BUTTON_SELECTORS}:visible`);
    const acceptCount = await acceptButtons.count().catch(() => 0);
    for (let i = 0; i < acceptCount; i += 1) {
      try {
        await acceptButtons.nth(i).click({ timeout: 1_200 });
        dismissed.push(`cookie-accept-${i}`);
        await page.waitForTimeout(120);
      } catch {
        // Best-effort only.
      }
    }
  }

  const closeButtons = page.locator(`${CLOSE_BUTTON_SELECTORS}:visible`);
  const closeCount = await closeButtons.count().catch(() => 0);

  for (let i = 0; i < closeCount; i += 1) {
    const button = closeButtons.nth(i);
    try {
      const closeButtonContext = await button
        .evaluate((element, contextSelector) => {
          const target = element as HTMLElement;
          const dialogRoot = target.closest(contextSelector);
          const dialog = dialogRoot instanceof HTMLElement ? dialogRoot : null;
          return {
            dialogText: dialog?.innerText ?? "",
            dialogIdentity: [
              dialog?.id ?? "",
              dialog?.className ?? "",
              dialog?.getAttribute("aria-label") ?? "",
              target.id ?? "",
              target.className ?? "",
              target.getAttribute("aria-label") ?? ""
            ]
              .filter(Boolean)
              .join(" ")
          };
        }, DIALOG_HINT_SELECTORS)
        .catch(() => null);
      if (
        closeButtonContext &&
        shouldPreserveDialog(
          closeButtonContext.dialogText,
          closeButtonContext.dialogIdentity
        )
      ) {
        continue;
      }
      await button.click({ timeout: 1_200 });
      dismissed.push(`overlay-close-${i}`);
      await page.waitForTimeout(150);
    } catch {
      // Best-effort only.
    }
  }

  return dismissed;
};
