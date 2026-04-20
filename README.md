# QPilot Studio (MVP)

Local-first AI QA agent platform for individual developers.

It opens browsers with Playwright, collects page context, asks an OpenAI-compatible LLM for structured test actions, executes actions, verifies outcomes, persists steps/test-cases, and generates HTML/Excel reports.

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
  web/
  runtime/
packages/
  shared/
  ai-gateway/
  prompt-packs/
  report-core/
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

## Build & Test

```bash
pnpm -r build
pnpm -r test
```

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
- `OPENAI_TIMEOUT_MS`

## MVP Features Implemented

- Project management (create/list)
- Run history page (`/runs`) with project filter and live status updates
- Create run with URL + username/password + mode
- Playwright navigation and page snapshot collection
- Independent interactive element collector module
- LLM structured JSON planning with zod validation and one retry
- Action execution (`click/input/select/navigate/wait`)
- Action hardening with overlay dismissal and visible-element fallback
- Security challenge detection (captcha / human verification / login walls)
- Manual takeover flow for challenge pages in visible-browser runs
- Session reuse with named storage-state profiles
- Run video recording stored with artifacts and embedded in reports
- High-risk action blocking (`delete/payment/order submission`)
- Verification (`urlChanged` + expected text checks)
- Step/Run/TestCase persistence (SQLite + Drizzle)
- Login abnormal-then-normal 6-scenario strategy
- Realtime run events via SSE
- Realtime browser video over WebSocket (Chromium screencast with screenshot fallback)
- HTML + Excel report generation
- Web console pages:
  - Projects
  - Create Run
  - Run live detail (left config+LLM / center screenshot / right steps+cases)
  - Report page

## Seed Prompts

- `packages/prompt-packs/src/seeds/generic-form.md`
- `packages/prompt-packs/src/seeds/login-page.md`
- `packages/prompt-packs/src/seeds/admin-console.md`

## API Overview (MVP)

- `GET /health`
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
- `POST /api/runs/:runId/resume` (continue after manual takeover)
- `POST /api/runs/:runId/abort`
- `POST /api/runs/:runId/bring-to-front` (focus the visible browser window/tab)
- `GET /api/reports/:runId`

## Notes

- Credentials are encrypted with AES-256-GCM before storing.
- Runtime supports only one active run at a time.
- If `OPENAI_API_KEY` is missing, server still starts, but run execution fails with a clear message.
- If you enable visible browser + manual takeover, captcha/login walls can be solved in the live Chromium window and resumed from the console.
- Finished runs now retain a recorded browser video under the run artifacts and expose it on the report page.
- Desktop mode now shows a persistent control dock with pause, resume, abort, and bring-to-front actions for the active run.
- The web console now includes a global `English / 简体中文` language switcher, and new runs propagate that language into planner output and exported reports.
