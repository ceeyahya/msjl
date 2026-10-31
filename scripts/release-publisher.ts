import { createHash } from "node:crypto";

import type { ReleaseSource } from "../src/release.js";

export interface ObjectStore {
  getObject(bucket: string, key: string): Promise<Uint8Array>;
  objectExists(bucket: string, key: string): Promise<boolean>;
  putObject(object: StoredObject): Promise<void>;
}

export interface StoredObject {
  body: Uint8Array;
  bucket: string;
  cacheControl: string;
  contentType: string;
  createOnly: boolean;
  key: string;
}

export interface PublicationFile {
  path: string;
  read(): Promise<Uint8Array>;
}

export interface PublicationPlan {
  manifestKey: string;
  pointerKey: string;
  pointer: {
    baseUrl: string;
    releaseId: string;
    schemaVersion: 1;
  };
  releaseBucket: string;
  releasePrefix: string;
  sourceBucket: string;
  sourceKey: string;
}

export interface PublicationReport {
  bytes: number;
  objects: number;
  releaseId: string;
}

const immutableCacheControl = "public, max-age=31536000, immutable";
const pointerCacheControl = "no-store";

function assertText(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required.`);
}

function assertPath(value: string, label: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
  if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${label} must be a relative object path.`);
  }
  return normalized;
}

function assertReleaseId(releaseId: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(releaseId)) {
    throw new Error("Release IDs must contain lowercase letters, digits, and hyphens only.");
  }
}

