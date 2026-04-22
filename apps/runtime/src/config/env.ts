import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
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
  METRICS_BEARER_TOKEN: z.string().min(16).optional(),
  OPS_ALERTS_ENABLED: booleanEnv(false),
  OPS_ALERT_WEBHOOK_URL: z.string().url().optional(),
  OPS_ALERT_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  OPS_ALERT_COOLDOWN_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
  OPS_QUEUE_BACKLOG_WARN_THRESHOLD: z.coerce.number().int().nonnegative().default(5),
  OPS_RELEASE_HOLD_LOOKBACK_MINUTES: z.coerce.number().int().positive().default(24 * 60),
  BACKUP_SHARED_ROOT: z.string().optional(),
  BACKUP_OPS_ROOT: z.string().optional(),
  BACKUP_S3_ENDPOINT: z.string().url().optional(),
  BACKUP_S3_REGION: z.string().default("us-east-1"),
  BACKUP_S3_BUCKET: z.string().optional(),
  BACKUP_S3_PREFIX: z.string().default("backups"),
  BACKUP_S3_ACCESS_KEY_ID: z.string().optional(),
  BACKUP_S3_SECRET_ACCESS_KEY: z.string().optional(),
  BACKUP_S3_FORCE_PATH_STYLE: booleanEnv(false),
  BACKUP_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "BACKUP_ENCRYPTION_KEY must be a 64-char hex key.")
    .optional(),
  BACKUP_STALE_AFTER_HOURS: z.coerce.number().int().positive().default(36),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().default(14),
  DEPLOY_REMOTE_HOST: z.string().optional(),
  DEPLOY_REMOTE_SSH_USER: z.string().optional(),
  DEPLOY_REMOTE_SSH_PORT: z.coerce.number().int().positive().default(22),
  DEPLOY_REMOTE_SSH_KEY_PATH: z.string().optional(),
  DEPLOY_REMOTE_ROOT: z.string().default("/opt/qpilot-studio"),
  DEPLOY_REMOTE_RUNTIME_ENV_SOURCE: z.string().optional(),
  DEPLOY_REMOTE_DOMAIN: z.string().optional(),
  DEPLOY_REMOTE_PUBLIC_DOMAIN: z.string().optional(),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  AUTH_SELF_SERVICE_REGISTRATION: booleanEnv(true),
  AUTH_ALLOWED_EMAILS: z.string().optional(),
  AUTH_SESSION_COOKIE_NAME: z.string().default("qpilot_session"),
  AUTH_SESSION_TTL_HOURS: z.coerce.number().int().positive().max(24 * 30).default(24 * 7),
  AUTH_SECURE_COOKIES: booleanEnv(false).optional(),
  AUTH_TOKEN_PEPPER: z.string().min(16).optional(),
  AUTH_API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().max(10_000).default(240),
  AUTH_LOGIN_FAILURE_LIMIT: z.coerce.number().int().positive().max(100).default(10),
  AUTH_LOGIN_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  CREDENTIAL_MASTER_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "CREDENTIAL_MASTER_KEY must be a 64-char hex key.")
});

const parsedEnv = envSchema.parse(process.env);
const databaseDir = dirname(resolve(runtimeRoot, parsedEnv.DATABASE_URL));
const inferredBackupSharedRoot =
  parsedEnv.BACKUP_SHARED_ROOT ??
  (basename(dirname(databaseDir)) === "shared" ? dirname(databaseDir) : databaseDir);
const inferredBackupOpsRoot =
  parsedEnv.BACKUP_OPS_ROOT ?? resolve(dirname(inferredBackupSharedRoot), "ops");

export const env = {
  ...parsedEnv,
  AUTH_SECURE_COOKIES:
    parsedEnv.AUTH_SECURE_COOKIES ?? parsedEnv.NODE_ENV === "production",
  AUTH_TOKEN_PEPPER: parsedEnv.AUTH_TOKEN_PEPPER ?? parsedEnv.CREDENTIAL_MASTER_KEY,
  BACKUP_SHARED_ROOT: inferredBackupSharedRoot,
  BACKUP_OPS_ROOT: inferredBackupOpsRoot
};
export const RUNTIME_ROOT = runtimeRoot;
