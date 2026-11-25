import crypto from 'node:crypto';
import type { Model } from 'mongoose';
import type { SynthVoiceDoc } from '../../models/synth-voice.js';
import { InvalidInputError, paginate, type Page, type PageArgs } from '../cursor.js';
import { ForbiddenError } from '../lora/repository.js';
import { isNameAllowed } from './names.js';
import type { VoiceShape } from './shape.js';

/*
 * Every query and write of one synth's voice library goes through the repository made here, and visibility is
 * decided here only. Saves are anonymous: a voice records its bytes, what the API derived from them, and the hash
 * of the saving browser's device key, never an account, IP or client. Public = `hidden: false`; admins see
 * everything. The device key is the only proof of ownership: with it, a creator can update and delete their voices
 * and filter the listing to them.
 */

const PUBLIC_FILTER = { hidden: false } as const;
const newestFirst = { createdAt: -1, _id: -1 } as const;

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

/** Fields kept beside a voice's bytes, for synths that have them (the Juno-60's arpeggio). Absent means none. */
export type VoiceExtra = Pick<SynthVoiceDoc, 'arpeggio'>;
const EXTRA_KEYS = ['arpeggio'] as const;

export interface VoiceFilter {
  /** Only this device key's voices. */
  creatorKey?: string | null;
  /** Names containing this text, ignoring case. */
  search?: string | null;
}

export function voiceRepository(model: Model<SynthVoiceDoc>, shape: VoiceShape, NotFound: new (id: string) => Error) {
  /** The bytes, their name and fingerprint, or `InvalidInputError` (bad data, refused name). */
  // The fingerprint covers the extras too, so the same bytes with two different arpeggios are two voices; with no
  // extras it's the bytes' alone, as it always was, so stored fingerprints never change.
  function checked(data: string, extra: VoiceExtra): { name: string; print: string } {
    const bytes = shape.decodeVoice(data);
    const name = shape.voiceName(bytes);
    if (!isNameAllowed(name)) throw new InvalidInputError(`name: "${name}" isn't allowed. Rename the voice and save again.`);
    const kept = EXTRA_KEYS.filter((k) => extra[k] !== undefined);
    if (!kept.length) return { name, print: shape.fingerprint(bytes) };
    const extras = JSON.stringify(kept.map((k) => [k, extra[k]]));
    return { name, print: crypto.createHash('sha256').update(bytes).update(extras).digest('hex') };
  }

  /**
   * Save a voice for a device key, or return the identical one that key already saved (`created: false`). The
   * unique (creatorHash, fingerprint) index settles two identical saves racing each other.
   */
  async function saveVoice(data: string, creatorKey: string, extra: VoiceExtra = {}): Promise<{ voice: SynthVoiceDoc; created: boolean }> {
    const owner = shape.creatorHash(creatorKey);
    const { name, print } = checked(data, extra);
    const now = new Date().toISOString();
    const doc: SynthVoiceDoc = {
      _id: crypto.randomBytes(12).toString('hex'),
      schemaVersion: 1,
      name,
      data,
      fingerprint: print,
      creatorHash: owner,
      hidden: false,
      ...(extra.arpeggio ? { arpeggio: extra.arpeggio } : {}),
      createdAt: now,
      updatedAt: now,
    };
    try {
      await model.create(doc);
      return { voice: doc, created: true };
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const existing = await model.findOne({ creatorHash: owner, fingerprint: print }).lean<SynthVoiceDoc>().exec();
      if (!existing) throw error;
      return { voice: existing, created: false };
    }
  }

  /**
   * A voice its device key may change: NOT_FOUND when it doesn't exist or is hidden (hidden voices can't be told
   * from missing ones), FORBIDDEN when it belongs to another key.
   */
  async function owned(id: string, creatorKey: string): Promise<SynthVoiceDoc> {
    const owner = shape.creatorHash(creatorKey);
    const doc = await model.findById(id).lean<SynthVoiceDoc>().exec();
    if (!doc || doc.hidden) throw new NotFound(id);
    if (doc.creatorHash !== owner) throw new ForbiddenError('Only the device that saved this voice can change it.');
    return doc;
  }

  /**
   * Replace a voice's bytes (and so its name) and its extras: extras not given are removed. Its place in the
   * newest-first listing stays where it was saved.
   */
  async function updateVoice(id: string, data: string, creatorKey: string, extra: VoiceExtra = {}): Promise<SynthVoiceDoc> {
    const doc = await owned(id, creatorKey);
    const { name, print } = checked(data, extra);
    const set: Record<string, unknown> = { name, data, fingerprint: print, updatedAt: new Date().toISOString() };
    const unset: Record<string, ''> = {};
    for (const k of EXTRA_KEYS) if (extra[k] !== undefined) set[k] = extra[k]; else unset[k] = '';
    try {
      const updated = await model.findOneAndUpdate(
        { _id: id, creatorHash: doc.creatorHash, hidden: false },
        { $set: set, $unset: unset },
        { new: true },
      ).lean<SynthVoiceDoc>().exec();
      if (!updated) throw new NotFound(id);
      return updated;
    } catch (error) {
      if (isDuplicateKey(error)) throw new InvalidInputError('data: you have already saved an identical voice.');
      throw error;
    }
  }

  /** Delete a voice for good. */
  async function deleteVoice(id: string, creatorKey: string): Promise<string> {
    const doc = await owned(id, creatorKey);
    await model.deleteOne({ _id: id, creatorHash: doc.creatorHash });
    return id;
  }

  /** The public listing, newest first, optionally narrowed to a device key's voices or a name search. */
  function listVisibleVoices(args: PageArgs, { creatorKey, search }: VoiceFilter = {}): Promise<Page<SynthVoiceDoc>> {
    const filter: Record<string, unknown> = { ...PUBLIC_FILTER };
    if (creatorKey) filter.creatorHash = shape.creatorHash(creatorKey);
    const text = search?.trim();
    if (text) {
      if (text.length > shape.NAME_LENGTH) throw new InvalidInputError(`search: at most ${shape.NAME_LENGTH} characters (a ${shape.label} name is ${shape.NAME_LENGTH}).`);
      filter.name = { $regex: text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }
    return paginate(args, filter, (f, limit) => model.find(f).sort(newestFirst).limit(limit).lean<SynthVoiceDoc[]>().exec());
  }

  /** Whether a device key saved this voice. A malformed key owns nothing. */
  function isCreator(doc: SynthVoiceDoc, creatorKey: string): boolean {
    try {
      return doc.creatorHash === shape.creatorHash(creatorKey);
    } catch {
      return false;
    }
  }

  /** By id, in input order. Hidden ones are null except for admins, indistinguishable from missing. */
  async function loadVoices(ids: readonly string[], isAdmin: boolean): Promise<(SynthVoiceDoc | null)[]> {
    const docs = await model.find({ _id: { $in: ids } }).lean<SynthVoiceDoc[]>().exec();
    const byId = new Map(docs.map((d) => [d._id, d]));
    return ids.map((id) => {
      const doc = byId.get(id);
      return doc && (isAdmin || !doc.hidden) ? doc : null;
    });
  }

  /** Admin only (enforced by the mutation's scope). */
  async function setVoiceHidden(id: string, hidden: boolean): Promise<SynthVoiceDoc> {
    const doc = await model.findOneAndUpdate({ _id: id }, { $set: { hidden } }, { new: true }).lean<SynthVoiceDoc>().exec();
    if (!doc) throw new NotFound(id);
    return doc;
  }

  return { saveVoice, updateVoice, deleteVoice, listVisibleVoices, isCreator, loadVoices, setVoiceHidden };
}
