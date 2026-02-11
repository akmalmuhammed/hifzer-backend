import { Router } from "express";
import { asyncHandler } from "../../lib/http";
import { requireAuth } from "../../middleware/auth";
import { getTodayQueue } from "./queue.service";

export const queueRouter = Router();

queueRouter.get(
  "/today",
  requireAuth,
  asyncHandler(async (req, res) => {
    const queue = await getTodayQueue(req.authUser!.sub);
    res.json(queue);
  })
);
