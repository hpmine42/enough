# enough. — v0.2 Technical, Security & Quality Roadmap

> **Purpose:** This document defines the approved technical work required to bring `enough.` toward a robust v0.2 release.
>
> **Scope:** Security, correctness, reliability, performance, accessibility, testing, maintainability, deployment verification, and release readiness.
>
> **Important:** This is a living execution roadmap. The current repository, Git history, tests, migrations, and verified deployment state determine whether a roadmap item has already been completed.
>
> **Product features are intentionally NOT part of this roadmap.**
>
> Arena may implement only the approved work described here.
>
> Arena may update only the completion status of existing items:
>
> ```text
> [ ] → [x]
> ```
>
> Arena MUST NOT add, remove, rename, reorder, reprioritize, rewrite, or invent roadmap items.
>
> If an item is obsolete, incorrectly described, blocked, or requires a product decision, Arena must report that fact instead of modifying the roadmap content.

---

# 1. ROADMAP EXECUTION RULES

## 1.1 Roadmap = approved target

This roadmap defines the approved technical target for v0.2.

It is not a source of permission to invent product functionality.

## 1.2 Repository = current reality

The current repository determines what is actually implemented.

Before working on any item, verify:

* current code;
* current tests;
* current migrations;
* recent Git history;
* merged PRs;
* relevant deployed state.

## 1.3 Completed work

If an item is already implemented, do not reimplement it.

If the item is already correctly completed, Arena may mark its checkbox:

```text
[x]
```

and nothing else.

## 1.4 Unclear or obsolete work

If the current repository shows that an item is:

* obsolete;
* incorrectly described;
* replaced by a better implementation;
* blocked;
* dependent on an external decision;
* or no longer appropriate;

Arena MUST NOT rewrite the roadmap.

It must report the issue.

## 1.5 Product scope

This roadmap contains no autonomous product-feature backlog.

New user-facing features require a separate product decision and a separate feature roadmap.

---

# 2. PRIORITY MODEL

Work should be approached in this order:

1. Security verification and authorization
2. Security hardening
3. Correctness and data integrity
4. Reliability and stability
5. Performance
6. Accessibility
7. Testing and regression coverage
8. Maintainability and technical quality
9. Release readiness

Do not work on a lower-priority item while a higher-priority approved item remains actionable, unless the higher-priority item is blocked or requires an external decision.

---

# 3. PHASE A — SECURITY & DEPLOYMENT VERIFICATION

## A1. Verify deployed Supabase authorization policies

**Priority:** P1
**Type:** VERIFY ONLY

* [ ] Verify deployed `messages` INSERT/UPDATE policies.
* [ ] Verify deployed `profiles` SELECT/UPDATE policies.
* [ ] Verify deployed `connections` SELECT/INSERT/UPDATE policies.
* [ ] Confirm that no permissive legacy policy remains active alongside the explicit policies.
* [ ] Confirm deployed behavior matches the repository migrations.

**Important:**

The repository already contains explicit authorization hardening.

This task is about verifying the actual deployed Supabase state, not recreating the migration.

Do not create another migration unless the deployed verification demonstrates a real remaining problem.

---

## A2. Verify deployed Supabase authentication configuration

**Priority:** P1
**Type:** VERIFY ONLY

* [ ] Verify production email-confirmation redirect behavior.
* [ ] Verify password-recovery links use the intended production URL.
* [ ] Verify redirect URLs are correctly allow-listed.
* [ ] Verify the deployed authentication flow configuration is compatible with the application.
* [ ] Verify the actual recovery flow end-to-end.

This is a deployment/configuration verification task.

Do not change authentication architecture without an explicit reason.

---

## A3. CSP and Referrer-Policy

**Priority:** P1

* [x] Add CSP meta policy appropriate for the application.
* [x] Add explicit referrer policy.
* [x] Add regression assertions to the smoke test.
* [x] Preserve compatibility with the existing inline theme bootstrap.
* [x] Do not introduce `unsafe-eval` or unnecessarily broad source policies.

---

## A4. Input and data-boundary hardening

**Priority:** P1

