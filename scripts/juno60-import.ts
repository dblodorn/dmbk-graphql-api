/*
 * Imports Juno-60 patches from the juno60 editor's .json patch files (`format: "dmbk-juno60-patches"`, version 1:
 * `{ name, values }` with each panel control's stored value) into `dmbk-sound.juno60_voices` through `saveVoice`,
 * so every patch gets the same checks as a save from the editor. All are saved under one device key,
 * JUNO60_IMPORT_KEY (32 random bytes, base64url), so they can be updated or removed later with the usual mutations;
 * re-running with the same key and files saves nothing new.
 *
 *   npm run juno60:import -- <files.json…>            # report only
 *   npm run juno60:import -- --apply <files.json…>    # save
 *
 * Roland's 56 factory patches are `factory/roland-juno60-factory.json` in dblodorn/juno60.
 *
 * The byte layout below must match the editor's (`packages/roland-juno60-engine/src/params.ts` in dblodorn/juno60):
 * one byte per field in this order, a value missing from the file takes the editor's INIT value, and the name is 16
 * ASCII characters at byte 26. The listing is newest first, so patches are saved last first: the list then reads in
 * file order.
 */
import { readFileSync } from 'node:fs';
import mongoose from 'mongoose';
import { connectDatabase } from '../src/db/mongoose.js';
import { saveVoice } from '../src/lib/juno60/repository.js';
import { VOICE_BYTES } from '../src/lib/juno60/shape.js';

// [key, byte, max, INIT value], as the editor's params.ts and INIT_VALUES
const FIELDS: readonly (readonly [string, number, number, number])[] = [
  ['lfoRate', 0, 127, 64], ['lfoDelay', 1, 127, 0], ['dcoLfo', 2, 127, 0], ['dcoPwm', 3, 127, 0], ['dcoSub', 4, 127, 0],
  ['dcoNoise', 5, 127, 0], ['vcfFreq', 6, 127, 127], ['vcfRes', 7, 127, 0], ['vcfEnv', 8, 127, 0], ['vcfLfo', 9, 127, 0],
  ['vcfKybd', 10, 127, 0], ['vcaLevel', 11, 127, 64], ['envA', 12, 127, 0], ['envD', 13, 127, 0], ['envS', 14, 127, 127],
  ['envR', 15, 127, 25], ['hpf', 16, 3, 0], ['range', 17, 2, 1], ['pulse', 18, 1, 0], ['saw', 19, 1, 1], ['sub', 20, 1, 0],
  ['pwmMode', 21, 2, 1], ['vcfPolarity', 22, 1, 0], ['vcaMode', 23, 1, 0], ['chorus', 24, 3, 0], ['lfoTrigger', 25, 1, 0],
];
const NAME_BYTE = 26, NAME_LENGTH = 16;

interface PatchFile { format?: string; version?: number; patches?: { name?: unknown; values?: Record<string, unknown> }[] }

function toBytes(name: string, values: Record<string, unknown>, where: string): Uint8Array {
  const b = new Uint8Array(VOICE_BYTES);
  for (const [key, byte, max, init] of FIELDS) {
    const v = values[key] ?? init;
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > max) throw new Error(`${where}: ${key} is ${String(v)}, outside 0–${max}.`);
    b[byte] = v as number;
  }
  const clean = name.toUpperCase().replace(/[^\x20-\x7e]/g, ' ').slice(0, NAME_LENGTH);
  for (let i = 0; i < NAME_LENGTH; i++) b[NAME_BYTE + i] = i < clean.length ? clean.charCodeAt(i) : 0x20;
  return b;
}

function readFile(file: string): Uint8Array[] {
  const f = JSON.parse(readFileSync(file, 'utf8')) as PatchFile;
  if (f.format !== 'dmbk-juno60-patches' || f.version !== 1 || !Array.isArray(f.patches)) throw new Error(`${file}: not a version 1 juno60 patch file.`);
  return f.patches.map((p, i) => {
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    if (!name) throw new Error(`${file}: patch ${i + 1} has no name.`);
    return toBytes(name, p.values ?? {}, `${file}: patch ${i + 1} (${name})`);
  });
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const files = process.argv.slice(2).filter((a) => a !== '--apply');
  if (!files.length) throw new Error('Name one or more .json patch files.');
  const key = process.env.JUNO60_IMPORT_KEY;
  if (apply && !key) throw new Error('Set JUNO60_IMPORT_KEY (32 random bytes, base64url) to save.');
  const patches = files.flatMap(readFile);
  console.log(`${patches.length} patches in ${files.length} file${files.length === 1 ? '' : 's'}.`);
  if (!apply) { console.log('Report only; pass --apply to save.'); return; }
  await connectDatabase();
  let created = 0;
  try {
    for (const bytes of [...patches].reverse()) {
      const r = await saveVoice(Buffer.from(bytes).toString('base64'), key!);
      if (r.created) created++;
    }
  } finally {
    await mongoose.disconnect();
  }
  console.log(`Saved ${created} new, ${patches.length - created} already there.`);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
