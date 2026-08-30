# enough. — v0.1 → v0.2 Product & Technical Roadmap

> **Original audit:** Completed 2026-08-19 (rev. 2 — final cleanup)
> **Purpose:** Define the intended v0.2 engineering targets and preserve the original audit findings.
> **Important:** This document is a living roadmap. The original audit was performed against an earlier repository revision and therefore contains historical state descriptions that may no longer match the current repository.
>
> **Rule:** The current repository, current Git history, current tests, and verified deployment state determine what is already achieved. This document defines the intended target and approved scope.

---

# 0. EXECUTIVE RULES FOR ROADMAP EXECUTION

This roadmap has two distinct purposes:

1. preserve the original technical/security audit;
2. define the intended and approved engineering work for v0.2.

These must NOT be confused.

## Roadmap status semantics

Every roadmap item should be interpreted using one of these states:

```text
ACTIONABLE
VERIFY ONLY
FIXED
PARTIALLY FIXED
DEFERRED
BLOCKED
OBSOLETE
PRODUCT DECISION REQUIRED
```

### ACTIONABLE

The work is an approved roadmap goal and may be implemented autonomously after verifying that it is still incomplete.

### VERIFY ONLY

The item requires verification of the current implementation or deployed environment.

Verification does not automatically authorize follow-up implementation.

If verification reveals a product, security, infrastructure, or architecture decision that is not explicitly approved, stop at the decision boundary.

### FIXED

The intended outcome has already been achieved.

Do not reimplement it.

### PARTIALLY FIXED

Some of the intended outcome exists, but the remaining gap must be verified before implementation.

### DEFERRED

The work is intentionally postponed.

Do not implement it unless this roadmap or project documentation explicitly reactivates it.

### BLOCKED

The work cannot safely proceed because a required dependency, external system, permission, or decision is unavailable.

### OBSOLETE

The finding no longer applies because the architecture or product has changed.

### PRODUCT DECISION REQUIRED

The item would add or materially change user-facing product behavior and therefore requires explicit approval.

---

# 1. ROADMAP VS. CURRENT REPOSITORY

The roadmap is the **target**.

The repository is the **current reality**.

Use:

```text
ROADMAP
→ intended target and approved scope

REPOSITORY / GIT / TESTS / MIGRATIONS / DEPLOYED STATE
→ actual current state
```

Never assume that an item is still open merely because an older section says so.

Never assume that an item is completed merely because a previous session claimed it was.

Before implementation, verify the current state.

Do not recreate already merged work.

Do not manufacture new work because an old audit contains a finding that no longer applies.

---

# 2. PRODUCT SCOPE RULE

This roadmap does NOT grant permission to invent product features.

Only approved roadmap goals and established product requirements may be implemented autonomously.

The following are NOT automatically actionable merely because they appear as:

* recommendations;
* optional improvements;
* nice-to-have items;
* future ideas;
* possible features;
* UX suggestions;
* technical possibilities.

Examples include:

* typing indicators;
* presence / online state;
* avatars or profile pictures;
* offline message queues;
* message reactions;
* new communication modes;
* notification systems;
* other user-facing features not explicitly approved.

A product feature requires explicit approval unless the repository clearly documents it as an approved requirement.

This rule is intentional and supersedes generic recommendations contained in the historical audit.

---

# 3. ORIGINAL AUDIT FINDING CLASSIFICATION

The original audit used:

* **CONFIRMED** — verified directly against the repository at audit time.
* **NEEDS VERIFICATION** — dependent on deployed Supabase/configuration state unavailable to the audit.
* **RECOMMENDATION** — defense-in-depth or quality improvement, not automatically a vulnerability.

These classifications describe the **original audit**, not automatic implementation permission.

In particular:

> **RECOMMENDATION does not mean ACTIONABLE.**

A recommendation may be useful while still requiring explicit approval before becoming a product or engineering task.

---

# 4. ORIGINAL AUDIT BASELINE

The sections below preserve the original audit conclusions for historical reference.

They should not be treated as a current repository snapshot.

The original audit was performed against:

```text
e0cc0d8b4958db143cb1dd9a35914c064c2afad1
```

on 2026-08-19.

Any statement about current code, current tests, current storage, current E2EE state, current migrations, or current deployment must be reverified against the present repository.

---

# 5. ORIGINAL EXECUTIVE AUDIT SUMMARY

At the time of the original audit, `enough.` was a functional production-deployed one-to-one messenger with:

* authentication;
* connections;
* realtime chat;
* deletion;
* blocking;
* My Notes;
* two languages;
* PWA support;
* GitHub Pages deployment.

