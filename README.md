# Hifz OS MVP Backend

Node.js + TypeScript + Express backend for Hifz OS MVP.

## Stack

- API: Express + Zod
- DB: Postgres + Prisma
- Queue/worker: Redis + BullMQ
- Tests: Vitest

## Prerequisites

- Node.js 20+
- pnpm 10+
- Docker (for local Postgres/Redis)

## Run locally

1. Copy env file:

```bash
cp .env.example .env
```

2. Start Postgres + Redis:

```bash
docker compose up -d
```

3. Install deps:

```bash
pnpm install
```

4. Apply migration:

```bash
pnpm prisma migrate deploy
pnpm prisma generate
```

5. Seed ayah metadata (quick template):

```bash
pnpm seed
```

6. Run API:

```bash
pnpm dev
```

7. Run reducer worker (separate terminal):

```bash
pnpm worker
```

## Seed data notes

- Local-only seed, no network fetch.
- Default file: `prisma/seeds/ayahs.template.json`.
- For full dataset, set `AYAHS_SEED_PATH` to a local JSON with all 6,236 ayahs.

## Build full 6,236 ayah seed from scratch (recommended)

Use Tanzil text as canonical Arabic content and merge with your local ayah metadata (juz/page/hizb mapping).

1. Download metadata source and convert it:

```bash
curl -L -o prisma/seeds/quran-data.js "https://tanzil.net/res/text/metadata/quran-data.js"
pnpm seed:metadata -- \
  --in prisma/seeds/quran-data.js \
  --out prisma/seeds/ayah-metadata.json
```

2. Download Tanzil Uthmani text:

```bash
curl -L -o prisma/seeds/tanzil-uthmani.txt "https://tanzil.net/pub/download/index.php?quranType=uthmani&outType=txt-2&agree=true&marks=true&sajdah=true&tatweel=true"
```

3. Confirm local source files (both are gitignored):

- `prisma/seeds/tanzil-uthmani.txt` (line format: `surah|ayah|text`)
- `prisma/seeds/ayah-metadata.json` (generated from `quran-data.js`)

4. Build canonical merged JSON:

```bash
pnpm seed:build -- \
  --tanzil prisma/seeds/tanzil-uthmani.txt \
  --metadata prisma/seeds/ayah-metadata.json \
  --out prisma/seeds/ayahs.full.json
```

5. Seed Postgres from the generated file:

```bash
AYAHS_SEED_PATH=./prisma/seeds/ayahs.full.json pnpm seed
```

PowerShell alternative:

```powershell
$env:AYAHS_SEED_PATH="./prisma/seeds/ayahs.full.json"; pnpm seed
```

Notes:

- Builder validates duplicate/missing ayahs and enforces `6236` rows unless `--allow-partial` is set.
- This backend keeps `user_item_state` sparse: rows are created only when memorization starts (no pre-creation of all ayahs).
- Queue debt protection is effort/time based (minutes), not raw due-item count.

## API examples (curl)

## Critical Phase 2 behavior

- `GET /api/v1/queue/today` returns `mode: "FLUENCY_GATE_REQUIRED"` until the user passes the fluency gate.
- Review events now support 3x3 workflow metadata:
  - `session_type`: `SABAQ | SABQI | MANZIL | WARMUP`
  - `step_type`: `EXPOSURE | GUIDED | BLIND | LINK`
  - `attempt_number`: `1..3`
  - `scaffolding_used`: `true|false`
  - `linked_ayah_id`: required for `step_type=LINK`
- Sabqi -> Manzil promotion is gated by `7` consecutive perfect review days.
- SRS checkpoints are exact:
  - `4h -> 8h -> 1d -> 3d -> 7d -> 14d -> 30d -> 90d`

### Signup

```bash
curl -X POST http://localhost:4000/api/v1/auth/signup \
  -H "content-type: application/json" \
  -d '{"email":"user@example.com","password":"StrongPass123"}'
```

### Login

```bash
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "content-type: application/json" \
  -d '{"email":"user@example.com","password":"StrongPass123"}'
```

### Submit assessment

```bash
curl -X POST http://localhost:4000/api/v1/assessment/submit \
  -H "authorization: Bearer <ACCESS_TOKEN>" \
  -H "content-type: application/json" \
  -d '{
    "time_budget_minutes": 60,
    "fluency_score": 55,
    "tajwid_confidence": "MED",
    "goal": "FULL_QURAN",
    "has_teacher": true
  }'
```

### Start fluency gate test

```bash
curl -X POST http://localhost:4000/api/v1/fluency-gate/start \
  -H "authorization: Bearer <ACCESS_TOKEN>" \
  -H "content-type: application/json"
```

### Submit fluency gate result

```bash
curl -X POST http://localhost:4000/api/v1/fluency-gate/submit \
  -H "authorization: Bearer <ACCESS_TOKEN>" \
  -H "content-type: application/json" \
  -d '{
    "test_id":"<TEST_ID>",
    "duration_seconds": 175,
    "error_count": 3
  }'
```

### Fluency gate status

```bash
curl http://localhost:4000/api/v1/fluency-gate/status \
  -H "authorization: Bearer <ACCESS_TOKEN>"
```

### Today queue

```bash
curl http://localhost:4000/api/v1/queue/today \
  -H "authorization: Bearer <ACCESS_TOKEN>"
```

### Start session

```bash
curl -X POST http://localhost:4000/api/v1/session/start \
  -H "authorization: Bearer <ACCESS_TOKEN>" \
  -H "content-type: application/json" \
  -d '{"client_session_id":"0f7b31f1-0b86-401f-b9f0-79a07f925d20"}'
```

### Append review event (idempotent via `client_event_id`)

```bash
curl -X POST http://localhost:4000/api/v1/review/event \
  -H "authorization: Bearer <ACCESS_TOKEN>" \
  -H "content-type: application/json" \
  -d '{
    "session_id":"<SESSION_ID>",
    "client_event_id":"f9b53a12-5fd5-4c4a-89d7-4bfc2f93d7de",
    "event_type":"REVIEW_ATTEMPTED",
    "session_type":"SABAQ",
    "occurred_at":"2026-02-11T10:00:00.000Z",
    "item_ayah_id": 1,
    "tier":"SABAQ",
    "step_type":"LINK",
    "attempt_number":1,
    "scaffolding_used":false,
    "linked_ayah_id":2,
    "success": true,
    "errors_count": 0,
    "duration_seconds": 70,
    "error_tags": ["hesitation"]
  }'
```

### Complete one 3x3 step

```bash
curl -X POST http://localhost:4000/api/v1/session/step-complete \
  -H "authorization: Bearer <ACCESS_TOKEN>" \
  -H "content-type: application/json" \
  -d '{
    "session_id":"<SESSION_ID>",
    "ayah_id":1,
    "step_type":"EXPOSURE",
    "attempt_number":1,
    "success":true,
    "errors_count":0,
    "scaffolding_used":false,
    "duration_seconds":30
  }'
```

### Complete session

```bash
curl -X POST http://localhost:4000/api/v1/session/complete \
  -H "authorization: Bearer <ACCESS_TOKEN>" \
  -H "content-type: application/json" \
  -d '{"session_id":"<SESSION_ID>"}'
```

### User stats

```bash
curl http://localhost:4000/api/v1/user/stats \
  -H "authorization: Bearer <ACCESS_TOKEN>"
```

### Health

```bash
curl http://localhost:4000/health
```
