import { NextFunction, Request, Response } from "express";
import { HttpError } from "../lib/http";
import { logger } from "../lib/logger";
import { isSentryEnabled, Sentry } from "../lib/sentry";

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new HttpError(404, "Not found"));
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.requestId ?? "unknown";

  if (error instanceof HttpError) {
    const payload: Record<string, unknown> = {
      error: error.message,
      requestId
    };
    if (error.details && typeof error.details === "object") {
      Object.assign(payload, error.details as Record<string, unknown>);
    }

    if (error.statusCode >= 500) {
      logger.error(
        {
          err: error,
          requestId,
          path: req.originalUrl,
          method: req.method,
          userId: req.authUser?.sub
        },
        "HTTP error"
      );
      if (isSentryEnabled()) {
        Sentry.captureException(error, {
          tags: {
            request_id: requestId
          },
          user: req.authUser ? { id: req.authUser.sub, email: req.authUser.email } : undefined
        });
      }
    } else {
      logger.warn(
        {
          requestId,
          path: req.originalUrl,
          method: req.method,
          statusCode: error.statusCode,
          userId: req.authUser?.sub,
          details: error.details
        },
        "Handled request error"
      );
    }

    res.status(error.statusCode).json(payload);
    return;
  }

  logger.error(
    {
      err: error,
      requestId,
      path: req.originalUrl,
      method: req.method,
      userId: req.authUser?.sub
    },
    "Unhandled error"
  );
  if (isSentryEnabled()) {
    Sentry.captureException(error, {
      tags: {
        request_id: requestId
      },
      user: req.authUser ? { id: req.authUser.sub, email: req.authUser.email } : undefined
    });
  }
  res.status(500).json({ error: "Internal server error", requestId });
}
