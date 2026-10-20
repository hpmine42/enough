// enough. E2EE — C-1 monotonic sequence counter.
// ---------------------------------------------------------------------------
// Defence-in-depth against server-triggered message replay / rollback after a
// Signal session has been established:
//
//   * Outbound: the sender increments a per-(localUser, peer, localDevice)
//     counter and stamps it onto every envelope (c field).
//   * Inbound:  the receiver records the highest counter seen per
//     (localUser, senderDevice, sender) and rejects any envelope whose counter
//     is less than or equal to that high-water mark.
//
// Storage is IndexedDB (via crypto/storage.ts state helpers). The record keys
// are scoped to the local userId so different accounts on the same browser
// don't cross-contaminate counters. A fresh PREKEY message resets the
// receiver's high-water mark for that peer (a new session is a new chain),
// but every subsequent WHISPER message must carry a strictly greater counter.
//
// v1 envelopes (produced by older builds before the counter landed) are
// accepted — they simply do not get the rollback defence. They never set the
// high-water mark.

import { getState, putState } from '../crypto/storage.ts';

/** Record key under which the counter records live. */
const RECORD_SEQ_COUNTERS = 'seq-counters';

interface CounterState {
  /** Outbound sequence counters keyed by `${peerUserId}:${localDeviceId}`. */
  outbound: Record<string, number>;
  /**
   * Inbound high-water marks keyed by
   * `${senderUserId}:${senderDeviceId}:${localDeviceId}`.
   * Value is the highest counter we have successfully decrypted for that
   * sender; any envelope with c <= value must be rejected.
   */
  inbound: Record<string, number>;
}

function emptyState(): CounterState {
  return { outbound: Object.create(null), inbound: Object.create(null) };
}

async function load(userId: string): Promise<CounterState> {
  const existing = await getState<CounterState>(userId, RECORD_SEQ_COUNTERS);
  if (!existing) return emptyState();
  return {
    outbound: existing.outbound ?? Object.create(null),
    inbound: existing.inbound ?? Object.create(null),
  };
}

async function save(userId: string, state: CounterState): Promise<void> {
  await putState(userId, RECORD_SEQ_COUNTERS, state);
}

/**
 * Allocate the next outbound sequence number for messages sent from
 * `(userId, localDeviceId)` to `peerUserId`. Persists the incremented value.
 * Returns an integer >= 1.
 */
export async function nextOutboundSeq(
  userId: string,
  localDeviceId: number,
  peerUserId: string,
): Promise<number> {
  const state = await load(userId);
  const key = `${peerUserId}:${localDeviceId}`;
  const next = (state.outbound[key] ?? 0) + 1;
  state.outbound[key] = next;
  await save(userId, state);
  return next;
}

/** Result of checking+committing an inbound sequence number. */
export type InboundSeqResult =
  | { accept: true; reason: 'ok' }
  | { accept: true; reason: 'no-counter' /* v1 envelope, ignored */ }
  | { accept: true; reason: 'prekey-reset' /* new session; reset hwm */ }
  | { accept: false; reason: 'rollback'; seen: number; got: number };

/**
 * Check an inbound envelope's sequence number and (if acceptable) update the
 * high-water mark. Call AFTER successful decrypt but BEFORE delivering the
 * plaintext to the UI.
 *
 *   - `c == null` (v1 envelope): accept, do not move hwm.
 *   - PREKEY type: accept, reset hwm to c (fresh session / new chain).
 *   - WHISPER type with c <= hwm: reject (rollback/replay).
 *   - WHISPER type with c > hwm: accept, set hwm = c.
 */
export async function checkInboundSeq(
  userId: string,
  localDeviceId: number,
  senderUserId: string,
  senderDeviceId: number,
  isPreKey: boolean,
  c: number | undefined,
): Promise<InboundSeqResult> {
  if (c == null) return { accept: true, reason: 'no-counter' };
  if (!Number.isFinite(c) || !Number.isInteger(c) || c < 1) {
    // Malformed counter: treat as replay (never accept weird values).
    return { accept: false, reason: 'rollback', seen: 0, got: c };
  }
  const state = await load(userId);
  const key = `${senderUserId}:${senderDeviceId}:${localDeviceId}`;
  const hwm = state.inbound[key] ?? 0;
  if (isPreKey) {
    state.inbound[key] = c;
    await save(userId, state);
    return { accept: true, reason: 'prekey-reset' };
  }
  if (c <= hwm) {
    return { accept: false, reason: 'rollback', seen: hwm, got: c };
  }
  state.inbound[key] = c;
  await save(userId, state);
  return { accept: true, reason: 'ok' };
}

/**
 * Reset all inbound high-water marks for a given sender. Called when a new
 * PREKEY session is established outside the envelope path (e.g. explicit
 * session reset by the user) — defensive, not currently wired.
 */
export async function resetInboundFor(
  userId: string,
  localDeviceId: number,
  senderUserId: string,
): Promise<void> {
  const state = await load(userId);
  const prefix = `${senderUserId}:`;
  const suffix = `:${localDeviceId}`;
  for (const k of Object.keys(state.inbound)) {
    if (k.startsWith(prefix) && k.endsWith(suffix)) delete state.inbound[k];
  }
  await save(userId, state);
}
