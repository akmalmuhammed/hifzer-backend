import { SessionStatus } from "@prisma/client";
import { SRS_CHECKPOINTS_SECONDS } from "../../lib/spacing";
import { prisma } from "../../lib/prisma";
import { startOfUtcDay } from "../../lib/time";

const TOTAL_QURAN_AYAHS = 6236;
const AYAHS_IN_FIRST_JUZ_APPROX = 148;

const CHECKPOINT_LABELS = ["4h", "8h", "1d", "3d", "7d", "14d", "30d", "90d"] as const;

type BadgeRarity = "Common" | "Rare" | "Epic" | "Legendary";

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthWindow(month?: string) {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;

  const parsedYear = month ? Number(month.slice(0, 4)) : currentYear;
  const parsedMonth = month ? Number(month.slice(5, 7)) : currentMonth;

  const year = Number.isFinite(parsedYear) ? parsedYear : currentYear;
  const monthNumber = Number.isFinite(parsedMonth) ? parsedMonth : currentMonth;
  const safeMonth = Math.min(Math.max(monthNumber, 1), 12);

  const start = new Date(Date.UTC(year, safeMonth - 1, 1));
  const end = new Date(Date.UTC(year, safeMonth, 0, 23, 59, 59, 999));
  const daysInMonth = new Date(Date.UTC(year, safeMonth, 0)).getUTCDate();
  const monthKey = `${year}-${safeMonth.toString().padStart(2, "0")}`;

  return {
    month: monthKey,
    year,
    monthNumber: safeMonth,
    daysInMonth,
    start,
    end
  };
}

function streakStats(sessionDates: Date[], now = new Date()) {
  if (sessionDates.length === 0) {
    return { current: 0, best: 0 };
  }

  const dayEpochs = sessionDates
    .map((date) => Math.floor(startOfUtcDay(date).getTime() / 86400000))
    .sort((a, b) => a - b);

  const uniqueEpochs = Array.from(new Set(dayEpochs));
  const epochSet = new Set(uniqueEpochs);

  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const epoch of uniqueEpochs) {
    if (prev !== null && epoch === prev + 1) {
      run += 1;
    } else {
      run = 1;
    }
    if (run > best) {
      best = run;
    }
    prev = epoch;
  }

  const todayEpoch = Math.floor(startOfUtcDay(now).getTime() / 86400000);
  const latestEpoch = uniqueEpochs[uniqueEpochs.length - 1];
  if (todayEpoch - latestEpoch > 1) {
    return { current: 0, best };
  }

  let current = 0;
  let cursor = latestEpoch;
  while (epochSet.has(cursor)) {
    current += 1;
    cursor -= 1;
  }

  return { current, best };
}

function xpForDay(params: {
  minutesTotal: number;
  reviewsSuccessful: number;
  newAyahsMemorized: number;
}) {
  return (
    params.minutesTotal * 2 + params.reviewsSuccessful + params.newAyahsMemorized * 10
  );
}

function roundPercent(value: number): number {
  return Math.round(value * 1000) / 10;
}

function levelTitle(level: number): string {
  if (level >= 20) {
    return "Radiant Hafiz";
  }
  if (level >= 12) {
    return "Dawn Master";
  }
  if (level >= 6) {
    return "Dawn Apprentice";
  }
  return "Dawn Novice";
}

function buildBadge(input: {
  id: string;
  name: string;
  description: string;
  rarity: BadgeRarity;
  current: number;
  target: number;
  unlockedAt?: Date | null;
}) {
  const unlocked = input.current >= input.target;
  const remaining = Math.max(0, input.target - input.current);
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    rarity: input.rarity,
    unlocked,
    current: input.current,
    target: input.target,
    progress_percent: Math.min(100, Math.round((input.current / input.target) * 100)),
    unlocked_at: unlocked && input.unlockedAt ? input.unlockedAt.toISOString() : null,
    requirement: unlocked ? null : `${remaining} to go`
  };
}

function isConsecutiveDays(sessions: Array<{ sessionDate: Date }>): boolean {
  if (sessions.length === 0) {
    return false;
  }
  for (let index = 1; index < sessions.length; index += 1) {
    const previous = startOfUtcDay(sessions[index - 1].sessionDate).getTime();
    const current = startOfUtcDay(sessions[index].sessionDate).getTime();
    if (current - previous !== 86400000) {
      return false;
    }
  }
  return true;
}

