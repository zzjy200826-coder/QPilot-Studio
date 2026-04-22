# QPilot Studio Public Deployment 101

This guide covers the single-host public deployment model that is now built into the repo.

Recommended shape:
- `app.<domain>`: private operator console
- `www.<domain>`: public marketing site
- one `Ubuntu 24.04 LTS` host
- `Nginx + Certbot` for HTTPS
- `apps/runtime` listens on `127.0.0.1:8787`
- `apps/web/dist` is served directly by Nginx

## Directory layout

- repo checkout: `/opt/qpilot-studio/app`
- persistent data: `/opt/qpilot-studio/shared`
- ops journal: `/opt/qpilot-studio/ops`
- runtime env file: `/etc/qpilot/runtime.env`

## Deploy commands

Bootstrap:

```bash
pnpm deploy:bootstrap -- \
  --host 203.0.113.10 \
  --ssh-user ubuntu \
  --domain app.example.com \
  --public-domain www.example.com \
  --repo-url git@github.com:your-org/QPilot-Studio.git \
  --ref main \
  --cert-email ops@example.com \
  --runtime-env-source C:\deploy\runtime.env.production
```

Update:

```bash
pnpm deploy:update -- \
  --host 203.0.113.10 \
  --ssh-user ubuntu \
  --ref main \
  --domain app.example.com \
  --public-domain www.example.com \
  --runtime-env-source C:\deploy\runtime.env.production
```

Smoke:

```bash
pnpm deploy:smoke -- \
  --base-url https://app.example.com \
  --public-base-url https://www.example.com \
  --metrics-token <METRICS_BEARER_TOKEN> \
  --expect-registration-closed
```

Useful optional flags:
- `--ssh-port` default: `22`
- `--ssh-key` explicit private key path
- `--deploy-root` default: `/opt/qpilot-studio`
- `--runtime-env-file` default: `/etc/qpilot/runtime.env`
- `--dry-run` renders commands and templates without touching the host

## Minimum production env

At minimum set:

```bash
OPENAI_API_KEY=<your-openai-key>
CREDENTIAL_MASTER_KEY=<64-char-hex>
METRICS_BEARER_TOKEN=<long-random-token>
AUTH_SELF_SERVICE_REGISTRATION=false
AUTH_ALLOWED_EMAILS=you@example.com
```

If you enable instance backups, also set:

```bash
BACKUP_S3_ENDPOINT=...
BACKUP_S3_REGION=...
BACKUP_S3_BUCKET=...
BACKUP_S3_ACCESS_KEY_ID=...
BACKUP_S3_SECRET_ACCESS_KEY=...
BACKUP_ENCRYPTION_KEY=<64-char-hex>
BACKUP_RETENTION_DAYS=14
BACKUP_STALE_AFTER_HOURS=36
```

The deploy scripts derive these production values automatically:
- `NODE_ENV=production`
- `HOST=127.0.0.1`
- `PORT=8787`
- `CORS_ORIGIN=https://app.<domain>`
- `AUTH_SECURE_COOKIES=true`
- `DATABASE_URL=/opt/qpilot-studio/shared/data/qpilot.db`
- `ARTIFACTS_DIR=/opt/qpilot-studio/shared/data/artifacts`
- `REPORTS_DIR=/opt/qpilot-studio/shared/data/reports`
- `SESSIONS_DIR=/opt/qpilot-studio/shared/data/sessions`
- `PLANNER_CACHE_DIR=/opt/qpilot-studio/shared/data/planner-cache`
- `VITE_RUNTIME_BASE_URL=`
- `VITE_PRIVATE_APP_ORIGIN=https://app.<domain>`
- `VITE_PUBLIC_MARKETING_HOST=www.<domain>`
- `VITE_AUTH_SELF_SERVICE_REGISTRATION=false`

## Private single-owner access model

This deployment is meant for a private single-owner console:
- `POST /api/auth/register` is closed when `AUTH_SELF_SERVICE_REGISTRATION=false`
- only emails in `AUTH_ALLOWED_EMAILS` can sign in
- the first owner is created from the server with the bootstrap CLI
- the public site never proxies the real runtime API

After `deploy:bootstrap`, create the first owner account on the server:

```bash
export AUTH_BOOTSTRAP_OWNER_PASSWORD='<temporary-password>'
cd /opt/qpilot-studio/app
pnpm auth:bootstrap-owner -- \
  --email you@example.com \
  --display-name "Your Name" \
  --tenant-name "Private Workspace"
unset AUTH_BOOTSTRAP_OWNER_PASSWORD
```

Use the same allowlisted email later at `https://app.<domain>/login`.

## What each domain exposes

`app.<domain>`:
- private front-end shell
- `/api`, `/artifacts`, `/reports`
- `/health`, `/health/ready`, `/metrics`

`www.<domain>`:
- public marketing site only
- `/api`, `/artifacts`, `/reports`, `/health`, `/metrics` return `404`

This keeps the marketing site fully separate from the real control plane.

## Smoke expectations

After deployment, confirm:
1. `https://www.<domain>/` returns `200`
2. `https://app.<domain>/login` returns `200`
3. `GET https://app.<domain>/health` returns `200`
4. `GET https://app.<domain>/health/ready` returns `200`
5. anonymous `GET https://app.<domain>/api/platform/ops/summary` returns `401` or `403`
6. anonymous `POST https://app.<domain>/api/auth/register` returns `403`
7. anonymous `GET https://app.<domain>/metrics` is denied
8. bearer-authenticated `GET https://app.<domain>/metrics` succeeds
9. `https://www.<domain>/api/platform/ops/summary` returns `404`

## Not in scope

This deployment flow does not currently cover:
- Docker or Kubernetes
- multi-node rollout
- automated Cloudflare Access provisioning
- member invitations or team admin
- public demo access