* [x] Sanitize display names at the approved input boundaries.
* [x] Enforce the server-side display-name length invariant.
* [x] Sanitize outgoing message plaintext before encryption.
* [x] Keep ciphertext opaque after encryption.
* [x] Ensure transport code does not sanitize, trim, normalize, or otherwise mutate ciphertext.
* [x] Ensure incoming ciphertext does not pass through plaintext sanitization.
* [x] Preserve legitimate Unicode.

---

## A5. i18n interpolation correctness

**Priority:** P1

* [x] Ensure parameter values cannot be reinterpreted as translation placeholders.
* [x] Preserve repeated placeholders.
* [x] Preserve missing/unused-parameter behavior.
* [x] Preserve existing EN/DE behavior.
* [x] Preserve literal values such as `$&` and `$1`.
* [x] Preserve prototype safety.

---

# 4. PHASE B — PERFORMANCE & RUNTIME EFFICIENCY

## B1. Unread-count query complexity

**Priority:** P1

* [x] Eliminate per-connection unread queries.
* [x] Ensure the `connection_unread` view covers connections without a read-state row.
* [x] Maintain bounded fallback behavior.
* [x] Preserve user scoping and message filters.
* [x] Maintain regression coverage for multiple connection counts.

---

## B2. Home realtime efficiency

**Priority:** P1

* [x] Replace unnecessary full Home reloads with incremental updates where appropriate.
* [x] Preserve reconciliation behavior.
* [x] Preserve correctness under realtime events.
* [x] Preserve deduplication.
* [x] Preserve connection/profile/message consistency.

---

# 5. PHASE C — RELIABILITY & UX CORRECTNESS

## C1. Data-layer error surfacing

**Priority:** P2

* [x] Surface API read errors instead of returning misleading empty states.
* [x] Provide appropriate retry behavior.
* [x] Preserve already-loaded chat history where possible.
* [x] Localize relevant error messages.
* [x] Preserve successful-path behavior.

---

## C2. Global error boundary

**Priority:** P2

* [x] Add a global React error boundary.
* [x] Provide a localized recovery UI.
* [x] Provide a reload action.
* [x] Verify that a render crash no longer produces a blank screen.

---

## C3. Dialog and Bottom Sheet focus management

**Priority:** P2

* [x] Trap focus inside dialogs and sheets.
* [x] Preserve Escape behavior.
* [x] Preserve existing accessibility semantics.
* [x] Avoid focus leaks into the page behind the modal.

---

## C4. Fresh-message timestamp

**Priority:** P2

* [x] Replace misleading `"1 min"` output for freshly created messages.
* [x] Support localized `"just now"` / equivalent behavior.
* [x] Preserve existing longer-duration formatting.

---

# 6. PHASE D — ACCESSIBILITY & INTERACTION QUALITY

## D1. Accessibility consistency

**Priority:** P2/P3

* [ ] Review icon-only controls for missing `aria-label`.
* [ ] Ensure dialogs and sheets expose correct accessible names.
* [ ] Ensure keyboard navigation remains functional.
* [ ] Ensure screen-reader behavior remains coherent.
* [ ] Verify reduced-motion behavior remains intact.

This is a technical accessibility target, not a product feature expansion.

---

# 7. PHASE E — TESTING & REGRESSION COVERAGE

## E1. Unit tests for `helpers.ts`

**Priority:** P2

* [x] Cover relative timestamps.
* [x] Cover date formatting.
* [x] Cover username validation.
* [x] Cover status helpers.
* [x] Cover expiry logic.
* [x] Preserve existing behavior.

---

## E2. Unit tests for `api.ts`

**Priority:** P2

* [ ] Add focused tests for important `api.ts` business logic.
* [ ] Cover success paths.
* [ ] Cover Supabase error paths.
* [ ] Cover authorization-sensitive client scoping.
* [ ] Cover connection operations.
* [ ] Cover message operations.
* [ ] Cover deletion operations.
* [ ] Cover unread-state behavior where appropriate.
* [ ] Avoid duplicating large portions of production algorithms merely for testing.
* [ ] Prefer a testable API boundary or dependency injection where this improves meaningful coverage without architectural overengineering.

