import { describe, expect, it } from "vitest";
import { parseServerEnv } from "../src/server/env.js";

describe("parseServerEnv", () => {
  it("applies qpilot-aligned defaults", () => {
    const env = parseServerEnv({});

    expect(env.OPENAI_BASE_URL).toBe("https://api.openai.com/v1");
    expect(env.OPENAI_MODEL).toBe("gpt-4.1-mini");
    expect(env.OPENAI_TIMEOUT_MS).toBe(90_000);
    expect(env.AUTO_FIND_JOBS_PORT).toBe(8790);
    expect(env.AUTO_FIND_JOBS_PLAYWRIGHT_HEADLESS).toBe(false);
  });

  it("parses explicit overrides", () => {
    const env = parseServerEnv({
      AUTO_FIND_JOBS_PORT: "9900",
      AUTO_FIND_JOBS_PLAYWRIGHT_HEADLESS: "true",
      OPENAI_MODEL: "deepseek-chat"
    });

    expect(env.AUTO_FIND_JOBS_PORT).toBe(9900);
    expect(env.AUTO_FIND_JOBS_PLAYWRIGHT_HEADLESS).toBe(true);
    expect(env.OPENAI_MODEL).toBe("deepseek-chat");
  });
});
