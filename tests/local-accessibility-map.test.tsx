// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const source = { setData: vi.fn() };
const map = {
  addControl: vi.fn(),
  addLayer: vi.fn(),
  addSource: vi.fn(),
  fitBounds: vi.fn(),
  getCanvas: () => ({ style: {} }),
  getSource: vi.fn(() => source),
  on: vi.fn((event: string, handler: () => void) => { if (event === "load") handler(); }),
  remove: vi.fn(),
};
const Map = vi.fn(function Map() { return map; });

vi.mock("maplibre-gl", () => ({
  LngLatBounds: class {
    extend() { return this; }
  },
  Map,
  NavigationControl: class {},
  ScaleControl: class {},
}));

import { LocalAccessibilityMap } from "../src/components/local-accessibility-map.js";
import { LocalAccessibilityExplorer } from "../src/components/local-accessibility-explorer.js";
import { sampleRelease } from "../src/sample-release.js";

afterEach(() => {
  cleanup();
  Map.mockClear();
  source.setData.mockClear();
  map.addLayer.mockClear();
  map.addSource.mockClear();
  map.fitBounds.mockClear();
  map.getSource.mockClear();
  map.on.mockClear();
  map.remove.mockClear();
});

describe("LocalAccessibilityMap", () => {
  it("updates the existing map source when a provisional condition changes", async () => {
    Object.defineProperty(window, "WebGLRenderingContext", { configurable: true, value: class {} });
    const segments = [{
      id: "marseille-sample-001",
      geometry: { type: "LineString" as const, coordinates: [[5.37, 43.29], [5.3701, 43.29]] as [number, number][] },
      sufficient: true,
      currentCondition: false,
    }];
    const { rerender } = render(
      <LocalAccessibilityMap onSelectSegment={() => undefined} segments={segments} selectedSegmentId="marseille-sample-001" />,
    );

    await waitFor(() => expect(map.addSource).toHaveBeenCalledWith("release-segments", expect.any(Object)));
    rerender(
      <LocalAccessibilityMap
        onSelectSegment={() => undefined}
        segments={[{ ...segments[0]!, currentCondition: true }]}
        selectedSegmentId="marseille-sample-001"
      />,
    );

    await waitFor(() => expect(source.setData).toHaveBeenCalled());
    expect(Map).toHaveBeenCalledTimes(1);
    const data = source.setData.mock.calls.at(-1)?.[0] as { features: Array<{ properties: { currentCondition: boolean } }> };
    expect(data.features[0]!.properties.currentCondition).toBe(true);
  });

  it("updates the live map source after an assigned obstacle submission", async () => {
    Object.defineProperty(window, "WebGLRenderingContext", { configurable: true, value: class {} });
    const user = userEvent.setup();
    render(
      <LocalAccessibilityExplorer
        profileKey="wheelchair"
        release={sampleRelease}
        submitObstacle={async () => ({
          observation: {
            id: "e3fb5738-6797-4ed8-95d5-c45bc4ce789a",
            category: "blocked-path",
            description: "Temporary construction barrier narrows the pavement.",
            latitude: 43.29005,
            longitude: 5.37005,
            observedAt: "2026-10-29",
            recordedAt: "2026-10-29T12:00:00.000Z",
          },
          assignment: {
            status: "assigned",
            segmentId: "marseille-sample-001",
            method: "nearest",
            distanceMetres: 6.2,
            baselineReleaseId: sampleRelease.manifest.releaseId,
            eligibilityRuleVersion: "conservative-pedestrian-network-v1",
          },
          projection: {
            condition: "reported-obstacle",
            label: "Provisional community-derived condition",
            policyVersion: "community-condition-v1",
            baselineReleaseId: sampleRelease.manifest.releaseId,
            segmentId: "marseille-sample-001",
            localInfluenceMetres: 0,
          },
        })}
      />,
    );

    await waitFor(() => expect(map.addSource).toHaveBeenCalledWith("release-segments", expect.any(Object)));
    source.setData.mockClear();
    await user.type(screen.getByLabelText("What did you observe?"), "Temporary construction barrier narrows the pavement.");
    await user.type(screen.getByLabelText("Observed on"), "2026-10-29");
    await user.click(screen.getByRole("button", { name: "Submit obstacle observation" }));

    await waitFor(() => expect(source.setData).toHaveBeenCalled());
    expect(Map).toHaveBeenCalledTimes(1);
    const data = source.setData.mock.calls.at(-1)?.[0] as { features: Array<{ properties: { id: string; currentCondition: boolean } }> };
    expect(data.features.find((feature) => feature.properties.id === "marseille-sample-001")?.properties.currentCondition).toBe(true);
  });
});
