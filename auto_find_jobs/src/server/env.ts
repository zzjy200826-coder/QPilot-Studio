import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const appRootCandidate = resolve(currentDir, "..", "..");
const builtAppRootCandidate = resolve(currentDir, "..", "..", "..");
const serverRoot = existsSync(resolve(appRootCandidate, "package.json"))
  ? appRootCandidate
  : builtAppRootCandidate;
const workspaceRoot = resolve(serverRoot, "..");
const workspaceEnvPath = resolve(workspaceRoot, ".env");
const appEnvPath = resolve(serverRoot, ".env");

if (existsSync(workspaceEnvPath)) {
  dotenv.config({ path: workspaceEnvPath });
}

if (existsSync(appEnvPath)) {
  dotenv.config({ path: appEnvPath, override: false });
}

const booleanEnv = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value !== "string") {
      return value ?? defaultValue;
    }

    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
    return defaultValue;
  }, z.boolean().default(defaultValue));

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  AUTO_FIND_JOBS_HOST: z.string().default("127.0.0.1"),
  AUTO_FIND_JOBS_PORT: z.coerce.number().int().positive().default(8790),
  AUTO_FIND_JOBS_CLIENT_ORIGIN: z.string().default("http://localhost:5180"),
  AUTO_FIND_JOBS_DATA_DIR: z.string().optional(),
  AUTO_FIND_JOBS_DATABASE_PATH: z.string().optional(),
  AUTO_FIND_JOBS_ARTIFACTS_DIR: z.string().optional(),
  AUTO_FIND_JOBS_SESSIONS_DIR: z.string().optional(),
  AUTO_FIND_JOBS_GREENHOUSE_API_BASE: z.string().url().optional(),
  AUTO_FIND_JOBS_LEVER_API_BASE: z.string().url().optional(),
  AUTO_FIND_JOBS_PLAYWRIGHT_HEADLESS: booleanEnv(false),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000)
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export const parseServerEnv = (input: Record<string, unknown>): ServerEnv =>
  serverEnvSchema.parse(input);

export const env = parseServerEnv(process.env);
export const SERVER_ROOT = serverRoot;
export const WORKSPACE_ROOT = workspaceRoot;
