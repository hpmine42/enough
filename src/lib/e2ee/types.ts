// enough. E2EE-v0.2 — serializable boundary types.
// ---------------------------------------------------------------------------
// Plain data types that cross the E2EE boundary (UI ↔ session manager ↔
// storage/Supabase). NO WASM types live here or leak out of the engine
// adapter: everything the adapter returns is plain bytes / numbers / strings.

/** Envelope format version (stored in messages.ciphertext JSON). */
export const ENVELOPE_VERSION = 1 as const;
/** Engine identifier recorded in every envelope. */
export const ENVELOPE_ENGINE = 'sw' as const;
/** Single device per account in v0.2 (multi-device is deferred). */
export const DEVICE_ID = 1;

/** libsignal message type. 2 = WHISPER (normal), 3 = PREKEY. */
export type SignalMessageType = 2 | 3;
export const MESSAGE_TYPE_WHISPER = 2;
export const MESSAGE_TYPE_PREKEY = 3;

/**
 * The opaque record stored in `messages.ciphertext` as a JSON string.
 *
 * Legacy plaintext rows are NOT valid envelopes: detection is "does the parsed
 * value have numeric `v` and string `e`?" (see session-manager). Only
 * `kind === 'text'` messages ever become envelopes; system messages keep an
 * empty/meta ciphertext.
 */
export interface MessageEnvelope {
  v: typeof ENVELOPE_VERSION;
  e: typeof ENVELOPE_ENGINE;
  t: SignalMessageType;
  /** base64 of the libsignal ciphertext body. */
  b: string;
}

/** Public portion of a signed prekey, safe to publish to Supabase. */
export interface PublicSignedPreKey {
  keyId: number;
  /** base64, raw X25519 public key bytes. */
  publicKey: string;
  /** base64, 64-byte Ed25519 signature. */
  signature: string;
}

/** Public portion of a one-time prekey, safe to publish. */
export interface PublicOneTimePreKey {
  keyId: number;
  /** base64, raw X25519 public key bytes. */
  publicKey: string;
}

/** Public portion of a Kyber prekey, safe to publish. */
export interface PublicKyberPreKey {
  keyId: number;
  /** base64, raw Kyber1024 public key bytes. */
  publicKey: string;
  /** base64, 64-byte Ed25519 signature. */
  signature: string;
  /** last-resort keys are reusable and never atomically consumed. */
  isLastResort: boolean;
}

/**
 * A peer device's full public prekey bundle, as returned by the
 * `claim_prekey_bundle` RPC and consumed by session establishment.
 */
export interface PeerPreKeyBundle {
  userId: string;
  deviceId: number;
  registrationId: number;
  /** base64 serialized Signal identity public key. */
  identityKey: string;
  signedPreKey: PublicSignedPreKey;
  oneTimePreKey: PublicOneTimePreKey | null;
  kyberPreKey: PublicKyberPreKey;
}

/** The local device's public material, ready to publish to Supabase. */
export interface PublicDeviceMaterial {
  /** base64 serialized Signal identity public key. */
  identityKey: string;
  registrationId: number;
  signedPreKey: PublicSignedPreKey;
  oneTimePreKeys: PublicOneTimePreKey[];
  kyberPreKeys: PublicKyberPreKey[];
}

/** Trust state for a peer identity (TOFU). Stored locally, never on Supabase. */
export type PeerTrustState = 'unverified' | 'verified' | 'identity_changed';