export async function getUserStats(userId: string) {
  const [totalItems, dueItems, latestDaily, upcomingDue, totalSessions] = await Promise.all([
    prisma.userItemState.count({ where: { userId } }),
    prisma.userItemState.count({
      where: {
        userId,
        nextReviewAt: {
          lte: new Date()
        }
      }
    }),
    prisma.dailySession.findFirst({
      where: { userId },
      orderBy: {
        sessionDate: "desc"
      }
    }),
    prisma.userItemState.findMany({
      where: { userId },
      orderBy: {
        nextReviewAt: "asc"
      },
      take: 12,
      select: {
        ayahId: true,
        nextReviewAt: true,
        tier: true
      }
    }),
    prisma.sessionRun.count({
      where: {
        userId,
        status: SessionStatus.COMPLETED
      }
    })
  ]);

  return {
    total_items_tracked: totalItems,
    due_items: dueItems,
    completed_sessions: totalSessions,
    latest_daily_session: latestDaily,
    upcoming_due: upcomingDue.map((state) => ({
      ayah_id: state.ayahId,
      next_review_at: state.nextReviewAt.toISOString(),
      tier: state.tier
    }))
  };
}

export async function getUserCalendar(userId: string, month?: string) {
  const window = monthWindow(month);
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;

  const sessions = await prisma.dailySession.findMany({
    where: {
      userId,
      sessionDate: {
        gte: window.start,
        lte: window.end
      }
    },
    orderBy: {
      sessionDate: "asc"
    },
    select: {
      sessionDate: true,
      minutesTotal: true,
      newAyahsMemorized: true,
      reviewsTotal: true,
      reviewsSuccessful: true,
      mode: true
    }
  });

  const sessionByDay = new Map<string, (typeof sessions)[number]>();
  for (const session of sessions) {
    sessionByDay.set(isoDay(session.sessionDate), session);
  }

  const days: Array<{
    date: string;
    completed: boolean;
    minutes_total: number;
    ayahs_memorized: number;
    reviews_total: number;
    reviews_successful: number;
    xp: number;
    mode: string | null;
  }> = [];

  for (let day = 1; day <= window.daysInMonth; day += 1) {
    const date = new Date(Date.UTC(window.year, window.monthNumber - 1, day));
    const key = isoDay(date);
    const session = sessionByDay.get(key);
    if (!session) {
      days.push({
        date: key,
        completed: false,
        minutes_total: 0,
        ayahs_memorized: 0,
        reviews_total: 0,
        reviews_successful: 0,
        xp: 0,
        mode: null
      });
      continue;
    }

    days.push({
      date: key,
      completed: true,
      minutes_total: session.minutesTotal,
      ayahs_memorized: session.newAyahsMemorized,
      reviews_total: session.reviewsTotal,
      reviews_successful: session.reviewsSuccessful,
      xp: xpForDay({
        minutesTotal: session.minutesTotal,
        reviewsSuccessful: session.reviewsSuccessful,
        newAyahsMemorized: session.newAyahsMemorized
      }),
      mode: session.mode
    });
  }

  const totals = days.reduce(
    (acc, day) => ({
      total_minutes: acc.total_minutes + day.minutes_total,
      total_ayahs: acc.total_ayahs + day.ayahs_memorized,
      total_xp: acc.total_xp + day.xp,
      active_days: acc.active_days + (day.completed ? 1 : 0)
    }),
    {
      total_minutes: 0,
      total_ayahs: 0,
      total_xp: 0,
      active_days: 0
    }
  );

  let trackedDaysInMonth = 0;
  if (window.year === currentYear && window.monthNumber === currentMonth) {
    trackedDaysInMonth = now.getUTCDate();
  } else if (
    window.year < currentYear ||
    (window.year === currentYear && window.monthNumber < currentMonth)
  ) {
    trackedDaysInMonth = window.daysInMonth;
  }
  const missedDays = Math.max(0, trackedDaysInMonth - totals.active_days);

  const streakDates = await prisma.dailySession.findMany({
    where: {
      userId,
      minutesTotal: {
        gt: 0
      }
    },
    select: {
      sessionDate: true
    },
    orderBy: {
      sessionDate: "asc"
    }
  });

  const streak = streakStats(streakDates.map((entry) => entry.sessionDate), now);

  return {
    month: window.month,
    timezone: "UTC",
    days,
    summary: {
      ...totals,
      tracked_days_in_month: trackedDaysInMonth,
      missed_days: missedDays,
      current_streak: streak.current,
      best_streak: streak.best
    }
  };
}

