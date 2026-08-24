#!/usr/bin/env node
/**
 * enough. F3 — Live Postgres runner for E2EE prekey RPC/RLS tests.
 *
 * Spins up an embedded real PostgreSQL (not a fake/in-memory server), applies:
 *   1. supabase/tests/bootstrap_supabase_auth.sql  (auth.uid + roles + user_blocks)
 *   2. supabase/migrations/0011_crypto_prekeys.sql (production migration)
 *   3. supabase/crypto-prekeys-tests.sql           (Cases 1–8)
 * then runs a true two-connection concurrency probe for claim_prekey_bundle
 * (FOR UPDATE SKIP LOCKED).
 *
 * No Supabase cloud credentials, service-role keys, or .env secrets required.
 *
 * Exit 0 = all tests passed. Non-zero = failure (safe as a CI gate).
 */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const T = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const C1 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
const C2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';

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

async function publishTarget(client, otpCount = 8) {
  // SECURITY DEFINER path is not available here after SQL cleanup; publish as
  // table owner (postgres) which mirrors a successful owner publish.
  await client.query(
    `insert into public.crypto_devices (user_id, device_id, identity_key, registration_id)
     values ($1, 1, 'ik-concurrent', 7)
     on conflict (user_id, device_id) do update
       set identity_key = excluded.identity_key,
           registration_id = excluded.registration_id`,
    [T],
  );
  await client.query(
    `update public.crypto_signed_prekeys set is_active = false
      where user_id = $1 and device_id = 1`,
    [T],
  );
  await client.query(
    `insert into public.crypto_signed_prekeys
       (user_id, device_id, key_id, public_key, signature, is_active)
     values ($1, 1, 1, 'spk-pub', 'spk-sig', true)
     on conflict (user_id, device_id, key_id) do update
       set public_key = excluded.public_key,
           signature = excluded.signature,
           is_active = true`,
    [T],
  );
  await client.query(`delete from public.crypto_one_time_prekeys where user_id = $1`, [T]);
  await client.query(`delete from public.crypto_kyber_prekeys where user_id = $1`, [T]);
  for (let i = 1; i <= otpCount; i++) {
    await client.query(
      `insert into public.crypto_one_time_prekeys (user_id, device_id, key_id, public_key)
       values ($1, 1, $2, $3)`,
      [T, i, `otp-${i}`],
    );
  }
  await client.query(
    `insert into public.crypto_kyber_prekeys
       (user_id, device_id, key_id, public_key, signature, is_last_resort)
     values ($1, 1, 1, 'kpk-lr', 'kpk-lr-sig', true)`,
    [T],
  );
  for (let i = 1; i <= otpCount; i++) {
    await client.query(
      `insert into public.crypto_kyber_prekeys
         (user_id, device_id, key_id, public_key, signature, is_last_resort)
       values ($1, 1, $2, $3, $4, false)`,
      [T, i + 1, `kpk-ot-${i}`, `kpk-ot-sig-${i}`],
    );
  }
}

/**
 * Production claim_prekey_bundle runs as one short auto-commit transaction
 * per RPC (PostgREST). Concurrent callers therefore never hold the SPK
 * FOR UPDATE lock across a second claim — each call commits before the next
 * waits. We mirror that: two connections fire auto-commit RPCs in parallel.
 *
 * Additionally, a held-transaction probe locks the lowest unconsumed OTP with
 * FOR UPDATE and asserts a concurrent claim_prekey_bundle SKIPS that row
 * (FOR UPDATE SKIP LOCKED) and consumes a different keyId.
 */
