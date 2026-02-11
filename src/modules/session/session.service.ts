import crypto from "node:crypto";
import {
  QueueMode,
  ReviewEventType,
  ReviewSessionType,
  ReviewStepType,
  ReviewTier,
  ScaffoldingLevel,
  SessionStatus
} from "@prisma/client";
import { env } from "../../config/env";
import { HttpError } from "../../lib/http";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { startOfUtcDay } from "../../lib/time";
import {
  FLUENCY_GATE_REQUIRED_MODE,
  FluencyGateRequiredQueuePayload,
  getTodayQueue,
  NormalTodayQueuePayload
} from "../queue/queue.service";
import { enqueueReducerJob } from "../../queues/reducerQueue";
import { rebuildItemState, updateTransitionScoreFromEvent } from "./reducer.service";
import {
  ReviewEventInput,
  SessionCompleteInput,
  SessionStartInput,
  StepCompleteInput
} from "./session.schemas";

export type StepStatus = "IN_PROGRESS" | "STEP_COMPLETE" | "AYAH_COMPLETE";

export type ProtocolStep = {
  step: ReviewStepType;
  attempts: number;
  optional?: boolean;
};

export type StepProtocol = {
  scaffoldingLevel: ScaffoldingLevel;
  steps: ProtocolStep[];
};

export type StepExpectation = {
  expectedStep: ReviewStepType | null;
  expectedAttempt: number | null;
  completed: boolean;
};

type IngestDependencies = {
  prismaClient: typeof prisma;
  enqueue: typeof enqueueReducerJob;
  rebuild: typeof rebuildItemState;
  updateTransition: typeof updateTransitionScoreFromEvent;
  processInline: boolean;
};

const defaultIngestDeps: IngestDependencies = {
  prismaClient: prisma,
  enqueue: enqueueReducerJob,
  rebuild: rebuildItemState,
  updateTransition: updateTransitionScoreFromEvent,
  processInline: env.PROCESS_EVENTS_INLINE
};

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  return "code" in error && (error as { code?: unknown }).code === "P2002";
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  return "code" in error && (error as { code?: unknown }).code === "P2025";
}

function isBlockedByFluencyGate(
  queue: Awaited<ReturnType<typeof getTodayQueue>>
): queue is FluencyGateRequiredQueuePayload {
  return queue.mode === FLUENCY_GATE_REQUIRED_MODE;
}

function queueForCompletedSession(
  queue: Awaited<ReturnType<typeof getTodayQueue>>
): NormalTodayQueuePayload {
  if (isBlockedByFluencyGate(queue)) {
    throw new HttpError(409, "Queue is blocked by fluency gate");
  }
  return queue;
}

function deterministicEventUuid(input: string): string {
  const hash = crypto.createHash("sha256").update(input).digest("hex");
  const chars = hash.slice(0, 32).split("");
  chars[12] = "4";
  const variantNibble = parseInt(chars[16], 16);
  chars[16] = ((variantNibble & 0x3) | 0x8).toString(16);
  return `${chars.slice(0, 8).join("")}-${chars.slice(8, 12).join("")}-${chars.slice(12, 16).join("")}-${chars.slice(16, 20).join("")}-${chars.slice(20, 32).join("")}`;
}

function sessionTypeFromTier(tier: ReviewTier): ReviewSessionType {
  if (tier === ReviewTier.SABAQ) {
    return ReviewSessionType.SABAQ;
  }
  if (tier === ReviewTier.SABQI) {
    return ReviewSessionType.SABQI;
  }
  return ReviewSessionType.MANZIL;
}

export function nextStepForWorkflow(
  stepType: ReviewStepType,
  attemptNumber: number
): "EXPOSURE" | "GUIDED" | "BLIND" | "LINK" | "COMPLETE" | null {
  if (stepType === ReviewStepType.EXPOSURE && attemptNumber === 3) {
    return "GUIDED";
  }
  if (stepType === ReviewStepType.GUIDED && attemptNumber === 3) {
    return "BLIND";
  }
  if (stepType === ReviewStepType.BLIND && attemptNumber === 3) {
    return "LINK";
  }
  if (stepType === ReviewStepType.LINK && attemptNumber === 3) {
    return "COMPLETE";
  }
  return null;
}