export async function getUserAchievements(userId: string) {
  const [user, itemsTracked, memorizedAyahs, transitionTotals, allTransitions, dayStats, firstMemorized] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          fluencyScore: true,
          fluencyGatePassed: true
        }
      }),
      prisma.userItemState.count({ where: { userId } }),
      prisma.userItemState.count({
        where: {
          userId,
          firstMemorizedAt: {
            not: null
          }
        }
      }),
      prisma.transitionScore.aggregate({
        where: { userId },
        _sum: {
          attemptCount: true,
          successCount: true
        }
      }),
      prisma.transitionScore.findMany({
        where: {
          userId,
          attemptCount: {
            gte: 3
          }
        },
        select: {
          successCount: true,
          attemptCount: true
        }
      }),
      prisma.dailySession.findMany({
        where: {
          userId,
          minutesTotal: {
            gt: 0
          }
        },
        orderBy: {
          sessionDate: "asc"
        },
        select: {
          sessionDate: true,
          retentionScore: true,
          minutesTotal: true,
          reviewsSuccessful: true,
          newAyahsMemorized: true
        }
      }),
      prisma.userItemState.findFirst({
        where: {
          userId,
          firstMemorizedAt: {
            not: null
          }
        },
        orderBy: {
          firstMemorizedAt: "asc"
        },
        select: {
          firstMemorizedAt: true
        }
      })
    ]);

  if (!user) {
    throw new Error("User not found");
  }

  const streak = streakStats(dayStats.map((entry) => entry.sessionDate));
  const latestSeven = dayStats.slice(-7);
  const perfectWeek =
    latestSeven.length === 7 &&
    latestSeven.every((day) => day.retentionScore >= 0.99) &&
    isConsecutiveDays(latestSeven);

  const transitionAttemptCount = transitionTotals._sum.attemptCount ?? 0;
  const transitionSuccessCount = transitionTotals._sum.successCount ?? 0;
  const weakTransitionCount = allTransitions.filter(
    (transition) => transition.successCount / transition.attemptCount < 0.7
  ).length;

  const totals = dayStats.reduce(
    (acc, day) => ({
      minutes: acc.minutes + day.minutesTotal,
      reviewsSuccessful: acc.reviewsSuccessful + day.reviewsSuccessful,
      newAyahs: acc.newAyahs + day.newAyahsMemorized
    }),
    {
      minutes: 0,
      reviewsSuccessful: 0,
      newAyahs: 0
    }
  );

  const xp =
    totals.minutes * 2 +
    totals.reviewsSuccessful +
    totals.newAyahs * 10 +
    transitionAttemptCount;
  const level = Math.floor(xp / 250) + 1;
  const xpNext = level * 250;
  const title = levelTitle(level);

  const badges = [
    buildBadge({
      id: "streak_master",
      name: "Streak Master",
      description: "Maintain a 7-day streak",
      rarity: "Common",
      current: streak.best,
      target: 7
    }),
    buildBadge({
      id: "first_ayah",
      name: "First Ayah",
      description: "Memorize your first ayah",
      rarity: "Common",
      current: memorizedAyahs,
      target: 1,
      unlockedAt: firstMemorized?.firstMemorizedAt ?? null
    }),
    buildBadge({
      id: "juz_done",
      name: "Juz Done",
      description: "Complete first Juz",
      rarity: "Rare",
      current: memorizedAyahs,
      target: AYAHS_IN_FIRST_JUZ_APPROX
    }),
    buildBadge({
      id: "perfect_week",
      name: "Perfect Week",
      description: "7 consecutive days at perfect retention",
      rarity: "Rare",
      current: perfectWeek ? 1 : 0,
      target: 1
    }),
    buildBadge({
      id: "rare_gem",
      name: "Rare Gem",
      description: "Score 100 on fluency gate",
      rarity: "Epic",
      current: user.fluencyScore ?? 0,
      target: 100
    }),
    buildBadge({
      id: "chain_builder",
      name: "Chain Builder",
      description: "Track 100 verse transitions",
      rarity: "Common",
      current: transitionAttemptCount,
      target: 100
    }),
    buildBadge({
      id: "streak_30",
      name: "30-Day Streak",
      description: "Maintain a 30-day streak",
      rarity: "Epic",
      current: streak.best,
      target: 30
    }),
    buildBadge({
      id: "half_quran",
      name: "Half Quran",
      description: "Memorize 15 Juz",
      rarity: "Legendary",
      current: memorizedAyahs,
      target: Math.ceil(TOTAL_QURAN_AYAHS / 2)
    }),
    buildBadge({
      id: "full_quran",
      name: "Full Quran",
      description: "Memorize all 30 Juz",
      rarity: "Legendary",
      current: memorizedAyahs,
      target: TOTAL_QURAN_AYAHS
    })
  ];

  const unlockedBadges = badges.filter((badge) => badge.unlocked);
  const lockedBadges = badges.filter((badge) => !badge.unlocked);
  const nextMilestone = lockedBadges[0] ?? null;

  return {
    level,
    title,
    xp,
    xp_next: xpNext,
    unlocked_count: unlockedBadges.length,
    total_badges: badges.length,
    badges,
    recent_achievements: unlockedBadges.slice(0, 3),
    next_milestone: nextMilestone
      ? {
          id: nextMilestone.id,
          name: nextMilestone.name,
          requirement: nextMilestone.requirement
        }
      : null,
    metrics: {
      current_streak: streak.current,
      best_streak: streak.best,
      items_tracked: itemsTracked,
      memorized_ayahs: memorizedAyahs,
      transition_attempts: transitionAttemptCount,
      transition_success_rate:
        transitionAttemptCount > 0
          ? roundPercent(transitionSuccessCount / transitionAttemptCount)
          : 0,
      weak_transition_count: weakTransitionCount,
      fluency_score: user.fluencyScore,
      fluency_gate_passed: user.fluencyGatePassed
    }
  };
}

