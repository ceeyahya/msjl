import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { Geometry } from "geojson";

import {
  deriveNeighborhoodContextResult,
  validateNeighborhoodContextConfig,
  validateNeighborhoodContextRelease,
  type ContextArea,
  type ContextArtifact,
  type ContextSource,
  type NeighborhoodContextConfig,
} from "../src/neighborhood-context.js";
import { segmentDetailShard, segmentDetailShardCount } from "../src/segment-detail-shard.js";

type Arguments = Record<string, string>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const checksum = (content: string | Uint8Array) => createHash("sha256").update(content).digest("hex");

function parseArguments(argumentsList: string[]): Arguments {
  const result: Arguments = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("Usage: npm run build-neighborhood-context-release -- --areas <iris.geojson> --config <context-policy.json> --sources <sources.json> --source-directory <directory> --output <directory> --release-id <id> --built-at <ISO date>");
    }
    result[key.slice(2)] = value;
  }
  return result;
}

async function writeArtifact(directory: string, path: string, value: unknown): Promise<ContextArtifact> {
  const content = json(value);
  await writeFile(join(directory, path), content);
  return { path, sha256: checksum(content) };
}

function areasFromGeoJson(value: unknown): ContextArea[] {
  if (!isRecord(value) || value.type !== "FeatureCollection" || !Array.isArray(value.features)) throw new Error("Context areas input must be a GeoJSON FeatureCollection.");
  return value.features.map((feature): ContextArea => {
    if (!isRecord(feature) || !isRecord(feature.properties) || !isRecord(feature.geometry)) throw new Error("Each Context area requires GeoJSON properties and geometry.");
    const properties = feature.properties;
    return {
      id: String(properties.id ?? ""),
      name: String(properties.name ?? ""),
      geometry: { type: feature.geometry.type as ContextArea["geometry"]["type"], coordinates: feature.geometry.coordinates },
      population: properties.population as ContextArea["population"],
      indicators: properties.indicators as ContextArea["indicators"],
    };
  });
}

async function verifySourceFiles(directory: string, sources: ContextSource[]): Promise<void> {
  for (const source of sources) {
    const path = resolve(directory, source.path);
    if (relative(directory, path).startsWith("..")) throw new Error(`Source path escapes its source directory: ${source.path}`);
    if (checksum(await readFile(path)) !== source.sha256) throw new Error(`Source checksum does not match ${source.id}.`);
  }
}

function featureCollection(areas: readonly ContextArea[]) {
  return {
    type: "FeatureCollection",
    features: areas.map((area) => ({ type: "Feature", properties: { ...area, geometry: undefined }, geometry: area.geometry })),
  };
}

function summary(area: ContextArea, config: NeighborhoodContextConfig) {
  const result = deriveNeighborhoodContextResult(area, config);
  return { id: area.id, name: area.name, score: result.score ?? null, sufficient: result.available };
}

function positions(value: unknown): [number, number][] {
  if (!Array.isArray(value)) return [];
  if (value.length === 2 && value.every((coordinate) => typeof coordinate === "number")) return [value as [number, number]];
  return value.flatMap(positions);
}

