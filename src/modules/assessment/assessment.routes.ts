import { Router } from "express";
import { asyncHandler } from "../../lib/http";
import { requireAuth } from "../../middleware/auth";
import { assessmentSchema } from "./assessment.schemas";
import { submitAssessment } from "./assessment.service";

export const assessmentRouter = Router();

assessmentRouter.post(
  "/submit",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = assessmentSchema.parse(req.body);
    const result = await submitAssessment({
      userId: req.authUser!.sub,
      ...payload
    });
    res.json({
      defaults: result
    });
  })
);
