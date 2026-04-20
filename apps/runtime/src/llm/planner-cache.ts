import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  LLMDecision,
  PageSnapshot,
  RunConfig,
  RunWorkingMemory
} from "@qpilot/shared";

interface PlannerCacheEntry {
  cacheKey: string;
  createdAt: string;
  decision: LLMDecision;
  raw: string;
  promptPayload: string;
}

interface PlannerCacheInput {
  snapshot: PageSnapshot;
  runConfig: RunConfig;
  stepIndex: number;
  lastObservation?: string;
  workingMemory?: RunWorkingMemory;
  seedPrompt: string;
}

const normalize = (value: string | undefined): string =>
  (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

const snapshotSignature = (snapshot: PageSnapshot): string =>
  JSON.stringify({
    url: snapshot.url,
    title: snapshot.title,
    pageState: snapshot.pageState,
    elements: snapshot.elements.slice(0, 48).map((element) => ({
      selector: element.selector,
      text: normalize(element.text),
      ariaLabel: normalize(element.ariaLabel),
      placeholder: normalize(element.placeholder),
      contextType: element.contextType,
      contextLabel: normalize(element.contextLabel),
      framePath: element.framePath,
      type: element.type
    }))
  });

const workingMemorySignature = (memory: RunWorkingMemory | undefined): string =>
  JSON.stringify(memory ?? null);

export class PlannerCache {
  constructor(private readonly cacheRoot: string) {}

  private buildCacheKey(input: PlannerCacheInput): string {
    const payload = JSON.stringify({
      version: 4,
      model: input.runConfig.model ?? null,
      goal: normalize(input.runConfig.goal),
      mode: input.runConfig.mode,
      language: input.runConfig.language,
      targetUrl: normalize(input.runConfig.targetUrl),
      stepIndex: input.stepIndex,
      lastObservation: normalize(input.lastObservation),
      workingMemory: workingMemorySignature(input.workingMemory),
      seedPrompt: normalize(input.seedPrompt),
      snapshot: snapshotSignature(input.snapshot)
    });

    return createHash("sha256").update(payload).digest("hex");
  }

  private resolvePath(cacheKey: string): string {
    return resolve(this.cacheRoot, `${cacheKey}.json`);
  }

  async get(input: PlannerCacheInput): Promise<PlannerCacheEntry | null> {
    const cacheKey = this.buildCacheKey(input);
    try {
      const raw = await readFile(this.resolvePath(cacheKey), "utf8");
      const parsed = JSON.parse(raw) as PlannerCacheEntry;
      if (!parsed?.decision || !parsed.promptPayload || !parsed.raw) {
        return null;
      }
      return {
        ...parsed,
        cacheKey
      };
    } catch {
      return null;
    }
  }

  async set(input: PlannerCacheInput, entry: Omit<PlannerCacheEntry, "cacheKey" | "createdAt">): Promise<string> {
    const cacheKey = this.buildCacheKey(input);
    await mkdir(this.cacheRoot, { recursive: true });
    await writeFile(
      this.resolvePath(cacheKey),
      JSON.stringify(
        {
          cacheKey,
          createdAt: new Date().toISOString(),
          decision: entry.decision,
          raw: entry.raw,
          promptPayload: entry.promptPayload
        },
        null,
        2
      ),
      "utf8"
    );
    return cacheKey;
  }
}
