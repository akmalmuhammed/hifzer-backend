# Hifz OS - Complete Project Status (Backend + Frontend)

Last updated: February 11, 2026  
Workspace root: `d:\codex`

## 1) Executive Summary

This project moved from an empty workspace to a working Hifz OS MVP backend, then to a Next.js-based frontend integration with real API wiring, critical Hifz-specific logic, and end-to-end smoke coverage.

Core outcomes achieved:

- Backend architecture implemented: Node.js + TypeScript + Express + Prisma + Redis/BullMQ.
- Sparse state model implemented (no pre-creating 6,236 rows/user).
- Append-only idempotent events implemented (`clientEventId` uniqueness).
- Time-based backlog debt protection implemented (minutes, not raw item count).
- Exact SRS checkpoints implemented with hour-level precision.
- Fluency Gate hard block implemented.
- 3x3 workflow tracking and server-side protocol enforcement implemented.
- Transition tracking and weak-transition surfacing implemented.
- Promotion gate implemented (`7` consecutive perfect days before stable Manzil promotion path).
- Frontend migrated to Next.js App Router with auth/session wiring and protected routes.
- Remaining mock-heavy app screens replaced with backend-driven data (`calendar`, `achievements`, `progress`).
- Playwright E2E critical journeys added and passing.

## 2) Starting Point (Initial State)

At project start:

- `d:\codex` was empty.
- No backend scaffold.
- No frontend integration.
- No database schema, migrations, tests, or seed pipeline.

## 3) Chronological Progress (From Start to Now)

## Phase A - Backend MVP Foundation

- Scaffolded backend project structure and TypeScript runtime.
- Added Express app bootstrap and middleware:
  - `helmet`, `cors`, `cookie-parser`, JSON parser, `pino-http`.
- Added config and runtime support:
  - environment loading, logger, centralized error middleware, auth middleware.
- Added local infrastructure via Docker compose (Postgres + Redis).

Key files:

- `backend/src/app.ts`
- `backend/src/server.ts`
- `backend/docker-compose.yml`
- `backend/src/middleware/auth.ts`
- `backend/src/middleware/error.ts`
- `backend/src/lib/*`

## Phase B - Prisma Schema and Core Data Model

Implemented schema for MVP and critical features:

- `User`
- `RefreshToken`
- `Ayah`
- `UserItemState` (sparse)
- `SessionRun`
- `ReviewEvent` (append-only idempotent stream)
- `DailySession`
- `TransitionScore`
- `FluencyGateTest`

Important guarantees implemented:

- Scheduling uses `nextReviewAt` + `reviewIntervalSeconds` (supports hours and days).
- Sparse user state (`UserItemState` created only when user actually starts an ayah).
- Idempotent ingest via `ReviewEvent @@unique([userId, clientEventId])`.
- Transition pairs tracked as composite key in `TransitionScore`.

Schema location:

- `backend/prisma/schema.prisma`

Migrations present:

- `20260211031144_init`
- `20260211071247_add_critical_features`
- `20260211092350_add_assessment_scaffolding_v2`

## Phase C - Seed and Quran Data Pipeline

Implemented reproducible local seed strategy and script pipeline:

- Metadata extraction from Tanzil `quran-data.js`.
- Canonical ayah build by merging Tanzil text + metadata.
- Local seeding into Postgres.
- No runtime internet fetch in app code.

Scripts:

- `backend/scripts/build-ayah-metadata-from-quran-data.ts`
- `backend/scripts/build-canonical-ayah-seed.ts`
- `backend/prisma/seed.ts`

NPM scripts:

- `seed:metadata`
- `seed:build`
- `seed`

## Phase D - Auth, Assessment, and User Configuration

Implemented auth API and refresh rotation model:

