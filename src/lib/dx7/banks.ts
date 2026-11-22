import crypto from 'node:crypto';
import { Dx7BankModel, Dx7VoiceModel, type Dx7BankDoc } from '../../models/dx7.js';
import { InvalidInputError, paginate, type Page, type PageArgs } from '../cursor.js';
import { ForbiddenError } from '../lora/repository.js';
import { isNameAllowed } from '../synth-voices/names.js';
import { creatorHash } from './shape.js';

/*
 * DX7 banks (openspec/specs/dx7-voices, "Banks"): 32 slots like a DX7 cartridge, each a saved DX7 voice or empty,
 * with a name. Public and anonymous on the voices' plan: owned by a device key (the same `dx7-creator` hash as
 * voices, so one browser's key owns its voices and banks), listed newest first, changed or deleted only by that
 * key, hidden by admins. A slot may name anyone's voice, so a bank can gather the shared list; a slot whose voice
 * is later deleted or hidden reads as empty.
 */

export const BANK_SLOTS = 32;
export const BANK_NAME_MAX = 20;
const ID = /^[0-9a-f]{24}$/;

export class Dx7BankNotFoundError extends Error {
  constructor(id: string) {
    super(`No DX7 bank with id: ${id}`);
    this.name = 'Dx7BankNotFoundError';
  }
}

const PUBLIC_FILTER = { hidden: false } as const;
const newestFirst = { createdAt: -1, _id: -1 } as const;
const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

/** The trimmed name and the slots, checked: refused names, wrong slot counts and unknown or hidden voices fail. */
async function checked(name: string, slots: readonly (string | null)[]): Promise<{ name: string; slots: (string | null)[]; print: string }> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > BANK_NAME_MAX || !/^[\x20-\x7e]+$/.test(trimmed)) {
    throw new InvalidInputError(`name: 1 to ${BANK_NAME_MAX} printable ASCII characters.`);
  }
  if (!isNameAllowed(trimmed)) throw new InvalidInputError(`name: "${trimmed}" isn't allowed. Rename the bank and save again.`);
  if (slots.length !== BANK_SLOTS) throw new InvalidInputError(`slots: exactly ${BANK_SLOTS}, each a voice id or null.`);
  const ids = slots.map((s) => (s === null || s === '' ? null : s));
  if (ids.some((s) => s !== null && !ID.test(s))) throw new InvalidInputError('slots: a voice id is 24 lowercase hex characters.');
  const wanted = [...new Set(ids.filter((s): s is string => s !== null))];
  const found = await Dx7VoiceModel.countDocuments({ _id: { $in: wanted }, hidden: false });
  if (found !== wanted.length) throw new InvalidInputError('slots: every voice must be a saved, visible DX7 voice.');
  const print = crypto.createHash('sha256').update(JSON.stringify([trimmed, ids])).digest('hex');
  return { name: trimmed, slots: ids, print };
}

/** Save a bank for a device key, or return the identical one that key already saved (`created: false`). */
export async function saveBank(name: string, slots: readonly (string | null)[], creatorKey: string): Promise<{ bank: Dx7BankDoc; created: boolean }> {
  const owner = creatorHash(creatorKey);
  const c = await checked(name, slots);
  const now = new Date().toISOString();
  const doc: Dx7BankDoc = {
    _id: crypto.randomBytes(12).toString('hex'),
    schemaVersion: 1,
    name: c.name,
    slots: c.slots,
    fingerprint: c.print,
    creatorHash: owner,
    hidden: false,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await Dx7BankModel.create(doc);
    return { bank: doc, created: true };
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const existing = await Dx7BankModel.findOne({ creatorHash: owner, fingerprint: c.print }).lean<Dx7BankDoc>().exec();
    if (!existing) throw error;
    return { bank: existing, created: false };
  }
}

async function owned(id: string, creatorKey: string): Promise<Dx7BankDoc> {
  const owner = creatorHash(creatorKey);
  const doc = await Dx7BankModel.findById(id).lean<Dx7BankDoc>().exec();
  if (!doc || doc.hidden) throw new Dx7BankNotFoundError(id);
  if (doc.creatorHash !== owner) throw new ForbiddenError('Only the device that saved this bank can change it.');
  return doc;
}

