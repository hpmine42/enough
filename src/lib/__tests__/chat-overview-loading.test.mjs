// enough. — regression guards for the Home chat-overview placeholder flicker.
//
// The bug was a visible UI swap on load / reload:
//
//   green default avatar with "…" + name "…" + username "…"  →  real contact
//
// Cause: Home rendered real chat rows before peer profiles were available,
// using `displayName(other)` → '…' and `@${other?.username ?? '…'}` as
// apparent contact data. The list therefore flashed a finished-looking
// placeholder before correcting itself. The fix is:
//
//   * treat a missing peer identity as a loading state
//   * render the quiet skeleton in that state, not a placeholder contact
//   * commit the overview atomically (connections only after profiles)
//   * harden Avatar so placeholder strings can never appear as avatar content
//
// These guards are source-level — the rendered counterpart (navigation,
// long-press, empty state, offline cache) is exercised by the smoke test.
// They fail if the placeholder path is reintroduced or an artificial delay
// is added.
//
// Run with:
//   npm run test:home
//   node --test --experimental-strip-types src/lib/__tests__/chat-overview-loading.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isProfileReady, isChatIdentityReady } from '../helpers.ts';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const readRel = (p) => fs.readFileSync(`${__dirname}/../../${p}`, 'utf-8');
const home = readRel('components/Home.tsx');
const avatar = readRel('components/Avatar.tsx');
const helpers = readRel('lib/helpers.ts');
const css = readRel('index.css');

/* ---------- 1 / 2 / 3: incomplete data never renders "…" ---------- */

test('Home never renders placeholder identity strings as finished contact data', () => {
  // The row must not build its display name / username from a '…' fallback.
  // The old code was:
  //   displayName(other)           // → '…' when other === null
  //   `@${other?.username ?? '…'}` // → '@…' when other === null
  // Both looked like real contact data and caused the green avatar + "…"
  // flash. The new row guards with isChatIdentityReady and uses the verified
  // username only.
  assert.ok(
    home.includes('isChatIdentityReady(other'),
    'Home guards peer rows with isChatIdentityReady',
  );
  // No placeholder username construction may remain in the rows mapping.
  // The only remaining "…" fallbacks belong to the helper itself (displayName
  // fallback) and to comments, never to the rendered row.
  const rowsSection = home.slice(home.indexOf('rows.map('), home.indexOf('rows.map(') + 8000);
  // Direct placeholder construction must be gone from the row rendering.
  assert.ok(
    !rowsSection.includes("?? '…'") || rowsSection.indexOf("?? '…'") > rowsSection.indexOf('isChatIdentityReady'),
    'rows do not fall back to "…" for a missing username before the guard',
  );
  // The old interpolation pattern must be absent.
  assert.ok(
    !home.includes('@${other?.username ??'),
    'rows do not interpolate a placeholder username',
  );
  // The username is read only after the guard, from the verified profile.
  assert.ok(
    home.includes('@${other!.username}'),
    'the username is rendered only after the identity-ready guard',
  );
});

test('Avatar never renders a placeholder initial', () => {
  assert.ok(
    avatar.includes("isPlaceholder") && avatar.includes("trimmed === '…'"),
    'Avatar treats "…" as a missing identity',
  );
  assert.ok(
    avatar.includes('PersonIcon'),
    'Avatar falls back to the person icon for placeholder / empty names',
  );
  // The palette must not be seeded from a placeholder string — it would look
  // like a finished contact with a coloured "…" initial.
  assert.ok(
    avatar.includes('!isPlaceholder && name ? pickColour'),
    'Avatar does not hash a placeholder string for its colour',
  );
  // Literals that would render "…" as text content must not appear.
  assert.ok(
    !/showInitial \?[^:]*initial/.test(avatar) || avatar.includes("initial !== '…'"),
    'showInitial explicitly rejects "…"',
  );
});

/* ---------- 4: skeleton is used instead of a finished row ---------- */

