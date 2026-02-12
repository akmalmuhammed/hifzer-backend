import { Hono, type Context } from "hono";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { createHash } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { ZodError, z } from "zod";

type HyperdriveBinding = {
  connectionString?: string;
};

type WorkerBindings = {
  HYPERDRIVE?: HyperdriveBinding;
  DATABASE_URL?: string;
  NODE_ENV?: string;
  PROCESS_EVENTS_INLINE?: string;
  CORS_ORIGINS?: string;
  CLERK_JWKS_URL?: string;
  CLERK_JWT_ISSUER?: string;
  CLERK_JWT_AUDIENCE?: string;
};

type WorkerVariables = {
  requestId: string;
};

type AppEnv = {
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
};

const app = new Hono<AppEnv>();

type TajwidConfidence = "LOW" | "MED" | "HIGH";
type GoalType = "SURAH" | "JUZ" | "FULL_QURAN";
type PriorJuzBand = "ZERO" | "ONE_TO_FIVE" | "FIVE_PLUS";
type ProgramVariant = "MOMENTUM" | "STANDARD" | "CONSERVATIVE";
type ScaffoldingLevel = "BEGINNER" | "STANDARD" | "MINIMAL";
type QueueMode = "NORMAL" | "REVIEW_ONLY" | "CONSOLIDATION";
type ReviewTier = "SABAQ" | "SABQI" | "MANZIL";
type FluencyGateStatus = "IN_PROGRESS" | "PASSED" | "FAILED";
type ReviewEventType = "REVIEW_ATTEMPTED" | "TRANSITION_ATTEMPTED";
type ReviewSessionType = "SABAQ" | "SABQI" | "MANZIL" | "WARMUP";
type ReviewStepType = "EXPOSURE" | "GUIDED" | "BLIND" | "LINK";
type SessionStatus = "ACTIVE" | "COMPLETED" | "ABANDONED";

type AssessmentPayload = {
  time_budget_minutes: 15 | 30 | 60 | 90;
  fluency_score: number;
  tajwid_confidence: TajwidConfidence;
  goal: GoalType;
  has_teacher: boolean;
  prior_juz_band: PriorJuzBand;
};

type AssessmentDefaults = {
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

type ClerkClaims = JWTPayload & {
  email?: string;
  email_address?: string;
};

const assessmentSchema = z.object({
  time_budget_minutes: z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(90)]),
  fluency_score: z.number().int().min(0).max(100),
  tajwid_confidence: z.enum(["LOW", "MED", "HIGH"]),
  goal: z.enum(["SURAH", "JUZ", "FULL_QURAN"]),
  has_teacher: z.boolean(),
  prior_juz_band: z.enum(["ZERO", "ONE_TO_FIVE", "FIVE_PLUS"])
});

const fluencyGateSubmitSchema = z.object({
  test_id: z.string().uuid(),
  duration_seconds: z.number().int().positive(),
  error_count: z.number().int().min(0)
});

const sessionStartSchema = z.object({
  client_session_id: z.string().uuid().optional(),
  mode: z.enum(["NORMAL", "REVIEW_ONLY", "CONSOLIDATION"]).optional(),
  warmup_passed: z.boolean().optional()
});

const sessionCompleteSchema = z.object({
  session_id: z.string().uuid()
});

const stepCompleteSchema = z
  .object({
    session_id: z.string().uuid(),
    ayah_id: z.number().int().positive(),
    step_type: z.enum(["EXPOSURE", "GUIDED", "BLIND", "LINK"]),
    attempt_number: z.number().int().min(1).max(3),
    success: z.boolean(),
    errors_count: z.number().int().min(0).default(0),
    scaffolding_used: z.boolean().optional(),
    duration_seconds: z.number().int().positive().optional(),
    linked_ayah_id: z.number().int().positive().optional()
  })
  .superRefine((value, ctx) => {
    if (value.step_type === "LINK" && !value.linked_ayah_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "linked_ayah_id is required for link step"
      });
    }
  });

const reviewAttemptEventSchema = z
  .object({
    client_event_id: z.string().uuid(),
    session_id: z.string().uuid().optional(),
    event_type: z.literal("REVIEW_ATTEMPTED"),
    session_type: z.enum(["SABAQ", "SABQI", "MANZIL", "WARMUP"]).optional(),
    occurred_at: z.coerce.date(),
    item_ayah_id: z.number().int().positive(),
    tier: z.enum(["SABAQ", "SABQI", "MANZIL"]),
    step_type: z.enum(["EXPOSURE", "GUIDED", "BLIND", "LINK"]).optional(),
    attempt_number: z.number().int().min(1).max(3).optional(),
    scaffolding_used: z.boolean().optional(),
    linked_ayah_id: z.number().int().positive().optional(),
    success: z.boolean(),
    errors_count: z.number().int().min(0).default(0),
    duration_seconds: z.number().int().positive(),
    error_tags: z.array(z.string()).optional()
  })
  .superRefine((value, ctx) => {
    if (value.step_type === "LINK" && !value.linked_ayah_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "linked_ayah_id is required for link step"
      });
    }
  });

const transitionAttemptEventSchema = z.object({
  client_event_id: z.string().uuid(),
  session_id: z.string().uuid().optional(),
  event_type: z.literal("TRANSITION_ATTEMPTED"),
  session_type: z.enum(["SABAQ", "SABQI", "MANZIL", "WARMUP"]).optional(),
  occurred_at: z.coerce.date(),
  from_ayah_id: z.number().int().positive(),
  to_ayah_id: z.number().int().positive(),
  success: z.boolean()
});

const reviewEventSchema = z.discriminatedUnion("event_type", [
  reviewAttemptEventSchema,
  transitionAttemptEventSchema
]);

type RiskState = {
  ayahId: number;
  tier: ReviewTier;
  nextReviewAt: Date;
  lapses: number;
  difficultyScore: number;
  lastErrorsCount: number;
  ayah: {
    surahNumber: number;
    ayahNumber: number;
    pageNumber: number;
  };
};

type DebtMetrics = {
  dueItemsCount: number;
  backlogMinutesEstimate: number;
  overdueDaysMax: number;
  freezeThresholdMinutes: number;
};

type WarmupEvaluation = {
  totalItems: number;
  passed: boolean;
  failed: boolean;
  pending: boolean;
  passingAyahIds: number[];
  failingAyahIds: number[];
};

type UserRow = {
  id: string;
  timeBudgetMinutes: number;
  avgSecondsPerItem: number;
  backlogFreezeRatio: number;
  retentionThreshold: number;
  dailyNewTargetAyahs: number;
  manzilRotationDays: number;
  fluencyGatePassed: boolean;
  requiresPreHifz: boolean;
};

type ProtocolStep = {
  step: ReviewStepType;
  attempts: number;
  optional?: boolean;
};

type StepProtocol = {
  scaffoldingLevel: ScaffoldingLevel;
  steps: ProtocolStep[];
};

type StepExpectation = {
  expectedStep: ReviewStepType | null;
  expectedAttempt: number | null;
  completed: boolean;
};

const sqlClientCache = new Map<string, Sql>();
const clerkJwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function parseAllowedOrigins(raw?: string): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function parseCsv(raw?: string): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function getConnectionString(env: WorkerBindings): string {
  const candidate = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
  if (!candidate || candidate.trim().length === 0) {
    throw new Error("DATABASE_URL (or HYPERDRIVE binding) is required");
  }
  return candidate;
}

function getSql(env: WorkerBindings): Sql {
  const connectionString = getConnectionString(env);
  const existing = sqlClientCache.get(connectionString);
  if (existing) {
    return existing;
  }

  const client = postgres(connectionString, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10
  });
  sqlClientCache.set(connectionString, client);
  return client;
}

function getClerkJwksUrl(env: WorkerBindings): string {
  if (env.CLERK_JWKS_URL && env.CLERK_JWKS_URL.trim().length > 0) {
    return env.CLERK_JWKS_URL.trim();
  }
  if (env.CLERK_JWT_ISSUER && env.CLERK_JWT_ISSUER.trim().length > 0) {
    const issuer = env.CLERK_JWT_ISSUER.trim().replace(/\/+$/, "");
    return `${issuer}/.well-known/jwks.json`;
  }
  throw new Error("CLERK_JWKS_URL or CLERK_JWT_ISSUER is required");
}

function getRemoteJwks(env: WorkerBindings) {
  const jwksUrl = getClerkJwksUrl(env);
  const cached = clerkJwksCache.get(jwksUrl);
  if (cached) {
    return cached;
  }

  const remote = createRemoteJWKSet(new URL(jwksUrl));
  clerkJwksCache.set(jwksUrl, remote);
  return remote;
}

