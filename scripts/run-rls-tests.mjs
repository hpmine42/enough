#!/usr/bin/env node
/**
 * enough. — Live PostgreSQL runner for RLS / authorization tests.
 *
 * Spins up an embedded real PostgreSQL (not a mock/in-memory server), applies:
 *   1. Minimal Supabase auth/role environment (roles, auth.uid, auth.users, base tables)
 *   2. All production migrations (supabase/migrations/ 0001 through 0014) in sequence
 *   3. Seed profiles for test users A and B
 *   4. supabase/rls-tests.sql (Base policies, NV-1 message update, Blocking authorization)
 *
 * No Supabase cloud credentials, service-role keys, or .env secrets required.
 *
 * Exit 0 = all tests passed. Non-zero = failure (safe as a CI gate).
 */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const A_ID = '11111111-1111-1111-1111-111111111111';
const B_ID = '22222222-2222-2222-2222-222222222222';

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function readSql(relPath) {
  return readFileSync(join(root, relPath), 'utf8');
}

async function withClient(port, fn) {
  const client = new pg.Client({
    host: '127.0.0.1',
    port,
    user: 'postgres',
    password: 'postgres',
    database: 'postgres',
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  const databaseDir = mkdtempSync(join(tmpdir(), 'enough-rls-tests-'));
  // Ephemeral high port — avoid clashing with other Postgres instances.
  const port = 56000 + Math.floor(Math.random() * 1000);

  const epg = new EmbeddedPostgres({
    databaseDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
    onLog: () => {},
    onError: (msg) => {
      process.stderr.write(`[embedded-postgres] ${msg}\n`);
    },
  });

  let failed = false;
  try {
    log('Database RLS / authorization live Postgres harness');
    log(`  data dir: ${databaseDir}`);
    log(`  port:     ${port}`);

    await epg.initialise();
    await epg.start();
    log('  embedded PostgreSQL started');

    await withClient(port, async (client) => {
      const ver = await client.query('select version() as v');
      log(`  ${ver.rows[0].v.split(',').shift()}`);

      log('— Setting up base Supabase auth & schema prerequisites');
      await client.query(`
        create role anon nologin;
        create role authenticated nologin;
        create role service_role nologin bypassrls;
        grant usage on schema public to anon, authenticated, service_role;
        create schema if not exists auth;
        grant usage on schema auth to anon, authenticated, service_role, public;
        create table if not exists auth.users (
          id uuid primary key default gen_random_uuid(),
          raw_user_meta_data jsonb default '{}'::jsonb,
          email text
        );
        grant select on auth.users to anon, authenticated, service_role;
        create or replace function auth.uid() returns uuid language sql stable as $$
          select nullif(
            coalesce(
              nullif(current_setting('request.jwt.claim.sub', true), ''),
              (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
            ),
            ''
          )::uuid;
        $$;
        grant execute on function auth.uid() to anon, authenticated, service_role, public;
        create table if not exists public.profiles (
          id uuid primary key references auth.users(id) on delete cascade,
          username text unique not null,
          created_at timestamptz not null default now()
        );
        create table if not exists public.connections (
          id uuid primary key default gen_random_uuid(),
          user_a uuid not null references auth.users(id),
          user_b uuid not null references auth.users(id),
          status text not null check (status in ('pending', 'accepted')),
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );
        create table if not exists public.messages (
          id uuid primary key default gen_random_uuid(),
          connection_id uuid not null references public.connections(id) on delete cascade,
          sender_id uuid not null references auth.users(id),
          ciphertext text not null,
          created_at timestamptz not null default now(),
          deleted_at timestamptz
        );
        alter table public.profiles enable row level security;
        alter table public.connections enable row level security;
        alter table public.messages enable row level security;
      `);

      log('— Applying migrations 0001 through 0014');
      const migrationFiles = readdirSync(join(root, 'supabase', 'migrations'))
        .filter((f) => f.endsWith('.sql'))
        .sort();

      for (const file of migrationFiles) {
        log(`  applying ${file}`);
        await client.query(readSql(join('supabase', 'migrations', file)));
      }

      log('— Seeding test profiles for User A and User B');
      await client.query(
        `insert into auth.users (id, raw_user_meta_data, email) values
           ($1, '{"display_name": "Alice"}', 'alice@example.com'),
           ($2, '{"display_name": "Bob"}', 'bob@example.com')`,
        [A_ID, B_ID],
      );
      await client.query(
        `insert into public.profiles (id, username, display_name, created_at) values
           ($1, 'alice', 'Alice', now() - interval '10 minutes'),
           ($2, 'bob', 'Bob', now() - interval '5 minutes')`,
        [A_ID, B_ID],
      );

      log('— Executing supabase/rls-tests.sql');
      client.on('notice', (n) => {
        if (n.message) log(`  ${n.message}`);
      });

      await client.query(readSql('supabase/rls-tests.sql'));
      log('  all RLS test sections completed successfully');
    });

    log('OK — all database RLS tests passed');
  } catch (err) {
    failed = true;
    const msg = err && err.message ? err.message : String(err);
    process.stderr.write(`FAIL — database RLS tests: ${msg}\n`);
    if (err && err.code) process.stderr.write(`  pg code: ${err.code}\n`);
    if (err && err.position) process.stderr.write(`  position: ${err.position}\n`);
    if (err && err.where) process.stderr.write(`  where: ${err.where}\n`);
  } finally {
    try {
      await epg.stop();
    } catch {
      /* ignore stop errors on failed boot */
    }
    try {
      rmSync(databaseDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  }

  process.exit(failed ? 1 : 0);
}

main();