The objective is **behavioral regression coverage**, not line-count coverage.

---

## E3. Error mapping tests

**Priority:** P2/P3

* [ ] Add direct tests for important `errors.ts` mappings.
* [ ] Verify known Supabase/PostgREST error cases.
* [ ] Preserve localized output.

---

## E4. RLS regression automation

**Priority:** P2

* [x] Provide a reproducible automated runner for `supabase/rls-tests.sql`.
* [x] Run the tests against real PostgreSQL behavior rather than only mocks.
* [x] Preserve regression coverage for authorization-sensitive operations.
* [x] Keep the test command documented.

---

## E5. Crypto / E2EE regression protection

**Priority:** Continuous security requirement

* [x] Preserve existing crypto tests.
* [x] Preserve Signal-WASM integrity verification.
* [x] Preserve session-manager regression coverage.
* [x] Preserve signed-prekey rotation coverage.
* [x] Preserve message-cache confidentiality coverage.
* [x] Preserve session lifecycle/account-isolation coverage.
* [x] Preserve envelope/ciphertext boundary tests.

No E2EE change should be made merely to improve this roadmap.

---

# 8. PHASE F — CODE QUALITY & MAINTAINABILITY

## F1. Message sorting / append duplication

**Priority:** P3

* [x] Deduplicate the shared message ordering comparator.
* [x] Preserve deterministic ordering.
* [x] Avoid unrelated refactoring.

---

## F2. Build-derived application version

**Priority:** P3

* [x] Remove hard-coded application-version drift.
* [x] Derive the displayed version from authoritative package/build metadata.
* [x] Preserve the existing settings UI.

---

## F3. Production diagnostics review

**Priority:** P3

**Current policy:** intentional diagnostics are acceptable when they do not expose secrets or message contents.

* [ ] Review production console diagnostics.
* [ ] Confirm that no sensitive data is logged.
* [ ] Gate non-essential schema diagnostics appropriately if there is a concrete benefit.
* [ ] Preserve useful operational diagnostics.

Do NOT remove diagnostics merely because they appear in the console.

Do NOT weaken error observability.

---

## F4. API typing / casts

**Priority:** P3

* [ ] Review unnecessary casts in `api.ts`.
* [ ] Improve typing only where there is a concrete correctness or maintainability benefit.
* [ ] Do not perform a broad type-system refactor.
* [ ] Preserve runtime behavior.

---

## F5. Fragile RPC detection

**Priority:** P3

* [ ] Review message-string-based detection of missing RPCs.
* [ ] Determine whether a more stable detection mechanism is justified.
* [ ] Do not change behavior solely for stylistic reasons.
* [ ] Preserve compatibility with deployed PostgREST behavior.

---

# 9. PHASE G — RELEASE READINESS

## G1. Full manual QA

**Priority:** Release gate

* [ ] Registration
* [ ] Login
* [ ] Logout
* [ ] Password recovery
* [ ] Email change
* [ ] Connection request
* [ ] Accept
* [ ] Decline
* [ ] Cancel
* [ ] Block
* [ ] Unblock
* [ ] 1:1 messaging
* [ ] Realtime updates
* [ ] Pagination
* [ ] Delete for me
* [ ] Delete for everyone
* [ ] Read state
* [ ] Unread state
* [ ] My Notes
* [ ] Profile editing
* [ ] Language switching
* [ ] Light/dark/system appearance
* [ ] Account deletion
* [ ] Error/retry states
* [ ] PWA installation/update behavior

---

## G2. Production build and deployment verification

**Priority:** Release gate

* [ ] `npm run build` succeeds with the production base path.
* [ ] GitHub Pages deployment succeeds.
* [ ] Production application loads correctly.
* [ ] Authentication works on the deployed origin.
* [ ] Realtime works on the deployed origin.
* [ ] PWA assets load correctly.
* [ ] CSP does not block required application resources.
* [ ] Referrer policy is active as intended.

---

## G3. Database migration verification

**Priority:** Release gate

For every migration currently present in the repository:

* [ ] Verify migration ordering.
* [ ] Verify migration compatibility.
* [ ] Verify that required migrations are applied to the deployed Supabase project.
* [ ] Verify views, functions, triggers, RLS policies and grants after migration.
* [ ] Verify that no required migration is missing from deployment.

