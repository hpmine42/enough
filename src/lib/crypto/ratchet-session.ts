// enough. E2EE — crash-safe encrypt/commit/send sequencing (E2EE-2D)
// ---------------------------------------------------------------------------
// This module owns the ORDER of operations around a ratchet state transition.
// It performs no cryptography itself: the caller supplies an `encrypt` (and
// `decrypt`) callback that delegates to the Signal engine.
//
// It is NOT wired into `sendMessage()`. Production message sending is
// unchanged in E2EE-2D; this is the vetted sequencer that the future E2EE
// integration will build on.
//
// THE ORDERING RULE (Invariant C)
//
//   load → encrypt → COMMIT → send
//
// The commit must happen before the ciphertext leaves the device. Reasoning:
//
//   * Crash between encrypt and commit: the new state is lost, but nothing was
//     externalized. Re-running produces the same ciphertext from the same
//     state — no message key is ever used for two different plaintexts. Safe.
//
//   * Crash between commit and send: the state advanced but the message was
//     never sent. The message is lost; the user must retry. Annoying, not
//     dangerous.
//
//   * The forbidden order (send before commit) makes the reverse trade: the
//     message goes out, then a crash rolls the state back, and the next
//     encrypt reuses an already-consumed message key for different plaintext.
//
// Losing a message is recoverable. Reusing a message key is not. The ordering
// therefore always prefers losing the message.

import { CryptoError } from './errors.ts';
import {
  INITIAL_REVISION,
  commitRatchetState,
  loadRatchetState,
  type PersistedRatchetState,
} from './ratchet-state.ts';

/**
 * Points at which a test may inject a simulated crash. Named for the
 * lifecycle stage that has *completed* when the failure fires.
 */
export type FailurePoint =
  | 'AfterLoad'
  | 'AfterEncrypt'
  | 'BeforeCommit'
  | 'AfterCommit'
  | 'BeforeSend'
  | 'AfterSend';

/** Thrown by the injected-failure hook to emulate a process death. */
export class SimulatedCrash extends Error {
  readonly point: FailurePoint;
  constructor(point: FailurePoint) {
    super(`Simulated crash at ${point}`);
    this.name = 'SimulatedCrash';
    this.point = point;
  }
}

/** Lifecycle stages, in order. */
export type SendStage = 'LOADED' | 'ENCRYPTED' | 'COMMITTED' | 'SENT';

export interface EncryptOutput {
  /** Opaque ciphertext to hand to the transport. */
  ciphertext: Uint8Array;
  /** Opaque engine state AFTER the ratchet advanced. */
  nextState: Uint8Array;
}

export interface SendOptions {
  userId: string;
  connectionId: string;
  /**
   * Performs the actual ratchet encryption. Receives the loaded state (or
   * `null` for a brand-new session) and must return the ciphertext plus the
   * advanced state. Must not persist anything itself.
   */
  encrypt: (currentState: Uint8Array | null) => Promise<EncryptOutput> | EncryptOutput;
  /** Transmits the ciphertext. Only called after the state is committed. */
  send: (ciphertext: Uint8Array) => Promise<void> | void;
  /** Test-only crash injection. */
  failAt?: FailurePoint;
}

export interface SendResult {
  stage: SendStage;
  revision: number;
  ciphertext: Uint8Array;
}

function maybeFail(failAt: FailurePoint | undefined, point: FailurePoint): void {
  if (failAt === point) throw new SimulatedCrash(point);
}

/**
 * Encrypt, durably commit the advanced ratchet state, then send.
 *
 * A `ROLLBACK_DETECTED` / `CORRUPTED` / `USER_MISMATCH` state is a hard stop:
 * this function refuses to encrypt on top of a state it cannot trust, because
 * doing so is exactly how a message key gets reused.
 */
