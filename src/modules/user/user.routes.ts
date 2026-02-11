import { Router } from "express";
import { asyncHandler } from "../../lib/http";
import { requireAuth } from "../../middleware/auth";
import { calendarQuerySchema } from "./user.schemas";
import {
  getUserAchievements,
  getUserCalendar,
  getUserProgress,
  getUserStats
} from "./user.service";

export const userRouter = Router();

userRouter.get(
  "/stats",
  requireAuth,
  asyncHandler(async (req, res) => {
    const stats = await getUserStats(req.authUser!.sub);
    res.json(stats);
  })
);

userRouter.get(
  "/calendar",
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = calendarQuerySchema.parse(req.query);
    const payload = await getUserCalendar(req.authUser!.sub, query.month);
    res.json(payload);
  })
);

userRouter.get(
  "/achievements",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = await getUserAchievements(req.authUser!.sub);
    res.json(payload);
  })
);

userRouter.get(
  "/progress",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = await getUserProgress(req.authUser!.sub);
    res.json(payload);
  })
);
