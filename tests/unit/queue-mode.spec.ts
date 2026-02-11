import { QueueMode } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { calculateDebtMetrics, determineQueueMode } from "../../src/modules/queue/queue.service";

describe("debt freeze triggers", () => {
  it("enters REVIEW_ONLY when backlog minutes exceed threshold", () => {
    const debt = calculateDebtMetrics({
      dueItemsCount: 90,
      avgSecondsPerItem: 75,
      timeBudgetMinutes: 60,
      backlogFreezeRatio: 0.8,
      now: new Date("2026-02-11T12:00:00.000Z"),
      earliestDueAt: new Date("2026-02-11T10:00:00.000Z")
    });
    const mode = determineQueueMode({
      debt,
      retentionRolling7d: 0.95,
      retentionThreshold: 0.85,
      warmup: {
        totalItems: 0,
        passed: true,
        failed: false,
        pending: false,
        passingAyahIds: [],
        failingAyahIds: []
      }
    });
    expect(debt.backlogMinutesEstimate).toBeGreaterThan(debt.freezeThresholdMinutes);
    expect(mode).toBe(QueueMode.REVIEW_ONLY);
  });

  it("enters REVIEW_ONLY when max overdue days is above 2", () => {
    const debt = calculateDebtMetrics({
      dueItemsCount: 2,
      avgSecondsPerItem: 75,
      timeBudgetMinutes: 90,
      backlogFreezeRatio: 0.8,
      now: new Date("2026-02-11T12:00:00.000Z"),
      earliestDueAt: new Date("2026-02-08T11:00:00.000Z")
    });
    const mode = determineQueueMode({
      debt,
      retentionRolling7d: 0.95,
      retentionThreshold: 0.85,
      warmup: {
        totalItems: 0,
        passed: true,
        failed: false,
        pending: false,
        passingAyahIds: [],
        failingAyahIds: []
      }
    });
    expect(debt.overdueDaysMax).toBeGreaterThan(2);
    expect(mode).toBe(QueueMode.REVIEW_ONLY);
  });
});
