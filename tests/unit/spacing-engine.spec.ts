import { describe, expect, it } from "vitest";
import {
  SRS_CHECKPOINTS_SECONDS,
  calculateNextReview,
  nextCheckpointIndex,
  outcomeFromAttempt,
  scheduleFromCheckpoint
} from "../../src/lib/spacing";

describe("spacing engine progression", () => {
  it("advances checkpoint on perfect attempt", () => {
    const outcome = outcomeFromAttempt(true, 0);
    expect(nextCheckpointIndex(2, outcome)).toBe(3);
  });

  it("repeats checkpoint on minor errors", () => {
    const outcome = outcomeFromAttempt(true, 2);
    expect(nextCheckpointIndex(3, outcome)).toBe(3);
  });

  it("shortens interval on fail", () => {
    const outcome = outcomeFromAttempt(false, 4);
    expect(nextCheckpointIndex(4, outcome)).toBe(0);
    expect(nextCheckpointIndex(1, outcome)).toBe(0);
  });

  it("preserves hour-level interval precision", () => {
    const anchor = new Date("2026-01-01T00:00:00.000Z");
    const schedule = scheduleFromCheckpoint(0, anchor);
    expect(schedule.intervalSeconds).toBe(SRS_CHECKPOINTS_SECONDS[0]);
    expect(schedule.nextReviewAt.toISOString()).toBe("2026-01-01T04:00:00.000Z");
  });

  it("advances through exact checkpoints and resets to 4h on fail", () => {
    const anchor = new Date("2026-01-01T00:00:00.000Z");
    const first = calculateNextReview(4 * 3600, { success: true, errorsCount: 0 }, anchor);
    expect(first.reviewIntervalSeconds).toBe(8 * 3600);

    const second = calculateNextReview(
      first.reviewIntervalSeconds,
      { success: true, errorsCount: 0 },
      anchor
    );
    expect(second.reviewIntervalSeconds).toBe(24 * 3600);

    const failed = calculateNextReview(
      7 * 24 * 3600,
      { success: false, errorsCount: 3 },
      anchor
    );
    expect(failed.reviewIntervalSeconds).toBe(4 * 3600);
  });
});
