import type { Page } from "playwright";
import type { CandidateProfile, DiscoveredJob, FillPlan, FormField } from "../../domain/schemas.js";

export class ManualInterventionRequiredError extends Error {
  constructor(readonly prompt: string) {
    super(prompt);
    this.name = "ManualInterventionRequiredError";
  }
}

export interface FillProgress {
  nextDecisionIndex: number;
  state: "completed" | "manual" | "advanced";
  manualPrompt?: string;
  newFields?: FormField[];
}

export interface SiteAdapter {
  readonly kind: "greenhouse" | "lever" | "moka" | "portal";
  detect(page: Page): Promise<boolean>;
  openApply(page: Page, job: DiscoveredJob, profile?: CandidateProfile): Promise<void>;
  extractFields(page: Page): Promise<FormField[]>;
  fill(
    page: Page,
    fillPlan: FillPlan,
    fields: FormField[],
    startIndex: number,
    onStep?: (message: string, screenshotPath?: string) => Promise<void>
  ): Promise<FillProgress>;
  submit(page: Page): Promise<{ confirmed: boolean; message: string }>;
}
