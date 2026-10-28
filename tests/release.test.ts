import { describe, expect, it } from "vitest";

import { validateRelease } from "../src/release.js";

const release = {
  manifest: {
    schemaVersion: 1,
    releaseId: "sample-marseille-2026-10-28",
    builtAt: "2026-10-28T00:00:00.000Z",
    formulaVersion: "v1",
    artifacts: {
      config: { path: "config.json", sha256: "a".repeat(64) },
      sources: { path: "sources.json", sha256: "b".repeat(64) },
      segments: { path: "segments.geojson", sha256: "c".repeat(64) },
    },
  },
  config: {
    version: "1.0.0",
    formulaVersion: "v1",
    dimensionBarrierCap: 0.9,
    indicators: {
      steps: { dimension: "physical", kind: "linear", noProblemAt: 0, totalObstacleAt: 10, weight: 1 },
    },
    dimensions: { physical: { minimumCoverage: 1 } },
    profiles: { wheelchair: { minimumCoverage: 1, weights: { physical: 1 } } },
  },
  sources: [
    { id: "osm", name: "OpenStreetMap", version: "2026-10-28", licence: "ODbL-1.0" },
  ],
  segments: [
    {
      id: "sample-001",
      geometry: { type: "LineString", coordinates: [[5.37, 43.29], [5.3702, 43.2901]] },
      sourceWayIds: ["way/1"],
      metrics: { steps: { value: 5, coverage: 1 } },
      relations: [
        { indicator: "steps", sourceId: "osm", method: "intersects", confidence: 1 },
      ],
    },
  ],
};

describe("validateRelease", () => {
  it("accepts a consistent versioned Local Accessibility release", () => {
    expect(validateRelease(release)).toEqual(release);
  });

  it.each([
    ["a formula-version mismatch", (candidate: typeof release) => { candidate.manifest.formulaVersion = "v2"; }, /formula versions differ/],
    ["an unknown metric", (candidate: typeof release) => { (candidate.segments[0]!.metrics as Record<string, unknown>).glare = { value: 0.5, coverage: 1 }; }, /unknown indicator glare/],
    ["an invalid artifact checksum", (candidate: typeof release) => { candidate.manifest.artifacts.config.sha256 = "not-a-checksum"; }, /SHA-256 checksum/],
    ["a non-finite metric value", (candidate: typeof release) => { candidate.segments[0]!.metrics.steps.value = Number.POSITIVE_INFINITY; }, /finite value for steps/],
    ["a metric without provenance", (candidate: typeof release) => { candidate.segments[0]!.relations = []; }, /lacks provenance for steps/],
  ])("rejects %s", (_name, mutate, expectedError) => {
    const candidate = structuredClone(release);
    mutate(candidate);

    expect(() => validateRelease(candidate)).toThrow(expectedError);
  });
});
