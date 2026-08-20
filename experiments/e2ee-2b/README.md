# enough. — E2EE-2B Session Engine Spike

Isolated technical spike for `@getmaapp/signal-wasm`.

This directory is **not production code**. It is never imported by the enough. app, `src/lib/crypto/index.ts`, message sending, Supabase code, or UI components.

## Run

```bash
cd experiments/e2ee-2b
npm test
npm run build
```

## Scope

- local fake Alice/Bob identities only
- local in-memory stores only
- no Supabase
- no network
- no migrations
- no changes to `messages`
- no production E2EE integration

Results and candidate comparison are documented in `../../docs/e2ee-2b-spike.md`.
