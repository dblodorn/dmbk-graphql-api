import { InvalidInputError } from '../cursor.js';
import {
  ARENA_MAX_PER,
  getChannelImages,
  getGroupChannels,
  getUserChannels,
  getUserGroups,
  type ArenaChannel,
  type ArenaImage,
  type ArenaPage,
} from './client.js';

/*
 * The channels behind `Viewer.arena.channels`: the user's own (group-owned
 * included) plus every public channel of the groups they belong to, merged,
 * de-duplicated and newest first.
 *
 * The merged list is built per request and paginated in memory. Paging Are.na
 * lazily across several sources isn't worth it for one user's channels; the
 * list is capped instead.
 */

export const CHANNEL_CAP = 1_000;
const GROUP_CONCURRENCY = 4;

export type ChannelSource = 'all' | 'own' | 'groups';

async function collect<T>(fetchPage: (page: number) => Promise<ArenaPage<T>>, cap: number): Promise<T[]> {
  const items: T[] = [];
  let page: number | null = 1;
  while (page !== null && items.length < cap) {
    const result: ArenaPage<T> = await fetchPage(page);
    items.push(...result.items);
    page = result.nextPage;
  }
  return items.slice(0, cap);
}

/** Run `fn` over `items`, at most `limit` at a time. */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface ChannelList {
  channels: ArenaChannel[];
  /** True when the sources held more than `CHANNEL_CAP` channels. */
  truncated: boolean;
}

export async function listChannelsFor(arenaUserId: number, source: ChannelSource): Promise<ChannelList> {
  const lists: ArenaChannel[][] = [];

  if (source !== 'groups') {
    lists.push(await collect((page) => getUserChannels(arenaUserId, page), CHANNEL_CAP + 1));
  }

  if (source !== 'own') {
    const groups = await collect((page) => getUserGroups(arenaUserId, page), CHANNEL_CAP);
    const perGroup = await mapLimited(groups, GROUP_CONCURRENCY, async (group) => {
      try {
        return await collect((page) => getGroupChannels(group.id, page), CHANNEL_CAP + 1);
      } catch (error) {
        // One group's failure shouldn't hide everything else.
        console.error(`[arena] Skipping group ${group.slug}:`, error);
        return [];
      }
    });
    lists.push(...perGroup);
  }

  const byId = new Map<number, ArenaChannel>();
  for (const channel of lists.flat()) byId.set(channel.id, channel);
  const channels = [...byId.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return { channels: channels.slice(0, CHANNEL_CAP), truncated: channels.length > CHANNEL_CAP };
}

// ---------------------------------------------------------------------------
// Cursors. Channels page by offset into the merged list; images by Are.na page.

interface OffsetCursor {
  o: number;
}

interface PageCursor {
  p: number;
  n: number;
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decode(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new InvalidInputError('Invalid cursor.');
}

function pageSize(first: number | null | undefined, fallback: number): number {
  if (first == null) return fallback;
  if (!Number.isInteger(first) || first < 1 || first > ARENA_MAX_PER) {
    throw new InvalidInputError(`first must be between 1 and ${ARENA_MAX_PER}.`);
  }
  return first;
}

export interface ConnectionArgs {
  first?: number | null;
  after?: string | null;
  last?: number | null;
  before?: string | null;
}

/** Forward-only, like every connection in this API. */
function refuseBackward(args: ConnectionArgs): void {
  if (args.last != null || args.before != null) {
    throw new InvalidInputError('Connections are forward-only: use first/after.');
  }
}

/** A Relay connection over the merged channel list. */
export function channelConnection({ channels }: ChannelList, args: ConnectionArgs) {
  refuseBackward(args);
  const size = pageSize(args.first, 50);
  let start = 0;
  if (args.after) {
    const { o } = decode(args.after) as Partial<OffsetCursor>;
    if (typeof o !== 'number' || !Number.isInteger(o) || o < 0) throw new InvalidInputError('Invalid cursor.');
    start = o + 1;
  }
  const slice = channels.slice(start, start + size);
  const edges = slice.map((node, i) => ({ cursor: encode({ o: start + i } satisfies OffsetCursor), node }));
  return {
    edges,
    totalCount: channels.length,
    pageInfo: {
      hasNextPage: start + size < channels.length,
      hasPreviousPage: start > 0,
      startCursor: edges[0]?.cursor ?? null,
      endCursor: edges[edges.length - 1]?.cursor ?? null,
    },
  };
}

/**
 * A Relay connection over a channel's image blocks, one Are.na page per
 * request. The cursor carries the page size, so later pages line up even if a
 * client changes `first`. A page can hold fewer than `first` images, since
 * other block types on it are skipped.
 */
export async function imageConnection(channelId: number, args: ConnectionArgs) {
  refuseBackward(args);
  let page = 1;
  let per = pageSize(args.first, ARENA_MAX_PER);
  if (args.after) {
    const { p, n } = decode(args.after) as Partial<PageCursor>;
    if (typeof p !== 'number' || typeof n !== 'number' || p < 1 || n < 1 || n > ARENA_MAX_PER) {
      throw new InvalidInputError('Invalid cursor.');
    }
    page = p + 1;
    per = n;
  }
  const result = await getChannelImages(channelId, page, per);
  const cursor = encode({ p: page, n: per } satisfies PageCursor);
  const edges = result.items.map((node: ArenaImage) => ({ cursor, node }));
  return {
    edges,
    pageInfo: {
      hasNextPage: result.nextPage !== null,
      hasPreviousPage: page > 1,
      // Set even when this page held no images, so the client can move past it.
      startCursor: cursor,
      endCursor: cursor,
    },
  };
}
