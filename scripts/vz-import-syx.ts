/*
 * Imports the voices of VZ-1 / VZ-10M bulk dumps (.syx) into `dmbk-sound.vz_voices`
 * through `saveVoice`, so every voice gets the same checks as a save from the
 * editor (name, obscenity, fingerprint). All are saved under one device key,
 * VZ_IMPORT_KEY (32 random bytes, base64url), so they can be updated or removed
 * later with the usual mutations; re-running with the same key and files saves
 * nothing new.
 *
 *   npm run vz:import -- <files.syx…>            # report only
 *   npm run vz:import -- --apply <files.syx…>    # save
 *
 * A bulk dump is three messages: F0 44 03 00 7n 70 TT F7 (start; TT 00 voices,
 * 02 voices + operations), F0 44 03 00 7n 74 <payload> F7, F0 44 03 00 7n 71 F7.
 * The payload is 64 voices of 672 nibbles (336 bytes, high nibble first) each
 * followed by its 7-bit checksum, then for TT 02 the 64 operations, which are
 * not imported. Voices with a bad checksum or a blank name are skipped. Files
 * in another layout (the RC-150 and RC-5x0G card dumps) are refused whole.
 * Files are saved in the order given, each from its first voice to its last, so
 * the newest-first listing shows the last file's last voice first.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import mongoose from 'mongoose';
import { connectDatabase } from '../src/db/mongoose.js';
import { saveVoice } from '../src/lib/vz/repository.js';
import { voiceName } from '../src/lib/vz/shape.js';

const VOICES = 64, VOICE_BYTES = 336, CHUNK = VOICE_BYTES * 2 + 1, OP_CHUNK = 100 * 2 + 1;

const checksum = (data: Uint8Array): number => -data.reduce((a, b) => a + b, 0) & 0x7f;
const nameOf = (data: Uint8Array): string => voiceName(Buffer.from(data));

function readDump(file: string): { voices: Uint8Array[]; skipped: number } {
  const b = new Uint8Array(readFileSync(file));
  const vz = (i: number, type: number): boolean =>
    b[i] === 0xf0 && b[i + 1] === 0x44 && b[i + 2] === 0x03 && b[i + 3] === 0x00 && (b[i + 4]! & 0xf0) === 0x70 && b[i + 5] === type;
  if (!vz(0, 0x70) || b[7] !== 0xf7) throw new Error('no bulk-dump start message');
  const kind = b[6];
  if (kind !== 0x00 && kind !== 0x02) throw new Error(`unknown dump kind 0x${kind!.toString(16)}`);
  if (!vz(8, 0x74)) throw new Error('no data message after the start');
  const end = b.indexOf(0xf7, 8);
  const payload = b.subarray(14, end);
  const want = VOICES * CHUNK + (kind === 0x02 ? VOICES * OP_CHUNK : 0);
  if (payload.length !== want) throw new Error(`payload is ${payload.length} bytes, a ${kind === 0x02 ? 'full' : 'voice'} dump is ${want}`);
  if (!vz(end + 1, 0x71)) throw new Error('no end message');
  const voices: Uint8Array[] = [];
  let skipped = 0;
  for (let k = 0; k < VOICES; k++) {
    const chunk = payload.subarray(k * CHUNK, (k + 1) * CHUNK);
    if (chunk.subarray(0, CHUNK - 1).some((n) => n > 0x0f)) { skipped++; continue; }
    const data = new Uint8Array(VOICE_BYTES);
    for (let i = 0; i < VOICE_BYTES; i++) data[i] = (chunk[i * 2]! << 4) | chunk[i * 2 + 1]!;
    if (checksum(data) !== chunk[CHUNK - 1] || !nameOf(data)) { skipped++; continue; }
    voices.push(data);
  }
  return { voices, skipped };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const files = process.argv.slice(2).filter((a) => a !== '--apply');
  if (!files.length) throw new Error('Name one or more .syx files.');
  const key = process.env.VZ_IMPORT_KEY;
  if (apply && !key) throw new Error('Set VZ_IMPORT_KEY (32 random bytes, base64url) to save.');

  const plan: { file: string; voices: Uint8Array[] }[] = [];
  for (const file of files) {
    try {
      const { voices, skipped } = readDump(file);
      console.log(`${basename(file)}: ${voices.length} voices${skipped ? `, ${skipped} skipped` : ''}`);
      plan.push({ file, voices });
    } catch (error) {
      console.log(`${basename(file)}: refused (${(error as Error).message})`);
    }
  }
  const total = plan.reduce((n, p) => n + p.voices.length, 0);
  if (!apply) { console.log(`\n${total} voices would be saved. Re-run with --apply.`); return; }

  await connectDatabase();
  let created = 0, existing = 0, refused = 0;
  for (const { file, voices } of plan) {
    for (const data of voices) {
      try {
        const r = await saveVoice(Buffer.from(data).toString('base64'), key!);
        if (r.created) created++; else existing++;
      } catch (error) {
        refused++;
        console.log(`  ${basename(file)} "${nameOf(data)}": ${(error as Error).message}`);
      }
    }
  }
  console.log(`\n${created} saved, ${existing} already there, ${refused} refused.`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
