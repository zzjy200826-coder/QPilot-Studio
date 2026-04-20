import { z } from "zod";
import {
  type AnswerLibraryItem,
  type CandidateProfile,
  type FillDecision,
  type FillPlan,
  type FormField,
  type ReviewItem,
  FillPlanSchema
} from "./schemas.js";

const highRiskQuestionKeys = new Set([
  "workAuthorization",
  "sponsorship",
  "expectedSalary",
  "startDate",
  "gender",
  "race",
  "veteran",
  "disability",
  "relocation"
]);

const llmSuggestionSchema = z.object({
  value: z.string().trim().min(1).optional(),
  sourceKey: z.string().trim().min(1).optional(),
  confidence: z.number().min(0).max(1).default(0),
  needsHumanReview: z.boolean().default(true),
  reason: z.string().trim().optional()
});

export type LlmSuggestion = z.infer<typeof llmSuggestionSchema>;

export interface FieldSuggestionRequest {
  field: FormField;
  normalizedQuestionKey?: string;
  fieldContext: string;
  profile: CandidateProfile;
  answerLibrary: AnswerLibraryItem[];
}

export interface FieldSuggestionClient {
  suggest(input: FieldSuggestionRequest): Promise<LlmSuggestion | null>;
}

interface ChatCompletionTransport {
  createChatCompletion(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
  ): Promise<string>;
}