test('unready identities render the skeleton, not a finished row', () => {
  // The guard must branch to a skeleton row with the same quiet anatomy as
  // the global first-paint skeleton, hidden from AT.
  assert.ok(
    home.includes('if (!identityReady)'),
    'the row branching checks identityReady',
  );
  const guardIdx = home.indexOf('if (!identityReady)');
  const skeletonIdx = home.indexOf('className=\"skeleton-row\"', guardIdx);
  assert.ok(skeletonIdx > guardIdx && skeletonIdx < guardIdx + 2000, 'unready identity returns a skeleton-row');
  const skeletonChunk = home.slice(skeletonIdx, skeletonIdx + 800);
  assert.ok(skeletonChunk.includes('skeleton-avatar'), 'skeleton carries the avatar placeholder');
  assert.ok(skeletonChunk.includes('skeleton-line'), 'skeleton carries the text-line placeholders');
  assert.ok(skeletonChunk.includes('aria-hidden=\"true\"'), 'per-row skeleton is decorative and hidden from AT');
  // It must not render an Avatar at all in this branch.
  assert.ok(!skeletonChunk.includes('<Avatar'), 'unready branch does not render Avatar');
});

test('helper isProfileReady / isChatIdentityReady implement the spec', () => {
  assert.equal(isProfileReady(null), false, 'null is not ready');
  assert.equal(isProfileReady(undefined), false);
  assert.equal(isProfileReady({ id: '1', username: '…' }), false, 'ellipsis username is not ready');
  assert.equal(isProfileReady({ id: '1', username: '...' }), false);
  assert.equal(isProfileReady({ id: '1', username: '' }), false);
  assert.equal(isProfileReady({ id: '1', username: '  ' }), false);
  assert.equal(isProfileReady({ id: '1', username: 'benno' }), true);
  assert.equal(isProfileReady({ id: '1', username: 'benno', display_name: '' }), true, 'empty display_name still ready via username');

  assert.equal(isChatIdentityReady(null, { self: false, ended: false }), false);
  assert.equal(isChatIdentityReady(null, { self: true, ended: false }), true, 'self needs no peer profile');
  assert.equal(isChatIdentityReady(null, { self: false, ended: true }), true, 'ended (deleted account) needs no peer profile');
  assert.equal(
    isChatIdentityReady({ id: '1', username: 'benno' }, { self: false, ended: false }),
    true,
  );
});

/* ---------- 5: finished row only after required data is present ---------- */

test('finished row is gated behind the identity guard', () => {
  const rowsSection = home.slice(home.indexOf('rows.map('));
  // The guard must appear before any finished-row construction (name, sub,
  // Avatar). The order is: guard → early return skeleton → name/sub/Avatar.
  const guard = rowsSection.indexOf('if (!identityReady)');
  const skeleton = rowsSection.indexOf('className=\"skeleton-row\"', guard);
  const avatarIdx = rowsSection.indexOf('<Avatar name={name}', guard);
  assert.ok(guard < skeleton && skeleton < avatarIdx, 'Avatar renders only after the identity guard');
  // displayName is called only in the ready branch (the early return prevents it otherwise).
  const displayIdx = rowsSection.indexOf('displayName(other)', guard);
  assert.ok(displayIdx > skeleton, 'displayName is only reached after the guard');
});

/* ---------- 6: skeleton and finished row share geometry ---------- */