/** Replace a bank's name and slots. Its place in the listing stays where it was saved. */
export async function updateBank(id: string, name: string, slots: readonly (string | null)[], creatorKey: string): Promise<Dx7BankDoc> {
  const doc = await owned(id, creatorKey);
  const c = await checked(name, slots);
  try {
    const updated = await Dx7BankModel.findOneAndUpdate(
      { _id: id, creatorHash: doc.creatorHash, hidden: false },
      { $set: { name: c.name, slots: c.slots, fingerprint: c.print, updatedAt: new Date().toISOString() } },
      { new: true },
    ).lean<Dx7BankDoc>().exec();
    if (!updated) throw new Dx7BankNotFoundError(id);
    return updated;
  } catch (error) {
    if (isDuplicateKey(error)) throw new InvalidInputError('slots: you have already saved an identical bank.');
    throw error;
  }
}

export async function deleteBank(id: string, creatorKey: string): Promise<string> {
  const doc = await owned(id, creatorKey);
  await Dx7BankModel.deleteOne({ _id: id, creatorHash: doc.creatorHash });
  return id;
}

/** The public listing, newest first, optionally one key's banks or names containing `search`. */
export function listVisibleBanks(args: PageArgs, { creatorKey, search }: { creatorKey?: string | null; search?: string | null } = {}): Promise<Page<Dx7BankDoc>> {
  const filter: Record<string, unknown> = { ...PUBLIC_FILTER };
  if (creatorKey) filter.creatorHash = creatorHash(creatorKey);
  const text = search?.trim();
  if (text) {
    if (text.length > BANK_NAME_MAX) throw new InvalidInputError(`search: at most ${BANK_NAME_MAX} characters.`);
    filter.name = { $regex: text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  }
  return paginate(args, filter, (f, limit) => Dx7BankModel.find(f).sort(newestFirst).limit(limit).lean<Dx7BankDoc[]>().exec());
}

export function isBankCreator(doc: Dx7BankDoc, creatorKey: string): boolean {
  try {
    return doc.creatorHash === creatorHash(creatorKey);
  } catch {
    return false;
  }
}

export async function loadBanks(ids: readonly string[], isAdmin: boolean): Promise<(Dx7BankDoc | null)[]> {
  const docs = await Dx7BankModel.find({ _id: { $in: ids } }).lean<Dx7BankDoc[]>().exec();
  const byId = new Map(docs.map((d) => [d._id, d]));
  return ids.map((id) => {
    const doc = byId.get(id);
    return doc && (isAdmin || !doc.hidden) ? doc : null;
  });
}

export async function setBankHidden(id: string, hidden: boolean): Promise<Dx7BankDoc> {
  const doc = await Dx7BankModel.findOneAndUpdate({ _id: id }, { $set: { hidden } }, { new: true }).lean<Dx7BankDoc>().exec();
  if (!doc) throw new Dx7BankNotFoundError(id);
  return doc;
}

/** The collection's validator: MongoDB refuses what the API would. */
export function bankJsonSchema(): Record<string, unknown> {
  const iso = { bsonType: 'string', minLength: 20, maxLength: 30 };
  const hex64 = { bsonType: 'string', pattern: '^[0-9a-f]{64}$' };
  return {
    bsonType: 'object',
    additionalProperties: false,
    required: ['_id', 'schemaVersion', 'name', 'slots', 'fingerprint', 'creatorHash', 'hidden', 'createdAt', 'updatedAt'],
    properties: {
      _id: { bsonType: 'string', pattern: '^[0-9a-f]{24}$' },
      schemaVersion: { enum: [1] },
      name: { bsonType: 'string', minLength: 1, maxLength: BANK_NAME_MAX },
      slots: {
        bsonType: 'array',
        minItems: BANK_SLOTS,
        maxItems: BANK_SLOTS,
        items: { oneOf: [{ bsonType: 'null' }, { bsonType: 'string', pattern: '^[0-9a-f]{24}$' }] },
      },
      fingerprint: hex64,
      creatorHash: hex64,
      hidden: { bsonType: 'bool' },
      createdAt: iso,
      updatedAt: iso,
    },
  };
}