export function buildProtocol(scaffoldingLevel: ScaffoldingLevel): StepProtocol {
  if (scaffoldingLevel === ScaffoldingLevel.BEGINNER) {
    return {
      scaffoldingLevel,
      steps: [
        { step: ReviewStepType.EXPOSURE, attempts: 3 },
        { step: ReviewStepType.GUIDED, attempts: 3 },
        { step: ReviewStepType.BLIND, attempts: 3 },
        { step: ReviewStepType.LINK, attempts: 3 }
      ]
    };
  }

  if (scaffoldingLevel === ScaffoldingLevel.MINIMAL) {
    return {
      scaffoldingLevel,
      steps: [
        { step: ReviewStepType.EXPOSURE, attempts: 3, optional: true },
        { step: ReviewStepType.GUIDED, attempts: 3, optional: true },
        { step: ReviewStepType.BLIND, attempts: 3 },
        { step: ReviewStepType.LINK, attempts: 3 }
      ]
    };
  }

  return {
    scaffoldingLevel,
    steps: [
      { step: ReviewStepType.EXPOSURE, attempts: 3 },
      { step: ReviewStepType.GUIDED, attempts: 1 },
      { step: ReviewStepType.BLIND, attempts: 3 },
      { step: ReviewStepType.LINK, attempts: 3 }
    ]
  };
}

function protocolSummary(protocol: StepProtocol) {
  return protocol.steps.map((step) => ({
    step: step.step,
    attempts_required: step.attempts,
    optional: Boolean(step.optional)
  }));
}

function countAttemptsByStep(
  stepAttempts: Array<{ stepType: ReviewStepType | null; attemptNumber: number | null }>
): Map<ReviewStepType, number> {
  const counts = new Map<ReviewStepType, number>();
  for (const event of stepAttempts) {
    if (!event.stepType) {
      continue;
    }
    counts.set(event.stepType, (counts.get(event.stepType) ?? 0) + 1);
  }
  return counts;
}

export function expectedFromProtocol(
  protocol: StepProtocol,
  counts: Map<ReviewStepType, number>
): StepExpectation {
  for (const step of protocol.steps) {
    if (step.optional) {
      continue;
    }
    const observed = counts.get(step.step) ?? 0;
    if (observed < step.attempts) {
      return {
        expectedStep: step.step,
        expectedAttempt: observed + 1,
        completed: false
      };
    }
  }
  return {
    expectedStep: null,
    expectedAttempt: null,
    completed: true
  };
}

export function validateStepAttempt(params: {
  protocol: StepProtocol;
  expected: StepExpectation;
  counts: Map<ReviewStepType, number>;
  stepType: ReviewStepType;
  attemptNumber: number;
}): { valid: boolean; reason?: "MISMATCH_EXPECTED" | "OPTIONAL_STEP_OUT_OF_SEQUENCE" | "OPTIONAL_STEP_ATTEMPT_INVALID" } {
  if (params.expected.completed) {
    return { valid: false, reason: "MISMATCH_EXPECTED" };
  }

  const optionalStep = params.protocol.steps.find(
    (step) => step.optional && step.step === params.stepType
  );
  if (optionalStep) {
    if (params.expected.expectedStep !== ReviewStepType.BLIND) {
      return { valid: false, reason: "OPTIONAL_STEP_OUT_OF_SEQUENCE" };
    }
    const observed = params.counts.get(params.stepType) ?? 0;
    const expectedOptionalAttempt = observed + 1;
    if (params.attemptNumber !== expectedOptionalAttempt || params.attemptNumber > optionalStep.attempts) {
      return { valid: false, reason: "OPTIONAL_STEP_ATTEMPT_INVALID" };
    }
    return { valid: true };
  }

  if (
    params.stepType !== params.expected.expectedStep ||
    params.attemptNumber !== params.expected.expectedAttempt
  ) {
    return { valid: false, reason: "MISMATCH_EXPECTED" };
  }

  return { valid: true };
}