test('skeleton and finished row share the same basic geometry', () => {
  function rule(selector) {
    const m = css.match(new RegExp(`\\n\\.${selector.replace(/[.+]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
    return m ? m[1] : null;
  }
  const chatRule = rule('chat');
  const skeletonRowRule = rule('skeleton-row');
  const avatarRule = rule('avatar');
  const skeletonAvatarRule = rule('skeleton-avatar');
  assert.ok(chatRule && skeletonRowRule, 'both .chat and .skeleton-row are styled');
  // Same outer rhythm: gap and padding.
  for (const prop of ['gap:\\s*14px', 'padding:\\s*14px 8px']) {
    assert.ok(new RegExp(prop).test(chatRule), `.chat has ${prop}`);
    assert.ok(new RegExp(prop).test(skeletonRowRule), `.skeleton-row has ${prop}`);
  }
  // Same avatar size: 46 px diameter.
  assert.ok(/width:\s*46px/.test(avatarRule) || /width:\s*46px/.test(skeletonAvatarRule) || /width:\s*46px/.test(css), 'avatar and skeleton avatar share the 46 px size');
  // Skeleton must still be neutral across themes — it consumes the same
  // surface tokens as the decorative global skeleton (no accent, no text).
  const skeletonAvatarBody = skeletonAvatarRule ?? '';
  const skeletonLineBody = rule('skeleton-line') ?? '';
  assert.ok(/var\(--surface-2\)/.test(skeletonAvatarBody), 'skeleton avatar uses the neutral surface token');
  assert.ok(/var\(--surface-2\)/.test(skeletonLineBody), 'skeleton lines use the neutral surface token');
  // The skeleton row must keep the list gap and not introduce a border.
  const chatListRule = rule('chat-list');
  const skeletonListRule = rule('chat-list-skeleton');
  assert.ok(chatListRule && /gap:\s*var\(--space-1\)/.test(chatListRule), '.chat-list separates rows by spacing');
  if (skeletonListRule) {
    assert.ok(/gap:\s*var\(--space-1\)/.test(skeletonListRule), '.chat-list-skeleton uses the same gap');
  }
  // No separator or card border on rows in either mode.
  const rowRule = rule('chat-row');
  assert.ok(!rowRule || !/border(-|:)/.test(rowRule), 'rows carry no card borders');
});

/* ---------- 7: no artificial delay ---------- */

test('no artificial delay is introduced for the overview loading', () => {
  // The overview must not delay rendering of ready data. An allowlisted
  // setTimeout of 550 ms exists for the long-press row menu only; the
  // loading path must not contain another timeout / delay.
  const timeouts = [...home.matchAll(/setTimeout/g)].length;
  assert.equal(timeouts, 2, 'Home keeps exactly the two long-press timers, no extra delay');
  assert.ok(home.includes('LONG_PRESS_MS'), 'the remaining timers are the long-press guard');
  // The loading logic must not await a timeout or an artificial sleep.
  assert.ok(!home.includes('await sleep'), 'no sleep in the loading path');
  assert.ok(!/await new Promise/.test(home), 'no promise-based delay');
  // The global skeleton condition is `loading && !hasChats`, not a timed
  // minimum display duration.
  assert.ok(home.includes('loading && !hasChats ?'), 'the global skeleton is gated by data, not by time');
  // Ensure the skeleton is not hidden behind a timeout (e.g. setTimeout(() => setLoading(false), 800)).
  // The only setTimeout usages must be near LONG_PRESS_MS, not near skeleton/loading.
  const skeletonIdx = home.indexOf('chat-list-skeleton');
  const timeoutIdxs = [...home.matchAll(/setTimeout/g)].map((m) => m.index ?? -1);
  for (const idx of timeoutIdxs) {
    assert.ok(
      Math.abs(idx - skeletonIdx) > 3000,
      'skeleton rendering is not inside a setTimeout callback',
    );
  }
});

/* ---------- 8: cached data renders immediately ---------- */

test('cached snapshot data is rendered without artificial delay', () => {
  // When the browser is offline Home loads the sealed snapshot and commits
  // it as soon as it is available. No timeout guards it.
  const skipBlock = home.slice(
    home.indexOf('if (shouldSkipNetwork()) {'),
    home.indexOf('const connsResult = await getMyConnections(me);'),
  );
  assert.ok(skipBlock.includes('loadHomeSnapshot'), 'offline path loads the snapshot');
  assert.ok(skipBlock.includes('setConnections(snapshot.connections)'), 'snapshot connections are committed');
  assert.ok(skipBlock.includes('setOthers(snapshot.profiles)'), 'snapshot profiles are committed');
  assert.ok(!skipBlock.includes('setTimeout'), 'snapshot commit is not delayed');
});

/* ---------- atomic commit: connections only after profiles ---------- */

test('overview commits connections only after profiles are available', () => {
  // The non-cached online path must not expose connections before the
  // corresponding profiles were fetched — that was the flash cause: rows
  // existed with `other === null` and rendered the placeholder.
  const onlineBlock = home.slice(
    home.indexOf('const lastAllResult = await getLastMessages'),
    home.indexOf('reportNetworkSuccess();'),
  );
  const setConnectionsIdx = onlineBlock.indexOf('setConnections(visible)');
  const getProfilesIdx = onlineBlock.indexOf('getProfiles(ids)');
  const setOthersIdx = onlineBlock.indexOf('setOthers(profilesResult.data)');
  assert.ok(getProfilesIdx > 0 && setConnectionsIdx > 0, 'both calls exist');
  assert.ok(
    getProfilesIdx < setConnectionsIdx,
    'connections are set only after profiles were fetched',
  );
  assert.ok(
    setConnectionsIdx < setOthersIdx + 200 || setConnectionsIdx < onlineBlock.indexOf('setLastMessages'),
    'all overview pieces are committed together after profiles',
  );
  // Verify the comment explaining the atomic commit is present.
  assert.ok(
    onlineBlock.includes('Commit the overview atomically') ||
      onlineBlock.includes('connections are not exposed before'),
    'the atomic-commit rationale is documented',
  );
});