async function verifyClerkToken(
  env: WorkerBindings,
  token: string
): Promise<{ sub: string; email: string | null }> {
  const audience = parseCsv(env.CLERK_JWT_AUDIENCE);
  const issuer = env.CLERK_JWT_ISSUER?.trim();

  const { payload } = await jwtVerify(token, getRemoteJwks(env), {
    issuer: issuer && issuer.length > 0 ? issuer : undefined,
    audience: audience.length > 0 ? audience : undefined
  });

  const claims = payload as ClerkClaims;
  if (!claims.sub || claims.sub.trim().length === 0) {
    throw new Error("Invalid Clerk token: missing sub");
  }

  const emailRaw =
    typeof claims.email === "string"
      ? claims.email
      : typeof claims.email_address === "string"
        ? claims.email_address
        : null;
  const normalizedEmail = emailRaw?.trim().toLowerCase() ?? null;

  return {
    sub: claims.sub,
    email: normalizedEmail
  };
}

function fallbackEmailForClerkSub(clerkSub: string): string {
  const safe = clerkSub.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `clerk_${safe}@clerk.local`;
}

async function ensureLocalUser(
  env: WorkerBindings,
  identity: { sub: string; email: string | null }
): Promise<{ id: string; email: string }> {
  const sql = getSql(env);
  const now = new Date();
  const userId = crypto.randomUUID();
  const finalEmail = identity.email ?? fallbackEmailForClerkSub(identity.sub);
  const placeholderPasswordHash = `clerk:${identity.sub}`;

  const rows = await sql<{ id: string; email: string }[]>`
    INSERT INTO "User" ("id", "email", "passwordHash", "updatedAt")
    VALUES (${userId}, ${finalEmail}, ${placeholderPasswordHash}, ${now})
    ON CONFLICT ("email")
    DO UPDATE SET "updatedAt" = EXCLUDED."updatedAt"
    RETURNING "id", "email"
  `;

  const row = rows[0];
  if (!row) {
    throw new Error("Failed to provision local user");
  }
  return row;
}

function assignScaffoldingLevel(input: AssessmentPayload): ScaffoldingLevel {
  if (input.fluency_score < 75 || input.prior_juz_band === "ZERO") {
    return "BEGINNER";
  }
  if (input.fluency_score > 85 && input.prior_juz_band === "FIVE_PLUS" && input.has_teacher) {
    return "MINIMAL";
  }
  return "STANDARD";
}

