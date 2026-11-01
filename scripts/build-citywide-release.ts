import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { buildCitywideSegments, type OsmElement } from "../src/citywide-release.js";
import { validateConfig, validateRelease, type ReleaseArtifact, type ReleaseSource } from "../src/release.js";
import { scoreSegment, type LocalAccessibilityConfig } from "../src/scoring.js";
import { segmentDetailShard, segmentDetailShardCount } from "../src/segment-detail-shard.js";

type Arguments = Record<string, string>;

function parseArguments(argumentsList: string[]): Arguments {
  const result: Arguments = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("Usage: npm run build-citywide-release -- --input <osm.json> --config <config.json> --output <directory> --release-id <id> --built-at <ISO date>");
    }
    result[key.slice(2)] = value;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tagsFrom(value: unknown): Record<string, string | undefined> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function osmElementsFrom(value: unknown): OsmElement[] {
  if (!isRecord(value) || !Array.isArray(value.elements)) throw new Error("OSM input must be an Overpass JSON response with an elements array.");

  return value.elements.flatMap((element): OsmElement[] => {
    if (!isRecord(element) || typeof element.id !== "number") return [];
    if (element.type === "node" && typeof element.lat === "number" && typeof element.lon === "number") {
      return [{ type: "node", id: element.id, lat: element.lat, lon: element.lon, tags: tagsFrom(element.tags) }];
    }
    if (element.type === "way" && Array.isArray(element.nodes) && element.nodes.every((node) => typeof node === "number")) {
      return [{ type: "way", id: element.id, nodes: element.nodes, tags: tagsFrom(element.tags) }];
    }
    return [];
  });
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function checksum(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function writeArtifact(directory: string, path: string, value: unknown): Promise<ReleaseArtifact> {
  const content = json(value);
  await writeFile(join(directory, path), content);
  return { path, sha256: checksum(content) };
}

function mapArtifacts(segments: ReturnType<typeof buildCitywideSegments>, config: LocalAccessibilityConfig) {
  const summaries = segments.map((segment) => ({
    id: segment.id,
    geometry: segment.geometry,
    profiles: Object.fromEntries(Object.keys(config.profiles).map((profileKey) => {
      const profile = scoreSegment(segment, config, profileKey).profile;
      return [profileKey, { coverage: profile.coverage, score: profile.score ?? null, sufficient: profile.sufficient }];
    })),
  }));
  return {
    mapSegments: {
      type: "FeatureCollection",
      features: summaries.map(({ id, geometry, profiles }) => ({ type: "Feature", properties: { id, profiles }, geometry })),
    },
    segmentIndex: {
      schemaVersion: 1,
      segments: summaries.map(({ id, profiles }) => ({
        id,
        profiles: Object.fromEntries(Object.entries(profiles).map(([profileKey, profile]) => [profileKey, {
          score: profile.score,
          sufficient: profile.sufficient,
        }])),
      })),
    },
  };
}

function tileCoordinate([longitude, latitude]: [number, number], zoom: number): [number, number] {
  const scale = 2 ** zoom;
  const latitudeRadians = latitude * Math.PI / 180;
  return [
    Math.floor((longitude + 180) / 360 * scale),
    Math.floor((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2 * scale),
  ];
}

async function writeMapTiles(directory: string, segments: ReturnType<typeof buildCitywideSegments>, config: LocalAccessibilityConfig): Promise<ReleaseArtifact> {
  const [{ default: geojsonvt }, { default: vtpbf }] = await Promise.all([
    import("geojson-vt"),
    import("vt-pbf"),
  ]);
  const features = segments.map((segment) => {
    const profiles = Object.fromEntries(Object.keys(config.profiles).flatMap((profileKey) => {
      const profile = scoreSegment(segment, config, profileKey).profile;
      return [
        [`${profileKey}Coverage`, profile.coverage],
        [`${profileKey}Score`, profile.score ?? -1],
        [`${profileKey}Sufficient`, profile.sufficient],
      ];
    }));
    return {
      type: "Feature" as const,
      properties: { id: segment.id, ...profiles },
      geometry: segment.geometry,
    };
  });
  const index = new geojsonvt({ type: "FeatureCollection", features }, {
    indexMaxPoints: 0,
    maxZoom: 15,
    promoteId: "id",
    tolerance: 2,
  });
  let minimumLongitude = Number.POSITIVE_INFINITY;
  let minimumLatitude = Number.POSITIVE_INFINITY;
  let maximumLongitude = Number.NEGATIVE_INFINITY;
  let maximumLatitude = Number.NEGATIVE_INFINITY;
  for (const segment of segments) {
    for (const [longitude, latitude] of segment.geometry.coordinates) {
      minimumLongitude = Math.min(minimumLongitude, longitude);
      minimumLatitude = Math.min(minimumLatitude, latitude);
      maximumLongitude = Math.max(maximumLongitude, longitude);
      maximumLatitude = Math.max(maximumLatitude, latitude);
    }
  }
  const bounds: [number, number, number, number] = [minimumLongitude, minimumLatitude, maximumLongitude, maximumLatitude];

  for (let zoom = 10; zoom <= 15; zoom += 1) {
    const [minimumX, maximumY] = tileCoordinate([bounds[0], bounds[1]], zoom);
    const [maximumX, minimumY] = tileCoordinate([bounds[2], bounds[3]], zoom);
    for (let x = minimumX; x <= maximumX; x += 1) {
      for (let y = minimumY; y <= maximumY; y += 1) {
        const tile = index.getTile(zoom, x, y);
        if (!tile || tile.features.length === 0) continue;
        const tileDirectory = join(directory, "tiles", String(zoom), String(x));
        await mkdir(tileDirectory, { recursive: true });
        await writeFile(join(tileDirectory, `${y}.pbf`), vtpbf.fromGeojsonVt({ segments: tile }));
      }
    }
  }

  return writeArtifact(directory, "tiles.json", {
    tilejson: "3.0.0",
    bounds,
    maxzoom: 15,
    minzoom: 10,
    tiles: ["tiles/{z}/{x}/{y}.pbf"],
    vector_layers: [{
      id: "segments",
      fields: { id: "String" },
    }],
  });
}

async function writeSegmentDetails(directory: string, segments: ReturnType<typeof buildCitywideSegments>): Promise<ReleaseArtifact> {
  const detailsDirectory = join(directory, "segment-details");
  await mkdir(detailsDirectory, { recursive: true });
  const shards = Array.from({ length: segmentDetailShardCount }, () => ({} as Record<string, typeof segments[number]>));
  for (const segment of segments) {
    const index = Number.parseInt(segmentDetailShard(segment.id), 16);
    const shard = shards[index];
    if (!shard) throw new Error(`Could not assign segment ${segment.id} to a detail shard.`);
    shard[segment.id] = segment;
  }
  await Promise.all(shards.map((shard, index) =>
    writeFile(join(detailsDirectory, `${index.toString(16).padStart(2, "0")}.json`), json(shard)),
  ));
  return writeArtifact(directory, "segment-details.json", {
    shardCount: segmentDetailShardCount,
    template: "segment-details/{shard}.json",
  });
}

const args = parseArguments(process.argv.slice(2));
const inputPath = args.input;
const configPath = args.config;
const outputPath = args.output;
const releaseId = args["release-id"];
const builtAt = args["built-at"];
if (!inputPath || !configPath || !outputPath || !releaseId || !builtAt || Number.isNaN(Date.parse(builtAt))) {
  throw new Error("The input, config, output, release-id, and ISO built-at arguments are required.");
}

const config: unknown = JSON.parse(await readFile(resolve(configPath), "utf8"));
validateConfig(config);
const inputContent = await readFile(resolve(inputPath), "utf8");
const segments = buildCitywideSegments(osmElementsFrom(JSON.parse(inputContent)));
const outputDirectory = resolve(outputPath);
await mkdir(outputDirectory, { recursive: true });

const sources: ReleaseSource[] = [{
  id: "osm",
  name: "OpenStreetMap",
  version: `osm-${checksum(inputContent)}`,
  licence: "ODbL-1.0",
}];
const mapArtifactValues = mapArtifacts(segments, config);
const artifacts = {
  config: await writeArtifact(outputDirectory, "config.json", config),
  sources: await writeArtifact(outputDirectory, "sources.json", sources),
  segments: await writeArtifact(outputDirectory, "segments.geojson", {
    type: "FeatureCollection",
    features: segments.map((segment) => ({
      type: "Feature",
      properties: { ...segment, geometry: undefined },
      geometry: segment.geometry,
    })),
  }),
  mapSegments: await writeArtifact(outputDirectory, "map-segments.geojson", mapArtifactValues.mapSegments),
    mapTiles: await writeMapTiles(outputDirectory, segments, config),
    segmentDetails: await writeSegmentDetails(outputDirectory, segments),
  segmentIndex: await writeArtifact(outputDirectory, "segment-index.json", mapArtifactValues.segmentIndex),
  };
const manifest = {
  schemaVersion: 1 as const,
  releaseId,
  builtAt,
  formulaVersion: config.formulaVersion,
  artifacts,
};
validateRelease({ manifest, config, sources, segments });
await writeFile(join(outputDirectory, "manifest.json"), json(manifest));
console.log(`Built ${releaseId}: ${segments.length} segments.`);
