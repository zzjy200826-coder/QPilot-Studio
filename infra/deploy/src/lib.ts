import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { lookup } from "node:dns/promises";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { runPlatformSmokeVerification } from "@qpilot/shared";

export interface CommonDeployOptions {
  host: string;
  sshUser: string;
  sshPort: number;
  deployRoot: string;
  runtimeEnvFile: string;
  sshKeyPath?: string;
  dryRun: boolean;
}

export interface BootstrapOptions extends CommonDeployOptions {
  domain: string;
  publicDomain?: string;
  repoUrl: string;
  ref: string;
  certEmail: string;
  runtimeEnvSource: string;
}

export interface UpdateOptions extends CommonDeployOptions {
  ref: string;
  domain?: string;
  publicDomain?: string;
  runtimeEnvSource?: string;
}

export interface SmokeOptions {
  baseUrl: string;
  publicBaseUrl?: string;
  metricsToken?: string;
  expectRegistrationClosed: boolean;
  timeoutMs: number;
}

export interface DeployPaths {
  deployRoot: string;
  appDir: string;
  sharedDir: string;
  opsDir: string;
  dataDir: string;
  artifactsDir: string;
  reportsDir: string;
  sessionsDir: string;
  plannerCacheDir: string;
  backupsDir: string;
  webDistDir: string;
  runtimeEnvFile: string;
  systemdUnitPath: string;
  backupSystemdUnitPath: string;
  backupTimerUnitPath: string;
  nginxSitePath: string;
}

export interface DeployPlanFile {
  remoteName: string;
  remoteInstallPath: string;
  contents: string;
}

export interface DeployPlan {
  title: string;
  summary: string[];
  remoteScript: string;
  files: DeployPlanFile[];
  derived: {
    paths: DeployPaths;
    domain: string;
    repoUrl?: string;
    ref: string;
    backupStamp?: string;
  };
}

export interface SmokeCheckResult {
  name: string;
  ok: boolean;
  status: number;
  detail: string;
}

interface ParsedArgs {
  values: Map<string, string[]>;
  booleans: Map<string, boolean>;
}

export const DEFAULT_DEPLOY_ROOT = "/opt/qpilot-studio";
export const DEFAULT_RUNTIME_ENV_FILE = "/etc/qpilot/runtime.env";
export const DEFAULT_SYSTEMD_UNIT = "/etc/systemd/system/qpilot-runtime.service";
export const DEFAULT_BACKUP_SYSTEMD_UNIT = "/etc/systemd/system/qpilot-backup.service";
export const DEFAULT_BACKUP_TIMER_UNIT = "/etc/systemd/system/qpilot-backup.timer";
export const DEFAULT_NGINX_SITE = "/etc/nginx/sites-available/qpilot.conf";
export const DEFAULT_APP_USER = "qpilot";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const packageRoot = resolve(currentDir, "..");
export const repoRoot = resolve(currentDir, "..", "..", "..");
const nginxTemplatePath = resolve(repoRoot, "infra", "nginx", "qpilot-site.conf.template");
const systemdTemplatePath = resolve(
  repoRoot,
  "infra",
  "systemd",
  "qpilot-runtime.service.template"
);
const backupSystemdTemplatePath = resolve(
  repoRoot,
  "infra",
  "systemd",
  "qpilot-backup.service.template"
);
const backupTimerTemplatePath = resolve(
  repoRoot,
  "infra",
  "systemd",
  "qpilot-backup.timer.template"
);

export const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

const parseArgs = (argv: string[]): ParsedArgs => {
  const values = new Map<string, string[]>();
  const booleans = new Map<string, boolean>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token ?? ""}`);
    }

    if (token.startsWith("--no-")) {
      booleans.set(token.slice(5), false);
      continue;
    }

    const name = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      booleans.set(name, true);
      continue;
    }

    const list = values.get(name) ?? [];
    list.push(next);
    values.set(name, list);
    index += 1;
  }

  return { values, booleans };
};

const readRequiredValue = (parsed: ParsedArgs, name: string): string => {
  const value = parsed.values.get(name)?.at(-1)?.trim();
  if (!value) {
    throw new Error(`Missing required argument --${name}`);
  }
  return value;
};

const readOptionalValue = (parsed: ParsedArgs, name: string): string | undefined =>
  parsed.values.get(name)?.at(-1)?.trim() || undefined;

const readBooleanFlag = (
  parsed: ParsedArgs,
  name: string,
  defaultValue = false
): boolean => parsed.booleans.get(name) ?? defaultValue;

const readIntegerFlag = (
  parsed: ParsedArgs,
  name: string,
  defaultValue: number
): number => {
  const raw = readOptionalValue(parsed, name);
  if (!raw) {
    return defaultValue;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Expected --${name} to be a positive integer.`);
  }
  return value;
};

