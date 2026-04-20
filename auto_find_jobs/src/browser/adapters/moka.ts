import type { Locator, Page } from "playwright";
import type { CandidateProfile, DiscoveredJob, FillPlan, FormField } from "../../domain/schemas.js";
import { extractFormFields } from "../form-fields.js";
import type { FillProgress, SiteAdapter } from "./types.js";
import { ManualInterventionRequiredError } from "./types.js";

interface MokaPortalCandidate {
  href: string;
  text: string;
  title: string;
  kind: "job_detail" | "job_list";
}

interface NormalizedPortalPreferences {
  targetKeywords: string[];
  preferredLocations: string[];
  excludeKeywords: string[];
  jobTitleHints: string[];
}

const humanPromptPattern =
  /captcha|verify you are human|security check|log in|sign in|email verification|sms verification|手机号登录|邮箱登录|获取验证码|请先登录|登录后继续|短信验证码|邮箱验证码|安全验证|滑块/i;

const normalizeText = (value: string | undefined): string =>
  (value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const normalizeList = (values: string[] | undefined): string[] =>
  (values ?? []).map((value) => normalizeText(value)).filter(Boolean);

const isGenericApplyEntryTitle = (job: DiscoveredJob): boolean => {
  const normalizedTitle = normalizeText(job.title);
  const normalizedCompany = normalizeText(job.company);
  return (
    normalizedTitle.length === 0 ||
    normalizedTitle === `${normalizedCompany} apply entry`.trim() ||
    normalizedTitle.endsWith("apply entry") ||
    normalizedTitle === normalizedCompany
  );
};

const buildPortalPreferences = (
  job: DiscoveredJob,
  profile?: CandidateProfile
): NormalizedPortalPreferences => {
  const jobTitleHints = isGenericApplyEntryTitle(job)
    ? []
    : normalizeList(
        job.title
          .split(/[|,/]+/)
          .map((part) => part.trim())
          .filter((part) => part.length >= 2)
      );

  return {
    targetKeywords: normalizeList(profile?.preferences?.targetKeywords),
    preferredLocations: normalizeList(profile?.preferences?.preferredLocations),
    excludeKeywords: normalizeList(profile?.preferences?.excludeKeywords),
    jobTitleHints
  };
};

const hasPortalPreferences = (preferences: NormalizedPortalPreferences): boolean =>
  preferences.targetKeywords.length > 0 ||
  preferences.preferredLocations.length > 0 ||
  preferences.excludeKeywords.length > 0 ||
  preferences.jobTitleHints.length > 0;

const scorePortalCandidate = (
  candidate: MokaPortalCandidate,
  preferences: NormalizedPortalPreferences
): number => {
  const haystack = normalizeText(`${candidate.title} ${candidate.text}`);
  let score = candidate.kind === "job_detail" ? 3 : 0;

  for (const keyword of preferences.excludeKeywords) {
    if (haystack.includes(keyword)) {
      score -= 100;
    }
  }

  for (const keyword of preferences.targetKeywords) {
    if (haystack.includes(keyword)) {
      score += 40;
    }
  }

  for (const keyword of preferences.jobTitleHints) {
    if (haystack.includes(keyword)) {
      score += 15;
    }
  }

  for (const location of preferences.preferredLocations) {
    if (haystack.includes(location)) {
      score += 10;
    }
  }

  return score;
};

const selectPortalCandidate = (
  candidates: MokaPortalCandidate[],
  preferences: NormalizedPortalPreferences
): MokaPortalCandidate | null => {
  if (candidates.length === 0) {
    return null;
  }
  if (candidates.length === 1) {
    return candidates[0] ?? null;
  }

  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: scorePortalCandidate(candidate, preferences)
    }))
    .sort((left, right) => right.score - left.score);

  const best = scored[0];
  const second = scored[1];

  if (!best) {
    return null;
  }

  if (!hasPortalPreferences(preferences) && best.score <= 3) {
    return null;
  }

  if (best.score < 0) {
    return null;
  }

  if (second && second.score === best.score) {
    return null;
  }

  return best.candidate;
};

