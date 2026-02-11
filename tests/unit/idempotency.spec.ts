import { ReviewEventType, ReviewTier } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ingestReviewEvent } from "../../src/modules/session/session.service";

describe("idempotent event ingest", () => {
  it("stores a duplicate client_event_id only once", async () => {
    const seen = new Set<string>();
    const reviewEventCreate = vi.fn(async (args: { data: { clientEventId: string } }) => {
      if (seen.has(args.data.clientEventId)) {
        throw { code: "P2002" };
      }
      seen.add(args.data.clientEventId);
      return { id: BigInt(1) };
    });

    const deps = {
      prismaClient: {
        reviewEvent: {
          create: reviewEventCreate
        },
        sessionRun: {
          update: vi.fn()
        }
      } as any,
      enqueue: vi.fn(async () => {}),
      rebuild: vi.fn(async () => {}),
      updateTransition: vi.fn(async () => {}),
      processInline: false
    };

    const payload = {
      client_event_id: "5a3c9566-617e-4ad0-80e8-81a4616d57a7",
      event_type: ReviewEventType.REVIEW_ATTEMPTED,
      occurred_at: new Date("2026-02-11T10:00:00.000Z"),
      item_ayah_id: 12,
      tier: ReviewTier.SABAQ,
      success: true,
      errors_count: 0,
      duration_seconds: 75
    } as const;

    const first = await ingestReviewEvent("user-1", payload, deps);
    const second = await ingestReviewEvent("user-1", payload, deps);

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(seen.size).toBe(1);
    expect(deps.enqueue).toHaveBeenCalledTimes(1);
  });
});