function pointerDocument(pointer: PublicationPlan["pointer"]): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(pointer, null, 2)}\n`);
}

function contentType(path: string): string {
  if (path.endsWith(".geojson")) return "application/geo+json";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".pbf")) return "application/x-protobuf";
  return "application/octet-stream";
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function releaseIdFromManifest(content: Uint8Array): string {
  const value: unknown = JSON.parse(new TextDecoder().decode(content));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The remote release manifest is invalid.");
  }
  const manifest = value as Record<string, unknown>;
  if (typeof manifest.releaseId !== "string") throw new Error("The remote release manifest is invalid.");
  return manifest.releaseId;
}

function releaseKey(plan: PublicationPlan, path: string): string {
  return `${plan.releasePrefix}/${plan.pointer.releaseId}/${assertPath(path, "Release artifact path")}`;
}

export function createPublicationPlan(options: {
  pointerKey?: string | undefined;
  releaseBucket: string;
  releaseId: string;
  releasePrefix?: string | undefined;
  sourceBucket: string;
  sourceFileName: string;
  sourcePrefix?: string | undefined;
}): PublicationPlan {
  assertText(options.releaseBucket, "Release bucket");
  assertText(options.sourceBucket, "Source bucket");
  if (options.releaseBucket === options.sourceBucket) {
    throw new Error("Source snapshots must use a bucket that is not publicly served with release artifacts.");
  }
  assertReleaseId(options.releaseId);
  const releasePrefix = assertPath(options.releasePrefix ?? "releases", "Release prefix");
  const sourcePrefix = assertPath(options.sourcePrefix ?? "sources", "Source prefix");
  const pointerKey = assertPath(options.pointerKey ?? "current.json", "Pointer key");
  if (pointerKey.includes("/")) throw new Error("Pointer key must be at the storage root.");
  const sourceFileName = assertPath(options.sourceFileName, "Source file name");
  if (sourceFileName.includes("/")) throw new Error("Source file name must not include a directory.");

  return {
    manifestKey: `${releasePrefix}/${options.releaseId}/manifest.json`,
    pointerKey,
    pointer: {
      schemaVersion: 1,
      releaseId: options.releaseId,
      baseUrl: `./${releasePrefix}/${options.releaseId}/`,
    },
    releaseBucket: options.releaseBucket,
    releasePrefix,
    sourceBucket: options.sourceBucket,
    sourceKey: `${sourcePrefix}/${options.releaseId}/${sourceFileName}`,
  };
}

export function verifySourceSnapshot(content: Uint8Array, sources: ReleaseSource[]): void {
  const version = `osm-${createHash("sha256").update(content).digest("hex")}`;
  if (!sources.some((source) => source.id === "osm" && source.version === version)) {
    throw new Error("The source snapshot does not match the release's recorded OSM checksum.");
  }
}

export async function activateRelease(plan: PublicationPlan, storage: ObjectStore): Promise<void> {
  const manifest = await storage.getObject(plan.releaseBucket, plan.manifestKey);
  if (releaseIdFromManifest(manifest) !== plan.pointer.releaseId) {
    throw new Error("The remote release manifest does not match the release being activated.");
  }
  await storage.putObject({
    bucket: plan.releaseBucket,
    key: plan.pointerKey,
    body: pointerDocument(plan.pointer),
    contentType: "application/json",
    cacheControl: pointerCacheControl,
    createOnly: false,
  });
}

export async function publishRelease(options: {
  dryRun?: boolean;
  onProgress?: ((completed: number, total: number) => void) | undefined;
  plan: PublicationPlan;
  releaseFiles: PublicationFile[];
  sourceFile: PublicationFile;
  storage: ObjectStore;
}): Promise<PublicationReport> {
  const { plan, storage } = options;
  const releaseFiles = [...options.releaseFiles].sort((left, right) => left.path.localeCompare(right.path));
  const manifest = releaseFiles.find((file) => file.path === "manifest.json");
  if (!manifest) throw new Error("The release must include manifest.json.");
  if (new Set(releaseFiles.map((file) => file.path)).size !== releaseFiles.length) {
    throw new Error("The release contains duplicate artifact paths.");
  }

  const files = [
    { bucket: plan.sourceBucket, key: plan.sourceKey, file: options.sourceFile },
    ...releaseFiles
      .filter((file) => file !== manifest)
      .map((file) => ({ bucket: plan.releaseBucket, key: releaseKey(plan, file.path), file })),
  ];
  let bytes = 0;

  if (!options.dryRun) {
    const [manifestExists, sourceExists] = await Promise.all([
      storage.objectExists(plan.releaseBucket, plan.manifestKey),
      storage.objectExists(plan.sourceBucket, plan.sourceKey),
    ]);
    if (manifestExists || sourceExists) {
      throw new Error("This immutable release ID or source snapshot has already been published.");
    }
  }

  let nextFile = 0;
  let completed = 0;
  const worker = async () => {
    while (nextFile < files.length) {
      const current = files[nextFile];
      nextFile += 1;
      if (!current) continue;
      const { bucket, key, file } = current;
      const body = await file.read();
      bytes += body.byteLength;
      if (!options.dryRun) {
        await storage.putObject({
          bucket,
          key,
          body,
          contentType: contentType(file.path),
          cacheControl: immutableCacheControl,
          createOnly: true,
        });
      }
      completed += 1;
      if (completed === files.length || completed % 1_000 === 0) options.onProgress?.(completed, files.length + 1);
    }
  };
  await Promise.all(Array.from({ length: Math.min(16, files.length) }, worker));

  const localManifest = await manifest.read();
  bytes += localManifest.byteLength;
  if (!options.dryRun) {
    await storage.putObject({
      bucket: plan.releaseBucket,
      key: plan.manifestKey,
      body: localManifest,
      contentType: "application/json",
      cacheControl: immutableCacheControl,
      createOnly: true,
    });
  }
  options.onProgress?.(files.length + 1, files.length + 1);

  if (options.dryRun) return { releaseId: plan.pointer.releaseId, objects: files.length + 1, bytes };
  if (releaseIdFromManifest(localManifest) !== plan.pointer.releaseId) {
    throw new Error("The local release manifest does not match the publication release ID.");
  }

  const remoteManifest = await storage.getObject(plan.releaseBucket, plan.manifestKey);
  if (!equalBytes(remoteManifest, localManifest)) {
    throw new Error("The uploaded release manifest does not match the validated local manifest.");
  }
  await activateRelease(plan, storage);
  return { releaseId: plan.pointer.releaseId, objects: files.length + 1, bytes };
}
