import { ReviewTier } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildManzilQueue, RiskState } from "../../src/modules/queue/queue.service";

function makeState(ayahId: number, nextReviewAt: string): RiskState {
  return {
    ayahId,
    tier: ReviewTier.MANZIL,
    nextReviewAt: new Date(nextReviewAt),
    lapses: 0,
    difficultyScore: 0,
    lastErrorsCount: 0,
    intervalCheckpointIndex: 6,
    ayah: {
      surahNumber: 1,
      ayahNumber: ayahId,
      pageNumber: 1
    }
  };
}

describe("manzil rotation", () => {
  it("uses ~30 day default cycle target", () => {
    const now = new Date("2026-02-11T12:00:00.000Z");
    const active = Array.from({ length: 60 }).map((_, idx) =>
      makeState(idx + 1, "2026-03-11T12:00:00.000Z")
    );
    const due = [makeState(1, "2026-02-10T10:00:00.000Z")];

    const queue = buildManzilQueue({
      dueManzilStates: due,
      activeManzilStates: active,
      manzilRotationDays: 30,
      now
    });

    expect(queue.length).toBe(2);
    expect(queue[0].ayahId).toBe(1);
  });
});
