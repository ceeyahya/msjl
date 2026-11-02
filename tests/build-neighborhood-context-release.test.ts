import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const config = {
  version: "context-policy-v1", geography: { id: "insee-iris-2022-01-01" }, coverage: { minimumNetworkPopulationShare: 0.95 },
  indicators: {
    materialPressure: { bestAt: 10, worstAt: 50, qualifyingDispNote: 0 },
    transitAccess: { bestAt: 52, worstAt: 0, weekdayServiceDays: "tuesday-thursday", hours: [7, 20] },
    civicFreeServiceAccess: { maximumCategories: 4, networkDistanceMetres: 1000 },
  },
};

describe("build-neighborhood-context-release", () => {
  it("builds validated, independently versioned IRIS artifacts with tiles, compact index, and on-demand details", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mjsl-context-release-"));
    const areasPath = join(directory, "areas.geojson");
    const configPath = join(directory, "config.json");
    const sourcesPath = join(directory, "sources.json");
    const sourceDirectory = join(directory, "sources");
    const outputPath = join(directory, "release");
    await writeFile(configPath, JSON.stringify(config));
    await mkdir(sourceDirectory);
    const sources = await Promise.all(["iris-boundaries", "filosofi", "rtm-gtfs", "civic-services", "population-grid", "osm-pedestrian-network"].map(async (id) => {
      const path = `${id}.json`;
      const content = `${id} snapshot`;
      await writeFile(join(sourceDirectory, path), content);
      return { id, name: id, version: "test-v1", licence: "Etalab-2.0", path, url: `https://example.test/${id}`, retrievedAt: "2026-11-01T00:00:00.000Z", sha256: createHash("sha256").update(content).digest("hex") };
    }));
    await writeFile(sourcesPath, JSON.stringify(sources));
    await writeFile(areasPath, JSON.stringify({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [[[5.37, 43.29], [5.38, 43.29], [5.38, 43.3], [5.37, 43.29]]] },
        properties: {
          id: "132010101", name: "La Plaine", population: { imputedShare: 0.1, networkResolvedShare: 0.96 },
          indicators: { materialPressure: { available: true, value: 30, qualifyingNote: 0 }, transitAccess: { available: true, value: 26 }, civicFreeServiceAccess: { available: true, value: 2 } },
        },
      }],
    }));
    try {
      const output = execFileSync("npm", ["run", "build-neighborhood-context-release", "--", "--areas", areasPath, "--config", configPath, "--sources", sourcesPath, "--source-directory", sourceDirectory, "--output", outputPath, "--release-id", "marseille-context-2026-q4", "--built-at", "2026-11-02T00:00:00.000Z"], { cwd: process.cwd(), encoding: "utf8" });
      const validationOutput = execFileSync("npm", ["run", "validate-neighborhood-context-release", "--", outputPath], { cwd: process.cwd(), encoding: "utf8" });
      const index = JSON.parse(await readFile(join(outputPath, "area-index.json"), "utf8")) as { areas: Array<{ score: number; sufficient: boolean }> };

      expect(output).toContain("1 IRIS areas");
      expect(validationOutput).toContain("1 IRIS areas");
      expect(index.areas).toEqual([{ id: "132010101", name: "La Plaine", score: 0.5, sufficient: true }]);
      expect(JSON.parse(await readFile(join(outputPath, "manifest.json"), "utf8"))).toMatchObject({ policyId: "context-policy-v1", artifacts: { areas: { path: "areas.geojson" }, mapTiles: { path: "tiles.json" }, areaIndex: { path: "area-index.json" }, areaDetails: { path: "area-details.json" } } });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
