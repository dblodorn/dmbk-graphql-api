import crypto from 'node:crypto';

/*
 * LoRA record ids: 32 lowercase hex characters, the format lora-trainer has
 * always written (`crypto.randomBytes(16).toString("hex")`), so records it
 * wrote and records written here are indistinguishable.
 */

const LORA_ID = /^[0-9a-f]{32}$/;

export function newLoraId(): string {
  return crypto.randomBytes(16).toString('hex');
}

/** Whether a client-supplied id (generated images) has the record id format. */
export function isLoraId(value: string): boolean {
  return LORA_ID.test(value);
}
