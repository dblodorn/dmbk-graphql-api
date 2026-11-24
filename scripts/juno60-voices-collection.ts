/*
 * Creates `dmbk-sound.juno60_voices` with its schema validator and indexes, or brings an existing collection's
 * validator up to date. Run it once before the Juno-60 mutations go live, and again whenever the validator
 * (`src/lib/synth-voices/shape.ts`) changes.
 *
 *   npm run juno60:collection              # report only
 *   npm run juno60:collection -- --apply   # create, or collMod the validator; ensure indexes
 */
import { voiceJsonSchema } from '../src/lib/juno60/shape.js';
import { main } from './synth-voices-collection.js';

main('juno60_voices', voiceJsonSchema);
