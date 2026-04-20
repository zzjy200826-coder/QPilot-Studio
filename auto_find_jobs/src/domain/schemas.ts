import { z } from "zod";

export const CandidateEducationSchema = z.object({
  school: z.string().trim().default(""),
  degree: z.string().trim().default(""),
  major: z.string().trim().optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
  gpa: z.string().trim().optional()
});

export const CandidateExperienceSchema = z.object({
  company: z.string().trim().default(""),
  title: z.string().trim().default(""),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
  summary: z.string().trim().default("")
});

export const CandidateFilesSchema = z.object({
  resumePath: z.string().trim().default(""),
  coverLetterPath: z.string().trim().optional(),
  transcriptPath: z.string().trim().optional(),
  otherFiles: z
    .array(
      z.object({
        label: z.string().trim().default("Attachment"),
        path: z.string().trim().default("")
      })
    )
    .default([])
});

export const CandidateAnswersSchema = z.object({
  workAuthorization: z.string().trim().optional(),
  sponsorship: z.string().trim().optional(),
  gender: z.string().trim().optional(),
  race: z.string().trim().optional(),
  veteran: z.string().trim().optional(),
  disability: z.string().trim().optional(),
  expectedSalary: z.string().trim().optional(),
  startDate: z.string().trim().optional(),
  relocation: z.string().trim().optional()
});

export const CandidatePreferencesSchema = z.object({
  targetKeywords: z.array(z.string().trim().min(1)).default([]),
  preferredLocations: z.array(z.string().trim().min(1)).default([]),
  excludeKeywords: z.array(z.string().trim().min(1)).default([])
});

export const CandidateProfileSchema = z.object({
  id: z.string().default("default"),
  basic: z.object({
    firstName: z.string().trim().default(""),
    lastName: z.string().trim().default(""),
    email: z.string().trim().default(""),
    phone: z.string().trim().default(""),
    city: z.string().trim().default(""),
    country: z.string().trim().default(""),
    linkedin: z.string().trim().optional(),
    github: z.string().trim().optional(),
    portfolio: z.string().trim().optional()
  }),
  education: z.array(CandidateEducationSchema).default([]),
  experience: z.array(CandidateExperienceSchema).default([]),
  preferences: CandidatePreferencesSchema.default({}),
  answers: CandidateAnswersSchema.default({}),
  files: CandidateFilesSchema.default({
    resumePath: "",
    otherFiles: []
  })
});

