# enough. — E2EE-2C Readiness Gate baseline experiment

**Status:** isolated readiness baseline verification — **NOT production**
**Date:** 2026-08-20
**Parent document:** [`docs/e2ee-2c-readiness-gate.md`](../../docs/e2ee-2c-readiness-gate.md)

This experiment verifies, against the **actual repository files**, the baseline
facts the E2EE-2C readiness gate relies on. It builds and runs **no E2EE code**
and performs **no production integration**.

## What it asserts

`test/readiness-baseline.test.mjs` (`npm test`, 5 tests):

1. `@getmaapp/signal-wasm` is **not** a root dependency of enough.
2. `sendMessage()` still writes **plaintext** into `messages.ciphertext` (no
   session-engine encryption in the message path).
3. No session-engine / secret-vault / signal-wasm file exists anywhere under
   `src/`.
4. enough. has **no declared license** (no `LICENSE`/`NOTICE` file, no
   `package.json` `license` field) — feeds the LEGAL gate.
5. There is **no Content-Security-Policy** meta tag and no `wasm-unsafe-eval`
   yet — feeds the CSP / WASM gate.

These assertions are intentionally strict: a future production-implementation
PR that starts integrating E2EE-2C would flip several of them to FAIL, which is
exactly the point. The test does **not** approve anything.

## Run

```bash
npm test
```

## Isolation rules honoured

- No import from `src/`; no import into `src/`; no dependency added.
- No Supabase access, no network, no SQL, no real user data.
- No production bundle.