The original audit found no confirmed P0 vulnerability in repository code.

It also identified:

* security-hardening opportunities;
* performance issues;
* UX/stability issues;
* accessibility gaps;
* missing automated test coverage;
* database verification requirements.

The original audit intentionally kept:

* major new product features;
* E2EE message-flow work;
* groups;
* media;
* calls;
* push;
* OAuth;

outside the v0.2 implementation scope.

This historical scope remains the baseline unless a later project decision explicitly changes it.

---

# 6. ORIGINAL FINDINGS

## P0

No confirmed P0 vulnerabilities were identified by the original repository audit.

Potential P0 conditions were identified only as deployment-verification items and were not treated as confirmed vulnerabilities without evidence.

---

## P1

### P1-1 — Explicit `messages` UPDATE RLS

Original classification:

```text
NEEDS VERIFICATION → P0/P1
```

Original concern:

The deployed Supabase project's pre-existing `messages` UPDATE policy was not represented completely in the repository at audit time.

The concern was whether a non-sender could update another user's message.

The original recommendation was:

* verify deployed policies;
* if permissive, add an explicit sender-only policy.

Current status MUST be verified against the present database/migrations and deployed project.

Do not blindly recreate the original migration plan if the repository already contains an explicit policy.

---

### P1-2 — i18n placeholder interpolation

Original classification:

```text
CONFIRMED
```

The original issue was that sequential replacement could reinterpret placeholders inserted as part of parameter values.

The intended fix was single-pass interpolation over the original template.

Current status MUST be verified against the current implementation.

---

### P1-3 — Input hardening

Original classification:

```text
RECOMMENDATION / DEFENSE-IN-DEPTH
```

Original goal:

* harden display-name writes;
* enforce server-side profile length;
* preserve the plaintext/ciphertext boundary;
* avoid mutating encrypted message envelopes.

Current status MUST be verified against the current implementation.

---

### P1-4 — `getUnreadCounts` N+1

Original classification:

```text
CONFIRMED
```

Original goal:

Replace one query per connection with bounded/batched behavior.

Current status MUST be verified against the current implementation and database view behavior.

---

### P1-5 — Home realtime full reload

Original classification:

```text
CONFIRMED
```

Original goal:

Use incremental realtime updates instead of refetching the entire Home state for every event.

Current status MUST be verified against the current implementation.

---

# 7. P2 FINDINGS

## P2-1 — Fresh message timestamp

Original issue:

Messages younger than one minute were displayed as `"1 min"`.

Intended improvement:

Use a "just now" style representation.

Current status MUST be verified before implementation.

---

## P2-2 — Global error boundary

Original issue:

A render failure could produce a blank/white-screen application state.

Intended improvement:

Provide a localized recovery UI with a reload action.

Current status MUST be verified before implementation.

---

## P2-3 — Dialog and Bottom Sheet focus trap

Original issue:

Modal components exposed dialog semantics but did not fully trap keyboard focus.

Intended improvement:

Add proper focus management.

Current status MUST be verified before implementation.

---

## P2-4 — Silent data-layer failures

Original issue:

Some data-layer functions converted errors into empty result sets, making failures appear as legitimate empty states.

Intended improvement:

Surface errors to callers and provide appropriate error/retry states.

Current status MUST be verified before implementation.

---

## P2-5 — Realtime block-state scope

Original issue:

The block-state realtime subscription was broader than required for a single conversation.

Intended improvement:

Scope the subscription to the exact relevant participant pair.

Current status MUST be verified before implementation.

---

## P2-6 — Conservative `usernameExists()` behavior

Original classification:

```text
CONFIRMED / INTENTIONAL
```

The original behavior deliberately treated ambiguous backend failures conservatively.

This is NOT automatically an implementation task.

Any change would alter registration behavior under degraded backend conditions.

Therefore:

```text
PRODUCT / UX DECISION REQUIRED
```

unless the project explicitly approves a change.

Do not alter this behavior autonomously merely because the audit listed it as a possible refinement.

---

## P2-7 — Development-only StrictMode behavior

Original classification:

```text
CONFIRMED / DEV-ONLY
```

This was considered harmless in production.

It is not an approved v0.2 implementation target.

Do not change it merely to eliminate a development-only observation.

---

# 8. P3 FINDINGS

## P3-1 — `APP_VERSION`

Original issue:

The version was hard-coded.

Intended improvement:

Derive it from build/package metadata.

Current status MUST be verified.

---

## P3-2 — `robots.txt` / `security.txt`

