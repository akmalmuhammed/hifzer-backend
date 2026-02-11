import { GoalType, PriorJuzBand, TajwidConfidence } from "@prisma/client";
import { z } from "zod";

export const assessmentSchema = z.object({
  time_budget_minutes: z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(90)]),
  fluency_score: z.number().int().min(0).max(100),
  tajwid_confidence: z.nativeEnum(TajwidConfidence),
  goal: z.nativeEnum(GoalType),
  has_teacher: z.boolean(),
  prior_juz_band: z.nativeEnum(PriorJuzBand)
});
