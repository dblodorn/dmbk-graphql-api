import crypto from 'node:crypto';
import { UNIT_FIELDS, type ChimeUnit } from './shape.js';

/**
 * SHA-256 over the units in page order, each as its values in the canonical
 * field order, so identical compositions hash alike whatever order their keys
 * arrived in. At most one stored composition per fingerprint.
 */
export function fingerprint(units: readonly ChimeUnit[]): string {
  const canonical = JSON.stringify(units.map((u) => UNIT_FIELDS.map((f) => u[f])));
  return crypto.createHash('sha256').update(canonical).digest('hex');
}
