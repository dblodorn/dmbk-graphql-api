import { cursorFor, type Page } from '../lib/cursor.js';

/** Shape a keyset page as a Relay connection. Forward-only, so no previous page. */
export function toConnection<T extends { _id: string; createdAt: string }>(page: Page<T>) {
  const edges = page.nodes.map((node) => ({ cursor: cursorFor(node), node }));
  return {
    edges,
    pageInfo: {
      hasNextPage: page.hasNextPage,
      hasPreviousPage: false,
      startCursor: edges[0]?.cursor ?? null,
      endCursor: edges[edges.length - 1]?.cursor ?? null,
    },
  };
}
