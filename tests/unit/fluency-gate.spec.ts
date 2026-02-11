import { describe, expect, it } from "vitest";
import { calculateFluencyScore } from "../../src/modules/fluencyGate/fluency-gate.service";
import {
  FLUENCY_GATE_REQUIRED_MODE,
  shouldBlockForFluencyGate
} from "../../src/modules/queue/queue.service";

describe("Fluency Gate", () => {
  it("blocks queue when gate is not passed", () => {
    const blocked = shouldBlockForFluencyGate({
      fluencyGatePassed: false,
      requiresPreHifz: true
    });
    expect(blocked).toBe(true);
    expect(FLUENCY_GATE_REQUIRED_MODE).toBe("FLUENCY_GATE_REQUIRED");
  });

  it("calculates score for fast/accurate vs slow/error-prone reading", () => {
    const strong = calculateFluencyScore(120, 2);
    expect(strong.fluency_score).toBeGreaterThanOrEqual(90);
    expect(strong.passed).toBe(true);

    const weak = calculateFluencyScore(360, 10);
    expect(weak.fluency_score).toBeLessThan(70);
    expect(weak.passed).toBe(false);
  });
});
