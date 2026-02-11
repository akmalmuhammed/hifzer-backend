import { env } from "./config/env";
import { logger } from "./lib/logger";
import { initSentry, Sentry } from "./lib/sentry";
import { createApp } from "./app";

async function bootstrap() {
  initSentry();

  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled promise rejection");
    Sentry.captureException(reason);
  });

  process.on("uncaughtException", (error) => {
    logger.fatal({ err: error }, "Uncaught exception");
    Sentry.captureException(error);
    setTimeout(() => process.exit(1), 250);
  });

  const app = createApp();
  app.listen(env.PORT, () => {
    logger.info(`Hifz OS backend listening on :${env.PORT}`);
  });
}

void bootstrap();
