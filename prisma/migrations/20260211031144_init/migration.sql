-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."TajwidConfidence" AS ENUM ('LOW', 'MED', 'HIGH');

-- CreateEnum
CREATE TYPE "public"."GoalType" AS ENUM ('SURAH', 'JUZ', 'FULL_QURAN');

-- CreateEnum
CREATE TYPE "public"."ProgramVariant" AS ENUM ('MOMENTUM', 'STANDARD', 'CONSERVATIVE');

-- CreateEnum
CREATE TYPE "public"."QueueMode" AS ENUM ('NORMAL', 'REVIEW_ONLY', 'CONSOLIDATION');

-- CreateEnum
CREATE TYPE "public"."ItemStatus" AS ENUM ('LEARNING', 'MEMORIZED', 'REVIEWING', 'PAUSED');

-- CreateEnum
CREATE TYPE "public"."ReviewTier" AS ENUM ('SABAQ', 'SABQI', 'MANZIL');

-- CreateEnum
CREATE TYPE "public"."ReviewEventType" AS ENUM ('REVIEW_ATTEMPTED', 'TRANSITION_ATTEMPTED');

-- CreateEnum
CREATE TYPE "public"."SessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "refreshTokenVersion" INTEGER NOT NULL DEFAULT 0,
    "timeBudgetMinutes" INTEGER NOT NULL DEFAULT 60,
    "fluencyScore" INTEGER NOT NULL DEFAULT 50,
    "tajwidConfidence" "public"."TajwidConfidence" NOT NULL DEFAULT 'MED',
    "goal" "public"."GoalType" NOT NULL DEFAULT 'FULL_QURAN',
    "hasTeacher" BOOLEAN NOT NULL DEFAULT false,
    "variant" "public"."ProgramVariant" NOT NULL DEFAULT 'STANDARD',
    "dailyNewTargetAyahs" INTEGER NOT NULL DEFAULT 7,
    "reviewRatioTarget" INTEGER NOT NULL DEFAULT 70,
    "retentionThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.85,
    "backlogFreezeRatio" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "consolidationRetentionFloor" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "manzilRotationDays" INTEGER NOT NULL DEFAULT 30,
    "avgSecondsPerItem" INTEGER NOT NULL DEFAULT 75,
    "overdueCapSeconds" INTEGER NOT NULL DEFAULT 172800,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RefreshToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceId" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "rotatedFromTokenId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Ayah" (
    "id" INTEGER NOT NULL,
    "surahNumber" INTEGER NOT NULL,
    "ayahNumber" INTEGER NOT NULL,
    "juzNumber" INTEGER NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "hizbQuarter" INTEGER,
    "textUthmani" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ayah_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserItemState" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "ayahId" INTEGER NOT NULL,
    "status" "public"."ItemStatus" NOT NULL DEFAULT 'LEARNING',
    "tier" "public"."ReviewTier" NOT NULL DEFAULT 'SABAQ',
    "nextReviewAt" TIMESTAMP(3) NOT NULL,
    "reviewIntervalSeconds" INTEGER NOT NULL,
    "intervalCheckpointIndex" INTEGER NOT NULL DEFAULT 0,
    "introducedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstMemorizedAt" TIMESTAMP(3),
    "difficultyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalReviews" INTEGER NOT NULL DEFAULT 0,
    "successfulReviews" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "successStreak" INTEGER NOT NULL DEFAULT 0,
    "averageDurationSeconds" INTEGER NOT NULL DEFAULT 0,
    "lastErrorsCount" INTEGER NOT NULL DEFAULT 0,
    "lastReviewedAt" TIMESTAMP(3),
    "lastEventOccurredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserItemState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SessionRun" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "clientSessionId" UUID,
    "mode" "public"."QueueMode" NOT NULL,
    "warmupPassed" BOOLEAN,
    "status" "public"."SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "minutesTotal" INTEGER NOT NULL DEFAULT 0,
    "eventsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReviewEvent" (
    "id" BIGSERIAL NOT NULL,
    "userId" UUID NOT NULL,
    "sessionRunId" UUID,
    "clientEventId" UUID NOT NULL,
    "eventType" "public"."ReviewEventType" NOT NULL,
    "itemAyahId" INTEGER,
    "tier" "public"."ReviewTier",
    "success" BOOLEAN,
    "errorsCount" INTEGER,
    "durationSeconds" INTEGER,
    "errorTags" JSONB,
    "fromAyahId" INTEGER,
    "toAyahId" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DailySession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sessionDate" DATE NOT NULL,
    "mode" "public"."QueueMode" NOT NULL,
    "retentionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "backlogMinutesEstimate" INTEGER NOT NULL DEFAULT 0,
    "overdueDaysMax" INTEGER NOT NULL DEFAULT 0,
    "minutesTotal" INTEGER NOT NULL DEFAULT 0,
    "reviewsTotal" INTEGER NOT NULL DEFAULT 0,
    "reviewsSuccessful" INTEGER NOT NULL DEFAULT 0,
    "newAyahsMemorized" INTEGER NOT NULL DEFAULT 0,
    "warmupPassed" BOOLEAN NOT NULL DEFAULT false,
    "sabaqAllowed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TransitionScore" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "fromAyahId" INTEGER NOT NULL,
    "toAyahId" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "successes" INTEGER NOT NULL DEFAULT 0,
    "successRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "isWeak" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransitionScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_expiresAt_idx" ON "public"."RefreshToken"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_revokedAt_idx" ON "public"."RefreshToken"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "Ayah_juzNumber_idx" ON "public"."Ayah"("juzNumber");

-- CreateIndex
CREATE INDEX "Ayah_pageNumber_idx" ON "public"."Ayah"("pageNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Ayah_surahNumber_ayahNumber_key" ON "public"."Ayah"("surahNumber", "ayahNumber");

-- CreateIndex
CREATE INDEX "UserItemState_userId_nextReviewAt_idx" ON "public"."UserItemState"("userId", "nextReviewAt");

-- CreateIndex
CREATE INDEX "UserItemState_userId_tier_nextReviewAt_idx" ON "public"."UserItemState"("userId", "tier", "nextReviewAt");

-- CreateIndex
CREATE INDEX "UserItemState_userId_lastReviewedAt_idx" ON "public"."UserItemState"("userId", "lastReviewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserItemState_userId_ayahId_key" ON "public"."UserItemState"("userId", "ayahId");

-- CreateIndex
CREATE INDEX "SessionRun_userId_status_startedAt_idx" ON "public"."SessionRun"("userId", "status", "startedAt");

-- CreateIndex
CREATE INDEX "SessionRun_userId_startedAt_idx" ON "public"."SessionRun"("userId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SessionRun_userId_clientSessionId_key" ON "public"."SessionRun"("userId", "clientSessionId");

-- CreateIndex
CREATE INDEX "ReviewEvent_userId_occurredAt_idx" ON "public"."ReviewEvent"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "ReviewEvent_userId_eventType_occurredAt_idx" ON "public"."ReviewEvent"("userId", "eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "ReviewEvent_userId_itemAyahId_occurredAt_idx" ON "public"."ReviewEvent"("userId", "itemAyahId", "occurredAt");

-- CreateIndex
CREATE INDEX "ReviewEvent_userId_fromAyahId_toAyahId_occurredAt_idx" ON "public"."ReviewEvent"("userId", "fromAyahId", "toAyahId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewEvent_userId_clientEventId_key" ON "public"."ReviewEvent"("userId", "clientEventId");

-- CreateIndex
CREATE INDEX "DailySession_userId_sessionDate_idx" ON "public"."DailySession"("userId", "sessionDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailySession_userId_sessionDate_key" ON "public"."DailySession"("userId", "sessionDate");

-- CreateIndex
CREATE INDEX "TransitionScore_userId_isWeak_successRate_idx" ON "public"."TransitionScore"("userId", "isWeak", "successRate");

-- CreateIndex
CREATE INDEX "TransitionScore_userId_lastAttemptAt_idx" ON "public"."TransitionScore"("userId", "lastAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "TransitionScore_userId_fromAyahId_toAyahId_key" ON "public"."TransitionScore"("userId", "fromAyahId", "toAyahId");

-- AddForeignKey
ALTER TABLE "public"."RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RefreshToken" ADD CONSTRAINT "RefreshToken_rotatedFromTokenId_fkey" FOREIGN KEY ("rotatedFromTokenId") REFERENCES "public"."RefreshToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserItemState" ADD CONSTRAINT "UserItemState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserItemState" ADD CONSTRAINT "UserItemState_ayahId_fkey" FOREIGN KEY ("ayahId") REFERENCES "public"."Ayah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SessionRun" ADD CONSTRAINT "SessionRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReviewEvent" ADD CONSTRAINT "ReviewEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReviewEvent" ADD CONSTRAINT "ReviewEvent_sessionRunId_fkey" FOREIGN KEY ("sessionRunId") REFERENCES "public"."SessionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReviewEvent" ADD CONSTRAINT "ReviewEvent_itemAyahId_fkey" FOREIGN KEY ("itemAyahId") REFERENCES "public"."Ayah"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReviewEvent" ADD CONSTRAINT "ReviewEvent_fromAyahId_fkey" FOREIGN KEY ("fromAyahId") REFERENCES "public"."Ayah"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReviewEvent" ADD CONSTRAINT "ReviewEvent_toAyahId_fkey" FOREIGN KEY ("toAyahId") REFERENCES "public"."Ayah"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DailySession" ADD CONSTRAINT "DailySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TransitionScore" ADD CONSTRAINT "TransitionScore_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TransitionScore" ADD CONSTRAINT "TransitionScore_fromAyahId_fkey" FOREIGN KEY ("fromAyahId") REFERENCES "public"."Ayah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TransitionScore" ADD CONSTRAINT "TransitionScore_toAyahId_fkey" FOREIGN KEY ("toAyahId") REFERENCES "public"."Ayah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Additional check constraints for MVP invariants
ALTER TABLE "public"."User"
  ADD CONSTRAINT "User_fluencyScore_range_chk" CHECK ("fluencyScore" BETWEEN 0 AND 100),
  ADD CONSTRAINT "User_reviewRatioTarget_range_chk" CHECK ("reviewRatioTarget" BETWEEN 0 AND 100),
  ADD CONSTRAINT "User_timeBudgetMinutes_allowed_chk" CHECK ("timeBudgetMinutes" IN (30, 60, 90));

ALTER TABLE "public"."ReviewEvent"
  ADD CONSTRAINT "ReviewEvent_non_negative_fields_chk"
    CHECK (
      ("errorsCount" IS NULL OR "errorsCount" >= 0) AND
      ("durationSeconds" IS NULL OR "durationSeconds" > 0)
    ),
  ADD CONSTRAINT "ReviewEvent_payload_shape_chk"
    CHECK (
      (
        "eventType" = 'REVIEW_ATTEMPTED' AND
        "itemAyahId" IS NOT NULL AND
        "tier" IS NOT NULL AND
        "success" IS NOT NULL AND
        "errorsCount" IS NOT NULL AND
        "durationSeconds" IS NOT NULL AND
        "fromAyahId" IS NULL AND
        "toAyahId" IS NULL
      ) OR (
        "eventType" = 'TRANSITION_ATTEMPTED' AND
        "fromAyahId" IS NOT NULL AND
        "toAyahId" IS NOT NULL AND
        "success" IS NOT NULL AND
        "itemAyahId" IS NULL AND
        "tier" IS NULL AND
        "errorsCount" IS NULL AND
        "durationSeconds" IS NULL
      )
    );