export const parseBootstrapArgs = (argv: string[]): BootstrapOptions => {
  const parsed = parseArgs(argv);

  return {
    host: readRequiredValue(parsed, "host"),
    sshUser: readRequiredValue(parsed, "ssh-user"),
    sshPort: readIntegerFlag(parsed, "ssh-port", 22),
    deployRoot: readOptionalValue(parsed, "deploy-root") ?? DEFAULT_DEPLOY_ROOT,
    runtimeEnvFile:
      readOptionalValue(parsed, "runtime-env-file") ?? DEFAULT_RUNTIME_ENV_FILE,
    sshKeyPath: readOptionalValue(parsed, "ssh-key"),
    dryRun: readBooleanFlag(parsed, "dry-run", false),
    domain: readRequiredValue(parsed, "domain"),
    publicDomain: readOptionalValue(parsed, "public-domain"),
    repoUrl: readRequiredValue(parsed, "repo-url"),
    ref: readOptionalValue(parsed, "ref") ?? "main",
    certEmail: readRequiredValue(parsed, "cert-email"),
    runtimeEnvSource: readRequiredValue(parsed, "runtime-env-source")
  };
};

export const parseUpdateArgs = (argv: string[]): UpdateOptions => {
  const parsed = parseArgs(argv);

  return {
    host: readRequiredValue(parsed, "host"),
    sshUser: readRequiredValue(parsed, "ssh-user"),
    sshPort: readIntegerFlag(parsed, "ssh-port", 22),
    deployRoot: readOptionalValue(parsed, "deploy-root") ?? DEFAULT_DEPLOY_ROOT,
    runtimeEnvFile:
      readOptionalValue(parsed, "runtime-env-file") ?? DEFAULT_RUNTIME_ENV_FILE,
    sshKeyPath: readOptionalValue(parsed, "ssh-key"),
    dryRun: readBooleanFlag(parsed, "dry-run", false),
    ref: readOptionalValue(parsed, "ref") ?? "main",
    domain: readOptionalValue(parsed, "domain"),
    publicDomain: readOptionalValue(parsed, "public-domain"),
    runtimeEnvSource: readOptionalValue(parsed, "runtime-env-source")
  };
};

export const parseSmokeArgs = (argv: string[]): SmokeOptions => {
  const parsed = parseArgs(argv);

  return {
    baseUrl: readRequiredValue(parsed, "base-url").replace(/\/+$/, ""),
    publicBaseUrl: readOptionalValue(parsed, "public-base-url")?.replace(/\/+$/, ""),
    metricsToken: readOptionalValue(parsed, "metrics-token"),
    expectRegistrationClosed: readBooleanFlag(parsed, "expect-registration-closed", false),
    timeoutMs: readIntegerFlag(parsed, "timeout-ms", 8_000)
  };
};

export const derivePaths = (
  deployRoot: string,
  runtimeEnvFile: string
): DeployPaths => {
  const sharedDir = `${deployRoot}/shared`;
  const dataDir = `${sharedDir}/data`;

  return {
    deployRoot,
    appDir: `${deployRoot}/app`,
    sharedDir,
    opsDir: `${deployRoot}/ops`,
    dataDir,
    artifactsDir: `${dataDir}/artifacts`,
    reportsDir: `${dataDir}/reports`,
    sessionsDir: `${dataDir}/sessions`,
    plannerCacheDir: `${dataDir}/planner-cache`,
    backupsDir: `${sharedDir}/backups`,
    webDistDir: `${deployRoot}/app/apps/web/dist`,
    runtimeEnvFile,
    systemdUnitPath: DEFAULT_SYSTEMD_UNIT,
    backupSystemdUnitPath: DEFAULT_BACKUP_SYSTEMD_UNIT,
    backupTimerUnitPath: DEFAULT_BACKUP_TIMER_UNIT,
    nginxSitePath: DEFAULT_NGINX_SITE
  };
};

const parseEnvText = (text: string): Map<string, string> => {
  const values = new Map<string, string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    values.set(key, value);
  }

  return values;
};

