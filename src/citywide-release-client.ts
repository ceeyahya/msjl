import { validateConfig, type ReleaseManifest, type ReleaseSegment, type ReleaseSource } from "./release.js";
import type { LocalAccessibilityConfig } from "./scoring.js";

export interface CitywideRelease {
  baseUrl: string;
  config: LocalAccessibilityConfig;
  manifest: ReleaseManifest;
  sources: ReleaseSource[];
  tileSource: {
    bounds: [number, number, number, number];
    maxzoom: number;
    minzoom: number;
    tiles: string[];
  };
  detailTemplate: string;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/u, "")}/${path}`;
}

async function readJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}: HTTP ${response.status}.`);
  return response.json();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tileSourceFromTileJson(tileJson: Record<string, unknown>, tileJsonUrl: string): CitywideRelease["tileSource"] {
  if (!Array.isArray(tileJson.tiles) || !tileJson.tiles.length || !tileJson.tiles.every((tile) => typeof tile === "string")
    || !Array.isArray(tileJson.bounds) || tileJson.bounds.length !== 4 || !tileJson.bounds.every((coordinate) => typeof coordinate === "number")
    || typeof tileJson.minzoom !== "number" || typeof tileJson.maxzoom !== "number") {
    throw new Error("The citywide release TileJSON is invalid.");
  }

  return {
    bounds: tileJson.bounds as [number, number, number, number],
    maxzoom: tileJson.maxzoom,
    minzoom: tileJson.minzoom,
    // MapLibre does not resolve TileJSON-relative tile paths against its source URL.
    tiles: tileJson.tiles.map((tile) => new URL(tile, tileJsonUrl).toString().replaceAll("%7B", "{").replaceAll("%7D", "}")),
  };
}

export async function loadCitywideRelease(baseUrl: string): Promise<CitywideRelease> {
  const root = baseUrl.replace(/\/$/u, "");
  const manifest = await readJson(joinUrl(root, "manifest.json"));
  if (!isRecord(manifest) || !isRecord(manifest.artifacts) || !isRecord(manifest.artifacts.config) || !isRecord(manifest.artifacts.sources)
    || !isRecord(manifest.artifacts.mapTiles) || !isRecord(manifest.artifacts.segmentDetails)) {
    throw new Error("The citywide release manifest does not declare the required map artifacts.");
  }
  const [config, sources, tileJson, details] = await Promise.all([
    readJson(joinUrl(root, String(manifest.artifacts.config.path))),
    readJson(joinUrl(root, String(manifest.artifacts.sources.path))),
    readJson(joinUrl(root, String(manifest.artifacts.mapTiles.path))),
    readJson(joinUrl(root, String(manifest.artifacts.segmentDetails.path))),
  ]);
  validateConfig(config);
  if (!Array.isArray(sources) || !isRecord(tileJson) || !isRecord(details) || typeof details.template !== "string") {
    throw new Error("The citywide release map artifacts are invalid.");
  }
  const tileJsonUrl = joinUrl(root, String(manifest.artifacts.mapTiles.path));

  return {
    baseUrl: root,
    config,
    manifest: manifest as unknown as ReleaseManifest,
    sources: sources as ReleaseSource[],
    tileSource: tileSourceFromTileJson(tileJson, tileJsonUrl),
    detailTemplate: details.template,
  };
}

export async function loadCitywideSegment(release: CitywideRelease, segmentId: string): Promise<ReleaseSegment> {
  const path = release.detailTemplate.replace("{id}", encodeURIComponent(segmentId));
  const segment = await readJson(joinUrl(release.baseUrl, path));
  if (!isRecord(segment) || typeof segment.id !== "string" || !isRecord(segment.geometry) || segment.geometry.type !== "LineString") {
    throw new Error(`The citywide release detail for ${segmentId} is invalid.`);
  }
  return segment as unknown as ReleaseSegment;
}
