import { initContextCache } from '@pothos/core';
import DataLoader from 'dataloader';
import type { Viewer } from './auth/token.js';
import type { PhotoDoc } from './models/photos.js';
import type { GeneratedImageDoc, LoraTrainingDoc } from './models/lora.js';
import { ADMIN_SCOPE, PUBLIC_SCOPE, loadPhotos } from './lib/photos/repository.js';
import { loadImages, loadTrainings } from './lib/lora/repository.js';

export interface ContextType {
  viewer: Viewer | null;
  /**
   * Per-request loaders, already scoped to what this viewer may see: a record
   * outside the viewer's visibility loads as null. Node lookups and nested
   * fields both go through these, so neither can bypass visibility.
   */
  photoLoader: DataLoader<string, PhotoDoc | null>;
  trainingLoader: DataLoader<string, LoraTrainingDoc | null>;
  imageLoader: DataLoader<string, GeneratedImageDoc | null>;
}

export function createContext(viewer: Viewer | null): ContextType {
  const photoScope = viewer?.isAdmin ? ADMIN_SCOPE : PUBLIC_SCOPE;
  return {
    viewer,
    photoLoader: new DataLoader((ids) => loadPhotos(ids, photoScope)),
    trainingLoader: new DataLoader((ids) => loadTrainings(ids, viewer)),
    imageLoader: new DataLoader((ids) => loadImages(ids, viewer)),
    ...initContextCache(),
  };
}
