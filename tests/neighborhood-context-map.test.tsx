// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const map = {
  addControl: vi.fn(), addLayer: vi.fn(), addSource: vi.fn(), getCanvas: () => ({ style: {} }),
  on: vi.fn((event: string, ...argumentsList: unknown[]) => { const handler = argumentsList.at(-1); if (event === "load" && typeof handler === "function") handler(); }),
  remove: vi.fn(), setFilter: vi.fn(),
};
const Map = vi.fn(function Map() { return map; });

vi.mock("maplibre-gl", () => ({
  Map,
  NavigationControl: class {},
  ScaleControl: class {},
  setWorkerUrl: vi.fn(),
}));
vi.mock("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url", () => ({ default: "/assets/maplibre-gl-worker.mjs" }));

import { NeighborhoodContextMap } from "../src/components/neighborhood-context-map.js";

const tileSource = { bounds: [5.19, 43.16, 5.61, 43.49] as [number, number, number, number], maxzoom: 13, minzoom: 9, tiles: ["https://assets.example/context/tiles/{z}/{x}/{y}.pbf"] };

afterEach(() => {
  cleanup();
  Map.mockClear();
  map.addLayer.mockClear();
  map.addSource.mockClear();
  map.remove.mockClear();
  map.setFilter.mockClear();
});

describe("NeighborhoodContextMap", () => {
  it("uses Context vector tiles and updates filters without recreating the map", async () => {
    Object.defineProperty(window, "WebGLRenderingContext", { configurable: true, value: class {} });
    const { rerender } = render(<NeighborhoodContextMap evidenceStatus="all" onSelectArea={() => undefined} scoreBand="all" tileSource={tileSource} />);

    await waitFor(() => expect(map.addSource).toHaveBeenCalledWith("context-area-tiles", { type: "vector", ...tileSource }));
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: "context-areas-scored", "source-layer": "areas" }));
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: "context-areas-insufficient", "source-layer": "areas" }));

    rerender(<NeighborhoodContextMap evidenceStatus="scored" onSelectArea={() => undefined} scoreBand="high" tileSource={tileSource} />);
    await waitFor(() => expect(map.setFilter).toHaveBeenCalledWith("context-areas-scored", ["all", ["==", ["get", "sufficient"], true], [">=", ["get", "score"], 0.75]]));
    expect(Map).toHaveBeenCalledTimes(1);
  });
});
