import {
  GoalType,
  PriorJuzBand,
  ProgramVariant,
  ScaffoldingLevel,
  TajwidConfidence
} from "@prisma/client";
import { prisma } from "../../lib/prisma";

export type AssessmentInput = {
  userId: string;
  time_budget_minutes: 15 | 30 | 60 | 90;
  fluency_score: number;
  tajwid_confidence: TajwidConfidence;
  goal: GoalType;
  has_teacher: boolean;
  prior_juz_band: PriorJuzBand;
};

export type AssessmentDefaults = {
  daily_new_target_ayahs: number;
  review_ratio_target: number;
  variant: ProgramVariant;
  scaffolding_level: ScaffoldingLevel;
  retention_threshold: number;
  backlog_freeze_ratio: number;
  consolidation_retention_floor: number;
  manzil_rotation_days: number;
  avg_seconds_per_item: number;
  overdue_cap_seconds: number;
  recommended_minutes?: 30;
  warning?: string;
};

export function assignScaffoldingLevel(input: Omit<AssessmentInput, "userId">): ScaffoldingLevel {
  if (input.fluency_score < 75 || input.prior_juz_band === PriorJuzBand.ZERO) {
    return ScaffoldingLevel.BEGINNER;
  }
  if (
    input.fluency_score > 85 &&
    input.prior_juz_band === PriorJuzBand.FIVE_PLUS &&
    input.has_teacher
  ) {
    return ScaffoldingLevel.MINIMAL;
  }
  return ScaffoldingLevel.STANDARD;
}

export function computeAssessmentDefaults(input: Omit<AssessmentInput, "userId">): AssessmentDefaults {
  const scaffoldingLevel = assignScaffoldingLevel(input);
  let variant: ProgramVariant = ProgramVariant.STANDARD;
  if (input.time_budget_minutes === 15) {
    variant = ProgramVariant.CONSERVATIVE;
  } else if (
    input.time_budget_minutes >= 90 &&
    input.fluency_score >= 70 &&
    input.tajwid_confidence !== TajwidConfidence.LOW &&
    input.has_teacher
  ) {
    variant = ProgramVariant.MOMENTUM;
  } else if (
    input.fluency_score < 45 ||
    input.tajwid_confidence === TajwidConfidence.LOW ||
    input.has_teacher === false
  ) {
    variant = ProgramVariant.CONSERVATIVE;
  }

  let dailyNewTargetAyahs = 7;
  if (input.time_budget_minutes === 15) {
    dailyNewTargetAyahs = 3;
  } else if (variant === ProgramVariant.MOMENTUM) {
    dailyNewTargetAyahs = 10;
  } else if (variant === ProgramVariant.CONSERVATIVE || input.time_budget_minutes === 30) {
    dailyNewTargetAyahs = 5;
  }

  if (input.time_budget_minutes === 90 && dailyNewTargetAyahs < 7) {
    dailyNewTargetAyahs = 7;
  }
  if (input.time_budget_minutes === 15) {
    dailyNewTargetAyahs = Math.min(3, dailyNewTargetAyahs);
  }

  const retentionThreshold =
    variant === ProgramVariant.CONSERVATIVE
      ? 0.88
      : variant === ProgramVariant.MOMENTUM
        ? 0.82
        : 0.85;

  const consolidationRetentionFloor = Math.max(0.7, retentionThreshold - 0.08);

  const avgSecondsPerItem =
    input.fluency_score >= 75
      ? 55
      : input.fluency_score >= 50
        ? 70
        : 90;

  const defaults: AssessmentDefaults = {
    daily_new_target_ayahs: dailyNewTargetAyahs,
    review_ratio_target: 70,
    variant,
    scaffolding_level: scaffoldingLevel,
    retention_threshold: retentionThreshold,
    backlog_freeze_ratio: 0.8,
    consolidation_retention_floor: consolidationRetentionFloor,
    manzil_rotation_days: 30,
    avg_seconds_per_item: avgSecondsPerItem,
    overdue_cap_seconds: 2 * 24 * 60 * 60
  };

  if (input.time_budget_minutes === 15) {
    defaults.recommended_minutes = 30;
    defaults.warning =
      "15 minutes/day is supported with conservative pacing (max 3 ayahs/day). For stronger outcomes, prefer 30+ minutes.";
  }

  return defaults;
}

export async function submitAssessment(input: AssessmentInput): Promise<AssessmentDefaults> {
  const defaults = computeAssessmentDefaults(input);

  await prisma.user.update({
    where: { id: input.userId },
    data: {
      timeBudgetMinutes: input.time_budget_minutes,
      fluencyScore: input.fluency_score,
      tajwidConfidence: input.tajwid_confidence,
      goal: input.goal,
      hasTeacher: input.has_teacher,
      priorJuzBand: input.prior_juz_band,
      scaffoldingLevel: defaults.scaffolding_level,
      dailyNewTargetAyahs: defaults.daily_new_target_ayahs,
      reviewRatioTarget: defaults.review_ratio_target,
      variant: defaults.variant,
      retentionThreshold: defaults.retention_threshold,
      backlogFreezeRatio: defaults.backlog_freeze_ratio,
      consolidationRetentionFloor: defaults.consolidation_retention_floor,
      manzilRotationDays: defaults.manzil_rotation_days,
      avgSecondsPerItem: defaults.avg_seconds_per_item,
      overdueCapSeconds: defaults.overdue_cap_seconds
    }
  });

  return defaults;
}
