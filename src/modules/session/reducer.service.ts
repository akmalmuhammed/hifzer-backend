import { ItemStatus, ReviewEventType, ReviewTier } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  adjustDifficulty,
  calculateNextReview,
  outcomeFromAttempt,
  tierFromCheckpoint
} from "../../lib/spacing";

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function applyPromotionGate(params: {
  previousConsecutivePerfectDays: number;
  previousPerfectDay: string | null;
  eventOccurredAt: Date;
  success: boolean;
  errorsCount: number;
  checkpointIndex: number;
}): {
  consecutivePerfectDays: number;
  perfectDay: string | null;
  tier: ReviewTier;
} {
  let consecutivePerfectDays = params.previousConsecutivePerfectDays;
  let perfectDay = params.previousPerfectDay;
  const isPerfect = params.success && params.errorsCount === 0;

  if (isPerfect) {
    const eventDay = dayKey(params.eventOccurredAt);
    if (!perfectDay) {
      consecutivePerfectDays = 1;
    } else {
      const previous = new Date(`${perfectDay}T00:00:00.000Z`).getTime();
      const current = new Date(`${eventDay}T00:00:00.000Z`).getTime();
      const diffDays = Math.floor((current - previous) / (24 * 60 * 60 * 1000));
      if (diffDays === 0) {
        // same UTC day: keep streak unchanged
      } else if (diffDays === 1) {
        consecutivePerfectDays += 1;
      } else {
        consecutivePerfectDays = 1;
      }
    }
    perfectDay = eventDay;
  } else {
    consecutivePerfectDays = 0;
    perfectDay = null;
  }

  let tier = tierFromCheckpoint(params.checkpointIndex);
  if (tier === ReviewTier.MANZIL && consecutivePerfectDays < 7) {
    tier = ReviewTier.SABQI;
  }

  return {
    consecutivePerfectDays,
    perfectDay,
    tier
  };
}

export async function rebuildItemState(userId: string, ayahId: number): Promise<void> {
  const events = await prisma.reviewEvent.findMany({
    where: {
      userId,
      eventType: ReviewEventType.REVIEW_ATTEMPTED,
      itemAyahId: ayahId
    },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }]
  });

  if (events.length === 0) {
    return;
  }

  let checkpointIndex = 0;
  let intervalSeconds = 4 * 60 * 60;
  let nextReviewAt = events[0].occurredAt;
  let tier: ReviewTier = ReviewTier.SABAQ;
  let introducedAt = events[0].occurredAt;
  let firstMemorizedAt: Date | null = null;
  let difficultyScore = 0;
  let totalReviews = 0;
  let successfulReviews = 0;
  let lapses = 0;
  let successStreak = 0;
  let averageDurationSeconds = 0;
  let lastErrorsCount = 0;
  let consecutivePerfectDays = 0;
  let lastPerfectDay: string | null = null;
  let lastReviewedAt: Date | null = null;
  let lastEventOccurredAt: Date | null = null;

  for (const event of events) {
    const success = Boolean(event.success);
    const errorsCount = event.errorsCount ?? 0;
    const next = calculateNextReview(
      intervalSeconds,
      {
        success,
        errorsCount
      },
      event.occurredAt
    );
    checkpointIndex = next.checkpointIndex;
    intervalSeconds = next.reviewIntervalSeconds;
    nextReviewAt = next.nextReviewAt;

    const outcome = outcomeFromAttempt(success, errorsCount);
    totalReviews += 1;
    successfulReviews += success ? 1 : 0;
    lapses += success ? 0 : 1;
    successStreak = success ? successStreak + 1 : 0;
    difficultyScore = adjustDifficulty(difficultyScore, outcome);
    lastErrorsCount = errorsCount;
    lastReviewedAt = event.occurredAt;
    lastEventOccurredAt = event.occurredAt;
    if (event.durationSeconds && event.durationSeconds > 0) {
      averageDurationSeconds = Math.round(
        ((averageDurationSeconds * (totalReviews - 1)) + event.durationSeconds) / totalReviews
      );
    }
    const promotion = applyPromotionGate({
      previousConsecutivePerfectDays: consecutivePerfectDays,
      previousPerfectDay: lastPerfectDay,
      eventOccurredAt: event.occurredAt,
      success,
      errorsCount,
      checkpointIndex
    });
    consecutivePerfectDays = promotion.consecutivePerfectDays;
    lastPerfectDay = promotion.perfectDay;
    tier = promotion.tier;

    if (!firstMemorizedAt && checkpointIndex >= 2) {
      firstMemorizedAt = event.occurredAt;
    }
  }

  await prisma.userItemState.upsert({
    where: {
      userId_ayahId: {
        userId,
        ayahId
      }
    },
    create: {
      userId,
      ayahId,
      status: checkpointIndex >= 2 ? ItemStatus.MEMORIZED : ItemStatus.LEARNING,
      tier,
      nextReviewAt,
      reviewIntervalSeconds: intervalSeconds,
      intervalCheckpointIndex: checkpointIndex,
      introducedAt,
      firstMemorizedAt: firstMemorizedAt ?? undefined,
      difficultyScore,
      totalReviews,
      successfulReviews,
      lapses,
      successStreak,
      consecutivePerfectDays,
      averageDurationSeconds,
      lastErrorsCount,
      lastReviewedAt: lastReviewedAt ?? undefined,
      lastEventOccurredAt: lastEventOccurredAt ?? undefined
    },
    update: {
      status: checkpointIndex >= 2 ? ItemStatus.MEMORIZED : ItemStatus.LEARNING,
      tier,
      nextReviewAt,
      reviewIntervalSeconds: intervalSeconds,
      intervalCheckpointIndex: checkpointIndex,
      introducedAt,
      firstMemorizedAt: firstMemorizedAt ?? undefined,
      difficultyScore,
      totalReviews,
      successfulReviews,
      lapses,
      successStreak,
      consecutivePerfectDays,
      averageDurationSeconds,
      lastErrorsCount,
      lastReviewedAt: lastReviewedAt ?? undefined,
      lastEventOccurredAt: lastEventOccurredAt ?? undefined
    }
  });
}

export async function updateTransitionScoreFromEvent(params: {
  userId: string;
  fromAyahId: number;
  toAyahId: number;
  success: boolean;
  occurredAt: Date;
}): Promise<void> {
  await prisma.transitionScore.upsert({
    where: {
      userId_fromAyahId_toAyahId: {
        userId: params.userId,
        fromAyahId: params.fromAyahId,
        toAyahId: params.toAyahId
      }
    },
    create: {
      userId: params.userId,
      fromAyahId: params.fromAyahId,
      toAyahId: params.toAyahId,
      attemptCount: 1,
      successCount: params.success ? 1 : 0,
      lastPracticedAt: params.occurredAt
    },
    update: {
      attemptCount: {
        increment: 1
      },
      successCount: {
        increment: params.success ? 1 : 0
      },
      lastPracticedAt: params.occurredAt
    }
  });
}
