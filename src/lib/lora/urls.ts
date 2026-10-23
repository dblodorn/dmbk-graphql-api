import { env } from '../../env.js';
import { InvalidInputError } from '../cursor.js';

/*
 * URL rules for LoRA writes. Records are public once completed, and every URL
 * in them is rendered by lora-trainer, so a write can't point them anywhere a
 * client likes:
 *
 * - every URL is absolute `https`;
 * - a field that claims to be a Spaces mirror (the training zip, mirrored
 *   source images, an image's CDN copy) must sit under the shared Space's CDN,
 *   in lora-trainer's `lora-trainer/` prefix, because readers prefer those
 *   fields over the originals.
 *
 * Source and fal.ai URLs are only checked for `https`: this API never fetches
 * them, and lora-trainer SSRF-guards what it downloads.
 */

function parse(url: string, field: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InvalidInputError(`${field} is not a valid URL.`);
  }
  if (parsed.protocol !== 'https:') throw new InvalidInputError(`${field} must be an https URL.`);
  return parsed;
}

export function assertHttpsUrl(url: string, field: string): void {
  parse(url, field);
}

/**
 * Compared after `new URL()` has normalized the path, so `…/lora-trainer/../x`
 * is judged by where it really points.
 */
export function assertMirrorUrl(url: string, field: string): void {
  const parsed = parse(url, field);
  const base = new URL(`${env.cdnUrl}/lora-trainer/`);
  if (parsed.origin !== base.origin || !parsed.pathname.startsWith(base.pathname)) {
    throw new InvalidInputError(`${field} must be a lora-trainer URL on the Spaces CDN.`);
  }
}