function buildInvalidStepSequenceError(params: {
  expected: StepExpectation;
  protocol: StepProtocol;
}): HttpError {
  return new HttpError(409, "Invalid step sequence", {
    code: "INVALID_STEP_SEQUENCE",
    expected_step: params.expected.expectedStep,
    expected_attempt: params.expected.expectedAttempt,
    required_protocol: protocolSummary(params.protocol)
  });
}

export async function startSession(userId: string, input: SessionStartInput) {
  const todayQueue = await getTodayQueue(userId);
  if (isBlockedByFluencyGate(todayQueue)) {
    throw new HttpError(403, todayQueue.message);
  }
  const mode = input.mode ?? todayQueue.mode;
  const warmupPassed = input.warmup_passed ?? todayQueue.warmup_test.passed;

  try {
    const session = await prisma.sessionRun.create({
      data: {
        userId,
        clientSessionId: input.client_session_id ?? null,
        mode,
        warmupPassed
      }
    });
    return {
      session_id: session.id,
      mode: session.mode,
      warmup_passed: session.warmupPassed
    };
  } catch (error) {
    if (!isUniqueConstraintError(error) || !input.client_session_id) {
      throw error;
    }
    const existing = await prisma.sessionRun.findUnique({
      where: {
        userId_clientSessionId: {
          userId,
          clientSessionId: input.client_session_id
        }
      }
    });
    if (!existing) {
      throw error;
    }
    return {
      session_id: existing.id,
      mode: existing.mode,
      warmup_passed: existing.warmupPassed
    };
  }
}

export async function ingestReviewEvent(
  userId: string,
  input: ReviewEventInput,
  deps: IngestDependencies = defaultIngestDeps
): Promise<{ deduplicated: boolean; event_id?: string }> {
  let createdId: bigint | null = null;
  try {
    const created = await deps.prismaClient.reviewEvent.create({
      data: {
        userId,
        sessionRunId: input.session_id ?? null,
        clientEventId: input.client_event_id,
        eventType: input.event_type,
        sessionType:
          input.session_type ??
          (input.event_type === ReviewEventType.REVIEW_ATTEMPTED
            ? sessionTypeFromTier(input.tier)
            : ReviewSessionType.SABQI),
        itemAyahId: input.event_type === ReviewEventType.REVIEW_ATTEMPTED ? input.item_ayah_id : null,
        tier: input.event_type === ReviewEventType.REVIEW_ATTEMPTED ? input.tier : null,
        stepType: input.event_type === ReviewEventType.REVIEW_ATTEMPTED ? (input.step_type ?? null) : null,
        attemptNumber:
          input.event_type === ReviewEventType.REVIEW_ATTEMPTED
            ? (input.attempt_number ?? null)
            : null,
        scaffoldingUsed:
          input.event_type === ReviewEventType.REVIEW_ATTEMPTED
            ? Boolean(input.scaffolding_used)
            : false,
        linkedAyahId:
          input.event_type === ReviewEventType.REVIEW_ATTEMPTED
            ? (input.linked_ayah_id ?? null)
            : null,
        success: input.success,
        errorsCount: input.event_type === ReviewEventType.REVIEW_ATTEMPTED ? input.errors_count : null,
        durationSeconds:
          input.event_type === ReviewEventType.REVIEW_ATTEMPTED
            ? input.duration_seconds
            : null,
        errorTags:
          input.event_type === ReviewEventType.REVIEW_ATTEMPTED
            ? input.error_tags ?? undefined
            : undefined,
        fromAyahId:
          input.event_type === ReviewEventType.TRANSITION_ATTEMPTED
            ? input.from_ayah_id
            : null,
        toAyahId:
          input.event_type === ReviewEventType.TRANSITION_ATTEMPTED
            ? input.to_ayah_id
            : null,
        occurredAt: input.occurred_at
      }
    });
    createdId = created.id;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { deduplicated: true };
    }
    if (isNotFoundError(error)) {
      throw new HttpError(404, "Session not found");
    }
    throw error;
  }

  if (input.session_id) {
    await deps.prismaClient.sessionRun.update({
      where: { id: input.session_id },
      data: {
        eventsCount: {
          increment: 1
        }
      }
    });
  }

  if (input.event_type === ReviewEventType.REVIEW_ATTEMPTED) {
    let enqueueSucceeded = false;
    try {
      await deps.enqueue({
        userId,
        ayahId: input.item_ayah_id
      });
      enqueueSucceeded = true;
    } catch (error) {
      logger.warn({ err: error }, "Reducer enqueue failed; using inline fallback");
    }
    if (deps.processInline || !enqueueSucceeded) {
      await deps.rebuild(userId, input.item_ayah_id);
    }
    if (input.step_type === ReviewStepType.LINK && input.linked_ayah_id) {
      await deps.updateTransition({
        userId,
        fromAyahId: input.item_ayah_id,
        toAyahId: input.linked_ayah_id,
        success: input.success,
        occurredAt: input.occurred_at
      });
    }
  } else {
    await deps.updateTransition({
      userId,
      fromAyahId: input.from_ayah_id,
      toAyahId: input.to_ayah_id,
      success: input.success,
      occurredAt: input.occurred_at
    });
  }

  return {
    deduplicated: false,
    event_id: createdId ? createdId.toString() : undefined
  };
}

