/*
 * Creates `dmbk-sound.dx7_voices` with its schema validator and indexes, or brings an existing collection's
 * validator up to date. Run it once before the DX7-voice mutations go live, and again whenever the validator
 * (`src/lib/synth-voices/shape.ts`) changes.
 *
 *   npm run dx7:collection              # report only
 *   npm run dx7:collection -- --apply   # create, or collMod the validator; ensure indexes
 *   npm run dx7:collection -- --apply --collection dx7_voices_scratch   # a throwaway copy, for testing
 */
import { voiceJsonSchema } from '../src/lib/dx7/shape.js';
import { main } from './synth-voices-collection.js';

main('dx7_voices', voiceJsonSchema);
