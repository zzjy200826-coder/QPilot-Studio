import type { Locator, Page } from "playwright";
import type { CandidateProfile, DiscoveredJob, FillPlan, FormField } from "../../domain/schemas.js";
import { extractFormFields } from "../form-fields.js";
import type { FillProgress, SiteAdapter } from "./types.js";

const humanPromptPattern =
  /captcha|verify you are human|security check|log in|sign in|email verification|sms verification/i;

const detectHumanPrompt = async (page: Page): Promise<string | undefined> => {
  const bodyText = await page.evaluate(() => document.body.innerText).catch(() => "");
  const match = bodyText?.match(humanPromptPattern);
  return match?.[0];
};

const waitForSettledUi = async (page: Page): Promise<void> => {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(150);
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

const resolveContinue = async (page: Page): Promise<Locator | null> =>
  resolveFirstVisible([
    page.locator("button:has-text('Next')"),
    page.locator("button:has-text('Continue')"),
    page.locator("button:has-text('Review')"),
    page.locator("input[type='button'][value='Next']"),
    page.locator("input[type='submit'][value='Next']"),
    page.locator("input[type='submit'][value='Continue']")
  ]);

const resolveSubmit = async (page: Page): Promise<Locator | null> =>
  resolveFirstVisible([
    page.locator("button[type='submit']"),
    page.locator("input[type='submit']"),
    page.locator("button:has-text('Submit application')"),
    page.locator("button:has-text('Send Application')"),
    page.locator("button:has-text('Apply')")
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

export class LeverAdapter implements SiteAdapter {
  readonly kind = "lever" as const;

  async detect(page: Page): Promise<boolean> {
    const url = page.url().toLowerCase();
    return url.includes("lever.co");
  }

  async openApply(page: Page, job: DiscoveredJob, _profile?: CandidateProfile): Promise<void> {
    await page.goto(job.applyUrl, { waitUntil: "domcontentloaded" });
  }

  async extractFields(page: Page): Promise<FormField[]> {
    return extractFormFields(page);
  }

  async fill(
    page: Page,
    fillPlan: FillPlan,
    fields: FormField[],
    startIndex: number,
    onStep?: (message: string) => Promise<void>
  ): Promise<FillProgress> {
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
          manualPrompt: `需要人工处理：${prompt}`
        };
      }

      const field = fieldLookup.get(decision.fieldId);
      if (!field) {
        continue;
      }

      await fillFieldValue(page, field, decision.value);
      await onStep?.(`已填写：${field.label}`);
    }

    let prompt = await detectHumanPrompt(page);
    if (prompt && startIndex >= fillPlan.decisions.length) {
      await page.waitForTimeout(1600);
      prompt = await detectHumanPrompt(page);
    }

    if (prompt) {
      return {
        nextDecisionIndex: fillPlan.decisions.length,
        state: "manual",
        manualPrompt: `需要人工处理：${prompt}`
      };
    }

    const continueButton = await resolveContinue(page);
    if (continueButton) {
      await continueButton.click();
      await waitForSettledUi(page);
      await onStep?.("已进入 Lever 下一步。");

      const followUpPrompt = await detectHumanPrompt(page);
      if (followUpPrompt) {
        return {
          nextDecisionIndex: fillPlan.decisions.length,
          state: "manual",
          manualPrompt: `需要人工处理：${followUpPrompt}`
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
        message: "在 Lever 页面上未找到可见的提交按钮。"
      };
    }

    await button.click();
    await waitForSettledUi(page);

    const confirmedText = await page.locator("body").textContent().catch(() => "");
    const confirmed = /thank you|application submitted|we have received/i.test(confirmedText ?? "");
    return {
      confirmed,
      message: confirmed ? "Lever 申请已提交。" : "已点击提交，请确认页面是否真正投递成功。"
    };
  }
}
