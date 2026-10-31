import { describe, expect, it, vi } from "vitest";

import { loadCitywideReleaseFromPointer } from "../src/citywide-release-client.js";

const config = {
  version: "1.0.0",
  formulaVersion: "v1",
  dimensionBarrierCap: 0.9,
  indicators: { steps: { dimension: "physical", kind: "linear", noProblemAt: 0, totalObstacleAt: 6, weight: 1 } },
  dimensions: { physical: { minimumCoverage: 1 } },
  profiles: { wheelchair: { minimumCoverage: 1, weights: { physical: 1 } } },
};

const releaseArtifacts = {
  schemaVersion: 1,
  releaseId: "marseille-2026-10-31",
  builtAt: "2026-10-31T00:00:00.000Z",
  formulaVersion: "v1",
  artifacts: {
    config: { path: "config.json" },
    sources: { path: "sources.json" },
    mapTiles: { path: "tiles.json" },
    segmentDetails: { path: "segment-details.json" },
  },
};

function jsonResponse(value: unknown) {
  return { ok: true, json: async () => value };
}

describe("loadCitywideReleaseFromPointer", () => {
  it("resolves a pointer-relative immutable release and loads its map artifacts", async () => {
    const pointerUrl = "https://data.example.org/local-accessibility/current.json";
    const releaseBaseUrl = "https://data.example.org/local-accessibility/releases/marseille-2026-10-31";
    const responseFor = (url: string) => {
      if (url === pointerUrl) return { schemaVersion: 1, releaseId: "marseille-2026-10-31", baseUrl: "./releases/marseille-2026-10-31/" };
      if (url === `${releaseBaseUrl}/manifest.json`) return releaseArtifacts;
      if (url === `${releaseBaseUrl}/config.json`) return config;
      if (url === `${releaseBaseUrl}/sources.json`) return [{ id: "osm", name: "OpenStreetMap", version: "snapshot", licence: "ODbL-1.0" }];
      if (url === `${releaseBaseUrl}/tiles.json`) return { tiles: ["tiles/{z}/{x}/{y}.pbf"], minzoom: 10, maxzoom: 15, bounds: [5.19, 43.16, 5.61, 43.49] };
      if (url === `${releaseBaseUrl}/segment-details.json`) return { template: "segment-details/{id}.json" };
      throw new Error(`Unexpected URL ${url}`);
    };
    const fetchMock = vi.fn(async (input: string | URL) => jsonResponse(responseFor(String(input))));
    vi.stubGlobal("fetch", fetchMock);

    const release = await loadCitywideReleaseFromPointer(pointerUrl);

    expect(release.baseUrl).toBe(releaseBaseUrl);
    expect(release.manifest.releaseId).toBe("marseille-2026-10-31");
    expect(release.tileSource.tiles).toEqual([`${releaseBaseUrl}/tiles/{z}/{x}/{y}.pbf`]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      pointerUrl,
      `${releaseBaseUrl}/manifest.json`,
      `${releaseBaseUrl}/config.json`,
      `${releaseBaseUrl}/sources.json`,
      `${releaseBaseUrl}/tiles.json`,
      `${releaseBaseUrl}/segment-details.json`,
    ]);
  });

  it("rejects a malformed pointer before requesting a release", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ schemaVersion: 1, releaseId: "marseille-2026-10-31" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadCitywideReleaseFromPointer("https://data.example.org/local-accessibility/current.json"))
      .rejects.toThrow("The citywide release pointer is invalid.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a pointer that names a different release than its manifest", async () => {
    const pointerUrl = "https://data.example.org/local-accessibility/current.json";
    const releaseBaseUrl = "https://data.example.org/local-accessibility/releases/marseille-2026-10-31";
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === pointerUrl) return jsonResponse({ schemaVersion: 1, releaseId: "marseille-2026-10-30", baseUrl: "./releases/marseille-2026-10-31/" });
      if (url === `${releaseBaseUrl}/manifest.json`) return jsonResponse(releaseArtifacts);
      if (url === `${releaseBaseUrl}/config.json`) return jsonResponse(config);
      if (url === `${releaseBaseUrl}/sources.json`) return jsonResponse([{ id: "osm", name: "OpenStreetMap", version: "snapshot", licence: "ODbL-1.0" }]);
      if (url === `${releaseBaseUrl}/tiles.json`) return jsonResponse({ tiles: ["tiles/{z}/{x}/{y}.pbf"], minzoom: 10, maxzoom: 15, bounds: [5.19, 43.16, 5.61, 43.49] });
      if (url === `${releaseBaseUrl}/segment-details.json`) return jsonResponse({ template: "segment-details/{id}.json" });
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadCitywideReleaseFromPointer(pointerUrl))
      .rejects.toThrow("The citywide release pointer does not match the referenced release manifest.");
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      pointerUrl,
      `${releaseBaseUrl}/manifest.json`,
    ]);
  });
});
