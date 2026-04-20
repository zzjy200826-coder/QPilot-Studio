import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";
import { booleanEnv } from "./env-parsers.js";

const currentFile = fileURLToPath(import.meta.url);
const runtimeRoot = resolve(dirname(currentFile), "..", "..");
const rootEnvPath = resolve(runtimeRoot, "..", "..", ".env");
const runtimeEnvPath = resolve(runtimeRoot, ".env");

if (existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else if (existsSync(runtimeEnvPath)) {
  dotenv.config({ path: runtimeEnvPath });
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(8787),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  DATABASE_URL: z.string().default("./data/qpilot.db"),
  ARTIFACTS_DIR: z.string().default("./data/artifacts"),
  REPORTS_DIR: z.string().default("./data/reports"),
  SESSIONS_DIR: z.string().default("./data/sessions"),
  PLANNER_CACHE_DIR: z.string().default("./data/planner-cache"),
  PLATFORM_POSTGRES_URL: z.string().optional(),
  PLATFORM_REDIS_URL: z.string().optional(),
  PLATFORM_REDIS_QUEUE_NAME: z.string().default("platform-load-runs"),
  PLATFORM_REDIS_WORKER_ENABLED: booleanEnv(true),
  PLATFORM_REDIS_WORKER_CONCURRENCY: z.coerce.number().int().positive().max(32).default(2),
  PLATFORM_REDIS_JOB_ATTEMPTS: z.coerce.number().int().positive().max(10).default(3),
  PLATFORM_REDIS_JOB_BACKOFF_MS: z.coerce.number().int().nonnegative().default(1_500),
  PLATFORM_WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(3_000),
  PLATFORM_WORKER_HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  PLATFORM_PROMETHEUS_URL: z.string().optional(),
  PLATFORM_METRICS_ENABLED: booleanEnv(true),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  CREDENTIAL_MASTER_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "CREDENTIAL_MASTER_KEY must be a 64-char hex key.")
});

export const env = envSchema.parse(process.env);
export const RUNTIME_ROOT = runtimeRoot;
