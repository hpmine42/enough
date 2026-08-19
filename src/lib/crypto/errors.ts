// enough. E2EE — Errors
// --------------------------------------------------------------
// Error messages deliberately contain NO secret material.
// They are generic enough that even if they bubble to the UI or logs,
// they cannot leak keys or ciphertexts.

import type { CryptoErrorCode } from './types.ts';

export class CryptoError extends Error {
  readonly code: CryptoErrorCode;
  readonly cause?: unknown;

  constructor(code: CryptoErrorCode, message?: string, cause?: unknown) {
    // Never include `cause`'s message in the Error message — callers may pass
    // native errors that could contain implementation details. The `cause`
    // property is still available for debugging but must NOT be logged by
    // application-level code.
    super(message ?? defaultMessage(code));
    this.name = 'CryptoError';
    this.code = code;
    // Intentionally do NOT assign `this.cause = cause` to avoid accidental
    // serialization of sensitive details via Error.stack / toString().
    // The original cause is only kept on a non-enumerable symbol for
    // controlled debugging inside this module.
    if (cause !== undefined) {
      Object.defineProperty(this, Symbol.for('enough.crypto.cause'), {
        value: cause,
        enumerable: false,
        writable: false,
        configurable: false,
      });
    }
  }
}

function defaultMessage(code: CryptoErrorCode): string {
  switch (code) {
    case 'NOT_AVAILABLE':
      return 'End-to-end encryption is not available in this browser.';
    case 'NOT_INITIALIZED':
      return 'Crypto identity has not been initialized.';
    case 'ALREADY_INITIALIZED':
      return 'Crypto identity already exists.';
    case 'CORRUPT_STATE':
      return 'Crypto state is corrupted and must be reset.';
    case 'STORAGE_ERROR':
      return 'Crypto storage failure.';
    case 'CRYPTO_ERROR':
      return 'A cryptographic operation failed.';
    case 'DESERIALIZATION_ERROR':
      return 'Crypto data could not be deserialized.';
    default:
      return 'Crypto error.';
  }
}

/** Guard: detect CryptoError by code without exposing any sensitive details. */
export function isCryptoError(
  err: unknown,
  code?: CryptoErrorCode,
): err is CryptoError {
  if (!(err instanceof CryptoError)) return false;
  return code === undefined || err.code === code;
}
