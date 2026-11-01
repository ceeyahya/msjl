import { readdir, readFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

import { buildRelease } from "./build-release.js";
import { createPublicationPlan, publishRelease, verifySourceSnapshot, type PublicationFile } from "./release-publisher.js";
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
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const absolutePath = resolve(entry.parentPath, entry.name);
      return {
        path: relative(directory, absolutePath).replaceAll("\\", "/"),
        read: () => readFile(absolutePath),
      };
    });
}

const releaseDirectory = resolve(requiredArgument("release"));
const sourcePath = resolve(requiredArgument("source"));
const release = await buildRelease(releaseDirectory);
const sourceContent = await readFile(sourcePath);
verifySourceSnapshot(sourceContent, release.sources);
const plan = createPublicationPlan({
  releaseBucket: requiredArgument("bucket"),
  releaseId: release.manifest.releaseId,
  releasePrefix: argument("prefix"),
  sourceBucket: requiredArgument("source-bucket"),
  sourceFileName: basename(sourcePath),
  sourcePrefix: argument("source-prefix"),
  pointerKey: argument("pointer-key"),
});
const dryRun = process.argv.includes("--dry-run");
const activate = !process.argv.includes("--no-activate");
const report = await publishRelease({
  activate,
  dryRun,
  plan,
  releaseFiles: await filesIn(releaseDirectory),
  sourceFile: { path: basename(sourcePath), read: async () => sourceContent },
  onProgress: dryRun ? undefined : (completed, total) => console.log(`Uploaded ${completed}/${total} immutable objects.`),
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

console.log(`${dryRun ? "Would publish" : activate ? "Published and activated" : "Published without activation"} ${report.releaseId}: ${report.objects} objects, ${report.bytes} bytes.`);
