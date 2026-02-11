import { QueueMode } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  calculateDebtMetrics,
  determineQueueMode,
  evaluateWarmup
} from "../../src/modules/queue/queue.service";

describe("warmup gating", () => {
  it("forces REVIEW_ONLY when warmup attempts fail", () => {
    const warmup = evaluateWarmup(
      [101, 102],
      [
        { ayahId: 101, success: false, errorsCount: 3 },
        { ayahId: 102, success: true, errorsCount: 0 }
      ]
    );
    const debt = calculateDebtMetrics({
      dueItemsCount: 3,
      avgSecondsPerItem: 60,
      timeBudgetMinutes: 90,
      backlogFreezeRatio: 0.8,
      now: new Date("2026-02-11T12:00:00.000Z"),
      earliestDueAt: new Date("2026-02-11T11:55:00.000Z")
    });

    const mode = determineQueueMode({
      debt,
      retentionRolling7d: 0.9,
      retentionThreshold: 0.85,
      warmup
    });

    expect(warmup.failed).toBe(true);
    expect(mode).toBe(QueueMode.REVIEW_ONLY);
  });
});
