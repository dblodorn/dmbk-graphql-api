import sharp, { type Metadata } from 'sharp';
import { InvalidInputError } from '../cursor.js';

/*
 * Upload limits, image inspection, and derivative generation. Ported from
 * dmbk's `src/lib/photos/constants.ts` and `derivatives.ts` (combined here —
 * there is no client bundle to keep sharp out of). The limits, edges, and
 * output format must stay identical to dmbk's while both apps finalize.
 */

// One 2 GB droplet serves every request, unlike dmbk's per-request functions.
// A single thread and no cache keep one large original's decode from
// multiplying across pipelines (see the change's design: "Memory").
sharp.concurrency(1);
sharp.cache(false);

/** Content types accepted for an original upload. */
export const SUPPORTED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;

export type SupportedContentType = (typeof SUPPORTED_CONTENT_TYPES)[number];

export function isSupportedContentType(value: string): value is SupportedContentType {
  return (SUPPORTED_CONTENT_TYPES as readonly string[]).includes(value);
}

/** Largest original accepted, in bytes. */
export const MAX_ORIGINAL_BYTES = 50 * 1024 * 1024;

/** Longest edge of each generated derivative, in pixels. */
export const THUMB_MAX_EDGE = 400;
/** Sized for the gallery's widest grid at 2x; see dmbk's constants.ts. */
export const GRID_MAX_EDGE = 1000;
export const DISPLAY_MAX_EDGE = 1600;

/** sharp's format names mapped back to the content types we accept. */
const CONTENT_TYPE_BY_FORMAT: Record<string, SupportedContentType> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
};

export interface InspectedImage {
  width: number;
  height: number;
  byteSize: number;
  contentType: SupportedContentType;
}

/**
 * Decode the stored bytes and report what they actually are. The content type
 * declared at reservation is a routing hint, never proof.
 */
export async function inspectImage(buffer: Buffer): Promise<InspectedImage> {
  if (buffer.byteLength > MAX_ORIGINAL_BYTES) {
    throw new InvalidInputError(`Image is ${buffer.byteLength} bytes, over the ${MAX_ORIGINAL_BYTES} byte limit.`);
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    throw new InvalidInputError('Uploaded bytes do not decode as an image.');
  }

  const { format, width, height, orientation, compression } = metadata;
  if (!format || !width || !height) {
    throw new InvalidInputError('Uploaded bytes do not decode as an image.');
  }

  // sharp reports AVIF as `heif`, its container, so the map alone would reject
  // AVIF at finalize despite accepting it at reserve (as dmbk's does). Only AV1
  // compression is AVIF; `hevc` is HEIC, which stays unsupported.
  const contentType = format === 'heif' && compression === 'av1' ? 'image/avif' : CONTENT_TYPE_BY_FORMAT[format];
  if (!contentType) throw new InvalidInputError(`Unsupported image format: ${format}.`);

  // Derivatives go through .rotate(), which applies EXIF orientation; for
  // orientations 5-8 the rendered image is quarter-turned, so record swapped
  // dimensions or a portrait phone photo reports landscape.
  const quarterTurned = typeof orientation === 'number' && orientation >= 5;

  return {
    width: quarterTurned ? height : width,
    height: quarterTurned ? width : height,
    byteSize: buffer.byteLength,
    contentType,
  };
}

export interface Derivative {
  body: Buffer;
  contentType: 'image/webp';
}

/** Fit within `maxEdge` on the longest side; never enlarge a small original. */
async function resize(buffer: Buffer, maxEdge: number): Promise<Derivative> {
  const body = await sharp(buffer)
    .rotate() // honor EXIF orientation before measuring edges
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .webp()
    .toBuffer();
  return { body, contentType: 'image/webp' };
}

export const makeThumb = (buffer: Buffer) => resize(buffer, THUMB_MAX_EDGE);
export const makeGrid = (buffer: Buffer) => resize(buffer, GRID_MAX_EDGE);
export const makeDisplay = (buffer: Buffer) => resize(buffer, DISPLAY_MAX_EDGE);
