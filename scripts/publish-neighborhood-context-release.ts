import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { validateNeighborhoodContextReleaseDirectory } from "./validate-neighborhood-context-release.js";
import { createPublicationPlan, publishRelease, type PublicationFile } from "./release-publisher.js";
import { createS3ObjectStore } from "./s3-object-store.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function requiredArgument(name: string): string {
  const value = argument(name);
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function filesIn(directory: string): Promise<PublicationFile[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => {
    const path = resolve(entry.parentPath, entry.name);
    return { path: relative(directory, path).replaceAll("\\", "/"), read: () => readFile(path) };
  });
}

const releaseDirectory = resolve(requiredArgument("release"));
const sourceDirectory = resolve(requiredArgument("source-directory"));
const release = await validateNeighborhoodContextReleaseDirectory(releaseDirectory);
const sourceFiles = await Promise.all(release.sources.map(async (source) => {
  const path = resolve(sourceDirectory, source.path);
  if (relative(sourceDirectory, path).startsWith("..")) throw new Error(`Source path escapes its source directory: ${source.path}`);
  const body = await readFile(path);
  if (createHash("sha256").update(body).digest("hex") !== source.sha256) throw new Error(`Source checksum does not match ${source.id}.`);
  return { path: source.path, read: async () => body };
}));
const plan = createPublicationPlan({
  releaseBucket: requiredArgument("bucket"),
  releaseId: release.manifest.releaseId,
  releasePrefix: argument("prefix") ?? "context-releases",
  sourceBucket: requiredArgument("source-bucket"),
  sourceFileName: "source-placeholder.json",
  sourcePrefix: argument("source-prefix") ?? "context-sources",
  pointerKey: argument("pointer-key") ?? "context-current.json",
});
const dryRun = process.argv.includes("--dry-run");
const activate = !process.argv.includes("--no-activate");
const report = await publishRelease({
  activate,
  dryRun,
  plan,
  releaseFiles: await filesIn(releaseDirectory),
  sourceFiles,
  onProgress: dryRun ? undefined : (completed, total) => console.log(`Uploaded ${completed}/${total} immutable Context objects.`),
  storage: dryRun ? {
    getObject: async () => { throw new Error("Dry runs do not read object storage."); },
    objectExists: async () => false,
    putObject: async () => {},
  } : createS3ObjectStore({
    endpoint: requiredArgument("endpoint"),
    accessKeyId: requiredEnvironment("AWS_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnvironment("AWS_SECRET_ACCESS_KEY"),
  }),
});
console.log(`${dryRun ? "Would publish" : activate ? "Published and activated" : "Published without activation"} Context ${report.releaseId}: ${report.objects} objects, ${report.bytes} bytes.`);
