import { describe, expect, it } from "vitest";
import { calculateNextReview, SRS_CHECKPOINTS_SECONDS } from "../../src/lib/spacing";

describe("SRS Checkpoints", () => {
  it("advances through exact checkpoints", () => {
    const anchor = new Date("2026-02-11T10:00:00.000Z");
    const next1 = calculateNextReview(
      SRS_CHECKPOINTS_SECONDS[0],
      { success: true, errorsCount: 0 },
      anchor
    );
    expect(next1.reviewIntervalSeconds).toBe(8 * 3600);

    const next2 = calculateNextReview(
      next1.reviewIntervalSeconds,
      { success: true, errorsCount: 0 },
      anchor
    );
    expect(next2.reviewIntervalSeconds).toBe(24 * 3600);
  });

  it("resets to 4h on failure", () => {
    const anchor = new Date("2026-02-11T10:00:00.000Z");
    const next = calculateNextReview(
      7 * 86400,
      { success: false, errorsCount: 3 },
      anchor
    );
    expect(next.reviewIntervalSeconds).toBe(4 * 3600);
  });
});