Original issue:

These files were absent.

Intended improvement:

Add the standard project metadata files where appropriate.

Current status MUST be verified.

---

## P3-3 — duplicate message-sort logic

Original issue:

The message ordering comparator appeared in multiple places.

Intended improvement:

Extract the shared comparator.

Current status MUST be verified.

---

## P3-4 — production console diagnostics

Original classification:

```text
CONFIRMED / INTENTIONAL / LOW SEVERITY
```

The repository intentionally used some production diagnostics.

This is NOT automatically an implementation task.

Do not remove, gate, or redesign diagnostics unless the project explicitly approves that change or the roadmap explicitly promotes it to an actionable goal.

---

## P3-5 — stale profile reference behavior

Original classification:

```text
CONFIRMED / COSMETIC
```

This is not an automatic v0.2 implementation task.

Only address it if the current roadmap explicitly marks it as actionable.

---

# 9. SECURITY AUDIT BASELINE

The original audit found no confirmed repository-code vulnerabilities in:

* XSS;
* SQL injection;
* basic IDOR paths;
* secret exposure;
* service-worker caching of user data;
* message envelope integrity.

These are historical audit findings and MUST be rechecked after meaningful architecture changes.

Do not assume the old audit is a perpetual security guarantee.

---

# 10. DATABASE / RLS BASELINE

The original audit identified three classes of database concerns:

```text
NV-1
NV-2
NV-3
```

These depended partly on deployed Supabase configuration or pre-existing project state.

They are verification items rather than automatically executable coding tasks.

Before changing database security behavior:

* inspect current migrations;
* inspect current policies;
* inspect grants;
* inspect triggers;
* inspect SECURITY DEFINER functions;
* inspect deployed state where available.

Do not recreate a migration that has already solved the issue.

---

# 11. CURRENT E2EE SCOPE

The original audit described E2EE implementation as paused.

That statement is now historical and MUST NOT be interpreted as the current repository state.

Subsequent project work may have changed the E2EE architecture substantially.

Therefore:

**Never use the original E2EE status in this document as proof that E2EE is currently paused.**

Before touching any E2EE-related code:

1. inspect the current `src/lib/e2ee/`;
2. inspect the current `src/lib/crypto/`;
3. inspect current message flow;
4. inspect current tests;
5. inspect recent E2EE commits;
6. inspect current migrations;
7. determine the actual current architecture.

The established Signal-based architecture remains the required architecture unless explicitly changed by the project.

No custom cryptography is permitted.

---

# 12. E2EE ARCHITECTURAL CONSTRAINTS

These remain active constraints:

* use the established Signal-based architecture;
* no homemade cryptography;
* keep private E2EE key material client-side;
* do not expose private E2EE key material to Supabase;
* preserve ciphertext opacity after encryption;
* preserve message-envelope integrity;
* preserve ratchet/session semantics;
* preserve signed-prekey lifecycle correctness;
* preserve encrypted message-cache confidentiality;
* document browser-E2EE limitations honestly.

Any E2EE architecture change requires a deeper security review.

---

# 13. PLAINTEXT / CIPHERTEXT BOUNDARY

The conceptual message pipeline is:

```text
raw plaintext
→ plaintext sanitization
→ encryption
→ envelope serialization
→ transport/storage
```

After encryption, ciphertext is opaque.

Do not:

* sanitize ciphertext;
* trim ciphertext;
* normalize ciphertext;
* truncate ciphertext;
* HTML-escape ciphertext;
* rewrite Base64 payloads;
* modify authentication tags;
* modify signatures;
* treat ciphertext as ordinary user text.

Incoming encrypted payloads must not pass through plaintext input sanitization.

---

# 14. APPROVED V0.2 ENGINEERING TARGETS

The following categories form the intended engineering target for v0.2.

Each item must still be verified against the current repository before implementation.

### Security / deployment verification

* Verify unresolved deployed Supabase policy/configuration findings where external verification is still required.
* Resolve confirmed security gaps that are explicitly part of the roadmap.

### Reliability / UX

* Improve confirmed data-layer error handling.
* Improve confirmed stability issues.
* Improve confirmed accessibility issues.
* Preserve existing product behavior while fixing these problems.

### Performance

* Eliminate confirmed N+1 behavior.
* Avoid unnecessary realtime reloads.
* Preserve correctness while reducing unnecessary network/database work.

### Testing

* Add useful regression coverage for important application behavior.
* Maintain existing E2EE/security test coverage.
* Automate or preserve reproducible security/RLS verification.

### Code quality

