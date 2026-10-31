import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { ObjectStore, StoredObject } from "./release-publisher.js";

export function createS3ObjectStore(options: {
  accessKeyId: string;
  endpoint: string;
  secretAccessKey: string;
}): ObjectStore {
  const client = new S3Client({
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
    endpoint: options.endpoint,
    forcePathStyle: true,
    region: "auto",
  });

  return {
    async getObject(bucket, key) {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!response.Body) throw new Error(`Object storage returned no body for ${bucket}/${key}.`);
      return response.Body.transformToByteArray();
    },
    async objectExists(bucket, key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (error) {
        if (typeof error === "object" && error !== null && "$metadata" in error
          && typeof error.$metadata === "object" && error.$metadata !== null
          && "httpStatusCode" in error.$metadata && error.$metadata.httpStatusCode === 404) return false;
        throw error;
      }
    },
    async putObject(object: StoredObject) {
      await client.send(new PutObjectCommand({
        Bucket: object.bucket,
        Key: object.key,
        Body: object.body,
        CacheControl: object.cacheControl,
        ContentType: object.contentType,
        ...(object.createOnly ? { IfNoneMatch: "*" } : {}),
      }));
    },
  };
}