export const AnswerLibraryItemSchema = z.object({
  id: z.string(),
  label: z.string().trim().min(1),
  questionKey: z.string().trim().min(1),
  answer: z.string().trim().min(1),
  synonyms: z.array(z.string().trim().min(1)).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const JobSourceKindSchema = z.enum(["greenhouse", "lever", "generic", "feishu_sheet"]);

export const JobSourceSchema = z.object({
  id: z.string(),
  label: z.string().trim().min(1),
  seedUrl: z.string().url(),
  kind: JobSourceKindSchema,
  enabled: z.boolean().default(true),
  lastScanAt: z.string().optional(),
  lastScanError: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const JobRecordStatusSchema = z.enum(["new", "seen", "applied", "skipped"]);
export const AtsKindSchema = z.enum(["greenhouse", "lever", "moka", "portal", "jsonld"]);

export const DiscoveredJobSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  fingerprint: z.string(),
  externalJobId: z.string().optional(),
  ats: AtsKindSchema,
  company: z.string().trim().min(1),
  title: z.string().trim().min(1),
  location: z.string().trim().default("远程 / 未注明"),
  applyUrl: z.string().url(),
  hostedUrl: z.string().url().optional(),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  sourceSeedUrl: z.string().url(),
  postedAt: z.string().optional(),
  remoteUpdatedAt: z.string().optional(),
  status: JobRecordStatusSchema.default("new"),
  discoveredAt: z.string(),
  updatedAt: z.string()
});

export const FormFieldOptionSchema = z.object({
  label: z.string(),
  value: z.string()
});

export const FormFieldTypeSchema = z.enum([
  "text",
  "email",
  "tel",
  "url",
  "textarea",
  "select",
  "radio",
  "checkbox",
  "file",
  "date",
  "number",
  "hidden",
  "unknown"
]);

export const FormFieldSchema = z.object({
  fieldId: z.string(),
  selector: z.string(),
  label: z.string(),
  name: z.string().optional(),
  placeholder: z.string().optional(),
  section: z.string().optional(),
  type: FormFieldTypeSchema,
  required: z.boolean().default(false),
  options: z.array(FormFieldOptionSchema).default([])
});

export const FillDecisionSourceSchema = z.enum(["profile", "answer_library", "llm", "manual"]);

export const FillDecisionSchema = z.object({
  fieldId: z.string(),
  value: z.string(),
  sourceKey: z.string().optional(),
  sourceType: FillDecisionSourceSchema,
  confidence: z.number().min(0).max(1),
  needsHumanReview: z.boolean().default(false),
  reason: z.string().optional()
});

export const ReviewItemSchema = z.object({
  fieldId: z.string(),
  label: z.string(),
  section: z.string().optional(),
  type: FormFieldTypeSchema,
  options: z.array(FormFieldOptionSchema).default([]),
  suggestedValue: z.string().optional(),
  questionKey: z.string().optional(),
  confidence: z.number().min(0).max(1).default(0),
  reason: z.string().default("Manual confirmation required.")
});

export const FillPlanSchema = z.object({
  decisions: z.array(FillDecisionSchema).default([]),
  reviewItems: z.array(ReviewItemSchema).default([]),
  requiresSubmitConfirmation: z.boolean().default(true),
  generatedAt: z.string()
});

export const ApplicationAttemptOriginSchema = z.enum(["discovered", "direct_url"]);
export const ApplicationSubmissionModeSchema = z.enum(["submit_enabled", "prefill_only"]);
export const ApplicationAutomationModeSchema = z.enum(["manual", "safe_auto_apply"]);

export const ApplicationAutomationDecisionSchema = z.object({
  checkedAt: z.string(),
  eligible: z.boolean(),
  reason: z.string()
});

export const ApplicationAttemptSettingsSchema = z.object({
  origin: ApplicationAttemptOriginSchema.default("discovered"),
  submissionMode: ApplicationSubmissionModeSchema.default("submit_enabled"),
  liveTargetUrl: z.string().url().optional(),
  automationMode: ApplicationAutomationModeSchema.default("manual"),
  manualInterventionOccurred: z.boolean().default(false),
  automationDecision: ApplicationAutomationDecisionSchema.optional()
});

export const JobSnapshotSchema = z.object({
  jobId: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  applyUrl: z.string().url(),
  ats: AtsKindSchema
});

export const ApplicationAttemptStatusSchema = z.enum([
  "queued",
  "preparing",
  "awaiting_review",
  "ready_to_fill",
  "filling",
  "awaiting_manual",
  "prefill_completed",
  "awaiting_submit_confirmation",
  "submitting",
  "submitted",
  "failed",
  "aborted"
]);

export const ApplicationAttemptSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  jobSnapshot: JobSnapshotSchema,
  status: ApplicationAttemptStatusSchema,
  settings: ApplicationAttemptSettingsSchema.default({
    origin: "discovered",
    submissionMode: "submit_enabled"
  }),
  adapterKind: AtsKindSchema.optional(),
  formFields: z.array(FormFieldSchema).default([]),
  fillPlan: FillPlanSchema.optional(),
  currentScreenshotPath: z.string().optional(),
  errorMessage: z.string().optional(),
  manualPrompt: z.string().optional(),
  submitGateMessage: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional()
});

export const ApplicationEventTypeSchema = z.enum([
  "status",
  "discovery",
  "review",
  "fill",
  "manual",
  "submit",
  "error"
]);

export const ApplicationEventSchema = z.object({
  id: z.string(),
  attemptId: z.string(),
  type: ApplicationEventTypeSchema,
  message: z.string(),
  payload: z.record(z.string(), z.unknown()).default({}),
  screenshotPath: z.string().optional(),
  createdAt: z.string()
});

export const ReviewResolutionSchema = z.object({
  fieldId: z.string(),
  value: z.string().trim().default("")
});

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  activeAttemptId: z.string().optional(),
  llmConfigured: z.boolean(),
  llmModel: z.string().optional()
});

export type AnswerLibraryItem = z.infer<typeof AnswerLibraryItemSchema>;
export type ApplicationAttempt = z.infer<typeof ApplicationAttemptSchema>;
export type ApplicationEvent = z.infer<typeof ApplicationEventSchema>;
export type ApplicationAttemptSettings = z.infer<typeof ApplicationAttemptSettingsSchema>;
export type ApplicationAutomationDecision = z.infer<typeof ApplicationAutomationDecisionSchema>;
export type CandidateProfile = z.infer<typeof CandidateProfileSchema>;
export type DiscoveredJob = z.infer<typeof DiscoveredJobSchema>;
export type FillDecision = z.infer<typeof FillDecisionSchema>;
export type FillPlan = z.infer<typeof FillPlanSchema>;
export type FormField = z.infer<typeof FormFieldSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type JobSnapshot = z.infer<typeof JobSnapshotSchema>;
export type JobSource = z.infer<typeof JobSourceSchema>;
export type ReviewItem = z.infer<typeof ReviewItemSchema>;
export type ReviewResolution = z.infer<typeof ReviewResolutionSchema>;