* Remove confirmed duplication when it provides a clear maintainability benefit.
* Improve build/version consistency where explicitly part of the roadmap.
* Avoid broad refactoring unrelated to a verified roadmap goal.

---

# 15. RELEASE-GATE PRINCIPLES

The v0.2 release should prioritize:

* security;
* correctness;
* data integrity;
* reliability;
* performance;
* test coverage;
* accessibility;
* maintainability.

Do not interpret "release gate" as permission to add unrelated product features.

---

# 16. PRODUCT FEATURES NOT AUTOMATICALLY INCLUDED

The following are NOT v0.2 implementation requirements unless separately and explicitly approved:

* typing indicator;
* online/presence indicator;
* avatar/profile-picture system;
* offline message queue;
* message reactions;
* group chats;
* media/file sharing;
* voice/video calls;
* voice messages;
* push notifications;
* OAuth/federated login;
* additional languages;
* admin/user roles;
* other new communication or social features.

These may be valid future product ideas.

They are not autonomous work items.

---

# 17. PRODUCT IDEAS / FUTURE EXPLORATION

Ideas may be recorded here for future discussion, but this section is intentionally non-actionable.

Examples may include:

* avatar or placeholder;
* typing indicator;
* offline queue;
* other UI/product enhancements.

Their presence here does NOT authorize implementation.

For every such idea, the state is:

```text
PRODUCT DECISION REQUIRED
```

Arena must not implement these autonomously.

---

# 18. EXPLICITLY DEFERRED WORK

The following remains outside the current v0.2 implementation scope unless the roadmap is explicitly changed:

* major E2EE architecture expansion beyond the currently established implementation;
* group chats;
* media/file sharing;
* voice/video;
* other major product architecture changes.

The exact E2EE roadmap must be determined from the current architecture, not from the historical 2026-08-19 snapshot.

---

# 19. DATABASE CHANGE RULE

Only additive or otherwise explicitly approved database changes should be introduced for v0.2.

Never modify an already-applied historical migration simply to rewrite its past behavior.

When database behavior must change:

1. inspect existing migrations;
2. understand dependencies;
3. create a new migration where appropriate;
4. test it;
5. explicitly report it.

---

# 20. DOCUMENTATION STATUS

This document contains historical audit material.

Do not treat every statement outside the approved target sections as a current implementation claim.

When an implementation changes a living behavior:

* update relevant current documentation where appropriate;
* avoid rewriting historical audit conclusions merely to make them appear current;
* distinguish historical findings from current verified state.

---

# 21. V0.2 TASK EXECUTION POLICY

For each potential roadmap task:

1. Identify the target outcome.
2. Verify the current implementation.
3. Determine whether the goal is already achieved.
4. Determine whether the goal is approved and actionable.
5. Check dependencies.
6. Check whether the change would alter product behavior.
7. Check whether the change requires a migration.
8. Check whether it touches protected workflow files.
9. Only then implement.

If a proposed task is merely:

```text
RECOMMENDATION
NICE TO HAVE
OPTIONAL
IDEA
PRODUCT FEATURE
```

do not implement it autonomously unless it is separately identified as an approved actionable goal.

---

# 22. DEFINITION OF DONE

A v0.2 engineering task is complete when:

* the target was verified as relevant;
* the implementation addresses the real current problem;
* regression tests exist where appropriate;
* relevant tests pass;
* security implications were reviewed;
* the final diff is scoped;
* documentation is updated when necessary;
* no protected workflow file was modified;
* migrations are reported explicitly;
* the change is committed and pushed;
* the focused PR is created.

The task ends at the PR boundary.

---

# 23. ROADMAP COMPLETION

When all approved actionable roadmap work is complete:

**Do not invent additional tasks.**

Do not turn:

* recommendations;
* optional improvements;
* product ideas;
* speculative refactors

into automatic work.

Report:

```text
COMPLETE

All currently approved and actionable v0.2 roadmap goals have been verified as achieved.
```

If only product ideas or deferred work remain:

```text
COMPLETE

No approved actionable engineering work remains.
Remaining items require explicit product or architecture decisions.
```

---

# 24. ORIGINAL AUDIT DETAILS

The following sections from the original audit remain useful as historical evidence:

* original XSS review;
* original injection review;
* original auth review;
* original RLS review;
* original IDOR review;
* original storage review;
* original service-worker review;
* original performance observations;
* original UX observations;
* original technical-debt observations.

However, they must always be interpreted together with the current repository.

A later implementation may already have resolved, invalidated, or superseded them.

---

# 25. HISTORICAL ORIGINAL AUDIT — XSS

