import { Router } from "express";
import { asyncHandler } from "../../lib/http";
import { requireAuth } from "../../middleware/auth";
import { ingestReviewEvent } from "./session.service";
import { reviewEventSchema } from "./session.schemas";

export const reviewRouter = Router();

reviewRouter.post(
  "/event",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = reviewEventSchema.parse(req.body);
    const result = await ingestReviewEvent(req.authUser!.sub, payload);
    res.json(result);
  })
);
