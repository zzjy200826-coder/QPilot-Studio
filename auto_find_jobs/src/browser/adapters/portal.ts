import type { Locator, Page } from "playwright";
import type { CandidateProfile, DiscoveredJob, FillPlan, FormField } from "../../domain/schemas.js";
import { extractFormFields } from "../form-fields.js";
import type { FillProgress, SiteAdapter } from "./types.js";
import { ManualInterventionRequiredError } from "./types.js";

const humanPromptPattern =
  /captcha|verify you are human|security check|log in|sign in|email verification|sms verification|登录|注册|验证|验证码|安全校验/i;

const waitForSettledUi = async (page: Page): Promise<void> => {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(250);
};

const detectHumanPrompt = async (page: Page): Promise<string | undefined> => {
  const bodyText = await page.evaluate(() => document.body.innerText).catch(() => "");
  const match = bodyText?.match(humanPromptPattern);
  return match?.[0];
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
    page.locator("button:has-text('立即申请')"),
    page.locator("button:has-text('申请职位')"),
    page.locator("button:has-text('立即投递')"),
    page.locator("button:has-text('投递')"),
    page.locator("button:has-text('申请')"),
    page.locator("button:has-text('Apply now')"),
    page.locator("button:has-text('Apply')"),
    page.locator("a:has-text('立即申请')"),
    page.locator("a:has-text('申请职位')"),
    page.locator("a:has-text('立即投递')"),
    page.locator("a:has-text('投递')"),
    page.locator("a:has-text('Apply now')"),
    page.locator("a:has-text('Apply')"),
    page.locator("[role='button']:has-text('立即申请')"),
    page.locator("[role='button']:has-text('申请职位')"),
    page.locator("[role='button']:has-text('立即投递')"),
    page.locator("[role='button']:has-text('投递')"),
    page.locator("[role='button']:has-text('Apply')"),
    page.locator("input[type='button'][value='立即申请']"),
    page.locator("input[type='button'][value='申请职位']"),
    page.locator("input[type='button'][value='Apply']"),
    page.locator("input[type='submit'][value='立即申请']"),
    page.locator("input[type='submit'][value='申请职位']"),
    page.locator("input[type='submit'][value='Apply']")
  ]);

const resolveContinue = async (page: Page): Promise<Locator | null> =>
  resolveFirstVisible([
    page.locator("button:has-text('下一步')"),
    page.locator("button:has-text('继续')"),
    page.locator("button:has-text('确认并继续')"),
    page.locator("button:has-text('Continue')"),
    page.locator("button:has-text('Next')"),
    page.locator("button:has-text('Review')"),
    page.locator("input[type='button'][value='下一步']"),
    page.locator("input[type='button'][value='继续']"),
    page.locator("input[type='submit'][value='下一步']"),
    page.locator("input[type='submit'][value='继续']"),
    page.locator("input[type='submit'][value='Continue']"),
    page.locator("input[type='submit'][value='Next']")
  ]);

const resolveSubmit = async (page: Page): Promise<Locator | null> =>
  resolveFirstVisible([
    page.locator("button:has-text('提交申请')"),
    page.locator("button:has-text('确认投递')"),
    page.locator("button:has-text('提交')"),
    page.locator("button:has-text('Apply')"),
    page.locator("button:has-text('Submit')"),
    page.locator("button[type='submit']"),
    page.locator("input[type='submit']"),
    page.locator("input[value='提交申请']"),
    page.locator("input[value='提交']"),
    page.locator("input[value='Apply']"),
    page.locator("input[value='Submit']")
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

const extractOrPrompt = async (page: Page): Promise<FormField[]> => {
  const fields = await extractFormFields(page);
  if (fields.length > 0) {
    return fields;
  }

  const prompt = await detectHumanPrompt(page);
  if (prompt) {
    throw new ManualInterventionRequiredError(
      `当前页面需要先完成人工步骤：${prompt}。请先在浏览器里登录、验证或进入真实申请表，再回来继续。`
    );
  }

  throw new ManualInterventionRequiredError(
    "当前还停留在职位入口页或岗位详情页。请先在可见浏览器里选中目标岗位，并点击“申请 / 投递 / Apply”，进入真实申请表后再继续。"
  );
};

export class PortalAdapter implements SiteAdapter {
  readonly kind = "portal" as const;

  async detect(_page: Page): Promise<boolean> {
    return true;
  }

  async openApply(page: Page, job: DiscoveredJob, _profile?: CandidateProfile): Promise<void> {
    await page.goto(job.applyUrl, { waitUntil: "domcontentloaded" });
    await waitForSettledUi(page);

    if ((await extractFormFields(page)).length > 0) {
      return;
    }

    const applyTrigger = await resolveApplyTrigger(page);
    if (!applyTrigger) {
      return;
    }

    await safeClick(applyTrigger);
    await waitForSettledUi(page);
  }

  async extractFields(page: Page): Promise<FormField[]> {
    const initialFields = await extractFormFields(page);
    if (initialFields.length > 0) {
      return initialFields;
    }

    const applyTrigger = await resolveApplyTrigger(page);
    if (applyTrigger) {
      await safeClick(applyTrigger);
      await waitForSettledUi(page);
    }

    return extractOrPrompt(page);
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
        manualPrompt:
          "当前页面上还没有可填写的申请表。请先在浏览器里进入具体岗位申请表，然后再继续。"
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
          manualPrompt: `当前页面需要先完成人工步骤：${prompt}`
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
        manualPrompt: `当前页面需要先完成人工步骤：${prompt}`
      };
    }

    const continueButton = await resolveContinue(page);
    if (continueButton) {
      await safeClick(continueButton);
      await waitForSettledUi(page);

      const followUpPrompt = await detectHumanPrompt(page);
      if (followUpPrompt) {
        return {
          nextDecisionIndex: fillPlan.decisions.length,
          state: "manual",
          manualPrompt: `当前页面需要先完成人工步骤：${followUpPrompt}`
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
        message: "当前页面上没有找到可见的提交按钮。"
      };
    }

    await safeClick(button);
    await waitForSettledUi(page);

    const confirmedText = await page.locator("body").textContent().catch(() => "");
    const fieldsAfterSubmit = await extractFormFields(page).catch(() => []);
    const submitButtonAfterSubmit = await resolveSubmit(page);
    const confirmed =
      /thank you|application submitted|we have received|投递成功|申请已提交|已收到你的申请/i.test(
        confirmedText ?? ""
      ) ||
      (fieldsAfterSubmit.length === 0 && !submitButtonAfterSubmit);

    return {
      confirmed,
      message: confirmed
        ? "申请已提交。"
        : "已经点击提交按钮，请检查页面确认是否真正投递成功。"
    };
  }
}
