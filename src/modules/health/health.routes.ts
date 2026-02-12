import { Router } from "express";
import { env } from "../../config/env";
import { HttpError } from "../../lib/http";
import { prisma } from "../../lib/prisma";

export const healthRouter = Router();

healthRouter.get("/live", (_req, res) => {
  res.json({
    status: "ok"
  });
});

healthRouter.get("/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "ok",
      database: "up"
    });
  } catch {
    res.status(503).json({
      status: "degraded",
      database: "down"
    });
  }
});

healthRouter.get("/", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "ok",
      database: "up"
    });
  } catch {
    res.status(503).json({
      status: "degraded",
      database: "down"
    });
  }
});

// Optional test endpoint for verifying backend Sentry capture in production.
// Disabled by default and protected by a static token header.
healthRouter.post("/debug/sentry", (_req, _res) => {
  if (!env.OBSERVABILITY_DEBUG_ENABLED) {
    throw new HttpError(404, "Not found");
  }

  const token = _req.header("x-observability-token") ?? "";
  if (!env.OBSERVABILITY_DEBUG_TOKEN || token !== env.OBSERVABILITY_DEBUG_TOKEN) {
    throw new HttpError(403, "Forbidden");
  }

  throw new Error("Sentry backend test");
});
