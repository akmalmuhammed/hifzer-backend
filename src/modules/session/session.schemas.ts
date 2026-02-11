import {
  QueueMode,
  ReviewEventType,
  ReviewSessionType,
  ReviewStepType,
  ReviewTier
} from "@prisma/client";
import { z } from "zod";

export const sessionStartSchema = z.object({
  client_session_id: z.string().uuid().optional(),
  mode: z.nativeEnum(QueueMode).optional(),
  warmup_passed: z.boolean().optional()
});

const reviewAttemptPayloadSchema = z.object({
  client_event_id: z.string().uuid(),
  session_id: z.string().uuid().optional(),
  event_type: z.literal(ReviewEventType.REVIEW_ATTEMPTED),
  session_type: z.nativeEnum(ReviewSessionType).optional(),
  occurred_at: z.coerce.date(),
  item_ayah_id: z.number().int().positive(),
  tier: z.nativeEnum(ReviewTier),
  step_type: z.nativeEnum(ReviewStepType).optional(),
  attempt_number: z.number().int().min(1).max(3).optional(),
  scaffolding_used: z.boolean().optional(),
  linked_ayah_id: z.number().int().positive().optional(),
  success: z.boolean(),
  errors_count: z.number().int().min(0).default(0),
  duration_seconds: z.number().int().positive(),
  error_tags: z.array(z.string()).optional()
}).superRefine((value, ctx) => {
  if (value.step_type === ReviewStepType.LINK && !value.linked_ayah_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "linked_ayah_id is required for link step"
    });
  }
});

const transitionAttemptPayloadSchema = z.object({
  client_event_id: z.string().uuid(),
  session_id: z.string().uuid().optional(),
  event_type: z.literal(ReviewEventType.TRANSITION_ATTEMPTED),
  session_type: z.nativeEnum(ReviewSessionType).optional(),
  occurred_at: z.coerce.date(),
  from_ayah_id: z.number().int().positive(),
  to_ayah_id: z.number().int().positive(),
  success: z.boolean()
});

export const reviewEventSchema = z.discriminatedUnion("event_type", [
  reviewAttemptPayloadSchema,
  transitionAttemptPayloadSchema
]);

export const sessionCompleteSchema = z.object({
  session_id: z.string().uuid()
});

export const stepCompleteSchema = z
  .object({
    session_id: z.string().uuid(),
    ayah_id: z.number().int().positive(),
    step_type: z.nativeEnum(ReviewStepType),
    attempt_number: z.number().int().min(1).max(3),
    success: z.boolean(),
    errors_count: z.number().int().min(0).default(0),
    scaffolding_used: z.boolean().optional(),
    duration_seconds: z.number().int().positive().optional(),
    linked_ayah_id: z.number().int().positive().optional()
  })
  .superRefine((value, ctx) => {
    if (value.step_type === ReviewStepType.LINK && !value.linked_ayah_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "linked_ayah_id is required for link step"
      });
    }
  });

export type SessionStartInput = z.infer<typeof sessionStartSchema>;
export type ReviewEventInput = z.infer<typeof reviewEventSchema>;
export type SessionCompleteInput = z.infer<typeof sessionCompleteSchema>;
export type StepCompleteInput = z.infer<typeof stepCompleteSchema>;
