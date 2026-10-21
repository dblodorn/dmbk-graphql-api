import { z } from 'zod';
import { env } from '../../env.js';

/*
 * A small client for Are.na's v3 API (https://api.are.na/v3/openapi.json),
 * read anonymously. Only the fields this API uses are validated, so a change
 * to anything else on Are.na's side goes unnoticed, and a change to these
 * fails here, in one place, as an UPSTREAM_ERROR.
 *
 * Private channels are dropped from every result. Anonymous reads never see
 * them today; the filter keeps that true if a token is ever added.
 */

export class ArenaNotFoundError extends Error {
  constructor(message = 'Not found on Are.na.') {
    super(message);
    this.name = 'ArenaNotFoundError';
  }
}

export class ArenaRateLimitedError extends Error {
  constructor() {
    super('Are.na is rate limiting this API. Try again in a minute.');
    this.name = 'ArenaRateLimitedError';
  }
}

/** Any other Are.na failure. The message is generic; the detail is logged. */
export class ArenaUpstreamError extends Error {
  constructor() {
    super('Are.na could not be reached.');
    this.name = 'ArenaUpstreamError';
  }
}

const TIMEOUT_MS = 10_000;
export const ARENA_MAX_PER = 100;

const userSchema = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  avatar: z.string().nullish(),
});
export type ArenaUser = z.infer<typeof userSchema>;

const ownerSchema = z.object({
  type: z.string(),
  slug: z.string(),
  name: z.string(),
});

const channelSchema = z.object({
  id: z.number(),
  type: z.literal('Channel'),
  slug: z.string(),
  title: z.string(),
  visibility: z.string(),
  state: z.string().optional(),
  updated_at: z.string(),
  counts: z.object({ blocks: z.number() }).partial().optional(),
  owner: ownerSchema,
});
export type ArenaChannel = z.infer<typeof channelSchema>;

const versionSchema = z.object({ src: z.string() }).nullish();

const imageBlockSchema = z.object({
  id: z.number(),
  type: z.literal('Image'),
  title: z.string().nullish(),
  visibility: z.string().optional(),
  image: z.object({
    src: z.string(),
    width: z.number().nullish(),
    height: z.number().nullish(),
    small: versionSchema,
    medium: versionSchema,
  }),
});
export type ArenaImage = z.infer<typeof imageBlockSchema>;

const groupSchema = z.object({ id: z.number(), slug: z.string() });

const metaSchema = z.object({
  next_page: z.number().nullish(),
  total_count: z.number(),
});

/** A list page whose items are validated one by one; items of other types are skipped. */
const pageSchema = z.object({ data: z.array(z.unknown()), meta: metaSchema });

export interface ArenaPage<T> {
  items: T[];
  nextPage: number | null;
  totalCount: number;
}

async function get(path: string): Promise<unknown> {
  const url = `${env.arenaApiUrl}${path}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    console.error(`[arena] GET ${path} failed:`, error);
    throw new ArenaUpstreamError();
  }
  // Anonymous reads of something private come back 401/403: as far as this
  // API is concerned it isn't there.
  if (res.status === 404 || res.status === 401 || res.status === 403) throw new ArenaNotFoundError();
  if (res.status === 429) throw new ArenaRateLimitedError();
  if (!res.ok) {
    console.error(`[arena] GET ${path} answered ${res.status}`);
    throw new ArenaUpstreamError();
  }
  try {
    return await res.json();
  } catch (error) {
    console.error(`[arena] GET ${path} returned no JSON:`, error);
    throw new ArenaUpstreamError();
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    console.error(`[arena] Unexpected ${what}:`, z.prettifyError(result.error));
    throw new ArenaUpstreamError();
  }
  return result.data;
}

async function getPage<T>(path: string, item: z.ZodType<T>, what: string): Promise<ArenaPage<T>> {
  const page = parse(pageSchema, await get(path), `${what} page`);
  const items: T[] = [];
  for (const raw of page.data) {
    const parsed = item.safeParse(raw);
    if (parsed.success) items.push(parsed.data);
  }
  return { items, nextPage: page.meta.next_page ?? null, totalCount: page.meta.total_count };
}

function isReadable(channel: ArenaChannel): boolean {
  return channel.visibility !== 'private' && channel.state !== 'deleted';
}

const enc = encodeURIComponent;

export async function getUser(slug: string): Promise<ArenaUser> {
  return parse(userSchema, await get(`/users/${enc(slug)}`), 'user');
}

/** Channels a user created, group-owned ones included, recently updated first. */
export async function getUserChannels(userId: number, page: number): Promise<ArenaPage<ArenaChannel>> {
  const result = await getPage(
    `/users/${userId}/contents?type=Channel&sort=updated_at_desc&per=${ARENA_MAX_PER}&page=${page}`,
    channelSchema,
    'user channels',
  );
  return { ...result, items: result.items.filter(isReadable) };
}

export async function getUserGroups(userId: number, page: number): Promise<ArenaPage<z.infer<typeof groupSchema>>> {
  return getPage(`/users/${userId}/groups?per=${ARENA_MAX_PER}&page=${page}`, groupSchema, 'user groups');
}

export async function getGroupChannels(groupId: number, page: number): Promise<ArenaPage<ArenaChannel>> {
  const result = await getPage(
    `/groups/${groupId}/contents?type=Channel&sort=updated_at_desc&per=${ARENA_MAX_PER}&page=${page}`,
    channelSchema,
    'group channels',
  );
  return { ...result, items: result.items.filter(isReadable) };
}

/** A public or closed channel, or null when it is private or doesn't exist. */
export async function getChannel(slug: string): Promise<ArenaChannel | null> {
  try {
    const channel = parse(channelSchema, await get(`/channels/${enc(slug)}`), 'channel');
    return isReadable(channel) ? channel : null;
  } catch (error) {
    if (error instanceof ArenaNotFoundError) return null;
    throw error;
  }
}

/** One page of a channel's image blocks. Other block types are skipped. */
export async function getChannelImages(channelId: number, page: number, per: number): Promise<ArenaPage<ArenaImage>> {
  const result = await getPage(
    `/channels/${channelId}/contents?per=${per}&page=${page}`,
    imageBlockSchema,
    'channel contents',
  );
  return { ...result, items: result.items.filter((block) => block.visibility !== 'private') };
}
