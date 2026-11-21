import { env } from '../../env.js';
import { writeBudget } from '../synth-voices/limits.js';

/* VZ voices' write budgets (`VZ_WRITE_*`); the plan is every synth's (`lib/synth-voices/limits.ts`). */
export const takeWrite = writeBudget(env.vzWrites);
