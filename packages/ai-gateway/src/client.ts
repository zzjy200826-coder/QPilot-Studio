import { z } from "zod";

const ChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string()
});

const ChatResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable()
        })
      })
    )
    .min(1)
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export interface OpenAICompatibleClientOptions {
  baseURL: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

export class OpenAICompatibleClient {
  private readonly baseURL: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: OpenAICompatibleClientOptions) {
    this.baseURL = options.baseURL.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async createChatCompletion(messages: ChatMessage[]): Promise<string> {
    const parsedMessages = z.array(ChatMessageSchema).parse(messages);
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
          messages: parsedMessages
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`AI gateway error (${response.status}): ${body}`);
      }

      const json = await response.json();
      const parsed = ChatResponseSchema.parse(json);
      return parsed.choices[0]?.message.content ?? "{}";
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
