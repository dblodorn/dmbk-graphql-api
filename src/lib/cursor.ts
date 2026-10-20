/**
 * Keyset pagination over `(createdAt, _id)`, newest first — the same ordering
 * and the same opaque encoding the dmbk app issues, so its cursors and ours are
 * interchangeable during migration.
 *
 * The `_id` tie-breaker makes the sort total: without it, two records sharing a
 * `createdAt` could repeat or vanish across a page boundary.
 */
export interface Cursor {
  createdAt: string;
  id: string;
}

export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 100;

export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Null for anything malformed; callers reject it rather than serving page one. */
export function decodeCursor(value: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { createdAt, id } = parsed as Partial<Cursor>;
    if (typeof createdAt !== 'string' || typeof id !== 'string' || !createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export interface PageArgs {
  first?: number | null;
  after?: string | null;
  last?: number | null;
  before?: string | null;
}

export interface Page<T> {
  nodes: T[];
  hasNextPage: boolean;
}

/**
 * Forward-only keyset paging. Relay's `last`/`before` are refused rather than
 * ignored, so a client asking for them learns it is unsupported instead of
 * silently getting the first page.
 */
export async function paginate<T extends { _id: string; createdAt: string }>(
  args: PageArgs,
  baseFilter: Record<string, unknown>,
  fetch: (filter: Record<string, unknown>, limit: number) => Promise<T[]>,
): Promise<Page<T>> {
  if (args.last != null || args.before != null) {
    throw new InvalidInputError('Only forward pagination (first/after) is supported.');
  }

  let limit = DEFAULT_PAGE_SIZE;
  if (args.first != null) {
    if (!Number.isInteger(args.first) || args.first < 1) {
      throw new InvalidInputError('`first` must be a positive integer.');
    }
    // Oversized requests are served at the cap rather than rejected.
    limit = Math.min(args.first, MAX_PAGE_SIZE);
  }

  const filter: Record<string, unknown> = { ...baseFilter };
  if (args.after) {
    const cursor = decodeCursor(args.after);
    if (!cursor) throw new InvalidInputError('Malformed cursor.');
    filter.$or = [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
    ];
  }

  // One extra row tells us whether a further page exists without a count().
  const docs = await fetch(filter, limit + 1);
  return { nodes: docs.slice(0, limit), hasNextPage: docs.length > limit };
}

export function cursorFor(doc: { _id: string; createdAt: string }): string {
  return encodeCursor({ createdAt: doc.createdAt, id: doc._id });
}