const detectHumanPrompt = async (page: Page): Promise<string | undefined> => {
  const bodyText = await page.evaluate(() => document.body.innerText).catch(() => "");
  const match = bodyText?.match(humanPromptPattern);
  return match?.[0];
};

const waitForSettledUi = async (page: Page): Promise<void> => {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(250);
};

const resolveFirstVisible = async (candidates: Locator[]): Promise<Locator | null> => {
  for (const candidate of candidates) {
    const locator = candidate.first();
    if ((await locator.count()) === 0) {
      continue;
    }
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }
  return null;
};

const safeClick = async (locator: Locator): Promise<void> => {
  await locator.scrollIntoViewIfNeeded().catch(() => undefined);
  try {
    await locator.click({ timeout: 2_000 });
    return;
  } catch {
    // fall through
  }

  try {
    await locator.click({ force: true, timeout: 2_000 });
    return;
  } catch {
    // fall through
  }

  await locator.evaluate((node) => {
    if (node instanceof HTMLElement) {
      node.click();
    }
  });
};

const resolveApplyTrigger = async (page: Page): Promise<Locator | null> =>
  resolveFirstVisible([
    page.locator("button:has-text('申请职位')"),
    page.locator("button:has-text('立即申请')"),
    page.locator("button:has-text('投递简历')"),
    page.locator("button:has-text('申请')"),
    page.locator("button:has-text('Apply')"),
    page.locator("button:has-text('Apply now')"),
    page.locator("a:has-text('申请职位')"),
    page.locator("a:has-text('立即申请')"),
    page.locator("a:has-text('Apply')"),
    page.locator("[role='button']:has-text('申请职位')"),
    page.locator("[role='button']:has-text('立即申请')"),
    page.locator("[role='button']:has-text('Apply')")
  ]);

const resolveContinue = async (page: Page): Promise<Locator | null> =>
  resolveFirstVisible([
    page.locator("button:has-text('下一步')"),
    page.locator("button:has-text('继续')"),
    page.locator("button:has-text('Continue')"),
    page.locator("button:has-text('Next')"),
    page.locator("button:has-text('Review')"),
    page.locator("input[type='button'][value='下一步']"),
    page.locator("input[type='button'][value='继续']"),
    page.locator("input[type='submit'][value='继续']"),
    page.locator("input[type='submit'][value='Next']")
  ]);

const resolveSubmit = async (page: Page): Promise<Locator | null> =>
  resolveFirstVisible([
    page.locator("button:has-text('提交申请')"),
    page.locator("button:has-text('确认投递')"),
    page.locator("button:has-text('提交')"),
    page.locator("button:has-text('Submit')"),
    page.locator("button:has-text('Apply')"),
    page.locator("button[type='submit']"),
    page.locator("input[type='submit']"),
    page.locator("input[value='提交申请']"),
    page.locator("input[value='提交']")
  ]);

const fillFieldValue = async (page: Page, field: FormField, value: string): Promise<void> => {
  if (field.type === "radio") {
    await page.locator(`${field.selector}[value="${value.replace(/"/g, '\\"')}"]`).check();
    return;
  }

  const locator = page.locator(field.selector).first();
  switch (field.type) {
    case "select":
      await locator.selectOption(value);
      return;
    case "checkbox":
      if (value === "true") {
        await locator.check();
      } else {
        await locator.uncheck();
      }
      return;
    case "file":
      await locator.setInputFiles(value);
      return;
    default:
      await locator.fill(value);
  }
};

