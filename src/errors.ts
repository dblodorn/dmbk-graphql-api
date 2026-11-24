import { GraphQLError } from 'graphql';
import { InvalidInputError } from './lib/cursor.js';
import { PhotoNotFoundError } from './lib/photos/repository.js';
import { ForbiddenError, LoraNotFoundError } from './lib/lora/repository.js';
import { AuthError } from './auth/viewer.js';
import { StorageCleanupError } from './lib/photos/upload.js';
import { ArenaNotFoundError, ArenaRateLimitedError, ArenaUpstreamError } from './lib/arena/client.js';
import { ChimeCompositionNotFoundError } from './lib/chime/repository.js';
import { ChimeSaveRateLimitedError } from './lib/chime/limits.js';
import { VzVoiceNotFoundError } from './lib/vz/repository.js';
import { Dx7VoiceNotFoundError } from './lib/dx7/repository.js';
import { Dx7BankNotFoundError } from './lib/dx7/banks.js';
import { Juno60VoiceNotFoundError } from './lib/juno60/repository.js';
import { VoiceWriteRateLimitedError } from './lib/synth-voices/limits.js';

/**
 * Domain errors a caller can act on, mapped to GraphQL error codes in one
 * place. Repositories throw them naturally; anything not listed here is
 * unexpected and gets masked.
 */
const CODES: [new (...args: never[]) => Error, string][] = [
  [InvalidInputError, 'BAD_USER_INPUT'],
  [PhotoNotFoundError, 'NOT_FOUND'],
  [LoraNotFoundError, 'NOT_FOUND'],
  [ForbiddenError, 'FORBIDDEN'],
  [AuthError, 'UNAUTHENTICATED'],
  [StorageCleanupError, 'STORAGE_CLEANUP_FAILED'],
  [ArenaNotFoundError, 'NOT_FOUND'],
  [ArenaRateLimitedError, 'RATE_LIMITED'],
  [ArenaUpstreamError, 'UPSTREAM_ERROR'],
  [ChimeCompositionNotFoundError, 'NOT_FOUND'],
  [ChimeSaveRateLimitedError, 'RATE_LIMITED'],
  [VzVoiceNotFoundError, 'NOT_FOUND'],
  [Dx7VoiceNotFoundError, 'NOT_FOUND'],
  [Dx7BankNotFoundError, 'NOT_FOUND'],
  [Juno60VoiceNotFoundError, 'NOT_FOUND'],
  [VoiceWriteRateLimitedError, 'RATE_LIMITED'],
];

export function forbidden(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: 'FORBIDDEN' } });
}

/**
 * Yoga `maskedErrors.maskError`. Known domain errors pass through with a code;
 * GraphQLErrors raised deliberately (validation, scope-auth) pass through
 * as-is; everything else is logged and replaced by a generic message, with the
 * original attached only in development.
 */
export function maskError(error: unknown, message: string, isDev?: boolean): Error {
  const original = error instanceof GraphQLError ? (error.originalError ?? error) : error;
  const graphqlError = error instanceof GraphQLError ? error : undefined;

  for (const [ErrorClass, code] of CODES) {
    if (original instanceof ErrorClass) {
      return new GraphQLError(original.message, {
        nodes: graphqlError?.nodes,
        path: graphqlError?.path,
        extensions: {
          code,
          ...(original instanceof ChimeSaveRateLimitedError || original instanceof VoiceWriteRateLimitedError
            ? { retryAfterSeconds: original.retryAfterSeconds }
            : {}),
        },
      });
    }
  }

  // An error that is itself a GraphQLError with no wrapped cause was thrown on
  // purpose (forbidden(), scope-auth, input coercion) — its message is meant
  // for the caller.
  if (graphqlError && (!graphqlError.originalError || graphqlError.originalError instanceof GraphQLError)) {
    return graphqlError;
  }

  console.error('[graphql]', original);
  return new GraphQLError(message, {
    nodes: graphqlError?.nodes,
    path: graphqlError?.path,
    extensions: {
      code: 'INTERNAL_SERVER_ERROR',
      ...(isDev && original instanceof Error ? { originalError: { message: original.message, stack: original.stack } } : {}),
    },
  });
}
