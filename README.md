# QPilot Studio

Local-first AI QA and testing platform for individual developers and small teams.

It opens browsers with Playwright, collects page context, asks an OpenAI-compatible LLM for structured test actions, executes actions, verifies outcomes, persists steps and test cases, and generates HTML and Excel reports. The current codebase also includes a growing platform layer for load testing, environment management, release gating, tenant-scoped auth, and ops visibility.

## Stack

- Monorepo: `pnpm workspace`
- Web: React + Vite + TypeScript + Tailwind + Zustand
- Runtime: Node.js + TypeScript + Fastify
- Browser automation: Playwright
- DB: SQLite + Drizzle ORM
- Realtime: SSE + WebSocket live video stream
- AI: OpenAI-compatible gateway (`baseURL + apiKey + model`)

## Workspace Layout

```txt
apps/
  desktop/
  runtime/
  web/
infra/
  deploy/
  nginx/
  prometheus/
  systemd/
packages/
  ai-gateway/
  prompt-packs/
  report-core/
  shared/
auto_find_jobs/
```

## Quick Start

1. Install dependencies

```bash
pnpm install
```

2. Configure env

```bash
cp .env.example .env
```

3. Install Playwright browser

```bash
pnpm --filter @qpilot/runtime exec playwright install chromium
```

4. Start runtime and web

```bash
pnpm dev:runtime
pnpm dev:web
```

5. Recommended: launch the desktop cockpit

```bash
pnpm dev:desktop
```

- Web: `http://localhost:5173`
- Runtime: `http://localhost:8787`
- Health: `GET http://localhost:8787/health`
- Desktop shell: Electron app hosting the web console and live browser feed

## Build, Lint, And Test

```bash
pnpm -r build
pnpm -r lint
pnpm -r test
```

Web fixture E2E:

```bash
pnpm --filter @qpilot/web run test:e2e
```

## Single-Host Deployment

For a public Ubuntu host, the repo now includes SSH deployment automation:

```bash
pnpm deploy:bootstrap -- --host <host> --ssh-user <user> --domain <domain> --repo-url <repo> --ref main --cert-email <email> --runtime-env-source <local-env-file>
pnpm deploy:update -- --host <host> --ssh-user <user> --ref main --domain <domain> --runtime-env-source <local-env-file>
pnpm deploy:smoke -- --base-url https://<domain> --metrics-token <METRICS_BEARER_TOKEN>
```

Deployment docs:

- `docs/DEPLOYMENT-101.zh-CN.md`
- `docs/DEPLOY-RUNBOOK.zh-CN.md`
- `docs/OBSERVABILITY-101.zh-CN.md`
- `docs/BACKUP-RESTORE-101.zh-CN.md`

## Runtime Env

See `.env.example`. Key fields:

- `OPENAI_BASE_URL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `CREDENTIAL_MASTER_KEY` (64-char hex, AES-256-GCM key)
- `DATABASE_URL`
- `ARTIFACTS_DIR`
- `REPORTS_DIR`
- `SESSIONS_DIR`
- `PLATFORM_METRICS_ENABLED`
- `METRICS_BEARER_TOKEN`
- `BACKUP_S3_BUCKET`
- `BACKUP_ENCRYPTION_KEY`
- `OPENAI_TIMEOUT_MS`

## Current Capabilities

### Functional lane

- Project management and credential storage
- Run history with live status updates
- Create run with URL + username/password + mode
- Playwright navigation and page snapshot collection
- Structured LLM planning with zod validation and retry
- Action execution (`click/input/select/navigate/wait`)
- Overlay dismissal and visible-element fallback
- Security challenge detection and manual takeover flow
- Session reuse with named storage-state profiles
- Video capture, HTML report, and Excel report generation
- Step, run, and testcase persistence with replay and compare support
- Benchmark scenarios, scenario history, and comparison views
- Case extraction plus template replay and repair draft workflows
- Realtime SSE events and WebSocket live browser stream

### Platform lane

- Control Tower overview
- Load Studio with load profiles and load run history
- Environment registry and injector pool management
- Release Gate Center with gate policies, waivers, and approvals
- Release candidate aggregation across functional and load signals
- Release detail pages with approvals, waivers, and evidence deep links
- Owner-only ops summary page with readiness, dependency, queue, and alert snapshots
- Owner-only shared-directory backup and restore control plane with S3-compatible snapshots
- Global maintenance page that activates automatically during restore windows
- Desktop cockpit with live control actions for the active run

## Seed Prompts

- `packages/prompt-packs/src/seeds/generic-form.md`
- `packages/prompt-packs/src/seeds/login-page.md`
- `packages/prompt-packs/src/seeds/admin-console.md`

## API Overview

- `GET /health`
- `GET /health/ready`
- `GET /metrics`
- `GET /api/auth/me`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/projects`
- `POST /api/projects`
- `PATCH /api/projects/:projectId/credentials`
- `GET /api/runtime/active-run`
- `POST /api/runs`
- `GET /api/runs/:runId`
- `GET /api/runs?projectId=&limit=` (run history)
- `GET /api/runs/:runId/steps`
- `GET /api/runs/:runId/testcases`
- `GET /api/runs/:runId/stream` (SSE)
- `GET /api/runs/:runId/live` (WebSocket live frame stream)
- `POST /api/runs/:runId/pause`
- `POST /api/runs/:runId/resume`
- `POST /api/runs/:runId/abort`
- `POST /api/runs/:runId/bring-to-front`
- `GET /api/reports/:runId`
- `GET /api/platform/control-tower`
- `GET /api/platform/ops/summary`
- `GET /api/platform/ops/backups/config`
- `GET /api/platform/ops/backups/snapshots`
- `POST /api/platform/ops/backups/run`
- `POST /api/platform/ops/backups/preflight`
- `POST /api/platform/ops/backups/restore`
- `GET /api/platform/load/profiles`
- `GET /api/platform/load/runs`
- `GET /api/platform/environments`
- `GET /api/platform/releases`
- `GET /api/platform/releases/:releaseId/gates`

## Notes

- Credentials are encrypted with AES-256-GCM before storing.
- Runtime currently supports only one active functional run at a time.
- If `OPENAI_API_KEY` is missing, the server still starts, but run execution fails with a clear message.
- If you enable visible browser plus manual takeover, captcha and login walls can be solved in the live Chromium window and resumed from the console.
- Finished runs retain a recorded browser video under the run artifacts and expose it on the report page.
- Desktop mode shows a persistent control dock with pause, resume, abort, and bring-to-front actions for the active run.
- The web console includes a global `English / 简体中文` language switcher, and new runs propagate that language into planner output and exported reports.
