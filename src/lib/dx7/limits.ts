import { env } from '../../env.js';
import { writeBudget } from '../synth-voices/limits.js';

/* DX7 voices' write budgets (`DX7_WRITE_*`); the plan is every synth's (`lib/synth-voices/limits.ts`). */
export const takeWrite = writeBudget(env.dx7Writes);
