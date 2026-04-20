import { OpenAICompatibleClient } from "@qpilot/ai-gateway";
import { seedPrompts } from "@qpilot/prompt-packs";
import {
  type LLMDecision,
  LLMDecisionSchema,
  type PageSnapshot,
  type RunConfig,
  type RunWorkingMemory
} from "@qpilot/shared";
import type { PlannerCache } from "./planner-cache.js";

export interface PlannerInput {
  snapshot: PageSnapshot;
  runConfig: RunConfig;
  stepIndex: number;
  seedPrompt: string;
  lastObservation?: string;
  workingMemory?: RunWorkingMemory;
}

export class LLMValidationError extends Error {
  constructor(
    message: string,
    public readonly firstResponse: string,
    public readonly secondResponse?: string
  ) {
    super(message);
  }
}

const extractJsonPayload = (raw: string): string => {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1);
  }
  return raw;
};

const systemPrompt = `You are QPilot Studio planner.
Return strictly valid JSON with this shape:
{
  "goal": string,
  "page_assessment": { "page_type": string, "risk_level": string, "key_elements": string[] },
  "plan": { "strategy": string, "reason": string },
  "actions": [{ "type": "click|input|select|navigate|wait", "target"?: string, "value"?: string, "ms"?: number, "note"?: string }],
  "expected_checks": string[],
  "test_case_candidate": { "generate": boolean, "module"?: string, "title"?: string, "preconditions"?: string, "expected"?: string, "priority"?: string, "method"?: string },
  "is_finished": boolean
}
Never return markdown or commentary.
Keep JSON keys in English, but write all human-readable string values in the requested responseLanguage.`;

const plannerQualityHints = `Rules:
- "expected_checks" MUST be short literal UI text snippets or concise keywords likely to appear in page text.
- Avoid abstract assertion sentences in "expected_checks".
- Prefer visible and actionable selectors.`;
const plannerNavigationHints = `Additional constraints:
- If the goal is to log into or open another website, a search result page does NOT count as success just because it contains matching keywords.
- If the goal starts on a search engine and asks to find a target website before logging in, preserve that order: search first, open the real target site, then start the target site's login flow.
- Preserve the concrete entities from the user goal, especially product names, site names, brands, and account targets. Do NOT replace them with a different popular site, app, or example.
- While the current URL is still on the source search host, do NOT click the search engine's own account, login, or provider-auth controls unless the goal explicitly asks to log into that search engine itself.
- Treat QQ login, WeChat login, OAuth provider entry, and account/password submission as downstream subgoals that are only valid after the browser has already left the source search host or clearly entered the target business domain.
- When choosing a result link from a list, prefer the most specific selector you can infer and include the exact visible target text inside "note".
- If the goal mentions QQ login or WeChat login and the page already exposes provider-specific icons/buttons, choose the provider-specific selector directly instead of repeatedly clicking a generic login container.
- Treat modal dialogs, provider choosers, and iframe login forms as high-priority surfaces. If pageState or element context indicates a modal or iframe login form, target those elements first.
- Prefer action notes that explain the concrete intent of the current action, such as "open login chooser", "click QQ login icon", or "wait for account/password form".
- On search result pages, avoid class-only link selectors when multiple results may share the same class. Include the exact visible result text in quotes so the executor can disambiguate the click.
- On search result pages, avoid search-refinement or suggestion links such as result cards for "wiki", "图鉴", "入口网址", "下载", "4399", "wegame", or generic recommendation widgets. Prefer the result whose visible text/snippet most strongly indicates the real business site or publisher landing page.
- If the previous observation mentions diagnosis=no_effect, diagnosis=wrong_target, diagnosis=locator_miss, or diagnosis=api_mismatch, do NOT immediately repeat the same target. Prefer a different visible selector, a one-step probe, or stop for manual review.
- Do NOT queue follow-up actions that assume a modal, iframe, or provider chooser will appear unless the current snapshot already shows that surface. When uncertain, click the trigger, optionally wait once, then let the next planning cycle re-evaluate.
- Do not mark "is_finished" true until the run reaches the real destination surface, such as the target host, the real login form, or the authenticated landing page.
- Prefer the structured "workingMemory" field over loosely phrased observations when both are present.`;

