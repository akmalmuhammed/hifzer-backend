-- CreateEnum
CREATE TYPE "public"."PriorJuzBand" AS ENUM ('ZERO', 'ONE_TO_FIVE', 'FIVE_PLUS');

-- CreateEnum
CREATE TYPE "public"."ScaffoldingLevel" AS ENUM ('BEGINNER', 'STANDARD', 'MINIMAL');

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "priorJuzBand" "public"."PriorJuzBand" NOT NULL DEFAULT 'ZERO',
ADD COLUMN     "scaffoldingLevel" "public"."ScaffoldingLevel" NOT NULL DEFAULT 'STANDARD';
