import { env } from '../../env.js';
import { writeBudget } from '../synth-voices/limits.js';

/* Juno-60 patches' write budgets (`JUNO60_WRITE_*`); the plan is every synth's (`lib/synth-voices/limits.ts`). */
export const takeWrite = writeBudget(env.juno60Writes);