const formatEnvMap = (values: Map<string, string>): string =>
  Array.from(values.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")
    .concat("\n");

const ensureRequiredEnvValues = (values: Map<string, string>): void => {
  for (const key of ["CREDENTIAL_MASTER_KEY", "METRICS_BEARER_TOKEN"]) {
    const value = values.get(key)?.trim();
    if (!value) {
      throw new Error(
        `runtime env source is missing required ${key}. Add it to the local env file before deploying.`
      );
    }
  }

  const selfServiceRegistration = values.get("AUTH_SELF_SERVICE_REGISTRATION")?.trim() ?? "true";
  if (selfServiceRegistration === "false") {
    const allowedEmails = values.get("AUTH_ALLOWED_EMAILS")?.trim();
    if (!allowedEmails) {
      throw new Error(
        "runtime env source is missing required AUTH_ALLOWED_EMAILS while self-service registration is disabled."
      );
    }
  }
};

export const buildRuntimeEnv = async (input: {
  runtimeEnvSourcePath: string;
  domain: string;
  publicDomain?: string;
  paths: DeployPaths;
}): Promise<string> => {
  const sourceText = await readFile(input.runtimeEnvSourcePath, "utf8");
  const values = parseEnvText(sourceText);
  const secureOrigin = `https://${input.domain}`;

  const derived = new Map<string, string>([
    ["ARTIFACTS_DIR", input.paths.artifactsDir],
    ["AUTH_SECURE_COOKIES", "true"],
    ["AUTH_SELF_SERVICE_REGISTRATION", values.get("AUTH_SELF_SERVICE_REGISTRATION") ?? "false"],
    ["BACKUP_OPS_ROOT", input.paths.opsDir],
    ["BACKUP_SHARED_ROOT", input.paths.sharedDir],
    ["BACKUP_STALE_AFTER_HOURS", values.get("BACKUP_STALE_AFTER_HOURS") ?? "36"],
    ["CORS_ORIGIN", secureOrigin],
    ["DATABASE_URL", `${input.paths.dataDir}/qpilot.db`],
    ["HOST", "127.0.0.1"],
    ["NODE_ENV", "production"],
    ["PLANNER_CACHE_DIR", input.paths.plannerCacheDir],
    ["PLATFORM_METRICS_ENABLED", values.get("PLATFORM_METRICS_ENABLED") ?? "true"],
    ["PLATFORM_REDIS_URL", values.get("PLATFORM_REDIS_URL") ?? "redis://127.0.0.1:6379"],
    ["PORT", "8787"],
    ["REPORTS_DIR", input.paths.reportsDir],
    ["SESSIONS_DIR", input.paths.sessionsDir],
    ["VITE_AUTH_SELF_SERVICE_REGISTRATION", values.get("AUTH_SELF_SERVICE_REGISTRATION") ?? "false"],
    ["VITE_PRIVATE_APP_ORIGIN", secureOrigin],
    ["VITE_PUBLIC_MARKETING_HOST", input.publicDomain ?? values.get("VITE_PUBLIC_MARKETING_HOST") ?? ""],
    ["VITE_RUNTIME_BASE_URL", ""]
  ]);

  for (const [key, value] of derived) {
    values.set(key, value);
  }

  ensureRequiredEnvValues(values);

  return formatEnvMap(values);
};

export const renderTemplate = async (
  templatePath: string,
  replacements: Record<string, string>
): Promise<string> => {
  const template = await readFile(templatePath, "utf8");
  return Object.entries(replacements).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, value),
    template
  );
};

const buildPublicServerBlock = (input: {
  publicDomain?: string;
  webDistDir: string;
}): string => {
  if (!input.publicDomain) {
    return "";
  }

  return `
server {
    listen 80;
    listen [::]:80;
    server_name ${input.publicDomain};

    root ${input.webDistDir};
    index index.html;

    location /api/ {
        return 404;
    }

    location /artifacts/ {
        return 404;
    }

    location /reports/ {
        return 404;
    }

    location = /metrics {
        return 404;
    }

    location = /health {
        return 404;
    }

    location = /health/ready {
        return 404;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
`.trim();
};

const getPnpmVersion = async (): Promise<string> => {
  const packageJsonText = await readFile(resolve(repoRoot, "package.json"), "utf8");
  const packageJson = JSON.parse(packageJsonText) as { packageManager?: string };
  const packageManager = packageJson.packageManager ?? "pnpm@10.8.0";
  const match = packageManager.match(/^pnpm@(.+)$/);
  return match?.[1] ?? "10.8.0";
};

