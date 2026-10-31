// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const conditionSource = { setData: vi.fn() };
const map = {
  addControl: vi.fn(),
  addLayer: vi.fn(),
  addSource: vi.fn(),
  getCanvas: () => ({ style: {} }),
  getSource: vi.fn(() => conditionSource),
  on: vi.fn((event: string, ...argumentsList: unknown[]) => {
    const handler = argumentsList.at(-1);
    if (event === "load" && typeof handler === "function") handler();
  }),
  remove: vi.fn(),
};
const Map = vi.fn(function Map() { return map; });
const setWorkerUrl = vi.fn();
const maplibregl = {
  Map,
  NavigationControl: class {},
  ScaleControl: class {},
  setWorkerUrl,
};

vi.mock("maplibre-gl", () => ({
  ...maplibregl,
}));

vi.mock("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url", () => ({ default: "/assets/maplibre-gl-worker.mjs" }));

import { CitywideLocalAccessibilityMap } from "../src/components/citywide-local-accessibility-map.js";
import { PublishedCitywideAccessibilityExplorer } from "../src/components/citywide-local-accessibility-explorer.js";

afterEach(() => {
  cleanup();
  Map.mockClear();
  setWorkerUrl.mockClear();
  map.addLayer.mockClear();
  map.addSource.mockClear();
  map.getSource.mockClear();
  map.on.mockClear();
  map.remove.mockClear();
  conditionSource.setData.mockClear();
  vi.unstubAllGlobals();
});

describe("CitywideLocalAccessibilityMap", () => {
  it("loads baseline segments from a release TileJSON source and updates only the provisional overlay", async () => {
    Object.defineProperty(window, "WebGLRenderingContext", { configurable: true, value: class {} });
    const segment = {
      id: "osm-way-100-0001",
      geometry: { type: "LineString" as const, coordinates: [[5.37, 43.29], [5.3701, 43.29]] as [number, number][] },
      sourceWayIds: ["way/100"],
      metrics: {},
      relations: [],
    };
    const { rerender } = render(
      <CitywideLocalAccessibilityMap
        conditionSegments={[]}
        onSelectSegment={() => undefined}
        profileKey="wheelchair"
        tileSource={{
          tiles: ["https://assets.example/releases/marseille/tiles/{z}/{x}/{y}.pbf"],
          minzoom: 10,
          maxzoom: 15,
          bounds: [5.19, 43.16, 5.61, 43.49],
        }}
      />,
    );

    await waitFor(() => expect(map.addSource).toHaveBeenCalledWith("release-segment-tiles", {
      type: "vector",
      tiles: ["https://assets.example/releases/marseille/tiles/{z}/{x}/{y}.pbf"],
      minzoom: 10,
      maxzoom: 15,
      bounds: [5.19, 43.16, 5.61, 43.49],
    }));
    expect(setWorkerUrl).toHaveBeenCalledWith("/assets/maplibre-gl-worker.mjs");
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: "release-segments-scored",
      filter: ["==", ["get", "wheelchairSufficient"], true],
    }));
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: "release-segments-insufficient",
      filter: ["!=", ["get", "wheelchairSufficient"], true],
    }));
    expect(map.addSource).toHaveBeenCalledWith("current-conditions", expect.objectContaining({ type: "geojson" }));

    conditionSource.setData.mockClear();
    rerender(
      <CitywideLocalAccessibilityMap
        conditionSegments={[segment]}
        onSelectSegment={() => undefined}
        profileKey="wheelchair"
        tileSource={{
          tiles: ["https://assets.example/releases/marseille/tiles/{z}/{x}/{y}.pbf"],
          minzoom: 10,
          maxzoom: 15,
          bounds: [5.19, 43.16, 5.61, 43.49],
        }}
      />,
    );

    await waitFor(() => expect(conditionSource.setData).toHaveBeenCalled());
    expect(Map).toHaveBeenCalledTimes(1);
    const overlay = conditionSource.setData.mock.calls.at(-1)?.[0] as { features: Array<{ properties: { id: string } }> };
    expect(overlay.features[0]?.properties.id).toBe("osm-way-100-0001");
  });

  it("loads only the selected segment detail from a published release", async () => {
    Object.defineProperty(window, "WebGLRenderingContext", { configurable: true, value: class {} });
    const config = {
      version: "1.0.0",
      formulaVersion: "v1",
      dimensionBarrierCap: 0.9,
      indicators: { steps: { dimension: "physical", kind: "linear", noProblemAt: 0, totalObstacleAt: 6, weight: 1 } },
      dimensions: { physical: { minimumCoverage: 1 } },
      profiles: { wheelchair: { minimumCoverage: 1, weights: { physical: 1 } } },
    };
    const segment = {
      id: "osm-way-100-0001",
      geometry: { type: "LineString", coordinates: [[5.37, 43.29], [5.3701, 43.29]] },
      sourceWayIds: ["way/100"],
      metrics: { steps: { value: 1, coverage: 1 } },
      relations: [{ indicator: "steps", sourceId: "osm", method: "intersects", confidence: 1 }],
    };
    const responseFor = (url: string) => {
      if (url.endsWith("manifest.json")) return { schemaVersion: 1, releaseId: "marseille-test", builtAt: "2026-10-30T00:00:00.000Z", formulaVersion: "v1", artifacts: {
        config: { path: "config.json" }, sources: { path: "sources.json" }, mapTiles: { path: "tiles.json" }, segmentDetails: { path: "segment-details.json" },
      } };
      if (url.endsWith("config.json")) return config;
      if (url.endsWith("sources.json")) return [{ id: "osm", name: "OpenStreetMap", version: "snapshot", licence: "ODbL-1.0" }];
      if (url.endsWith("tiles.json")) return { tiles: ["tiles/{z}/{x}/{y}.pbf"], minzoom: 10, maxzoom: 15, bounds: [5.19, 43.16, 5.61, 43.49] };
      if (url.endsWith("segment-details.json")) return { template: "segment-details/{id}.json" };
      if (url.endsWith("segment-details/osm-way-100-0001.json")) return segment;
      throw new Error(`Unexpected URL ${url}`);
    };
    const fetchMock = vi.fn(async (input: string | URL) => ({ ok: true, json: async () => responseFor(String(input)) }));
    vi.stubGlobal("fetch", fetchMock);

    render(<PublishedCitywideAccessibilityExplorer baseUrl="https://assets.example/releases/marseille-test" refreshConditions={async () => ({ conditions: [], unmatchedObservations: [] })} />);

    await screen.findByText("Explore release-backed segments");
    expect(map.addSource).toHaveBeenCalledWith("release-segment-tiles", expect.objectContaining({
      tiles: ["https://assets.example/releases/marseille-test/tiles/{z}/{x}/{y}.pbf"],
    }));
    const clickHandler = map.on.mock.calls.find(([event, layerId]) => event === "click" && layerId === "release-segments-scored")?.[2] as ((event: { features: Array<{ properties: { id: string } }> }) => void) | undefined;
    clickHandler?.({ features: [{ properties: { id: "osm-way-100-0001" } }] });

    expect(await screen.findByRole("heading", { name: "Selected segment: osm-way-100-0001" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("https://assets.example/releases/marseille-test/segment-details/osm-way-100-0001.json");
  });
});
