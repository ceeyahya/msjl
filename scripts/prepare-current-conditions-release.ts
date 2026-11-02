import { existsSync } from "node:fs";
import { createHash } from "node:crypto";

import { buildRelease } from "./build-release.js";
import { closeCurrentConditionsStore, prepareBaselineRelease } from "../src/server/current-conditions-store.server.js";
import { validateRelease, type LocalAccessibilityRelease, type ReleaseArtifact } from "../src/release.js";

function parseArguments(argumentsList: string[]): {
  expectedEligibleSegmentCount: number;
  releaseDirectory?: string;
  releaseUrl?: string;
} {
  const argumentsByName = Object.fromEntries(argumentsList.reduce<string[][]>((entries, value, index) => {
    if (index % 2 === 0) entries.push([value, argumentsList[index + 1] ?? ""]);
    return entries;
  }, []));
  const releaseDirectory = argumentsByName["--release"];
  const releaseUrl = argumentsByName["--release-url"];
  const count = argumentsByName["--expected-eligible-segment-count"];
  if ((!releaseDirectory && !releaseUrl) || (releaseDirectory && releaseUrl) || !count || argumentsList.length !== 4 || !/^\d+$/u.test(count)) {
    throw new Error("Usage: npm run prepare-current-conditions-release -- (--release <directory> | --release-url <https-url>) --expected-eligible-segment-count <count>");
  }
  const expectedEligibleSegmentCount = Number(count);
  if (!Number.isSafeInteger(expectedEligibleSegmentCount) || expectedEligibleSegmentCount <= 0) {
    throw new Error("The expected eligible segment count must be a positive integer.");
  }
  return { expectedEligibleSegmentCount, ...(releaseDirectory ? { releaseDirectory } : { releaseUrl }) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checksum(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function readJson(url: string): Promise<{ content: string; value: unknown }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load published release artifact ${url}: HTTP ${response.status}.`);
  const content = await response.text();
  return { content, value: JSON.parse(content) as unknown };
}

function artifactFromManifest(manifest: Record<string, unknown>, name: string): ReleaseArtifact {
  const artifact = isRecord(manifest.artifacts) ? manifest.artifacts[name] : undefined;
  if (!isRecord(artifact) || typeof artifact.path !== "string" || typeof artifact.sha256 !== "string") {
    throw new Error(`Published release manifest has an invalid ${name} artifact.`);
  }
  return { path: artifact.path, sha256: artifact.sha256 };
}

function segmentsFromGeoJson(value: unknown): unknown[] {
  if (!isRecord(value) || value.type !== "FeatureCollection" || !Array.isArray(value.features)) {
    throw new Error("Published release segments artifact must be a GeoJSON FeatureCollection.");
  }
  return value.features.map((feature) => {
    if (!isRecord(feature) || !isRecord(feature.properties)) throw new Error("Each published segment feature requires properties.");
    return { ...feature.properties, geometry: feature.geometry };
  });
}

async function buildPublishedRelease(releaseUrl: string): Promise<LocalAccessibilityRelease> {
  const baseUrl = new URL(releaseUrl).toString().replace(/\/$/u, "");
  const manifestResponse = await readJson(`${baseUrl}/manifest.json`);
  if (!isRecord(manifestResponse.value)) throw new Error("Published release manifest is invalid.");
  const manifest = manifestResponse.value;
  const artifactNames = ["config", "sources", "segments", "mapSegments", "mapTiles", "segmentDetails", "segmentIndex"];
  const artifacts = await Promise.all(artifactNames.map(async (name) => {
    if (!isRecord(manifest.artifacts) || manifest.artifacts[name] === undefined) return [name, undefined] as const;
    const artifact = artifactFromManifest(manifest, name);
    const response = await readJson(new URL(artifact.path, `${baseUrl}/`).toString());
    if (checksum(response.content) !== artifact.sha256) throw new Error(`Checksum mismatch for published ${artifact.path}.`);
    return [name, response.value] as const;
  }));
  const values = Object.fromEntries(artifacts);

  return validateRelease({
    manifest,
    config: values.config,
    sources: values.sources,
    segments: segmentsFromGeoJson(values.segments),
  });
}

if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile(".env");

const { releaseDirectory, releaseUrl, expectedEligibleSegmentCount } = parseArguments(process.argv.slice(2));

try {
  const release = releaseDirectory ? await buildRelease(releaseDirectory) : await buildPublishedRelease(releaseUrl!);
  await prepareBaselineRelease({
    releaseId: release.manifest.releaseId,
    segmentsArtifactSha256: release.manifest.artifacts.segments.sha256,
    configArtifactSha256: release.manifest.artifacts.config.sha256,
    config: release.config,
    expectedEligibleSegmentCount,
    segments: release.segments,
  });
  console.log(`Prepared ${release.manifest.releaseId} with ${expectedEligibleSegmentCount} eligible segments.`);
} finally {
  await closeCurrentConditionsStore();
}