const createBootstrapRemoteScript = async (input: {
  options: BootstrapOptions;
  paths: DeployPaths;
}): Promise<string> => {
  const pnpmVersion = await getPnpmVersion();
  const remoteStagingDir = `${input.paths.sharedDir}/deploy-staging`;

  return `
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

APP_USER=${shellQuote(DEFAULT_APP_USER)}
APP_DIR=${shellQuote(input.paths.appDir)}
DEPLOY_ROOT=${shellQuote(input.paths.deployRoot)}
SHARED_DIR=${shellQuote(input.paths.sharedDir)}
OPS_DIR=${shellQuote(input.paths.opsDir)}
DATA_DIR=${shellQuote(input.paths.dataDir)}
BACKUPS_DIR=${shellQuote(input.paths.backupsDir)}
RUNTIME_ENV_FILE=${shellQuote(input.paths.runtimeEnvFile)}
SYSTEMD_UNIT=${shellQuote(input.paths.systemdUnitPath)}
BACKUP_SYSTEMD_UNIT=${shellQuote(input.paths.backupSystemdUnitPath)}
BACKUP_TIMER_UNIT=${shellQuote(input.paths.backupTimerUnitPath)}
NGINX_SITE=${shellQuote(input.paths.nginxSitePath)}
REMOTE_STAGING=${shellQuote(remoteStagingDir)}
REPO_URL=${shellQuote(input.options.repoUrl)}
REF=${shellQuote(input.options.ref)}
DOMAIN=${shellQuote(input.options.domain)}
PUBLIC_DOMAIN=${shellQuote(input.options.publicDomain ?? "")}
CERT_EMAIL=${shellQuote(input.options.certEmail)}
PNPM_VERSION=${shellQuote(pnpmVersion)}

sudo -n true
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git nginx redis-server certbot python3-certbot-nginx

if ! command -v node >/dev/null 2>&1 || ! node --version | grep -q '^v22\\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

sudo corepack enable
sudo corepack prepare "pnpm@$PNPM_VERSION" --activate

if ! id -u "$APP_USER" >/dev/null 2>&1; then
  sudo useradd --system --create-home --home-dir "$DEPLOY_ROOT" --shell /bin/bash "$APP_USER"
fi

sudo install -d -m 755 -o "$APP_USER" -g "$APP_USER" "$DEPLOY_ROOT" "$SHARED_DIR" "$OPS_DIR" "$DATA_DIR" "$BACKUPS_DIR"
sudo install -d -m 755 -o "$APP_USER" -g "$APP_USER" \
  "${input.paths.artifactsDir}" \
  "${input.paths.reportsDir}" \
  "${input.paths.sessionsDir}" \
  "${input.paths.plannerCacheDir}"
sudo install -d -m 755 -o "$APP_USER" -g "$APP_USER" "$REMOTE_STAGING"

if [ ! -d "$APP_DIR/.git" ]; then
  sudo -H -u "$APP_USER" git clone "$REPO_URL" "$APP_DIR"
fi

sudo -H -u "$APP_USER" git -C "$APP_DIR" fetch --all --tags
if sudo -H -u "$APP_USER" git -C "$APP_DIR" rev-parse --verify --quiet "origin/$REF^{commit}" >/dev/null 2>&1; then
  sudo -H -u "$APP_USER" git -C "$APP_DIR" checkout -B "$REF" "origin/$REF"
else
  sudo -H -u "$APP_USER" git -C "$APP_DIR" checkout "$REF"
fi

sudo install -d -m 750 -o root -g "$APP_USER" "$(dirname "$RUNTIME_ENV_FILE")"
sudo install -m 640 -o root -g "$APP_USER" "$REMOTE_STAGING/runtime.env" "$RUNTIME_ENV_FILE"
sudo install -m 644 -o root -g root "$REMOTE_STAGING/qpilot-runtime.service" "$SYSTEMD_UNIT"
sudo install -m 644 -o root -g root "$REMOTE_STAGING/qpilot-backup.service" "$BACKUP_SYSTEMD_UNIT"
sudo install -m 644 -o root -g root "$REMOTE_STAGING/qpilot-backup.timer" "$BACKUP_TIMER_UNIT"
if [ -f "$REMOTE_STAGING/qpilot.conf" ]; then
  sudo install -m 644 -o root -g root "$REMOTE_STAGING/qpilot.conf" "$NGINX_SITE"
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo ln -sfn "$NGINX_SITE" /etc/nginx/sites-enabled/qpilot.conf
fi

if [ -f /etc/redis/redis.conf ]; then
  sudo python3 - <<'PY'
from pathlib import Path
path = Path("/etc/redis/redis.conf")
text = path.read_text()
if "bind 127.0.0.1 ::1" not in text:
    import re
    if re.search(r"^#?bind\\s+.*$", text, flags=re.MULTILINE):
        text = re.sub(r"^#?bind\\s+.*$", "bind 127.0.0.1 ::1", text, flags=re.MULTILINE)
    else:
        text += "\\nbind 127.0.0.1 ::1\\n"
if re.search(r"^#?protected-mode\\s+.*$", text, flags=re.MULTILINE):
    text = re.sub(r"^#?protected-mode\\s+.*$", "protected-mode yes", text, flags=re.MULTILINE)
else:
    text += "\\nprotected-mode yes\\n"
path.write_text(text)
PY
fi

sudo systemctl enable redis-server
sudo systemctl restart redis-server

sudo -H -u "$APP_USER" bash -lc "
  set -euo pipefail
  cd $APP_DIR
  export CI=1
  set -a
  source $RUNTIME_ENV_FILE
  set +a
  pnpm install --frozen-lockfile
  pnpm --filter @qpilot/runtime exec playwright install chromium
  pnpm -r build
  pnpm --filter @qpilot/runtime run db:migrate
"

sudo systemctl daemon-reload
sudo systemctl enable nginx
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl enable qpilot-runtime
sudo systemctl restart qpilot-runtime

if grep -q '^BACKUP_S3_BUCKET=' "$RUNTIME_ENV_FILE" && grep -q '^BACKUP_ENCRYPTION_KEY=' "$RUNTIME_ENV_FILE"; then
  sudo systemctl enable qpilot-backup.timer
  sudo systemctl restart qpilot-backup.timer
  echo "backup_timer_enabled=$(sudo systemctl is-enabled qpilot-backup.timer 2>/dev/null || true)"
  echo "backup_timer_next=$(sudo systemctl show qpilot-backup.timer --property=NextElapseUSecRealtime --value 2>/dev/null || true)"
else
  sudo systemctl disable --now qpilot-backup.timer || true
  echo "backup_timer_state=intentionally_disabled"
fi

CERTBOT_DOMAINS=(-d "$DOMAIN")
if [ -n "$PUBLIC_DOMAIN" ]; then
  CERTBOT_DOMAINS+=(-d "$PUBLIC_DOMAIN")
fi

sudo certbot --nginx --non-interactive --agree-tos --redirect -m "$CERT_EMAIL" "\${CERTBOT_DOMAINS[@]}"
sudo systemctl enable certbot.timer
sudo systemctl restart nginx

sudo rm -rf "$REMOTE_STAGING"
echo "bootstrap_complete"
`.trim();
};

