import { QueueMode, ReviewEventType, ReviewTier } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { addDays, diffInDaysFloor, endOfUtcDay, startOfUtcDay } from "../../lib/time";

export const FLUENCY_GATE_REQUIRED_MODE = "FLUENCY_GATE_REQUIRED" as const;

export type RiskState = {
  ayahId: number;
  tier: ReviewTier;
  nextReviewAt: Date;
  lapses: number;
  difficultyScore: number;
  lastErrorsCount: number;
  intervalCheckpointIndex: number;
  ayah: {
    surahNumber: number;
    ayahNumber: number;
    pageNumber: number;
  };
};

export type DebtMetrics = {
  dueItemsCount: number;
  backlogMinutesEstimate: number;
  overdueDaysMax: number;
  freezeThresholdMinutes: number;
};

export type WarmupEvaluation = {
  totalItems: number;
  passed: boolean;
  failed: boolean;
  pending: boolean;
  passingAyahIds: number[];
  failingAyahIds: number[];
};

export type WeakTransitionPayload = {
  from_ayah_id: number;
  to_ayah_id: number;
  success_rate: number;
  success_count: number;
  attempt_count: number;
};

export type FluencyGateRequiredQueuePayload = {
  mode: typeof FLUENCY_GATE_REQUIRED_MODE;
  message: string;
  sabaq_allowed: false;
  sabqi_queue: [];
  manzil_queue: [];
  weak_transitions: [];
  link_repair_recommended: false;
  action_required: "COMPLETE_FLUENCY_GATE";
};

export type NormalTodayQueuePayload = {
  mode: QueueMode;
  debt: DebtMetrics;
  retentionRolling7d: number;
  warmup_test: {
    max_errors: number;
    total_items: number;
    passed: boolean;
    failed: boolean;
    pending: boolean;
    ayah_ids: number[];
  };
  sabaq_task: {
    allowed: boolean;
    target_ayahs: number;
    blocked_reason: "none" | "mode_review_only" | "warmup_pending" | "warmup_failed";
  };
  sabqi_queue: Array<{
    ayah_id: number;
    surah_number: number;
    ayah_number: number;
    page_number: number;
    tier: ReviewTier;
    next_review_at: string;
    overdue_seconds: number;
    lapses: number;
    difficulty_score: number;
  }>;
  manzil_queue: Array<{
    ayah_id: number;
    surah_number: number;
    ayah_number: number;
    page_number: number;
    tier: ReviewTier;
    next_review_at: string;
    overdue_seconds: number;
    lapses: number;
    difficulty_score: number;
  }>;
  weak_transitions: Array<{
    from_ayah_id: number;
    to_ayah_id: number;
    success_rate: number;
    success_count: number;
    attempt_count: number;
  }>;
  link_repair_recommended: boolean;
};

export type TodayQueuePayload = FluencyGateRequiredQueuePayload | NormalTodayQueuePayload;

export function shouldBlockForFluencyGate(user: {
  requiresPreHifz: boolean;
  fluencyGatePassed: boolean;
}): boolean {
  return user.requiresPreHifz || !user.fluencyGatePassed;
}

export function isWeakTransition(successCount: number, attemptCount: number): boolean {
  if (attemptCount < 3) {
    return false;
  }
  return successCount / attemptCount < 0.7;
}

function assertUuid(value: string): void {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(value)) {
    throw new Error("Invalid user id format");
  }
}

export function calculateDebtMetrics(params: {
  dueItemsCount: number;
  avgSecondsPerItem: number;
  timeBudgetMinutes: number;
  backlogFreezeRatio: number;
  now: Date;
  earliestDueAt?: Date;
}): DebtMetrics {
  const backlogMinutesEstimate = Math.ceil((params.dueItemsCount * params.avgSecondsPerItem) / 60);
  const overdueDaysMax =
    params.earliestDueAt && params.earliestDueAt <= params.now
      ? diffInDaysFloor(params.now, params.earliestDueAt)
      : 0;
  const freezeThresholdMinutes = Math.floor(params.timeBudgetMinutes * params.backlogFreezeRatio);
  return {
    dueItemsCount: params.dueItemsCount,
    backlogMinutesEstimate,
    overdueDaysMax,
    freezeThresholdMinutes
  };
}

