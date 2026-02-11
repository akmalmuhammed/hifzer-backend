import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { errorHandler, notFoundHandler } from "./middleware/error";
import { assessmentRouter } from "./modules/assessment/assessment.routes";
import { authRouter } from "./modules/auth/auth.routes";
import { fluencyGateRouter } from "./modules/fluencyGate/fluency-gate.routes";
import { healthRouter } from "./modules/health/health.routes";
import { queueRouter } from "./modules/queue/queue.routes";
import { reviewRouter } from "./modules/session/review.routes";
import { sessionRouter } from "./modules/session/session.routes";
import { userRouter } from "./modules/user/user.routes";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        // Allow server-to-server and non-browser requests with no Origin header.
        if (!origin) {
          callback(null, true);
          return;
        }

        const normalizedOrigin = origin.replace(/\/+$/, "");
        if (env.CORS_ORIGINS.includes(normalizedOrigin)) {
          callback(null, true);
          return;
        }

        callback(new Error("Not allowed by CORS"));
      },
      credentials: true
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));
  app.use(
    pinoHttp({
      logger
    })
  );

  app.use("/health", healthRouter);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/fluency-gate", fluencyGateRouter);
  app.use("/api/v1/assessment", assessmentRouter);
  app.use("/api/v1/queue", queueRouter);
  app.use("/api/v1/session", sessionRouter);
  app.use("/api/v1/review", reviewRouter);
  app.use("/api/v1/user", userRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