class OpenAICompatibleClient implements ChatCompletionTransport {
  private readonly baseURL: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: { baseURL: string; apiKey: string; model: string; timeoutMs?: number }) {
    this.baseURL = options.baseURL.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async createChatCompletion(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`AI gateway error (${response.status}): ${body}`);
      }

      const json = z
        .object({
          choices: z
            .array(
              z.object({
                message: z.object({
                  content: z.string().nullable()
                })
              })
            )
            .min(1)
        })
        .parse(await response.json());

      return json.choices[0]?.message.content ?? "{}";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`AI request timed out after ${this.timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

const normalizeText = (value: string | undefined): string =>
  (value ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const compactText = (value: string | undefined): string | undefined => {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : undefined;
};

const normalizeQuestionKey = (value: string | undefined): string | undefined => {
  const normalized = normalizeText(value);
  return normalized || undefined;
};

const buildFieldContext = (field: FormField): string =>
  [
    field.section ? `section: ${field.section}` : undefined,
    `label: ${field.label}`,
    field.name ? `name: ${field.name}` : undefined,
    field.placeholder ? `placeholder: ${field.placeholder}` : undefined,
    `type: ${field.type}`,
    field.options.length > 0
      ? `options: ${field.options.map((option) => `${option.label} => ${option.value}`).join(", ")}`
      : undefined
  ]
    .filter(Boolean)
    .join(" | ");

const buildFieldSearchText = (field: FormField): string =>
  normalizeText(
    [field.label, field.name, field.placeholder, field.section]
      .filter(Boolean)
      .join(" ")
  );

const isTruthy = (value: string): boolean =>
  ["yes", "true", "1", "authorized", "available", "y"].includes(normalizeText(value));

const isFalsy = (value: string): boolean =>
  ["no", "false", "0", "not authorized", "n"].includes(normalizeText(value));

const normalizeCheckboxValue = (rawValue: string): string | undefined => {
  if (isTruthy(rawValue)) {
    return "true";
  }
  if (isFalsy(rawValue)) {
    return "false";
  }
  return undefined;
};

const yesLikeOptions = [
  "yes",
  "authorized",
  "i am authorized",
  "eligible",
  "allowed",
  "i do not need sponsorship",
  "no sponsorship required"
];

const noLikeOptions = [
  "no",
  "not authorized",
  "not now",
  "none",
  "i require sponsorship",
  "need sponsorship"
];

const buildOptionMatch = (field: FormField, rawValue: string): string | undefined => {
  if (field.options.length === 0) {
    return rawValue;
  }

  const normalizedRaw = normalizeText(rawValue);
  const direct = field.options.find(
    (option) =>
      normalizeText(option.value) === normalizedRaw || normalizeText(option.label) === normalizedRaw
  );
  if (direct) {
    return direct.value;
  }

  if (normalizedRaw === "yes" || normalizedRaw === "true") {
    const yesOption = field.options.find((option) =>
      yesLikeOptions.includes(normalizeText(option.label)) ||
      yesLikeOptions.includes(normalizeText(option.value))
    );
    if (yesOption) {
      return yesOption.value;
    }
  }

  if (normalizedRaw === "no" || normalizedRaw === "false") {
    const noOption = field.options.find((option) =>
      noLikeOptions.includes(normalizeText(option.label)) ||
      noLikeOptions.includes(normalizeText(option.value))
    );
    if (noOption) {
      return noOption.value;
    }
  }

  return undefined;
};

const inferQuestionKey = (field: FormField): string | undefined => {
  const haystack = buildFieldSearchText(field);

  if (
    haystack.includes("first name") ||
    haystack.includes("given name") ||
    haystack.includes("forename")
  ) {
    return "basic.firstName";
  }
  if (
    haystack.includes("last name") ||
    haystack.includes("family name") ||
    haystack.includes("surname")
  ) {
    return "basic.lastName";
  }
  if (haystack.includes("full name")) return "basic.fullName";
  if (haystack.includes("email")) return "basic.email";
  if (haystack.includes("phone") || haystack.includes("mobile")) return "basic.phone";
  if (haystack.includes("linkedin")) return "basic.linkedin";
  if (haystack.includes("github")) return "basic.github";
  if (
    haystack.includes("legally authorized") ||
    haystack.includes("authorized to work") ||
    haystack.includes("work authorization") ||
    haystack.includes("eligible to work")
  ) {
    return "workAuthorization";
  }
  if (
    haystack.includes("sponsorship") ||
    haystack.includes("visa") ||
    haystack.includes("require sponsorship") ||
    haystack.includes("work permit")
  ) {
    return "sponsorship";
  }
  if (
    haystack.includes("salary") ||
    haystack.includes("compensation") ||
    haystack.includes("pay expectation") ||
    haystack.includes("base pay")
  ) {
    return "expectedSalary";
  }
  if (haystack.includes("start date") || haystack.includes("available to start")) {
    return "startDate";
  }
  if (haystack.includes("relocation") || haystack.includes("relocate")) {
    return "relocation";
  }
  if (haystack.includes("gender") || haystack.includes("sex")) {
    return "gender";
  }
  if (haystack.includes("race") || haystack.includes("ethnicity")) {
    return "race";
  }
  if (haystack.includes("veteran")) {
    return "veteran";
  }
  if (haystack.includes("disability")) {
    return "disability";
  }
  if (
    haystack.includes("portfolio") ||
    haystack.includes("website") ||
    haystack.includes("personal site")
  ) {
    return "basic.portfolio";
  }
  if (haystack.includes("city") || haystack.includes("current location")) return "basic.city";
  if (haystack.includes("country")) return "basic.country";
  if (haystack.includes("resume") || haystack.includes("cv")) return "files.resumePath";
  if (haystack.includes("cover letter")) return "files.coverLetterPath";
  if (haystack.includes("transcript")) return "files.transcriptPath";
  return undefined;
};

const getProfileValue = (profile: CandidateProfile, key: string): string | undefined => {
  switch (key) {
    case "basic.firstName":
      return compactText(profile.basic.firstName);
    case "basic.lastName":
      return compactText(profile.basic.lastName);
    case "basic.fullName":
      return compactText([profile.basic.firstName, profile.basic.lastName].join(" "));
    case "basic.email":
      return compactText(profile.basic.email);
    case "basic.phone":
      return compactText(profile.basic.phone);
    case "basic.linkedin":
      return compactText(profile.basic.linkedin);
    case "basic.github":
      return compactText(profile.basic.github);
    case "basic.portfolio":
      return compactText(profile.basic.portfolio);
    case "basic.city":
      return compactText(profile.basic.city);
    case "basic.country":
      return compactText(profile.basic.country);
    case "files.resumePath":
      return compactText(profile.files.resumePath);
    case "files.coverLetterPath":
      return compactText(profile.files.coverLetterPath);
    case "files.transcriptPath":
      return compactText(profile.files.transcriptPath);
    default:
      return undefined;
  }
};

const getProfileAnswerValue = (profile: CandidateProfile, key: string): string | undefined => {
  switch (key) {
    case "workAuthorization":
      return compactText(profile.answers.workAuthorization);
    case "sponsorship":
      return compactText(profile.answers.sponsorship);
    case "expectedSalary":
      return compactText(profile.answers.expectedSalary);
    case "startDate":
      return compactText(profile.answers.startDate);
    case "relocation":
      return compactText(profile.answers.relocation);
    case "gender":
      return compactText(profile.answers.gender);
    case "race":
      return compactText(profile.answers.race);
    case "veteran":
      return compactText(profile.answers.veteran);
    case "disability":
      return compactText(profile.answers.disability);
    default:
      return undefined;
  }
};

const createReviewItem = (
  field: FormField,
  reason: string,
  questionKey?: string,
  suggestedValue?: string,
  confidence = 0
): ReviewItem => ({
  fieldId: field.fieldId,
  label: field.label,
  section: field.section,
  type: field.type,
  options: field.options,
  suggestedValue,
  questionKey,
  confidence,
  reason
});

const normalizeFieldValue = (field: FormField, rawValue: string): string | undefined => {
  if (field.type === "select" || field.type === "radio") {
    return buildOptionMatch(field, rawValue);
  }
  if (field.type === "checkbox") {
    return normalizeCheckboxValue(rawValue);
  }
  return compactText(rawValue);
};

const findAnswerLibraryMatch = (
  field: FormField,
  answerLibrary: AnswerLibraryItem[],
  normalizedQuestionKey?: string
): AnswerLibraryItem | undefined => {
  const fieldSearchText = buildFieldSearchText(field);
  let bestMatch: { score: number; item: AnswerLibraryItem } | undefined;

  for (const item of answerLibrary) {
    const candidates = [item.questionKey, ...item.synonyms].map(normalizeText).filter(Boolean);
    let score = 0;

    if (normalizedQuestionKey && candidates.includes(normalizedQuestionKey)) {
      score = Math.max(score, 100);
    }

    for (const candidate of candidates) {
      if (fieldSearchText.includes(candidate)) {
        score = Math.max(score, candidate.length);
      }
    }

    if (!bestMatch || score > bestMatch.score) {
      if (score > 0) {
        bestMatch = { score, item };
      }
    }
  }

  return bestMatch?.item;
};

const sortPlanCollections = (
  allFields: FormField[],
  decisions: FillDecision[],
  reviewItems: ReviewItem[]
): { decisions: FillDecision[]; reviewItems: ReviewItem[] } => {
  const fieldOrder = new Map(allFields.map((field, index) => [field.fieldId, index]));
  const compareByField = (left: { fieldId: string }, right: { fieldId: string }) =>
    (fieldOrder.get(left.fieldId) ?? Number.MAX_SAFE_INTEGER) -
    (fieldOrder.get(right.fieldId) ?? Number.MAX_SAFE_INTEGER);

  return {
    decisions: [...decisions].sort(compareByField),
    reviewItems: [...reviewItems].sort(compareByField)
  };
};

export class OpenAiFieldSuggestionClient implements FieldSuggestionClient {
  constructor(private readonly client: ChatCompletionTransport) {}

  async suggest(input: FieldSuggestionRequest): Promise<LlmSuggestion | null> {
    const schemaHint = {
      value: "string | omit when unknown",
      sourceKey: "string | omit when unknown",
      confidence: "number between 0 and 1",
      needsHumanReview: "boolean",
      reason: "short string"
    };

    const systemPrompt = [
      "You map job application fields onto a candidate profile.",
      "Return JSON only.",
      "Be conservative: if you are not highly certain, set needsHumanReview to true.",
      "Never invent protected-trait answers or legal/compensation answers.",
      `Required schema: ${JSON.stringify(schemaHint)}`
    ].join(" ");

    const userPayload = {
      field: input.field,
      normalizedQuestionKey: input.normalizedQuestionKey,
      fieldContext: input.fieldContext,
      profile: {
        basic: input.profile.basic,
        education: input.profile.education,
        experience: input.profile.experience,
        answers: input.profile.answers,
        files: input.profile.files
      },
      answerLibrary: input.answerLibrary.map((item) => ({
        label: item.label,
        questionKey: item.questionKey,
        answer: item.answer,
        synonyms: item.synonyms
      }))
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const messages =
        attempt === 0
          ? [
              { role: "system" as const, content: systemPrompt },
              { role: "user" as const, content: JSON.stringify(userPayload) }
            ]
          : [
              { role: "system" as const, content: systemPrompt },
              {
                role: "user" as const,
                content: `${JSON.stringify(
                  userPayload
                )}\n\nThe previous response was invalid. Return only JSON that matches the required schema exactly.`
              }
            ];

      try {
        const response = await this.client.createChatCompletion(messages);
        const parsed = llmSuggestionSchema.safeParse(JSON.parse(response));
        if (parsed.success) {
          return parsed.data;
        }
      } catch {
        // fall through to retry, then manual review
      }
    }

    return null;
  }
}

export class FieldMapperService {
  private readonly suggestionClient: FieldSuggestionClient | null;

  constructor(options?: {
    ai?: {
      baseURL: string;
      apiKey: string;
      model: string;
      timeoutMs?: number;
    };
    suggestionClient?: FieldSuggestionClient | null;
  }) {
    if (options?.suggestionClient !== undefined) {
      this.suggestionClient = options.suggestionClient;
      return;
    }

    this.suggestionClient = options?.ai
      ? new OpenAiFieldSuggestionClient(
          new OpenAICompatibleClient({
            baseURL: options.ai.baseURL,
            apiKey: options.ai.apiKey,
            model: options.ai.model,
            timeoutMs: options.ai.timeoutMs
          })
        )
      : null;
  }

  async buildPlan(
    fields: FormField[],
    profile: CandidateProfile,
    answerLibrary: AnswerLibraryItem[]
  ): Promise<FillPlan> {
    const decisions: FillDecision[] = [];
    const reviewItems: ReviewItem[] = [];

    for (const field of fields) {
      if (field.type === "hidden") {
        continue;
      }

      const questionKey = inferQuestionKey(field);
      const normalizedQuestionKey = normalizeQuestionKey(questionKey);
      const isHighRisk = highRiskQuestionKeys.has(questionKey ?? "");

      const directProfileValue = questionKey ? getProfileValue(profile, questionKey) : undefined;
      if (directProfileValue) {
        const normalizedValue = normalizeFieldValue(field, directProfileValue);
        if (normalizedValue) {
          decisions.push({
            fieldId: field.fieldId,
            value: normalizedValue,
            sourceKey: questionKey,
            sourceType: "profile",
            confidence: 0.99,
            needsHumanReview: false
          });
          continue;
        }
      }

      const explicitProfileAnswer = questionKey ? getProfileAnswerValue(profile, questionKey) : undefined;
      if (explicitProfileAnswer) {
        const normalizedValue = normalizeFieldValue(field, explicitProfileAnswer);
        if (normalizedValue) {
          decisions.push({
            fieldId: field.fieldId,
            value: normalizedValue,
            sourceKey: questionKey,
            sourceType: "profile",
            confidence: 0.96,
            needsHumanReview: false
          });
          continue;
        }
      }

      const answerLibraryMatch = findAnswerLibraryMatch(field, answerLibrary, normalizedQuestionKey);
      if (answerLibraryMatch) {
        const normalizedValue = normalizeFieldValue(field, answerLibraryMatch.answer);
        if (normalizedValue) {
          if (isHighRisk) {
            reviewItems.push(
              createReviewItem(
                field,
                "这个问题属于高风险项。即使答案库找到了可能匹配的答案，也仍然需要你明确确认。",
                questionKey ?? answerLibraryMatch.questionKey,
                normalizedValue,
                0.9
              )
            );
            continue;
          }

          decisions.push({
            fieldId: field.fieldId,
            value: normalizedValue,
            sourceKey: answerLibraryMatch.questionKey,
            sourceType: "answer_library",
            confidence: 0.9,
            needsHumanReview: false
          });
          continue;
        }
      }

      const llmSuggestion = await this.suggestionClient?.suggest({
        field,
        normalizedQuestionKey,
        fieldContext: buildFieldContext(field),
        profile,
        answerLibrary
      });

      if (llmSuggestion?.value) {
        const normalizedValue = normalizeFieldValue(field, llmSuggestion.value);
        if (
          normalizedValue &&
          !llmSuggestion.needsHumanReview &&
          llmSuggestion.confidence >= 0.86 &&
          !isHighRisk
        ) {
          decisions.push({
            fieldId: field.fieldId,
            value: normalizedValue,
            sourceKey: llmSuggestion.sourceKey ?? questionKey,
            sourceType: "llm",
            confidence: llmSuggestion.confidence,
            needsHumanReview: false,
            reason: llmSuggestion.reason
          });
          continue;
        }

        reviewItems.push(
          createReviewItem(
            field,
            llmSuggestion.reason ?? "LLM 给出了建议值，但仍然需要人工确认。",
            llmSuggestion.sourceKey ?? questionKey,
            normalizedValue,
            llmSuggestion.confidence
          )
        );
        continue;
      }

      if (field.required || isHighRisk) {
        reviewItems.push(
          createReviewItem(
            field,
            isHighRisk
              ? "这个问题涉及资格、披露信息或薪资等敏感内容，需要你明确确认。"
              : "这是必填字段，目前无法高置信度自动映射。",
            questionKey
          )
        );
      }
    }

    const sorted = sortPlanCollections(fields, decisions, reviewItems);
    return FillPlanSchema.parse({
      decisions: sorted.decisions,
      reviewItems: sorted.reviewItems,
      requiresSubmitConfirmation: true,
      generatedAt: new Date().toISOString()
    });
  }

  async extendPlan(input: {
    currentPlan: FillPlan;
    existingFields: FormField[];
    newFields: FormField[];
    profile: CandidateProfile;
    answerLibrary: AnswerLibraryItem[];
    reviewReasonPrefix?: string;
  }): Promise<FillPlan> {
    const unseenFields = input.newFields.filter(
      (field) => !input.existingFields.some((existingField) => existingField.fieldId === field.fieldId)
    );

    if (unseenFields.length === 0) {
      return FillPlanSchema.parse({
        ...input.currentPlan,
        generatedAt: new Date().toISOString()
      });
    }

    const extraPlan = await this.buildPlan(unseenFields, input.profile, input.answerLibrary);
    const reviewItems = extraPlan.reviewItems.map((item) => ({
      ...item,
      reason: input.reviewReasonPrefix ? `${input.reviewReasonPrefix} ${item.reason}` : item.reason
    }));

    const mergedFields = [...input.existingFields, ...unseenFields];
    const mergedDecisions = [
      ...input.currentPlan.decisions.filter(
        (decision) => !extraPlan.decisions.some((extraDecision) => extraDecision.fieldId === decision.fieldId)
      ),
      ...extraPlan.decisions
    ];
    const mergedReviewItems = [
      ...input.currentPlan.reviewItems.filter(
        (reviewItem) => !reviewItems.some((extraItem) => extraItem.fieldId === reviewItem.fieldId)
      ),
      ...reviewItems
    ];

    const sorted = sortPlanCollections(mergedFields, mergedDecisions, mergedReviewItems);
    return FillPlanSchema.parse({
      decisions: sorted.decisions,
      reviewItems: sorted.reviewItems,
      requiresSubmitConfirmation: true,
      generatedAt: new Date().toISOString()
    });
  }
}
