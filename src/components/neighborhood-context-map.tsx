import { useEffect, useRef } from "react";
import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";

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

function filters(scoreBand: "all" | "high" | "medium" | "low", evidenceStatus: "all" | "scored" | "insufficient") {
  const scored = ["==", ["get", "sufficient"], true];
  const insufficient = ["!=", ["get", "sufficient"], true];
  if (evidenceStatus === "insufficient") return { scored: ["all", scored, ["!=", ["get", "sufficient"], true]], insufficient };
  if (evidenceStatus === "scored" && scoreBand === "all") return { scored, insufficient: ["all", insufficient, ["==", ["get", "sufficient"], true]] };
  if (evidenceStatus === "scored" || scoreBand !== "all") {
    const band = scoreBand === "high" ? [">=", ["get", "score"], 0.75]
      : scoreBand === "medium" ? ["all", [">=", ["get", "score"], 0.5], ["<", ["get", "score"], 0.75]]
        : scoreBand === "low" ? ["<", ["get", "score"], 0.5] : [];
    return { scored: band.length ? ["all", scored, band] : scored, insufficient: ["all", insufficient, ["==", ["get", "sufficient"], true]] };
  }
  return { scored, insufficient };
}

export function NeighborhoodContextMap({
  evidenceStatus,
  onSelectArea,
  scoreBand,
  tileSource,
}: {
  evidenceStatus: "all" | "scored" | "insufficient";
  onSelectArea: (areaId: string) => void;
  scoreBand: "all" | "high" | "medium" | "low";
  tileSource: { bounds: [number, number, number, number]; maxzoom: number; minzoom: number; tiles: string[] };
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const onSelectAreaRef = useRef(onSelectArea);
  const filterRef = useRef(filters(scoreBand, evidenceStatus));
  const tileSourceKey = JSON.stringify(tileSource);

  useEffect(() => { onSelectAreaRef.current = onSelectArea; }, [onSelectArea]);
  useEffect(() => {
    const next = filters(scoreBand, evidenceStatus);
    filterRef.current = next;
    map.current?.setFilter("context-areas-scored", next.scored as never);
    map.current?.setFilter("context-areas-insufficient", next.insufficient as never);
  }, [evidenceStatus, scoreBand]);

  useEffect(() => {
    if (!container.current || map.current || !("WebGLRenderingContext" in window)) return;
    let cancelled = false;
    void Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url")]).then(([maplibregl, { default: workerUrl }]) => {
      if (cancelled || !container.current) return;
      maplibregl.setWorkerUrl(workerUrl);
      const instance = new maplibregl.Map({ attributionControl: { compact: false }, center: [5.42, 43.32], container: container.current, style: basemapStyle, zoom: 11 });
      map.current = instance;
      instance.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
      instance.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
      instance.on("load", () => {
        if (cancelled) return;
        instance.addSource("context-area-tiles", { type: "vector", ...tileSource });
        instance.addLayer({ id: "context-areas-scored", type: "fill", source: "context-area-tiles", "source-layer": "areas", filter: filterRef.current.scored as never, paint: { "fill-color": ["interpolate", ["linear"], ["get", "score"], 0, "#9f1239", 0.5, "#d97706", 1, "#0f766e"] as never, "fill-opacity": 0.55 } });
        instance.addLayer({ id: "context-areas-insufficient", type: "fill", source: "context-area-tiles", "source-layer": "areas", filter: filterRef.current.insufficient as never, paint: { "fill-color": "#52525b", "fill-opacity": 0.25 } });
        for (const layerId of ["context-areas-scored", "context-areas-insufficient"]) {
          instance.on("click", layerId, (event) => {
            const areaId = event.features?.[0]?.properties?.id;
            if (typeof areaId === "string") onSelectAreaRef.current(areaId);
          });
          instance.on("mouseenter", layerId, () => { instance.getCanvas().style.cursor = "pointer"; });
          instance.on("mouseleave", layerId, () => { instance.getCanvas().style.cursor = ""; });
        }
      });
    });
    return () => { cancelled = true; map.current?.remove(); map.current = null; };
  }, [tileSourceKey]);

  return <div aria-label="Neighborhood Context map. Use the IRIS results list to select an area without the map." className="h-[36rem] overflow-hidden rounded-lg border" ref={container} />;
}
