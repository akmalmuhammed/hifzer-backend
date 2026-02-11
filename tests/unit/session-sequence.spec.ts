import { ReviewStepType, ScaffoldingLevel } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  buildProtocol,
  expectedFromProtocol,
  validateStepAttempt
} from "../../src/modules/session/session.service";

function mapCounts(values: Array<[ReviewStepType, number]>): Map<ReviewStepType, number> {
  return new Map<ReviewStepType, number>(values);
}

describe("session step sequencing", () => {
  it("enforces standard protocol sequence and attempts", () => {
    const protocol = buildProtocol(ScaffoldingLevel.STANDARD);
    const expectedAtStart = expectedFromProtocol(protocol, mapCounts([]));

    expect(expectedAtStart.expectedStep).toBe(ReviewStepType.EXPOSURE);
    expect(expectedAtStart.expectedAttempt).toBe(1);

    const skipToLink = validateStepAttempt({
      protocol,
      expected: expectedAtStart,
      counts: mapCounts([]),
      stepType: ReviewStepType.LINK,
      attemptNumber: 1
    });
    expect(skipToLink.valid).toBe(false);

    const wrongAttempt = validateStepAttempt({
      protocol,
      expected: expectedAtStart,
      counts: mapCounts([]),
      stepType: ReviewStepType.EXPOSURE,
      attemptNumber: 2
    });
    expect(wrongAttempt.valid).toBe(false);

    const afterExposure = expectedFromProtocol(
      protocol,
      mapCounts([[ReviewStepType.EXPOSURE, 3]])
    );
    expect(afterExposure.expectedStep).toBe(ReviewStepType.GUIDED);
    expect(afterExposure.expectedAttempt).toBe(1);
  });

  it("allows optional exposure/guided for minimal scaffolding but keeps blind/link required", () => {
    const protocol = buildProtocol(ScaffoldingLevel.MINIMAL);
    const expected = expectedFromProtocol(protocol, mapCounts([]));
    expect(expected.expectedStep).toBe(ReviewStepType.BLIND);
    expect(expected.expectedAttempt).toBe(1);

    const optionalExposure = validateStepAttempt({
      protocol,
      expected,
      counts: mapCounts([]),
      stepType: ReviewStepType.EXPOSURE,
      attemptNumber: 1
    });
    expect(optionalExposure.valid).toBe(true);

    const invalidOptionalAttempt = validateStepAttempt({
      protocol,
      expected,
      counts: mapCounts([[ReviewStepType.EXPOSURE, 1]]),
      stepType: ReviewStepType.EXPOSURE,
      attemptNumber: 3
    });
    expect(invalidOptionalAttempt.valid).toBe(false);
  });

  it("marks ayah complete only after required LINK attempts are done", () => {
    const protocol = buildProtocol(ScaffoldingLevel.BEGINNER);
    const completed = expectedFromProtocol(
      protocol,
      mapCounts([
        [ReviewStepType.EXPOSURE, 3],
        [ReviewStepType.GUIDED, 3],
        [ReviewStepType.BLIND, 3],
        [ReviewStepType.LINK, 3]
      ])
    );
    expect(completed.completed).toBe(true);
    expect(completed.expectedStep).toBeNull();
    expect(completed.expectedAttempt).toBeNull();
  });
});
