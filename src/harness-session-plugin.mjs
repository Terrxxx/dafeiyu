// Carry trusted SDK session identity outside text that compaction may rewrite.
import { AsyncLocalStorage } from 'node:async_hooks';
export const name = 'dafeiyu-session-identity';
export const inject = ['llm'];
export function apply(ctx) {
  const session = new AsyncLocalStorage();
  const origin = new URL(process.env.DAFEIYU_BRIDGE_URL).origin;
  const original = globalThis.fetch;
  const wrapped = function (input, options) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const identity = session.getStore();
    if (identity?.id && url.origin === origin && url.pathname === '/v1/chat/completions') {
      const headers = new Headers(options?.headers || (input instanceof Request ? input.headers : undefined));
      headers.set('X-Dafeiyu-Session', identity.id);
      headers.set('X-Dafeiyu-Purpose', identity.purpose);
      return original(input, { ...options, headers });
    }
    return original(input, options);
  };
  globalThis.fetch = wrapped;
  ctx.on('llm/stream', async function* (options, next) {
    const identity = { id: options.sessionId ? String(options.sessionId) : session.getStore()?.id, purpose: options.purpose === 'compaction' ? 'compaction' : 'conversation' };
    const iterator = session.run(identity, () => next()[Symbol.asyncIterator]());
    try {
      for (;;) {
        const result = await session.run(identity, () => iterator.next());
        if (result.done) return result.value;
        yield result.value;
      }
    } finally { if (iterator.return) await session.run(identity, () => iterator.return()); }
  });
  ctx.on('dispose', () => { if (globalThis.fetch === wrapped) globalThis.fetch = original; });
}
