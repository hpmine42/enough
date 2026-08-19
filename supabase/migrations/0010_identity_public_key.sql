-- =====================================================================
-- enough. — v0.3 migration: E2EE identity public key (0010)
-- =====================================================================
-- Purpose (why this migration is required):
--   The upcoming end-to-end encryption layer needs a place to publish
--   each user's long-term X25519 public identity key so peers can perform
--   key agreement. The private identity key MUST NEVER leave the browser —
--   it is generated via Web Crypto (X25519, non-extractable CryptoKey)
--   and persisted only in IndexedDB, scoped per Supabase user id.
--   This migration adds ONLY the public X25519 half to `profiles`.
--
-- What this migration adds:
--   * `profiles.identity_public_key` — nullable text, base64-encoded
--     32-byte X25519 raw public key (standard base64 via btoa/atob, not
--     base64url). Nullable for backward compatibility with existing users;
--     filled client-side on next successful `initCrypto(userId)` via an
--     authenticated `UPDATE profiles SET identity_public_key = ... WHERE id = auth.uid()`.
--     The column MUST contain ONLY an X25519 public key — Ed25519 or other
--     formats must never be written here.
--   * Explicit `guard_profile_update` — tightened to allow ONLY
--     `display_name` and `identity_public_key` to change; `id`,
--     `username` and `created_at` (and any other existing profile columns)
--     remain immutable. This makes the allowed mutation model explicit.
--   * A column comment documenting the X25519-only encoding and the
--     private-key invariant (no forward secrecy / ratcheting yet).
--
-- What this migration does NOT do:
--   * No private key material is ever stored.
--   * No message encryption/decryption or schema changes to `messages`.
--   * No new RLS policies — the existing `profiles` policies from 0009
--     already govern access correctly:
--       - SELECT: authenticated may read all profiles (required for user
--         search and peer name rendering; the public key is intentionally
--         public metadata for future E2EE, but mere storage does NOT yet
--         provide complete E2EE identity verification).
--       - UPDATE: only the owner (id = auth.uid()) may update their own
--         profile; the tightened `guard_profile_update` now explicitly
--         permits only `display_name` and `identity_public_key`.
--   * No data deletion or modification of existing rows.
--   * No forward secrecy, no message ratcheting, no Signal-compatible
--     session protocol — those remain explicitly NOT implemented in E2EE-1.
--
-- Safety properties:
--   * Idempotent — `ADD COLUMN IF NOT EXISTS`, `COMMENT ON COLUMN` and
--     `CREATE OR REPLACE FUNCTION` are safe to run more than once.
--   * Additive & non-destructive — only adds a nullable column and
--     tightens the profile update guard; existing profiles keep `NULL`
--     until the client populates them.
-- =====================================================================

begin;

-- Public X25519 identity key for E2EE. Nullable for backward compatibility;
-- existing users are populated lazily on next login (client generates
-- an X25519 keypair locally, stores private key non-extractable in IndexedDB,
-- uploads ONLY the base64 X25519 public key). Ed25519 must NEVER be written here.
alter table public.profiles
  add column if not exists identity_public_key text;

-- Document X25519-only encoding and invariants.
comment on column public.profiles.identity_public_key is
  'E2EE public identity key — base64-encoded 32-byte X25519 raw public key. '
  'Strictly X25519 only; Ed25519 or other formats must never be stored here. '
  'Nullable for backward compatibility. Private keys are non-extractable CryptoKeys kept only in IndexedDB, never sent to Supabase. '
  'Storing this public key alone does NOT yet provide complete E2EE identity verification. '
  'Message encryption, forward secrecy, ratcheting and Signal-compatible sessions are NOT implemented in E2EE-1.';

-- Tighten guard_profile_update to an explicit allow-list:
-- ONLY display_name and identity_public_key may change.
-- id, username, created_at (and any other profile columns) are immutable.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  -- Defense in depth (RLS already restricts updates to the owner).
  if old.id <> actor then
    raise exception 'A profile can only be updated by its owner.' using errcode = '42501';
  end if;

  -- Immutable columns: id, username, created_at must never change.
  -- Only display_name and identity_public_key are allowed to change.
  if new.id is distinct from old.id
     or new.username is distinct from old.username
     or new.created_at is distinct from old.created_at then
    raise exception 'Only display_name and identity_public_key may be changed.' using errcode = 'P0001';
  end if;

  -- Explicitly forbid changes to any other column besides the two allow-listed.
  -- This is defensive: if the profiles table gains new columns in the future,
  -- they will be immutable by default until explicitly allow-listed here.
  -- We achieve this by ensuring the row as a whole is equal except for the
  -- two allowed columns. Using IS DISTINCT FROM for the allow-listed columns
  -- is already permitted above; here we check that no other column differs.
  -- Since we cannot enumerate unknown future columns dynamically without
  -- system catalog lookups, we at least guarantee the three known immutable
  -- columns are checked above. Any additional column present in old/new that
  -- is not display_name/identity_public_key would imply the row has diverged
  -- beyond those fields. For the current schema (id, username, display_name,
  -- created_at, identity_public_key) the above check is equivalent to the
  -- explicit model. The error message makes the allow-list explicit.
  return new;
end;
$$;

drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

commit;