export async function encryptCommitSend(options: SendOptions): Promise<SendResult> {
  const { userId, connectionId, encrypt, send, failAt } = options;

  const loaded = await loadRatchetState(userId, connectionId);
  if (loaded.status === 'ROLLBACK_DETECTED') {
    throw new CryptoError(
      'ROLLBACK_DETECTED',
      'Refusing to encrypt: the stored ratchet state is older than the last committed revision.',
    );
  }
  if (loaded.status === 'CORRUPTED') {
    throw new CryptoError(
      'CORRUPT_STATE',
      'Refusing to encrypt: the stored ratchet state failed validation.',
    );
  }
  if (loaded.status === 'USER_MISMATCH') {
    throw new CryptoError(
      'USER_MISMATCH',
      'Refusing to encrypt: the stored ratchet state belongs to a different user or connection.',
    );
  }

  const currentState = loaded.status === 'VALID' ? loaded.record!.state : null;
  const expectedRevision = loaded.status === 'VALID' ? loaded.record!.revision : INITIAL_REVISION;
  maybeFail(failAt, 'AfterLoad');

  const { ciphertext, nextState } = await encrypt(currentState);
  maybeFail(failAt, 'AfterEncrypt');
  maybeFail(failAt, 'BeforeCommit');

  // COMMIT BEFORE EXTERNALIZATION. A concurrent writer that advanced the
  // revision in the meantime makes this throw REVISION_CONFLICT, and the
  // ciphertext is discarded unsent — which is the correct outcome, because
  // that ciphertext was derived from a state that is no longer current.
  const revision = await commitRatchetState(userId, connectionId, expectedRevision, nextState);
  maybeFail(failAt, 'AfterCommit');
  maybeFail(failAt, 'BeforeSend');

  await send(ciphertext);
  maybeFail(failAt, 'AfterSend');

  return { stage: 'SENT', revision, ciphertext };
}

export interface ReceiveOptions {
  userId: string;
  connectionId: string;
  /**
   * Performs the ratchet decryption. Returns the plaintext plus the advanced
   * state. Must not persist anything itself.
   */
  decrypt: (
    currentState: Uint8Array | null,
  ) => Promise<{ plaintext: Uint8Array; nextState: Uint8Array }> | { plaintext: Uint8Array; nextState: Uint8Array };
  /** Test-only crash injection. */
  failAt?: FailurePoint;
}

export interface ReceiveResult {
  revision: number;
  plaintext: Uint8Array;
}

/**
 * Decrypt and durably commit the advanced receive-side state.
 *
 * The receive side matters as much as the send side: the Double Ratchet's
 * duplicate/replay rejection lives inside the session state, so a rolled-back
 * receive state re-opens the window for accepting a message that was already
 * processed. This function refuses to decrypt against an untrusted state for
 * the same reason the send path refuses to encrypt against one.
 */
export async function decryptAndCommit(options: ReceiveOptions): Promise<ReceiveResult> {
  const { userId, connectionId, decrypt, failAt } = options;

  const loaded = await loadRatchetState(userId, connectionId);
  if (loaded.status === 'ROLLBACK_DETECTED') {
    throw new CryptoError(
      'ROLLBACK_DETECTED',
      'Refusing to decrypt: the stored ratchet state is older than the last committed revision.',
    );
  }
  if (loaded.status === 'CORRUPTED') {
    throw new CryptoError('CORRUPT_STATE', 'Refusing to decrypt: stored ratchet state failed validation.');
  }
  if (loaded.status === 'USER_MISMATCH') {
    throw new CryptoError('USER_MISMATCH', 'Refusing to decrypt: stored ratchet state belongs elsewhere.');
  }

  const currentState = loaded.status === 'VALID' ? loaded.record!.state : null;
  const expectedRevision = loaded.status === 'VALID' ? loaded.record!.revision : INITIAL_REVISION;
  maybeFail(failAt, 'AfterLoad');

  const { plaintext, nextState } = await decrypt(currentState);
  maybeFail(failAt, 'AfterEncrypt');
  maybeFail(failAt, 'BeforeCommit');

  const revision = await commitRatchetState(userId, connectionId, expectedRevision, nextState);
  maybeFail(failAt, 'AfterCommit');

  return { revision, plaintext };
}

/**
 * Export the current state as a snapshot suitable for `restoreRatchetSnapshot`.
 * Returns null when there is nothing valid to export.
 *
 * The returned object contains opaque state bytes and must be treated as
 * secret — it is not safe to send anywhere.
 */
export async function exportRatchetSnapshot(
  userId: string,
  connectionId: string,
): Promise<PersistedRatchetState | null> {
  const loaded = await loadRatchetState(userId, connectionId);
  if (loaded.status !== 'VALID' || !loaded.record) return null;
  return { ...loaded.record, state: new Uint8Array(loaded.record.state) };
}