export async function completeSession(userId: string, input: SessionCompleteInput) {
  const session = await prisma.sessionRun.findFirst({
    where: {
      id: input.session_id,
      userId
    }
  });
  if (!session) {
    throw new HttpError(404, "Session not found");
  }

  if (session.status !== SessionStatus.ACTIVE) {
    throw new HttpError(409, "Session already completed");
  }

  const endedAt = new Date();
  await prisma.sessionRun.update({
    where: { id: session.id },
    data: {
      status: SessionStatus.COMPLETED,
      endedAt
    }
  });

  const reviewEvents = await prisma.reviewEvent.findMany({
    where: {
      userId,
      sessionRunId: session.id,
      eventType: ReviewEventType.REVIEW_ATTEMPTED
    },
    select: {
      success: true,
      durationSeconds: true
    }
  });
  const reviewsTotal = reviewEvents.length;
  const reviewsSuccessful = reviewEvents.filter((event) => event.success).length;
  const retentionScore = reviewsTotal > 0 ? reviewsSuccessful / reviewsTotal : 1;
  const durationSecondsTotal = reviewEvents.reduce(
    (acc, event) => acc + (event.durationSeconds ?? 0),
    0
  );
  const minutesTotal = Math.ceil(durationSecondsTotal / 60);

  const todayStart = startOfUtcDay(endedAt);
  const newAyahsMemorized = await prisma.userItemState.count({
    where: {
      userId,
      firstMemorizedAt: {
        gte: todayStart
      }
    }
  });

  const queue = queueForCompletedSession(await getTodayQueue(userId, endedAt));
  await prisma.dailySession.upsert({
    where: {
      userId_sessionDate: {
        userId,
        sessionDate: todayStart
      }
    },
    create: {
      userId,
      sessionDate: todayStart,
      mode: queue.mode,
      retentionScore,
      backlogMinutesEstimate: queue.debt.backlogMinutesEstimate,
      overdueDaysMax: queue.debt.overdueDaysMax,
      minutesTotal,
      reviewsTotal,
      reviewsSuccessful,
      newAyahsMemorized,
      warmupPassed: queue.warmup_test.passed,
      sabaqAllowed: queue.sabaq_task.allowed
    },
    update: {
      mode: queue.mode,
      retentionScore,
      backlogMinutesEstimate: queue.debt.backlogMinutesEstimate,
      overdueDaysMax: queue.debt.overdueDaysMax,
      minutesTotal: {
        increment: minutesTotal
      },
      reviewsTotal: {
        increment: reviewsTotal
      },
      reviewsSuccessful: {
        increment: reviewsSuccessful
      },
      newAyahsMemorized,
      warmupPassed: queue.warmup_test.passed,
      sabaqAllowed: queue.sabaq_task.allowed
    }
  });

  await prisma.sessionRun.update({
    where: { id: session.id },
    data: {
      minutesTotal
    }
  });

  return {
    session_id: session.id,
    retention_score: retentionScore,
    backlog_minutes: queue.debt.backlogMinutesEstimate,
    minutes_total: minutesTotal,
    mode: queue.mode
  };
}