function tileCoordinate([longitude, latitude]: [number, number], zoom: number): [number, number] {
  const scale = 2 ** zoom;
  const latitudeRadians = latitude * Math.PI / 180;
  return [Math.floor((longitude + 180) / 360 * scale), Math.floor((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2 * scale)];
}

async function writeMapTiles(directory: string, areas: readonly ContextArea[], config: NeighborhoodContextConfig): Promise<ContextArtifact> {
  const [{ default: geojsonvt }, { default: vtpbf }] = await Promise.all([import("geojson-vt"), import("vt-pbf")]);
  const features = areas.map((area) => {
    const result = deriveNeighborhoodContextResult(area, config);
    return { type: "Feature" as const, properties: { id: area.id, score: result.score ?? -1, sufficient: result.available }, geometry: area.geometry as Geometry };
  });
  const index = new geojsonvt({ type: "FeatureCollection", features }, { indexMaxPoints: 0, maxZoom: 13, promoteId: "id", tolerance: 2 });
  const allPositions = areas.flatMap((area) => positions(area.geometry.coordinates));
  const files: Record<string, string> = {};
  const bounds: [number, number, number, number] = [
    Math.min(...allPositions.map(([longitude]) => longitude)), Math.min(...allPositions.map(([, latitude]) => latitude)),
    Math.max(...allPositions.map(([longitude]) => longitude)), Math.max(...allPositions.map(([, latitude]) => latitude)),
  ];
  for (let zoom = 9; zoom <= 13; zoom += 1) {
    const [minimumX, maximumY] = tileCoordinate([bounds[0], bounds[1]], zoom);
    const [maximumX, minimumY] = tileCoordinate([bounds[2], bounds[3]], zoom);
    for (let x = minimumX; x <= maximumX; x += 1) for (let y = minimumY; y <= maximumY; y += 1) {
      const tile = index.getTile(zoom, x, y);
      if (!tile || tile.features.length === 0) continue;
      const tileDirectory = join(directory, "tiles", String(zoom), String(x));
      await mkdir(tileDirectory, { recursive: true });
      const path = `tiles/${zoom}/${x}/${y}.pbf`;
      const body = vtpbf.fromGeojsonVt({ areas: tile });
      await writeFile(join(directory, path), body);
      files[path] = checksum(body);
    }
  }
  return writeArtifact(directory, "tiles.json", {
    tilejson: "3.0.0", bounds, minzoom: 9, maxzoom: 13, tiles: ["tiles/{z}/{x}/{y}.pbf"], vector_layers: [{ id: "areas", fields: { id: "String", score: "Number", sufficient: "Boolean" } }], files,
  });
}

async function writeAreaDetails(directory: string, areas: readonly ContextArea[]): Promise<ContextArtifact> {
  const detailsDirectory = join(directory, "area-details");
  await mkdir(detailsDirectory, { recursive: true });
  const shards = Array.from({ length: segmentDetailShardCount }, () => ({} as Record<string, ContextArea>));
  for (const area of areas) shards[Number.parseInt(segmentDetailShard(area.id), 16)]![area.id] = area;
  const files = Object.fromEntries(shards.map((shard, index) => {
    const path = `area-details/${index.toString(16).padStart(2, "0")}.json`;
    return [path, json(shard)];
  }));
  await Promise.all(Object.entries(files).map(([path, content]) => writeFile(join(directory, path), content)));
  return writeArtifact(directory, "area-details.json", { shardCount: segmentDetailShardCount, template: "area-details/{shard}.json", files: Object.fromEntries(Object.entries(files).map(([path, content]) => [path, checksum(content)])) });
}

const args = parseArguments(process.argv.slice(2));
const areasPath = args.areas;
const configPath = args.config;
const sourcesPath = args.sources;
const sourceDirectory = args["source-directory"];
const outputPath = args.output;
const releaseId = args["release-id"];
const builtAt = args["built-at"];
if (!areasPath || !configPath || !sourcesPath || !sourceDirectory || !outputPath || !releaseId || !builtAt || Number.isNaN(Date.parse(builtAt))) {
  throw new Error("The areas, config, sources, source-directory, output, release-id, and ISO built-at arguments are required.");
}
const config: unknown = JSON.parse(await readFile(resolve(configPath), "utf8"));
const sources: unknown = JSON.parse(await readFile(resolve(sourcesPath), "utf8"));
validateNeighborhoodContextConfig(config);
await verifySourceFiles(resolve(sourceDirectory), sources as ContextSource[]);
const areas = areasFromGeoJson(JSON.parse(await readFile(resolve(areasPath), "utf8")));
const outputDirectory = resolve(outputPath);
await mkdir(outputDirectory, { recursive: true });
const mapTiles = await writeMapTiles(outputDirectory, areas, config);
const artifacts = {
  config: await writeArtifact(outputDirectory, "config.json", config),
  sources: await writeArtifact(outputDirectory, "sources.json", sources),
  areas: await writeArtifact(outputDirectory, "areas.geojson", featureCollection(areas)),
  mapTiles,
  areaDetails: await writeAreaDetails(outputDirectory, areas),
  areaIndex: await writeArtifact(outputDirectory, "area-index.json", { schemaVersion: 1, areas: areas.map((area) => summary(area, config)) }),
};
const manifest = { schemaVersion: 1 as const, releaseId, builtAt, policyId: "context-policy-v1" as const, artifacts };
validateNeighborhoodContextRelease({ manifest, config, sources: sources as ContextSource[], areas });
await writeFile(join(outputDirectory, "manifest.json"), json(manifest));
console.log(`Built ${releaseId}: ${areas.length} IRIS areas.`);
