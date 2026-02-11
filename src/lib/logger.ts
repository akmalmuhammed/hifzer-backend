import pino from "pino";
import { env } from "../config/env";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: {
    service: "hifz-os-backend",
    environment: env.NODE_ENV
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie"],
    remove: true
  }
});
