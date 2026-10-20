import type { SupportedContentType } from '../photos/images.js';

/*
 * Storage keys for photos, identical to dmbk's `src/lib/spaces/keys.ts` — both
 * apps finalize and delete each other's photos while they share the Space.
 */

/** Prefix for everything photos own in the shared Space. lora-trainer uses `lora-trainer/`. */
export const PHOTOS_PREFIX = 'photos';

const EXTENSION_BY_CONTENT_TYPE: Record<SupportedContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

/**
 * Key for a photo's original. The extension comes from the validated content
 * type, never from anything the client names, so a caller cannot influence
 * where bytes land.
 */
export function originalKey(id: string, contentType: SupportedContentType): string {
  return `${PHOTOS_PREFIX}/${id}/original.${EXTENSION_BY_CONTENT_TYPE[contentType]}`;
}

/** Derivatives are always WebP, so the URL shape stays predictable. */
export function displayKey(id: string): string {
  return `${PHOTOS_PREFIX}/${id}/display.webp`;
}

export function gridKey(id: string): string {
  return `${PHOTOS_PREFIX}/${id}/grid.webp`;
}

export function thumbKey(id: string): string {
  return `${PHOTOS_PREFIX}/${id}/thumb.webp`;
}
