// enough. — Reusable Supabase test double for behavioral api.ts tests.
//
// The real `supabase` module is redirected (via the test loader) to
// `supabase-mock.mjs`. This helper builds a chain-recording fake client that:
//   - supports every query-builder method api.ts uses,
//   - resolves each awaited query / RPC from an ordered response queue,
//   - records each operation so tests can assert on authorization scoping and
//     on the exact database operations a function performs.
//
// A response is `{ data, error, count }` (any field may be omitted).

const QUERY_METHODS = [
  'select',
  'eq',
  'or',
  'ilike',
  'neq',
  'limit',
  'order',
  'in',
  'gt',
  'lt',
  'is',
  'single',
  'maybeSingle',
  'update',
  'insert',
  'upsert',
  'delete',
];

export function createSupabaseMock(responses = []) {
  const log = [];
  let cursor = 0;

  function nextResponse() {
    const r = responses[cursor++] ?? {};
    return {
      data: r.data ?? null,
      error: r.error ?? null,
      count: r.count ?? null,
    };
  }

  function makeBuilder(table) {
    const builder = {};
    for (const method of QUERY_METHODS) {
      builder[method] = (...args) => {
        log.push({ table, method, args });
        return builder;
      };
    }
    // Make the builder thenable so `await query` resolves the next response.
    builder.then = (onFulfilled, onRejected) =>
      Promise.resolve(nextResponse()).then(onFulfilled, onRejected);
    // Also expose `count`/`data` for any code that reads them post-await.
    return builder;
  }

  function makeRpc(name, params) {
    log.push({ rpc: name, params });
    return {
      then: (onFulfilled, onRejected) =>
        Promise.resolve(nextResponse()).then(onFulfilled, onRejected),
    };
  }

  function makeFunctions() {
    return {
      invoke: (name, options) => {
        log.push({ function: name, options });
        return Promise.resolve(nextResponse());
      },
    };
  }

  const client = {
    from(table) {
      return makeBuilder(table);
    },
    rpc(name, params) {
      return makeRpc(name, params);
    },
    functions: makeFunctions(),
    // Test introspection / control.
    _log: log,
    _responses: responses,
    _setResponses(next) {
      responses = next;
      cursor = 0;
    },
    _resetLog() {
      log.length = 0;
      cursor = 0;
    },
  };

  return client;
}