export async function completeSessionStep(userId: string, input: StepCompleteInput) {
  const [session, user, existingStepEvents] = await Promise.all([
    prisma.sessionRun.findFirst({
      where: {
        id: input.session_id,
        userId
      },
      select: {
        id: true,
        status: true
      }
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        scaffoldingLevel: true
      }
    }),
    prisma.reviewEvent.findMany({
      where: {
        userId,
        sessionRunId: input.session_id,
        eventType: ReviewEventType.REVIEW_ATTEMPTED,
        itemAyahId: input.ayah_id
      },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      select: {
        stepType: true,
        attemptNumber: true
      }
    })
  ]);

  if (!session) {
    throw new HttpError(404, "Session not found");
  }
  if (session.status !== SessionStatus.ACTIVE) {
    throw new HttpError(409, "Session already completed");
  }
  if (!user) {
    throw new HttpError(404, "User not found");
  }

  const protocol = buildProtocol(user.scaffoldingLevel);
  const existingCounts = countAttemptsByStep(existingStepEvents);
  const expectedBefore = expectedFromProtocol(protocol, existingCounts);

  if (expectedBefore.completed) {
    throw buildInvalidStepSequenceError({
      expected: expectedBefore,
      protocol
    });
  }

  const validAttempt = validateStepAttempt({
    protocol,
    expected: expectedBefore,
    counts: existingCounts,
    stepType: input.step_type,
    attemptNumber: input.attempt_number
  });
  if (!validAttempt.valid) {
    throw buildInvalidStepSequenceError({
      expected: expectedBefore,
      protocol
    });
  }

  const clientEventId = deterministicEventUuid(
    `${input.session_id}:${input.ayah_id}:${input.step_type}:${input.attempt_number}`
  );
  const ingestResult = await ingestReviewEvent(userId, {
    client_event_id: clientEventId,
    session_id: input.session_id,
    event_type: ReviewEventType.REVIEW_ATTEMPTED,
    session_type: ReviewSessionType.SABAQ,
    occurred_at: new Date(),
    item_ayah_id: input.ayah_id,
    tier: ReviewTier.SABAQ,
    step_type: input.step_type,
    attempt_number: input.attempt_number,
    scaffolding_used: input.scaffolding_used ?? false,
    linked_ayah_id: input.linked_ayah_id,
    success: input.success,
    errors_count: input.errors_count,
    duration_seconds: input.duration_seconds ?? 1
  });

  const nextCounts = new Map(existingCounts);
  nextCounts.set(input.step_type, (nextCounts.get(input.step_type) ?? 0) + 1);
  const expectedAfter = expectedFromProtocol(protocol, nextCounts);
  const attemptGoalForStep =
    protocol.steps.find((entry) => entry.step === input.step_type)?.attempts ?? 3;

  let stepStatus: StepStatus = "IN_PROGRESS";
  let nextStep: "EXPOSURE" | "GUIDED" | "BLIND" | "LINK" | "COMPLETE" | null = null;
  let nextAttempt: number | null = null;

  if (expectedAfter.completed) {
    stepStatus = "AYAH_COMPLETE";
    nextStep = "COMPLETE";
  } else {
    nextStep = expectedAfter.expectedStep;
    nextAttempt = expectedAfter.expectedAttempt;
    stepStatus = nextStep === input.step_type ? "IN_PROGRESS" : "STEP_COMPLETE";
  }

  return {
    recorded: !ingestResult.deduplicated,
    next_step: nextStep,
    next_attempt: nextAttempt,
    step_status: stepStatus,
    protocol: protocolSummary(protocol),
    progress: `${input.attempt_number}/${attemptGoalForStep} ${input.step_type.toLowerCase()} attempts`
  };
}
