# Arena Instructions

Before starting any task, you MUST read and follow this file completely.

This file defines the repository-specific workflow, safety rules, coding standards, and collaboration requirements for Arena sessions.

## 1. Language

Everything you add or modify inside the repository MUST be written in **English**.

This includes, but is not limited to:

* Source-code comments
* Documentation
* README files
* Commit messages
* Pull request titles
* Pull request descriptions
* Test names and descriptions
* Error messages
* CI/CD comments
* Changelogs
* TODOs and FIXMEs
* SQL comments
* Migration comments

Do NOT translate or modify existing German user-facing application content unless the task explicitly requires it.

If you are unsure about the language of newly created repository content, use English.

## 2. Read This File First

At the beginning of EVERY task:

1. Read `docs/arena-instructions.md`.
2. Read the relevant project documentation.
3. Inspect the current repository state before making changes.
4. Understand the existing implementation before modifying it.

Do not rely on assumptions about the current repository state.

## 3. Repository Safety

Never overwrite, discard, reset, clean, revert, stash, or otherwise destroy existing local work unless explicitly authorized.

Before making changes:

* Check `git status`.
* Inspect the current branch.
* Inspect relevant recent commits.
* Check for existing uncommitted changes.
* Identify whether those changes belong to the current task.

If unrelated local work exists, preserve it.

Never use destructive commands such as:

* `git reset --hard`
* `git clean`
* `git checkout -- <file>`
* `git restore <file>`
* destructive rebases
* deleting uncommitted work

unless the user explicitly authorizes the operation.

## 4. Workflow / Instructions Files

`docs/arena-instructions.md` is a workflow and instruction file, not a normal feature file.

It MUST NOT be:

* modified as part of a normal feature task
* deleted
* renamed
* reverted
* included in a feature commit
* included in a feature PR

unless the user explicitly asks Arena to modify this file.

### Important: Workflow-file changes

If, during a task, you determine that `docs/arena-instructions.md` should be changed, improved, extended, or corrected:

**DO NOT modify the file in the repository.**

**DO NOT include changes to this file in the commit or PR.**

Instead:

1. Continue the task without modifying `docs/arena-instructions.md`.
2. At the end, provide the user with the complete proposed contents of the updated `docs/arena-instructions.md`.
3. Clearly explain what was changed and why.
4. Let the user manually copy the proposed version into the repository.

Arena does not have permission to directly modify this workflow file unless the user explicitly grants that permission.

The same rule applies if a task would otherwise require modifying the workflow file indirectly.

## 5. Scope Discipline

Only modify files that are necessary for the requested task.

Do not make unrelated refactors, cleanup, formatting changes, dependency upgrades, or architectural changes.

Before committing, verify that the diff contains only changes relevant to the task.

If unrelated changes appear in the diff, investigate and remove them only if they were introduced by the current task. Never destroy pre-existing user work.

## 6. Understand Before Changing

Before implementing a change:

* Inspect the relevant source files.
* Inspect related types and interfaces.
* Inspect existing tests.
* Inspect related database migrations.
* Inspect relevant documentation.
* Trace the existing runtime/data flow where appropriate.

Do not implement a change solely from a task description when the repository already contains an implementation that needs to be understood first.

Prefer minimal changes that fit the existing architecture.

## 7. Security-Sensitive Code

Treat the following areas as security-sensitive:

* Authentication
* Authorization
* Supabase RLS
* Database policies
* Encryption
* E2EE
* Key management
* Ratchets
* Prekeys
* Signed prekeys
* Message serialization
* Ciphertext handling
* Session state
* Cryptographic storage
* Input sanitization

When modifying security-sensitive code:

1. Understand the existing security boundary first.
2. Do not weaken existing protections.
3. Do not introduce plaintext handling where ciphertext is expected.
4. Do not modify encrypted payloads after encryption.
5. Do not sanitize, trim, normalize, or otherwise mutate ciphertext.
6. Keep plaintext sanitization before encryption.
7. Preserve existing E2EE protocol semantics unless the task explicitly requires a protocol change.
8. Verify that authentication, authorization, RLS, and cryptographic invariants remain intact.
9. Add regression tests for security-sensitive behavior whenever practical.

## 8. E2EE Boundaries

For `enough.` specifically, maintain a strict distinction between:

* Raw user plaintext
* Sanitized plaintext
* Encrypted message payload
* Serialized E2EE envelope
* Stored ciphertext
* Decrypted display plaintext

Sanitization belongs at the plaintext boundary.

Ciphertext and serialized E2EE envelopes MUST be treated as opaque data.

Never:

