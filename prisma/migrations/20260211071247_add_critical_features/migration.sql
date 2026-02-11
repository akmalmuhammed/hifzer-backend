-- CreateEnum
CREATE TYPE "public"."FluencyGateStatus" AS ENUM ('IN_PROGRESS', 'PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."ReviewSessionType" AS ENUM ('SABAQ', 'SABQI', 'MANZIL', 'WARMUP');

-- CreateEnum
CREATE TYPE "public"."ReviewStepType" AS ENUM ('EXPOSURE', 'GUIDED', 'BLIND', 'LINK');

-- DropIndex
DROP INDEX "public"."TransitionScore_userId_isWeak_successRate_idx";

-- DropIndex
DROP INDEX "public"."TransitionScore_userId_lastAttemptAt_idx";

-- DropIndex
DROP INDEX "public"."TransitionScore_userId_fromAyahId_toAyahId_key";

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "fluencyGatePassed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requiresPreHifz" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "fluencyScore" DROP NOT NULL,
ALTER COLUMN "fluencyScore" DROP DEFAULT;

-- AlterTable
ALTER TABLE "public"."UserItemState" ADD COLUMN     "consecutivePerfectDays" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "public"."ReviewEvent" ADD COLUMN     "attemptNumber" INTEGER,
ADD COLUMN     "linkedAyahId" INTEGER,
ADD COLUMN     "scaffoldingUsed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sessionType" "public"."ReviewSessionType" NOT NULL DEFAULT 'SABAQ',
ADD COLUMN     "stepType" "public"."ReviewStepType";

-- AlterTable
ALTER TABLE "public"."TransitionScore" DROP CONSTRAINT "TransitionScore_pkey",
DROP COLUMN "attempts",
DROP COLUMN "id",
DROP COLUMN "isWeak",
DROP COLUMN "lastAttemptAt",
DROP COLUMN "successRate",
DROP COLUMN "successes",
ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastPracticedAt" TIMESTAMP(3),
ADD COLUMN     "successCount" INTEGER NOT NULL DEFAULT 0,
ADD CONSTRAINT "TransitionScore_pkey" PRIMARY KEY ("userId", "fromAyahId", "toAyahId");

-- CreateTable
CREATE TABLE "public"."FluencyGateTest" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "testPage" INTEGER NOT NULL,
    "status" "public"."FluencyGateStatus" NOT NULL,
    "durationSeconds" INTEGER,
    "errorCount" INTEGER,
    "fluencyScore" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "FluencyGateTest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FluencyGateTest_userId_idx" ON "public"."FluencyGateTest"("userId");

-- CreateIndex
CREATE INDEX "ReviewEvent_userId_stepType_occurredAt_idx" ON "public"."ReviewEvent"("userId", "stepType", "occurredAt");

-- CreateIndex
CREATE INDEX "TransitionScore_userId_idx" ON "public"."TransitionScore"("userId");

-- CreateIndex
CREATE INDEX "TransitionScore_userId_successCount_idx" ON "public"."TransitionScore"("userId", "successCount");

-- AddForeignKey
ALTER TABLE "public"."ReviewEvent" ADD CONSTRAINT "ReviewEvent_linkedAyahId_fkey" FOREIGN KEY ("linkedAyahId") REFERENCES "public"."Ayah"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FluencyGateTest" ADD CONSTRAINT "FluencyGateTest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Additional feature integrity constraints
ALTER TABLE "public"."FluencyGateTest"
  ADD CONSTRAINT "FluencyGateTest_page_range_chk" CHECK ("testPage" BETWEEN 1 AND 604),
  ADD CONSTRAINT "FluencyGateTest_non_negative_chk"
    CHECK (
      ("durationSeconds" IS NULL OR "durationSeconds" > 0) AND
      ("errorCount" IS NULL OR "errorCount" >= 0) AND
      ("fluencyScore" IS NULL OR ("fluencyScore" BETWEEN 0 AND 100))
    );

ALTER TABLE "public"."ReviewEvent"
  ADD CONSTRAINT "ReviewEvent_step_attempt_range_chk"
    CHECK ("attemptNumber" IS NULL OR ("attemptNumber" BETWEEN 1 AND 3)),
  ADD CONSTRAINT "ReviewEvent_link_step_shape_chk"
    CHECK (
      ("stepType" IS DISTINCT FROM 'LINK'::"public"."ReviewStepType" OR "linkedAyahId" IS NOT NULL) AND
      ("stepType" IS NULL OR "eventType" = 'REVIEW_ATTEMPTED')
    );

