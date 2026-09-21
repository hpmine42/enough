/** Runtime regressions for A-01–A-03, called by the production-bundle smoke. */
export async function runReleaseBlockers(h) {
  const { window, db, messageGates, chatCommits, subscriptions,
    setHash, setInputValue, text, click, waitFor, assert, sleep } = h;
  const doc = window.document;
  const A = 'switch-notes';
  const B = 'switch-peer';
  const aText = 'Only conversation A';
  const bText = 'Only conversation B';
  const now = new Date().toISOString();
  db.connections.push(
    { id: A, user_a: 'user-1', user_b: 'user-1', status: 'accepted', created_at: now },
    { id: B, user_a: 'user-1', user_b: 'user-2', status: 'accepted', created_at: now },
  );
  // Existing plaintext history is supported; new peer sends below MUST still
  // use the genuine Signal manager installed by the parent smoke harness.
  db.messages.push(...[[A, aText], [B, bText]].map(([id, ciphertext]) => ({
    id: `message-${id}`, connection_id: id, sender_id: 'user-1', ciphertext,
    created_at: now, deleted_at: null, kind: 'text',
  })));

  await waitFor(() => doc.querySelector('.form input[type="email"]'), 'blockers: login ready');
  setInputValue(doc.querySelector('.form input[type="email"]'), 'anna@example.com');
  setInputValue(doc.querySelector('.form input[type="password"]'), 'secret123');
  doc.querySelector('.form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => doc.querySelector('.home-screen'), 'blockers: authenticated Home');

  function hold(id, error = false) {
    let release;
    const promise = new Promise((resolve) => { release = resolve; });
    const gate = { promise, release, error, started: false, completed: false };
    messageGates.set(id, gate);
    return gate;
  }
  const composer = () => doc.querySelector('.composer-input');
  const latest = () => chatCommits.at(-1);
  async function go(id) {
    const start = chatCommits.length;
    setHash(`#/chat/${id}`);
    await waitFor(() => chatCommits.slice(start).some((frame) => frame.id === id), `switch: committed ${id}`);
    const first = chatCommits.slice(start).find((frame) => frame.id === id);
    assert(first?.key === `user-1:${id}`, 'first destination commit belongs to its own account/connection instance');
    assert(first?.loading && first.disabled && !first.messages && !first.draft && !first.error,
      'first direct-link commit has fresh loading, messages, draft and error state');
    return start;
  }
  async function ready(id) {
    const expected = id === A ? aText : bText;
    await waitFor(() => latest()?.id === id && text('.messages')?.includes(expected) &&
      composer()?.disabled === false, `switch: ${id} messages revealed and composer usable`);
    assert(!doc.querySelector('.chat-load-error'), `${id} has no stale load error or Retry`);
    assert(text('.chat-peer-name') === (id === A ? 'My Notes' : 'Benno Schmidt'), `${id} has the correct identity`);
  }
  async function settle(gate) {
    gate.release();
    await waitFor(() => gate.completed, 'delayed response delivered');
    // Flush response parsing + React work, not an application loading delay.
    await sleep(50);
  }

  console.log('\nA-01 / A-02: direct Chat switches, observing every React commit\n');
  await go(A);
  await ready(A);
  setInputValue(composer(), 'Private A draft');
  const slowB = hold(B);
  await go(B);
  await waitFor(() => slowB.started, 'B load held after A was fully loaded');
  assert(composer()?.value === '' && composer()?.disabled, 'B loading cannot reuse A draft or enabled composer');
  assert(!text('.chat-screen')?.includes(aText) && text('.chat-peer-name') !== 'My Notes',
    'no A message or identity during B loading');
  const blank = doc.querySelector('[data-testid="chat-loading-skeleton"]');
  assert(blank && blank.childElementCount === 0 && blank.textContent === '', 'B loading stays quiet and completely blank');
  await settle(slowB);
  await ready(B);
  setInputValue(composer(), 'Private B draft');
  await go(A);
  await ready(A);
  assert(composer()?.value === '', 'A → B → A remount does not restore either old draft');

  // A failed page, then direct B success (the stale loadError regression).
  await go(B);
  await ready(B);
  const failA = hold(A, true);
  failA.release();
  await go(A);
  await waitFor(() => doc.querySelector('.chat-load-error button'), 'A load reaches a real error and Retry');
  await go(B);
  await ready(B);

  // Pending initial A success/error cannot contaminate a successful B.
  for (const error of [false, true]) {
    const pending = hold(A, error);
    await go(A);
    await waitFor(() => pending.started, `pending A initial ${error ? 'error' : 'success'} request`);
    await go(B);
    await ready(B);
    await settle(pending);
    await ready(B);
    assert(!text('.messages')?.includes(aText), 'late initial A result never enters B');
  }

  // An actual error → Retry request is in flight while A is replaced by B.
  for (const error of [false, true]) {
    const failed = hold(A, true);
    failed.release();
    await go(A);
    await waitFor(() => doc.querySelector('.chat-load-error button'), 'A fails before retry');
    const retry = hold(A, error);
    click('.chat-load-error button');
    await waitFor(() => retry.started, `pending A retry ${error ? 'error' : 'success'}`);
    const oldChannels = subscriptions.filter((s) => s.name === `chat-${A}` && !s.removed);
    assert(oldChannels.length > 0, 'captured actual A realtime callbacks before switch');
    await go(B);
    await ready(B);
    await settle(retry);
    assert(oldChannels.every((s) => s.removed), 'A realtime subscriptions are removed on unmount');
    let delivered = 0;
    for (const channel of oldChannels) {
      for (const handler of channel.handlers) {
        if (handler.filter.table === 'messages' && handler.filter.event === 'INSERT') {
          handler.callback({ new: { ...db.messages[0], id: `late-A-${error}`, ciphertext: 'Late A realtime' } });
          delivered++;
        }
        if (handler.filter.table === 'connections') {
          handler.callback({ new: { ...db.connections[0], status: 'ended' } });
          delivered++;
        }
        if (handler.filter.table === 'profiles') {
          handler.callback({ new: { ...db.profiles[0], display_name: 'Late A identity' } });
          delivered++;
        }
      }
    }
    assert(delivered >= 3, 'delivered queued old message/connection/profile callbacks after unsubscribe');
    await sleep(50);
    await ready(B);
    assert(!text('.chat-screen')?.includes('Late A'), 'late retry/realtime results cannot touch B');
  }

  // Returning to the same ID creates another instance, not a resurrection of
  // the old pending A request (even though both instances have the same key).
  const abandonedA = hold(A, true);
  await go(A);
  await waitFor(() => abandonedA.started, 'old A request pending before A → B → A');
  await go(B);
  await ready(B);
  await go(A);
  await ready(A);
  await settle(abandonedA);
  await ready(A);
  assert(!doc.querySelector('.chat-load-error'), 'old A error cannot poison the new A instance');
  await go(B);
  await ready(B);

  // Sending in the surviving peer chat still targets that peer and never
  // writes plaintext. Notes keep the explicitly supported plaintext path.
  setInputValue(composer(), 'B encrypted send');
  doc.querySelector('.composer').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => db.messages.some((m) => m.connection_id === B && m.id.startsWith('msg-')),
    'send after switch reaches B');
  const sent = db.messages.find((m) => m.connection_id === B && m.id.startsWith('msg-'));
  assert(sent?.ciphertext && !sent.ciphertext.includes('B encrypted send'), 'peer send remains ciphertext-only');
  await waitFor(() => composer()?.value === '', 'successful B send clears only its own draft');

  assert(chatCommits.length > 30, `observed ${chatCommits.length} real Chat commits (including loading and reveal)`);
  assert(chatCommits.every((f) => f.connectionIds.every((id) => id === f.id) &&
    f.messageConnections.every((id) => id === f.id)), 'every committed connection/message state agrees with Chat props');
  assert(chatCommits.every((f) => f.id !== B || (f.name !== 'My Notes' && !f.messages.includes(aText) &&
    !f.draft.includes('Private A'))), 'not one B commit shows A identity, message or draft');
  assert(chatCommits.every((f) => !f.loading || (f.disabled && f.blankText === '' && f.blankChildren === 0 && !f.messages)),
    'every loading commit is blank and disabled until the existing reveal gate settles');
  assert(chatCommits.every((f) => !f.messages.includes('Decrypting') && !f.messages.includes('…')),
    'initial reveal never exposes intermediate bubble text');

  console.log('\nA-03: rendered Settings layer isolation and focus restoration\n');
  setHash('#/');
  await waitFor(() => doc.querySelector('.home-screen'), 'Home before Settings');
  const homeControl = doc.querySelector('.app-stage button');
  homeControl.focus();
  setHash('#/settings');
  await waitFor(() => doc.querySelector('.settings-overlay.open'), 'Settings opens');
  const stage = doc.querySelector('.app-stage');
  assert(stage.hasAttribute('inert') && stage.getAttribute('aria-hidden') === 'true', 'covered app stage is inert and hidden from accessibility');
  const overview = doc.querySelector('[data-pane="settings"]');
  assert(!overview.hasAttribute('inert'), 'visible overview remains navigable');
  const profileButton = overview.querySelector('[data-category="profile"]');
  profileButton.focus();
  profileButton.click();
  await waitFor(() => doc.querySelector('[data-focus-region="settings-profile"].open'), 'Profile opens');
  const subpage = doc.querySelector('[data-focus-region="settings-profile"]');
  assert(overview.hasAttribute('inert') && overview.getAttribute('aria-hidden') === 'true', 'covered overview is inert and accessibility-hidden');
  assert(!subpage.hasAttribute('inert') && subpage.contains(doc.activeElement), 'focus enters accessible Profile, not the covered overview');
  subpage.querySelector('button').click();
  await waitFor(() => doc.activeElement === profileButton, 'Back restores the exact Profile category button');
  assert(!overview.hasAttribute('inert'), 'overview becomes accessible again on return');

  const peopleButton = overview.querySelector('[data-category="people"]');
  peopleButton.focus();
  peopleButton.click();
  await waitFor(() => doc.querySelector('[data-focus-region="settings-people"].open'), 'People opens');
  const people = doc.querySelector('[data-focus-region="settings-people"]');
  const blockedButton = [...people.querySelectorAll('button')].find((b) => b.textContent.includes('Blocked users'));
  blockedButton.focus();
  blockedButton.click();
  await waitFor(() => doc.querySelector('.settings-subpanel-nested.open'), 'nested Blocked users opens');
  const nested = doc.querySelector('.settings-subpanel-nested');
  assert(people.hasAttribute('inert') && nested.contains(doc.activeElement), 'covered People is inert; focus belongs to nested page');
  nested.querySelector('button').click();
  await waitFor(() => doc.activeElement === blockedButton, 'nested Back restores the blocked-list opener');
  people.querySelector('button').click();
  await waitFor(() => doc.activeElement === peopleButton, 'People Back restores its overview opener');

  setHash('#/new-chat');
  await waitFor(() => doc.querySelector('[data-pane="settings"][data-pane-state="leaving"]'), 'outgoing Settings retained during animation');
  assert(overview.hasAttribute('inert') && overview.getAttribute('aria-hidden') === 'true', 'leaving pane cannot receive keyboard or accessibility focus');
  const search = doc.querySelector('[data-pane="new-chat"]');
  assert(!search.hasAttribute('inert') && search.contains(doc.activeElement), 'entering New chat is immediately navigable');
  setHash('#/settings');
  await waitFor(() => doc.querySelector('[data-pane="new-chat"][data-pane-state="leaving"]'), 'rapid reverse swap retains outgoing New chat');
  assert(doc.querySelector('[data-pane="new-chat"]').hasAttribute('inert'), 'reverse-swap leaving pane is also inert');
  setHash('#/');
  await waitFor(() => !doc.querySelector('.settings-overlay.open'), 'overlay closes');
  assert(doc.querySelector('.settings-overlay').hasAttribute('inert'), 'closing overlay is inert while its exit remains mounted');
  assert(!stage.hasAttribute('inert') && doc.activeElement === homeControl, 'close restores the original available Home control');
  // jsdom only checks attributes + managed focus. Native Tab and AX-tree
  // exclusion are deliberately tested separately in smoke-settings-browser.
}
