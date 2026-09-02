# enough. — v0.3 Roadmap: Chat Behavior, UX & Visual Polish

> **Status:** Proposed, not yet approved for implementation.
>
> **Basis:** Repository state at `c951402` ("Release enough. v0.2.0 (#71)", `package.json` version `0.2.0`), analysed 2026-08-31.
>
> **Relation to v0.2:** `docs/v02-roadmap-audit.md` is complete and frozen. It is neither modified nor reopened by this document. All v0.2 invariants (E2EE scope rules, database policy, RLS posture, accessibility contracts, i18n interpolation hardening) remain binding for v0.3 work.
>
> **Scope:** Exactly the six approved items below. No additional features.

---

## 1. SCOPE RULES

### 1.1 Explicitly out of scope for v0.3

* No new messaging features: no offline queue, no typing indicators, no push notifications, no presence/online indicators, no reactions, no group chats, no media sharing, no read receipts for peers.
* No E2EE/crypto changes of any kind (`src/lib/crypto/`, `src/lib/e2ee/`, message serialization, envelope handling). None of the six items requires touching them.
* No database migrations planned. All six items are designed to be client-side only. If implementation of an item unexpectedly requires a migration, that item stops and reports; the v0.2 migration-report discipline applies.
* No dependency additions or upgrades.
* No changes to `docs/arena-instructions.md`, `.github/workflows/`, or `docs/v02-roadmap-audit.md`.
* No authentication, authorization, or RLS changes.

### 1.2 Standing constraints (inherited)

* Everything user-facing stays localized (EN/DE) via `src/i18n/translations.ts`; no hard-coded strings.
* Accessibility contracts from v0.2 items C3/D1 remain in force (focus traps, accessible names, keyboard operability, reduced-motion coverage of JS-driven animation).
* `sendMessage()` remains a transport boundary; plaintext sanitization stays at the composer/plaintext boundary. (v0.3 does not touch this path, but the scroll/read work sits next to it in `Chat.tsx` — do not refactor it.)
* Existing smoke test (`scripts/smoke-test.mjs`, jsdom render of the production bundle) and the `node --test` suites must keep passing; extend them per item where feasible.

### 1.3 Test-infrastructure reality (relevant to several items)

* The Node test runner executes `src/lib/*.ts` helpers directly (pattern: `src/lib/homeRealtime.ts` + `src/lib/__tests__/home-realtime.test.mjs`). Pure logic extracted to `src/lib/` is unit-testable.
* The smoke test renders the built app in jsdom. jsdom performs no layout: `scrollHeight`/`scrollTop`/`getBoundingClientRect()` are all `0`/empty, so **pixel-level scroll behavior cannot be verified in the smoke test**. Scroll verdicts there are limited to presence/visibility of elements.
* Source-level guards are an accepted regression mechanism in this repository (see `src/lib/__tests__/accessibility.test.mjs`, `src/lib/__tests__/chat-block-channel.test.mjs`), but per `docs/arena-instructions.md` §10 they are not a substitute for runtime verification; manual QA steps are listed per item where automation cannot reach.

---

## 2. ITEMS

---

## R1 — Chat opens reliably at the newest message

**Priority:** P0

### Goal

Opening a conversation always leaves the message list scrolled to the newest message, with no intermediate flash and no dependence on how long E2EE plaintext resolution takes.

### Current problem (verified against repository state)

In `src/components/Chat.tsx`:

1. The initial scroll lives in a passive `useEffect` keyed on `[loading]` ("Initial load: open at the bottom"). It runs **after paint** — a visible pre-scroll frame is possible — and it runs at the moment `setLoading(false)` renders the messages.
2. At that moment E2EE plaintext is not yet resolved: the decrypt effect fills `plain`/`undecryptable` asynchronously, one `setPlain` per message. Bubbles therefore render first with empty text and grow to full height afterwards.
3. The initial scroll captures the *too-small* `scrollHeight`. Afterwards nothing re-anchors: the "stick to bottom" effect reacts only to `messages.length` changes, and plaintext resolution does not change `messages.length`.
4. Net effect (especially with E2EE active, which is the normal case): the chat settles somewhere above the newest message; the user must scroll down manually.

### Affected files / modules

