# ADR-0009 — Drop BYOK; the proxy holds the only credential

**Status:** Accepted · **Date:** 2026-08-25 · **Amends:** [ADR-0003](0003-credential-proxy-and-byok.md)

## Context

ADR-0003 chose a serverless proxy holding the key, plus an optional BYOK path: a client-supplied
`Authorization` header forwarded upstream in place of the server key, skipping the address rate
limit because the quota being spent is the user's.

The proxy half shipped and stands. The BYOK half shipped only as far as the adapter: `api/chat.ts`
reads and forwards the header, `transport.ts` and `useChatStream.ts` carry an optional `apiKey`,
and no UI ever sets it. `App.tsx` calls `useChatStream({ conversationId })`. The settings field and
"using your key" indicator ADR-0003 describes were never built, so the path is unreachable from the
running product — while still widening the proxy's input surface and costing a branch in each of
the three layers it crosses.

## Options

1. **Build the settings UI**, making the path reachable and the decision whole.
2. **Leave it inert** — no UI, plumbing retained against a later need.
3. **Remove it**, reverting to ADR-0003's option 2: proxy only.

## Decision

Option 3. The client-key branch is removed from `api/chat.ts`, and the optional `apiKey` from
`StreamChatOptions` and `UseChatStreamOptions`.

Option 1 buys nothing this product needs: it is a demonstration deployment with one key and a
known operator, not a multi-tenant service. Option 2 is the worse of the two — dead flexibility
that reads as a feature in the docs, carries the input surface of a live path, and has to be
explained every time someone traces the credential.

With one credential path, the proxy's contract collapses to a sentence: the server key or a 503,
and every request rate limited by address.

## Consequences accepted

- No per-user quota escape. A visitor who exhausts the address rate limit waits; there is no
  "use your own key" out. Acceptable at demonstration traffic, and the limiter's own ceiling
  (an in-memory `Map`, per ADR-0003) is the looser bound anyway.
- Restoring BYOK later means re-adding the branch in three layers. It is roughly thirty lines and
  the shape is recorded here and in ADR-0003 — cheaper to rewrite than to carry.
- The 503 copy no longer directs the user to settings that do not exist.
