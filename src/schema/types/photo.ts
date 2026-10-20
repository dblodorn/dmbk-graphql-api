import { builder } from '../builder.js';
import { env } from '../../env.js';
import type { KeywordDoc, PhotoDoc } from '../../models/photos.js';

/** Public CDN URL for a stored derivative key. The original's key never passes through here. */
function publicUrl(key: string | null): string | null {
  return key ? `${env.cdnUrl}/${key}` : null;
}

export const PhotoStatusEnum = builder.enumType('PhotoStatus', {
  description: "Where a photo is in its lifecycle.",
  values: {
    READY: { value: 'ready' },
    PENDING: { value: 'pending' },
    FAILED: { value: 'failed' },
  } as const,
});

export const VisibilityEnum = builder.enumType('Visibility', {
  description: 'Which side of the hidden flag to return.',
  values: {
    VISIBLE: { value: 'visible' },
    HIDDEN: { value: 'hidden' },
    ANY: { value: 'any' },
  } as const,
});

export const PhotoRef = builder.objectRef<PhotoDoc>('Photo');

builder.node(PhotoRef, {
  description: 'A photo from the dmbk library. Non-admins only ever see ready, visible photos.',
  id: { resolve: (photo) => photo._id },
  isTypeOf: (value) => typeof value === 'object' && value !== null && 'originalKey' in value,
  // Goes through the per-request loader, which is already scoped to what the
  // viewer may see — a hidden photo's global ID resolves to null for the public.
  loadMany: (ids, context) => Promise.all(ids.map((id) => context.photoLoader.load(id))),
  fields: (t) => ({
    title: t.exposeString('title', { nullable: true }),
    keywords: t.exposeStringList('keywords', { description: 'Normalized slugs.' }),
    width: t.exposeInt('width', { nullable: true, description: 'Intrinsic pixel width, for reserving layout space.' }),
    height: t.exposeInt('height', { nullable: true }),
    createdAt: t.exposeString('createdAt', { description: 'ISO-8601.' }),
    updatedAt: t.exposeString('updatedAt', { description: 'ISO-8601.' }),
    thumbUrl: t.string({ nullable: true, resolve: (p) => publicUrl(p.thumbKey) }),
    gridUrl: t.string({
      nullable: true,
      description: 'Null when this photo predates the grid variant — absent, not a dead URL.',
      resolve: (p) => publicUrl(p.gridKey),
    }),
    displayUrl: t.string({ nullable: true, resolve: (p) => publicUrl(p.displayKey) }),

    // Admin-only fields resolve to null for everyone else rather than erroring,
    // so one fragment can serve both the public site and the admin.
    hidden: t.boolean({
      nullable: true,
      description: 'Admin only; null otherwise.',
      authScopes: { admin: true },
      unauthorizedResolver: () => null,
      resolve: (p) => p.hidden,
    }),
    status: t.field({
      type: PhotoStatusEnum,
      nullable: true,
      description: 'Admin only; null otherwise.',
      authScopes: { admin: true },
      unauthorizedResolver: () => null,
      resolve: (p) => p.status,
    }),
    failureReason: t.string({
      nullable: true,
      description: 'Admin only. Why finalization rejected this upload, when it did.',
      authScopes: { admin: true },
      unauthorizedResolver: () => null,
      resolve: (p) => p.failureReason,
    }),
  }),
});

export const KeywordRef = builder.objectRef<KeywordDoc>('Keyword').implement({
  description: 'One keyword in the vocabulary.',
  fields: (t) => ({
    slug: t.string({ resolve: (k) => k._id }),
    label: t.exposeString('label', { description: 'First human spelling seen.' }),
    count: t.exposeInt('count', { description: 'Number of publicly visible photos carrying this keyword.' }),
  }),
});
