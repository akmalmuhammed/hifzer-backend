# Cloudflare Workers Migration Plan (Month 2)

This backend is currently optimized for fast MVP delivery on standard Node hosting (Render/Railway/Fly).  
BullMQ code remains in place but can be disabled with `PROCESS_EVENTS_INLINE=true`.

## Current Position

- Runtime: Node.js + Express
- DB: Postgres (Prisma)
- Optional queue: BullMQ + Redis
- Default mode: inline reducer processing (`PROCESS_EVENTS_INLINE=true`)

## Target Position (Cloudflare)

- Runtime: Cloudflare Workers
- Web framework: Hono (replace Express)
- Data layer: Postgres via Prisma Accelerate or compatible HTTP/edge strategy
- Background jobs: Cloudflare Queues/Workflows (replace BullMQ worker process)

## Required Changes

## 1) Express -> Hono

- Replace Express app bootstrap and middleware chain.
- Re-map routes/middleware to Hono handlers.
- Replace Node-specific request/response helpers with Web Fetch API style handling.

Affected areas:

- `src/app.ts`
- `src/server.ts`
- middleware wiring under `src/middleware/*`

## 2) Environment + Runtime APIs

- Move env access to Worker bindings (`c.env.*`) pattern.
- Remove assumptions about Node process lifecycle/server listen.
- Ensure crypto/token code uses APIs supported in Workers runtime.

## 3) Prisma/Database Connectivity

- Switch to an edge-compatible connection strategy.
- Validate Prisma client generation and query performance in Workers.
- Ensure migrations remain run from CI/admin environment, not in Worker runtime.

## 4) BullMQ -> Cloudflare-native async

- Keep current event schema and reducer logic, but swap transport:
  - BullMQ enqueue -> Cloudflare Queue publish.
  - Worker process -> Queue consumer/Workflow handler.
- Preserve idempotency and deterministic replay behavior.

## 5) Auth/Cookies/CORS

- Revalidate JWT flows in edge runtime.
- Re-check CORS/cookie behavior with frontend domain on Vercel.
- Keep refresh rotation logic unchanged at business-rule level.

## 6) Observability and Rate Limiting

- Add Cloudflare-native logging/metrics.
- Move rate limiting/WAF policy to Cloudflare edge controls.

## Migration Estimate

- **Estimated effort: 2-3 days** for first production-capable migration pass.

Typical breakdown:

1. Day 1: route/middleware migration (Express -> Hono), env/runtime cleanup.
2. Day 2: DB + queue transport swap, auth/cors validation, smoke tests.
3. Day 3 (buffer): performance tuning, deployment hardening, rollback checks.

## Recommended Rollout

1. Keep current Render deployment as stable baseline (Month 1).
2. Build Cloudflare branch in parallel (Month 2).
3. Run side-by-side staging verification against same Postgres.
4. Cut over traffic after E2E + load smoke pass.
