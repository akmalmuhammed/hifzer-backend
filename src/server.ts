import { env } from "./config/env";
import { logger } from "./lib/logger";
import { createApp } from "./app";

async function bootstrap() {
  const app = createApp();
  app.listen(env.PORT, () => {
    logger.info(`Hifz OS backend listening on :${env.PORT}`);
  });
}

void bootstrap();