export async function getUserProgress(userId: string) {
  const [stats, transitions, states, dailySessions] = await Promise.all([
    getUserStats(userId),
    prisma.transitionScore.findMany({
      where: { userId },
      include: {
        fromAyah: {
          select: {
            surahNumber: true,
            ayahNumber: true
          }
        },
        toAyah: {
          select: {
            surahNumber: true,
            ayahNumber: true
          }
        }
      }
    }),
    prisma.userItemState.findMany({
      where: { userId },
      select: {
        intervalCheckpointIndex: true,
        successfulReviews: true,
        totalReviews: true
      }
    }),
    prisma.dailySession.findMany({
      where: { userId },
      orderBy: {
        sessionDate: "desc"
      },
      take: 30,
      select: {
        sessionDate: true,
        minutesTotal: true,
        newAyahsMemorized: true,
        reviewsSuccessful: true
      }
    })
  ]);

  const weakTransitions = transitions
    .filter(
      (transition) =>
        transition.attemptCount >= 3 &&
        transition.successCount / transition.attemptCount < 0.7
    )
    .map((transition) => ({
      from_ayah_id: transition.fromAyahId,
      to_ayah_id: transition.toAyahId,
      from_label: `${transition.fromAyah.surahNumber}:${transition.fromAyah.ayahNumber}`,
      to_label: `${transition.toAyah.surahNumber}:${transition.toAyah.ayahNumber}`,
      success_rate: roundPercent(transition.successCount / transition.attemptCount),
      success_count: transition.successCount,
      attempt_count: transition.attemptCount
    }))
    .sort((a, b) => a.success_rate - b.success_rate)
    .slice(0, 10);

  const strongTransitions = transitions
    .filter(
      (transition) =>
        transition.attemptCount >= 3 &&
        transition.successCount / transition.attemptCount >= 0.9
    )
    .map((transition) => ({
      from_ayah_id: transition.fromAyahId,
      to_ayah_id: transition.toAyahId,
      from_label: `${transition.fromAyah.surahNumber}:${transition.fromAyah.ayahNumber}`,
      to_label: `${transition.toAyah.surahNumber}:${transition.toAyah.ayahNumber}`,
      success_rate: roundPercent(transition.successCount / transition.attemptCount),
      attempt_count: transition.attemptCount
    }))
    .sort((a, b) => b.success_rate - a.success_rate)
    .slice(0, 5);

  const transitionTotals = transitions.reduce(
    (acc, transition) => ({
      success: acc.success + transition.successCount,
      attempts: acc.attempts + transition.attemptCount
    }),
    {
      success: 0,
      attempts: 0
    }
  );

  const checkpointTotals = CHECKPOINT_LABELS.map((label, index) => ({
    checkpoint: label,
    interval_seconds: SRS_CHECKPOINTS_SECONDS[index],
    items_count: 0,
    success_sum: 0,
    total_sum: 0
  }));

  for (const state of states) {
    const index = Math.min(
      Math.max(state.intervalCheckpointIndex, 0),
      checkpointTotals.length - 1
    );
    checkpointTotals[index].items_count += 1;
    checkpointTotals[index].success_sum += state.successfulReviews;
    checkpointTotals[index].total_sum += state.totalReviews;
  }

  const checkpointRows = checkpointTotals.map((entry) => ({
    checkpoint: entry.checkpoint,
    interval_seconds: entry.interval_seconds,
    items_count: entry.items_count,
    success_rate:
      entry.total_sum > 0 ? roundPercent(entry.success_sum / entry.total_sum) : null
  }));

  const knownRates = checkpointRows
    .map((entry) => entry.success_rate)
    .filter((value): value is number => value !== null);
  const overallRate =
    knownRates.length > 0
      ? roundPercent(knownRates.reduce((acc, value) => acc + value, 0) / knownRates.length / 100)
      : null;

  const sevenDay = checkpointRows.find((entry) => entry.checkpoint === "7d");
  let recommendation = "Keep consistency and protect review debt before adding new load.";
  if (
    typeof sevenDay?.success_rate === "number" &&
    overallRate !== null &&
    sevenDay.success_rate + 5 < overallRate
  ) {
    recommendation =
      "Add focused reviews around the 7-day checkpoint to reduce mid-interval forgetting.";
  } else if (weakTransitions.length >= 5) {
    recommendation =
      "Schedule a Link Repair session: your weak transitions are high enough to affect flow.";
  }

  const activityDays = dailySessions
    .slice()
    .reverse()
    .map((day) => ({
      date: isoDay(day.sessionDate),
      minutes_total: day.minutesTotal,
      ayahs_memorized: day.newAyahsMemorized,
      xp: xpForDay({
        minutesTotal: day.minutesTotal,
        reviewsSuccessful: day.reviewsSuccessful,
        newAyahsMemorized: day.newAyahsMemorized
      }),
      completed: day.minutesTotal > 0 || day.newAyahsMemorized > 0
    }));

  const activitySummary = activityDays.reduce(
    (acc, day) => ({
      active_days: acc.active_days + (day.completed ? 1 : 0),
      avg_minutes: acc.avg_minutes + day.minutes_total
    }),
    {
      active_days: 0,
      avg_minutes: 0
    }
  );
  const averageMinutes =
    activityDays.length > 0
      ? Math.round(activitySummary.avg_minutes / activityDays.length)
      : 0;

  return {
    overview: {
      total_items_tracked: stats.total_items_tracked,
      due_items: stats.due_items,
      completed_sessions: stats.completed_sessions,
      retention_percent: stats.latest_daily_session
        ? roundPercent(stats.latest_daily_session.retentionScore)
        : 0
    },
    activity: {
      days: activityDays,
      active_days: activitySummary.active_days,
      average_minutes: averageMinutes
    },
    transitions: {
      overall_strength:
        transitionTotals.attempts > 0
          ? roundPercent(transitionTotals.success / transitionTotals.attempts)
          : 0,
      weak: weakTransitions,
      strong: strongTransitions,
      link_repair_recommended: weakTransitions.length > 5
    },
    retention: {
      checkpoints: checkpointRows,
      overall_success_rate: overallRate,
      recommendation
    }
  };
}