const createUpdateRemoteScript = async (input: {
  options: UpdateOptions;
  paths: DeployPaths;
  backupStamp: string;
}): Promise<string> => {
  const pnpmVersion = await getPnpmVersion();
  const remoteStagingDir = `${input.paths.sharedDir}/deploy-staging`;

  return `
set -euo pipefail

APP_USER=${shellQuote(DEFAULT_APP_USER)}
APP_DIR=${shellQuote(input.paths.appDir)}
BACKUPS_DIR=${shellQuote(input.paths.backupsDir)}
RUNTIME_ENV_FILE=${shellQuote(input.paths.runtimeEnvFile)}
SYSTEMD_UNIT=${shellQuote(input.paths.systemdUnitPath)}
BACKUP_SYSTEMD_UNIT=${shellQuote(input.paths.backupSystemdUnitPath)}
BACKUP_TIMER_UNIT=${shellQuote(input.paths.backupTimerUnitPath)}
NGINX_SITE=${shellQuote(input.paths.nginxSitePath)}
REMOTE_STAGING=${shellQuote(remoteStagingDir)}
REF=${shellQuote(input.options.ref)}
BACKUP_STAMP=${shellQuote(input.backupStamp)}
PNPM_VERSION=${shellQuote(pnpmVersion)}
SNAPSHOT_DIR="$BACKUPS_DIR/$BACKUP_STAMP"

sudo -n true
sudo install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$SNAPSHOT_DIR"

CURRENT_COMMIT="$(sudo -H -u "$APP_USER" git -C "$APP_DIR" rev-parse HEAD)"
printf '%s\\n' "$CURRENT_COMMIT" | sudo tee "$SNAPSHOT_DIR/previous_commit.txt" >/dev/null

if [ -f "$RUNTIME_ENV_FILE" ]; then
  sudo cp "$RUNTIME_ENV_FILE" "$SNAPSHOT_DIR/runtime.env"
  sudo chown root:"$APP_USER" "$SNAPSHOT_DIR/runtime.env"
  sudo chmod 640 "$SNAPSHOT_DIR/runtime.env"
fi

DB_PATH="$(awk -F= '/^DATABASE_URL=/{print $2; exit}' "$RUNTIME_ENV_FILE" || true)"
if [ -n "$DB_PATH" ] && [ -f "$DB_PATH" ]; then
  sudo cp "$DB_PATH" "$SNAPSHOT_DIR/$(basename "$DB_PATH")"
  sudo chown "$APP_USER":"$APP_USER" "$SNAPSHOT_DIR/$(basename "$DB_PATH")"
  sudo chmod 640 "$SNAPSHOT_DIR/$(basename "$DB_PATH")"
fi

sudo -H -u "$APP_USER" git -C "$APP_DIR" fetch --all --tags
if sudo -H -u "$APP_USER" git -C "$APP_DIR" rev-parse --verify --quiet "origin/$REF^{commit}" >/dev/null 2>&1; then
  sudo -H -u "$APP_USER" git -C "$APP_DIR" checkout -B "$REF" "origin/$REF"
else
  sudo -H -u "$APP_USER" git -C "$APP_DIR" checkout "$REF"
fi

if [ -f "$REMOTE_STAGING/runtime.env" ]; then
  sudo install -d -m 750 -o root -g "$APP_USER" "$(dirname "$RUNTIME_ENV_FILE")"
  sudo install -m 640 -o root -g "$APP_USER" "$REMOTE_STAGING/runtime.env" "$RUNTIME_ENV_FILE"
fi

sudo install -m 644 -o root -g root "$REMOTE_STAGING/qpilot-runtime.service" "$SYSTEMD_UNIT"
sudo install -m 644 -o root -g root "$REMOTE_STAGING/qpilot-backup.service" "$BACKUP_SYSTEMD_UNIT"
sudo install -m 644 -o root -g root "$REMOTE_STAGING/qpilot-backup.timer" "$BACKUP_TIMER_UNIT"
if [ -f "$REMOTE_STAGING/qpilot.conf" ]; then
  sudo install -m 644 -o root -g root "$REMOTE_STAGING/qpilot.conf" "$NGINX_SITE"
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo ln -sfn "$NGINX_SITE" /etc/nginx/sites-enabled/qpilot.conf
fi

sudo corepack enable
sudo corepack prepare "pnpm@$PNPM_VERSION" --activate

sudo -H -u "$APP_USER" bash -lc "
  set -euo pipefail
  cd $APP_DIR
  export CI=1
  set -a
  source $RUNTIME_ENV_FILE
  set +a
  pnpm install --frozen-lockfile
  pnpm --filter @qpilot/runtime exec playwright install chromium
  pnpm -r build
  pnpm --filter @qpilot/runtime run db:migrate
"

sudo systemctl daemon-reload
sudo nginx -t
sudo systemctl restart qpilot-runtime
if grep -q '^BACKUP_S3_BUCKET=' "$RUNTIME_ENV_FILE" && grep -q '^BACKUP_ENCRYPTION_KEY=' "$RUNTIME_ENV_FILE"; then
  sudo systemctl enable qpilot-backup.timer
  sudo systemctl restart qpilot-backup.timer
  echo "backup_timer_enabled=$(sudo systemctl is-enabled qpilot-backup.timer 2>/dev/null || true)"
  echo "backup_timer_next=$(sudo systemctl show qpilot-backup.timer --property=NextElapseUSecRealtime --value 2>/dev/null || true)"
else
  sudo systemctl disable --now qpilot-backup.timer || true
  echo "backup_timer_state=intentionally_disabled"
fi
sudo systemctl reload nginx
sudo rm -rf "$REMOTE_STAGING"
echo "update_complete"
`.trim();
};