This is a verification task.

Do not rewrite already-applied historical migrations.

---

## G4. Security release review

**Priority:** Release gate

* [ ] Review authentication configuration.
* [ ] Review RLS authorization.
* [ ] Review secret exposure.
* [ ] Review client storage.
* [ ] Review E2EE storage boundaries.
* [ ] Review ciphertext handling.
* [ ] Review service-worker caching.
* [ ] Review CSP/referrer policy.
* [ ] Review production logging.
* [ ] Confirm no new security-sensitive behavior was introduced without review.

---

# 10. COMPLETED TECHNICAL WORK

The following goals have already been completed in the current development cycle and should remain marked as completed after verification:

* [x] i18n interpolation hardening
* [x] Profile/message input hardening
* [x] Explicit messages RLS hardening in repository migrations
* [x] CSP + Referrer-Policy
* [x] Unread-count query batching
* [x] Home realtime incremental updates
* [x] Fresh-message timestamp
* [x] Error boundary
* [x] Focus trap
* [x] Data-layer error surfacing
* [x] Automated RLS test runner
* [x] Message sorting deduplication
* [x] Build-derived application version
* [x] `robots.txt`
* [x] `security.txt`
* [x] Exact me↔peer realtime block filtering
* [x] Signed-prekey rotation
* [x] Message-cache confidentiality
* [x] Session teardown/account-isolation hardening
* [x] Signal-WASM integrity verification

This section is a reference for already completed work.

Arena must verify the current repository before changing any checkbox.

---

# 11. EXPLICITLY OUTSIDE THIS ROADMAP

The following are NOT autonomous v0.2 roadmap tasks:

* Typing indicator
* Online/presence indicator
* Avatar/profile-picture system
* Offline message queue
* Message reactions
* Group chats
* Media/file sharing
* Voice/video calls
* Voice messages
* Push notifications
* OAuth/federated login
* Additional languages
* Admin/user roles
* Other new social or communication features

These may be discussed in a future product roadmap.

They are NOT technical roadmap work and must not be implemented by Arena under this document.

A feature from this section requires an explicit product decision and a separate approved feature roadmap.

---

# 12. E2EE SCOPE

The current E2EE implementation is security-critical infrastructure.

This roadmap does not authorize arbitrary E2EE architecture changes.

The established Signal-based architecture must be preserved.

Rules:

* No homemade cryptography.
* No second session architecture.
* No second key-storage architecture.
* No private E2EE keys in Supabase.
* No post-encryption ciphertext mutation.
* No plaintext fallback for peer messages.
* No silent protocol changes.
* No removal or weakening of existing E2EE tests.
* No reopening of C-1 unless explicitly approved as a dedicated architecture task.

Any future E2EE architecture work must have its own dedicated plan and security review.

---

# 13. DATABASE POLICY

Only approved database changes may be introduced.

When a database change is necessary:

1. inspect the migration chain;
2. inspect existing policies/functions/triggers/views;
3. create a new migration when appropriate;
4. test it;
5. report it explicitly;
6. never rewrite history by modifying an already-applied migration.

Arena must NEVER assume:

```text
migration exists in Git
=
migration is deployed
```

These are separate states.

---

# 14. MIGRATION STATUS RULE

Whenever a new migration is created, the implementation report MUST explicitly contain:

```text
SUPABASE MIGRATION

Status:
CREATED

Migration:
supabase/migrations/<filename>.sql

Purpose:
<short explanation>

Applied to deployed Supabase:
YES / NO / UNKNOWN

Required user action:
<exact action or NONE>
```

If no migration is created:

```text
SUPABASE MIGRATION

NONE
```

If deployment cannot be verified:

```text
Applied to deployed Supabase:
UNKNOWN
```

---

# 15. WORKFLOW FILE RULE

Files under:

```text
.github/workflows/
```

are protected.

If a task requires modifying a workflow file:

* do not modify it;
* do not commit it;
* do not push it;
* do not include it in the PR.

Instead provide the user with the **complete proposed workflow file contents** for manual application.

