import { Router } from "express";
import { asyncHandler } from "../../lib/http";
import { requireAuth } from "../../middleware/auth";
import { completeSession, completeSessionStep, startSession } from "./session.service";
import { sessionCompleteSchema, sessionStartSchema, stepCompleteSchema } from "./session.schemas";

export const sessionRouter = Router();

sessionRouter.post(
  "/start",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = sessionStartSchema.parse(req.body);
    const result = await startSession(req.authUser!.sub, payload);
    res.status(201).json(result);
  })
);

sessionRouter.post(
  "/complete",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = sessionCompleteSchema.parse(req.body);
    const result = await completeSession(req.authUser!.sub, payload);
    res.json(result);
  })
);

sessionRouter.post(
  "/step-complete",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = stepCompleteSchema.parse(req.body);
    const result = await completeSessionStep(req.authUser!.sub, payload);
    res.json(result);
  })
);
