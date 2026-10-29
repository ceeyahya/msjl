import { useEffect, useRef } from "react";
import type { GeoJSONSource, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import type { FeatureCollection, LineString } from "geojson";

import type { ReleaseSegment } from "../release.js";

interface MapSegment {
  id: string;
  geometry: ReleaseSegment["geometry"];
  sufficient: boolean;
  currentCondition: boolean;
}

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

function segmentFeatures(segments: MapSegment[], selectedSegmentId: string): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: segments.map((segment) => ({
      type: "Feature",
      properties: {
        id: segment.id,
        selected: segment.id === selectedSegmentId,
        sufficient: segment.sufficient,
        currentCondition: segment.currentCondition,
      },
      geometry: segment.geometry,
    })),
  };
}

function fitToSegments(map: MapLibreMap, segments: MapSegment[], maplibregl: typeof import("maplibre-gl")) {
  const coordinates = segments.flatMap((segment) => segment.geometry.coordinates);
  const first = coordinates[0];
  if (!first) return;

  const bounds = coordinates.slice(1).reduce(
    (currentBounds, coordinate) => currentBounds.extend(coordinate),
    new maplibregl.LngLatBounds(first, first),
  );

  map.fitBounds(bounds, { duration: 0, maxZoom: 17, padding: 72 });
}

export function LocalAccessibilityMap({
  onSelectSegment,
  segments,
  selectedSegmentId,
}: {
  onSelectSegment: (segmentId: string) => void;
  segments: MapSegment[];
  selectedSegmentId: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const onSelectSegmentRef = useRef(onSelectSegment);
  const selectedSegmentIdRef = useRef(selectedSegmentId);
  const segmentsRef = useRef(segments);

  useEffect(() => {
    onSelectSegmentRef.current = onSelectSegment;
  }, [onSelectSegment]);

  useEffect(() => {
    selectedSegmentIdRef.current = selectedSegmentId;
  }, [selectedSegmentId]);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    if (!container.current || map.current || !("WebGLRenderingContext" in window)) return;

    let cancelled = false;

    void import("maplibre-gl").then((maplibregl) => {
      if (cancelled || !container.current) return;

      const instance = new maplibregl.Map({
        attributionControl: { compact: false },
        center: segmentsRef.current[0]?.geometry.coordinates[0] ?? [5.3698, 43.2951],
        container: container.current,
        style: basemapStyle,
        zoom: 15,
      });
      map.current = instance;

      instance.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
      instance.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

      instance.on("load", () => {
        if (cancelled) return;

        instance.addSource("release-segments", { type: "geojson", data: segmentFeatures(segmentsRef.current, selectedSegmentIdRef.current) });
        instance.addLayer({
          id: "release-segments-scored",
          type: "line",
          source: "release-segments",
          filter: ["get", "sufficient"],
          paint: {
            "line-color": "#0f766e",
            "line-width": ["case", ["get", "selected"], 9, 6],
          },
        });
        instance.addLayer({
          id: "release-segments-insufficient",
          type: "line",
          source: "release-segments",
          filter: ["!", ["get", "sufficient"]],
          paint: {
            "line-color": "#52525b",
            "line-dasharray": [2, 2],
            "line-width": ["case", ["get", "selected"], 9, 6],
          },
        });

        instance.addLayer({
          id: "release-segments-current-condition",
          type: "line",
          source: "release-segments",
          filter: ["get", "currentCondition"],
          paint: {
            "line-color": "#b45309",
            "line-dasharray": [1, 1],
            "line-width": ["case", ["get", "selected"], 12, 9],
          },
        });
        instance.addLayer({
          id: "release-segments-current-condition-label",
          type: "symbol",
          source: "release-segments",
          filter: ["get", "currentCondition"],
          layout: {
            "symbol-placement": "line",
            "text-field": "Provisional condition",
            "text-size": 12,
          },
          paint: {
            "text-color": "#78350f",
            "text-halo-color": "#fffbeb",
            "text-halo-width": 2,
          },
        });

        for (const layerId of ["release-segments-scored", "release-segments-insufficient", "release-segments-current-condition", "release-segments-current-condition-label"]) {
          instance.on("click", layerId, (event) => {
            const segmentId = event.features?.[0]?.properties?.id;
            if (typeof segmentId === "string") onSelectSegmentRef.current(segmentId);
          });
          instance.on("mouseenter", layerId, () => { instance.getCanvas().style.cursor = "pointer"; });
          instance.on("mouseleave", layerId, () => { instance.getCanvas().style.cursor = ""; });
        }

        fitToSegments(instance, segmentsRef.current, maplibregl);
      });
    });

    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const source = map.current?.getSource("release-segments") as GeoJSONSource | undefined;
    if (source) source.setData(segmentFeatures(segments, selectedSegmentId));
  }, [segments, selectedSegmentId]);

  return (
    <div
      aria-label="Interactive map of sample Marseille segments. The same segment data is available in the Segment explorer."
      className="h-96 overflow-hidden rounded-lg border"
      ref={container}
      role="application"
    />
  );
}
