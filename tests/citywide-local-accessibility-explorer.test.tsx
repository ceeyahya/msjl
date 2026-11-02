// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { syncMock } = vi.hoisted(() => ({ syncMock: vi.fn() }));

vi.mock("../src/current-conditions-sync.js", () => ({
  useCurrentConditionsSync: syncMock,
}));

vi.mock("../src/components/citywide-local-accessibility-map.js", () => ({
  CitywideLocalAccessibilityMap: () => null,
}));

import { CitywideReleaseView, PublishedCitywideAccessibilityExplorer } from "../src/components/citywide-local-accessibility-explorer.js";
import { segmentDetailShard } from "../src/segment-detail-shard.js";

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
          config: { path: "config.json" }, sources: { path: "sources.json" }, mapTiles: { path: "tiles.json" }, segmentDetails: { path: "segment-details.json" }, segmentIndex: { path: "segment-index.json" },
        },
      }) };
      if (url === `${releaseBaseUrl}/config.json`) return { ok: true, json: async () => config };
      if (url === `${releaseBaseUrl}/sources.json`) return { ok: true, json: async () => [] };
      if (url === `${releaseBaseUrl}/tiles.json`) return { ok: true, json: async () => ({ tiles: ["tiles/{z}/{x}/{y}.pbf"], minzoom: 10, maxzoom: 15, bounds: [5.19, 43.16, 5.61, 43.49] }) };
      if (url === `${releaseBaseUrl}/segment-details.json`) return { ok: true, json: async () => ({ shardCount: 256, template: "segment-details/{shard}.json" }) };
      if (url === `${releaseBaseUrl}/segment-index.json`) return { ok: true, json: async () => ({ schemaVersion: 1, segments: [] }) };
      throw new Error(`Unexpected URL ${url}`);
    }));

    render(<PublishedCitywideAccessibilityExplorer pointerUrl={pointerUrl} refreshConditions={refreshConditions} />);

    await screen.findByText("Explore release-backed segments");
    expect(syncMock.mock.calls[0]?.[1]).toBe(releaseId);
    await waitFor(() => expect(refreshConditions).toHaveBeenCalledWith(releaseId));
  });

  it("filters release-backed results through visible controls and selects a matching segment without using the map", async () => {
    const user = userEvent.setup();
    const releaseId = "marseille-2026-10-31";
    const pointerUrl = "https://data.example.org/local-accessibility/current.json";
    const releaseBaseUrl = "https://data.example.org/local-accessibility/releases/marseille-2026-10-31";
    const filterConfig = {
      ...config,
      profiles: {
        wheelchair: { minimumCoverage: 1, weights: { physical: 1 } },
        cane: { minimumCoverage: 1, weights: { physical: 1 } },
      },
    };
    syncMock.mockReturnValue({ snapshot: { conditions: [], unmatchedObservations: [] }, status: "unavailable" });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === pointerUrl) return { ok: true, json: async () => ({ schemaVersion: 1, releaseId, baseUrl: "./releases/marseille-2026-10-31/" }) };
      if (url === `${releaseBaseUrl}/manifest.json`) return { ok: true, json: async () => ({
        schemaVersion: 1,
        releaseId,
        builtAt: "2026-10-31T00:00:00.000Z",
        formulaVersion: "v1",
        artifacts: {
          config: { path: "config.json" }, sources: { path: "sources.json" }, mapTiles: { path: "tiles.json" }, segmentDetails: { path: "segment-details.json" }, segmentIndex: { path: "segment-index.json" },
        },
      }) };
      if (url === `${releaseBaseUrl}/config.json`) return { ok: true, json: async () => filterConfig };
      if (url === `${releaseBaseUrl}/sources.json`) return { ok: true, json: async () => [] };
      if (url === `${releaseBaseUrl}/tiles.json`) return { ok: true, json: async () => ({ tiles: ["tiles/{z}/{x}/{y}.pbf"], minzoom: 10, maxzoom: 15, bounds: [5.19, 43.16, 5.61, 43.49] }) };
      if (url === `${releaseBaseUrl}/segment-details.json`) return { ok: true, json: async () => ({ shardCount: 256, template: "segment-details/{shard}.json" }) };
      if (url === `${releaseBaseUrl}/segment-index.json`) return { ok: true, json: async () => ({
        schemaVersion: 1,
        segments: [
          { id: "segment-1", profiles: { wheelchair: { score: 5 / 6, sufficient: true }, cane: { score: 5 / 6, sufficient: true } } },
          { id: "segment-2", profiles: { wheelchair: { score: null, sufficient: false }, cane: { score: null, sufficient: false } } },
        ],
      }) };
      if (url === `${releaseBaseUrl}/segment-details/${segmentDetailShard("segment-1")}.json`) return { ok: true, json: async () => ({
        "segment-1": {
          id: "segment-1",
          geometry: { type: "LineString", coordinates: [[5.37, 43.29], [5.3701, 43.29]] },
          sourceWayIds: ["way/100"],
          metrics: { steps: { value: 1, coverage: 1 } },
          relations: [{ indicator: "steps", sourceId: "osm", method: "intersects", confidence: 1 }],
        },
      }) };
      if (url === `${releaseBaseUrl}/segment-details/${segmentDetailShard("segment-2")}.json`) return { ok: true, json: async () => ({
        "segment-2": {
          id: "segment-2",
          geometry: { type: "LineString", coordinates: [[5.37, 43.29], [5.3701, 43.29]] },
          sourceWayIds: ["way/101"],
          metrics: {},
          relations: [],
        },
      }) };
      throw new Error(`Unexpected URL ${url}`);
    }));

    render(<PublishedCitywideAccessibilityExplorer pointerUrl={pointerUrl} refreshConditions={async () => ({ conditions: [], unmatchedObservations: [] })} />);

    const results = await screen.findByRole("list", { name: "Filtered segment results" });
    expect(screen.getByText(/1 valid baseline score/i)).toBeTruthy();
    expect(screen.getByText(/1 segment with insufficient evidence/i)).toBeTruthy();

    await user.selectOptions(screen.getByLabelText("Score band"), "high");
    expect(within(results).getByRole("button", { name: /segment-1.*score 83%/i })).toBeTruthy();
    expect(within(results).getByRole("button", { name: /segment-2.*insufficient evidence/i })).toBeTruthy();

    await user.selectOptions(screen.getByLabelText("Profile"), "cane");
    expect(within(results).getByRole("button", { name: /segment-1.*score 83%/i })).toBeTruthy();

    await user.selectOptions(screen.getByLabelText("Evidence status"), "insufficient");
    expect(within(results).getByRole("button", { name: /segment-2.*insufficient evidence/i })).toBeTruthy();

    await user.selectOptions(screen.getByLabelText("Profile"), "wheelchair");
    await user.click(within(results).getByRole("button", { name: /segment-2.*insufficient evidence/i }));
    const insufficientHeading = await screen.findByRole("heading", { name: "Selected segment: segment-2" });
    expect(within(insufficientHeading.closest("section")!).getByText(/Profile coverage gate: not met/i)).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Evidence status"), "scored");
    await user.selectOptions(screen.getByLabelText("Score band"), "high");
    await user.click(within(results).getByRole("button", { name: /segment-1.*score 83%/i }));

    const scoredHeading = await screen.findByRole("heading", { name: "Selected segment: segment-1" });
    expect(within(scoredHeading.closest("section")!).getAllByText("Score 83%").length).toBeGreaterThan(0);
  });

  it("uses a persisted effective-current value only for an actively affected segment", async () => {
    syncMock.mockReturnValue({
      snapshot: {
        conditions: [{
          projection: {
            active: true,
            baselineReleaseId: "marseille-2026-10-31",
            condition: "reported-obstacle",
            effectiveResults: { wheelchair: { available: true, coverage: 1, dimensions: {}, score: 0.39, sufficient: true } },
            label: "Provisional community-derived condition",
            localInfluenceMetres: 0,
            policyVersion: "category-severity-v1",
            segmentId: "segment-1",
          },
          observations: [],
        }],
        unmatchedObservations: [],
      },
      status: "unavailable",
    });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === "https://data.example/release/segment-index.json") return { ok: true, json: async () => ({ schemaVersion: 1, segments: [
        { id: "segment-1", profiles: { wheelchair: { score: 0.83, sufficient: true } } },
        { id: "segment-2", profiles: { wheelchair: { score: 0.67, sufficient: true } } },
      ] }) };
      if (url === `https://data.example/release/segment-details/${segmentDetailShard("segment-1")}.json`) return { ok: true, json: async () => ({
        "segment-1": { id: "segment-1", geometry: { type: "LineString", coordinates: [[5.37, 43.29], [5.3701, 43.29]] }, metrics: {}, relations: [], sourceWayIds: [] },
      }) };
      throw new Error(`Unexpected URL ${url}`);
    }));

    render(<CitywideReleaseView primaryScoreLayer="effective-current" refreshConditions={async () => ({ conditions: [], unmatchedObservations: [] })} release={{
      baseUrl: "https://data.example/release",
      config,
      detailShardCount: 256,
      detailTemplate: "segment-details/{shard}.json",
      manifest: { releaseId: "marseille-2026-10-31", artifacts: { segmentIndex: { path: "segment-index.json" } } },
      sources: [],
      tileSource: { bounds: [5.19, 43.16, 5.61, 43.49], maxzoom: 15, minzoom: 10, tiles: ["https://data.example/release/tiles/{z}/{x}/{y}.pbf"] },
    } as never} />);

    const results = await screen.findByRole("list", { name: "Filtered segment results" });
    expect(within(results).getByRole("button", { name: /segment-1.*score 39%/i })).toBeTruthy();
    expect(within(results).getByRole("button", { name: /segment-2.*score 67%/i })).toBeTruthy();
    expect(screen.getAllByRole("status").some((status) => /valid provisional effective-current score/i.test(status.textContent ?? ""))).toBe(true);
  });
});
