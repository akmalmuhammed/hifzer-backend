import { ReviewTier } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { applyPromotionGate } from "../../src/modules/session/reducer.service";

describe("Promotion Gate", () => {
  it("requires 7 consecutive perfect days before manzil promotion", () => {
    let streak = 0;
    let perfectDay: string | null = null;
    let tier: ReviewTier = ReviewTier.SABQI;

    for (let i = 0; i < 6; i += 1) {
      const state = applyPromotionGate({
        previousConsecutivePerfectDays: streak,
        previousPerfectDay: perfectDay,
        eventOccurredAt: new Date(`2026-02-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`),
        success: true,
        errorsCount: 0,
        checkpointIndex: 6
      });
      streak = state.consecutivePerfectDays;
      perfectDay = state.perfectDay;
      tier = state.tier;
    }

    expect(streak).toBe(6);
    expect(tier).toBe(ReviewTier.SABQI);

    const promoted = applyPromotionGate({
      previousConsecutivePerfectDays: streak,
      previousPerfectDay: perfectDay,
      eventOccurredAt: new Date("2026-02-07T10:00:00.000Z"),
      success: true,
      errorsCount: 0,
      checkpointIndex: 6
    });

    expect(promoted.consecutivePerfectDays).toBe(7);
    expect(promoted.tier).toBe(ReviewTier.MANZIL);
  });

  it("resets perfect-day counter on any error", () => {
    const before = applyPromotionGate({
      previousConsecutivePerfectDays: 5,
      previousPerfectDay: "2026-02-05",
      eventOccurredAt: new Date("2026-02-06T10:00:00.000Z"),
      success: true,
      errorsCount: 1,
      checkpointIndex: 6
    });
    expect(before.consecutivePerfectDays).toBe(0);
    expect(before.tier).toBe(ReviewTier.SABQI);
  });
});