const collectPortalCandidates = async (page: Page): Promise<MokaPortalCandidate[]> =>
  page.evaluate<MokaPortalCandidate[]>(() => {
    const normalize = (value: string | null | undefined): string =>
      (value ?? "").replace(/\s+/g, " ").trim();

    const anchors = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[];
    const seen = new Set<string>();

    const candidates = anchors
      .map((anchor) => {
        const href = anchor.href;
        if (!href || !/mokahr\.com/i.test(href)) {
          return null;
        }

        const kind = /#\/job\//.test(href)
          ? "job_detail"
          : /#\/jobs(?:[/?]|$)|#\/home(?:[/?]|$)|#\/recommendation\//.test(href)
            ? "job_list"
            : null;

        if (!kind) {
          return null;
        }

        const containerText = normalize(anchor.closest("[class]")?.textContent ?? anchor.textContent);
        const title =
          normalize(anchor.textContent) ||
          containerText.split(/(?=[A-Z\u4e00-\u9fff])/).find(Boolean) ||
          containerText;

        return {
          href,
          text: containerText,
          title,
          kind
        } satisfies MokaPortalCandidate;
      })
      .filter((candidate): candidate is MokaPortalCandidate => Boolean(candidate))
      .filter((candidate) => {
        if (seen.has(candidate.href)) {
          return false;
        }
        seen.add(candidate.href);
        return true;
      });

    return candidates;
  });

const navigateIntoPortal = async (
  page: Page,
  job: DiscoveredJob,
  profile?: CandidateProfile
): Promise<void> => {
  const preferences = buildPortalPreferences(job, profile);

  for (let round = 0; round < 3; round += 1) {
    if (/#\/job\//.test(page.url())) {
      return;
    }

    const candidates = await collectPortalCandidates(page);
    const detailCandidates = candidates.filter((candidate) => candidate.kind === "job_detail");
    const routeCandidates = candidates.filter((candidate) => candidate.kind === "job_list");

    if (detailCandidates.length > 0) {
      const nextCandidate = selectPortalCandidate(detailCandidates, preferences);
      if (!nextCandidate) {
        throw new ManualInterventionRequiredError(
          "Moka 入口页里包含多个岗位，暂时无法自动判断目标岗位。请先在资料中心补充目标岗位关键词/地点偏好，或在弹出的浏览器里手动进入目标岗位详情页后再继续。"
        );
      }
      await page.goto(nextCandidate.href, { waitUntil: "domcontentloaded" });
      await waitForSettledUi(page);
      continue;
    }

    if (routeCandidates.length > 0) {
      const nextCandidate = selectPortalCandidate(routeCandidates, preferences);
      if (!nextCandidate) {
        throw new ManualInterventionRequiredError(
          "Moka 入口页里包含多个岗位分类，暂时无法自动判断该进入哪个职位池。请先在资料中心补充目标岗位关键词/地点偏好，或在弹出的浏览器里手动打开目标岗位列表后再继续。"
        );
      }
      await page.goto(nextCandidate.href, { waitUntil: "domcontentloaded" });
      await waitForSettledUi(page);
      continue;
    }

    return;
  }
};

export class MokaAdapter implements SiteAdapter {
  readonly kind = "moka" as const;

  async detect(page: Page): Promise<boolean> {
    return /mokahr\.com/i.test(page.url());
  }

  async openApply(page: Page, job: DiscoveredJob, profile?: CandidateProfile): Promise<void> {
    await page.goto(job.applyUrl, { waitUntil: "domcontentloaded" });
    await waitForSettledUi(page);
    await navigateIntoPortal(page, job, profile);

    if (await detectHumanPrompt(page)) {
      return;
    }

    if ((await extractFormFields(page)).length > 0) {
      return;
    }

    const applyTrigger = await resolveApplyTrigger(page);
    if (!applyTrigger) {
      if (/#\/job\//.test(page.url())) {
        throw new ManualInterventionRequiredError(
          "已经进入 Moka 岗位详情页，但还没有进入申请表。请先在弹出的浏览器里手动点击“申请职位”后再继续。"
        );
      }
      return;
    }

    await safeClick(applyTrigger);
    await waitForSettledUi(page);
  }

