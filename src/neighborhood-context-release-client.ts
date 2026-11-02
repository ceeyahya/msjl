import {
  validateNeighborhoodContextConfig,
  type ContextArea,
  type ContextManifest,
  type ContextSource,
  type NeighborhoodContextConfig,
} from "./neighborhood-context.js";
import { segmentDetailShard } from "./segment-detail-shard.js";

export interface NeighborhoodContextReleaseClient {
  baseUrl: string;
  config: NeighborhoodContextConfig;
  manifest: ContextManifest;
  sources: ContextSource[];
  tileSource: { bounds: [number, number, number, number]; maxzoom: number; minzoom: number; tiles: string[] };
  detailShardCount: number;
  detailTemplate: string;
}

export interface ContextAreaSummary {
  id: string;
  name: string;
  score: number | null;
  sufficient: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const joinUrl = (baseUrl: string, path: string) => `${baseUrl.replace(/\/$/u, "")}/${path}`;

async function readJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}: HTTP ${response.status}.`);
  return response.json();
}

function resolveHttpUrl(value: string, baseUrl?: string): string {
  let url: URL;
  try { url = new URL(value, baseUrl ?? (typeof window === "undefined" ? "http://localhost/" : window.location.href)); } catch { throw new Error("The Neighborhood Context release pointer contains an invalid URL."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("The Neighborhood Context release pointer URL must use HTTP or HTTPS.");
  return url.toString();
}

function tileSourceFrom(value: unknown, tileJsonUrl: string): NeighborhoodContextReleaseClient["tileSource"] {
  if (!isRecord(value) || !Array.isArray(value.tiles) || !value.tiles.length || !value.tiles.every((tile) => typeof tile === "string")
    || !Array.isArray(value.bounds) || value.bounds.length !== 4 || !value.bounds.every((coordinate) => typeof coordinate === "number")
    || typeof value.minzoom !== "number" || typeof value.maxzoom !== "number") throw new Error("The Neighborhood Context TileJSON is invalid.");
  return {
    bounds: value.bounds as [number, number, number, number], minzoom: value.minzoom, maxzoom: value.maxzoom,
    tiles: value.tiles.map((tile) => new URL(tile, tileJsonUrl).toString().replaceAll("%7B", "{").replaceAll("%7D", "}")),
  };
}

export async function loadNeighborhoodContextReleaseFromPointer(pointerUrl: string): Promise<NeighborhoodContextReleaseClient> {
  const resolvedPointerUrl = resolveHttpUrl(pointerUrl);
  const pointer = await readJson(resolvedPointerUrl);
  if (!isRecord(pointer) || pointer.schemaVersion !== 1 || typeof pointer.releaseId !== "string" || !pointer.releaseId.trim() || typeof pointer.baseUrl !== "string" || !pointer.baseUrl.trim()) {
    throw new Error("The Neighborhood Context release pointer is invalid.");
  }
  return loadNeighborhoodContextRelease(resolveHttpUrl(pointer.baseUrl, resolvedPointerUrl), pointer.releaseId);
}

export async function loadNeighborhoodContextRelease(baseUrl: string, expectedReleaseId?: string): Promise<NeighborhoodContextReleaseClient> {
  const root = baseUrl.replace(/\/$/u, "");
  const manifest = await readJson(joinUrl(root, "manifest.json"));
  if (!isRecord(manifest) || !isRecord(manifest.artifacts) || !isRecord(manifest.artifacts.config) || !isRecord(manifest.artifacts.sources)
    || !isRecord(manifest.artifacts.mapTiles) || !isRecord(manifest.artifacts.areaDetails) || !isRecord(manifest.artifacts.areaIndex)) {
    throw new Error("The Neighborhood Context manifest does not declare the required map artifacts.");
  }
  for (const name of ["config", "sources", "areas", "mapTiles", "areaDetails", "areaIndex"] as const) {
    const artifact = manifest.artifacts[name];
    if (!isRecord(artifact) || typeof artifact.path !== "string" || typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(artifact.sha256)) throw new Error("The Neighborhood Context manifest is invalid.");
  }
  if (expectedReleaseId && manifest.releaseId !== expectedReleaseId) throw new Error("The Neighborhood Context pointer does not match the referenced release manifest.");
  const [config, sources, tileJson, details] = await Promise.all([
    readJson(joinUrl(root, String(manifest.artifacts.config.path))), readJson(joinUrl(root, String(manifest.artifacts.sources.path))),
    readJson(joinUrl(root, String(manifest.artifacts.mapTiles.path))), readJson(joinUrl(root, String(manifest.artifacts.areaDetails.path))),
  ]);
  validateNeighborhoodContextConfig(config);
  if (!Array.isArray(sources) || sources.length < 6 || !sources.every((source) => isRecord(source) && typeof source.id === "string" && typeof source.name === "string" && typeof source.version === "string" && typeof source.licence === "string" && typeof source.path === "string" && typeof source.url === "string" && typeof source.retrievedAt === "string" && typeof source.sha256 === "string" && /^[a-f0-9]{64}$/u.test(source.sha256)) || !isRecord(details) || typeof details.template !== "string" || typeof details.shardCount !== "number" || !Number.isInteger(details.shardCount) || details.shardCount <= 0) {
    throw new Error("The Neighborhood Context map artifacts are invalid.");
  }
  const sourceIds = new Set(sources.map((source) => (source as { id: string }).id));
  if (["iris-boundaries", "filosofi", "rtm-gtfs", "civic-services", "population-grid", "osm-pedestrian-network"].some((id) => !sourceIds.has(id))) throw new Error("The Neighborhood Context source provenance is incomplete.");
  return { baseUrl: root, config, manifest: manifest as unknown as ContextManifest, sources: sources as ContextSource[], tileSource: tileSourceFrom(tileJson, joinUrl(root, String(manifest.artifacts.mapTiles.path))), detailShardCount: details.shardCount, detailTemplate: details.template };
}

export async function loadNeighborhoodContextAreaIndex(release: NeighborhoodContextReleaseClient): Promise<ContextAreaSummary[]> {
  const value = await readJson(joinUrl(release.baseUrl, release.manifest.artifacts.areaIndex.path));
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.areas)) throw new Error("The Neighborhood Context area index is invalid.");
  return value.areas.map((area): ContextAreaSummary => {
    if (!isRecord(area) || typeof area.id !== "string" || typeof area.name !== "string" || typeof area.sufficient !== "boolean"
      || (area.score !== null && (typeof area.score !== "number" || !Number.isFinite(area.score) || area.score < 0 || area.score > 1))) throw new Error("The Neighborhood Context area index is invalid.");
    if (area.sufficient !== (area.score !== null)) throw new Error("The Neighborhood Context area index is invalid.");
    return { id: area.id, name: area.name, score: area.score as number | null, sufficient: area.sufficient };
  });
}

export async function loadNeighborhoodContextArea(release: NeighborhoodContextReleaseClient, areaId: string): Promise<ContextArea> {
  const shard = segmentDetailShard(areaId);
  if (Number.parseInt(shard, 16) >= release.detailShardCount) throw new Error("The Neighborhood Context detail shard is invalid.");
  const details = await readJson(joinUrl(release.baseUrl, release.detailTemplate.replace("{shard}", shard)));
  const area = isRecord(details) ? details[areaId] : undefined;
  if (!isRecord(area) || area.id !== areaId || !isRecord(area.geometry) || (area.geometry.type !== "Polygon" && area.geometry.type !== "MultiPolygon") || !isRecord(area.population) || typeof area.population.networkResolvedShare !== "number" || typeof area.population.imputedShare !== "number" || !isRecord(area.indicators)) {
    throw new Error(`The Neighborhood Context detail for ${areaId} is invalid.`);
  }
  return area as unknown as ContextArea;
}