const renderDeployFiles = async (input: {
  paths: DeployPaths;
  domain?: string;
  publicDomain?: string;
  runtimeEnvContents?: string;
}): Promise<DeployPlanFile[]> => {
  const files: DeployPlanFile[] = [];

  if (input.runtimeEnvContents !== undefined) {
    files.push({
      remoteName: "runtime.env",
      remoteInstallPath: input.paths.runtimeEnvFile,
      contents: input.runtimeEnvContents
    });
  }

  if (input.domain) {
    const nginxConfig = await renderTemplate(nginxTemplatePath, {
      PRIVATE_DOMAIN: input.domain,
      WEB_DIST_DIR: input.paths.webDistDir,
      PUBLIC_SERVER_BLOCK: buildPublicServerBlock({
        publicDomain: input.publicDomain,
        webDistDir: input.paths.webDistDir
      })
    });
    files.push({
      remoteName: "qpilot.conf",
      remoteInstallPath: input.paths.nginxSitePath,
      contents: nginxConfig
    });
  }

  const systemdUnit = await renderTemplate(systemdTemplatePath, {
    APP_USER: DEFAULT_APP_USER,
    APP_DIR: input.paths.appDir,
    DEPLOY_ROOT: input.paths.deployRoot,
    RUNTIME_ENV_FILE: input.paths.runtimeEnvFile
  });
  const backupSystemdUnit = await renderTemplate(backupSystemdTemplatePath, {
    APP_USER: DEFAULT_APP_USER,
    APP_DIR: input.paths.appDir,
    RUNTIME_ENV_FILE: input.paths.runtimeEnvFile
  });
  const backupTimerUnit = await renderTemplate(backupTimerTemplatePath, {});

  files.push({
    remoteName: "qpilot-runtime.service",
    remoteInstallPath: input.paths.systemdUnitPath,
    contents: systemdUnit
  });
  files.push({
    remoteName: "qpilot-backup.service",
    remoteInstallPath: input.paths.backupSystemdUnitPath,
    contents: backupSystemdUnit
  });
  files.push({
    remoteName: "qpilot-backup.timer",
    remoteInstallPath: input.paths.backupTimerUnitPath,
    contents: backupTimerUnit
  });

  return files;
};

export const buildBootstrapPlan = async (
  options: BootstrapOptions
): Promise<DeployPlan> => {
  const paths = derivePaths(options.deployRoot, options.runtimeEnvFile);
  const runtimeEnvContents = await buildRuntimeEnv({
    runtimeEnvSourcePath: options.runtimeEnvSource,
    domain: options.domain,
    publicDomain: options.publicDomain,
    paths
  });
  const files = await renderDeployFiles({
    paths,
    domain: options.domain,
    publicDomain: options.publicDomain,
    runtimeEnvContents
  });

  return {
    title: "QPilot bootstrap deployment",
    summary: [
      `Host: ${options.sshUser}@${options.host}:${options.sshPort}`,
      `Domain: ${options.domain}`,
      ...(options.publicDomain ? [`Public domain: ${options.publicDomain}`] : []),
      `Repo: ${options.repoUrl} @ ${options.ref}`,
      `Deploy root: ${paths.deployRoot}`
    ],
    remoteScript: await createBootstrapRemoteScript({ options, paths }),
    files,
    derived: {
      paths,
      domain: options.domain,
      repoUrl: options.repoUrl,
      ref: options.ref
    }
  };
};

