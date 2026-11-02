// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/components/neighborhood-context-map.js", () => ({
  NeighborhoodContextMap: () => null,
}));

import { NeighborhoodContextReleaseView } from "../src/components/neighborhood-context-explorer.js";
import type { NeighborhoodContextConfig, ContextSource } from "../src/neighborhood-context.js";
import type { NeighborhoodContextReleaseClient } from "../src/neighborhood-context-release-client.js";
import { segmentDetailShard } from "../src/segment-detail-shard.js";

const config: NeighborhoodContextConfig = {
  version: "context-policy-v1" as const,
  geography: { id: "insee-iris-2022-01-01" as const },
  coverage: { minimumNetworkPopulationShare: 0.95 },
  indicators: {
    materialPressure: { bestAt: 10, worstAt: 50, qualifyingDispNote: 0 },
    transitAccess: { bestAt: 52, worstAt: 0, weekdayServiceDays: "tuesday-thursday", hours: [7, 20] as [number, number] },
    civicFreeServiceAccess: { maximumCategories: 4, networkDistanceMetres: 1000 },
  },
};

const baseUrl = "https://data.example.org/context-releases/marseille-context-test";
const sources: ContextSource[] = ["iris-boundaries", "filosofi", "rtm-gtfs", "civic-services", "population-grid", "osm-pedestrian-network"].map((id) => ({
  id,
  name: id,
  version: "test-v1",
  licence: "Etalab-2.0",
  path: `${id}.json`,
  url: `https://example.test/${id}`,
  retrievedAt: "2026-11-02T00:00:00.000Z",
  sha256: "a".repeat(64),
}));

const release: NeighborhoodContextReleaseClient = {
  baseUrl,
  config,
  detailShardCount: 256,
  detailTemplate: "area-details/{shard}.json",
  manifest: {
    schemaVersion: 1,
    policyId: "context-policy-v1",
    releaseId: "marseille-context-test",
    builtAt: "2026-11-02T00:00:00.000Z",
    artifacts: {
      config: { path: "config.json", sha256: "a".repeat(64) },
      sources: { path: "sources.json", sha256: "a".repeat(64) },
      areas: { path: "areas.geojson", sha256: "a".repeat(64) },
      mapTiles: { path: "tiles.json", sha256: "a".repeat(64) },
      areaDetails: { path: "area-details.json", sha256: "a".repeat(64) },
      areaIndex: { path: "area-index.json", sha256: "a".repeat(64) },
    },
  },
  sources,
  tileSource: { bounds: [5.19, 43.16, 5.61, 43.49], maxzoom: 13, minzoom: 9, tiles: ["https://data.example.org/context/tiles/{z}/{x}/{y}.pbf"] },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NeighborhoodContextReleaseView", () => {
  it("filters and inspects a Context area through the keyboard-accessible non-map journey", async () => {
    const user = userEvent.setup();
    const scoredAreaId = "iris-scored";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === `${baseUrl}/area-index.json`) return { ok: true, json: async () => ({
        schemaVersion: 1,
        areas: [
          { id: scoredAreaId, name: "La Plaine", score: 1, sufficient: true },
          { id: "iris-insufficient", name: "No Data", score: null, sufficient: false },
        ],
      }) };
      if (url === `${baseUrl}/area-details/${segmentDetailShard(scoredAreaId)}.json`) return { ok: true, json: async () => ({
        [scoredAreaId]: {
          id: scoredAreaId,
          name: "La Plaine",
          geometry: { type: "Polygon", coordinates: [[[5.37, 43.29], [5.38, 43.29], [5.38, 43.3], [5.37, 43.29]]] },
          population: { imputedShare: 0.1, networkResolvedShare: 1 },
          indicators: {
            materialPressure: { available: true, qualifyingNote: 0, value: 10 },
            transitAccess: { available: true, value: 52 },
            civicFreeServiceAccess: { available: true, value: 4 },
          },
        },
      }) };
      throw new Error(`Unexpected URL ${url}`);
    }));

    render(<NeighborhoodContextReleaseView release={release} />);

    const results = await screen.findByRole("list");
    expect(screen.getByRole("status").textContent).toContain("1 valid Context score");
    expect(screen.getByRole("status").textContent).toContain("1 with insufficient evidence");

    await user.selectOptions(screen.getByLabelText("Context score band"), "high");
    await user.selectOptions(screen.getByLabelText("Evidence status"), "scored");
    const result = screen.getByRole("button", { name: /la plaine.*context score 100%/i });
    expect(results.contains(result)).toBe(true);
    expect(results.querySelectorAll("button")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /no data/i })).toBeNull();

    result.focus();
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("heading", { name: "Selected IRIS area: La Plaine" })).toBeTruthy();
    expect(screen.getByText("Policy: context-policy-v1. Network-resolved population: 100%. Imputed population: 10%.")).toBeTruthy();
    expect(screen.getByText("Material pressure")).toBeTruthy();
    expect(screen.getByText("Transit access")).toBeTruthy();
    expect(screen.getByText("Civic/free-service access")).toBeTruthy();
    expect(screen.getByText(/Sources: iris-boundaries \(test-v1\)/)).toBeTruthy();
  });
});
