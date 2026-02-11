# Backend Observability Runbook

## Stack

- Structured logs: `pino` + `pino-http`
- Error tracking: Sentry (`@sentry/node`)
- Uptime checks: `/health/live` and `/health/ready`

## What is captured

- Request-level logs with `requestId` and `userId` when available
- `x-request-id` propagated to every response
- Handled API errors (4xx) with warning logs
- Unhandled exceptions (5xx) with error logs and Sentry capture
- Unhandled promise rejections and uncaught exceptions from process handlers

## Environment variables

- `LOG_LEVEL=info`
- `SENTRY_DSN=...`
- `SENTRY_ENVIRONMENT=production`
- `SENTRY_TRACES_SAMPLE_RATE=0.1`
- `PRISMA_QUERY_LOGS=false`

## Alerts

Create uptime monitors for:

1. `GET /health/live`
2. `GET /health/ready`

Recommended rule:

- Check every 60s
- Alert after 2 consecutive failures
- Notify email + team chat webhook

## Triage workflow

1. Start from Sentry issue or API response `requestId`.
2. Search Render logs by `requestId`.
3. Validate DB readiness (`/health/ready`).
4. Classify root cause and create regression test before closing.
