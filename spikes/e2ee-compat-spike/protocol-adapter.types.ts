// ============================================================================
// enough. — ProtocolAdapter API boundary (TYPES ONLY — E2EE-2.5)
// ----------------------------------------------------------------------------
// DESIGN ARTIFACT. This file contains NO implementation. It exists to pin
// down the seam behind which the future, externally-sourced protocol engine
// will be wrapped, so that:
//   1. the app (UI, MessageService, storage) never touches a crypto library
//      directly, and
//   2. the concrete engine can be replaced (e.g. native WebCrypto ML-KEM once
//      shipped, or an audited protocol library once one exists) without
//      touching any caller.
//
// Target layering (docs/e2ee-session-architecture.md §18):
//   UI → MessageService → E2EESessionManager → ProtocolAdapter → Engine
//                                                    ↑ this file
// ============================================================================

// ---------------------------------------------------------------------------
// Value objects on the wire (raw bytes at this boundary; serialization to
// base64 happens in the transport layer, not here).
// ---------------------------------------------------------------------------

export interface PublicKeyBytes {
  /** 32-byte X25519 or Ed25519 public key, or 1184-byte ML-KEM-768 key. */
  readonly kind: 'x25519' | 'ed25519' | 'ml-kem-768';
  readonly raw: Uint8Array;
}

export interface PreKeyBundle {
  readonly protocolVersion: number;
  readonly identityKey: PublicKeyBytes; // Ed25519 signing identity
  readonly identityDhKey: PublicKeyBytes; // X25519 DH identity (see feasibility §7)
  readonly signedPreKeyId: number;
  readonly signedPreKey: PublicKeyBytes; // X25519
  readonly signedPreKeySignature: Uint8Array; // Ed25519 over encoded SPK
  readonly pqPreKeyId: number;
  readonly pqPreKey: PublicKeyBytes; // ML-KEM-768 (one-time or last-resort)
  readonly pqPreKeySignature: Uint8Array;
  readonly oneTimePreKeyId: number | null;
  readonly oneTimePreKey: PublicKeyBytes | null; // X25519, may be absent
}

export interface InitialMessageContainer {
  readonly protocolVersion: number;
  readonly senderIdentityKey: PublicKeyBytes;
  readonly senderIdentityDhKey: PublicKeyBytes;
  readonly ephemeralKey: PublicKeyBytes; // X25519 EK
  readonly pqCiphertext: Uint8Array; // ML-KEM-768 ct (1088 B)
  readonly usedPreKeyIds: {
    signedPreKeyId: number;
    pqPreKeyId: number;
    oneTimePreKeyId: number | null;
  };
  /** First Double Ratchet message (header + AEAD ct). */
  readonly innerMessage: RatchetMessage;
}

export interface RatchetMessage {
  readonly protocolVersion: number;
  readonly dhPublic: PublicKeyBytes; // current sending ratchet key
  readonly previousChainLength: number; // PN
  readonly messageCounter: number; // N
  readonly ciphertext: Uint8Array; // AEAD ct incl. 16-B tag
}

// ---------------------------------------------------------------------------
// The adapter boundary. Signatures are engine-agnostic; the engine maps them
// onto its own API. Every method is async because WebCrypto is async.
// ---------------------------------------------------------------------------

export interface ProtocolAdapter {
  /** Device identity: Ed25519 signing key + X25519 DH key, cross-signed. */
  createIdentity(): Promise<DeviceIdentity>;

  /** Generate prekey material to publish (incl. signatures over SPK/PQ prekeys). */
  createPreKeyBundle(identity: DeviceIdentity): Promise<PreKeyPublication>;

  /**
   * PQXDH initiator side: verify Bob's bundle, encapsulate, derive SK,
   * initialize the Double Ratchet session, and produce the first message.
   * Implemented ENTIRELY by the engine — the adapter only forwards.
   */
  createSession(
    identity: DeviceIdentity,
    peerBundle: PreKeyBundle,
    associatedDataContext: SessionContext,
  ): Promise<{ session: ProtocolSession; initialMessage: InitialMessageContainer }>;

  /**
   * PQXDH responder side: consume an initial message with the local prekey
   * secrets, derive SK, initialize the session, decrypt message 0.
   */
  acceptSession(
    identity: DeviceIdentity,
    initial: InitialMessageContainer,
    associatedDataContext: SessionContext,
  ): Promise<{ session: ProtocolSession; plaintext: Uint8Array }>;

  /** AEAD-encrypt with the session's current sending chain (steps ratchet). */
  encrypt(session: ProtocolSession, plaintext: Uint8Array, ad: Uint8Array): Promise<RatchetMessage>;

  /** Decrypt; handles skipped-message-keys, DH-ratchet steps, replay rejection. */
  decrypt(session: ProtocolSession, message: RatchetMessage, ad: Uint8Array): Promise<Uint8Array>;

  /** 60-digit display fingerprint (UX construct; not protocol security). */
  safetyNumber(identityA: PublicKeyBytes, identityB: PublicKeyBytes): Promise<string>;
}

export interface DeviceIdentity {
  readonly identityKey: PublicKeyBytes; // Ed25519 (signatures)
  readonly identityDhKey: PublicKeyBytes; // X25519 (handshake DH)
  /** Opaque, engine-owned handle to non-extractable private key material. */
  readonly privateKeyHandle: unknown;
}

export interface PreKeyPublication {
  readonly bundle: PreKeyBundle; // public part → Supabase
  /** Engine-owned opaque handles to prekey private halves → IndexedDB. */
  readonly privateHandles: unknown;
}

export interface ProtocolSession {
  readonly sessionId: string;
  readonly peerIdentityKey: PublicKeyBytes;
  readonly isPostQuantum: boolean;
  /** Opaque engine state (ratchet keys, chains, counters). Never inspected. */
  readonly engineState: unknown;
}

export interface SessionContext {
  readonly senderDeviceId: string;
  readonly recipientDeviceId: string;
  readonly connectionId: string;
}

// ---------------------------------------------------------------------------
// ENGINE SLOT — the single place where the concrete library plugs in.
//
// As of this feasibility review (see docs/e2ee-implementation-feasibility.md)
// NO vetted browser implementation of PQXDH + Double Ratchet exists, so this
// slot stays EMPTY and every method above is UNIMPLEMENTED. Candidates
// evaluated for the slot and their status are documented there. The engine
// must provide:
//   - X25519/Ed25519/HKDF/AES-256-GCM  → native WebCrypto (available today)
//   - ML-KEM-768                       → mlkem-wasm (WASM/mlkem-native) or
//                                        native WebCrypto once shipped
//   - PQXDH + Double Ratchet state machine → NO trusted browser library
//     exists as of 2026-08; E2EE-3 must not start until this slot can be
//     filled by a vetted implementation (no self-implementation).
// ---------------------------------------------------------------------------
