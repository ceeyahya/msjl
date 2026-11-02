import { describe, expect, it, vi } from "vitest";

import { loadNeighborhoodContextArea, loadNeighborhoodContextAreaIndex, loadNeighborhoodContextReleaseFromPointer } from "../src/neighborhood-context-release-client.js";

const config = {
  version: "context-policy-v1", geography: { id: "insee-iris-2022-01-01" }, coverage: { minimumNetworkPopulationShare: 0.95 },
  indicators: {
    materialPressure: { bestAt: 10, worstAt: 50, qualifyingDispNote: 0 },
    transitAccess: { bestAt: 52, worstAt: 0, weekdayServiceDays: "tuesday-thursday", hours: [7, 20] },
    civicFreeServiceAccess: { maximumCategories: 4, networkDistanceMetres: 1000 },
  },
};

const artifacts = {
  schemaVersion: 1, releaseId: "marseille-context-2026-q4", builtAt: "2026-11-02T00:00:00.000Z", policyId: "context-policy-v1",
  artifacts: {
    config: { path: "config.json", sha256: "a".repeat(64) }, sources: { path: "sources.json", sha256: "a".repeat(64) }, areas: { path: "areas.geojson", sha256: "a".repeat(64) }, mapTiles: { path: "tiles.json", sha256: "a".repeat(64) }, areaDetails: { path: "area-details.json", sha256: "a".repeat(64) }, areaIndex: { path: "area-index.json", sha256: "a".repeat(64) },
  },
};
const sources = ["iris-boundaries", "filosofi", "rtm-gtfs", "civic-services", "population-grid", "osm-pedestrian-network"].map((id) => ({ id, name: id, version: "v1", licence: "Etalab-2.0", path: `${id}.json`, url: `https://example.test/${id}`, retrievedAt: "2026-11-01T00:00:00.000Z", sha256: "a".repeat(64) }));
const response = (value: unknown) => ({ ok: true, json: async () => value });

describe("Neighborhood Context release client", () => {
  it("loads a pointer-identified release without fetching full area details", async () => {
    const pointerUrl = "https://data.example.org/context-current.json";
    const baseUrl = "https://data.example.org/context-releases/marseille-context-2026-q4";
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === pointerUrl) return response({ schemaVersion: 1, releaseId: "marseille-context-2026-q4", baseUrl: "./context-releases/marseille-context-2026-q4/" });
      if (url === `${baseUrl}/manifest.json`) return response(artifacts);
      if (url === `${baseUrl}/config.json`) return response(config);
      if (url === `${baseUrl}/sources.json`) return response(sources);
      if (url === `${baseUrl}/tiles.json`) return response({ tiles: ["tiles/{z}/{x}/{y}.pbf"], minzoom: 9, maxzoom: 13, bounds: [5.19, 43.16, 5.61, 43.49] });
      if (url === `${baseUrl}/area-details.json`) return response({ shardCount: 256, template: "area-details/{shard}.json" });
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const release = await loadNeighborhoodContextReleaseFromPointer(pointerUrl);

    expect(release.tileSource.tiles).toEqual([`${baseUrl}/tiles/{z}/{x}/{y}.pbf`]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([pointerUrl, `${baseUrl}/manifest.json`, `${baseUrl}/config.json`, `${baseUrl}/sources.json`, `${baseUrl}/tiles.json`, `${baseUrl}/area-details.json`]);
  });

  it("loads the compact index and only the selected IRIS detail shard", async () => {
    const pointerUrl = "https://data.example.org/context-current.json";
    const baseUrl = "https://data.example.org/context-releases/marseille-context-2026-q4";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === pointerUrl) return response({ schemaVersion: 1, releaseId: "marseille-context-2026-q4", baseUrl: "./context-releases/marseille-context-2026-q4/" });
      if (url === `${baseUrl}/manifest.json`) return response(artifacts);
      if (url === `${baseUrl}/config.json`) return response(config);
      if (url === `${baseUrl}/sources.json`) return response(sources);
      if (url === `${baseUrl}/tiles.json`) return response({ tiles: ["tiles/{z}/{x}/{y}.pbf"], minzoom: 9, maxzoom: 13, bounds: [5.19, 43.16, 5.61, 43.49] });
      if (url === `${baseUrl}/area-details.json`) return response({ shardCount: 256, template: "area-details/{shard}.json" });
      if (url === `${baseUrl}/area-index.json`) return response({ schemaVersion: 1, areas: [{ id: "iris-1", name: "La Plaine", score: 0.5, sufficient: true }] });
      if (url === `${baseUrl}/area-details/a6.json`) return response({ "iris-1": { id: "iris-1", geometry: { type: "Polygon", coordinates: [] }, population: { networkResolvedShare: 1, imputedShare: 0 }, indicators: {} } });
      throw new Error(`Unexpected URL ${url}`);
    }));
    const release = await loadNeighborhoodContextReleaseFromPointer(pointerUrl);

    await expect(loadNeighborhoodContextAreaIndex(release)).resolves.toEqual([{ id: "iris-1", name: "La Plaine", score: 0.5, sufficient: true }]);
    await expect(loadNeighborhoodContextArea(release, "iris-1")).resolves.toMatchObject({ id: "iris-1" });
  });

  it("rejects a pointer whose release ID differs from its manifest", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      if (String(input) === "https://data.example.org/context-current.json") return response({ schemaVersion: 1, releaseId: "other", baseUrl: "./context-releases/marseille-context-2026-q4/" });
      return response(artifacts);
    }));

    await expect(loadNeighborhoodContextReleaseFromPointer("https://data.example.org/context-current.json"))
      .rejects.toThrow("does not match the referenced release manifest");
  });
});
