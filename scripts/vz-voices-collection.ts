/*
 * Creates `dmbk-sound.vz_voices` with its schema validator and indexes, or brings an existing collection's
 * validator up to date. Run it once before the VZ-voice mutations go live, and again whenever the validator
 * (`src/lib/synth-voices/shape.ts`) changes.
 *
 *   npm run vz:collection              # report only
 *   npm run vz:collection -- --apply   # create, or collMod the validator; ensure indexes
 *   npm run vz:collection -- --apply --collection vz_voices_scratch   # a throwaway copy, for testing
 */
import { voiceJsonSchema } from '../src/lib/vz/shape.js';
import { main } from './synth-voices-collection.js';

main('vz_voices', voiceJsonSchema);
