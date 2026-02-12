import { Hono, type Context } from "hono";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
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
