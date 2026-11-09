import crypto from 'node:crypto';
import { DEFAULT_INSTRUMENT, UNIT_FIELDS, type ChimeUnit } from './shape.js';

/**
 * SHA-256 over the units in page order, each as its values in the canonical
 * field order, so identical compositions hash alike whatever order their keys
 * arrived in. At most one stored composition per fingerprint. A tube chime
 * hashes as it did before `instrument` existed; any other instrument is
 * appended to its unit's entry, so stored fingerprints never change.
 */
export function fingerprint(units: readonly ChimeUnit[]): string {
  const canonical = JSON.stringify(units.map((u) => {
    const entry: unknown[] = UNIT_FIELDS.map((f) => u[f]);
    if ((u.instrument ?? DEFAULT_INSTRUMENT) !== DEFAULT_INSTRUMENT) entry.push(u.instrument);
    return entry;
  }));
  return crypto.createHash('sha256').update(canonical).digest('hex');
}