* `src/components/Chat.tsx` — initial-load effect, decrypt effect, `scrollToBottom`, `.messages` container render.
* `src/index.css` — `.messages` (only if a visibility-suppression or anchor approach needs styling support).
* Not affected: `src/lib/e2ee/*` (decrypt timing is an input condition, not something to change).

### Technical dependencies

* Shares the scroll/read block in `Chat.tsx` with **R2**. R2's monotonic read-position invariant must not be broken while R1 iterates (initial scroll currently also triggers `persistRead()`). Recommended: R2 first, or R1+R2 in one coordinated pass.
* No migration, no API change, no E2EE change.

### Expected behavior

* First paint of an opened chat either already shows the newest message, or the list is visually suppressed (e.g. hidden) until anchoring is complete — never a flash of unscrolled content followed by a jump.
* The anchor is applied (or re-applied) until the rendered content has settled: after the initial page render **and** after async plaintext resolution for the initially visible tail of messages.
* The instant the user actively scrolls, anchoring responsibility ends (existing `atBottomRef`/`handleScroll` semantics preserved).
* Reduced-motion users get the instant jump as today (existing `prefersReducedMotion()` handling in `scrollToBottom` is reused).
* Sending a message, realtime arrivals while at bottom, and pagination (top-loading with scroll-position compensation via `pendingDeltaRef`) behave exactly as today.

### Acceptance criteria / Definition of Done

1. With an E2EE chat containing > `PAGE_SIZE`-worthy or at least screen-filling history, opening the chat (cold load, slow decrypt simulated) lands on the newest message, verified manually on a real browser viewport, in both themes.
2. No visible intermediate state of the list before anchoring (manual/visual).
3. Scroll-up pagination still restores position when older messages are prepended (existing `useLayoutEffect` + `pendingDeltaRef` mechanism intact).
4. Realtime arrival while at bottom still auto-scrolls; while scrolled up it does not steal the scroll position (existing behavior).
5. The read-state write performed at open time still marks the newest existing message as read exactly once (interlock with R2 verified).
6. `npm run build`, smoke test, and existing `node --test` suites pass.

### Tests needed

* **Extractable logic:** move the "should (re-)anchor now?" decision into a small pure helper in `src/lib/` (e.g. inputs: initial-anchor pending, user-has-scrolled, plaintext-resolution progress) and unit-test it with `node --test`, following the `homeRealtime.ts` pattern.
* **Source-level guard** (accepted repo pattern): assert the initial-scroll effect no longer fires solely on the `[loading]` transition without waiting for render/decrypt settlement.
* **Smoke test:** assert the messages container renders and the scroll-down button is absent right after opening a chat (best available proxy in jsdom; document that pixel anchoring is manual-QA).
* **Manual QA:** the anchor judgments above on a real viewport.

### Risks

* **Re-anchoring loop:** re-applying "scroll to bottom" on every `plain` update can fight the user if guarding is sloppy → the user-has-scrolled latch must be set on the first genuine user scroll event, not on programmatic scroll.
* **Pagination interplay:** the top-prepend compensation (`pendingDeltaRef`) and the new initial anchoring must not both fire for the same render.
* **Empty chats:** `messages.length === 0` must not regress (current guard `messages.length > 0`).
* **Very slow decrypt of old history:** anchoring must wait only for the *tail* that is initially rendered, not for the whole page's decrypt queue (real decrypts run sequentially and the ratchet advances once per message — do not change that behavior; only observe the rendered tail).

---

## R2 — Unread status is correct (no phantom unread)

**Priority:** P0

### Goal

Scrolling up in a chat never creates unread. Read state is monotonic. After leaving a chat, the Home unread badge counts exactly the messages that arrived *after* the chat was left — nothing that was already present while the chat was open.

### Current problem (verified against repository state)

Root cause in `src/components/Chat.tsx`:

1. `computeUnreadBelow` implements "progressive read": it sets `lastReadRef.current` to the `created_at` of the newest **visible** message. When the user scrolls **up**, this newest-visible message is an *older* one — **the read position moves backwards**.
2. `persistRead` (throttled ~1.5 s in `handleScroll`) and `flushReadState` (effect cleanup / unmount) persist that regressed timestamp via `saveReadState` → `connection_reads.last_read_at` goes backwards.
3. The `connection_unread` view (migration 0013) counts every peer message with `created_at > last_read_at` — so messages the user already saw reappear as unread on Home. Scroll up, leave, and the badge shows phantom unread.

