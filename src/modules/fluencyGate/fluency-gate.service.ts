import { FluencyGateStatus } from "@prisma/client";
import { HttpError } from "../../lib/http";
import { prisma } from "../../lib/prisma";

export type FluencyScoreResult = {
  fluency_score: number;
  time_score: number;
  accuracy_score: number;
  passed: boolean;
};

export function calculateFluencyScore(
  durationSeconds: number,
  errorCount: number
): FluencyScoreResult {
  const timeScore =
    durationSeconds < 180 ? 50 : Math.max(0, 50 - (durationSeconds - 180) / 6);
  const accuracyScore =
    errorCount < 5 ? 50 : Math.max(0, 50 - (errorCount - 5) * 5);
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

export async function startFluencyGateTest(userId: string) {
  const [memorizedPagesRaw, availablePagesRaw] = await Promise.all([
    prisma.userItemState.findMany({
      where: {
        userId,
        firstMemorizedAt: {
          not: null
        }
      },
      select: {
        ayah: {
          select: {
            pageNumber: true
          }
        }
      }
    }),
    prisma.ayah.findMany({
      select: {
        pageNumber: true
      },
      distinct: ["pageNumber"]
    })
  ]);

  const memorizedPages = new Set(
    memorizedPagesRaw.map((state) => state.ayah.pageNumber)
  );
  const availablePages = availablePagesRaw.map((row) => row.pageNumber);
  if (availablePages.length === 0) {
    throw new HttpError(
      409,
      "Ayah metadata is not seeded. Load ayahs before starting fluency gate."
    );
  }

  const candidatePages = availablePages.filter((page) => !memorizedPages.has(page));
  const selectedPage = randomFrom(candidatePages.length ? candidatePages : availablePages);

  const pageAyahs = await prisma.ayah.findMany({
    where: {
      pageNumber: selectedPage
    },
    orderBy: {
      ayahNumber: "asc"
    },
    select: {
      id: true,
      textUthmani: true,
      ayahNumber: true,
      surahNumber: true
    }
  });

  const test = await prisma.fluencyGateTest.create({
    data: {
      userId,
      testPage: selectedPage,
      status: FluencyGateStatus.IN_PROGRESS
    }
  });

  return {
    test_id: test.id,
    page: selectedPage,
    ayahs: pageAyahs,
    instructions:
      "Read this page aloud in under 3 minutes with fewer than 5 tajweed errors"
  };
}

export async function submitFluencyGateTest(params: {
  userId: string;
  testId: string;
  durationSeconds: number;
  errorCount: number;
}) {
  const test = await prisma.fluencyGateTest.findFirst({
    where: {
      id: params.testId,
      userId: params.userId,
      status: FluencyGateStatus.IN_PROGRESS
    }
  });

  if (!test) {
    return null;
  }

  const score = calculateFluencyScore(params.durationSeconds, params.errorCount);

  await prisma.fluencyGateTest.update({
    where: { id: test.id },
    data: {
      durationSeconds: params.durationSeconds,
      errorCount: params.errorCount,
      fluencyScore: score.fluency_score,
      status: score.passed ? FluencyGateStatus.PASSED : FluencyGateStatus.FAILED,
      completedAt: new Date()
    }
  });

  await prisma.user.update({
    where: { id: params.userId },
    data: {
      fluencyScore: score.fluency_score,
      fluencyGatePassed: score.passed,
      requiresPreHifz: !score.passed
    }
  });

  return {
    ...score,
    message: score.passed
      ? "Fluency Gate passed. You can begin memorizing."
      : "Your reading needs strengthening. Please complete Pre-Hifz fluency training first."
  };
}

export async function getFluencyGateStatus(userId: string) {
  const [user, latestTest] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        fluencyScore: true,
        fluencyGatePassed: true,
        requiresPreHifz: true
      }
    }),
    prisma.fluencyGateTest.findFirst({
      where: {
        userId
      },
      orderBy: {
        startedAt: "desc"
      },
      select: {
        id: true,
        testPage: true,
        status: true,
        startedAt: true,
        completedAt: true,
        fluencyScore: true
      }
    })
  ]);

  return {
    ...user,
    latest_test: latestTest
  };
}
