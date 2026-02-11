import { NextFunction, Request, Response } from "express";
import { HttpError } from "../lib/http";
import { logger } from "../lib/logger";

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(new HttpError(404, "Not found"));
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof HttpError) {
    const payload: Record<string, unknown> = {
      error: error.message
    };
    if (error.details && typeof error.details === "object") {
      Object.assign(payload, error.details as Record<string, unknown>);
    }
    res.status(error.statusCode).json(payload);
    return;
  }

  logger.error({ err: error }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
}