Use:

```text
WORKFLOW FILE

MANUAL USER ACTION REQUIRED

File:
.github/workflows/<filename>

Reason:
<reason>

Complete proposed file:

<ENTIRE FILE CONTENTS>

Manual action:
Replace the current workflow file with the complete contents above.
```

Never provide only a fragment unless explicitly requested.

---

# 16. ROADMAP FILE PROTECTION

This file itself is protected from autonomous content changes.

Arena may only change:

```text
[ ] → [x]
```

after a roadmap item has been successfully completed and verified.

Arena must NOT:

* add roadmap items;
* remove roadmap items;
* rewrite descriptions;
* change priorities;
* change phase structure;
* change requirements;
* add product features;
* remove product features;
* change the scope;
* rewrite the roadmap to justify an implementation.

If the roadmap needs substantive modification:

```text
ROADMAP UPDATE REQUIRED — MANUAL USER DECISION
```

and explain the reason.

Do not modify the roadmap content autonomously.

---

# 17. AUTONOMOUS EXECUTION MODEL

For each session:

```text
READ
→ VERIFY REPOSITORY
→ VERIFY REMOTE MAIN
→ READ ROADMAP
→ IDENTIFY UNFINISHED APPROVED ITEM
→ SELECT HIGHEST-PRIORITY ACTIONABLE ITEM
→ IMPLEMENT
→ TEST
→ SECURITY REVIEW
→ DIFF REVIEW
→ COMMIT
→ PUSH
→ CREATE PR
→ UPDATE ONLY THE RELEVANT CHECKBOX IF VERIFIED
→ REPORT
→ STOP
```

Do not continue to another roadmap task after creating the PR.

The next task begins in the next Arena session after the PR has been reviewed and merged.

---

# 18. ROADMAP COMPLETION

When all approved actionable technical roadmap items are complete:

```text
STATUS

COMPLETE
```

Do not continue into product-feature development.

Do not invent new technical tasks.

Do not convert recommendations into requirements.

Do not use the autonomous workflow as a reason to keep changing the application.

At that point the v0.2 technical roadmap is complete.

A future feature phase can then be created separately.

---

# 19. RELEASE GATE

The v0.2 technical roadmap should be considered complete only when:

* [ ] all approved actionable security work is complete;
* [ ] all required external security verification is complete;
* [ ] all approved reliability work is complete;
* [ ] all approved performance work is complete;
* [ ] required accessibility work is complete;
* [ ] required unit/integration/security tests exist;
* [ ] automated RLS verification is working;
* [ ] production database migrations are verified;
* [ ] production authentication configuration is verified;
* [ ] manual QA is complete;
* [ ] production build succeeds;
* [ ] production deployment is verified;
* [ ] security release review is complete.

Product feature work is not part of this release gate.

---

# 20. ROADMAP GOVERNANCE

The roadmap has one purpose:

> **Finish the approved technical work required to make enough. a robust v0.2 release.**

It is not a wishlist.

It is not a product ideation document.

It is not permission for autonomous feature development.

The following distinction is mandatory:

```text
Technical roadmap item
→ may be implemented autonomously when verified and approved

Product feature
→ requires explicit product approval

Recommendation
→ guidance only; not automatically executable

Blocked item
→ report blocker; do not rewrite roadmap

Obsolete item
→ report discrepancy; do not rewrite roadmap

Verified complete item
→ mark [x]
```

---

# 21. FINAL PRINCIPLE

The intended development loop is:

**Roadmap defines the approved technical destination.**

**Repository defines the current reality.**

**Arena determines what approved work remains.**

**Arena implements only that work.**

**Arena verifies it.**

**Arena may mark the completed roadmap item `[x]`.**

**Arena creates a focused PR.**

**Arena stops.**

The roadmap must remain stable while the implementation evolves.

No autonomous agent may redefine what `enough.` is.

---

*Original audit basis: `docs/v02-roadmap-audit.md`, completed 2026-08-19. This document intentionally replaces the old "current-state as of audit day" interpretation with a living technical roadmap. Historical audit conclusions remain useful as evidence, but current repository state always takes precedence.*
