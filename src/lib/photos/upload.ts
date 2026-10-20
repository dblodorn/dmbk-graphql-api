import { randomUUID } from 'node:crypto';
import type { PhotoDoc } from '../../models/photos.js';
import { InvalidInputError } from '../cursor.js';
import { deletePhotoObjects, getObject, headObject, presignUpload, putObject } from '../spaces/client.js';
import { displayKey, gridKey, originalKey, thumbKey } from '../spaces/keys.js';
import {
  MAX_ORIGINAL_BYTES,
  SUPPORTED_CONTENT_TYPES,
  inspectImage,
  isSupportedContentType,
  makeDisplay,
  makeGrid,
  makeThumb,
} from './images.js';
import {
  PhotoNotFoundError,
  createPendingPhoto,
  deletePhoto,
  getPhotoDoc,
  markPhotoFailed,
  promoteToReady,
} from './repository.js';

/*
 * The upload and delete flows: reserve → client PUTs to storage → finalize,
 * and delete. Ported from dmbk's tRPC procedures (`reserveUpload`,
 * `finalizeUpload`, `delete` in `src/server/api/features/photos.ts`), where
 * this orchestration lives in the transport; here it sits below the schema so
 * resolvers stay thin.
 */

/** The record was deleted but its stored objects were not. */
export class StorageCleanupError extends Error {
  constructor(id: string) {
    super(`Photo ${id} was deleted, but its stored files could not be removed.`);
    this.name = 'StorageCleanupError';
  }
}

/**
 * Create the `pending` record and a presigned URL for the original. The id is
 * ours, not the client's, so a caller cannot choose where its bytes land,
 * predict a pending key, or collide with an existing object.
 */
export async function reservePhotoUpload(input: {
  contentType: string;
  byteSize: number;
  title?: string | null;
  keywords?: readonly string[] | null;
}): Promise<{ photo: PhotoDoc; uploadUrl: string }> {
  const { contentType, byteSize } = input;
  if (!isSupportedContentType(contentType)) {
    throw new InvalidInputError(
      `Unsupported content type: ${contentType}. Expected one of ${SUPPORTED_CONTENT_TYPES.join(', ')}.`,
    );
  }
  if (!Number.isInteger(byteSize) || byteSize <= 0 || byteSize > MAX_ORIGINAL_BYTES) {
    throw new InvalidInputError(`byteSize must be between 1 and ${MAX_ORIGINAL_BYTES} bytes.`);
  }

  const id = randomUUID();
  const key = originalKey(id, contentType);
  const photo = await createPendingPhoto({
    id,
    originalKey: key,
    contentType,
    title: input.title,
    keywords: input.keywords,
  });

  return { photo, uploadUrl: await presignUpload(key, contentType) };
}

// One finalize at a time. Each holds a full original and its decode in memory,
// and the whole API shares one 2 GB droplet — a batch must not stack them.
let finalizeQueue: Promise<unknown> = Promise.resolve();

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = finalizeQueue.then(fn, fn);
  finalizeQueue = run.catch(() => undefined);
  return run;
}

/**
 * Validate the uploaded original, generate derivatives, and promote the record
 * to `ready`. A failure at any step after the record is found pending marks it
 * `failed` with a reason rather than leaving it half-promoted.
 */
export function finalizePhoto(input: {
  id: string;
  title?: string | null;
  keywords?: readonly string[] | null;
}): Promise<PhotoDoc> {
  return serialized(async () => {
    const doc = await getPhotoDoc(input.id);
    if (!doc) throw new PhotoNotFoundError(input.id);
    if (doc.status !== 'pending') {
      throw new InvalidInputError(`Photo ${input.id} is ${doc.status}, not pending.`);
    }

    if (!(await headObject(doc.originalKey))) {
      const reason = 'Upload was never completed; no object at the key.';
      await markPhotoFailed(doc._id, reason);
      throw new InvalidInputError(reason);
    }

    try {
      const buffer = await getObject(doc.originalKey);
      const inspected = await inspectImage(buffer);

      // One at a time, unlike dmbk's Promise.all: see `serialized` above.
      const keys = { thumb: thumbKey(doc._id), grid: gridKey(doc._id), display: displayKey(doc._id) };
      for (const [key, make] of [
        [keys.thumb, makeThumb],
        [keys.grid, makeGrid],
        [keys.display, makeDisplay],
      ] as const) {
        const derivative = await make(buffer);
        await putObject(key, derivative.body, derivative.contentType, 'public-read');
      }

      return await promoteToReady({
        id: doc._id,
        displayKey: keys.display,
        gridKey: keys.grid,
        thumbKey: keys.thumb,
        width: inspected.width,
        height: inspected.height,
        byteSize: inspected.byteSize,
        contentType: inspected.contentType,
        title: input.title,
        keywords: input.keywords,
        replaceTitle: input.title !== undefined,
        replaceKeywords: input.keywords !== undefined,
      });
    } catch (error) {
      await markPhotoFailed(doc._id, error instanceof Error ? error.message : 'Finalization failed.');
      throw error;
    }
  });
}

/** Remove the record, its keyword counts, and exactly the objects it recorded. */
export async function deletePhotoWithFiles(id: string): Promise<void> {
  const keys = await deletePhoto(id);
  try {
    // Null keys (never finalized, or finalized before the grid variant) are
    // skipped; a key already gone from storage is not an error.
    await deletePhotoObjects([keys.originalKey, keys.displayKey, keys.gridKey, keys.thumbKey]);
  } catch (error) {
    // The record is gone, so the photo is correctly unreadable. Surface the
    // orphaned bytes for cleanup rather than reporting a clean delete.
    console.error(`[photos] Deleted record ${id} but failed to remove its objects:`, error);
    throw new StorageCleanupError(id);
  }
}
