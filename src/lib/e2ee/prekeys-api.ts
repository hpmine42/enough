// enough. E2EE-v0.2 — Supabase prekey publication & bundle claim.
// ---------------------------------------------------------------------------
// The Supabase I/O for the prekey infrastructure. It knows nothing about the
// engine: it ships PUBLIC material (base64 public keys + signatures) to the
// crypto_* tables and fetches a peer bundle via the atomic
// `claim_prekey_bundle` RPC. Private prekey records never appear here — they
// are persisted locally by device-store.ts.
//
// No private key material is ever sent to Supabase through this module.

import { supabase } from '../supabase';
import { errorMessage } from '../errors';
import { t } from '../../i18n';
import type {
  PeerPreKeyBundle,
  PublicDeviceMaterial,
} from './types';

/** Result of fetching a peer bundle. `kind` lets the caller branch cleanly. */
export type FetchBundleResult =
  | { kind: 'ok'; bundle: PeerPreKeyBundle }
  | { kind: 'self' } // caller tried to claim their own bundle
  | { kind: 'blocked' } // a block exists in either direction
  | { kind: 'no-device' } // target has not published a device
  | { kind: 'error'; message: string };

/**
 * Publish (overwrite) the local device's PUBLIC material. Idempotent: the
 * device row + active signed prekey are upserted; one-time/kyber prekeys are
 * inserted (the caller deletes superseded rows first when refilling).
 */
export async function publishDeviceMaterial(
  userId: string,
  material: PublicDeviceMaterial,
): Promise<string | null> {
  if (!supabase) return t('errors.network');
  if (!userId) return t('errors.generic');

  const { error: devErr } = await supabase
    .from('crypto_devices')
    .upsert(
      {
        user_id: userId,
        device_id: 1,
        identity_key: material.identityKey,
        registration_id: material.registrationId,
      },
      { onConflict: 'user_id,device_id' },
    );
  if (devErr) return errorMessage(devErr, 'crypto_devices upsert');

  // Deactivate prior active signed prekeys for this device, then insert the new one.
  await supabase
    .from('crypto_signed_prekeys')
    .update({ is_active: false })
    .eq('user_id', userId)
    .eq('device_id', 1)
    .eq('is_active', true)
    .neq('key_id', material.signedPreKey.keyId);

  const { error: spkErr } = await supabase.from('crypto_signed_prekeys').upsert(
    {
      user_id: userId,
      device_id: 1,
      key_id: material.signedPreKey.keyId,
      public_key: material.signedPreKey.publicKey,
      signature: material.signedPreKey.signature,
      is_active: true,
    },
    { onConflict: 'user_id,device_id,key_id' },
  );
  if (spkErr) return errorMessage(spkErr, 'crypto_signed_prekeys upsert');

  if (material.oneTimePreKeys.length > 0) {
    const rows = material.oneTimePreKeys.map((o) => ({
      user_id: userId,
      device_id: 1,
      key_id: o.keyId,
      public_key: o.publicKey,
    }));
    const { error: otpErr } = await supabase.from('crypto_one_time_prekeys').upsert(rows, {
      onConflict: 'user_id,device_id,key_id',
    });
    if (otpErr) return errorMessage(otpErr, 'crypto_one_time_prekeys upsert');
  }

  if (material.kyberPreKeys.length > 0) {
    const rows = material.kyberPreKeys.map((k) => ({
      user_id: userId,
      device_id: 1,
      key_id: k.keyId,
      public_key: k.publicKey,
      signature: k.signature,
      is_last_resort: k.isLastResort,
    }));
    const { error: kpkErr } = await supabase.from('crypto_kyber_prekeys').upsert(rows, {
      onConflict: 'user_id,device_id,key_id',
    });
    if (kpkErr) return errorMessage(kpkErr, 'crypto_kyber_prekeys upsert');
  }

  return null;
}

/**
 * Atomically claim a peer's prekey bundle. The server locks rows with
 * FOR UPDATE SKIP LOCKED and stamps one-time keys consumed in the same
 * transaction, so two callers never get the same one-time prekey.
 */
export async function fetchPeerBundle(peerUserId: string): Promise<FetchBundleResult> {
  if (!supabase) return { kind: 'error', message: t('errors.network') };
  const { data, error } = await supabase.rpc('claim_prekey_bundle', { p_target: peerUserId });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === 'BLCKD') return { kind: 'blocked' };
    if (code === 'P0001') {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('own')) return { kind: 'self' };
      return { kind: 'no-device' };
    }
    return { kind: 'error', message: errorMessage(error, 'claim_prekey_bundle') };
  }
  if (!data) return { kind: 'no-device' };
  return { kind: 'ok', bundle: data as PeerPreKeyBundle };
}

/** Number of unconsumed one-time prekeys the owner still has published. */
export async function countAvailableOneTimePreKeys(userId: string): Promise<number> {
  if (!supabase) return 0;
  const { count, error } = await supabase
    .from('crypto_one_time_prekeys')
    .select('key_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('device_id', 1)
    .is('consumed_at', null);
  return error ? 0 : count ?? 0;
}

/** Number of unconsumed one-time Kyber prekeys the owner still has published. */
export async function countAvailableKyberPreKeys(userId: string): Promise<number> {
  if (!supabase) return 0;
  const { count, error } = await supabase
    .from('crypto_kyber_prekeys')
    .select('key_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('device_id', 1)
    .is('consumed_at', null)
    .eq('is_last_resort', false);
  return error ? 0 : count ?? 0;
}
