# Email OTP: analysis, decision and architecture

Status: analysis and design for the code-based email verification and
password-recovery flows (registration verification + forgot/reset password).

This document records the state found in the repository, the security
assessment of the existing link-based flows, the decision to move the
**public application flow** to one-time codes on top of **Supabase Auth's
built-in OTP support**, and the deployment configuration this requires.
It deliberately makes no claim of absolute security; every guarantee below
names the component that enforces it.

---

## 1. Scope

In scope:

* Email verification after registration (confirming the address).
* Password recovery ("forgot password" → set a new password).
* The user-facing screens, routing, i18n (EN/DE), tests and documentation
  for both flows.

Explicitly out of scope:

* **Email change** in Settings → Account. It stays on the existing
  link-based confirmation (`auth.updateUser({ email })` + the "Change
  email address" template). No code entry is introduced there.
* Login, sessions, RLS, E2EE: unchanged.
* No new email infrastructure, no new Edge Function, no new database
  objects are required for the chosen design (see §4).

---

## 2. Current state (IST)

### 2.1 Registration and email confirmation

| Step | Where | Implementation |
|---|---|---|
| Account creation | Browser | `AuthContext.signUp()` → `supabase.auth.signUp()` with `username` / `display_name` metadata and `emailRedirectTo` = `origin + pathname` (`src/context/AuthContext.tsx`) |
| Profile row | Server | `auth.users` trigger inside the sign-up transaction (migration `0001`, base trigger); idempotent authenticated upsert as fallback |
| Confirmation email | Server | Supabase Auth sends the "Confirm signup" template automatically. Content is **operator-configured in the Supabase dashboard** — by default a `{{ .ConfirmationURL }}` link. The repository contains no email templates |
| Requesting the email again | Browser → server | `AuthContext.resendConfirmation()` → `supabase.auth.resend({ type: 'signup' })` |
| Consuming the link | Browser + server | The email link points at Supabase Auth (`/auth/v1/verify`). supabase-js then detects the callback in the app URL — PKCE `?code=…` (default) or implicit `#access_token=…&type=…` (detected and handled, see `src/lib/supabase.ts`) — exchanges/loads the session and emits `SIGNED_IN`, which logs the user in. `src/lib/supabase.ts` supports **both** callback formats |
| UI before confirming | Browser | `Register.tsx` shows a "Check your email" notice with a resend button; there is **no code entry** — confirmation happens only by clicking the link |

Which parts run where:

* **Browser:** form validation, `signUp`, `resend`, URL callback detection,
  session storage, profile fallback upsert.
* **Server (Supabase Auth):** account creation, email dispatch, token
  generation/hashing, expiry, single-use consumption of the confirmation
  token, rate limiting of `/signup`, `/resend` and `/verify`.
* **Resend:** **not involved in authentication.** Resend is only the
  transport behind the `send-contact-email` Edge Function (contact form on
  the Imprint page). Auth emails go through whatever email provider the
  Supabase project is configured with (built-in provider or custom SMTP).
* **Information in the email:** confirmation link/token for the address
  only — no password, no session token, no profile data.

### 2.2 Password recovery

| Step | Where | Implementation |
|---|---|---|
| "Forgot password" | Browser → server | `AuthContext.resetPassword()` → `supabase.auth.resetPasswordForEmail(email, { redirectTo })`; UI (`ForgotPassword.tsx`) shows a neutral "If an account exists…" notice |
| Recovery email | Server | Supabase Auth sends the "Reset password" template (`{{ .ConfirmationURL }}` link by default) |
| Consuming the link | Browser + server | Same callback detection as above; supabase-js emits `PASSWORD_RECOVERY` with a session, `AuthContext` sets `recovery = true` (also covered by `hasImplicitRecoveryCallback` for the implicit format), `App.tsx` renders `ResetPassword` |
| Setting a new password | Browser → server | `supabase.auth.updateUser({ password })` — **only possible with a valid session**; without the recovery session the server rejects it (fail-closed server-side) |
| After the change | Browser | `clearRecovery()`; the session remains — the user is signed in (existing, tested behaviour: smoke test `SMOKE_RECOVERY`) |

Reset-permission semantics today: the permission to set a new password is
**the recovery session issued by Supabase Auth after the link is verified**,
not the link itself. The link/token is short-lived and single-use
(server-side). The app treats the resulting session as recovery-scoped by
showing only the password form (`recovery` flag in `App.tsx`); a page reload
mid-flow restores a normal signed-in session — that property is unchanged by
this work and is documented in §6.

### 2.3 Security properties of the existing link flow (findings)

Strengths (kept):

* Confirmation/recovery tokens are generated server-side with sufficient
  entropy, stored hashed, expire (server-side TTL) and are single-use.
* The password can only be changed with a server-issued session; the
  browser never decides validity.
* Send endpoints are rate-limited by Supabase Auth (per IP and per
  address, 60 s window per user for signup/recover/resend; documented
  project limits for email volume).
* RLS and the rest of the auth stack are untouched by the flows above.

Weaknesses of the link flow (the reason to change the public flow):

1. **Token material in URLs.** The email link carries a token through
   `/auth/v1/verify` and the redirect back into the app (PKCE `?code=` or
   implicit fragment). URLs leak via browser history, and the in-app
   callback query can leak via `Referer` before the client strips it.
2. **Email-link prefetching.** Mail security scanners click confirmation
   links and can consume a token before the user does — Supabase documents
   this as the leading cause of "token has expired" failures and
   explicitly recommends an OTP as the remedy (Supabase docs: *Email
   templates — Limitations / Email prefetching*; *OTP verification
   failures* troubleshooting page).
3. **Click-through phishing surface.** A link asks the user to trust the
   URL; a code typed into the already-open app does not.
4. Re-authentication UX: the link opens a *new* navigation context; the
   code keeps the user in the flow they started.

A code-based flow removes (1) and (2) entirely and reduces (3). Its one
*new* attack surface is **guessing the code**, which is why code entropy,
TTL and rate limiting (§5) are first-class requirements here.

---

## 3. Why not a custom OTP implementation?

Considered and rejected: an own Edge-Function + database-table OTP layer
(code table with HMAC, custom reset tickets, service-role password set).
Reasons:

* It would **replace a maintained, audited server component** (Supabase
  Auth token handling, hashing, single-use consumption, rate limiting)
  with new security-sensitive code, plus new secrets handling
  (`service_role` inside a function), new RLS/deny policies and new
  failure modes — for no security property that Supabase Auth does not
  already provide in this design.
* It would need its **own transactional email path** for auth codes
  (Resend), i.e. new email infrastructure for authentication — explicitly
  unwanted when the existing Supabase Auth mail pipeline already delivers
  these emails.
* Supabase Auth natively supports exactly the required exchange:
  `signUp`/`resetPasswordForEmail`/`resend` dispatch the code, and
  `supabase.auth.verifyOtp({ email, token, type })` validates it
  server-side and returns the session (`type: 'signup'` → confirmation +
  session; `type: 'recovery'` → reset session + `PASSWORD_RECOVERY`
  event).

A custom build would therefore be a *naive reimplementation*, weaker in
reviewability and operability than the supported path.

---

## 4. Target architecture (chosen)

All flows use Supabase Auth's built-in email OTP. The **emails are
triggered exactly as today**; what changes is what the email contains
(dashboard template: `{{ .Token }}` code instead of a link) and how the
app consumes it (code entry + `verifyOtp` instead of link callback).

### 4.1 Registration / email verification

1. User registers → `supabase.auth.signUp()` (unchanged) → account exists,
   profile trigger runs, Supabase Auth emails a **one-time code**.
2. `Register.tsx` switches from the notice to a **code-entry screen**
   (code field with `autocomplete="one-time-code"`, resend button with a
   60 s cooldown, localized errors).
3. Submit → `AuthContext.verifySignupCode()` →
   `supabase.auth.verifyOtp({ email, token, type: 'signup' })`.
4. Supabase Auth checks the code **server-side** (hashed at rest,
   purpose- and address-bound, TTL-bound, single-use) and confirms the
   address; the returned session signs the user in (same result as
   clicking the link today).
5. The code is consumed by a successful verify and cannot be used again
   (upstream single-use; see §5).

### 4.2 Password recovery

1. `#/forgot`: user submits the email → `resetPasswordForEmail()`
   (unchanged call) → **always the same neutral notice** (§7).
2. The screen switches to **code entry** (60 s resend cooldown).
3. Submit → `AuthContext.verifyRecoveryCode()` →
   `supabase.auth.verifyOtp({ email, token, type: 'recovery' })`.
4. On success Supabase Auth returns a **short-lived recovery session** —
   this is the "reset permission": a server-issued, account-bound,
   time-limited session that the server (not the browser) controls. The
   client library emits `PASSWORD_RECOVERY`, `AuthContext` sets
   `recovery = true`, `App.tsx` renders the password form.
5. Only with that session does `supabase.auth.updateUser({ password })`
   succeed; without it the server rejects the call (unchanged,
   fail-closed).
6. The **code** dies at step 4 (single-use). After the password change
   the app clears the recovery state and the session continues as the
   user's normal signed-in session — exactly the semantics of the
   previous link flow (see §6 for the precise mapping).

### 4.3 What stays internal, what is replaced

| Replaced (public flow) | Stays (internal / other flows) |
|---|---|
| Waiting for a confirmation **link** click → code entry | Supabase Auth's internal token machinery (`/verify`, hashed storage, TTL) — it validates the code |
| Recovery **link** click → automatic redirect into the app → code entry | URL callback detection in `src/lib/supabase.ts` (`PKCE` + implicit) — still needed for **in-flight link emails** and for the **email-change** flow |
| Notice-only confirmation screen | `PASSWORD_RECOVERY` / `hasImplicitRecoveryCallback` handling — the OTP path emits the same event |
| — | Resend remains contact-form only; no auth changes |

Old emails that were sent before the template switch keep working through
the callback path; once the dashboard templates carry only `{{ .Token }}`,
no auth link enters the browser at all for these two flows.

---

## 5. Code properties and where they are enforced

| Property | Value | Enforced by |
|---|---|---|
| Generation | Cryptographic RNG inside Supabase Auth (GoTrue); never in the browser | Supabase Auth |
| Format | Numeric code of configurable length (`GOTRUE_MAILER_OTP_LENGTH`, dashboard: *Authentication → Sign In / Providers → Email → OTP Settings*). **Deployment requirement: length ≥ 8 (10 recommended)** — see §8 | Supabase Auth (operator config) |
| Entropy | `length × log2(10)` bits: 8 digits ≈ 26.6 bits, 10 digits ≈ 33.2 bits — meaningful only together with TTL + rate limits (§8) | combination of config |
| Storage | Hashed server-side (the raw code is never readable from storage); plaintext only exists in the email and in the typed field | Supabase Auth |
| TTL | `GOTRUE_MAILER_OTP_EXP` (dashboard: *Providers → Email*). **Deployment requirement: ≤ 3600 s, 600–900 s recommended** | Supabase Auth (operator config) |
| Single use | A successful `verify` consumes the code; a second verify fails (`otp_expired`) | Supabase Auth |
| Purpose binding | `type` (`signup` vs `recovery`) selects a different stored token; a confirmation code cannot be verified as a recovery code and vice versa | Supabase Auth |
| Account binding | The verify request carries the email; the stored code resolves to that one user | Supabase Auth |
| Rate limits | Send: per-user 60 s window + project email quotas. Verify: per-IP token bucket (default 30 requests / 5 min, configurable `rate_limit_verify`) | Supabase Auth |
| Brute force (client) | 60 s resend cooldown mirrors the server window (UX, **not** a security control); no local "validity" decisions — every accept/reject comes from the server | this repository |
| Race on double submit | UI `busy` guard prevents two parallel verifies from the same form; server-side consumption is atomic (single-use) | app + Supabase Auth |
| Replay | Consumed code fails (`otp_expired`); a used recovery code cannot re-issue a session | Supabase Auth |
| Logging | The client never logs the entered code; `errors.ts` logs only code/status/name metadata | this repository |
| URL/history/referrer leakage | The code never enters a URL in these flows | this repository |

Known upstream limitation (documented honestly): Supabase Auth applies a
**per-IP** rate limit to `/verify` but no per-code failed-attempt cap
(open upstream discussion, supabase/auth#2819). The compensating controls
are the code length, the short TTL and the per-IP limit — which is why the
§8 deployment values are requirements, not suggestions.

## 6. Reset-permission semantics (requirements mapping)

* The reset permission is issued **by the server only after** the code is
  proven — the code itself is never a bearer credential for any API call.
* It is **short-lived** (access-token TTL, server-controlled) and **bound
  to the one account**.
* During the flow the app exposes only the password form
  (`recovery` state in `App.tsx`); the code cannot be used for anything
  else, and after a successful verify it is spent.
* After the password change the recovery state is cleared. The session
  that remains is the account's normal signed-in session — this is the
  *unchanged* behaviour of the existing link flow (smoke-tested), not a
  new grant. Supabase Auth sessions are not scoped down to a single
  endpoint by the platform; a stricter "password-only" session would
  require a custom auth service and was rejected in §3.
* A reload between "code verified" and "password set" restores a normal
  signed-in session (same as today's link flow after a link click).

## 7. Enumeration handling

* **Recovery request (`#/forgot`)**: the UI always shows the same neutral
  notice. A per-address frequency error (`over_email_send_rate_limit`),
  whose existence can depend on whether the account is known, is treated
  as success (console-only diagnostic) so the visible reply is identical
  for existing and unknown addresses. Network failures show the generic
  network error — not existence-dependent.
* **Code entry**: wrong code, expired code, consumed code and unknown
  address all surface the **same** localized message
  (`errors.otpInvalid`); raw server text is never displayed.
* **Registration** inherently reveals duplicate addresses through
  Supabase Auth's signup response (pre-existing, unchanged behaviour of
  this app and platform).
* Resend cooldowns are identical regardless of account state.

## 8. Deployment configuration (required)

These are Supabase project settings — they cannot be set by a migration or
by application code. They are part of the security requirement of this
design and are documented in `README.md` and `docs/self-hosting.md`:

1. **Email templates** (Dashboard → Authentication → Emails):
   * *Confirm signup*: body contains `{{ .Token }}` (the code), **no**
     `{{ .ConfirmationURL }}`.
   * *Reset password*: body contains `{{ .Token }}`, **no**
     `{{ .ConfirmationURL }}`.
   * Rationale for removing the URL: a remaining link would keep the
     prefetch/URL-leak weaknesses and would let a scanner consume the
     token before the user types the code.
   * *Change email address* keeps its link (out of scope).
2. **OTP length ≥ 8** (10 preferred) — same settings page.
3. **OTP expiry ≤ 3600 s** (600–900 s recommended).
4. **Rate limits** (Dashboard → Authentication → Rate Limits): keep the
   defaults or tighten `rate_limit_verify`; do not raise them for these
   flows.
5. Email delivery continues to use the project's configured provider
   (built-in or custom SMTP — Resend is used only if the operator
   configured it as the project's SMTP or for the contact form; nothing in
   this repository changes that).

Entropy assessment (why these values): 6-digit codes with the platform's
default 24 h expiry would leave a realistic brute-force window against a
per-IP-only verify limit (upstream analysis in supabase/auth#2819). With
10 digits (≈ 33 bits) and a 10–15 minute TTL, the guess budget an attacker
can buy within the window (per-IP 30 req / 5 min) is orders of magnitude
below the search space. This is the "security analysis before a short
code" the design is required to make — the code is acceptable **because**
of length + TTL + rate limiting together, not on its own.

## 9. Test strategy

Server-side properties (generation, hashing at rest, atomic single-use,
TTL, purpose binding, platform rate limits) are Supabase Auth's and cannot
be executed in this repository's offline test harness — they are covered
by platform guarantees and documented in §5. What this repository tests:

* Unit tests (`src/lib/__tests__/auth-otp.test.mjs`): code input
  normalization/format guard, resend-cooldown logic, error mapping for
  verify responses (wrong/expired/used → one neutral message, rate limits
  → neutral message), source-level wiring assertions (verify is always
  delegated to `verifyOtp` with the correct `type`; no client-side
  validity decision; no code in any log call).
* `test:errors`: localized mapping of `otp_expired`, invalid-token and
  rate-limit errors.
* Smoke tests (production bundle in jsdom, stubbed Supabase API): the
  code-entry screens, wrong-code error surface, resend behaviour, and — in
  the `SMOKE_OTP` scenario — full registration-by-code and
  recovery-by-code walkthroughs up to the signed-in home screen.
* All pre-existing suites (RLS, crypto, i18n, privacy, build) must stay
  green; RLS and E2EE are untouched (no database objects, no crypto).
