import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { validateNeighborhoodContextRelease, type ContextArtifact, type NeighborhoodContextRelease } from "../src/neighborhood-context.js";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8")) as unknown;

function artifactFromManifest(manifest: unknown, name: string): ContextArtifact {
  if (!isRecord(manifest) || !isRecord(manifest.artifacts) || !isRecord(manifest.artifacts[name]) || typeof manifest.artifacts[name].path !== "string" || typeof manifest.artifacts[name].sha256 !== "string") {
    throw new Error(`Context manifest does not define a valid ${name} artifact.`);
  }
  return manifest.artifacts[name] as unknown as ContextArtifact;
}

function resolveArtifact(directory: string, artifact: ContextArtifact): string {
  const path = resolve(directory, artifact.path);
  const relativePath = relative(directory, path);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) throw new Error(`Context artifact path escapes its release directory: ${artifact.path}`);
  return path;
}

async function readVerifiedJson(directory: string, artifact: ContextArtifact): Promise<unknown> {
  const content = await readFile(resolveArtifact(directory, artifact));
  if (createHash("sha256").update(content).digest("hex") !== artifact.sha256) throw new Error(`Checksum mismatch for ${artifact.path}.`);
  return JSON.parse(content.toString("utf8")) as unknown;
}

async function verifyListedFiles(directory: string, descriptor: unknown, label: string): Promise<void> {
  if (!isRecord(descriptor) || !isRecord(descriptor.files)) throw new Error(`${label} descriptor requires file checksums.`);
  await Promise.all(Object.entries(descriptor.files).map(async ([path, checksum]) => {
    if (typeof checksum !== "string" || !/^[a-f0-9]{64}$/u.test(checksum)) throw new Error(`${label} descriptor has an invalid checksum.`);
    const content = await readFile(resolveArtifact(directory, { path, sha256: checksum }));
    if (createHash("sha256").update(content).digest("hex") !== checksum) throw new Error(`Checksum mismatch for ${path}.`);
  }));
}

export async function validateNeighborhoodContextReleaseDirectory(directory: string): Promise<NeighborhoodContextRelease> {
  const releaseDirectory = resolve(directory);
  const manifest = await readJson(resolve(releaseDirectory, "manifest.json"));
  const config = await readVerifiedJson(releaseDirectory, artifactFromManifest(manifest, "config"));
  const sources = await readVerifiedJson(releaseDirectory, artifactFromManifest(manifest, "sources"));
  const areasGeoJson = await readVerifiedJson(releaseDirectory, artifactFromManifest(manifest, "areas"));
  const mapTiles = await readVerifiedJson(releaseDirectory, artifactFromManifest(manifest, "mapTiles"));
  const areaDetails = await readVerifiedJson(releaseDirectory, artifactFromManifest(manifest, "areaDetails"));
  await readVerifiedJson(releaseDirectory, artifactFromManifest(manifest, "areaIndex"));
  await verifyListedFiles(releaseDirectory, mapTiles, "Context tiles");
  await verifyListedFiles(releaseDirectory, areaDetails, "Context details");
  if (!isRecord(areasGeoJson) || areasGeoJson.type !== "FeatureCollection" || !Array.isArray(areasGeoJson.features)) throw new Error("Context areas artifact must be a GeoJSON FeatureCollection.");
  const areas = areasGeoJson.features.map((feature) => {
    if (!isRecord(feature) || !isRecord(feature.properties)) throw new Error("Each Context area feature requires properties.");
    return { ...feature.properties, geometry: feature.geometry };
  });
  return validateNeighborhoodContextRelease({ manifest, config, sources, areas });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = process.argv[2];
  if (!directory) throw new Error("Usage: npm run validate-neighborhood-context-release -- <release-directory>");
  const release = await validateNeighborhoodContextReleaseDirectory(directory);
  console.log(`Validated ${release.manifest.releaseId}: ${release.areas.length} IRIS areas.`);
}
