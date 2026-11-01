import { validateConfig, type ReleaseManifest, type ReleaseSegment, type ReleaseSource } from "./release.js";
import type { LocalAccessibilityConfig } from "./scoring.js";
import { segmentDetailShard } from "./segment-detail-shard.js";

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
  detailShardCount: number;
  detailTemplate: string;
}

export interface CitywideSegmentSummary {
  id: string;
  profiles: Record<string, { score: number | null; sufficient: boolean }>;
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

function resolveHttpUrl(value: string, baseUrl?: string): string {
  let url: URL;
  try {
    url = new URL(value, baseUrl ?? (typeof window === "undefined" ? "http://localhost/" : window.location.href));
  } catch {
    throw new Error("The citywide release pointer contains an invalid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The citywide release pointer URL must use HTTP or HTTPS.");
  }
  return url.toString();
}

export async function loadCitywideReleaseFromPointer(pointerUrl: string): Promise<CitywideRelease> {
  const resolvedPointerUrl = resolveHttpUrl(pointerUrl);
  const pointer = await readJson(resolvedPointerUrl);
  if (!isRecord(pointer) || pointer.schemaVersion !== 1 || typeof pointer.releaseId !== "string" || !pointer.releaseId.trim()
    || typeof pointer.baseUrl !== "string" || !pointer.baseUrl.trim()) {
    throw new Error("The citywide release pointer is invalid.");
  }

  return loadCitywideRelease(resolveHttpUrl(pointer.baseUrl, resolvedPointerUrl), pointer.releaseId);
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

export async function loadCitywideRelease(baseUrl: string, expectedReleaseId?: string): Promise<CitywideRelease> {
  const root = baseUrl.replace(/\/$/u, "");
  const manifest = await readJson(joinUrl(root, "manifest.json"));
  if (!isRecord(manifest) || !isRecord(manifest.artifacts) || !isRecord(manifest.artifacts.config) || !isRecord(manifest.artifacts.sources)
    || !isRecord(manifest.artifacts.mapTiles) || !isRecord(manifest.artifacts.segmentDetails)) {
    throw new Error("The citywide release manifest does not declare the required map artifacts.");
  }
  if (expectedReleaseId && manifest.releaseId !== expectedReleaseId) {
    throw new Error("The citywide release pointer does not match the referenced release manifest.");
  }
  const [config, sources, tileJson, details] = await Promise.all([
    readJson(joinUrl(root, String(manifest.artifacts.config.path))),
    readJson(joinUrl(root, String(manifest.artifacts.sources.path))),
    readJson(joinUrl(root, String(manifest.artifacts.mapTiles.path))),
    readJson(joinUrl(root, String(manifest.artifacts.segmentDetails.path))),
  ]);
  validateConfig(config);
  if (!Array.isArray(sources) || !isRecord(tileJson) || !isRecord(details) || typeof details.template !== "string"
    || typeof details.shardCount !== "number" || !Number.isInteger(details.shardCount) || details.shardCount <= 0) {
    throw new Error("The citywide release map artifacts are invalid.");
  }
  const tileJsonUrl = joinUrl(root, String(manifest.artifacts.mapTiles.path));

  return {
    baseUrl: root,
    config,
    manifest: manifest as unknown as ReleaseManifest,
    sources: sources as ReleaseSource[],
    tileSource: tileSourceFromTileJson(tileJson, tileJsonUrl),
    detailShardCount: details.shardCount,
    detailTemplate: details.template,
  };
}

export async function loadCitywideSegment(release: CitywideRelease, segmentId: string): Promise<ReleaseSegment> {
  const shard = segmentDetailShard(segmentId);
  if (Number.parseInt(shard, 16) >= release.detailShardCount) throw new Error("The citywide release detail shard is invalid.");
  const path = release.detailTemplate.replace("{shard}", shard);
  const details = await readJson(joinUrl(release.baseUrl, path));
  const segment = isRecord(details) ? details[segmentId] : undefined;
  if (!isRecord(segment) || typeof segment.id !== "string" || !isRecord(segment.geometry) || segment.geometry.type !== "LineString") {
    throw new Error(`The citywide release detail for ${segmentId} is invalid.`);
  }
  return segment as unknown as ReleaseSegment;
}

function segmentSummariesFrom(value: unknown, profileKeys: readonly string[]): CitywideSegmentSummary[] {
  const segments = isRecord(value) && value.schemaVersion === 1 && Array.isArray(value.segments)
    ? value.segments
    : isRecord(value) && value.type === "FeatureCollection" && Array.isArray(value.features)
      ? value.features.map((feature) => isRecord(feature) ? feature.properties : undefined)
      : undefined;
  if (!segments) throw new Error("The citywide release segment index is invalid.");

  return segments.map((segment): CitywideSegmentSummary => {
    if (!isRecord(segment) || typeof segment.id !== "string" || !isRecord(segment.profiles)) {
      throw new Error("The citywide release segment index is invalid.");
    }
    const profileValues: Record<string, unknown> = segment.profiles;
    const profiles = Object.fromEntries(profileKeys.map((profileKey) => {
      const profile = profileValues[profileKey];
      if (!isRecord(profile) || typeof profile.sufficient !== "boolean" || (profile.score !== null && (typeof profile.score !== "number" || !Number.isFinite(profile.score) || profile.score < 0 || profile.score > 1))) {
        throw new Error("The citywide release segment index is invalid.");
      }
      return [profileKey, { score: profile.score as number | null, sufficient: profile.sufficient }];
    }));
    return { id: segment.id, profiles };
  });
}

export async function loadCitywideSegmentIndex(release: CitywideRelease): Promise<CitywideSegmentSummary[]> {
  const artifact = release.manifest.artifacts.segmentIndex ?? release.manifest.artifacts.mapSegments;
  if (!artifact) throw new Error("The citywide release does not provide a segment index for non-map exploration.");
  const value = await readJson(joinUrl(release.baseUrl, artifact.path));
  return segmentSummariesFrom(value, Object.keys(release.config.profiles));
}
