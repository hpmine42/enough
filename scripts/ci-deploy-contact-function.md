# CI deploy step for the contact-form Edge Function — add to `.github/workflows/`

The Arena GitHub App token used for this branch cannot create or update
workflow files (`workflows` permission missing — the same limitation
`scripts/ci-f3-deploy-step.md` worked around). The complete workflow is
therefore shipped as [`scripts/deploy-supabase-functions.yml`](../scripts/deploy-supabase-functions.yml).
Apply it with one move on a branch that can edit workflows:

```sh
git mv scripts/deploy-supabase-functions.yml .github/workflows/deploy-supabase-functions.yml
git commit -m "CI: deploy Supabase Edge Functions to production"
```

## What the workflow does

On every push to `main` that touches `supabase/functions/**` or
`supabase/config.toml` (and via manual `workflow_dispatch`):

1. **Deploys `send-contact-email`** with the Supabase CLI. `verify_jwt = false`
   is read from `supabase/config.toml` — this matters, because the frontend
   authenticates with a non-JWT `sb_publishable_…` key, which JWT verification
   would reject.
2. **Runs a real end-to-end check** against the deployed function and fails the
   run on any deviation:
   - `OPTIONS` preflight must answer `200` and echo the allowlisted
     `https://hpmine42.github.io` origin in `Access-Control-Allow-Origin`;
   - `GET` must be rejected with `405` (method guard);
   - `POST` with the exact JSON payload the contact form sends
     (`name`, `email`, `message`, `hp`, `clientTime`) must answer `200` with
     `ok:true`. Results (status codes + response body) are written to the job
     summary. If the function answers in mock mode, the run stays green but
     emits a warning that `RESEND_API_KEY` is not configured.

## Required GitHub Actions secrets

| Secret | Purpose |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Supabase access token with deploy permission for the production project. The job fails with a clear error if it is missing. |
| `VITE_SUPABASE_URL` | Already configured for `deploy.yml`; the production project ref is derived from it. |

The job skips itself on forks (`github.repository != 'hpmine42/enough'`).

## Not managed in CI

The function's runtime secrets (`RESEND_API_KEY`, `CONTACT_TO_EMAIL`,
`RESEND_FROM_EMAIL`, `ALLOWED_ORIGIN`) stay server-side on the Supabase
project — set them once with `supabase secrets set` (see
`docs/self-hosting.md`). Their values never pass through this repository or
these logs.

## Local alternative without CI

`scripts/deploy-contact-function.mjs` performs the same deploy + E2E check
from a machine that has the Supabase CLI and `SUPABASE_ACCESS_TOKEN`:

```sh
SUPABASE_ACCESS_TOKEN=<token> node scripts/deploy-contact-function.mjs
```
