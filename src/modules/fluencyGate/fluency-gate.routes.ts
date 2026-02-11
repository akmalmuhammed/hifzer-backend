import { Router } from "express";
import { asyncHandler, HttpError } from "../../lib/http";
import { requireAuth } from "../../middleware/auth";
import { fluencyGateSubmitSchema } from "./fluency-gate.schemas";
import {
  getFluencyGateStatus,
  startFluencyGateTest,
  submitFluencyGateTest
} from "./fluency-gate.service";

export const fluencyGateRouter = Router();

fluencyGateRouter.post(
  "/start",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await startFluencyGateTest(req.authUser!.sub);
    res.status(201).json(result);
  })
);

fluencyGateRouter.post(
  "/submit",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = fluencyGateSubmitSchema.parse(req.body);
    const result = await submitFluencyGateTest({
      userId: req.authUser!.sub,
      testId: payload.test_id,
      durationSeconds: payload.duration_seconds,
      errorCount: payload.error_count
    });
    if (!result) {
      throw new HttpError(404, "Test not found or already completed");
    }
    res.json(result);
  })
);

fluencyGateRouter.get(
  "/status",
  requireAuth,
  asyncHandler(async (req, res) => {
    const status = await getFluencyGateStatus(req.authUser!.sub);
    res.json(status);
  })
);
