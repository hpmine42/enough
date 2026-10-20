// enough. — Safety-number (fingerprint) helpers.
// ---------------------------------------------------------------------------
// A safety number is a short, human-readable digest of the two Ed25519 identity
// public keys that secure a peer conversation. It is a UI-VERIFICATION aid
// only — users can compare the number out of band (in person / via a
// trusted channel) to confirm they are talking to the same device and the
// same person. The number is NEVER used as a trust decision in code:
// TOFU acceptance and identity-mismatch rejection live entirely in
// session-manager.ts (`applyPeerTrust`, the peer-trust reset entrypoint) and do not
// consult this module at all.
//
// Format:
//   - sort the two 32-byte Ed25519 public keys lexicographically (so Alice
//     and Bob see the same number regardless of who opens the chat).
//   - SHA-256 the concatenation.
//   - render the first 30 bits of the digest as 6 groups of 5 decimal digits
//     (66 530 12 422 ...), giving ~30 bits of fingerprint entropy. This
//     matches the Signal safety-number style: long enough to catch casual
//     impersonation, short enough to compare over a phone call.

import { base64ToBytes } from '../crypto/serialization.ts';

/** Decode base64 identity keys and throw on malformed input. */
function decodeKey(b64: string): Uint8Array {
  const bytes = base64ToBytes(b64);
  if (bytes.length !== 32) throw new Error('identity key must be 32 bytes');
  return bytes;
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return 0;
}

/** Render a safety number from two base64 Ed25519 public keys. */
export async function safetyNumber(localKeyB64: string, peerKeyB64: string): Promise<string> {
  const a = decodeKey(localKeyB64);
  const b = decodeKey(peerKeyB64);
  const [first, second] = compareBytes(a, b) <= 0 ? [a, b] : [b, a];
  const combined = new Uint8Array(first.length + second.length);
  combined.set(first, 0);
  combined.set(second, first.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', combined));
  // Extract 30 bits (5 bits per group × 6 groups) from the first bytes.
  let bits = 0;
  let bitBuf = 0;
  let byteIdx = 0;
  const groups: number[] = [];
  for (let g = 0; g < 6; g++) {
    while (bits < 5) {
      bitBuf = (bitBuf << 8) | digest[byteIdx]!;
      byteIdx++;
      bits += 8;
    }
    const val = (bitBuf >>> (bits - 5)) & 0x1f; // 0..31 → 00000..99999
    bits -= 5;
    bitBuf &= (1 << bits) - 1;
    // Deterministically spread into 5 decimal digits (0..99999).
    groups.push(Math.floor((val * 100000) / 32));
  }
  return groups.map((n) => String(n).padStart(5, '0')).join(' ');
}
