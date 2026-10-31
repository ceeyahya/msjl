import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_BBOX = "43.15,5.20,43.48,5.60";
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function queryFor(bbox: string): string {
  return `[out:json][timeout:900];
(
  way[highway~"^(footway|pedestrian|steps|crossing|path|residential|living_street)$"](${bbox});
  node[highway=crossing](${bbox});
  node[crossing](${bbox});
  node[amenity~"^(bench|drinking_water|toilets)$"](${bbox});
);
(._;>;);
out body;`;
}

async function download(query: string): Promise<unknown> {
  let lastFailure = "No Overpass endpoint was attempted.";
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "mjsl-rewrite/1.0 (citywide baseline snapshot)",
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(15 * 60_000),
      });
      if (response.ok) return response.json();
      lastFailure = `${new URL(endpoint).host} returned HTTP ${response.status}`;
    } catch (error) {
      lastFailure = `${new URL(endpoint).host}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  throw new Error(`Could not download the citywide OSM snapshot. ${lastFailure}`);
}

const output = argument("output");
if (!output) throw new Error("Usage: npm run fetch-citywide-osm -- --output <osm.json> [--bbox <south,west,north,east>]");

const content = `${JSON.stringify(await download(queryFor(argument("bbox") ?? DEFAULT_BBOX)))}\n`;
const outputPath = resolve(output);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, content);
console.log(`Saved citywide OSM snapshot to ${outputPath}.`);
