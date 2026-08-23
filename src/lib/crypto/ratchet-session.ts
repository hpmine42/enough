// enough. E2EE — crash-safe encrypt/commit/send sequencing (E2EE-2D,
// reworked for E2EE-2D.2 Stages 5 and 6)
// ---------------------------------------------------------------------------
// This module owns the ORDER of operations around a ratchet state transition
// and the LIFETIME of the engine that performs them. It performs no
// cryptography itself.
//
// It is NOT wired into `sendMessage()`. Production message sending is
// unchanged; this is the vetted sequencer that the future E2EE integration
// will build on.
//
// ---------------------------------------------------------------------------
// RULE 1 — ORDERING: load → encrypt → COMMIT → send
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
// Losing a message is recoverable. Reusing a message key is not.
//
// ---------------------------------------------------------------------------
// RULE 2 — EPHEMERAL ENGINE (audit finding H-1)
//
// A real Signal WASM engine is MUTABLE. If several send attempts share one
// engine instance, each attempt advances the ratchet inside it, but only one
// attempt wins the compare-and-swap. The losers have already consumed message
// keys in the shared engine, so the persisted state now lags what the engine
// did — and the engine cannot be rolled back.
//
// The audit established the way out: for `@getmaapp/signal-wasm@0.6.6`,
// `encryptMessage` behaves as a pure function of (state, plaintext) when it is
// run against a FRESH in-memory store hydrated from exported state bytes. Two
// ephemeral stores built from identical bytes produce byte-identical
// ciphertext and identical next state, and the long-lived store is untouched.
//
// So the sequencer never holds an engine. It asks the caller for a NEW engine
// per attempt, uses it exactly once, and disposes of it:
//
//     persisted sealed state → unseal → fresh engine → encrypt
//       → seal(next) → CAS commit → send
//
//     CAS lost → discard engine, discard ciphertext, DO NOT SEND
//
// No attempt is made to "roll back" an engine. The disposable engine is the
// mechanism; there is nothing to roll back because nothing shared was mutated.
//
// ---------------------------------------------------------------------------
// RULE 3 — NO IMPLICIT SESSION CREATION (audit finding H-3)
//
// A send must never create a session. `MISSING` used to be treated as "fresh
// session, start at revision 0", which meant that anything capable of removing
// the record could get a brand-new ratchet — with a brand-new chain starting
// at counter 0 — simply by deleting state. Now `MISSING` produces
// `NEEDS_ESTABLISH` and the send stops. Sessions are created only by
// `adoptSessionFromEstablishment()`, on an explicit establishment path.

import { CryptoError } from './errors.ts';
import {
  type RatchetStateLoad,
  type RatchetStateRecord,
  commitRatchetState,
  loadRatchetState,
} from './ratchet-state.ts';

/**
 * Points at which a test may inject a simulated crash. Named for the
 * lifecycle stage that has *completed* when the failure fires.
 */
export type FailurePoint =
  | 'AfterLoad'
  | 'AfterEngineCreated'
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

export interface DecryptOutput {
  plaintext: Uint8Array;
  nextState: Uint8Array;
}

/**
 * A single-use engine over one ratchet state.
 *
 * Contract the caller MUST honour — the sequencer cannot enforce it, so it is
 * stated here and exercised by the tests:
 *
 *   1. `createEngine(state)` returns a NEW instance backed by a NEW in-memory
 *      store hydrated from `state`. It must not reuse, cache or share a store
 *      across calls, and must not mutate any long-lived engine.
 *   2. `encrypt` / `decrypt` may be called at most once per instance.
 *   3. `dispose()` releases the instance. It is always called, exactly once,
 *      including on every failure path.
 */
export interface EphemeralEngine {
  encrypt?: (plaintext: Uint8Array) => Promise<EncryptOutput> | EncryptOutput;
  decrypt?: (ciphertext: Uint8Array) => Promise<DecryptOutput> | DecryptOutput;
  dispose: () => void | Promise<void>;
}

/** Factory for per-attempt engines. Called once per send/receive attempt. */
export type EngineFactory = (state: Uint8Array) => Promise<EphemeralEngine> | EphemeralEngine;

export interface SendOptions {
  userId: string;
  connectionId: string;
  /** Plaintext to encrypt. Opaque to this module. */
  plaintext: Uint8Array;
  /** Builds a fresh, disposable engine over the loaded state. */
  createEngine: EngineFactory;
  /** Transmits the ciphertext. Only called after the state is committed. */
  send: (ciphertext: Uint8Array) => Promise<void> | void;
  /** Test-only crash injection. */
  failAt?: FailurePoint;
}

