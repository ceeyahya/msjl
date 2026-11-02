import { activateRelease, createPublicationPlan } from "./release-publisher.js";
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

const plan = createPublicationPlan({
  releaseBucket: requiredArgument("bucket"),
  releaseId: requiredArgument("release-id"),
  releasePrefix: argument("prefix") ?? "context-releases",
  sourceBucket: requiredArgument("source-bucket"),
  sourceFileName: "rollback-placeholder.json",
  sourcePrefix: argument("source-prefix") ?? "context-sources",
  pointerKey: argument("pointer-key") ?? "context-current.json",
});
const storage = createS3ObjectStore({
  endpoint: requiredArgument("endpoint"),
  accessKeyId: requiredEnvironment("AWS_ACCESS_KEY_ID"),
  secretAccessKey: requiredEnvironment("AWS_SECRET_ACCESS_KEY"),
});
await activateRelease(plan, storage);
console.log(`Activated Context ${plan.pointer.releaseId}.`);
