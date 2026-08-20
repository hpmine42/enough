# enough. — E2EE-2C architecture experiments

**Status:** isolated architecture experiments — **NOT production**
**Date:** 2026-08-20
**Parent document:** [`docs/e2ee-2c-architecture.md`](../../docs/e2ee-2c-architecture.md)

This directory answers persistence and secret-handling questions that the
E2EE-2C architecture needs before any production work:

1. Can opaque `Uint8Array` protocol records (the shape `@getmaapp/signal-wasm`
   exports) be wrapped with a **non-extractable** Web Crypto AES-256-GCM key?
2. Can identity, session, Kyber-usage and tombstone writes be committed in
   **one IndexedDB transaction**?
3. Can a monotonic revision reject a restored older session (rollback)?
4. Does wrapping actually stop XSS? (**No.** The tests demonstrate the
   remaining security boundary.)

## Isolation rules

- No import from `src/`.
- No import into `src/`.
- No `@getmaapp/signal-wasm` dependency (the records are opaque bytes).
- No Supabase, no network, no real user data.
- No secrets committed to git. All keys are generated at test runtime.
- No production bundle. `npm run build` is a no-op by design.

## Run

```bash
cd experiments/e2ee-2c
npm ci
npm test
npm run build
```

These tests are **not** a cryptographic audit of libsignal or the wrapper.
They only exercise the proposed enough. storage boundary.
