-- enough. — v0.2 profile-input hardening (0012)
-- ---------------------------------------------------------------------
-- Defense-in-depth follow-up to audit P1-3 after F9.
--
-- Scope:
--   * Normalize `profiles.display_name` on every write by stripping control
--     characters and trimming surrounding whitespace.
--   * Enforce the existing UI limit (`maxLength=60`) in the database for NEW
--     writes without risking a failing migration on older rows.
--
-- Deliberately NOT done here:
--   * `messages.ciphertext` is no longer raw peer plaintext. For peer chats it
--     is an opaque E2EE envelope whose bytes must stay exact, so message-text
--     hardening lives in the client before encryption / insert.

begin;

create or replace function public.normalize_display_name(value text)
returns text
language sql
immutable
as $$
  select nullif(
    btrim(regexp_replace(coalesce(value, ''), '[[:cntrl:]]+', ' ', 'g')),
    ''
  );
$$;

alter table public.profiles
  drop constraint if exists profiles_display_name_max_length;

alter table public.profiles
  add constraint profiles_display_name_max_length
  check (display_name is null or char_length(display_name) <= 60)
  not valid;

-- Copy display_name from the auth sign-up metadata (fallback: username) and
-- normalize it before the row is inserted.
create or replace function public.sync_profile_display_name()
returns trigger
language plpgsql
as $$
declare
  meta jsonb;
  requested text;
begin
  meta := (select raw_user_meta_data from auth.users where id = new.id);
  requested := public.normalize_display_name(
    case
      when new.display_name is null or new.display_name = '' then
        coalesce(meta->>'display_name', new.username)
      else new.display_name
    end
  );

  if requested is null then
    requested := new.username;
  end if;

  new.display_name := requested;
  return new;
end;
$$;

-- Keep the existing explicit allow-list from 0010 (`display_name` +
-- `identity_public_key`) and normalize the display name before UPDATE rows are
-- checked against the new length constraint.
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

  if old.id <> actor then
    raise exception 'A profile can only be updated by its owner.' using errcode = '42501';
  end if;

  if new.id is distinct from old.id
     or new.username is distinct from old.username
     or new.created_at is distinct from old.created_at then
    raise exception 'Only display_name and identity_public_key may be changed.' using errcode = 'P0001';
  end if;

  new.display_name := public.normalize_display_name(new.display_name);

  if new.display_name is not null and char_length(new.display_name) > 60 then
    raise exception 'display_name must be at most 60 characters.' using errcode = '23514';
  end if;

  return new;
end;
$$;

commit;