Secondary gap:

4. On unmount, only `lastReadRef` is flushed. Peer messages that arrived (and were decrypted and displayed) **while the chat was open but the user was scrolled up** remain `> last_read_at` and become unread after leaving — although per spec only messages arriving *after leaving* may create unread.

Additional surfaces checked and found sound:

* `Home.tsx` is **unmounted** while a chat is open (`App.tsx` renders either `Home` or `Chat`), so the live increment `unreadAfterInsert` (`src/lib/homeRealtime.ts`) only runs while Home is visible — no double counting from that path.
* `saveReadState` (`src/lib/api.ts`) upserts whatever timestamp it is given; there is no guard against regression (client-side guard recommended; see Risks for why no DB-level guard is planned).

### Affected files / modules

* `src/components/Chat.tsx` — `computeUnreadBelow`, `handleScroll`, initial-load effect, unmount `flushReadState` path.
* `src/lib/api.ts` — `saveReadState`: add a monotonic guard (refuse to persist a `last_read_at` older than the value already known locally for that connection; localStorage cache in `readStorage` already provides the comparison value without an extra query).
* `src/lib/__tests__/api.test.mjs` / new or extended unread tests for the guard.
* No change needed to the `connection_unread` view, `getUnreadCounts`, `batchUnreadFallback`, or `homeRealtime.ts` (their semantics are correct once the client never writes a regressed/stale read position).

### Technical dependencies

* Shares the scroll/read block with **R1** — see R1 dependencies. R2's invariant is self-contained and makes R1 safe to iterate; implement R2 first.
* No migration (client-side monotonic guard only; a future server-side CHECK/trigger would be optional hardening and is **not** part of v0.3).

### Expected behavior

