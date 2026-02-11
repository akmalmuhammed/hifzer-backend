import {
  ReviewEventType,
  ReviewSessionType,
  ReviewStepType,
  ReviewTier
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { isWeakTransition } from "../../src/modules/queue/queue.service";
import { ingestReviewEvent } from "../../src/modules/session/session.service";

describe("Transition Performance", () => {
  it("updates transition score hook on link step events", async () => {
    const updateTransition = vi.fn(async () => {});
    const deps = {
      prismaClient: {
        reviewEvent: {
          create: vi.fn(async () => ({ id: BigInt(1) }))
        },
        sessionRun: {
          update: vi.fn(async () => {})
        }
      } as any,
      enqueue: vi.fn(async () => {}),
      rebuild: vi.fn(async () => {}),
      updateTransition,
      processInline: false
    };

    await ingestReviewEvent(
      "00000000-0000-0000-0000-000000000001",
      {
        client_event_id: "00000000-0000-4000-8000-000000000001",
        event_type: ReviewEventType.REVIEW_ATTEMPTED,
        session_type: ReviewSessionType.SABAQ,
        occurred_at: new Date("2026-02-11T11:00:00.000Z"),
        item_ayah_id: 5,
        linked_ayah_id: 6,
        tier: ReviewTier.SABAQ,
        step_type: ReviewStepType.LINK,
        attempt_number: 1,
        success: true,
        errors_count: 0,
        duration_seconds: 20
      },
      deps
    );

    expect(updateTransition).toHaveBeenCalledTimes(1);
    expect(updateTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        fromAyahId: 5,
        toAyahId: 6
      })
    );
  });

  it("flags weak transitions under 70% with >=3 attempts", () => {
    expect(isWeakTransition(6, 10)).toBe(true);
    expect(isWeakTransition(7, 10)).toBe(false);
    expect(isWeakTransition(1, 2)).toBe(false);
  });
});