export const buildUpdatePlan = async (
  options: UpdateOptions
): Promise<DeployPlan> => {
  if (options.publicDomain && !options.domain) {
    throw new Error("--public-domain requires --domain for deploy:update.");
  }

  const paths = derivePaths(options.deployRoot, options.runtimeEnvFile);
  const backupStamp = createBackupStamp();
  const runtimeEnvContents =
    options.runtimeEnvSource && options.domain
      ? await buildRuntimeEnv({
          runtimeEnvSourcePath: options.runtimeEnvSource,
          domain: options.domain,
          publicDomain: options.publicDomain,
          paths
        })
      : undefined;
  const files = await renderDeployFiles({
    paths,
    domain: options.domain,
    publicDomain: options.publicDomain,
    runtimeEnvContents
  });

  return {
    title: "QPilot rolling update",
    summary: [
      `Host: ${options.sshUser}@${options.host}:${options.sshPort}`,
      `Ref: ${options.ref}`,
      `Deploy root: ${paths.deployRoot}`,
      options.domain ? `Domain: ${options.domain}` : "Domain: reuse remote nginx config",
      ...(options.publicDomain ? [`Public domain: ${options.publicDomain}`] : []),
      `Snapshot: ${paths.backupsDir}/${backupStamp}`
    ],
    remoteScript: await createUpdateRemoteScript({ options, paths, backupStamp }),
    files,
    derived: {
      paths,
      domain: options.domain ?? "",
      ref: options.ref,
      backupStamp
    }
  };
};

const renderFilePreview = (file: DeployPlanFile): string =>
  [`--- ${file.remoteName} -> ${file.remoteInstallPath}`, file.contents.trimEnd(), ""].join("\n");

export const renderDryRunPlan = (plan: DeployPlan): string =>
  [
    `[dry-run] ${plan.title}`,
    "",
    ...plan.summary,
    "",
    "[files]",
    ...plan.files.map(renderFilePreview),
    "[remote-script]",
    plan.remoteScript
  ].join("\n");

interface CommandOptions {
  command: string;
  args: string[];
  cwd?: string;
  input?: string;
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

const runCommand = async (options: CommandOptions): Promise<CommandResult> => {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    stdio: "pipe"
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    process.stderr.write(chunk);
  });

  if (options.input) {
    child.stdin.end(options.input);
  } else {
    child.stdin.end();
  }

  const code = await new Promise<number>((resolveCode, reject) => {
    child.on("error", reject);
    child.on("close", (closeCode) => resolveCode(closeCode ?? 1));
  });

  if (code !== 0) {
    throw new Error(
      `${options.command} ${options.args.join(" ")} failed with exit code ${code}.\n${stderr || stdout}`
    );
  }

  return { code, stdout, stderr };
};

const buildSshBaseArgs = (input: CommonDeployOptions): string[] => {
  const args = [
    "-p",
    String(input.sshPort),
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new"
  ];

  if (input.sshKeyPath) {
    args.push("-i", input.sshKeyPath);
  }

  return args;
};

const runRemoteScript = async (
  options: CommonDeployOptions,
  script: string
): Promise<void> => {
  const args = [
    ...buildSshBaseArgs(options),
    `${options.sshUser}@${options.host}`,
    "bash",
    "-s"
  ];

  await runCommand({
    command: "ssh",
    args,
    input: `${script}\n`
  });
};

export const captureRemote = async (
  options: CommonDeployOptions,
  command: string
): Promise<string> => {
  const args = [
    ...buildSshBaseArgs(options),
    `${options.sshUser}@${options.host}`,
    "bash",
    "-lc",
    command
  ];

  const result = await runCommand({
    command: "ssh",
    args
  });

  return result.stdout.trim();
};

const uploadPlanFiles = async (
  options: CommonDeployOptions,
  plan: DeployPlan
): Promise<void> => {
  const localStagingRoot = await mkdtemp(resolve(tmpdir(), "qpilot-deploy-"));
  try {
    for (const file of plan.files) {
      await writeFile(resolve(localStagingRoot, file.remoteName), file.contents, "utf8");
    }

    const remoteStagingDir = `${plan.derived.paths.sharedDir}/deploy-staging`;
    await captureRemote(options, `sudo install -d -m 755 ${shellQuote(remoteStagingDir)}`);

    const scpArgs = [
      "-P",
      String(options.sshPort),
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new"
    ];

    if (options.sshKeyPath) {
      scpArgs.push("-i", options.sshKeyPath);
    }

    for (const file of plan.files) {
      scpArgs.push(resolve(localStagingRoot, file.remoteName));
    }
    scpArgs.push(`${options.sshUser}@${options.host}:${remoteStagingDir}/`);

    await runCommand({
      command: "scp",
      args: scpArgs
    });
  } finally {
    await rm(localStagingRoot, { recursive: true, force: true });
  }
};

export const createBackupStamp = (): string =>
  new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

