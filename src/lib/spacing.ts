import { ReviewTier } from "@prisma/client";
import { addSeconds } from "./time";

export const SRS_CHECKPOINTS_SECONDS = [
  4 * 60 * 60,
  8 * 60 * 60,
  1 * 24 * 60 * 60,
  3 * 24 * 60 * 60,
  7 * 24 * 60 * 60,
  14 * 24 * 60 * 60,
  30 * 24 * 60 * 60,
  90 * 24 * 60 * 60
] as const;

export const INTERVAL_CHECKPOINTS_SECONDS = SRS_CHECKPOINTS_SECONDS;

export type ReviewOutcome = "perfect" | "minor" | "fail";

export function outcomeFromAttempt(success: boolean, errorsCount: number): ReviewOutcome {
  if (!success) {
    return "fail";
  }
  if (errorsCount === 0) {
    return "perfect";
  }
  if (errorsCount <= 2) {
    return "minor";
  }
  return "fail";
}

export function nextCheckpointIndex(currentIndex: number, outcome: ReviewOutcome): number {
  if (outcome === "perfect") {
    return Math.min(currentIndex + 1, SRS_CHECKPOINTS_SECONDS.length - 1);
  }
  if (outcome === "minor") {
    return currentIndex;
  }
  return 0;
}

export function tierFromCheckpoint(index: number): ReviewTier {
  if (index <= 1) {
    return ReviewTier.SABAQ;
  }
  if (index <= 5) {
    return ReviewTier.SABQI;
  }
  return ReviewTier.MANZIL;
}

export function scheduleFromCheckpoint(index: number, anchorAt: Date): {
  intervalSeconds: number;
  nextReviewAt: Date;
} {
  const intervalSeconds = SRS_CHECKPOINTS_SECONDS[index];
  return {
    intervalSeconds,
    nextReviewAt: addSeconds(anchorAt, intervalSeconds)
  };
}

export function checkpointIndexForInterval(currentIntervalSeconds: number): number {
  const foundIndex = SRS_CHECKPOINTS_SECONDS.findIndex(
    (checkpoint) => checkpoint >= currentIntervalSeconds
  );
  if (foundIndex >= 0) {
    return foundIndex;
  }
  return SRS_CHECKPOINTS_SECONDS.length - 1;
}

export function calculateNextReview(
  currentIntervalSeconds: number,
  performance: {
    success: boolean;
    errorsCount: number;
  },
  anchorAt: Date
): {
  nextReviewAt: Date;
  reviewIntervalSeconds: number;
  checkpointIndex: number;
} {
  const currentIndex = checkpointIndexForInterval(currentIntervalSeconds);
  const outcome = outcomeFromAttempt(performance.success, performance.errorsCount);
  const checkpointIndex = nextCheckpointIndex(currentIndex, outcome);
  const interval = SRS_CHECKPOINTS_SECONDS[checkpointIndex];
  return {
    nextReviewAt: addSeconds(anchorAt, interval),
    reviewIntervalSeconds: interval,
    checkpointIndex
  };
}

export function adjustDifficulty(current: number, outcome: ReviewOutcome): number {
  if (outcome === "fail") {
    return Math.min(1, current + 0.1);
  }
  if (outcome === "minor") {
    return Math.min(1, current + 0.03);
  }
  return Math.max(0, current - 0.05);
}
