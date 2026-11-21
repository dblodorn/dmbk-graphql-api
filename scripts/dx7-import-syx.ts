/*
 * Imports the voices of Yamaha DX7 .syx files into `dmbk-sound.dx7_voices` through `saveVoice`, so every voice gets
 * the same checks as a save from the editor (name, obscenity, fingerprint). All are saved under one device key,
 * DX7_IMPORT_KEY (32 random bytes, base64url), so they can be updated or removed later with the usual mutations;
 * re-running with the same key and files saves nothing new.
 *
 *   npm run dx7:import -- <files.syx…>            # report only
 *   npm run dx7:import -- --apply <files.syx…>    # save
 *
 * A file holds DX7 messages back to back (DX7 Operating Manual pp.30–31): a single voice F0 43 0n 00 01 1B <155>
 * cs F7, or a 32-voice bank F0 43 0n 09 20 00 <4096> cs F7, whose voices are 128 packed bytes each (unpacked here
 * by the format sheet's layout, as the dx7 editor's package does). The checksum is the 7-bit two's complement of
 * the data's sum. Damaged messages, other formats and voices with a blank name are skipped. Bits no parameter
 * uses are dropped, as the editor drops them.
 *
 * The listing is newest first, so voices are saved last file first and each bank last voice first: the list then
 * reads like the files given, the first file's first voice on top.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import mongoose from 'mongoose';
import { connectDatabase } from '../src/db/mongoose.js';
import { saveVoice } from '../src/lib/dx7/repository.js';
import { voiceName } from '../src/lib/dx7/shape.js';

const VOICE_BYTES = 155, BANK_BYTES = 4096;

const checksum = (data: Uint8Array): number => -data.reduce((a, b) => a + b, 0) & 0x7f;
const nameOf = (data: Uint8Array): string => voiceName(Buffer.from(data));

// 128 packed bytes → the 155 bytes of the same voice (format sheet section F; OP6 first in both)
function unpack(p: Uint8Array): Uint8Array {
  const d = new Uint8Array(VOICE_BYTES);
  for (let op = 0; op < 6; op++) {
    const s = op * 17, t = op * 21;
    for (let i = 0; i <= 10; i++) d[t + i] = p[s + i]!;
    d[t + 11] = p[s + 11]! & 3;
    d[t + 12] = (p[s + 11]! >> 2) & 3;
    d[t + 13] = p[s + 12]! & 7;
    d[t + 20] = (p[s + 12]! >> 3) & 15;
    d[t + 14] = p[s + 13]! & 3;
    d[t + 15] = (p[s + 13]! >> 2) & 7;
    d[t + 16] = p[s + 14]!;
    d[t + 17] = p[s + 15]! & 1;
    d[t + 18] = (p[s + 15]! >> 1) & 31;
    d[t + 19] = p[s + 16]!;
  }
  for (let i = 0; i < 8; i++) d[126 + i] = p[102 + i]!;
  d[134] = p[110]! & 31;
  d[135] = p[111]! & 7;
  d[136] = (p[111]! >> 3) & 1;
  for (let i = 0; i < 4; i++) d[137 + i] = p[112 + i]!;
  d[141] = p[116]! & 1;
  d[142] = (p[116]! >> 1) & 7;
  d[143] = (p[116]! >> 4) & 7;
  d[144] = p[117]!;
  for (let i = 0; i < 10; i++) d[145 + i] = p[118 + i]!;
  return d;
}

function readFile(file: string): { voices: Uint8Array[]; skipped: number } {
  const b = new Uint8Array(readFileSync(file));
  const voices: Uint8Array[] = [];
  let skipped = 0;
  let i = 0;
  while (i < b.length) {
    if (b[i] !== 0xf0) { i++; continue; }
    const end = b.indexOf(0xf7, i);
    if (end < 0) break;
    const m = b.subarray(i, end + 1);
    i = end + 1;
    if (m[1] !== 0x43 || (m[2]! & 0xf0) !== 0) { skipped++; continue; }
    const format = m[3], count = ((m[4]! << 7) | m[5]!);
    const want = format === 0 ? VOICE_BYTES : format === 9 ? BANK_BYTES : -1;
    if (want < 0 || count !== want || m.length !== want + 8) { skipped++; continue; }
    const data = m.subarray(6, 6 + want);
    if (checksum(data) !== m[6 + want]) { skipped++; continue; }
    const found = format === 0 ? [Uint8Array.from(data)] : Array.from({ length: 32 }, (_, v) => unpack(data.subarray(v * 128, (v + 1) * 128)));
    for (const voice of found) {
      if (nameOf(voice)) voices.push(voice); else skipped++;
    }
  }
  return { voices, skipped };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const files = process.argv.slice(2).filter((a) => a !== '--apply');
  if (!files.length) throw new Error('Name one or more .syx files.');
  const key = process.env.DX7_IMPORT_KEY;
  if (apply && !key) throw new Error('Set DX7_IMPORT_KEY (32 random bytes, base64url) to save.');

  const plan: { file: string; voices: Uint8Array[] }[] = [];
  for (const file of files) {
    const { voices, skipped } = readFile(file);
    console.log(`${basename(file)}: ${voices.length} voices${skipped ? `, ${skipped} skipped` : ''}`);
    plan.push({ file, voices });
  }
  const total = plan.reduce((n, p) => n + p.voices.length, 0);
  if (!apply) { console.log(`\n${total} voices would be saved. Re-run with --apply.`); return; }

  await connectDatabase();
  let created = 0, existing = 0, refused = 0;
  for (const { file, voices } of [...plan].reverse()) {
    for (const data of [...voices].reverse()) {
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