- `POST /api/v1/auth/signup`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`

Assessment implementation includes required fields and logic:

- Accepts:
  - `time_budget_minutes`: `15 | 30 | 60 | 90`
  - `fluency_score`
  - `tajwid_confidence`
  - `goal`
  - `has_teacher`
  - `prior_juz_band`
- Persists adaptive defaults on user.
- Assigns scaffolding level:
  - `BEGINNER` / `STANDARD` / `MINIMAL`
- Supports conservative `15` minute plan with warning and capped new ayahs.

Files:

- `backend/src/modules/auth/*`
- `backend/src/modules/assessment/*`

## Phase E - Queue Engine and Debt Protection

Implemented `GET /api/v1/queue/today` with required behavior:

- Modes:
  - `FLUENCY_GATE_REQUIRED`
  - `NORMAL`
  - `REVIEW_ONLY`
  - `CONSOLIDATION`
- Debt computed by estimated effort:
  - `backlogMinutesEstimate`
  - `overdueDaysMax`
  - freeze threshold from `timeBudgetMinutes * backlogFreezeRatio`
- Warmup gating from yesterday's introduced items.
- Sabaq blocked when debt/warmup conditions fail.
- Sabqi sorted by risk.
- Manzil uses rotation parameter (`manzilRotationDays`, default 30).
- Weak transitions included and `link_repair_recommended` set when needed.

File:

- `backend/src/modules/queue/queue.service.ts`

## Phase F - Session Protocol, Event Ingest, Reducer

Implemented session endpoints:

- `POST /api/v1/session/start`
- `POST /api/v1/session/step-complete`
- `POST /api/v1/review/event`
- `POST /api/v1/session/complete`

Implemented append-only + deterministic state updates:

- Ingests review and transition events.
- Deduplicates by `clientEventId`.
- Enqueues reducer jobs via BullMQ.
- Supports inline fallback processing.

Implemented strict server-side step sequencing:

- Scaffolding-specific required protocol enforcement.
- Rejects invalid sequence with `409 INVALID_STEP_SEQUENCE`.
- Returns protocol guidance (`next_step`, `next_attempt`, `step_status`, `protocol`).

Files:

- `backend/src/modules/session/session.service.ts`
- `backend/src/modules/session/session.schemas.ts`
- `backend/src/modules/session/reducer.service.ts`
- `backend/src/queues/*`

## Phase G - Critical Features (Hifz-Specific)

Implemented critical Hifz differentiators:

1. Fluency Gate hard prerequisite.
2. 3x3 workflow fields:
   - `sessionType`, `stepType`, `attemptNumber`, `scaffoldingUsed`, `linkedAyahId`.
3. Transition performance DB and weak transition surfacing.
4. Promotion gate using `consecutivePerfectDays`.
5. Exact SRS checkpoints:
   - `4h -> 8h -> 1d -> 3d -> 7d -> 14d -> 30d -> 90d`.

Spacing engine file:

- `backend/src/lib/spacing.ts`

## Phase H - Next.js Migration and Frontend Integration

Created and evolved `frontend-next` as App Router migration from the Vite prototype:

- Public marketing pages and protected app pages migrated.
- Auth bootstrap and session management added.
- Protected route guarding via middleware/proxy cookie check.
- API contracts centralized in `frontend-next/lib/api.ts`.
- Dark mode/theme system and security headers/CSP added.
- Recitation-first session flow wired to `step-complete`.

Core frontend integration pages:

- `/assessment`
- `/fluency-gate`
- `/today`
- `/session/[sessionId]`
- `/practice/transitions`
- `/settings`
- `/calendar`
- `/achievements`
- `/progress`

## Phase I - Replacing Remaining Mock Blocks

Completed live-data replacements in the app pages that were still mock-driven:

- `frontend-next/app/(app)/calendar/page.tsx`
  - now uses `GET /api/v1/user/calendar`
- `frontend-next/app/(app)/achievements/page.tsx`
  - now uses `GET /api/v1/user/achievements`
- `frontend-next/app/(app)/progress/page.tsx`
  - now uses `GET /api/v1/user/progress`

Backend analytics endpoints added:

- `GET /api/v1/user/stats`
- `GET /api/v1/user/calendar`
- `GET /api/v1/user/achievements`
- `GET /api/v1/user/progress`

Files:

- `backend/src/modules/user/user.routes.ts`
- `backend/src/modules/user/user.schemas.ts`
- `backend/src/modules/user/user.service.ts`
- `frontend-next/lib/api.ts`

## Phase J - End-to-End Smoke Coverage

Added Playwright and E2E suite in frontend-next:

- `frontend-next/playwright.config.ts`
- `frontend-next/tests/e2e/critical-journey.spec.ts`

Covered journeys:

1. `signup -> assessment -> fluency gate -> today -> session completion`
2. `login -> today`

Important note:

- E2E currently uses mocked API responses for deterministic UI/integration flow validation.
- This is not yet full live backend+DB browser E2E.

## 4) Current API Inventory (Backend)

Base: `/api/v1`

Auth:

- `POST /auth/signup`
- `POST /auth/login`
- `POST /auth/refresh`

Assessment:

- `POST /assessment/submit`

Fluency Gate:

- `POST /fluency-gate/start`
- `POST /fluency-gate/submit`
- `GET /fluency-gate/status`

Queue:

- `GET /queue/today`

Session and Events:

- `POST /session/start`
- `POST /session/step-complete`
- `POST /session/complete`
- `POST /review/event`

User analytics:

- `GET /user/stats`
- `GET /user/calendar`
- `GET /user/achievements`
- `GET /user/progress`

Health:

- `GET /health`

## 5) Current Test Status

Backend unit tests:

- 12 spec files:
  - `assessment-defaults.spec.ts`
  - `fluency-gate.spec.ts`
  - `idempotency.spec.ts`
  - `linking-workflow.spec.ts`
  - `manzil-rotation.spec.ts`
  - `promotion-gate.spec.ts`
  - `queue-mode.spec.ts`
  - `session-sequence.spec.ts`
  - `spacing-engine.spec.ts`
  - `srs-checkpoints.spec.ts`
  - `transition-tracking.spec.ts`
  - `warmup-mode.spec.ts`
- Latest run result: all passing (`26` tests).

Frontend checks:

- `pnpm lint` passing.
- `pnpm build` passing.
- Playwright E2E: `2/2` passing.

## 6) What Is Implemented vs Pending

Implemented now:

- MVP backend endpoints and core logic.
- Critical Hifz features (fluency gate, 3x3 metadata, transitions, promotion gate, exact checkpoints).
- Prior experience (`prior_juz_band`) and scaffolding assignment.
- 15-minute conservative plan support.
- Real-data integration for key app pages.
- E2E smoke tests for critical user journey.

Still pending / not fully finished:

- Pixel-perfect parity audit is improved but not certified as exact frame-by-frame parity.
- E2E with real backend + real Postgres/Redis (browser-level full integration) not yet added.
- Backend lint config has pre-existing repository-wide issues (global `no-undef` style errors in existing files/config); build/tests pass.
- Production deployment hardening:
  - finalized CSP for production domains
  - CI pipeline gates
  - observability/alerting
  - rate-limit policy hardening and abuse controls

## 7) Known Risks and Notes

- Some terminal outputs may display Arabic text with encoding artifacts; persisted data files and DB text remain UTF-8.
- Queue weak-transition query uses raw SQL with UUID validation guard; acceptable for MVP, can be converted later.
- Refresh token strategy is currently access token in memory + refresh token in local storage on frontend-next, with rotation on backend.

## 8) Current Workspace State (Important)

This workspace currently has many uncommitted changes, including:

- backend schema and module updates
- new user analytics service/routes
- frontend-next full tree (migrated app)
- new tests and migration folders

Before release, recommended:

1. group and commit by logical slices (backend feature, frontend feature, tests/docs)
2. run final migration + seed + smoke in clean environment
3. tag a release candidate after full integration QA

## 9) Quick Runbook

Backend:

1. `cd backend`
2. `pnpm install`
3. `docker compose up -d`
4. `pnpm prisma migrate deploy`
5. `pnpm prisma generate`
6. `pnpm seed` (or full seed build flow)
7. `pnpm dev`
8. `pnpm worker`

Frontend:

1. `cd frontend-next`
2. `pnpm install`
3. set `NEXT_PUBLIC_API_BASE_URL`
4. `pnpm dev`

Validation:

1. backend: `pnpm test && pnpm build`
2. frontend: `pnpm lint && pnpm build && pnpm test:e2e`