export function determineQueueMode(params: {
  debt: DebtMetrics;
  retentionRolling7d: number;
  retentionThreshold: number;
  warmup: WarmupEvaluation;
}): QueueMode {
  const debtFreeze =
    params.debt.backlogMinutesEstimate > params.debt.freezeThresholdMinutes ||
    params.debt.overdueDaysMax > 2;
  if (debtFreeze || params.warmup.failed) {
    return QueueMode.REVIEW_ONLY;
  }
  if (params.retentionRolling7d < params.retentionThreshold) {
    return QueueMode.CONSOLIDATION;
  }
  return QueueMode.NORMAL;
}

export function evaluateWarmup(ayahIds: number[], attempts: Array<{ ayahId: number; success: boolean; errorsCount: number }>): WarmupEvaluation {
  if (ayahIds.length === 0) {
    return {
      totalItems: 0,
      passed: true,
      failed: false,
      pending: false,
      passingAyahIds: [],
      failingAyahIds: []
    };
  }

  const attemptsByAyah = new Map<number, Array<{ success: boolean; errorsCount: number }>>();
  for (const attempt of attempts) {
    if (!attemptsByAyah.has(attempt.ayahId)) {
      attemptsByAyah.set(attempt.ayahId, []);
    }
    attemptsByAyah.get(attempt.ayahId)?.push({
      success: attempt.success,
      errorsCount: attempt.errorsCount
    });
  }

  const passingAyahIds: number[] = [];
  const failingAyahIds: number[] = [];
  let pendingCount = 0;

  for (const ayahId of ayahIds) {
    const itemAttempts = attemptsByAyah.get(ayahId) ?? [];
    if (itemAttempts.length === 0) {
      pendingCount += 1;
      continue;
    }

    const hasPass = itemAttempts.some((a) => a.success && a.errorsCount <= 1);
    if (hasPass) {
      passingAyahIds.push(ayahId);
    } else {
      failingAyahIds.push(ayahId);
    }
  }

  return {
    totalItems: ayahIds.length,
    passed: passingAyahIds.length === ayahIds.length,
    failed: failingAyahIds.length > 0,
    pending: pendingCount > 0,
    passingAyahIds,
    failingAyahIds
  };
}

function sortByRisk(now: Date, a: RiskState, b: RiskState): number {
  const overdueA = Math.max(0, Math.floor((now.getTime() - a.nextReviewAt.getTime()) / 1000));
  const overdueB = Math.max(0, Math.floor((now.getTime() - b.nextReviewAt.getTime()) / 1000));
  if (overdueA !== overdueB) {
    return overdueB - overdueA;
  }
  if (a.lapses !== b.lapses) {
    return b.lapses - a.lapses;
  }
  if (a.difficultyScore !== b.difficultyScore) {
    return b.difficultyScore - a.difficultyScore;
  }
  return b.lastErrorsCount - a.lastErrorsCount;
}

export function buildManzilQueue(params: {
  dueManzilStates: RiskState[];
  activeManzilStates: RiskState[];
  manzilRotationDays: number;
  now: Date;
}): RiskState[] {
  const dueSorted = [...params.dueManzilStates].sort((a, b) => sortByRisk(params.now, a, b));
  const targetCount = Math.max(
    1,
    Math.ceil(params.activeManzilStates.length / Math.max(1, params.manzilRotationDays))
  );
  if (dueSorted.length >= targetCount) {
    return dueSorted;
  }

  const included = new Set(dueSorted.map((item) => item.ayahId));
  const fillers = params.activeManzilStates
    .filter((item) => !included.has(item.ayahId))
    .sort((a, b) => sortByRisk(params.now, a, b));

  return [...dueSorted, ...fillers.slice(0, targetCount - dueSorted.length)];
}

