import * as Sentry from "@sentry/node";
import { env } from "../config/env";
import { logger } from "./logger";

let initialized = false;

export function isSentryEnabled(): boolean {
  return env.SENTRY_DSN.trim().length > 0;
}

export function initSentry(): void {
  if (!isSentryEnabled()) {
    logger.info("Sentry disabled (SENTRY_DSN is empty)");
    return;
  }
  if (initialized) {
    return;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE
  });
  initialized = true;
  logger.info("Sentry initialized");
}

export { Sentry };
