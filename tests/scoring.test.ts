import { describe, expect, it } from "vitest";

import {
  deriveEffectiveCurrentScore,
  linearBarrier,
  scoreSegment,
  scoreSegments,
  type LocalAccessibilityConfig,
} from "../src/scoring.js";

const config: LocalAccessibilityConfig = {
  version: "1.0.0",
  formulaVersion: "v1",
  dimensionBarrierCap: 0.9,
  indicators: {
    steps: {
      dimension: "physical",
      kind: "linear",
      noProblemAt: 0,
      totalObstacleAt: 10,
      weight: 2,
    },
    slope: {
      dimension: "physical",
      kind: "directional-linear",
      noProblemAt: 4,
      totalObstacleAt: 12,
      weight: 1,
    },
    seating: {
      dimension: "physical",
      kind: "linear",
      noProblemAt: 3,
      totalObstacleAt: 0,
      weight: 1,
    },
    noise: {
      dimension: "sensory",
      kind: "linear",
      noProblemAt: 55,
      totalObstacleAt: 85,
      weight: 1,
    },
  },
  dimensions: {
    physical: { minimumCoverage: 0.5 },
    sensory: { minimumCoverage: 1 },
  },
  profiles: {
    wheelchair: {
      minimumCoverage: 0.5,
      weights: { physical: 0.75, sensory: 0.25 },
    },
  },
};

describe("linearBarrier", () => {
  it("maps either threshold direction into a clamped barrier", () => {
    expect(linearBarrier(6, 4, 12)).toBe(0.25);
    expect(linearBarrier(15, 4, 12)).toBe(1);
    expect(linearBarrier(1.5, 3, 0)).toBe(0.5);
    expect(linearBarrier(4, 3, 0)).toBe(0);
  });
});

describe("scoreSegment", () => {
  it("uses weighted available indicators, preserves directional slope, and normalizes profile weights", () => {
    const result = scoreSegment(
      {
        id: "sample-001",
        metrics: {
          steps: { value: 5, coverage: 1 },
          slope: { uphill: 6, downhill: 8, coverage: 1 },
        },
      },
      config,
      "wheelchair",
    );

    expect(result.indicators.slope).toMatchObject({
      barrier: 0.5,
      directionalValues: { uphill: 6, downhill: 8 },
    });
    expect(result.dimensions.physical).toMatchObject({ barrier: 0.5, coverage: 0.75, sufficient: true });
    expect(result.dimensions.sensory).toMatchObject({ barrier: undefined, coverage: 0, sufficient: false });
    expect(result.profile).toEqual({ score: 0.5, coverage: 0.75, sufficient: true });
  });

  it("returns an insufficient profile when its available dimensions miss the profile coverage gate", () => {
    const result = scoreSegment(
      { id: "sample-002", metrics: { steps: { value: 5, coverage: 1 } } },
      { ...config, profiles: { wheelchair: { minimumCoverage: 0.8, weights: { physical: 0.75, sensory: 0.25 } } } },
      "wheelchair",
    );

    expect(result.profile).toEqual({ score: undefined, coverage: 0.75, sufficient: false });
  });

  it("caps a saturated dimension before calculating the profile score", () => {
    const result = scoreSegment(
      { id: "sample-003", metrics: { steps: { value: 10, coverage: 1 } } },
      config,
      "wheelchair",
    );

    expect(result.profile.coverage).toBe(0.75);
    expect(result.profile.sufficient).toBe(true);
    expect(result.profile.score).toBeCloseTo(0.1);
  });

  it("reports the proportion of segments with sufficient profile evidence", () => {
    const result = scoreSegments(
      [
        { id: "sample-004", metrics: { steps: { value: 5, coverage: 1 } } },
        { id: "sample-005", metrics: {} },
      ],
      config,
      "wheelchair",
    );

    expect(result.mapCoverage).toEqual({ coverage: 0.5, sufficientSegments: 1, totalSegments: 2 });
  });
});

describe("deriveEffectiveCurrentScore", () => {
  it("composes active physical impacts with the immutable baseline and leaves unscored evidence visible without a numeric impact", () => {
    const baseline = scoreSegment(
      { id: "sample-effective-current", metrics: { steps: { value: 5, coverage: 1 } } },
      config,
      "wheelchair",
    );

    const result = deriveEffectiveCurrentScore(baseline, config, "wheelchair", [
      { observationId: "minor", dimension: "physical", impact: 0.15 },
      { observationId: "major", dimension: "physical", impact: 0.5 },
      { observationId: "other", impact: 0 },
    ]);

    // A 0.5 baseline barrier with 0.15 and 0.5 impacts becomes
    // 1 - (1 - 0.5) * (1 - 0.15) * (1 - 0.5) = 0.7875.
    expect(result).toMatchObject({
      available: true,
      profile: { coverage: 0.75, sufficient: true },
      dimensions: {
        physical: { baselineBarrier: 0.5, effectiveBarrier: 0.7875 },
      },
      impacts: [
        { observationId: "minor", dimension: "physical", impact: 0.15 },
        { observationId: "major", dimension: "physical", impact: 0.5 },
        { observationId: "other", impact: 0 },
      ],
    });
    expect(result.profile.score).toBeCloseTo(0.2125);
  });

  it("does not derive an effective score when the baseline physical dimension is unavailable", () => {
    const physicalOptionalConfig = {
      ...config,
      profiles: { wheelchair: { minimumCoverage: 0.2, weights: { physical: 0.25, sensory: 0.75 } } },
    };
    const baseline = scoreSegment(
      { id: "sample-unavailable-effective-current", metrics: { noise: { value: 70, coverage: 1 } } },
      physicalOptionalConfig,
      "wheelchair",
    );

    const result = deriveEffectiveCurrentScore(baseline, physicalOptionalConfig, "wheelchair", [
      { observationId: "major", dimension: "physical", impact: 0.5 },
    ]);

    expect(result).toMatchObject({
      available: false,
      reason: "The baseline physical dimension does not meet its coverage gate.",
      profile: { score: undefined, coverage: 0.75, sufficient: true },
    });
  });
});