function computeAssessmentDefaults(input: AssessmentPayload): AssessmentDefaults {
  const scaffoldingLevel = assignScaffoldingLevel(input);
  let variant: ProgramVariant = "STANDARD";

  if (input.time_budget_minutes === 15) {
    variant = "CONSERVATIVE";
  } else if (
    input.time_budget_minutes >= 90 &&
    input.fluency_score >= 70 &&
    input.tajwid_confidence !== "LOW" &&
    input.has_teacher
  ) {
    variant = "MOMENTUM";
  } else if (
    input.fluency_score < 45 ||
    input.tajwid_confidence === "LOW" ||
    input.has_teacher === false
  ) {
    variant = "CONSERVATIVE";
  }

  let dailyNewTargetAyahs = 7;
  if (input.time_budget_minutes === 15) {
    dailyNewTargetAyahs = 3;
  } else if (variant === "MOMENTUM") {
    dailyNewTargetAyahs = 10;
  } else if (variant === "CONSERVATIVE" || input.time_budget_minutes === 30) {
    dailyNewTargetAyahs = 5;
  }

  if (input.time_budget_minutes === 90 && dailyNewTargetAyahs < 7) {
    dailyNewTargetAyahs = 7;
  }
  if (input.time_budget_minutes === 15) {
    dailyNewTargetAyahs = Math.min(3, dailyNewTargetAyahs);
  }

  const retentionThreshold = variant === "CONSERVATIVE" ? 0.88 : variant === "MOMENTUM" ? 0.82 : 0.85;
  const consolidationRetentionFloor = Math.max(0.7, retentionThreshold - 0.08);
  const avgSecondsPerItem =
    input.fluency_score >= 75 ? 55 : input.fluency_score >= 50 ? 70 : 90;

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

async function persistAssessment(
  env: WorkerBindings,
  userId: string,
  payload: AssessmentPayload,
  defaults: AssessmentDefaults
): Promise<void> {
  const sql = getSql(env);
  const now = new Date();

  await sql`
    UPDATE "User"
    SET
      "timeBudgetMinutes" = ${payload.time_budget_minutes},
      "fluencyScore" = ${payload.fluency_score},
      "tajwidConfidence" = ${payload.tajwid_confidence}::"TajwidConfidence",
      "goal" = ${payload.goal}::"GoalType",
      "hasTeacher" = ${payload.has_teacher},
      "priorJuzBand" = ${payload.prior_juz_band}::"PriorJuzBand",
      "scaffoldingLevel" = ${defaults.scaffolding_level}::"ScaffoldingLevel",
      "dailyNewTargetAyahs" = ${defaults.daily_new_target_ayahs},
      "reviewRatioTarget" = ${defaults.review_ratio_target},
      "variant" = ${defaults.variant}::"ProgramVariant",
      "retentionThreshold" = ${defaults.retention_threshold},
      "backlogFreezeRatio" = ${defaults.backlog_freeze_ratio},
      "consolidationRetentionFloor" = ${defaults.consolidation_retention_floor},
      "manzilRotationDays" = ${defaults.manzil_rotation_days},
      "avgSecondsPerItem" = ${defaults.avg_seconds_per_item},
      "overdueCapSeconds" = ${defaults.overdue_cap_seconds},
      "updatedAt" = ${now}
    WHERE "id" = ${userId}
  `;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfUtcDay(date: Date): Date {
  const start = startOfUtcDay(date);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function diffInDaysFloor(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / (24 * 60 * 60 * 1000));
}

function calculateFluencyScore(durationSeconds: number, errorCount: number) {
  const timeScore = durationSeconds < 180 ? 50 : Math.max(0, 50 - (durationSeconds - 180) / 6);
  const accuracyScore = errorCount < 5 ? 50 : Math.max(0, 50 - (errorCount - 5) * 5);
  const fluencyScore = Math.round(timeScore + accuracyScore);
  return {
    fluency_score: fluencyScore,
    time_score: Math.round(timeScore),
    accuracy_score: Math.round(accuracyScore),
    passed: fluencyScore >= 70
  };
}

function randomFrom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

async function startFluencyGateTest(env: WorkerBindings, userId: string) {
  const sql = getSql(env);
  const [memorizedPagesRaw, availablePagesRaw] = await Promise.all([
    sql<{ pageNumber: number }[]>`
      SELECT DISTINCT a."pageNumber" AS "pageNumber"
      FROM "UserItemState" uis
      JOIN "Ayah" a ON a."id" = uis."ayahId"
      WHERE uis."userId" = ${userId}
        AND uis."firstMemorizedAt" IS NOT NULL
    `,
    sql<{ pageNumber: number }[]>`
      SELECT DISTINCT "pageNumber" AS "pageNumber"
      FROM "Ayah"
      ORDER BY "pageNumber" ASC
    `
  ]);

  const availablePages = availablePagesRaw.map((row) => row.pageNumber);
  if (availablePages.length === 0) {
    throw new Error("Ayah metadata is not seeded. Load ayahs before starting fluency gate.");
  }

  const memorizedPages = new Set(memorizedPagesRaw.map((row) => row.pageNumber));
  const candidatePages = availablePages.filter((page) => !memorizedPages.has(page));
  const selectedPage = randomFrom(candidatePages.length > 0 ? candidatePages : availablePages);

  const pageAyahs = await sql<{
    id: number;
    surahNumber: number;
    ayahNumber: number;
    textUthmani: string | null;
  }[]>`
    SELECT "id", "surahNumber", "ayahNumber", "textUthmani"
    FROM "Ayah"
    WHERE "pageNumber" = ${selectedPage}
    ORDER BY "ayahNumber" ASC
  `;

  const testId = crypto.randomUUID();
  await sql`
    INSERT INTO "FluencyGateTest" ("id", "userId", "testPage", "status")
    VALUES (${testId}, ${userId}, ${selectedPage}, ${"IN_PROGRESS"}::"FluencyGateStatus")
  `;

  return {
    test_id: testId,
    page: selectedPage,
    ayahs: pageAyahs.map((ayah) => ({
      id: ayah.id,
      surah_number: ayah.surahNumber,
      ayah_number: ayah.ayahNumber,
      text_uthmani: ayah.textUthmani
    })),
    instructions: "Read this page aloud in under 3 minutes with fewer than 5 tajweed errors"
  };
}

async function submitFluencyGateTest(params: {
  env: WorkerBindings;
  userId: string;
  testId: string;
  durationSeconds: number;
  errorCount: number;
}) {
  const sql = getSql(params.env);
  const testRows = await sql<{ id: string }[]>`
    SELECT "id"
    FROM "FluencyGateTest"
    WHERE "id" = ${params.testId}
      AND "userId" = ${params.userId}
      AND "status" = ${"IN_PROGRESS"}::"FluencyGateStatus"
    LIMIT 1
  `;
  if (testRows.length === 0) {
    return null;
  }

  const score = calculateFluencyScore(params.durationSeconds, params.errorCount);
  const completedAt = new Date();

  await Promise.all([
    sql`
      UPDATE "FluencyGateTest"
      SET
        "durationSeconds" = ${params.durationSeconds},
        "errorCount" = ${params.errorCount},
        "fluencyScore" = ${score.fluency_score},
        "status" = ${score.passed ? "PASSED" : "FAILED"}::"FluencyGateStatus",
        "completedAt" = ${completedAt}
      WHERE "id" = ${params.testId}
    `,
    sql`
      UPDATE "User"
      SET
        "fluencyScore" = ${score.fluency_score},
        "fluencyGatePassed" = ${score.passed},
        "requiresPreHifz" = ${!score.passed},
        "updatedAt" = ${completedAt}
      WHERE "id" = ${params.userId}
    `
  ]);

  return {
    passed: score.passed,
    fluency_score: score.fluency_score,
    time_score: score.time_score,
    accuracy_score: score.accuracy_score,
    message: score.passed
      ? "Fluency Gate passed. You can begin memorizing."
      : "Your reading needs strengthening. Please complete Pre-Hifz fluency training first."
  };
}

async function getFluencyGateStatus(env: WorkerBindings, userId: string) {
  const sql = getSql(env);
  const [userRows, latestRows] = await Promise.all([
    sql<{
      fluencyScore: number | null;
      fluencyGatePassed: boolean;
      requiresPreHifz: boolean;
    }[]>`
      SELECT "fluencyScore", "fluencyGatePassed", "requiresPreHifz"
      FROM "User"
      WHERE "id" = ${userId}
      LIMIT 1
    `,
    sql<{
      id: string;
      testPage: number;
      status: FluencyGateStatus;
      fluencyScore: number | null;
      completedAt: Date | null;
    }[]>`
      SELECT "id", "testPage", "status", "fluencyScore", "completedAt"
      FROM "FluencyGateTest"
      WHERE "userId" = ${userId}
      ORDER BY "startedAt" DESC
      LIMIT 1
    `
  ]);

  const user = userRows[0];
  if (!user) {
    throw new Error("User not found");
  }

  const latest = latestRows[0];
  return {
    fluency_score: user.fluencyScore,
    fluency_gate_passed: user.fluencyGatePassed,
    requires_pre_hifz: user.requiresPreHifz,
    latest_test: latest
      ? {
          id: latest.id,
          test_page: latest.testPage,
          status: latest.status,
          fluency_score: latest.fluencyScore,
          completed_at: latest.completedAt ? latest.completedAt.toISOString() : null
        }
      : null
  };
}

function calculateDebtMetrics(params: {
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

function evaluateWarmup(
  ayahIds: number[],
  attempts: Array<{ ayahId: number; success: boolean; errorsCount: number }>
): WarmupEvaluation {
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
    attemptsByAyah.get(attempt.ayahId)?.push(attempt);
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
    const hasPass = itemAttempts.some((item) => item.success && item.errorsCount <= 1);
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

function determineQueueMode(params: {
  debt: DebtMetrics;
  retentionRolling7d: number;
  retentionThreshold: number;
  warmup: WarmupEvaluation;
}): QueueMode {
  const debtFreeze =
    params.debt.backlogMinutesEstimate > params.debt.freezeThresholdMinutes ||
    params.debt.overdueDaysMax > 2;
  if (debtFreeze || params.warmup.failed) {
    return "REVIEW_ONLY";
  }
  if (params.retentionRolling7d < params.retentionThreshold) {
    return "CONSOLIDATION";
  }
  return "NORMAL";
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

function buildManzilQueue(params: {
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

  const included = new Set(dueSorted.map((state) => state.ayahId));
  const fillers = params.activeManzilStates
    .filter((state) => !included.has(state.ayahId))
    .sort((a, b) => sortByRisk(params.now, a, b));

  return [...dueSorted, ...fillers.slice(0, targetCount - dueSorted.length)];
}

function toQueueItem(now: Date, state: RiskState) {
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

async function computeRetentionRolling7d(sql: Sql, userId: string, now: Date): Promise<number> {
  const start = startOfUtcDay(addDays(now, -6));
  const end = endOfUtcDay(now);
  const sessions = await sql<{ retentionScore: number }[]>`
    SELECT "retentionScore"
    FROM "DailySession"
    WHERE "userId" = ${userId}
      AND "sessionDate" >= ${start}
      AND "sessionDate" <= ${end}
  `;

  if (sessions.length === 0) {
    return 1;
  }
  const sum = sessions.reduce((acc, row) => acc + row.retentionScore, 0);
  return sum / sessions.length;
}

function normalizeRiskStateRow(row: {
  ayahId: number;
  tier: string;
  nextReviewAt: Date | string;
  lapses: number;
  difficultyScore: number;
  lastErrorsCount: number;
  surahNumber: number;
  ayahNumber: number;
  pageNumber: number;
}): RiskState {
  return {
    ayahId: row.ayahId,
    tier: row.tier as ReviewTier,
    nextReviewAt: row.nextReviewAt instanceof Date ? row.nextReviewAt : new Date(row.nextReviewAt),
    lapses: row.lapses,
    difficultyScore: row.difficultyScore,
    lastErrorsCount: row.lastErrorsCount,
    ayah: {
      surahNumber: row.surahNumber,
      ayahNumber: row.ayahNumber,
      pageNumber: row.pageNumber
    }
  };
}

async function getTodayQueue(env: WorkerBindings, userId: string, now = new Date()) {
  const sql = getSql(env);
  const userRows = await sql<UserRow[]>`
    SELECT
      "id",
      "timeBudgetMinutes",
      "avgSecondsPerItem",
      "backlogFreezeRatio",
      "retentionThreshold",
      "dailyNewTargetAyahs",
      "manzilRotationDays",
      "fluencyGatePassed",
      "requiresPreHifz"
    FROM "User"
    WHERE "id" = ${userId}
    LIMIT 1
  `;
  const user = userRows[0];
  if (!user) {
    throw new Error("User not found");
  }

  if (user.requiresPreHifz || !user.fluencyGatePassed) {
    return {
      mode: "FLUENCY_GATE_REQUIRED" as const,
      message: "You must pass the Fluency Gate test before memorizing",
      sabaq_allowed: false,
      sabqi_queue: [],
      manzil_queue: [],
      weak_transitions: [],
      link_repair_recommended: false,
      action_required: "COMPLETE_FLUENCY_GATE" as const
    };
  }

  const dueStatesRaw = await sql<{
    ayahId: number;
    tier: string;
    nextReviewAt: Date | string;
    lapses: number;
    difficultyScore: number;
    lastErrorsCount: number;
    surahNumber: number;
    ayahNumber: number;
    pageNumber: number;
  }[]>`
    SELECT
      uis."ayahId",
      uis."tier"::text AS "tier",
      uis."nextReviewAt",
      uis."lapses",
      uis."difficultyScore",
      uis."lastErrorsCount",
      a."surahNumber",
      a."ayahNumber",
      a."pageNumber"
    FROM "UserItemState" uis
    JOIN "Ayah" a ON a."id" = uis."ayahId"
    WHERE uis."userId" = ${userId}
      AND uis."nextReviewAt" <= ${now}
  `;
  const dueStates = dueStatesRaw.map((row) => normalizeRiskStateRow(row));
  const earliestDueAt = dueStates.length
    ? dueStates.reduce((earliest, current) =>
        current.nextReviewAt < earliest ? current.nextReviewAt : earliest,
      dueStates[0].nextReviewAt)
    : undefined;

  const debt = calculateDebtMetrics({
    dueItemsCount: dueStates.length,
    avgSecondsPerItem: user.avgSecondsPerItem,
    timeBudgetMinutes: user.timeBudgetMinutes,
    backlogFreezeRatio: user.backlogFreezeRatio,
    now,
    earliestDueAt
  });

  const yesterdayStart = startOfUtcDay(addDays(now, -1));
  const yesterdayEnd = endOfUtcDay(addDays(now, -1));
  const warmupAyahRows = await sql<{ ayahId: number }[]>`
    SELECT "ayahId"
    FROM "UserItemState"
    WHERE "userId" = ${userId}
      AND "introducedAt" >= ${yesterdayStart}
      AND "introducedAt" <= ${yesterdayEnd}
  `;
  const warmupAyahIds = warmupAyahRows.map((row) => row.ayahId);

  let warmupAttempts: Array<{ ayahId: number; success: boolean; errorsCount: number }> = [];
  if (warmupAyahIds.length > 0) {
    const todayStart = startOfUtcDay(now);
    const attemptsRaw = await sql<{
      itemAyahId: number | null;
      success: boolean | null;
      errorsCount: number | null;
    }[]>`
      SELECT "itemAyahId", "success", "errorsCount"
      FROM "ReviewEvent"
      WHERE "userId" = ${userId}
        AND "eventType" = ${"REVIEW_ATTEMPTED"}::"ReviewEventType"
        AND "occurredAt" >= ${todayStart}
    `;
    const warmupSet = new Set(warmupAyahIds);
    warmupAttempts = attemptsRaw
      .filter((row) => row.itemAyahId !== null && row.success !== null && warmupSet.has(row.itemAyahId))
      .map((row) => ({
        ayahId: row.itemAyahId as number,
        success: row.success as boolean,
        errorsCount: row.errorsCount ?? 0
      }));
  }

  const warmup = evaluateWarmup(warmupAyahIds, warmupAttempts);
  const retentionRolling7d = await computeRetentionRolling7d(sql, userId, now);
  let mode = determineQueueMode({
    debt,
    retentionRolling7d,
    retentionThreshold: user.retentionThreshold,
    warmup
  });

  const sabqiQueueRaw = dueStates
    .filter((state) => state.tier !== "MANZIL")
    .sort((a, b) => sortByRisk(now, a, b));
  const dueManzil = dueStates.filter((state) => state.tier === "MANZIL");

  const activeManzilRaw = await sql<{
    ayahId: number;
    tier: string;
    nextReviewAt: Date | string;
    lapses: number;
    difficultyScore: number;
    lastErrorsCount: number;
    surahNumber: number;
    ayahNumber: number;
    pageNumber: number;
  }[]>`
    SELECT
      uis."ayahId",
      uis."tier"::text AS "tier",
      uis."nextReviewAt",
      uis."lapses",
      uis."difficultyScore",
      uis."lastErrorsCount",
      a."surahNumber",
      a."ayahNumber",
      a."pageNumber"
    FROM "UserItemState" uis
    JOIN "Ayah" a ON a."id" = uis."ayahId"
    WHERE uis."userId" = ${userId}
      AND uis."tier" = ${"MANZIL"}::"ReviewTier"
  `;
  const activeManzil = activeManzilRaw.map((row) => normalizeRiskStateRow(row));
  const manzilQueueRaw = buildManzilQueue({
    dueManzilStates: dueManzil,
    activeManzilStates: activeManzil,
    manzilRotationDays: user.manzilRotationDays,
    now
  });

  const weakTransitionsRaw = await sql<{
    fromAyahId: number;
    toAyahId: number;
    successCount: number;
    attemptCount: number;
    successRate: number;
  }[]>`
    SELECT
      "fromAyahId",
      "toAyahId",
      "successCount",
      "attemptCount",
      ("successCount"::float / NULLIF("attemptCount", 0)) AS "successRate"
    FROM "TransitionScore"
    WHERE "userId" = ${userId}
      AND "attemptCount" >= 3
      AND ("successCount"::float / NULLIF("attemptCount", 0)) < 0.70
    ORDER BY "successRate" ASC
    LIMIT 10
  `;

  const warmupBlockedReason = warmup.failed ? "warmup_failed" : warmup.pending ? "warmup_pending" : "none";
  if (mode !== "REVIEW_ONLY" && warmup.failed) {
    mode = "REVIEW_ONLY";
  }

  let targetAyahs = user.dailyNewTargetAyahs;
  if (mode === "CONSOLIDATION") {
    targetAyahs = Math.max(1, Math.floor(user.dailyNewTargetAyahs / 2));
  }
  if (mode === "REVIEW_ONLY") {
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
      allowed: mode !== "REVIEW_ONLY" && warmup.passed,
      target_ayahs: targetAyahs,
      blocked_reason:
        mode === "REVIEW_ONLY"
          ? warmup.failed
            ? "warmup_failed"
            : "mode_review_only"
          : warmupBlockedReason
    },
    sabqi_queue: sabqiQueueRaw.map((state) => toQueueItem(now, state)),
    manzil_queue: manzilQueueRaw.map((state) => toQueueItem(now, state)),
    weak_transitions: weakTransitionsRaw.map((item) => ({
      from_ayah_id: item.fromAyahId,
      to_ayah_id: item.toAyahId,
      success_rate: item.successRate,
      success_count: item.successCount,
      attempt_count: item.attemptCount
    })),
    link_repair_recommended: weakTransitionsRaw.length > 5
  };
}

async function getUserStats(env: WorkerBindings, userId: string) {
  const sql = getSql(env);
  const now = new Date();

  const [totalItemsRows, dueItemsRows, latestDailyRows, upcomingDueRows, completedSessionsRows] =
    await Promise.all([
      sql<{ count: string }[]>`
        SELECT COUNT(*)::text AS "count"
        FROM "UserItemState"
        WHERE "userId" = ${userId}
      `,
      sql<{ count: string }[]>`
        SELECT COUNT(*)::text AS "count"
        FROM "UserItemState"
        WHERE "userId" = ${userId}
          AND "nextReviewAt" <= ${now}
      `,
      sql<{
        sessionDate: Date | string;
        retentionScore: number;
        backlogMinutesEstimate: number;
        minutesTotal: number;
        mode: QueueMode;
      }[]>`
        SELECT
          "sessionDate",
          "retentionScore",
          "backlogMinutesEstimate",
          "minutesTotal",
          "mode"::text AS "mode"
        FROM "DailySession"
        WHERE "userId" = ${userId}
        ORDER BY "sessionDate" DESC
        LIMIT 1
      `,
      sql<{
        ayahId: number;
        nextReviewAt: Date | string;
        tier: ReviewTier;
      }[]>`
        SELECT "ayahId", "nextReviewAt", "tier"::text AS "tier"
        FROM "UserItemState"
        WHERE "userId" = ${userId}
        ORDER BY "nextReviewAt" ASC
        LIMIT 12
      `,
      sql<{ count: string }[]>`
        SELECT COUNT(*)::text AS "count"
        FROM "SessionRun"
        WHERE "userId" = ${userId}
          AND "status" = ${"COMPLETED"}::"SessionStatus"
      `
    ]);

  const latestDaily = latestDailyRows[0];
  return {
    total_items_tracked: Number(totalItemsRows[0]?.count ?? "0"),
    due_items: Number(dueItemsRows[0]?.count ?? "0"),
    completed_sessions: Number(completedSessionsRows[0]?.count ?? "0"),
    latest_daily_session: latestDaily
      ? {
          sessionDate:
            latestDaily.sessionDate instanceof Date
              ? latestDaily.sessionDate.toISOString()
              : new Date(latestDaily.sessionDate).toISOString(),
          retentionScore: latestDaily.retentionScore,
          backlogMinutesEstimate: latestDaily.backlogMinutesEstimate,
          minutesTotal: latestDaily.minutesTotal,
          mode: latestDaily.mode
        }
      : null,
    upcoming_due: upcomingDueRows.map((item) => ({
      ayah_id: item.ayahId,
      next_review_at:
        item.nextReviewAt instanceof Date
          ? item.nextReviewAt.toISOString()
          : new Date(item.nextReviewAt).toISOString(),
      tier: item.tier
    }))
  };
}

function isPgUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function deterministicEventUuid(input: string): string {
  const hash = createHash("sha256").update(input).digest("hex");
  const chars = hash.slice(0, 32).split("");
  chars[12] = "4";
  const variantNibble = parseInt(chars[16], 16);
  chars[16] = ((variantNibble & 0x3) | 0x8).toString(16);
  return `${chars.slice(0, 8).join("")}-${chars.slice(8, 12).join("")}-${chars.slice(12, 16).join("")}-${chars.slice(16, 20).join("")}-${chars.slice(20, 32).join("")}`;
}

function buildProtocol(scaffoldingLevel: ScaffoldingLevel): StepProtocol {
  if (scaffoldingLevel === "BEGINNER") {
    return {
      scaffoldingLevel,
      steps: [
        { step: "EXPOSURE", attempts: 3 },
        { step: "GUIDED", attempts: 3 },
        { step: "BLIND", attempts: 3 },
        { step: "LINK", attempts: 3 }
      ]
    };
  }

  if (scaffoldingLevel === "MINIMAL") {
    return {
      scaffoldingLevel,
      steps: [
        { step: "EXPOSURE", attempts: 3, optional: true },
        { step: "GUIDED", attempts: 3, optional: true },
        { step: "BLIND", attempts: 3 },
        { step: "LINK", attempts: 3 }
      ]
    };
  }

  return {
    scaffoldingLevel,
    steps: [
      { step: "EXPOSURE", attempts: 3 },
      { step: "GUIDED", attempts: 1 },
      { step: "BLIND", attempts: 3 },
      { step: "LINK", attempts: 3 }
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
  stepAttempts: Array<{ stepType: ReviewStepType | null }>
): Map<ReviewStepType, number> {
  const counts = new Map<ReviewStepType, number>();
  for (const item of stepAttempts) {
    if (!item.stepType) {
      continue;
    }
    counts.set(item.stepType, (counts.get(item.stepType) ?? 0) + 1);
  }
  return counts;
}

function expectedFromProtocol(
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

function validateStepAttempt(params: {
  protocol: StepProtocol;
  expected: StepExpectation;
  counts: Map<ReviewStepType, number>;
  stepType: ReviewStepType;
  attemptNumber: number;
}): boolean {
  if (params.expected.completed) {
    return false;
  }

  const optionalStep = params.protocol.steps.find(
    (step) => step.optional && step.step === params.stepType
  );
  if (optionalStep) {
    if (params.expected.expectedStep !== "BLIND") {
      return false;
    }
    const observed = params.counts.get(params.stepType) ?? 0;
    const expectedOptionalAttempt = observed + 1;
    return (
      params.attemptNumber === expectedOptionalAttempt &&
      params.attemptNumber <= optionalStep.attempts
    );
  }

  return (
    params.stepType === params.expected.expectedStep &&
    params.attemptNumber === params.expected.expectedAttempt
  );
}

function outcomeFromAttempt(success: boolean, errorsCount: number): "perfect" | "minor" | "fail" {
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

const SRS_CHECKPOINTS_SECONDS = [
  4 * 60 * 60,
  8 * 60 * 60,
  1 * 24 * 60 * 60,
  3 * 24 * 60 * 60,
  7 * 24 * 60 * 60,
  14 * 24 * 60 * 60,
  30 * 24 * 60 * 60,
  90 * 24 * 60 * 60
] as const;

function checkpointIndexForInterval(currentIntervalSeconds: number): number {
  const found = SRS_CHECKPOINTS_SECONDS.findIndex((checkpoint) => checkpoint >= currentIntervalSeconds);
  if (found >= 0) {
    return found;
  }
  return SRS_CHECKPOINTS_SECONDS.length - 1;
}

function tierFromCheckpoint(index: number): ReviewTier {
  if (index <= 1) {
    return "SABAQ";
  }
  if (index <= 5) {
    return "SABQI";
  }
  return "MANZIL";
}

function adjustDifficulty(current: number, outcome: "perfect" | "minor" | "fail"): number {
  if (outcome === "fail") {
    return Math.min(1, current + 0.1);
  }
  if (outcome === "minor") {
    return Math.min(1, current + 0.03);
  }
  return Math.max(0, current - 0.05);
}

function applyPromotionGate(params: {
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
    const eventDay = params.eventOccurredAt.toISOString().slice(0, 10);
    if (!perfectDay) {
      consecutivePerfectDays = 1;
    } else {
      const previous = new Date(`${perfectDay}T00:00:00.000Z`).getTime();
      const current = new Date(`${eventDay}T00:00:00.000Z`).getTime();
      const diffDays = Math.floor((current - previous) / (24 * 60 * 60 * 1000));
      if (diffDays === 1) {
        consecutivePerfectDays += 1;
      } else if (diffDays > 1) {
        consecutivePerfectDays = 1;
      }
    }
    perfectDay = eventDay;
  } else {
    consecutivePerfectDays = 0;
    perfectDay = null;
  }

  let tier = tierFromCheckpoint(params.checkpointIndex);
  if (tier === "MANZIL" && consecutivePerfectDays < 7) {
    tier = "SABQI";
  }

  return {
    consecutivePerfectDays,
    perfectDay,
    tier
  };
}

async function updateTransitionScore(params: {
  sql: Sql;
  userId: string;
  fromAyahId: number;
  toAyahId: number;
  success: boolean;
  occurredAt: Date;
}) {
  const now = new Date();
  await params.sql`
    INSERT INTO "TransitionScore"
      ("userId", "fromAyahId", "toAyahId", "successCount", "attemptCount", "lastPracticedAt", "createdAt", "updatedAt")
    VALUES
      (
        ${params.userId},
        ${params.fromAyahId},
        ${params.toAyahId},
        ${params.success ? 1 : 0},
        1,
        ${params.occurredAt},
        ${now},
        ${now}
      )
    ON CONFLICT ("userId", "fromAyahId", "toAyahId")
    DO UPDATE SET
      "successCount" = "TransitionScore"."successCount" + ${params.success ? 1 : 0},
      "attemptCount" = "TransitionScore"."attemptCount" + 1,
      "lastPracticedAt" = EXCLUDED."lastPracticedAt",
      "updatedAt" = EXCLUDED."updatedAt"
  `;
}

async function rebuildItemState(sql: Sql, userId: string, ayahId: number): Promise<void> {
  const events = await sql<{
    occurredAt: Date | string;
    success: boolean | null;
    errorsCount: number | null;
    durationSeconds: number | null;
  }[]>`
    SELECT "occurredAt", "success", "errorsCount", "durationSeconds"
    FROM "ReviewEvent"
    WHERE "userId" = ${userId}
      AND "eventType" = ${"REVIEW_ATTEMPTED"}::"ReviewEventType"
      AND "itemAyahId" = ${ayahId}
    ORDER BY "occurredAt" ASC, "id" ASC
  `;

  if (events.length === 0) {
    return;
  }

  let checkpointIndex = 0;
  let intervalSeconds = 4 * 60 * 60;
  let nextReviewAt = new Date(events[0].occurredAt);
  let tier: ReviewTier = "SABAQ";
  const introducedAt = new Date(events[0].occurredAt);
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
    const occurredAt = new Date(event.occurredAt);
    const success = Boolean(event.success);
    const errorsCount = event.errorsCount ?? 0;
    const currentIndex = checkpointIndexForInterval(intervalSeconds);
    const outcome = outcomeFromAttempt(success, errorsCount);
    checkpointIndex =
      outcome === "perfect"
        ? Math.min(currentIndex + 1, SRS_CHECKPOINTS_SECONDS.length - 1)
        : outcome === "minor"
          ? currentIndex
          : 0;
    intervalSeconds = SRS_CHECKPOINTS_SECONDS[checkpointIndex];
    nextReviewAt = new Date(occurredAt.getTime() + intervalSeconds * 1000);

    totalReviews += 1;
    successfulReviews += success ? 1 : 0;
    lapses += success ? 0 : 1;
    successStreak = success ? successStreak + 1 : 0;
    difficultyScore = adjustDifficulty(difficultyScore, outcome);
    lastErrorsCount = errorsCount;
    lastReviewedAt = occurredAt;
    lastEventOccurredAt = occurredAt;
    if (event.durationSeconds && event.durationSeconds > 0) {
      averageDurationSeconds = Math.round(
        ((averageDurationSeconds * (totalReviews - 1)) + event.durationSeconds) / totalReviews
      );
    }

    const promotion = applyPromotionGate({
      previousConsecutivePerfectDays: consecutivePerfectDays,
      previousPerfectDay: lastPerfectDay,
      eventOccurredAt: occurredAt,
      success,
      errorsCount,
      checkpointIndex
    });
    consecutivePerfectDays = promotion.consecutivePerfectDays;
    lastPerfectDay = promotion.perfectDay;
    tier = promotion.tier;

    if (!firstMemorizedAt && checkpointIndex >= 2) {
      firstMemorizedAt = occurredAt;
    }
  }

  const now = new Date();
  await sql`
    INSERT INTO "UserItemState"
      (
        "id", "userId", "ayahId", "status", "tier", "nextReviewAt", "reviewIntervalSeconds",
        "intervalCheckpointIndex", "introducedAt", "firstMemorizedAt", "difficultyScore",
        "totalReviews", "successfulReviews", "lapses", "successStreak", "consecutivePerfectDays",
        "averageDurationSeconds", "lastErrorsCount", "lastReviewedAt", "lastEventOccurredAt", "updatedAt"
      )
    VALUES
      (
        ${crypto.randomUUID()},
        ${userId},
        ${ayahId},
        ${checkpointIndex >= 2 ? "MEMORIZED" : "LEARNING"}::"ItemStatus",
        ${tier}::"ReviewTier",
        ${nextReviewAt},
        ${intervalSeconds},
        ${checkpointIndex},
        ${introducedAt},
        ${firstMemorizedAt},
        ${difficultyScore},
        ${totalReviews},
        ${successfulReviews},
        ${lapses},
        ${successStreak},
        ${consecutivePerfectDays},
        ${averageDurationSeconds},
        ${lastErrorsCount},
        ${lastReviewedAt},
        ${lastEventOccurredAt},
        ${now}
      )
    ON CONFLICT ("userId", "ayahId")
    DO UPDATE SET
      "status" = EXCLUDED."status",
      "tier" = EXCLUDED."tier",
      "nextReviewAt" = EXCLUDED."nextReviewAt",
      "reviewIntervalSeconds" = EXCLUDED."reviewIntervalSeconds",
      "intervalCheckpointIndex" = EXCLUDED."intervalCheckpointIndex",
      "introducedAt" = EXCLUDED."introducedAt",
      "firstMemorizedAt" = EXCLUDED."firstMemorizedAt",
      "difficultyScore" = EXCLUDED."difficultyScore",
      "totalReviews" = EXCLUDED."totalReviews",
      "successfulReviews" = EXCLUDED."successfulReviews",
      "lapses" = EXCLUDED."lapses",
      "successStreak" = EXCLUDED."successStreak",
      "consecutivePerfectDays" = EXCLUDED."consecutivePerfectDays",
      "averageDurationSeconds" = EXCLUDED."averageDurationSeconds",
      "lastErrorsCount" = EXCLUDED."lastErrorsCount",
      "lastReviewedAt" = EXCLUDED."lastReviewedAt",
      "lastEventOccurredAt" = EXCLUDED."lastEventOccurredAt",
      "updatedAt" = EXCLUDED."updatedAt"
  `;
}

async function ingestReviewEvent(
  env: WorkerBindings,
  userId: string,
  payload: z.infer<typeof reviewEventSchema>
): Promise<{ deduplicated: boolean; event_id?: string }> {
  const sql = getSql(env);
  let createdId: string | undefined;

  try {
    if (payload.event_type === "REVIEW_ATTEMPTED") {
      const rows = await sql<{ id: string }[]>`
        INSERT INTO "ReviewEvent"
          (
            "userId", "sessionRunId", "clientEventId", "eventType", "sessionType",
            "itemAyahId", "tier", "stepType", "attemptNumber", "scaffoldingUsed", "linkedAyahId",
            "success", "errorsCount", "durationSeconds", "errorTags", "occurredAt"
          )
        VALUES
          (
            ${userId},
            ${payload.session_id ?? null},
            ${payload.client_event_id},
            ${payload.event_type}::"ReviewEventType",
            ${(payload.session_type ?? payload.tier)}::"ReviewSessionType",
            ${payload.item_ayah_id},
            ${payload.tier}::"ReviewTier",
            ${payload.step_type ?? null}::"ReviewStepType",
            ${payload.attempt_number ?? null},
            ${Boolean(payload.scaffolding_used)},
            ${payload.linked_ayah_id ?? null},
            ${payload.success},
            ${payload.errors_count},
            ${payload.duration_seconds},
            ${payload.error_tags ? JSON.stringify(payload.error_tags) : null}::jsonb,
            ${payload.occurred_at}
          )
        RETURNING "id"::text
      `;
      createdId = rows[0]?.id;
    } else {
      const rows = await sql<{ id: string }[]>`
        INSERT INTO "ReviewEvent"
          (
            "userId", "sessionRunId", "clientEventId", "eventType", "sessionType",
            "fromAyahId", "toAyahId", "success", "occurredAt"
          )
        VALUES
          (
            ${userId},
            ${payload.session_id ?? null},
            ${payload.client_event_id},
            ${payload.event_type}::"ReviewEventType",
            ${(payload.session_type ?? "SABQI")}::"ReviewSessionType",
            ${payload.from_ayah_id},
            ${payload.to_ayah_id},
            ${payload.success},
            ${payload.occurred_at}
          )
        RETURNING "id"::text
      `;
      createdId = rows[0]?.id;
    }
  } catch (error) {
    if (isPgUniqueViolation(error)) {
      return { deduplicated: true };
    }
    throw error;
  }

  if (payload.session_id) {
    await sql`
      UPDATE "SessionRun"
      SET "eventsCount" = "eventsCount" + 1, "updatedAt" = ${new Date()}
      WHERE "id" = ${payload.session_id} AND "userId" = ${userId}
    `;
  }

  if (payload.event_type === "REVIEW_ATTEMPTED") {
    await rebuildItemState(sql, userId, payload.item_ayah_id);
    if (payload.step_type === "LINK" && payload.linked_ayah_id) {
      await updateTransitionScore({
        sql,
        userId,
        fromAyahId: payload.item_ayah_id,
        toAyahId: payload.linked_ayah_id,
        success: payload.success,
        occurredAt: payload.occurred_at
      });
    }
  } else {
    await updateTransitionScore({
      sql,
      userId,
      fromAyahId: payload.from_ayah_id,
      toAyahId: payload.to_ayah_id,
      success: payload.success,
      occurredAt: payload.occurred_at
    });
  }

  return {
    deduplicated: false,
    event_id: createdId
  };
}

async function requireClerkUser(c: Context<AppEnv>): Promise<{ id: string; email: string }> {
  const authorization = c.req.header("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    throw new Response(
      JSON.stringify({
        error: "Missing bearer token",
        requestId: c.get("requestId")
      }),
      { status: 401, headers: { "content-type": "application/json" } }
    );
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    throw new Response(
      JSON.stringify({
        error: "Missing bearer token",
        requestId: c.get("requestId")
      }),
      { status: 401, headers: { "content-type": "application/json" } }
    );
  }

  try {
    const identity = await verifyClerkToken(c.env, token);
    return await ensureLocalUser(c.env, identity);
  } catch (error) {
    console.error("clerk_verify_failed", {
      requestId: c.get("requestId"),
      error: error instanceof Error ? error.message : String(error)
    });
    throw new Response(
      JSON.stringify({
        error: "Invalid access token",
        requestId: c.get("requestId")
      }),
      { status: 401, headers: { "content-type": "application/json" } }
    );
  }
}

function applyCorsHeaders(c: Context<AppEnv>): void {
  const origin = c.req.header("origin");
  if (!origin) {
    return;
  }

  const normalizedOrigin = origin.replace(/\/+$/, "");
  const allowedOrigins = parseAllowedOrigins(c.env.CORS_ORIGINS);
  if (!allowedOrigins.includes(normalizedOrigin)) {
    return;
  }

  c.header("Access-Control-Allow-Origin", normalizedOrigin);
  c.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  c.header(
    "Access-Control-Allow-Headers",
    "Authorization,Content-Type,X-Request-Id,X-Observability-Token"
  );
  c.header("Access-Control-Expose-Headers", "X-Request-Id");
  c.header("Access-Control-Max-Age", "86400");
  c.header("Vary", "Origin");
}

app.use("*", async (c, next) => {
  const requestId = c.req.header("x-request-id")?.trim() || crypto.randomUUID();
  c.set("requestId", requestId);

  if (c.req.method === "OPTIONS") {
    applyCorsHeaders(c);
    c.header("x-request-id", requestId);
    return c.body(null, 204);
  }

  await next();
  applyCorsHeaders(c);
  c.header("x-request-id", requestId);
});

function buildHealthPayload(c: Context<AppEnv>) {
  return {
    status: "ok",
    runtime: "cloudflare-worker",
    nodeEnv: c.env.NODE_ENV ?? "unknown",
    processEventsInline: c.env.PROCESS_EVENTS_INLINE === "true",
    requestId: c.get("requestId")
  };
}

async function dbReadyResponse(c: Context<AppEnv>) {
  try {
    const sql = getSql(c.env);
    await sql`SELECT 1`;
    return c.json({
      ...buildHealthPayload(c),
      database: "up"
    });
  } catch (error) {
    console.error("db_ready_check_failed", {
      requestId: c.get("requestId"),
      error: error instanceof Error ? error.message : String(error)
    });
    return c.json(
      {
        status: "degraded",
        runtime: "cloudflare-worker",
        database: "down",
        requestId: c.get("requestId")
      },
      503
    );
  }
}

app.get("/health/live", (c) => {
  return c.json(buildHealthPayload(c));
});

app.get("/health/hyperdrive", (c) => {
  const hyperdriveBound = Boolean(c.env.HYPERDRIVE?.connectionString);
  return c.json({
    ...buildHealthPayload(c),
    hyperdriveBound
  });
});

app.get("/health/ready", (c) => dbReadyResponse(c));

app.get("/health", (c) => {
  return c.json(buildHealthPayload(c));
});

app.get("/api/v1/health/live", (c) => c.json(buildHealthPayload(c)));
app.get("/api/v1/health/ready", (c) => dbReadyResponse(c));
app.get("/api/v1/health", (c) => c.json(buildHealthPayload(c)));

app.post("/api/v1/assessment/submit", async (c) => {
  let user: { id: string; email: string };
  try {
    user = await requireClerkUser(c);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    throw error;
  }

  try {
    const raw = await c.req.json();
    const payload = assessmentSchema.parse(raw) as AssessmentPayload;
    const defaults = computeAssessmentDefaults(payload);

    await persistAssessment(c.env, user.id, payload, defaults);

    return c.json({
      defaults
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return c.json(
        {
          error: "Invalid request payload",
          details: error.flatten(),
          requestId: c.get("requestId")
        },
        400
      );
    }
    console.error("assessment_submit_failed", {
      requestId: c.get("requestId"),
      userId: user.id,
      error: error instanceof Error ? error.message : String(error)
    });
    return c.json(
      {
        error: "Failed to submit assessment",
        requestId: c.get("requestId")
      },
      500
    );
  }
});

app.post("/api/v1/fluency-gate/start", async (c) => {
  let user: { id: string; email: string };
  try {
    user = await requireClerkUser(c);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    throw error;
  }

  try {
    const result = await startFluencyGateTest(c.env, user.id);
    return c.json(result);
  } catch (error) {
    console.error("fluency_gate_start_failed", {
      requestId: c.get("requestId"),
      userId: user.id,
      error: error instanceof Error ? error.message : String(error)
    });
    return c.json(
      {
        error: error instanceof Error ? error.message : "Failed to start fluency gate test",
        requestId: c.get("requestId")
      },
      500
    );
  }
});

app.post("/api/v1/fluency-gate/submit", async (c) => {
  let user: { id: string; email: string };
  try {
    user = await requireClerkUser(c);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    throw error;
  }

  try {
    const raw = await c.req.json();
    const payload = fluencyGateSubmitSchema.parse(raw);
    const result = await submitFluencyGateTest({
      env: c.env,
      userId: user.id,
      testId: payload.test_id,
      durationSeconds: payload.duration_seconds,
      errorCount: payload.error_count
    });
    if (!result) {
      return c.json(
        {
          error: "Test not found or already completed",
          requestId: c.get("requestId")
        },
        404
      );
    }
    return c.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return c.json(
        {
          error: "Invalid request payload",
          details: error.flatten(),
          requestId: c.get("requestId")
        },
        400
      );
    }
    console.error("fluency_gate_submit_failed", {
      requestId: c.get("requestId"),
      userId: user.id,
      error: error instanceof Error ? error.message : String(error)
    });
    return c.json(
      {
        error: "Failed to submit fluency gate test",
        requestId: c.get("requestId")
      },
      500
    );
  }
});

app.get("/api/v1/fluency-gate/status", async (c) => {
  let user: { id: string; email: string };
  try {
    user = await requireClerkUser(c);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    throw error;
  }

  try {
    const result = await getFluencyGateStatus(c.env, user.id);
    return c.json(result);
  } catch (error) {
    console.error("fluency_gate_status_failed", {
      requestId: c.get("requestId"),
      userId: user.id,
      error: error instanceof Error ? error.message : String(error)
    });
    return c.json(
      {
        error: "Failed to load fluency gate status",
        requestId: c.get("requestId")
      },
      500
    );
  }
});

app.get("/api/v1/queue/today", async (c) => {
  let user: { id: string; email: string };
  try {
    user = await requireClerkUser(c);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    throw error;
  }

  try {
    const result = await getTodayQueue(c.env, user.id);
    return c.json(result);
  } catch (error) {
    console.error("queue_today_failed", {
      requestId: c.get("requestId"),
      userId: user.id,
      error: error instanceof Error ? error.message : String(error)
    });
    return c.json(
      {
        error: "Failed to generate today queue",
        requestId: c.get("requestId")
      },
      500
    );
  }
});

app.post("/api/v1/session/start", async (c) => {
  let user: { id: string; email: string };
  try {
    user = await requireClerkUser(c);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    throw error;
  }

  try {
    const payload = sessionStartSchema.parse(await c.req.json());
    const queue = await getTodayQueue(c.env, user.id);
    if (queue.mode === "FLUENCY_GATE_REQUIRED") {
      return c.json(
        {
          error: queue.message,
          requestId: c.get("requestId")
        },
        403
      );
    }

    const mode = payload.mode ?? queue.mode;
    const warmupPassed = payload.warmup_passed ?? queue.warmup_test.passed;
    const now = new Date();
    const sessionId = crypto.randomUUID();
    const sql = getSql(c.env);

    let rows: Array<{ id: string; mode: QueueMode; warmupPassed: boolean | null }> = [];
    if (payload.client_session_id) {
      rows = await sql<{ id: string; mode: QueueMode; warmupPassed: boolean | null }[]>`
        INSERT INTO "SessionRun"
          ("id", "userId", "clientSessionId", "mode", "warmupPassed", "status", "updatedAt")
        VALUES
          (
            ${sessionId},
            ${user.id},
            ${payload.client_session_id},
            ${mode}::"QueueMode",
            ${warmupPassed},
            ${"ACTIVE"}::"SessionStatus",
            ${now}
          )
        ON CONFLICT ("userId", "clientSessionId")
        DO UPDATE SET "updatedAt" = EXCLUDED."updatedAt"
        RETURNING "id", "mode"::text AS "mode", "warmupPassed"
      `;
    } else {
      rows = await sql<{ id: string; mode: QueueMode; warmupPassed: boolean | null }[]>`
        INSERT INTO "SessionRun"
          ("id", "userId", "mode", "warmupPassed", "status", "updatedAt")
        VALUES
          (
            ${sessionId},
            ${user.id},
            ${mode}::"QueueMode",
            ${warmupPassed},
            ${"ACTIVE"}::"SessionStatus",
            ${now}
          )
        RETURNING "id", "mode"::text AS "mode", "warmupPassed"
      `;
    }

    const created = rows[0];
    return c.json(
      {
        session_id: created.id,
        mode: created.mode,
        warmup_passed: created.warmupPassed
      },
      201
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return c.json(
        {
          error: "Invalid request payload",
          details: error.flatten(),
          requestId: c.get("requestId")
        },
        400
      );
    }
    console.error("session_start_failed", {
      requestId: c.get("requestId"),
      userId: user.id,
      error: error instanceof Error ? error.message : String(error)
    });
    return c.json(
      {
        error: "Failed to start session",
        requestId: c.get("requestId")
      },
      500
    );
  }
});

app.post("/api/v1/session/step-complete", async (c) => {
  let user: { id: string; email: string };
  try {
    user = await requireClerkUser(c);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    throw error;
  }

  try {
    const payload = stepCompleteSchema.parse(await c.req.json());
    const sql = getSql(c.env);

    const [sessionRows, userRows, existingStepRows] = await Promise.all([
      sql<{ id: string; status: SessionStatus }[]>`
        SELECT "id", "status"::text AS "status"
        FROM "SessionRun"
        WHERE "id" = ${payload.session_id}
          AND "userId" = ${user.id}
        LIMIT 1
      `,
      sql<{ scaffoldingLevel: ScaffoldingLevel }[]>`
        SELECT "scaffoldingLevel"::text AS "scaffoldingLevel"
        FROM "User"
        WHERE "id" = ${user.id}
        LIMIT 1
      `,
      sql<{ stepType: ReviewStepType | null }[]>`
        SELECT "stepType"::text AS "stepType"
        FROM "ReviewEvent"
        WHERE "userId" = ${user.id}
          AND "sessionRunId" = ${payload.session_id}
          AND "eventType" = ${"REVIEW_ATTEMPTED"}::"ReviewEventType"
          AND "itemAyahId" = ${payload.ayah_id}
        ORDER BY "occurredAt" ASC, "id" ASC
      `
    ]);

    const session = sessionRows[0];
    if (!session) {
      return c.json(
        {
          error: "Session not found",
          requestId: c.get("requestId")
        },
        404
      );
    }
    if (session.status !== "ACTIVE") {
      return c.json(
        {
          error: "Session already completed",
          requestId: c.get("requestId")
        },
        409
      );
    }

    const userRow = userRows[0];
    if (!userRow) {
      return c.json(
        {
          error: "User not found",
          requestId: c.get("requestId")
        },
        404
      );
    }

    const protocol = buildProtocol(userRow.scaffoldingLevel);
    const existingCounts = countAttemptsByStep(existingStepRows);
    const expectedBefore = expectedFromProtocol(protocol, existingCounts);

    const isValid = validateStepAttempt({
      protocol,
      expected: expectedBefore,
      counts: existingCounts,
      stepType: payload.step_type,
      attemptNumber: payload.attempt_number
    });
    if (!isValid) {
      return c.json(
        {
          error: "Invalid step sequence",
          code: "INVALID_STEP_SEQUENCE",
          expected_step: expectedBefore.expectedStep,
          expected_attempt: expectedBefore.expectedAttempt,
          required_protocol: protocolSummary(protocol),
          requestId: c.get("requestId")
        },
        409
      );
    }

    const clientEventId = deterministicEventUuid(
      `${payload.session_id}:${payload.ayah_id}:${payload.step_type}:${payload.attempt_number}`
    );
    const ingestResult = await ingestReviewEvent(c.env, user.id, {
      client_event_id: clientEventId,
      session_id: payload.session_id,
      event_type: "REVIEW_ATTEMPTED",
      session_type: "SABAQ",
      occurred_at: new Date(),
      item_ayah_id: payload.ayah_id,
      tier: "SABAQ",
      step_type: payload.step_type,
      attempt_number: payload.attempt_number,
      scaffolding_used: payload.scaffolding_used ?? false,
      linked_ayah_id: payload.linked_ayah_id,
      success: payload.success,
      errors_count: payload.errors_count,
      duration_seconds: payload.duration_seconds ?? 1
    });

    const nextCounts = new Map(existingCounts);
    nextCounts.set(payload.step_type, (nextCounts.get(payload.step_type) ?? 0) + 1);
    const expectedAfter = expectedFromProtocol(protocol, nextCounts);
    const attemptGoalForStep =
      protocol.steps.find((step) => step.step === payload.step_type)?.attempts ?? 3;

    let stepStatus: "IN_PROGRESS" | "STEP_COMPLETE" | "AYAH_COMPLETE" = "IN_PROGRESS";
    let nextStep: ReviewStepType | "COMPLETE" | null = null;
    let nextAttempt: number | null = null;

    if (expectedAfter.completed) {
      stepStatus = "AYAH_COMPLETE";
      nextStep = "COMPLETE";
    } else {
      nextStep = expectedAfter.expectedStep;
      nextAttempt = expectedAfter.expectedAttempt;
      stepStatus = nextStep === payload.step_type ? "IN_PROGRESS" : "STEP_COMPLETE";
    }

    return c.json({
      recorded: !ingestResult.deduplicated,
      next_step: nextStep,
      next_attempt: nextAttempt,
      step_status: stepStatus,
      protocol: protocolSummary(protocol),
      progress: `${payload.attempt_number}/${attemptGoalForStep} ${payload.step_type.toLowerCase()} attempts`
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return c.json(
        {
          error: "Invalid request payload",
          details: error.flatten(),
          requestId: c.get("requestId")
        },
        400
      );
    }
    console.error("session_step_complete_failed", {
      requestId: c.get("requestId"),
      userId: user.id,
      error: error instanceof Error ? error.message : String(error)
    });
    return c.json(
      {
        error: "Failed to complete session step",
        requestId: c.get("requestId")
      },
      500
    );
  }
});

app.post("/api/v1/review/event", async (c) => {
  let user: { id: string; email: string };
  try {
    user = await requireClerkUser(c);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    throw error;
  }

  try {
    const payload = reviewEventSchema.parse(await c.req.json());
    const result = await ingestReviewEvent(c.env, user.id, payload);
    return c.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return c.json(
        {
          error: "Invalid request payload",
          details: error.flatten(),
          requestId: c.get("requestId")
        },
        400
      );
    }
    console.error("review_event_ingest_failed", {
      requestId: c.get("requestId"),
      userId: user.id,
      error: error instanceof Error ? error.message : String(error)
    });
    return c.json(
      {
        error: "Failed to ingest review event",
        requestId: c.get("requestId")
      },
      500
    );
  }
});

app.post("/api/v1/session/complete", async (c) => {
  let user: { id: string; email: string };
  try {
    user = await requireClerkUser(c);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    throw error;
  }

  try {
    const payload = sessionCompleteSchema.parse(await c.req.json());
    const sql = getSql(c.env);
    const sessionRows = await sql<{ id: string; status: SessionStatus }[]>`
      SELECT "id", "status"::text AS "status"
      FROM "SessionRun"
      WHERE "id" = ${payload.session_id}
        AND "userId" = ${user.id}
      LIMIT 1
    `;
    const session = sessionRows[0];
    if (!session) {
      return c.json(
        {
          error: "Session not found",
          requestId: c.get("requestId")
        },
        404
      );
    }
    if (session.status !== "ACTIVE") {
      return c.json(
        {
          error: "Session already completed",
          requestId: c.get("requestId")
        },
        409
      );
    }

    const endedAt = new Date();
    await sql`
      UPDATE "SessionRun"
      SET
        "status" = ${"COMPLETED"}::"SessionStatus",
        "endedAt" = ${endedAt},
        "updatedAt" = ${endedAt}
      WHERE "id" = ${payload.session_id}
        AND "userId" = ${user.id}
    `;

    const reviewEvents = await sql<{ success: boolean | null; durationSeconds: number | null }[]>`
      SELECT "success", "durationSeconds"
      FROM "ReviewEvent"
      WHERE "userId" = ${user.id}
        AND "sessionRunId" = ${payload.session_id}
        AND "eventType" = ${"REVIEW_ATTEMPTED"}::"ReviewEventType"
    `;
    const reviewsTotal = reviewEvents.length;
    const reviewsSuccessful = reviewEvents.filter((event) => Boolean(event.success)).length;
    const retentionScore = reviewsTotal > 0 ? reviewsSuccessful / reviewsTotal : 1;
    const durationSecondsTotal = reviewEvents.reduce(
      (acc, event) => acc + (event.durationSeconds ?? 0),
      0
    );
    const minutesTotal = Math.ceil(durationSecondsTotal / 60);

    const todayStart = startOfUtcDay(endedAt);
    const newAyahsRows = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS "count"
      FROM "UserItemState"
      WHERE "userId" = ${user.id}
        AND "firstMemorizedAt" >= ${todayStart}
    `;
    const newAyahsMemorized = Number(newAyahsRows[0]?.count ?? "0");

    const queue = await getTodayQueue(c.env, user.id, endedAt);
    if (queue.mode === "FLUENCY_GATE_REQUIRED") {
      return c.json(
        {
          error: "Queue is blocked by fluency gate",
          requestId: c.get("requestId")
        },
        409
      );
    }

    await sql`
      INSERT INTO "DailySession"
        (
          "id", "userId", "sessionDate", "mode", "retentionScore", "backlogMinutesEstimate",
          "overdueDaysMax", "minutesTotal", "reviewsTotal", "reviewsSuccessful",
          "newAyahsMemorized", "warmupPassed", "sabaqAllowed", "updatedAt"
        )
      VALUES
        (
          ${crypto.randomUUID()},
          ${user.id},
          ${todayStart},
          ${queue.mode}::"QueueMode",
          ${retentionScore},
          ${queue.debt.backlogMinutesEstimate},
          ${queue.debt.overdueDaysMax},
          ${minutesTotal},
          ${reviewsTotal},
          ${reviewsSuccessful},
          ${newAyahsMemorized},
          ${queue.warmup_test.passed},
          ${queue.sabaq_task.allowed},
          ${endedAt}
        )
      ON CONFLICT ("userId", "sessionDate")
      DO UPDATE SET
        "mode" = EXCLUDED."mode",
        "retentionScore" = EXCLUDED."retentionScore",
        "backlogMinutesEstimate" = EXCLUDED."backlogMinutesEstimate",
        "overdueDaysMax" = EXCLUDED."overdueDaysMax",
        "minutesTotal" = "DailySession"."minutesTotal" + EXCLUDED."minutesTotal",
        "reviewsTotal" = "DailySession"."reviewsTotal" + EXCLUDED."reviewsTotal",
        "reviewsSuccessful" = "DailySession"."reviewsSuccessful" + EXCLUDED."reviewsSuccessful",
        "newAyahsMemorized" = EXCLUDED."newAyahsMemorized",
        "warmupPassed" = EXCLUDED."warmupPassed",
        "sabaqAllowed" = EXCLUDED."sabaqAllowed",
        "updatedAt" = EXCLUDED."updatedAt"
    `;

    await sql`
      UPDATE "SessionRun"
      SET
        "minutesTotal" = ${minutesTotal},
        "updatedAt" = ${endedAt}
      WHERE "id" = ${payload.session_id}
        AND "userId" = ${user.id}
    `;

    return c.json({
      session_id: payload.session_id,
      retention_score: retentionScore,
      backlog_minutes: queue.debt.backlogMinutesEstimate,
      minutes_total: minutesTotal,
      mode: queue.mode
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return c.json(
        {
          error: "Invalid request payload",
          details: error.flatten(),
          requestId: c.get("requestId")
        },
        400
      );
    }
    console.error("session_complete_failed", {
      requestId: c.get("requestId"),
      userId: user.id,
      error: error instanceof Error ? error.message : String(error)
    });
    return c.json(
      {
        error: "Failed to complete session",
        requestId: c.get("requestId")
      },
      500
    );
  }
});

app.get("/api/v1/user/stats", async (c) => {
  let user: { id: string; email: string };
  try {
    user = await requireClerkUser(c);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    throw error;
  }

  try {
    const stats = await getUserStats(c.env, user.id);
    return c.json(stats);
  } catch (error) {
    console.error("user_stats_failed", {
      requestId: c.get("requestId"),
      userId: user.id,
      error: error instanceof Error ? error.message : String(error)
    });
    return c.json(
      {
        error: "Failed to load user stats",
        requestId: c.get("requestId")
      },
      500
    );
  }
});

app.all("/api/v1/*", (c) => {
  return c.json(
    {
      error: "Cloudflare migration phase 1 active: route not migrated yet",
      code: "NOT_MIGRATED",
      path: c.req.path,
      requestId: c.get("requestId")
    },
    501
  );
});

app.notFound((c) => {
  return c.json(
    {
      error: "Not found",
      requestId: c.get("requestId")
    },
    404
  );
});

export default app;