export interface SendResult {
  stage: SendStage;
  epoch: bigint;
  revision: bigint;
  ciphertext: Uint8Array;
}

function maybeFail(failAt: FailurePoint | undefined, point: FailurePoint): void {
  if (failAt === point) throw new SimulatedCrash(point);
}

/**
 * Turn a non-usable load status into the error that stops the operation.
 *
 * Every branch is a hard stop. There is no status here that leads to "carry on
 * anyway" and none that leads to creating a session.
 */
function rejectUnusable(loaded: RatchetStateLoad, verb: 'encrypt' | 'decrypt'): never {
  switch (loaded.status) {
    case 'MISSING':
      throw new CryptoError(
        'NEEDS_ESTABLISH',
        `Refusing to ${verb}: no session exists. A session must be established explicitly.`,
      );
    case 'ROLLBACK_DETECTED':
      throw new CryptoError(
        'ROLLBACK_DETECTED',
        `Refusing to ${verb}: the stored ratchet state is older than the last committed revision.`,
      );
    case 'EPOCH_STALE':
      throw new CryptoError(
        'EPOCH_STALE',
        `Refusing to ${verb}: the stored session is from an older epoch.`,
      );
    case 'CORRUPTED':
      throw new CryptoError('CORRUPT_STATE', `Refusing to ${verb}: stored ratchet state failed validation.`);
    case 'UNSEAL_FAILED':
      throw new CryptoError(
        'UNSEAL_FAILED',
        `Refusing to ${verb}: the stored ratchet state failed authentication.`,
      );
    case 'KEY_MISSING':
      throw new CryptoError('KEY_MISSING', `Refusing to ${verb}: the sealing key is unavailable.`);
    case 'WEDGED':
      throw new CryptoError('WEDGED', `Refusing to ${verb}: ratchet storage is inconsistent.`);
    case 'USER_MISMATCH':
      throw new CryptoError(
        'USER_MISMATCH',
        `Refusing to ${verb}: the stored ratchet state belongs to a different user or connection.`,
      );
    default:
      throw new CryptoError('CORRUPT_STATE', `Refusing to ${verb}: unusable ratchet state.`);
  }
}

/**
 * Load an established, authenticated session or throw.
 *
 * This is the single gate through which both the send and the receive path
 * must pass, so there is exactly one place where "may I use this state?" is
 * decided.
 */
async function requireEstablishedSession(
  userId: string,
  connectionId: string,
  verb: 'encrypt' | 'decrypt',
): Promise<RatchetStateRecord> {
  const loaded = await loadRatchetState(userId, connectionId);
  if (loaded.status !== 'VALID' || !loaded.record) rejectUnusable(loaded, verb);
  return loaded.record;
}

/** Dispose an engine without letting a disposal error mask the real failure. */
async function safeDispose(engine: EphemeralEngine | null): Promise<void> {
  if (!engine) return;
  try {
    await engine.dispose();
  } catch {
    /* disposal must never change the outcome of the operation */
  }
}

/**
 * Encrypt with a disposable engine, durably commit the advanced state, then
 * send.
 *
 * On a lost compare-and-swap the ciphertext is discarded unsent and the
 * ephemeral engine is disposed. Because that engine was the only thing that
 * advanced, nothing durable and nothing shared retains the consumed key —
 * which is the property H-1 was missing.
 */
