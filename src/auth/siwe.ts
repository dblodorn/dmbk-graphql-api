import crypto from 'node:crypto';
import { verifyMessage } from 'viem';
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe';
import { env } from '../env.js';

/*
 * Sign-In with Ethereum (EIP-4361), handled by this API directly. The client
 * asks for a nonce, has the wallet sign a SIWE message containing it, and
 * trades message + signature for a JWT.
 *
 * Nonces live in process memory. That is correct for the single PM2 process
 * this runs as; running more than one instance would need a shared store.
 */

const NONCE_TTL_MS = 10 * 60 * 1000;
const nonces = new Map<string, number>(); // nonce -> expiry (ms epoch)

function sweep(now: number): void {
  for (const [nonce, expiry] of nonces) if (expiry <= now) nonces.delete(nonce);
}

export function issueNonce(): string {
  const now = Date.now();
  sweep(now);
  // Hex is alphanumeric, as EIP-4361 requires, and 32 chars exceeds its 8-char minimum.
  const nonce = crypto.randomBytes(16).toString('hex');
  nonces.set(nonce, now + NONCE_TTL_MS);
  return nonce;
}

/** Single use: a nonce is removed whether or not verification then succeeds. */
function consumeNonce(nonce: string | undefined): boolean {
  if (!nonce) return false;
  const expiry = nonces.get(nonce);
  nonces.delete(nonce);
  return expiry !== undefined && expiry > Date.now();
}

export class SiweError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SiweError';
  }
}

/**
 * Verify a signed SIWE message and return the signing address (lowercased).
 * Every failure is the same generic error so the response does not reveal
 * which check failed.
 */
export async function verifySiwe(message: string, signature: string): Promise<string> {
  const fail = () => new SiweError('Sign-in failed.');

  let parsed: ReturnType<typeof parseSiweMessage>;
  try {
    parsed = parseSiweMessage(message);
  } catch {
    throw fail();
  }
  if (!parsed.address || !parsed.domain || parsed.chainId == null) throw fail();

  // The nonce must be one we issued and not yet used — checked before the
  // signature so a replayed message burns nothing new.
  if (!consumeNonce(parsed.nonce)) throw fail();

  // The message must be addressed to a site we trust, so a signature a wallet
  // produced for some other site cannot be replayed here.
  const domain = parsed.domain.toLowerCase();
  if (!env.siweDomains.includes(domain)) throw fail();

  // Validity window (expirationTime / notBefore), domain and nonce claims.
  if (!validateSiweMessage({ message: parsed, domain: parsed.domain, nonce: parsed.nonce })) throw fail();

  // EOA signatures only; smart-contract wallets (ERC-1271) would need an RPC client.
  const valid = await verifyMessage({
    address: parsed.address,
    message,
    signature: signature as `0x${string}`,
  }).catch(() => false);
  if (!valid) throw fail();

  return parsed.address.toLowerCase();
}
