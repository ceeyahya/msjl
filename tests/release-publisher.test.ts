import { describe, expect, it } from "vitest";

import {
  activateRelease,
  createPublicationPlan,
  publishRelease,
  verifySourceSnapshot,
  type ObjectStore,
  type StoredObject,
} from "../scripts/release-publisher.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function objectStore(remoteManifest?: Uint8Array): ObjectStore & { writes: StoredObject[] } {
  const writes: StoredObject[] = [];
  return {
    writes,
    async getObject(_bucket, key) {
      if (key.endsWith("manifest.json")) return remoteManifest ?? writes.find((write) => write.key === key)?.body ?? encoder.encode("");
      throw new Error(`Unexpected read of ${key}.`);
    },
    async objectExists() {
      return false;
    },
    async putObject(object) {
      writes.push(object);
    },
  };
}

const manifest = encoder.encode('{"releaseId":"marseille-20261031-1"}\n');

describe("citywide release publisher", () => {
  it("uploads immutable source and release objects, verifies the manifest, then activates the pointer", async () => {
    const storage = objectStore();
    const plan = createPublicationPlan({
      releaseBucket: "public-releases",
      sourceBucket: "private-snapshots",
      releaseId: "marseille-20261031-1",
      sourceFileName: "osm.json",
    });

    const report = await publishRelease({
      plan,
      storage,
      sourceFile: { path: "osm.json", read: async () => encoder.encode("source") },
      releaseFiles: [
        { path: "config.json", read: async () => encoder.encode("config") },
        { path: "manifest.json", read: async () => manifest },
        { path: "tiles/10/1/2.pbf", read: async () => encoder.encode("tile") },
      ],
    });

    expect(report).toEqual({ releaseId: "marseille-20261031-1", objects: 4, bytes: 53 });
    expect(storage.writes.map((write) => `${write.bucket}/${write.key}`)).toEqual([
      "private-snapshots/sources/marseille-20261031-1/osm.json",
      "public-releases/releases/marseille-20261031-1/config.json",
      "public-releases/releases/marseille-20261031-1/tiles/10/1/2.pbf",
      "public-releases/releases/marseille-20261031-1/manifest.json",
      "public-releases/current.json",
    ]);
    expect(storage.writes.at(-1)).toMatchObject({ cacheControl: "no-store" });
    expect(JSON.parse(decoder.decode(storage.writes.at(-1)?.body))).toEqual({
      schemaVersion: 1,
      releaseId: "marseille-20261031-1",
      baseUrl: "./releases/marseille-20261031-1/",
    });
  });

  it("refuses a source snapshot whose checksum is not recorded by the release", () => {
    expect(() => verifySourceSnapshot(encoder.encode("different source"), [{
      id: "osm",
      name: "OpenStreetMap",
      version: "osm-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      licence: "ODbL-1.0",
    }])).toThrow("does not match the release's recorded OSM checksum");
  });

  it("rejects a nested pointer key because pointer-relative release URLs would resolve incorrectly", () => {
    expect(() => createPublicationPlan({
      pointerKey: "pointers/current.json",
      releaseBucket: "public-releases",
      sourceBucket: "private-snapshots",
      releaseId: "marseille-20261031-1",
      sourceFileName: "osm.json",
    })).toThrow("Pointer key must be at the storage root");
  });

  it("rejects release IDs that cannot safely form an immutable storage prefix", () => {
    expect(() => createPublicationPlan({
      releaseBucket: "public-releases",
      sourceBucket: "private-snapshots",
      releaseId: "Marseille_2026",
      sourceFileName: "osm.json",
    })).toThrow("Release IDs must contain lowercase letters, digits, and hyphens only");
  });

  it("does not activate a release when its uploaded manifest differs", async () => {
    const storage = objectStore(encoder.encode('{"releaseId":"different"}\n'));
    const plan = createPublicationPlan({
      releaseBucket: "public-releases",
      sourceBucket: "private-snapshots",
      releaseId: "marseille-20261031-1",
      sourceFileName: "osm.json",
    });

    await expect(publishRelease({
      plan,
      storage,
      sourceFile: { path: "osm.json", read: async () => encoder.encode("source") },
      releaseFiles: [{ path: "manifest.json", read: async () => manifest }],
    })).rejects.toThrow("does not match the validated local manifest");
    expect(storage.writes.some((write) => write.key === "current.json")).toBe(false);
  });

  it("only updates the pointer for a remote manifest with the requested release ID", async () => {
    const storage = objectStore(encoder.encode('{"releaseId":"different"}\n'));
    const plan = createPublicationPlan({
      releaseBucket: "public-releases",
      sourceBucket: "private-snapshots",
      releaseId: "marseille-20261031-1",
      sourceFileName: "osm.json",
    });

    await expect(activateRelease(plan, storage)).rejects.toThrow("does not match the release being activated");
    expect(storage.writes).toHaveLength(0);
  });

  it("supports a dry run without requesting or writing remote objects", async () => {
    const storage = objectStore();
    const plan = createPublicationPlan({
      releaseBucket: "public-releases",
      sourceBucket: "private-snapshots",
      releaseId: "marseille-20261031-1",
      sourceFileName: "osm.json",
    });

    await publishRelease({
      dryRun: true,
      plan,
      storage,
      sourceFile: { path: "osm.json", read: async () => encoder.encode("source") },
      releaseFiles: [{ path: "manifest.json", read: async () => manifest }],
    });
    expect(storage.writes).toHaveLength(0);
  });
});