* `last_read_at` per connection never decreases: programmatic assignment of the read position computes `max(current, candidate)`.
* Scrolling up and down changes nothing about what was already read; messages stay read.
* Messages that exist in the chat (loaded or realtime-delivered) at the moment the chat is left count as read: the unmount flush persists the newest known message timestamp of that chat session (not the last merely-visible one).
* Only messages inserted after the final flush — i.e. after leaving — raise the Home unread badge; the badge number equals that count (matching the view's `created_at > last_read_at` semantics).
* Own messages never count (already enforced view-side and in `unreadAfterInsert`).
* Multi-device behavior unchanged in kind: the DB row + localStorage merge in `getReadState` already takes the freshest source per connection; the monotonic guard keeps a second device with a newer position from being dragged backwards by this one.

### Acceptance criteria / Definition of Done

1. Scroll fully up through history (with pagination), leave: Home shows **no** unread badge for that chat.
2. Receive N peer messages while scrolled up inside the chat, leave without scrolling down: Home shows **no** unread for that chat (N were present before leaving).
3. Receive M peer messages after leaving: badge shows exactly M.
4. Repeat 1–3 across app restarts (read state survives via DB + localStorage) and on a second device (positions never regress).
5. `unreadAfterInsert` behavior and the `connection_unread` view output are unchanged; `npm run test:unread`, `test:api`, `test:home` pass with new cases added.
6. No change to E2EE, RLS, or migrations.

### Tests needed

* **Unit (new, `node --test`):** monotonic update logic (regression refused, advance accepted, equal-timestamp idempotency) — extract as a pure helper (e.g. `advanceReadPosition(current, candidate)`) to keep it testable like `homeRealtime.ts`.
* **Unit (guard):** `saveReadState` refuses an older timestamp than the locally cached one; still writes when newer; still fires the Supabase upsert only in the allowed case (mock client pattern from `src/lib/__tests__/unread-counts.test.mjs` / `supabase-mock.mjs`).
* **Source-level guard:** `computeUnreadBelow` no longer writes a backwards-moving value into the read ref.
* **Smoke test (limited by jsdom):** badge absence after the open→(scroll attempt)→back flow where simulatable; document reach honestly.
* **Manual QA:** criteria 1–4 on a real build.

### Risks

* **"Read" vs. "seen while open":** persisting the newest-known timestamp on leave means scrolled-up arrivals count as read without having been on screen. This is the explicitly requested product rule ("only messages arriving after leaving create unread"); the roadmap records it as a deliberate semantic, not an accident.
* **Race at leave:** a realtime INSERT racing the unmount flush could be lost from the persisted position. Mitigation to verify at implementation: flush uses the newest timestamp present in component state at cleanup time; residual sub-second race is acceptable and self-heals (message simply stays unread once, correct direction).
* **Monotonic guard vs. legitimate resets:** there is currently no product flow that legitimately moves `last_read_at` backwards; if one ever appears (e.g. "mark as unread" — *not* a v0.3 feature), the guard must be revisited then, not preemptively weakened now.

---

## R3 — Chat overview: username inline next to the display name

**Priority:** P1

### Goal

Home chat rows become two-line rows:

```text
Max Mustermann  @maxmustermann                14:32
last message …                           [3]
```

The small muted `@username` sits directly after the display name on the top line; the separate third line is removed.

### Current problem

`src/components/Home.tsx` renders three text lines per row: `.chat-topline` (name + time), `.chat-subline` (preview + unread badge), and a third line: `.chat-username` (`@{username}`), or `.chat-notes-tag` ("Private" tag) for the My Notes row. The stacked username wastes vertical space and reads as noise.

### Affected files / modules

* `src/components/Home.tsx` — row markup (move username into `.chat-topline`, remove the third line for peer rows).
* `src/index.css` — `.chat-topline`, `.chat-name`, `.chat-username` (inline style reuse: currently `12.5px` muted), ellipsis/flex-shrink rules for name+username coexisting with the timestamp.
* `src/i18n/translations.ts` — no new strings expected (username is data; existing keys suffice).
* `scripts/smoke-test.mjs` — line 2270 asserts `.chat-row.notes .chat-notes-tag` content ("Private"); must be updated to the chosen My Notes presentation (see decision below).

### Technical dependencies

* **Blocks R5** (avatar size/centering is tuned against the final row height, which changes from 3 to 2 text lines).
* Independent of R1/R2 (no shared logic), but same screen: merge conflicts are trivial; schedule after R2 so the P0s land on a stable row layout.

### Product decision to confirm at implementation start

* **My Notes row** currently shows the `.chat-notes-tag` pill instead of a username. Options: (a) inline the note icon/tag next to the name so **all** rows are two-line (recommended — consistent row height, matches the polish goal, zero new strings if `chat.myNotesTag` is reused); (b) keep the tag line for My Notes only (row stays taller). Default assumption is (a); deviation is a user decision, not an agent decision.
* `ended` rows (deleted account) already render no username (`sub = ''`) — behavior unchanged.

### Expected behavior

* Long display names and long usernames: name truncates with ellipsis first; the username shrinks/truncates before ever pushing the timestamp out (flexbox `min-width: 0` discipline already used elsewhere on this screen).
* Row becomes exactly two text lines for every row type (per the decision above).
* Request rows (`isRequest`) keep their existing `.chat-subline` request labels; accept/decline/cancel action rows unchanged.
* Accessibility: screen readers announce name + username in reading order; the unread badge (`role="status"`) and its v0.2 D1 contract remain untouched.

### Acceptance criteria / Definition of Done

1. Peer rows render as the target layout above; no `chat-username` line remains.
2. Name/username/timestamp never overlap or wrap onto a third line at any realistic length (incl. max-length display names).
3. My Notes row renders per the confirmed decision and remains instantly recognizable.
4. Both themes, EN/DE, mobile-first widths (320 px+) verified manually.
5. Smoke test updated and passing; no regressions in unread badge rendering.

### Tests needed

* **Smoke test:** assert top line contains display name and `@username`; assert exactly two text lines per row; update the My Notes assertion.
* **Source-level/a11y guard:** badge `role="status"` pattern preserved (already covered by `accessibility.test.mjs`; extend only if markup moves).

### Risks

* **Layout coupling:** v0.2's unread emphasis (`.chat-row.unread .chat-name { font-weight: 650 }`) and request-row weight overrides target `.chat-name` — must still apply with the username as sibling.
* The `.chat`/`.chat-text` class set is **reused by the Settings people-search rows**, which render `@{username}` inside `.chat-preview` — global class edits must not restyle search results unintentionally.

---

## R4 — Settings: category overview + subpages

**Priority:** P1

### Goal

Settings becomes a two-level structure: a category overview first, then one subpage per category — Profile, People, Language, Appearance, Chat Preferences, Account. Mobile-first, same minimal visual language.

### Current problem

`src/components/Settings.tsx` (1171 lines) is a single scrolling overlay (`#/settings`) that stacks all sections (Profile → Search People → Blocked → Language → Appearance → Chat → Account → footer). Scanning for one setting means scrolling the whole list; the file is also a growing maintainability hotspot.

### Affected files / modules

* `src/components/Settings.tsx` — overview list + move each `<Section>` into its own subpage view.
* Routing is **hash-based** (`src/lib/router.ts`): subpages map to `#/settings/profile`, `#/settings/people`, `#/settings/language`, `#/settings/appearance`, `#/settings/chat`, `#/settings/account`. All existing prefix checks already tolerate subroutes: `App.tsx` (`route.startsWith('#/settings')` keeps the overlay open and Home shifted), `Home.tsx` (Settings→Home reload trigger), `Settings.tsx` itself.
* `src/index.css` — the existing `.settings-subpanel` slide-in pattern (built and smoke-tested for `#/settings/blocked`) is the established mechanism to generalize; overview rows reuse `.settings-row.clickable`.
* `src/i18n/translations.ts` — category titles largely exist as section titles (`settingsScreen.*`); "People" as a combined category (search + blocked) may need one new key per language.
* `scripts/smoke-test.mjs` — asserts ≥ 6 `.settings-section` blocks and section titles; must be reworked for overview→subpage navigation (including the language switch and the EN/DE roundtrip, which currently assert through section titles).

### Category mapping (proposal)

* **Profile:** display name, username (static), email entry.
* **People:** user search, blocked-users list (the existing `#/settings/blocked` content lives here; decide whether the blocked list stays its own third-level page or merges into People).
* **Language:** EN/DE radio.
* **Appearance:** light/dark/system radio.
* **Chat Preferences:** Enter-to-send, My Notes toggle.
* **Account:** email/password change flows, sign out, delete account.
* Footer (version, imprint, GitHub) stays reachable — either at the bottom of the overview or as a final row group; do not strand legal links.

### Technical dependencies

* None on R1–R3, R5, R6. Self-contained UI restructuring; do it as its own PR.

### Expected behavior

* Overview shows the six categories (count-badge for blocked users preserved on the People row).
* Deep links work: `#/settings/<category>` opens that subpage directly; the legacy `#/settings/blocked` deep link keeps working (redirect or mapping — do not silently break it, it has shipped).
* Back navigation: subpage → overview → Home, via the existing header back button; browser/hash history behaves as today (plain hash changes).
* The Settings→Home `load()` refresh keeps firing when returning to `#/` from any `#/settings/*` depth (prefix logic — verify).
* All existing flows keep working unchanged from their new location: display-name save-on-blur, email-change confirm dialog + `scrollIntoView` onto the form, password-change with re-authentication, My Notes server-backed toggle, search with 300 ms debounce, unblock, sign-out and delete-account dialogs (incl. username-typing confirmation), block realtime channel.
* States that live in component state (forms, dialogs) survive overview↔subpage switches exactly as well as they survive scroll today; no state must leak between categories nor reset visibly on navigation.
* Focus management / Escape / aria-hidden conventions follow the existing subpanel implementation (v0.2 C3/D1 apply).

### Acceptance criteria / Definition of Done

1. All six categories and every existing control reachable through overview → subpage; nothing removed, nothing added feature-wise.
2. EN and DE: the smoke test's language roundtrip passes in its reworked navigation form.
3. The blocked badge/count still correct; My Notes toggle still reflects server state after Settings→Home→Settings.
4. Keyboard-only walkthrough of every subpage works (tab order, Escape, dialog traps).
5. `npm run build`, full smoke suite, all `node --test` suites pass.

### Tests needed

* **Smoke test rework:** navigation-driven assertions (open settings → click category → assert subpage content), language roundtrip, blocked subpage flow, My Notes toggle, imprint link reachability.
* **a11y source guards:** extend `accessibility.test.mjs` to the overview rows (real buttons with names) and subpage headers/back buttons.

### Risks

* **Largest single diff of v0.3** — the 1171-line component is re-partitioned; risk of subtle behavior drift (debounce timers, `open`-gated effects, dialog state, `busyId` handling). Mitigation: move sections mechanically, no logic rewrites in the same pass.
* **State persistence traps:** e.g. the appearance radio syncs with the header `ThemeButton` via a window event listener registered on mount — mounting model must not change which listeners exist vs. today.
* **Deep-link regression** for `#/settings/blocked` if replaced carelessly.
* Smoke-test rework can mask regressions if rewritten too permissively — review the new assertions against the old ones one by one.

---

## R5 — Avatars in the chat overview

**Priority:** P2

### Goal

Slightly larger avatars in Home rows, visibly more horizontal space between avatar and text, and the avatar remains exactly vertically centered between the row's top and bottom bounds.

### Current problem

* Home rows render `<Avatar name={name} size={40} />` (`src/components/Home.tsx`).
* The row button `.chat` is `display: flex; align-items: center; padding: 12px 4px` (`src/index.css`) and **declares no gap/margin at all** between the avatar and `.chat-text` — the current spacing is effectively minimal and jumps out as cramped.
* `.avatar` is an inline-styled circle (component) with `flexShrink: 0`; nothing else positions it.

### Affected files / modules

* `src/index.css` — row flex gap (or a dedicated margin on `.chat .avatar`); possibly a row-scoped avatar size if the component default should stay for other call sites.
* `src/components/Home.tsx` — only if the size is passed per call site (`size={…}`); **prefer CSS/!prop choice consciously**: other `Avatar` call sites are Chat header (36) and Settings search rows (default 40) — do not change those.
* No component API change to `Avatar.tsx` beyond what the chosen mechanism requires (none if handled via prop + CSS).

### Technical dependencies

* **Depends on R3.** R3 reduces rows from 3 to 2 text lines, changing row height; the avatar size and the "exactly centered between row bounds" requirement can only be tuned and verified against the final row layout.

### Expected behavior

* Avatar diameter modestly increased (tune at implementation against the two-line row, e.g. 44–48 px — final value is a visual decision, not a rewrite).
* Clear, constant horizontal gap between avatar and text block (flex `gap` on `.chat`), independent of theme and of unread/request/notes row variants.
* Vertical centering is mathematically guaranteed by the existing `align-items: center` flex container and holds for one-line (empty preview) and two-line content alike — the avatar may never bleed past row top/bottom bounds.
* `ended`/request/My Notes variants share the same geometry.

### Acceptance criteria / Definition of Done

1. Visual check (both themes, 320 px and desktop widths): larger avatar, clear gap, exact vertical centering in all row variants.
2. No layout shift of the unread badge/timestamp columns.
3. Other `Avatar` call sites unchanged.

### Tests needed

* **Smoke test:** structural assertion that the row uses a single flex `gap` (computed style checks are unavailable in jsdom beyond inline styles — accept class-presence/DOM-order assertions only, honest manual QA for the pixel verdicts).
* No unit-testable logic — pure CSS/layout item.

### Risks

* Very low. Main risk is breaking the centering invariant by spacing the avatar via margin instead of the flex container, or by letting row height grow from avatar size instead of text content (would contradict "centered between row bounds" readings where text defines the row) — keep text the height-defining element.

---

## R6 — Scroll-to-bottom arrow contrast

**Priority:** P2

### Goal

The floating scroll-to-bottom button remains clearly visible when it floats over the user's own (sent) message bubbles, without a visual redesign.

### Current problem (root cause verified)

`.scroll-down` (`src/index.css` ~line 1637) uses `background: var(--button)`. The sent bubble uses `background: var(--sent)` — and **the token values are identical**:

* light theme: `--button: #292925` **=** `--sent: #292925`;
* dark theme: `--button: #e4e3dc` **=** `--sent: #e4e3dc`.

Over own messages the 42 px disc therefore blends into the bubble almost perfectly; the only separation is the existing soft drop shadow `0 2px 10px rgba(0,0,0,0.18)`.

### Affected files / modules

* `src/index.css` — `.scroll-down` only (outline/ring and/or stronger shadow; keep size, position, entrance animation, and the `.scroll-down-count` badge as-is).
* `src/components/Chat.tsx` — no change expected (button markup and visibility logic stay).

### Technical dependencies

* None. Independent of R1–R5 (R1 changes *when* the button is visible, not its appearance).

### Expected behavior

* A subtle separation — e.g. a 1–2 px contrasting ring in a page-background/border token and/or a slightly deeper shadow — makes the disc readable on `--sent` bubbles in **both** themes.
* Button still matches the app's quiet visual language (no new colors introduced beyond existing tokens; no layout/size/shape change).
* Accessibility: the existing `icon-button` + `aria-label={t('unread.down')}` contract and keyboard focus visibility are preserved (do not remove the focus outline while adding the resting-state ring).

### Acceptance criteria / Definition of Done

1. Manual contrast check: button distinguishable over sent bubbles, received bubbles, and the bare background, in light and dark theme.
2. Reduced-motion variant unchanged (no animation changes).
3. Focus-visible state still visible.
4. No other uses of `var(--button)` are affected (it is shared by `.btn-small`, `.unread-badge`, send button — scope the change to `.scroll-down` only).

### Tests needed

* **Source-level guard:** `.scroll-down` declares an explicit separating outline/ring/box-shadow-halo (regression-safe against a future token refactor that re-collapses the colors).
* Visual verdict remains manual QA (no color-contrast automation exists in this repo).

### Risks

* Minimal. Only trap: accidentally styling all `var(--button)` consumers, or letting the ring look like a focus state.

---

## 3. DEPENDENCIES BETWEEN THE SIX ITEMS

```text
R2 (unread, P0)  ──protects──▶  R1 (initial scroll, P0)
                                  [shared scroll/read block in Chat.tsx;
                                   land R2's monotonic invariant
                                   before touching R1's timing]

R3 (2-line rows, P1) ──blocks──▶ R5 (avatar size/centering, P2)
                                  [row height must be final first]

R4 (settings subpages, P1)  independent — own PR
R6 (scroll-down contrast, P2) independent — own diff, one CSS rule
```

* The only **hard** dependency is R3 → R5.
* R1 ↔ R2 is a **shared-code** coupling, not a hard ordering: strictly separable, but R2-first makes R1's iteration safe (a monotonic read position absorbs any scroll-timing experiments without corrupting `connection_reads`).
* R4 touches no file that any other item touches.

## 4. RECOMMENDED IMPLEMENTATION ORDER

1. **R2** — correctness of persisted state first (fixes user-visible data corruption; self-contained; de-risks R1).
2. **R1** — initial-scroll anchoring, verified against the now-safe read model.
3. **R3** — two-line rows (small diff, establishes final row geometry).
4. **R4** — settings restructure (largest diff, fully independent, isolated PR).
5. **R5** — avatar polish on the final row layout.
6. **R6** — scroll-down contrast (smallest diff; good final low-risk PR).

Each item ships as its own focused PR with its own tests, per the repository's established workflow.

## 5. RECOMMENDED FIRST IMPLEMENTATION STEP

**R2 — the monotonic read position**, concretely:

1. Introduce a pure, unit-tested read-position advance (never regress) and apply it to every `lastReadRef` assignment in `Chat.tsx` (`computeUnreadBelow`, `handleScroll` bottom case, initial-load effect).
2. Make the unmount/stop-viewing flush persist the newest message timestamp known to that chat session.
3. Add the defensive monotonic guard to `saveReadState` in `src/lib/api.ts`.
4. Ship with `node --test` cases (regression refused / advance accepted / idempotent equal timestamp) using the existing mock-client patterns.

**Why this step:** it removes the only mechanism in v0.3 scope that *corrupts persisted user state*; it is small, reviewable, and testable with the repo's existing harnesses; it requires no UI, CSS, migration, or routing changes; and it is the safety precondition that makes R1's scroll-timing work (the riskiest behavioral change) free to iterate.

## 6. OUT OF SCOPE (explicit reminder)

Typing indicators, offline queue, push notifications, presence, reactions, "mark as unread", read receipts toward peers, group chats, media, any E2EE/schema/RLS/auth change, any dependency change, and any modification of `docs/arena-instructions.md`, `.github/workflows/`, or `docs/v02-roadmap-audit.md`. Any of these requires a separate explicit product decision and its own roadmap.

---

*This document defines proposed v0.3 work only. The repository remains the source of truth for what is implemented; completion is tracked per PR, not by editing this document during implementation.*
