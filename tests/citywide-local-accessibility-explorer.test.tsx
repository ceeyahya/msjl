// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { syncMock } = vi.hoisted(() => ({ syncMock: vi.fn() }));

vi.mock("../src/current-conditions-sync.js", () => ({
  useCurrentConditionsSync: syncMock,
}));

vi.mock("../src/components/citywide-local-accessibility-map.js", () => ({
  CitywideLocalAccessibilityMap: () => null,
}));

import { PublishedCitywideAccessibilityExplorer } from "../src/components/citywide-local-accessibility-explorer.js";

const config = {
  version: "1.0.0",
  formulaVersion: "v1",
  dimensionBarrierCap: 0.9,
  indicators: { steps: { dimension: "physical", kind: "linear", noProblemAt: 0, totalObstacleAt: 6, weight: 1 } },
  dimensions: { physical: { minimumCoverage: 1 } },
  profiles: { wheelchair: { minimumCoverage: 1, weights: { physical: 1 } } },
};

afterEach(() => {
  cleanup();
  syncMock.mockReset();
  vi.unstubAllGlobals();
});

describe("PublishedCitywideAccessibilityExplorer", () => {
  it("scopes Community Conditions synchronization to the release selected by the pointer", async () => {
    const releaseId = "marseille-2026-10-31";
    const pointerUrl = "https://data.example.org/local-accessibility/current.json";
    const releaseBaseUrl = "https://data.example.org/local-accessibility/releases/marseille-2026-10-31";
    const refreshConditions = vi.fn(async () => ({ conditions: [], unmatchedObservations: [] }));
    syncMock.mockImplementation((_snapshot, _baselineReleaseId, getSnapshot) => {
      void getSnapshot();
      return { snapshot: { conditions: [], unmatchedObservations: [] }, status: "unavailable" };
    });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === pointerUrl) return { ok: true, json: async () => ({ schemaVersion: 1, releaseId, baseUrl: "./releases/marseille-2026-10-31/" }) };
      if (url === `${releaseBaseUrl}/manifest.json`) return { ok: true, json: async () => ({
        schemaVersion: 1,
        releaseId,
        builtAt: "2026-10-31T00:00:00.000Z",
        formulaVersion: "v1",
        artifacts: {
          config: { path: "config.json" }, sources: { path: "sources.json" }, mapTiles: { path: "tiles.json" }, segmentDetails: { path: "segment-details.json" },
        },
      }) };
      if (url === `${releaseBaseUrl}/config.json`) return { ok: true, json: async () => config };
      if (url === `${releaseBaseUrl}/sources.json`) return { ok: true, json: async () => [] };
      if (url === `${releaseBaseUrl}/tiles.json`) return { ok: true, json: async () => ({ tiles: ["tiles/{z}/{x}/{y}.pbf"], minzoom: 10, maxzoom: 15, bounds: [5.19, 43.16, 5.61, 43.49] }) };
      if (url === `${releaseBaseUrl}/segment-details.json`) return { ok: true, json: async () => ({ template: "segment-details/{id}.json" }) };
      throw new Error(`Unexpected URL ${url}`);
    }));

    render(<PublishedCitywideAccessibilityExplorer pointerUrl={pointerUrl} refreshConditions={refreshConditions} />);

    await screen.findByText("Explore release-backed segments");
    expect(syncMock.mock.calls[0]?.[1]).toBe(releaseId);
    await waitFor(() => expect(refreshConditions).toHaveBeenCalledWith(releaseId));
  });
});
