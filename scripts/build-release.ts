import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { validateRelease, type LocalAccessibilityRelease, type ReleaseArtifact } from "../src/release.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function artifactFromManifest(manifest: unknown, name: string): ReleaseArtifact {
  if (!isRecord(manifest) || !isRecord(manifest.artifacts) || !isRecord(manifest.artifacts[name])) {
    throw new Error(`Release manifest does not define a ${name} artifact.`);
  }
  const artifact = manifest.artifacts[name];
  if (typeof artifact.path !== "string" || typeof artifact.sha256 !== "string") {
    throw new Error(`Release manifest has an invalid ${name} artifact.`);
  }
  return { path: artifact.path, sha256: artifact.sha256 };
}

function resolveArtifact(releaseDirectory: string, artifact: ReleaseArtifact): string {
  const path = resolve(releaseDirectory, artifact.path);
  const relativePath = relative(releaseDirectory, path);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Release artifact path escapes its release directory: ${artifact.path}`);
  }
  return path;
}

async function readVerifiedJson(releaseDirectory: string, artifact: ReleaseArtifact): Promise<unknown> {
  const path = resolveArtifact(releaseDirectory, artifact);
  const content = await readFile(path);
  const checksum = createHash("sha256").update(content).digest("hex");
  if (checksum !== artifact.sha256) throw new Error(`Checksum mismatch for ${artifact.path}.`);
  return JSON.parse(content.toString("utf8")) as unknown;
}

function segmentsFromGeoJson(value: unknown): unknown {
  if (!isRecord(value) || value.type !== "FeatureCollection" || !Array.isArray(value.features)) {
    throw new Error("Segments artifact must be a GeoJSON FeatureCollection.");
  }
  return value.features.map((feature) => {
    if (!isRecord(feature) || !isRecord(feature.properties)) throw new Error("Each segment feature requires properties.");
    return { ...feature.properties, geometry: feature.geometry };
  });
}

export async function buildRelease(directory: string): Promise<LocalAccessibilityRelease> {
  const releaseDirectory = resolve(directory);
  const manifest = await readJson(resolve(releaseDirectory, "manifest.json"));
  const config = await readVerifiedJson(releaseDirectory, artifactFromManifest(manifest, "config"));
  const sources = await readVerifiedJson(releaseDirectory, artifactFromManifest(manifest, "sources"));
  const segmentGeoJson = await readVerifiedJson(releaseDirectory, artifactFromManifest(manifest, "segments"));
  if (isRecord(manifest) && isRecord(manifest.artifacts)) {
    for (const name of ["mapSegments", "mapTiles", "segmentDetails", "segmentIndex"]) {
      if (manifest.artifacts[name] !== undefined) await readVerifiedJson(releaseDirectory, artifactFromManifest(manifest, name));
    }
  }

  return validateRelease({ manifest, config, sources, segments: segmentsFromGeoJson(segmentGeoJson) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = process.argv[2];
  if (!directory) {
    throw new Error("Usage: npm run build-release -- <release-directory>");
  }

  const release = await buildRelease(directory);
  console.log(`Validated ${release.manifest.releaseId}: ${release.segments.length} segments.`);
}
