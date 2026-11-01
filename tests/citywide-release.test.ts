import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildCitywideSegments, type OsmElement } from "../src/citywide-release.js";
import { scoreSegments } from "../src/scoring.js";

const config = {
  version: "1.0.0",
  formulaVersion: "v1",
  dimensionBarrierCap: 0.9,
  indicators: {
    steps: { dimension: "physical", kind: "linear" as const, noProblemAt: 0, totalObstacleAt: 6, weight: 2 },
    slope: { dimension: "physical", kind: "directional-linear" as const, noProblemAt: 4, totalObstacleAt: 12, weight: 1 },
    surface: { dimension: "physical", kind: "linear" as const, noProblemAt: 0, totalObstacleAt: 1, weight: 1 },
    crossingEquipment: { dimension: "sensory", kind: "linear" as const, noProblemAt: 0, totalObstacleAt: 1, weight: 1 },
    noise: { dimension: "sensory", kind: "linear" as const, noProblemAt: 55, totalObstacleAt: 85, weight: 1 },
    freeServices: { dimension: "economic", kind: "linear" as const, noProblemAt: 0.6, totalObstacleAt: 0, weight: 1 },
  },
  dimensions: {
    physical: { minimumCoverage: 0.6 },
    sensory: { minimumCoverage: 0.5 },
    economic: { minimumCoverage: 1 },
  },
  profiles: {
    wheelchair: { minimumCoverage: 0.5, weights: { physical: 0.6, sensory: 0.25, economic: 0.15 } },
  },
};

const osm: OsmElement[] = [
  { type: "node", id: 1, lat: 43.29, lon: 5.37 },
  { type: "node", id: 2, lat: 43.29054, lon: 5.37 },
  { type: "node", id: 3, lat: 43.29108, lon: 5.37 },
  { type: "node", id: 4, lat: 43.29054, lon: 5.3704 },
  { type: "node", id: 5, lat: 43.29054, lon: 5.3696 },
  { type: "way", id: 100, nodes: [1, 2, 3], tags: { highway: "steps", surface: "asphalt" } },
  { type: "way", id: 101, nodes: [4, 2, 5], tags: { highway: "footway", surface: "asphalt" } },
];

describe("buildCitywideSegments", () => {
  it("keeps only eligible pedestrian ways, splits intersections and 50 m lengths, and retains OSM lineage", () => {
    const segments = buildCitywideSegments(osm);

    expect(segments).toHaveLength(6);
    expect(segments.map((segment) => segment.sourceWayIds)).toEqual([
      ["way/100"],
      ["way/100"],
      ["way/100"],
      ["way/100"],
      ["way/101"],
      ["way/101"],
    ]);
    expect(segments.every((segment) => segment.geometry.coordinates.length >= 2)).toBe(true);
    expect(segments.every((segment) => segment.relations.every((relation) => relation.sourceId === "osm"))).toBe(true);
  });

  it("provides release-scoped baseline metrics without adding a community-derived value", () => {
    const segments = buildCitywideSegments(osm);
    const scores = scoreSegments(segments, config, "wheelchair");

    expect(scores.segments["osm-way-100-0001"]?.profile).toEqual({
      score: 8 / 9,
      coverage: 0.6,
      sufficient: true,
    });
    expect(segments.every((segment) => !("currentCondition" in segment))).toBe(true);
  });

  it("attaches nearby crossing evidence and free services through the pedestrian network", () => {
    const segments = buildCitywideSegments([
      ...osm,
      { type: "node", id: 6, lat: 43.2901, lon: 5.37, tags: { highway: "crossing", tactile_paving: "no" } },
      { type: "node", id: 7, lat: 43.29, lon: 5.37, tags: { amenity: "drinking_water" } },
    ]);
    const crossingSegment = segments.find((segment) => segment.metrics.crossingEquipment !== undefined);

    expect(crossingSegment?.metrics.crossingEquipment).toEqual({ value: 1, coverage: 1 });
    expect(crossingSegment?.relations.find((relation) => relation.indicator === "crossingEquipment")).toMatchObject({
      method: "nearest",
      sourceId: "osm",
    });
    expect(segments.every((segment) => {
      const metric = segment.metrics.freeServices;
      return metric !== undefined && "value" in metric && metric.value === 1 / 3;
    })).toBe(true);
    expect(segments.every((segment) => segment.metrics.freeServices?.coverage === 1)).toBe(true);
  });
});

describe("build-citywide-release", () => {
  it("packages a deterministic OSM snapshot into a validated release and map artifact", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mjsl-citywide-release-"));
    const inputPath = join(directory, "osm.json");
    const configPath = join(directory, "config.json");
    const outputPath = join(directory, "release");
    await writeFile(inputPath, JSON.stringify({ version: 0.6, elements: osm }));
    await writeFile(configPath, JSON.stringify(config));

    try {
      const output = execFileSync("npm", [
        "run",
        "build-citywide-release",
        "--",
        "--input", inputPath,
        "--config", configPath,
        "--output", outputPath,
        "--release-id", "marseille-test-2026-10-30",
        "--built-at", "2026-10-30T00:00:00.000Z",
      ], { cwd: process.cwd(), encoding: "utf8" });

      const validationOutput = execFileSync("npm", ["run", "build-release", "--", outputPath], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      const manifest = JSON.parse(await readFile(join(outputPath, "manifest.json"), "utf8")) as {
        artifacts: { mapSegments?: { path: string }; mapTiles?: { path: string }; segmentDetails?: { path: string }; segmentIndex?: { path: string } };
        sources: unknown;
      };
      const sources = JSON.parse(await readFile(join(outputPath, "sources.json"), "utf8")) as Array<{ version: string }>;
      const mapArtifact = JSON.parse(await readFile(join(outputPath, "map-segments.geojson"), "utf8")) as { features: unknown[] };

      expect(output).toContain("marseille-test-2026-10-30");
      expect(validationOutput).toContain("6 segments");
      expect(manifest.artifacts.mapSegments?.path).toBe("map-segments.geojson");
        expect(manifest.artifacts.mapTiles?.path).toBe("tiles.json");
        expect(manifest.artifacts.segmentDetails?.path).toBe("segment-details.json");
        expect(manifest.artifacts.segmentIndex?.path).toBe("segment-index.json");
       expect((await readdir(join(outputPath, "segment-details"))).filter((file) => file.endsWith(".json"))).toHaveLength(256);
      expect(mapArtifact.features).toHaveLength(6);
      expect(sources[0]?.version).toMatch(/^osm-[a-f0-9]{64}$/u);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
