import { useEffect, useRef } from "react";
import type { GeoJSONSource, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import type { FeatureCollection, LineString } from "geojson";

import type { ReleaseSegment } from "../release.js";

const basemapStyle: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png", "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

function conditionFeatures(segments: ReleaseSegment[]): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: segments.map((segment) => ({ type: "Feature", properties: { id: segment.id }, geometry: segment.geometry })),
  };
}

export function CitywideLocalAccessibilityMap({
  conditionSegments,
  onSelectSegment,
  profileKey,
  tileSource,
}: {
  conditionSegments: ReleaseSegment[];
  onSelectSegment: (segmentId: string) => void;
  profileKey: string;
  tileSource: {
    bounds: [number, number, number, number];
    maxzoom: number;
    minzoom: number;
    tiles: string[];
  };
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const onSelectSegmentRef = useRef(onSelectSegment);
  const conditionSegmentsRef = useRef(conditionSegments);
  const tileSourceKey = JSON.stringify(tileSource);

  useEffect(() => { onSelectSegmentRef.current = onSelectSegment; }, [onSelectSegment]);
  useEffect(() => { conditionSegmentsRef.current = conditionSegments; }, [conditionSegments]);

  useEffect(() => {
    if (!container.current || map.current || !("WebGLRenderingContext" in window)) return;
    let cancelled = false;
    void Promise.all([
      import("maplibre-gl"),
      import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"),
    ]).then(([maplibregl, { default: workerUrl }]) => {
      if (cancelled || !container.current) return;
      // Vite must bundle the MapLibre worker explicitly or vector tiles cannot decode.
      maplibregl.setWorkerUrl(workerUrl);
      const instance = new maplibregl.Map({
        attributionControl: { compact: false },
        center: [5.42, 43.32],
        container: container.current,
        style: basemapStyle,
        zoom: 11,
      });
      map.current = instance;
      instance.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
      instance.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
      instance.on("load", () => {
        if (cancelled) return;
        const sufficient = `${profileKey}Sufficient`;
        const score = `${profileKey}Score`;
        instance.addSource("release-segment-tiles", { type: "vector", ...tileSource });
        instance.addLayer({
          id: "release-segments-scored",
          type: "line",
          source: "release-segment-tiles",
          "source-layer": "segments",
          filter: ["==", ["get", sufficient], true],
          paint: {
            "line-color": ["interpolate", ["linear"], ["get", score], 0, "#9f1239", 0.5, "#d97706", 1, "#0f766e"],
            "line-width": 2.5,
          },
        });
        instance.addLayer({
          id: "release-segments-insufficient",
          type: "line",
          source: "release-segment-tiles",
          "source-layer": "segments",
          filter: ["!=", ["get", sufficient], true],
          paint: { "line-color": "#52525b", "line-dasharray": [2, 2], "line-width": 2 },
        });
        instance.addSource("current-conditions", { type: "geojson", data: conditionFeatures(conditionSegmentsRef.current) });
        instance.addLayer({
          id: "release-segments-current-condition",
          type: "line",
          source: "current-conditions",
          paint: { "line-color": "#b45309", "line-dasharray": [1, 1], "line-width": 5 },
        });
        for (const layerId of ["release-segments-scored", "release-segments-insufficient"]) {
          instance.on("click", layerId, (event) => {
            const segmentId = event.features?.[0]?.properties?.id;
            if (typeof segmentId === "string") onSelectSegmentRef.current(segmentId);
          });
          instance.on("mouseenter", layerId, () => { instance.getCanvas().style.cursor = "pointer"; });
          instance.on("mouseleave", layerId, () => { instance.getCanvas().style.cursor = ""; });
        }
      });
    });
    return () => { cancelled = true; map.current?.remove(); map.current = null; };
  }, [profileKey, tileSourceKey]);

  useEffect(() => {
    const source = map.current?.getSource("current-conditions") as GeoJSONSource | undefined;
    if (source) source.setData(conditionFeatures(conditionSegments));
  }, [conditionSegments]);

  return <div aria-label="Interactive map of citywide Local Accessibility segments. Select a segment to inspect its baseline evidence." className="h-[36rem] overflow-hidden rounded-lg border" ref={container} role="application" />;
}
