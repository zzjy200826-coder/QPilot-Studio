import { describe, expect, it } from "vitest";
import {
  FieldMapperService,
  OpenAiFieldSuggestionClient,
  type FieldSuggestionClient
} from "../src/domain/mapping.js";
import type { CandidateProfile, FormField } from "../src/domain/schemas.js";

const profile: CandidateProfile = {
  id: "default",
  basic: {
    firstName: "Zoe",
    lastName: "Jin",
    email: "zoe@example.com",
    phone: "+86 13800000000",
    city: "Shanghai",
    country: "China",
    linkedin: "https://linkedin.com/in/zoe",
    github: "https://github.com/zoe",
    portfolio: "https://zoe.dev"
  },
  education: [],
  experience: [],
  preferences: {
    targetKeywords: [],
    preferredLocations: [],
    excludeKeywords: []
  },
  answers: {
    workAuthorization: "Yes",
    sponsorship: "No"
  },
  files: {
    resumePath: "C:\\resume.pdf",
    otherFiles: []
  }
};

const textField = (input: Partial<FormField> & Pick<FormField, "fieldId" | "label">): FormField => ({
  fieldId: input.fieldId,
  selector: input.selector ?? `#${input.fieldId}`,
  label: input.label,
  name: input.name,
  placeholder: input.placeholder,
  section: input.section,
  type: input.type ?? "text",
  required: input.required ?? true,
  options: input.options ?? []
});

describe("FieldMapperService", () => {
  it("maps deterministic profile fields and explicit high-risk answers directly", async () => {
    const mapper = new FieldMapperService();
    const fields: FormField[] = [
      textField({
        fieldId: "given-name",
        label: "Given name"
      }),
      textField({
        fieldId: "email",
        label: "Email address",
        type: "email"
      }),
      textField({
        fieldId: "resume",
        label: "Resume / CV",
        type: "file"
      }),
      textField({
        fieldId: "auth",
        label: "Are you legally authorized to work in this country?",
        type: "select",
        options: [
          { label: "Yes", value: "yes" },
          { label: "No", value: "no" }
        ]
      })
    ];

    const plan = await mapper.buildPlan(fields, profile, []);
    expect(plan.reviewItems).toHaveLength(0);
    expect(plan.decisions.map((decision) => decision.fieldId)).toEqual([
      "given-name",
      "email",
      "resume",
      "auth"
    ]);
    expect(plan.decisions.find((decision) => decision.fieldId === "auth")?.value).toBe("yes");
  });

  it("uses answer-library synonyms for non high-risk fields", async () => {
    const mapper = new FieldMapperService();
    const fields: FormField[] = [
      textField({
        fieldId: "work-samples",
        label: "Work samples"
      })
    ];

    const plan = await mapper.buildPlan(fields, profile, [
      {
        id: "answer-1",
        label: "Showcase link",
        questionKey: "work samples",
        answer: "https://zoe.dev",
        synonyms: ["work samples", "project showcase"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ]);

    expect(plan.reviewItems).toHaveLength(0);
    expect(plan.decisions[0]?.value).toBe("https://zoe.dev");
    expect(plan.decisions[0]?.sourceType).toBe("answer_library");
  });

  it("keeps high-risk answers in review when they only come from the answer library", async () => {
    const mapper = new FieldMapperService();
    const fields: FormField[] = [
      textField({
        fieldId: "salary",
        label: "Desired compensation"
      })
    ];

    const plan = await mapper.buildPlan(fields, { ...profile, answers: {} }, [
      {
        id: "answer-2",
        label: "Compensation expectation",
        questionKey: "expectedSalary",
        answer: "$150,000",
        synonyms: ["desired compensation", "salary expectation"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ]);

    expect(plan.decisions).toHaveLength(0);
    expect(plan.reviewItems).toHaveLength(1);
    expect(plan.reviewItems[0]?.suggestedValue).toBe("$150,000");
  });

  it("sends low-confidence LLM suggestions to review", async () => {
    const suggestionClient: FieldSuggestionClient = {
      suggest: async () => ({
        value: "Soon",
        sourceKey: "startDate",
        confidence: 0.42,
        needsHumanReview: true,
        reason: "The wording is ambiguous."
      })
    };
    const mapper = new FieldMapperService({
      suggestionClient
    });
    const fields: FormField[] = [
      textField({
        fieldId: "start-date",
        label: "Earliest start date"
      })
    ];

    const plan = await mapper.buildPlan(fields, { ...profile, answers: {} }, []);
    expect(plan.decisions).toHaveLength(0);
    expect(plan.reviewItems).toHaveLength(1);
    expect(plan.reviewItems[0]?.reason).toContain("ambiguous");
  });
});

describe("OpenAiFieldSuggestionClient", () => {
  it("retries once when the provider returns invalid JSON", async () => {
    const responses = ["not json", JSON.stringify({
      value: "https://github.com/zoe",
      sourceKey: "basic.github",
      confidence: 0.92,
      needsHumanReview: false,
      reason: "Matched the GitHub field."
    })];

    const client = new OpenAiFieldSuggestionClient({
      createChatCompletion: async () => responses.shift() ?? "{}"
    });

    const suggestion = await client.suggest({
      field: textField({
        fieldId: "github",
        label: "GitHub profile"
      }),
      normalizedQuestionKey: "basic.github",
      fieldContext: "label: GitHub profile",
      profile,
      answerLibrary: []
    });

    expect(suggestion?.value).toBe("https://github.com/zoe");
    expect(responses).toHaveLength(0);
  });

  it("returns null after repeated invalid responses", async () => {
    const client = new OpenAiFieldSuggestionClient({
      createChatCompletion: async () => "{bad json"
    });

    const suggestion = await client.suggest({
      field: textField({
        fieldId: "portfolio",
        label: "Portfolio"
      }),
      fieldContext: "label: Portfolio",
      profile,
      answerLibrary: []
    });

    expect(suggestion).toBeNull();
  });
});