function toQueueItem(now: Date, state: RiskState): {
  ayah_id: number;
  surah_number: number;
  ayah_number: number;
  page_number: number;
  tier: ReviewTier;
  next_review_at: string;
  overdue_seconds: number;
  lapses: number;
  difficulty_score: number;
} {
  return {
    ayah_id: state.ayahId,
    surah_number: state.ayah.surahNumber,
    ayah_number: state.ayah.ayahNumber,
    page_number: state.ayah.pageNumber,
    tier: state.tier,
    next_review_at: state.nextReviewAt.toISOString(),
    overdue_seconds: Math.max(0, Math.floor((now.getTime() - state.nextReviewAt.getTime()) / 1000)),
    lapses: state.lapses,
    difficulty_score: state.difficultyScore
  };
}

async function computeRetentionRolling7d(userId: string, now: Date): Promise<number> {
  const start = startOfUtcDay(addDays(now, -6));
  const end = endOfUtcDay(now);
  const sessions = await prisma.dailySession.findMany({
    where: {
      userId,
      sessionDate: {
        gte: start,
        lte: end
      }
    },
    select: {
      retentionScore: true
    }
  });
  if (sessions.length === 0) {
    return 1;
  }
  const total = sessions.reduce((acc, session) => acc + session.retentionScore, 0);
  return total / sessions.length;
}

