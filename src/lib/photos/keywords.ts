import { KeywordModel } from '../../models/photos.js';
import { InvalidInputError } from '../cursor.js';

/*
 * Ported verbatim from dmbk's src/lib/photos/keywords.ts. Both apps write the
 * same `keywords` collection while dmbk's write paths are being retired, so
 * normalization and count maintenance must stay byte-for-byte identical —
 * change them in both places or neither.
 */

export const MAX_KEYWORD_LENGTH = 60;

/**
 * Normalize one keyword to its slug: trimmed, lowercased, separator runs
 * collapsed to single hyphens, everything outside letters/digits/hyphens
 * dropped. Returns "" for input that holds no slug characters at all.
 */
export function normalizeKeyword(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Normalize a set of keywords, discarding empties and de-duplicating. Returns
 * slugs alongside the first display label seen for each. Over-long slugs are
 * rejected rather than truncated.
 */
export function normalizeKeywords(inputs: readonly string[]): { slugs: string[]; labels: Map<string, string> } {
  const slugs: string[] = [];
  const labels = new Map<string, string>();

  for (const raw of inputs) {
    const slug = normalizeKeyword(raw);
    if (!slug) continue;
    if (slug.length > MAX_KEYWORD_LENGTH) {
      throw new InvalidInputError(
        `Keyword "${slug}" normalizes to ${slug.length} characters, over the ${MAX_KEYWORD_LENGTH} character limit.`,
      );
    }
    if (!labels.has(slug)) {
      labels.set(slug, raw.trim());
      slugs.push(slug);
    }
  }

  return { slugs, labels };
}

/**
 * Record the display label for each slug without touching counts. The entry
 * sits at count 0 until a photo carrying it is counted, and the vocabulary
 * query filters zero counts out.
 */
export async function registerKeywordLabels(labels: Map<string, string>): Promise<void> {
  if (labels.size === 0) return;
  await Promise.all(
    [...labels].map(([slug, label]) =>
      KeywordModel.updateOne({ _id: slug }, { $setOnInsert: { label, count: 0 } }, { upsert: true }),
    ),
  );
}

/**
 * Apply a keyword-set change to the vocabulary counts. Only slugs that entered
 * or left the set are touched. Pass `previous: []` when a photo becomes
 * counted, and `next: []` when it stops being counted.
 */
export async function applyKeywordDelta(
  previous: readonly string[],
  next: readonly string[],
  labels?: Map<string, string>,
): Promise<void> {
  const before = new Set(previous);
  const after = new Set(next);

  const added = [...after].filter((s) => !before.has(s));
  const removed = [...before].filter((s) => !after.has(s));

  if (added.length === 0 && removed.length === 0) return;

  await Promise.all([
    ...added.map((slug) =>
      KeywordModel.updateOne(
        { _id: slug },
        // Retain the first label seen; later spellings do not overwrite it.
        { $inc: { count: 1 }, $setOnInsert: { label: labels?.get(slug) ?? slug } },
        { upsert: true },
      ),
    ),
    ...removed.map((slug) => KeywordModel.updateOne({ _id: slug }, { $inc: { count: -1 } })),
  ]);

  // A slug nothing carries anymore is dropped rather than left at zero.
  if (removed.length) {
    await KeywordModel.deleteMany({ _id: { $in: removed }, count: { $lte: 0 } });
  }
}
