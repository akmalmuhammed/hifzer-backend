import { GoalType, PriorJuzBand, ScaffoldingLevel, TajwidConfidence } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  assignScaffoldingLevel,
  computeAssessmentDefaults
} from "../../src/modules/assessment/assessment.service";

describe("assessment defaults", () => {
  it("assigns BEGINNER when prior juz band is ZERO", () => {
    const level = assignScaffoldingLevel({
      time_budget_minutes: 60,
      fluency_score: 95,
      tajwid_confidence: TajwidConfidence.HIGH,
      goal: GoalType.FULL_QURAN,
      has_teacher: true,
      prior_juz_band: PriorJuzBand.ZERO
    });
    expect(level).toBe(ScaffoldingLevel.BEGINNER);
  });

  it("assigns MINIMAL for advanced users with teacher support", () => {
    const level = assignScaffoldingLevel({
      time_budget_minutes: 90,
      fluency_score: 90,
      tajwid_confidence: TajwidConfidence.HIGH,
      goal: GoalType.FULL_QURAN,
      has_teacher: true,
      prior_juz_band: PriorJuzBand.FIVE_PLUS
    });
    expect(level).toBe(ScaffoldingLevel.MINIMAL);
  });

  it("supports 15-minute budget with conservative output and warning", () => {
    const defaults = computeAssessmentDefaults({
      time_budget_minutes: 15,
      fluency_score: 65,
      tajwid_confidence: TajwidConfidence.MED,
      goal: GoalType.JUZ,
      has_teacher: false,
      prior_juz_band: PriorJuzBand.ONE_TO_FIVE
    });

    expect(defaults.daily_new_target_ayahs).toBeLessThanOrEqual(3);
    expect(defaults.recommended_minutes).toBe(30);
    expect(defaults.warning).toBeTruthy();
    expect(defaults.scaffolding_level).toBe(ScaffoldingLevel.BEGINNER);
  });
});
