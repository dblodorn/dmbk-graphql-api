import catalog from './catalog.json' with { type: 'json' };

/*
 * windchime's scale names and voice ids, with each voice's display name.
 * `catalog.json` is a copy of windchime's `pnpm catalog` output, not edited by
 * hand. Both lists only ever grow at the end there (share links store them as
 * indices), so every stored composition stays valid. After copying a new
 * version, re-run `npm run chime:collection -- --apply`: the scale enum is part
 * of the collection's validator.
 */

export const SCALES: readonly string[] = catalog.scales;

const VOICES: Readonly<Record<string, string>> = catalog.voices;

export const VOICE_IDS: readonly string[] = Object.keys(VOICES);

/** A unit's voice when it has none of its own: windchime's tubular bells. */
export const DEFAULT_VOICE_NAME = 'TUBULAR BELLS';

export function voiceName(voice: string | null): string {
  return voice === null ? DEFAULT_VOICE_NAME : (VOICES[voice] ?? DEFAULT_VOICE_NAME);
}