The original audit found no confirmed XSS vector through:

* message rendering;
* display names;
* registration/login forms;
* markdown links.

The original reasoning relied on:

* React escaping;
* no dangerous HTML injection APIs;
* markdown sanitization;
* safe link handling.

Reverify after any rendering architecture change.

---

# 26. HISTORICAL ORIGINAL AUDIT — INJECTION

The original audit found no confirmed SQL injection vector because Supabase client operations parameterized values.

Do not replace parameterized database operations with raw SQL solely for convenience.

---

# 27. HISTORICAL ORIGINAL AUDIT — CLIENT STORAGE

The original audit identified:

* preference storage;
* per-user deletion/read-state fallback storage;
* crypto IndexedDB storage;
* service-worker reload state.

The exact storage contents and security properties MUST be considered against the current E2EE implementation rather than the original audit snapshot.

---

# 28. HISTORICAL ORIGINAL AUDIT — SERVICE WORKER

The original audit considered the service worker's asset caching behavior acceptably isolated from user data.

When modifying the service worker:

* preserve content-hash update behavior;
* do not cache private user data;
* preserve safe installation behavior;
* preserve update/reload behavior.

Workflow-file changes remain separately protected by `docs/arena-instructions.md`.

---

# 29. HISTORICAL ORIGINAL PERFORMANCE TARGETS

The original audit identified two important performance problems:

### Unread counts

Avoid:

```text
N connections → N database requests
```

Prefer bounded/batched behavior.

### Home realtime

Avoid:

```text
every event → full Home reload
```

Prefer incremental updates with reconciliation where necessary.

These are engineering principles and remain relevant where the underlying problem still exists.

---

# 30. HISTORICAL ORIGINAL ACCESSIBILITY TARGETS

The original audit identified:

* focus management;
* modal focus trapping;
* consistent accessible labels;
* keyboard navigation.

Only implement remaining items that are still open after verification.

---

# 31. HISTORICAL ORIGINAL TESTING GAPS

The original audit identified missing coverage in several areas.

Because subsequent work may have added tests, verify coverage before creating new test tasks.

Do not create duplicate test suites merely because the historical audit says coverage was missing.

---

# 32. NO AUTOMATIC PRODUCT EXPANSION

The following rule is absolute:

> A technical recommendation does not grant permission to expand the product.

Do not independently decide that a feature is desirable.

Do not add user-facing functionality simply because:

* the implementation is easy;
* it fits the UI;
* another messenger provides it;
* it appears in a historical recommendation;
* it would make the product "better";
* it is listed as "P3";
* it is listed under "Nice to have".

Only approved product scope may be implemented autonomously.

---

# 33. CURRENT TARGET SELECTION

When selecting the next task:

```text
1. Read repository instructions.
2. Read this roadmap.
3. Verify current remote main.
4. Inspect current repository state.
5. Determine which roadmap goals are already achieved.
6. Determine which approved goals remain.
7. Exclude recommendations and unapproved product ideas.
8. Exclude deferred/obsolete items.
9. Verify the remaining candidates against the actual implementation.
10. Rank them by roadmap priority and actual impact.
11. Select the highest-priority actionable goal.
12. Implement only that goal and closely related approved work.
13. Test.
14. Review.
15. Commit.
16. Push.
17. Create one focused PR.
18. Stop.
```

Do not skip the verification step.

---

# 34. FINAL OPERATING PRINCIPLE

This roadmap defines the **direction and approved target** for enough. v0.2.

It does not authorize autonomous product invention.

Use:

```text
ROADMAP
→ what the project wants to achieve

CURRENT REPOSITORY
→ what the project currently contains

GIT HISTORY
→ what has already been implemented

TESTS
→ what is verified

DEPLOYED STATE
→ what is actually live where relevant
```

Work only where those sources support the conclusion that an approved roadmap goal remains incomplete.

Do not recreate completed work.

Do not manufacture problems.

Do not convert recommendations into product requirements.

Do not convert nice-to-have ideas into autonomous tasks.

Do not silently expand product scope.

Do not weaken security.

Do not weaken tests.

Do not destroy local work.

Do not modify protected workflow files.

Do not modify `docs/arena-instructions.md`.

Always explicitly report new Supabase migrations.

Always provide complete workflow-file contents when a workflow change is required, while keeping that change outside the PR.

At the end of each autonomous task:

**commit → push → focused PR → compact report → STOP.**

The ultimate goal is:

**Make enough. better according to the approved roadmap, without allowing the autonomous agent to redefine what enough. is.**
