/**
 * React's commit hook sees EVERY committed frame, unlike MutationObserver
 * which can coalesce several commits before its microtask runs. Observe real
 * Chat props/state and the DOM together; never infer Chat identity from the
 * URL (which changes before React handles it).
 */
export function observeChatCommits(window) {
  const frames = [];
  const hook = {
    supportsFiber: true,
    inject: () => 1,
    onCommitFiberUnmount() {},
    onCommitFiberRoot(_renderer, root) {
      function visit(fiber) {
        if (!fiber) return;
        const props = fiber.memoizedProps;
        if (typeof fiber.type === 'function' && props &&
            Object.hasOwn(props, 'initialIdentity') && props.connectionId) {
          const doc = window.document;
          const connectionIds = [];
          const messageConnections = [];
          for (let state = fiber.memoizedState; state; state = state.next) {
            const value = state.memoizedState;
            if (value?.user_a && value?.user_b) connectionIds.push(value.id);
            if (Array.isArray(value)) {
              for (const item of value) {
                if (item?.connection_id) messageConnections.push(item.connection_id);
              }
            }
          }
          const input = doc.querySelector('.composer-input');
          const blank = doc.querySelector('[data-testid="chat-loading-skeleton"]');
          frames.push({
            id: props.connectionId, key: fiber.key, connectionIds, messageConnections,
            name: doc.querySelector('.chat-peer-name')?.textContent ?? '',
            messages: doc.querySelector('.messages')?.textContent ?? '',
            draft: input?.value ?? '', disabled: input?.disabled ?? true,
            loading: !!blank, blankText: blank?.textContent ?? '',
            blankChildren: blank?.childElementCount ?? 0,
            error: doc.querySelector('.chat-load-error')?.textContent ?? '',
          });
        }
        visit(fiber.child);
        visit(fiber.sibling);
      }
      visit(root.current);
    },
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  return frames;
}

/** Keep the real callbacks even after unsubscribe, modelling queued delivery. */
export function observeRealtime(client) {
  const subscriptions = [];
  const channel = client.channel.bind(client);
  const remove = client.removeChannel.bind(client);
  client.channel = (...args) => {
    const result = channel(...args);
    const record = { name: args[0], channel: result, handlers: [], removed: false };
    subscriptions.push(record);
    const on = result.on.bind(result);
    result.on = (type, filter, callback) => {
      record.handlers.push({ type, filter, callback });
      return on(type, filter, callback);
    };
    return result;
  };
  client.removeChannel = (value) => {
    for (const record of subscriptions) {
      if (record.channel === value) record.removed = true;
    }
    return remove(value);
  };
  return subscriptions;
}
