import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { env } from "./env.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const appRootCandidate = resolve(currentDir, "../..");
const builtAppRootCandidate = resolve(currentDir, "../../..");
export const APP_ROOT = existsSync(resolve(appRootCandidate, "package.json"))
  ? appRootCandidate
  : builtAppRootCandidate;
export const DATA_ROOT = env.AUTO_FIND_JOBS_DATA_DIR
  ? resolve(env.AUTO_FIND_JOBS_DATA_DIR)
  : resolve(APP_ROOT, "data");
export const ARTIFACTS_ROOT = env.AUTO_FIND_JOBS_ARTIFACTS_DIR
  ? resolve(env.AUTO_FIND_JOBS_ARTIFACTS_DIR)
  : resolve(DATA_ROOT, "artifacts");
export const SESSIONS_ROOT = env.AUTO_FIND_JOBS_SESSIONS_DIR
  ? resolve(env.AUTO_FIND_JOBS_SESSIONS_DIR)
  : resolve(DATA_ROOT, "sessions");
export const CLIENT_DIST_ROOT = resolve(APP_ROOT, "dist/client");
export const DATABASE_PATH = env.AUTO_FIND_JOBS_DATABASE_PATH
  ? resolve(env.AUTO_FIND_JOBS_DATABASE_PATH)
  : resolve(DATA_ROOT, "job-assistant.sqlite");

export const serverConfig = {
  host: env.AUTO_FIND_JOBS_HOST,
  port: env.AUTO_FIND_JOBS_PORT,
  clientOrigin: env.AUTO_FIND_JOBS_CLIENT_ORIGIN,
  greenhouseApiBase: env.AUTO_FIND_JOBS_GREENHOUSE_API_BASE,
  leverApiBase: env.AUTO_FIND_JOBS_LEVER_API_BASE,
  playwrightHeadless: env.AUTO_FIND_JOBS_PLAYWRIGHT_HEADLESS,
  openAiBaseUrl: env.OPENAI_BASE_URL,
  openAiApiKey: env.OPENAI_API_KEY,
  openAiModel: env.OPENAI_MODEL,
  openAiTimeoutMs: env.OPENAI_TIMEOUT_MS,
  llmConfigured: Boolean(env.OPENAI_API_KEY)
};

export const ensureRuntimeDirectories = (): void => {
  for (const directory of [DATA_ROOT, ARTIFACTS_ROOT, SESSIONS_ROOT]) {
    mkdirSync(directory, { recursive: true });
  }
};

export const hasClientBuild = (): boolean => existsSync(CLIENT_DIST_ROOT);