const ensureLocalTool = async (command: string): Promise<void> => {
  const locator = process.platform === "win32" ? "where" : "which";
  await runCommand({
    command: locator,
    args: [command]
  });
};

const ensureDnsResolvable = async (domain: string): Promise<void> => {
  await lookup(domain);
};

const ensurePortStatus = async (
  options: CommonDeployOptions,
  mode: "bootstrap" | "update"
): Promise<void> => {
  const output = await captureRemote(
    options,
    `sudo ss -ltnp '( sport = :80 or sport = :443 )' || true`
  );
  const normalized = output.toLowerCase();
  if (!normalized.includes("listen")) {
    return;
  }
  if (mode === "update" && normalized.includes("nginx")) {
    return;
  }
  throw new Error(
    `Remote ports 80/443 are already in use by a non-nginx process.\n${output}`
  );
};

export const runBootstrapPrechecks = async (
  options: BootstrapOptions
): Promise<void> => {
  await ensureLocalTool("ssh");
  await ensureLocalTool("scp");
  await ensureDnsResolvable(options.domain);
  if (options.publicDomain) {
    await ensureDnsResolvable(options.publicDomain);
  }
  await captureRemote(options, "sudo -n true && echo ready");
  await ensurePortStatus(options, "bootstrap");
};

export interface UpdatePreflight {
  previousCommit: string;
  runtimeEnvPresent: boolean;
}

export const runUpdatePrechecks = async (
  options: UpdateOptions
): Promise<UpdatePreflight> => {
  await ensureLocalTool("ssh");
  await ensureLocalTool("scp");
  if (options.domain) {
    await ensureDnsResolvable(options.domain);
  }
  if (options.publicDomain) {
    await ensureDnsResolvable(options.publicDomain);
  }
  await captureRemote(options, "sudo -n true && echo ready");
  await ensurePortStatus(options, "update");

  const appDir = `${options.deployRoot}/app`;
  const previousCommit = await captureRemote(
    options,
    `test -d ${shellQuote(appDir)}/.git && git -C ${shellQuote(appDir)} rev-parse HEAD`
  );
  const runtimeEnvPresent =
    (
      await captureRemote(
        options,
        `if [ -f ${shellQuote(options.runtimeEnvFile)} ]; then echo yes; else echo no; fi`
      )
    ) === "yes";

  return {
    previousCommit,
    runtimeEnvPresent
  };
};

export const executePlan = async (
  options: CommonDeployOptions,
  plan: DeployPlan
): Promise<void> => {
  if (options.dryRun) {
    console.log(renderDryRunPlan(plan));
    return;
  }

  await uploadPlanFiles(options, plan);
  await runRemoteScript(options, plan.remoteScript);
};

export const runSmokeChecks = async (
  options: SmokeOptions
): Promise<SmokeCheckResult[]> => {
  const verification = await runPlatformSmokeVerification({
    baseUrl: options.baseUrl,
    publicBaseUrl: options.publicBaseUrl,
    metricsToken: options.metricsToken,
    expectRegistrationClosed: options.expectRegistrationClosed,
    timeoutMs: options.timeoutMs
  });
  const checks = verification.checks.map((check) => ({
    name: check.label,
    ok: check.state !== "failed",
    status: check.status ?? (check.state === "skipped" ? 0 : 200),
    detail: check.detail
  }));
  if (!verification.ok) {
    const failureLines = checks
      .filter((check) => !check.ok)
      .map((check) => `${check.name}: ${check.status} (${check.detail})`);
    throw new Error(`Platform smoke verification failed.\n${failureLines.join("\n")}`);
  }
  return checks;
};

export const formatSmokeResults = (results: SmokeCheckResult[]): string =>
  results.map((result) => `- ${result.name}: ${result.status} (${result.detail})`).join("\n");

export const buildRollbackInstructions = (input: {
  options: UpdateOptions;
  previousCommit: string;
  backupStamp: string;
}): string => {
  const paths = derivePaths(input.options.deployRoot, input.options.runtimeEnvFile);
  const snapshotDir = `${paths.backupsDir}/${input.backupStamp}`;

  return [
    "Update failed. Roll back with:",
    `ssh -p ${input.options.sshPort} ${input.options.sshUser}@${input.options.host} \\`,
    `  "sudo install -m 640 -o root -g ${DEFAULT_APP_USER} ${shellQuote(`${snapshotDir}/runtime.env`)} ${shellQuote(paths.runtimeEnvFile)} && \\`,
    `   sudo -H -u ${DEFAULT_APP_USER} git -C ${shellQuote(paths.appDir)} checkout ${shellQuote(
      input.previousCommit
    )} && \\`,
    `   sudo systemctl restart qpilot-runtime && sudo systemctl reload nginx"`
  ].join("\n");
};

export const packagePaths = {
  packageRoot,
  repoRoot,
  nginxTemplatePath,
  systemdTemplatePath,
  backupSystemdTemplatePath,
  backupTimerTemplatePath
};
