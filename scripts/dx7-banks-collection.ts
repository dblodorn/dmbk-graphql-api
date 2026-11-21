/*
 * Creates `dmbk-sound.dx7_banks` with its schema validator and indexes (the voices' three: unique creator +
 * fingerprint, the public listing, one key's listing), or brings its validator up to date.
 *
 *   npm run dx7:banks-collection              # report only
 *   npm run dx7:banks-collection -- --apply   # create, or collMod the validator; ensure indexes
 */
import { bankJsonSchema } from '../src/lib/dx7/banks.js';
import { main } from './synth-voices-collection.js';

main('dx7_banks', bankJsonSchema);
