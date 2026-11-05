import { initContextCache } from '@pothos/core';
import DataLoader from 'dataloader';
import type { Viewer } from './auth/viewer.js';
import type { PhotoDoc } from './models/photos.js';
import type { GeneratedImageDoc, LoraTrainingDoc } from './models/lora.js';
import type { ChimeCompositionDoc } from './models/chime.js';
import { ADMIN_SCOPE, PUBLIC_SCOPE, loadPhotos } from './lib/photos/repository.js';
import { loadImages, loadTrainings } from './lib/lora/repository.js';
import { loadCompositions } from './lib/chime/repository.js';

export interface ContextType {
  /** The incoming request; `signOut` needs its bearer token. */
  request: Request;
  viewer: Viewer | null;
  /** The client app named by the request's API key; null for keyless requests. For logs. */
  client: string | null;
  /** The visitor a client request acts for (`X-End-User-IP`); null otherwise. Keys save limits only. */
  endUserIp: string | null;
  /**
   * Per-request loaders, already scoped to what this viewer may see: a record
   * outside the viewer's visibility loads as null. Node lookups and nested
   * fields both go through these, so neither can bypass visibility.
   */
  photoLoader: DataLoader<string, PhotoDoc | null>;
  trainingLoader: DataLoader<string, LoraTrainingDoc | null>;
  imageLoader: DataLoader<string, GeneratedImageDoc | null>;
  compositionLoader: DataLoader<string, ChimeCompositionDoc | null>;
}

export function createContext(
  request: Request,
  viewer: Viewer | null,
  client: string | null = null,
  endUserIp: string | null = null,
): ContextType {
  const photoScope = viewer?.isAdmin ? ADMIN_SCOPE : PUBLIC_SCOPE;
  return {
    request,
    viewer,
    client,
    endUserIp,
    photoLoader: new DataLoader((ids) => loadPhotos(ids, photoScope)),
    trainingLoader: new DataLoader((ids) => loadTrainings(ids, viewer)),
    imageLoader: new DataLoader((ids) => loadImages(ids, viewer)),
    compositionLoader: new DataLoader((ids) => loadCompositions(ids, viewer?.isAdmin === true)),
    ...initContextCache(),
  };
}
