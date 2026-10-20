# Contributing to enough.

Thanks for your interest. enough. is a small, deliberately minimal messenger —
contributions should respect that spirit. When in doubt, open an issue first
so we can agree the change fits the project before you spend time on it.

## Prerequisites

- Node.js 24.x (matches `.github/workflows/ci.yml`)
- npm 10+

## Getting started

```sh
git clone https://github.com/hpmine42/enough.git
cd enough
npm install          # installs dependencies AND the local pre-commit hook
cp .env.example .env # fill in VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev          # starts Vite at http://localhost:5173
```

For backend setup (Supabase project, migrations, Edge Functions) see
[`docs/self-hosting.md`](docs/self-hosting.md).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server. |
| `npm run build` | TypeScript check (`tsc --noEmit`) + production bundle. |
| `npm run lint` | Run ESLint across `src/` (zero warnings required). |
| `npm run lint:fix` | Auto-fix what ESLint can fix. |
| `npm test` | Run every `test:*` suite (discovered from `package.json`). |
| `npm run test:smoke` | Run every unit suite + the jsdom production-bundle smoke test. |
| `npm run smoke` | The production-bundle jsdom smoke test only. |
| `npm run verify:signal-wasm` | Byte-exact SHA-256 check of the Signal WASM artifacts. |

Before opening a pull request, `npm run lint`, `npm run build` and `npm test`
must all pass locally. The CI runs the same checks plus the smoke test.

## Branching & pull requests

- Work against `main`; open your PR from a feature branch.
- The project uses Arena-managed working branches (`arena/<id>-enough`);
  treat `main` as the canonical branch.
- All PRs are gated by CI (`.github/workflows/ci.yml`): build, lint, every
  discovered test suite, and smoke must pass. The gate runs with NO secrets,
  so fork PRs are safe.
- Permissions on the PR are pinned to `contents: read`; Actions versions are
  pinned to full commit SHAs.
- Write clear commit messages; a PR that mixes unrelated changes is harder
  to review and more likely to be asked to split.

## Code style

- TypeScript with `strict`, `noUncheckedIndexedAccess` and
  `noImplicitOverride` enabled.
- ESLint flat config (see `eslint.config.js`): `no-explicit-any` is an
  error; `no-console` is an error outside the short allowlist of files that
  produce intentional diagnostics; `react-hooks/rules-of-hooks` and
  `react-hooks/exhaustive-deps` are enforced.
- The pre-commit hook (`.git/hooks/pre-commit`, installed automatically on
  `npm install`) runs ESLint on staged files and a full `tsc --noEmit`.
  Bypass with `git commit --no-verify` only when you have a good reason.
- All user-facing strings go through `src/i18n/translations.ts` (EN + DE).
  Do not introduce hard-coded English in a component.
- Never use `dangerouslySetInnerHTML`, `eval()`, or `new Function()` —
  the CSP blocks them and XSS is a full compromise for E2EE.

## Security

This is a messenger with end-to-end encryption. When your change touches
authentication, RLS, cryptography, the E2EE session manager, message
serialization, the service worker or the CSP, please:

1. Read the relevant document in [`docs/`](docs/) — especially
   `e2ee-architecture.md`, `e2ee-2c-readiness-gate-p0.md` and
   `auth-otp.md`.
2. Do not roll your own cryptography; extend the existing layer.
3. `sendMessage()` in `src/lib/api.ts` is a transport boundary — peer
   plaintext must never cross it. Preserve that invariant.
4. Errors that could surface to the UI or the dev console must be
   non-sensitive. Follow the pattern in `src/lib/errors.ts` (code + status,
   never raw message content).

Report security issues privately to the operator contact listed in
[`src/config/imprint.ts`](src/config/imprint.ts) — do not open a public issue.

## License

By contributing you agree that your contributions are licensed under the
project's license: **GNU Affero General Public License version 3.0 only**
(`AGPL-3.0-only`, see [`LICENSE`](LICENSE)). Runtime dependencies are
audited in [`NOTICE`](NOTICE); any new runtime dependency requires a notice
entry (`npm run test:license` enforces this).

## What is out of scope

The project's "less, but enough" philosophy means we intentionally do not
build everything. The roadmap documents what is planned; before adding a
feature, please check the existing roadmaps in [`docs/`](docs/) and confirm
it is not explicitly excluded.