* trim ciphertext
* normalize ciphertext
* sanitize ciphertext
* parse and reconstruct ciphertext unnecessarily
* modify Base64 payloads
* modify authentication tags
* modify signatures
* modify ratchet state as part of unrelated input handling

`sendMessage()` should remain a transport/storage boundary and should not modify already-prepared ciphertext.

## 9. Database and Supabase

When changing Supabase-related code:

* Inspect the relevant migrations first.
* Preserve RLS.
* Do not bypass RLS with client-side assumptions.
* Never introduce service-role credentials into frontend code.
* Keep database invariants enforced server-side where appropriate.
* Consider direct PostgREST callers when implementing security constraints.
* Ensure migrations are ordered correctly.
* Do not modify previously applied migrations when a new migration is appropriate.
* Add a new migration for schema or database behavior changes.

When adding a migration:

* Use the next appropriate migration number.
* Make it safe to apply after the existing migration sequence.
* Consider existing data.
* Consider existing triggers and policies.
* Consider `SECURITY DEFINER` functions carefully.
* Preserve existing RLS behavior unless the task explicitly changes it.

## 10. Tests

Every implementation task should include appropriate verification.

At minimum, where applicable:

* Run the build.
* Run relevant unit/regression tests.
* Run crypto tests when security-sensitive code is touched.
* Run i18n tests when i18n code is touched.
* Run smoke tests.
* Run `git diff --check`.

Do not claim a task is complete if required tests are failing.

If a test cannot be run, explicitly report:

* which test could not be run
* why it could not be run
* whether the limitation is environmental or implementation-related

Prefer regression tests that would actually fail if the bug were reintroduced.

Static source assertions may be useful, but do not present them as equivalent to runtime integration tests.

## 11. Mutation / Negative Testing

For security-sensitive changes, consider how the implementation could accidentally regress.

Where practical, test negative cases such as:

* ciphertext being modified
* sanitization happening after encryption
* incoming ciphertext being sanitized
* RLS being bypassed
* invalid input reaching the database
* overlong values bypassing client validation
* malformed cryptographic envelopes being accepted
* authentication or authorization checks being skipped

Do not perform destructive mutation against production data or deployed production systems.

Use safe local or test fixtures instead.

## 12. Existing Functionality

Do not unnecessarily change existing behavior.

When fixing a bug:

* Preserve unrelated functionality.
* Preserve public interfaces where possible.
* Preserve existing user-facing behavior unless the task explicitly changes it.
* Avoid broad refactors when a focused fix is sufficient.

If a behavior change is intentional, document it and add regression coverage.

## 13. Dependencies

Do not add dependencies unless they are genuinely necessary.

Before adding a dependency:

1. Check whether the repository already provides the required functionality.
2. Consider whether a small internal implementation is preferable.
3. Consider bundle size and security implications.
4. Verify that the dependency is actively maintained.
5. Explain the reason for the dependency in the PR description.

Do not perform unrelated dependency upgrades.

## 14. Git Workflow

Before implementation:

* Inspect `git status`.
* Inspect the current branch.
* Inspect the remote configuration.
* Inspect the relevant base branch.
* Understand whether the repository is shallow.

Before committing:

* Verify the working tree.
* Inspect the complete diff.
* Verify that only intended files changed.
* Run `git diff --check`.
* Verify that no secrets or credentials are included.
* Verify that no unrelated changes are included.

Use focused commits.

Commit messages MUST be written in English and should clearly describe the change.

## 15. Branch and PR Workflow

When the task requires a PR:

1. Create or use the appropriate Arena session branch.
2. Keep the branch focused on the requested task.
3. Commit only the relevant changes.
4. Push the branch.
5. Open exactly one PR unless explicitly instructed otherwise.
6. Use `main` as the base unless the task specifies another base.
7. Report the PR number and URL.
8. Report the exact branch and commit SHA.
9. Report the exact changed files.
10. Report test results.
11. Report whether the PR is mergeable.
12. Do not merge the PR unless explicitly instructed.

Never create additional PRs merely to work around a branch constraint.

If the Arena session imposes a fixed branch constraint, follow that constraint.

## 16. PR Description

PR descriptions should be concise but technically complete.

Include:

* What changed
* Why it changed
* Important implementation details
* Security implications where relevant
* Tests performed
* Known limitations or non-blocking concerns

Do not claim tests were run if they were not actually run.

Do not claim a security property that was not verified.

## 17. No Unrelated Changes

Before opening a PR, verify:

* no unrelated source files changed
* no unrelated documentation changed
* no unrelated migrations changed
* no generated files changed unnecessarily
* no formatting-only changes outside the task
* no dependency changes outside the task
* no workflow/instruction-file changes

If unrelated changes are found, stop and investigate rather than silently including them.