const modeSeedPrompt = (mode: RunConfig["mode"]): string => {
  switch (mode) {
    case "login":
      return seedPrompts.loginPage;
    case "admin":
      return seedPrompts.adminConsole;
    case "general":
    default:
      return seedPrompts.genericForm;
  }
};

export class Planner {
  constructor(
    private readonly client: OpenAICompatibleClient,
    private readonly cache?: PlannerCache
  ) {}

  async plan(input: PlannerInput): Promise<{
    decision: LLMDecision;
    raw: string;
    promptPayload: string;
    cacheHit: boolean;
    cacheKey?: string;
  }> {
    const prompt = JSON.stringify(
      {
        goal: input.runConfig.goal,
        stepIndex: input.stepIndex,
        targetUrl: input.runConfig.targetUrl,
        mode: input.runConfig.mode,
        responseLanguage: input.runConfig.language,
        seedPrompt: input.seedPrompt,
        modePrompt: modeSeedPrompt(input.runConfig.mode),
        lastObservation: input.lastObservation ?? null,
        workingMemory: input.workingMemory ?? null,
        page: {
          url: input.snapshot.url,
          title: input.snapshot.title,
          pageState: input.snapshot.pageState ?? null,
          elements: input.snapshot.elements.slice(0, 60)
        }
      },
      null,
      2
    );

    const cacheInput = {
      snapshot: input.snapshot,
      runConfig: input.runConfig,
      stepIndex: input.stepIndex,
      lastObservation: input.lastObservation,
      workingMemory: input.workingMemory,
      seedPrompt: input.seedPrompt
    };

    const cached = await this.cache?.get(cacheInput);
    if (cached) {
      return {
        decision: cached.decision,
        raw: cached.raw,
        promptPayload: cached.promptPayload,
        cacheHit: true,
        cacheKey: cached.cacheKey
      };
    }

    const firstRaw = await this.client.createChatCompletion([
      { role: "system", content: `${systemPrompt}\n\n${plannerQualityHints}\n${plannerNavigationHints}` },
      { role: "user", content: prompt }
    ]);

    try {
      const firstParsed = LLMDecisionSchema.parse(
        JSON.parse(extractJsonPayload(firstRaw))
      );
      const cacheKey = await this.cache?.set(cacheInput, {
        decision: firstParsed,
        raw: firstRaw,
        promptPayload: prompt
      });
      return {
        decision: firstParsed,
        raw: firstRaw,
        promptPayload: prompt,
        cacheHit: false,
        cacheKey
      };
    } catch (firstError) {
      const retryRaw = await this.client.createChatCompletion([
        { role: "system", content: `${systemPrompt}\n\n${plannerQualityHints}\n${plannerNavigationHints}` },
        { role: "user", content: prompt },
        {
          role: "user",
          content: `Your previous response failed schema validation.
Validation error: ${
            firstError instanceof Error ? firstError.message : "unknown validation error"
          }
Return corrected JSON only.`
        }
      ]);

      try {
        const secondParsed = LLMDecisionSchema.parse(
          JSON.parse(extractJsonPayload(retryRaw))
        );
        const cacheKey = await this.cache?.set(cacheInput, {
          decision: secondParsed,
          raw: retryRaw,
          promptPayload: prompt
        });
        return {
          decision: secondParsed,
          raw: retryRaw,
          promptPayload: prompt,
          cacheHit: false,
          cacheKey
        };
      } catch (secondError) {
        throw new LLMValidationError(
          `LLM output invalid after one retry: ${
            secondError instanceof Error ? secondError.message : "unknown"
          }`,
          firstRaw,
          retryRaw
        );
      }
    }
  }
}