export async function getTodayQueue(userId: string, now = new Date()): Promise<TodayQueuePayload> {
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });
  if (!user) {
    throw new Error("User not found");
  }

  if (shouldBlockForFluencyGate(user)) {
    return {
      mode: FLUENCY_GATE_REQUIRED_MODE,
      message: "You must pass the Fluency Gate test before memorizing",
      sabaq_allowed: false,
      sabqi_queue: [],
      manzil_queue: [],
      weak_transitions: [],
      link_repair_recommended: false,
      action_required: "COMPLETE_FLUENCY_GATE"
    };
  }

  const dueStates = await prisma.userItemState.findMany({
    where: {
      userId,
      nextReviewAt: {
        lte: now
      }
    },
    select: {
      ayahId: true,
      tier: true,
      nextReviewAt: true,
      lapses: true,
      difficultyScore: true,
      lastErrorsCount: true,
      intervalCheckpointIndex: true,
      ayah: {
        select: {
          surahNumber: true,
          ayahNumber: true,
          pageNumber: true
        }
      }
    }
  });
  const earliestDueAt = dueStates.length
    ? dueStates.reduce((earliest, state) =>
        state.nextReviewAt < earliest ? state.nextReviewAt : earliest,
      dueStates[0].nextReviewAt)
    : undefined;
  const debt = calculateDebtMetrics({
    dueItemsCount: dueStates.length,
    avgSecondsPerItem: user.avgSecondsPerItem,
    timeBudgetMinutes: user.timeBudgetMinutes,
    backlogFreezeRatio: user.backlogFreezeRatio,
    earliestDueAt,
    now
  });

  const yesterdayStart = startOfUtcDay(addDays(now, -1));
  const yesterdayEnd = endOfUtcDay(addDays(now, -1));
  const warmupStates = await prisma.userItemState.findMany({
    where: {
      userId,
      introducedAt: {
        gte: yesterdayStart,
        lte: yesterdayEnd
      }
    },
    select: {
      ayahId: true
    }
  });
  const warmupAyahIds = warmupStates.map((state) => state.ayahId);
  const warmupAttemptsRaw = warmupAyahIds.length
    ? await prisma.reviewEvent.findMany({
        where: {
          userId,
          eventType: ReviewEventType.REVIEW_ATTEMPTED,
          itemAyahId: {
            in: warmupAyahIds
          },
          occurredAt: {
            gte: startOfUtcDay(now)
          }
        },
        select: {
          itemAyahId: true,
          success: true,
          errorsCount: true
        }
      })
    : [];
  const warmupAttempts = warmupAttemptsRaw
    .filter((attempt) => attempt.itemAyahId !== null && attempt.success !== null)
    .map((attempt) => ({
      ayahId: attempt.itemAyahId as number,
      success: attempt.success as boolean,
      errorsCount: attempt.errorsCount ?? 0
    }));
  const warmup = evaluateWarmup(warmupAyahIds, warmupAttempts);

  const retentionRolling7d = await computeRetentionRolling7d(userId, now);
  let mode = determineQueueMode({
    debt,
    retentionRolling7d,
    retentionThreshold: user.retentionThreshold,
    warmup
  });

  const sabqiQueueRaw = dueStates
    .filter((state) => state.tier !== ReviewTier.MANZIL)
    .sort((a, b) => sortByRisk(now, a, b));

  const dueManzil = dueStates.filter((state) => state.tier === ReviewTier.MANZIL);
  const activeManzil = await prisma.userItemState.findMany({
    where: {
      userId,
      tier: ReviewTier.MANZIL
    },
    select: {
      ayahId: true,
      tier: true,
      nextReviewAt: true,
      lapses: true,
      difficultyScore: true,
      lastErrorsCount: true,
      intervalCheckpointIndex: true,
      ayah: {
        select: {
          surahNumber: true,
          ayahNumber: true,
          pageNumber: true
        }
      }
    }
  });
  const manzilQueueRaw = buildManzilQueue({
    dueManzilStates: dueManzil,
    activeManzilStates: activeManzil,
    manzilRotationDays: user.manzilRotationDays,
    now
  });

  assertUuid(userId);
  const weakTransitions = await prisma.$queryRawUnsafe<
    Array<{
      fromAyahId: number;
      toAyahId: number;
      successCount: number;
      attemptCount: number;
      successRate: number;
    }>
  >(
    `SELECT 
      "fromAyahId",
      "toAyahId",
      "successCount",
      "attemptCount",
      ("successCount"::float / NULLIF("attemptCount", 0)) AS "successRate"
    FROM "public"."TransitionScore"
    WHERE "userId" = '${userId}'::uuid
      AND "attemptCount" >= 3
      AND ("successCount"::float / NULLIF("attemptCount", 0)) < 0.70
    ORDER BY "successRate" ASC
    LIMIT 10`
  );

  const warmupBlockedReason = warmup.failed
    ? "warmup_failed"
    : warmup.pending
      ? "warmup_pending"
      : "none";

  if (mode !== QueueMode.REVIEW_ONLY && warmup.failed) {
    mode = QueueMode.REVIEW_ONLY;
  }

  let targetAyahs = user.dailyNewTargetAyahs;
  if (mode === QueueMode.CONSOLIDATION) {
    targetAyahs = Math.max(1, Math.floor(user.dailyNewTargetAyahs / 2));
  }
  if (mode === QueueMode.REVIEW_ONLY) {
    targetAyahs = 0;
  }

  return {
    mode,
    debt,
    retentionRolling7d,
    warmup_test: {
      max_errors: 1,
      total_items: warmup.totalItems,
      passed: warmup.passed,
      failed: warmup.failed,
      pending: warmup.pending,
      ayah_ids: warmupAyahIds
    },
    sabaq_task: {
      allowed: mode !== QueueMode.REVIEW_ONLY && warmup.passed,
      target_ayahs: targetAyahs,
      blocked_reason:
        mode === QueueMode.REVIEW_ONLY
          ? warmup.failed
            ? "warmup_failed"
            : "mode_review_only"
          : warmupBlockedReason
    },
    sabqi_queue: sabqiQueueRaw.map((state) => toQueueItem(now, state)),
    manzil_queue: manzilQueueRaw.map((state) => toQueueItem(now, state)),
    weak_transitions: weakTransitions.map((transition) => ({
      from_ayah_id: transition.fromAyahId,
      to_ayah_id: transition.toAyahId,
      success_rate: transition.successRate,
      success_count: transition.successCount,
      attempt_count: transition.attemptCount
    })),
    link_repair_recommended: weakTransitions.length > 5
  };
}
