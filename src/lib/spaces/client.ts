import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  type ObjectCannedACL,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../env.js';

/*
 * The DigitalOcean Space shared with dmbk and lora-trainer. Ported from dmbk's
 * `src/lib/spaces/client.ts`; keep the two in step while both apps write.
 */

/** How long a presigned upload URL stays valid. */
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;

const { bucket } = env.spaces;

// With forcePathStyle the SDK puts the bucket in the URL path, so the endpoint
// must not also carry it as a subdomain or the path doubles. Strip it to get
// the regional base.
const client = new S3Client({
  endpoint: env.spaces.endpoint.replace(`${bucket}.`, ''),
  region: env.spaces.region,
  credentials: { accessKeyId: env.spaces.key, secretAccessKey: env.spaces.secret },
  forcePathStyle: true,
});

/**
 * A presigned PUT URL for exactly one key and content type. Grants no read,
 * list, or delete access, and no write access to any other key.
 */
export function presignUpload(key: string, contentType: string): Promise<string> {
  return getSignedUrl(
    client,
    // Originals are archival and never served directly to the public.
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ACL: 'private' }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS },
  );
}

export async function putObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
  acl: ObjectCannedACL,
): Promise<void> {
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, ACL: acl }));
}

/** Reads an object into memory. Throws if the key does not exist. */
export async function getObject(key: string): Promise<Buffer> {
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!res.Body) throw new Error(`Empty body for key: ${key}`);
  return Buffer.from(await res.Body.transformToByteArray());
}

/** Object size in bytes, or null when the key does not exist. */
export async function headObject(key: string): Promise<{ size: number } | null> {
  try {
    const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { size: res.ContentLength ?? 0 };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** Deletes one object. A key that is already gone is not an error. */
export async function deleteObject(key: string): Promise<void> {
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
}

/**
 * Deletes every object belonging to one photo. Takes explicit keys read off the
 * photo document rather than deleting by prefix — this Space is shared with
 * other apps, so nothing here may ever remove a key it was not handed.
 */
export async function deletePhotoObjects(keys: readonly (string | null | undefined)[]): Promise<void> {
  await Promise.all(keys.filter((k): k is string => Boolean(k)).map((k) => deleteObject(k)));
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return name === 'NotFound' || name === 'NoSuchKey' || status === 404;
}
