import { calls, type Database } from "@answerline/db";
import { callIdSchema } from "@answerline/shared";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { and, eq } from "drizzle-orm";

export const RECORDING_URL_TTL_SECONDS = 300;

export interface RecordingStorage {
  bucket: string;
  presignGet: (key: string) => Promise<string>;
}

const S3_URL_PATTERN = /^s3:\/\/([^/]+)\/(.+)$/;

export interface RecordingStorageConfig {
  accessKeyId?: string;
  bucket: string;
  endpoint?: string;
  region: string;
  secretAccessKey?: string;
}

export function createRecordingStorage(config: RecordingStorageConfig): RecordingStorage {
  const client = new S3Client({
    credentials:
      config.accessKeyId && config.secretAccessKey
        ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
        : undefined,
    endpoint: config.endpoint,
    forcePathStyle: Boolean(config.endpoint),
    region: config.region,
  });
  return {
    bucket: config.bucket,
    presignGet: (key) =>
      getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: key }), {
        expiresIn: RECORDING_URL_TTL_SECONDS,
      }),
  };
}

export function parseRecordingUrl(url: string) {
  const match = S3_URL_PATTERN.exec(url);
  const bucket = match?.[1];
  const key = match?.[2];
  if (!(bucket && key) || key.startsWith("/") || key.split("/").includes("..")) {
    return null;
  }
  return { bucket, key };
}

export async function getCallRecordingUrl(
  db: Database,
  tenantId: string,
  rawId: string,
  storage: RecordingStorage
) {
  const parsed = callIdSchema.safeParse(rawId);
  if (!parsed.success) {
    return null;
  }
  const [call] = await db
    .select({ recordingUrl: calls.recordingUrl })
    .from(calls)
    .where(and(eq(calls.id, parsed.data), eq(calls.tenantId, tenantId)))
    .limit(1);
  if (!call?.recordingUrl) {
    return null;
  }
  const location = parseRecordingUrl(call.recordingUrl);
  if (!location || location.bucket !== storage.bucket) {
    return null;
  }
  return storage.presignGet(location.key);
}
