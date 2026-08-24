# F3 CI gate — add to `.github/workflows/deploy.yml`

The Arena GitHub App token used for this branch cannot update workflow files
(`workflows` permission missing). Apply the following step on a branch/PR that
_can_ edit `.github/workflows/deploy.yml`.

Insert **after** the existing `Smoke test` step and **before** `Setup Pages`
so a failure never deploys:

```yaml
      # F3: real PostgreSQL RPC/RLS tests (embedded Postgres, no cloud secrets).
      # Runs after the existing F4 gates and before deploy so a failure blocks Pages.
      - name: Test crypto prekeys (live Postgres RPC/RLS)
        run: npm run test:crypto:prekeys
```

No extra GitHub Secrets are required. `npm ci` already installs
`embedded-postgres` + `pg` (devDependencies).

Local verification:

```sh
npm run test:crypto:prekeys
```