export async function encryptCommitSend(options: SendOptions): Promise<SendResult> {
  const { userId, connectionId, plaintext, createEngine, send, failAt } = options;
  if (!(plaintext instanceof Uint8Array)) {
    throw new CryptoError('CORRUPT_STATE', 'plaintext must be a Uint8Array.');
  }

  const record = await requireEstablishedSession(userId, connectionId, 'encrypt');
  maybeFail(failAt, 'AfterLoad');

  let engine: EphemeralEngine | null = null;
  let ciphertext: Uint8Array;
  let nextState: Uint8Array;
  try {
    engine = await createEngine(new Uint8Array(record.state));
    if (typeof engine.encrypt !== 'function') {
      throw new CryptoError('CRYPTO_ERROR', 'Engine does not support encryption.');
    }
    maybeFail(failAt, 'AfterEngineCreated');

    const out = await engine.encrypt(plaintext);
    if (!(out?.ciphertext instanceof Uint8Array) || !(out?.nextState instanceof Uint8Array)) {
      throw new CryptoError('CRYPTO_ERROR', 'Engine returned a malformed encryption result.');
    }
    ciphertext = out.ciphertext;
    nextState = out.nextState;
    maybeFail(failAt, 'AfterEncrypt');
  } finally {
    // Disposed before the commit is even attempted: the engine's job is over
    // the moment it produced bytes, and holding it across the commit is what
    // would let a losing attempt keep a mutated engine alive.
    await safeDispose(engine);
    engine = null;
  }

  maybeFail(failAt, 'BeforeCommit');

  // COMMIT BEFORE EXTERNALIZATION. A concurrent writer that advanced the state
  // in the meantime makes this throw REVISION_CONFLICT, and the ciphertext is
  // discarded unsent — the correct outcome, because that ciphertext came from
  // a state that is no longer current.
  const revision = await commitRatchetState(
    userId,
    connectionId,
    { epoch: record.epoch, revision: record.revision },
    nextState,
  );
  maybeFail(failAt, 'AfterCommit');
  maybeFail(failAt, 'BeforeSend');

  await send(ciphertext);
  maybeFail(failAt, 'AfterSend');

  return { stage: 'SENT', epoch: record.epoch, revision, ciphertext };
}

export interface ReceiveOptions {
  userId: string;
  connectionId: string;
  ciphertext: Uint8Array;
  createEngine: EngineFactory;
  failAt?: FailurePoint;
}

export interface ReceiveResult {
  epoch: bigint;
  revision: bigint;
  plaintext: Uint8Array;
}

/**
 * Decrypt with a disposable engine and durably commit the advanced state.
 *
 * The receive side matters as much as the send side: the Double Ratchet's
 * duplicate/replay rejection and its skipped-message-key store both live
 * inside the session state, so a rolled-back receive state re-opens the window
 * for accepting a message that was already processed and resurrects message
 * keys that had been consumed and deleted. This function refuses to decrypt
 * against an untrusted state for the same reason the send path refuses to
 * encrypt against one.
 *
 * The plaintext is returned only after the commit succeeds. A caller that
 * displays or stores a plaintext whose state transition was not committed
 * would re-open the same replay window on the next start.
 */
export async function decryptAndCommit(options: ReceiveOptions): Promise<ReceiveResult> {
  const { userId, connectionId, ciphertext, createEngine, failAt } = options;
  if (!(ciphertext instanceof Uint8Array)) {
    throw new CryptoError('CORRUPT_STATE', 'ciphertext must be a Uint8Array.');
  }

  const record = await requireEstablishedSession(userId, connectionId, 'decrypt');
  maybeFail(failAt, 'AfterLoad');

  let engine: EphemeralEngine | null = null;
  let plaintext: Uint8Array;
  let nextState: Uint8Array;
  try {
    engine = await createEngine(new Uint8Array(record.state));
    if (typeof engine.decrypt !== 'function') {
      throw new CryptoError('CRYPTO_ERROR', 'Engine does not support decryption.');
    }
    maybeFail(failAt, 'AfterEngineCreated');

    const out = await engine.decrypt(ciphertext);
    if (!(out?.plaintext instanceof Uint8Array) || !(out?.nextState instanceof Uint8Array)) {
      throw new CryptoError('CRYPTO_ERROR', 'Engine returned a malformed decryption result.');
    }
    plaintext = out.plaintext;
    nextState = out.nextState;
    maybeFail(failAt, 'AfterEncrypt');
  } finally {
    await safeDispose(engine);
    engine = null;
  }

  maybeFail(failAt, 'BeforeCommit');

  const revision = await commitRatchetState(
    userId,
    connectionId,
    { epoch: record.epoch, revision: record.revision },
    nextState,
  );
  maybeFail(failAt, 'AfterCommit');

  return { epoch: record.epoch, revision, plaintext };
}

/**
 * Report whether a usable session exists, without creating anything.
 *
 * Intended for UI ("this conversation is not encrypted yet") and for the
 * establishment path to decide whether it has work to do. Deliberately returns
 * the raw status: the caller must handle `WEDGED` and `UNSEAL_FAILED`
 * differently from `MISSING`, and collapsing them into a boolean is how a
 * failure gets mistaken for a fresh start.
 */
export async function inspectSession(
  userId: string,
  connectionId: string,
): Promise<RatchetStateLoad> {
  return loadRatchetState(userId, connectionId);
}