  async extractFields(page: Page): Promise<FormField[]> {
    const prompt = await detectHumanPrompt(page);
    if (prompt) {
      throw new ManualInterventionRequiredError(
        `Moka 页面需要先完成人工步骤：${prompt}。请先在浏览器里登录/完成验证，再继续。`
      );
    }

    const fields = await extractFormFields(page);
    if (fields.length === 0) {
      const applyTrigger = await resolveApplyTrigger(page);
      if (applyTrigger) {
        throw new ManualInterventionRequiredError(
          "Moka 页面还停留在岗位详情或入口层，请先在浏览器里确认岗位并进入申请表。"
        );
      }
    }

    return fields;
  }

  async fill(
    page: Page,
    fillPlan: FillPlan,
    fields: FormField[],
    startIndex: number,
    onStep?: (message: string) => Promise<void>
  ): Promise<FillProgress> {
    if (fields.length === 0) {
      return {
        nextDecisionIndex: startIndex,
        state: "manual",
        manualPrompt: "Moka 页面上还没有可填写的申请表，请先在浏览器里完成登录或进入申请表。"
      };
    }

    const fieldLookup = new Map(fields.map((field) => [field.fieldId, field]));
    const pageFieldIds = new Set(fields.map((field) => field.fieldId));

    for (let index = startIndex; index < fillPlan.decisions.length; index += 1) {
      const decision = fillPlan.decisions[index];
      if (!decision || !pageFieldIds.has(decision.fieldId)) {
        continue;
      }

      const prompt = await detectHumanPrompt(page);
      if (prompt) {
        return {
          nextDecisionIndex: index,
          state: "manual",
          manualPrompt: `Moka 页面需要先完成人工步骤：${prompt}`
        };
      }

      const field = fieldLookup.get(decision.fieldId);
      if (!field) {
        continue;
      }

      await fillFieldValue(page, field, decision.value);
      await onStep?.(`已填写：${field.label}`);
    }

    const prompt = await detectHumanPrompt(page);
    if (prompt) {
      return {
        nextDecisionIndex: fillPlan.decisions.length,
        state: "manual",
        manualPrompt: `Moka 页面需要先完成人工步骤：${prompt}`
      };
    }

    const continueButton = await resolveContinue(page);
    if (continueButton) {
      await safeClick(continueButton);
      await waitForSettledUi(page);

      const nextPrompt = await detectHumanPrompt(page);
      if (nextPrompt) {
        return {
          nextDecisionIndex: fillPlan.decisions.length,
          state: "manual",
          manualPrompt: `Moka 页面需要先完成人工步骤：${nextPrompt}`
        };
      }

      return {
        nextDecisionIndex: fillPlan.decisions.length,
        state: "advanced",
        newFields: await extractFormFields(page)
      };
    }

    const submitButton = await resolveSubmit(page);
    if (submitButton) {
      return {
        nextDecisionIndex: fillPlan.decisions.length,
        state: "completed"
      };
    }

    return {
      nextDecisionIndex: fillPlan.decisions.length,
      state: "completed"
    };
  }

  async submit(page: Page): Promise<{ confirmed: boolean; message: string }> {
    const button = await resolveSubmit(page);
    if (!button) {
      return {
        confirmed: false,
        message: "在 Moka 页面上没有找到可见的提交按钮。"
      };
    }

    await safeClick(button);
    await waitForSettledUi(page);

    const confirmedText = await page.locator("body").textContent().catch(() => "");
    const confirmed = /thank you|application submitted|we have received|投递成功|申请已提交|已收到你的申请/i.test(
      confirmedText ?? ""
    );
    return {
      confirmed,
      message: confirmed
        ? "Moka 申请已提交。"
        : "已点击 Moka 提交按钮，请确认页面是否真正投递成功。"
    };
  }
}

export const mokaAdapterUtils = {
  buildPortalPreferences,
  hasPortalPreferences,
  scorePortalCandidate,
  selectPortalCandidate
};
