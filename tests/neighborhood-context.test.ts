import { describe, expect, it } from "vitest";

import { deriveNeighborhoodContextResult, validateNeighborhoodContextConfig, validateNeighborhoodContextRelease } from "../src/neighborhood-context.js";

const config = {
  version: "context-policy-v1" as const,
  geography: { id: "insee-iris-2022-01-01" as const },
  coverage: { minimumNetworkPopulationShare: 0.95 },
  indicators: {
    materialPressure: { bestAt: 10, worstAt: 50, qualifyingDispNote: 0 },
    transitAccess: { bestAt: 52, worstAt: 0, weekdayServiceDays: "tuesday-thursday", hours: [7, 20] as [number, number] },
    civicFreeServiceAccess: { maximumCategories: 4, networkDistanceMetres: 1000 },
  },
};

const area = {
  id: "132010101",
  name: "La Plaine",
  geometry: { type: "Polygon" as const, coordinates: [[[5.37, 43.29], [5.38, 43.29], [5.38, 43.3], [5.37, 43.29]]] },
  population: { imputedShare: 0.1, networkResolvedShare: 0.96 },
  indicators: {
    materialPressure: { available: true, value: 30, qualifyingNote: 0 },
    transitAccess: { available: true, value: 26 },
    civicFreeServiceAccess: { available: true, value: 2 },
  },
};

const sources = ["iris-boundaries", "filosofi", "rtm-gtfs", "civic-services", "population-grid", "osm-pedestrian-network"].map((id) => ({
  id, name: id, version: "test-v1", licence: "Etalab-2.0", path: `${id}.json`, url: `https://example.test/${id}`, retrievedAt: "2026-11-01T00:00:00.000Z", sha256: "b".repeat(64),
}));

describe("Neighborhood Context policy", () => {
  it("uses the approved independent indicator register and equal-weight geometric mean", () => {
    const result = deriveNeighborhoodContextResult(area, config);

    expect(result).toEqual({
      available: true,
      indicators: { materialPressure: 0.5, transitAccess: 0.5, civicFreeServiceAccess: 0.5 },
      missingReasons: [],
      score: 0.5,
    });
  });

  it("withholds the Context score when the pedestrian network cannot resolve 95% of population", () => {
    const result = deriveNeighborhoodContextResult({
      ...area,
      population: { ...area.population, networkResolvedShare: 0.94 },
    }, config);

    expect(result.available).toBe(false);
    expect(result.score).toBeUndefined();
    expect(result.indicators.materialPressure).toBe(0.5);
    expect(result.missingReasons).toEqual([
      "Network coverage is below 95% of the IRIS population for transitAccess.",
      "Network coverage is below 95% of the IRIS population for civicFreeServiceAccess.",
    ]);
  });

  it("rejects a policy that silently changes the approved thresholds", () => {
    expect(() => validateNeighborhoodContextConfig({ ...config, indicators: { ...config.indicators, transitAccess: { ...config.indicators.transitAccess, bestAt: 60 } } }))
      .toThrow("approved transit-access thresholds");
  });

  it("rejects an area with missing data that has no visible reason", () => {
    expect(() => validateNeighborhoodContextRelease({
      manifest: {
        schemaVersion: 1,
        releaseId: "context-test",
        builtAt: "2026-11-02T00:00:00.000Z",
        policyId: "context-policy-v1",
        artifacts: Object.fromEntries(["config", "sources", "areas", "mapTiles", "areaDetails", "areaIndex"].map((name) => [name, { path: `${name}.json`, sha256: "a".repeat(64) }])),
      },
      config,
      sources,
      areas: [{ ...area, indicators: { ...area.indicators, materialPressure: { available: false } } }],
    })).toThrow("missing-data reason");
  });
});