## 18. Documentation

When behavior, architecture, security boundaries, migrations, or operational procedures change, update the relevant documentation when appropriate.

Documentation added by Arena MUST be in English.

Do not rewrite large amounts of documentation unnecessarily.

Prefer targeted documentation updates.

## 19. Error Handling

Do not silently swallow errors when doing so can hide correctness or security problems.

When changing error handling:

* Preserve useful diagnostics.
* Avoid leaking secrets or sensitive information.
* Distinguish between expected empty states and actual failures.
* Ensure security-sensitive failures fail closed.

For authentication, authorization, cryptographic, and RLS failures, prefer fail-closed behavior.

## 20. Input Handling

User-controlled input must be treated as untrusted.

Where appropriate:

* Validate input.
* Normalize input at the correct boundary.
* Enforce server-side constraints for important invariants.
* Preserve valid Unicode text.
* Avoid accidental truncation.
* Avoid modifying data after encryption.

Do not confuse input sanitization with output encoding.

For UI rendering, rely on React's normal escaping behavior unless there is a documented reason not to.

Do not introduce `dangerouslySetInnerHTML` without explicit justification and security review.

## 21. Performance

When changing performance-sensitive code:

* Avoid N+1 database queries.
* Avoid unnecessary full reloads.
* Avoid unnecessary network requests.
* Prefer bounded query counts.
* Consider realtime event frequency.
* Avoid unnecessary React re-renders.
* Preserve correctness over premature optimization.

When fixing an N+1 issue, add regression coverage that verifies the number of requests remains bounded.

## 22. Accessibility

When modifying dialogs, sheets, forms, navigation, or interactive UI:

* Preserve semantic HTML.
* Preserve ARIA semantics.
* Ensure keyboard accessibility.
* Ensure focus behavior is correct.
* Ensure Escape behavior is appropriate.
* Do not rely solely on visual cues.

When adding modal behavior, consider focus trapping and restoration.

## 23. Internationalization

The application supports English and German.

Repository-level technical content must remain in English.

Do not introduce hard-coded user-facing strings when the existing architecture expects translations.

When modifying i18n behavior:

* Preserve placeholder semantics.
* Treat interpolation values as data.
* Never treat interpolated values as templates.
* Preserve literal braces and special characters.
* Add regression tests for values containing placeholder-like sequences.

## 24. Security Verification Before PR

For security-related tasks, perform a final review of:

* Authentication
* Authorization
* RLS
* Input validation
* XSS surfaces
* Secret exposure
* E2EE boundaries
* Ciphertext handling
* Key material
* Database constraints
* Error handling
* Logging

Explicitly state whether any of these areas were changed.

If they were not changed, verify that the diff does not accidentally affect them.

## 25. Final Verification Report

At the end of every implementation task, provide a structured report containing:

### Implementation

* What was implemented
* Why it was implemented

### Git

* Branch
* Commit SHA
* Working-tree status
* Changed files

### Tests

* Build result
* Relevant test results
* Smoke test result
* `git diff --check` result

### Security

* Security-sensitive areas inspected
* Whether E2EE behavior changed
* Whether RLS behavior changed
* Whether secrets were introduced

### PR

If a PR was requested:

* PR number
* PR URL
* Base/head
* PR state
* Mergeability
* Checks status

### Remaining Concerns

Clearly list any known limitations, assumptions, or non-blocking concerns.

Never hide a known limitation merely to make the result appear complete.

## 26. Stop Conditions

Stop and report the situation instead of guessing when:

* The requested branch does not exist.
* The repository state is ambiguous.
* Existing local work may be overwritten.
* Required credentials are unavailable.
* A required migration cannot safely be determined.
* A security-sensitive behavior cannot be verified.
* Tests reveal an unrelated existing failure that prevents reliable verification.
* The requested implementation conflicts with an existing security invariant.

Do not invent missing repository information.

## 27. Minimality Principle

Prefer the smallest correct change.

Do not:

* refactor unrelated code
* rename unrelated functions
* change formatting unnecessarily
* upgrade dependencies without need
* rewrite working architecture
* alter security boundaries unnecessarily

A good Arena change should be:

* focused
* reviewable
* testable
* reversible
* compatible with the existing architecture

## 28. Final Instruction

Always prioritize:

1. Correctness
2. Security
3. Preservation of existing functionality
4. Testability
5. Minimal scope
6. Maintainability

When these principles conflict, choose the safer and more conservative implementation.

If the task requires changing `docs/arena-instructions.md`, do NOT modify or commit that file. Instead, provide the complete proposed updated file contents to the user so they can manually apply the change.

Always read `docs/arena-instructions.md` before starting work.
