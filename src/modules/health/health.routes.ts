import { Router } from "express";
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