async function runConcurrentClaimTest(port) {
  log('— Concurrency: parallel auto-commit claim_prekey_bundle RPCs');

  await withClient(port, async (setup) => {
    await setup.query(
      `insert into auth.users (id) values ($1), ($2), ($3)
       on conflict do nothing`,
      [T, C1, C2],
    );
    await publishTarget(setup, 8);
  });

  const mk = () =>
    new pg.Client({
      host: '127.0.0.1',
      port,
      user: 'postgres',
      password: 'postgres',
      database: 'postgres',
    });

  const c1 = mk();
  const c2 = mk();
  await c1.connect();
  await c2.connect();

  try {
    // Each claim runs in its own implicit transaction (auto-commit), matching
    // the production PostgREST RPC path. Auth GUCs are session-level here so
    // they survive across the single-statement RPC.
    await c1.query(
      `select set_config('request.jwt.claims', $1, false)`,
      [JSON.stringify({ sub: C1, role: 'authenticated' })],
    );
    await c1.query(`select set_config('request.jwt.claim.sub', $1, false)`, [C1]);
    await c2.query(
      `select set_config('request.jwt.claims', $1, false)`,
      [JSON.stringify({ sub: C2, role: 'authenticated' })],
    );
    await c2.query(`select set_config('request.jwt.claim.sub', $1, false)`, [C2]);

    const claimAs = async (client) => {
      await client.query('set role authenticated');
      try {
        const res = await client.query(
          'select public.claim_prekey_bundle($1) as bundle',
          [T],
        );
        return res.rows[0].bundle;
      } finally {
        await client.query('reset role');
      }
    };

    const [b1, b2] = await Promise.all([claimAs(c1), claimAs(c2)]);
    const id1 = b1?.oneTimePreKey?.keyId ?? null;
    const id2 = b2?.oneTimePreKey?.keyId ?? null;

    if (id1 == null || id2 == null) {
      throw new Error(
        `Concurrency FAIL: missing OTP in parallel claims: ${JSON.stringify({ b1, b2 })}`,
      );
    }
    if (id1 === id2) {
      throw new Error(
        `Concurrency FAIL: both RPCs claimed the same OTP keyId=${id1}`,
      );
    }

    await withClient(port, async (check) => {
      const { rows } = await check.query(
        `select key_id, consumed_by::text as consumed_by
           from public.crypto_one_time_prekeys
          where user_id = $1 and consumed_at is not null
          order by key_id`,
        [T],
      );
      if (rows.length < 2) {
        throw new Error(
          `Concurrency FAIL: expected ≥2 consumed OTPs, got ${rows.length}`,
        );
      }
      const keyIds = new Set(rows.map((r) => Number(r.key_id)));
      if (!keyIds.has(Number(id1)) || !keyIds.has(Number(id2))) {
        throw new Error(
          `Concurrency FAIL: claimed ids ${id1}/${id2} not both marked consumed: ${JSON.stringify(rows)}`,
        );
      }
      const consumers = new Set(rows.map((r) => r.consumed_by));
      if (!consumers.has(C1) || !consumers.has(C2)) {
        throw new Error(
          `Concurrency FAIL: consumed_by should include both callers: ${JSON.stringify(rows)}`,
        );
      }
    });

    log(`  PASS parallel RPCs: OTP keyIds ${id1} ≠ ${id2}`);
  } finally {
    await c1.end().catch(() => {});
    await c2.end().catch(() => {});
  }

  // --- SKIP LOCKED probe -------------------------------------------------
  // Hold a lock on the lowest unconsumed OTP in txn A. Concurrent claim as C1
  // must skip that row and consume a different keyId (not block forever).
  log('— Concurrency: FOR UPDATE SKIP LOCKED under a held OTP row lock');

  await withClient(port, async (setup) => {
    await publishTarget(setup, 5);
  });

  const locker = mk();
  const claimer = mk();
  await locker.connect();
  await claimer.connect();

  try {
    await locker.query('begin');
    const locked = await locker.query(
      `select key_id from public.crypto_one_time_prekeys
        where user_id = $1 and consumed_at is null
        order by key_id limit 1
        for update`,
      [T],
    );
    const lockedId = Number(locked.rows[0].key_id);

    await claimer.query(
      `select set_config('request.jwt.claims', $1, false)`,
      [JSON.stringify({ sub: C1, role: 'authenticated' })],
    );
    await claimer.query(`select set_config('request.jwt.claim.sub', $1, false)`, [C1]);

    // Bound the wait: if SKIP LOCKED were missing, claim would block on the
    // locked OTP (or on SPK if we also locked that). We only lock OTP here;
    // SPK is free so the RPC body proceeds and must skip the locked OTP.
    const claimPromise = (async () => {
      await claimer.query('set role authenticated');
      try {
        const res = await claimer.query(
          'select public.claim_prekey_bundle($1) as bundle',
          [T],
        );
        return res.rows[0].bundle;
      } finally {
        await claimer.query('reset role').catch(() => {});
      }
    })();

    const bundle = await Promise.race([
      claimPromise,
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                'SKIP LOCKED FAIL: claim_prekey_bundle blocked >3s on a held OTP lock',
              ),
            ),
          3000,
        ),
      ),
    ]);
    const claimedId = bundle?.oneTimePreKey?.keyId ?? null;

    if (claimedId == null) {
      throw new Error('SKIP LOCKED FAIL: claim returned no OTP while pool had free rows');
    }
    if (Number(claimedId) === lockedId) {
      throw new Error(
        `SKIP LOCKED FAIL: claim returned the locked OTP keyId=${lockedId}`,
      );
    }

    await locker.query('rollback');
    log(
      `  PASS SKIP LOCKED: held keyId=${lockedId}, claim received keyId=${claimedId}`,
    );
  } finally {
    await locker.query('rollback').catch(() => {});
    await locker.end().catch(() => {});
    await claimer.end().catch(() => {});
  }
}

async function main() {
  const databaseDir = mkdtempSync(join(tmpdir(), 'enough-crypto-prekeys-'));
  // Ephemeral high port — avoid clashing with a local Postgres if present.
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
    log('F3 crypto-prekeys live Postgres harness');
    log(`  data dir: ${databaseDir}`);
    log(`  port:     ${port}`);

    await epg.initialise();
    await epg.start();
    log('  embedded PostgreSQL started');

    await withClient(port, async (client) => {
      const ver = await client.query('select version() as v');
      log(`  ${ver.rows[0].v.split(',').shift()}`);

      log('— Applying bootstrap_supabase_auth.sql');
      await client.query(readSql('supabase/tests/bootstrap_supabase_auth.sql'));

      log('— Applying 0011_crypto_prekeys.sql (production migration)');
      await client.query(readSql('supabase/migrations/0011_crypto_prekeys.sql'));

      log('— Running crypto-prekeys-tests.sql (Cases 1–8)');
      // Capture NOTICE lines for visibility.
      client.on('notice', (n) => {
        if (n.message) log(`  ${n.message}`);
      });
      await client.query(readSql('supabase/crypto-prekeys-tests.sql'));
      log('  SQL cases 1–8 passed');
    });

    await runConcurrentClaimTest(port);
    log('OK — all live prekey RPC/RLS tests passed');
  } catch (err) {
    failed = true;
    const msg = err && err.message ? err.message : String(err);
    process.stderr.write(`FAIL — crypto-prekeys live tests: ${msg}\n`);
    if (err && err.code) process.stderr.write(`  pg code: ${err.code}\n`);
    if (err && err.position) process.stderr.write(`  position: ${err.position}\n`);
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
