import {
  ReviewEventType,
  ReviewSessionType,
  ReviewStepType,
  ReviewTier
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  ingestReviewEvent,
  nextStepForWorkflow
} from "../../src/modules/session/session.service";

describe("3x3 Linking Workflow", () => {
  it("tracks exposure attempts 1..3 as separate events", async () => {
    const records: Array<{ stepType: ReviewStepType | null; attemptNumber: number | null }> = [];
    const deps = {
      prismaClient: {
        reviewEvent: {
          create: vi.fn(async (args: { data: { stepType: ReviewStepType | null; attemptNumber: number | null } }) => {
            records.push({
              stepType: args.data.stepType,
              attemptNumber: args.data.attemptNumber
            });
            return { id: BigInt(records.length) };
          })
        },
        sessionRun: {
          update: vi.fn(async () => {})
        }
      } as any,
      enqueue: vi.fn(async () => {}),
      rebuild: vi.fn(async () => {}),
      updateTransition: vi.fn(async () => {}),
      processInline: false
    };

    for (let i = 1; i <= 3; i += 1) {
      await ingestReviewEvent(
        "00000000-0000-0000-0000-000000000001",
        {
          client_event_id: `00000000-0000-4000-8000-00000000000${i}`,
          event_type: ReviewEventType.REVIEW_ATTEMPTED,
          session_type: ReviewSessionType.SABAQ,
          occurred_at: new Date("2026-02-11T10:00:00.000Z"),
          item_ayah_id: 1,
          tier: ReviewTier.SABAQ,
          step_type: ReviewStepType.EXPOSURE,
          attempt_number: i,
          success: true,
          errors_count: 0,
          duration_seconds: 30
        },
        deps
      );
    }

    expect(records).toHaveLength(3);
    expect(records.map((r) => r.stepType)).toEqual([
      ReviewStepType.EXPOSURE,
      ReviewStepType.EXPOSURE,
      ReviewStepType.EXPOSURE
    ]);
    expect(records.map((r) => r.attemptNumber)).toEqual([1, 2, 3]);
  });

  it("requires link step before completion progression", () => {
    expect(nextStepForWorkflow(ReviewStepType.EXPOSURE, 3)).toBe("GUIDED");
    expect(nextStepForWorkflow(ReviewStepType.GUIDED, 3)).toBe("BLIND");
    expect(nextStepForWorkflow(ReviewStepType.BLIND, 3)).toBe("LINK");
    expect(nextStepForWorkflow(ReviewStepType.LINK, 3)).toBe("COMPLETE");
  });
});
