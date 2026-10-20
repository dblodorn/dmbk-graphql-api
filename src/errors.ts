import { GraphQLError } from 'graphql';
import { InvalidInputError } from './lib/cursor.js';
import { PhotoNotFoundError } from './lib/photos/repository.js';
import { ForbiddenError, LoraNotFoundError } from './lib/lora/repository.js';
import { SiweError } from './auth/siwe.js';

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
  [SiweError, 'UNAUTHENTICATED'],
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
        extensions: { code },
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
