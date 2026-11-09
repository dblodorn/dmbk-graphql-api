import { voiceName } from './catalog.js';
import type { ChimeUnit } from './shape.js';

/*
 * A composition's title, made by the API from its units so no client text
 * reaches the public list. It names the ensemble size, a key and an instrument,
 * sampling among the units when they differ. Every choice is drawn from the
 * fingerprint, so a composition always gets the same title.
 */

export const MAX_TITLE = 40;

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ENSEMBLES = ['SOLO', 'DUO', 'TRIO', 'QUARTET', 'QUINTET', 'SEXTET', 'SEPTET', 'OCTET'];

type Parts = { key: string; instrument: string; ensemble: string | null };

const TEMPLATES: ((p: Parts) => string)[] = [
  ({ key, instrument, ensemble }) => [key, instrument, ensemble].filter(Boolean).join(' '),
  ({ key, instrument, ensemble }) => [instrument, ensemble, 'IN', key].filter(Boolean).join(' '),
  ({ key, instrument, ensemble }) => [key, ensemble, 'FOR', instrument].filter(Boolean).join(' '),
];

/** mulberry32: small, fast, and plenty for picking words. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Voice display names without parenthesised parts, version tags or the font's `TB` (Tim Brechbill) tag. */
export function instrumentWord(voice: string | null, instrument?: string): string {
  const name = voiceName(voice, instrument)
    .toUpperCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bV\d+(\.\d+)*\b/g, ' ')
    .replace(/\bTB\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return name || 'CHIMES';
}

export function ensembleWord(count: number): string {
  return ENSEMBLES[count - 1] ?? `${count} CHIMES`;
}

export function compositionTitle(units: readonly ChimeUnit[], fingerprint: string): string {
  const next = random(parseInt(fingerprint.slice(0, 8), 16));
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)];

  const keyUnit = pick(units);
  // a furin plays its root alone, so its key is just the note
  const note = NOTES[keyUnit.root % 12];
  const key = keyUnit.instrument === 'furin' ? note : `${note} ${keyUnit.scale}`;
  const voiceUnit = pick(units);
  const instrument = instrumentWord(voiceUnit.voice, voiceUnit.instrument);
  const template = pick(TEMPLATES);

  // Too long: drop the ensemble word, then cut the instrument to its first word.
  const tries: Parts[] = [
    { key, instrument, ensemble: ensembleWord(units.length) },
    { key, instrument, ensemble: null },
    { key, instrument: instrument.split(' ')[0], ensemble: null },
  ];
  for (const parts of tries) {
    const title = template(parts);
    if (title.length <= MAX_TITLE) return title;
  }
  return key.slice(0, MAX_TITLE);
}
