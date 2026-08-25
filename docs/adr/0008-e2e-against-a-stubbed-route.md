# ADR-0008 — E2E against the production build with `/api/chat` stubbed

**Status:** Accepted · **Date:** 2026-08-25

## Context

TECHNICAL-DESIGN §5 asks for three E2E journeys and §7 lists them as blocking, running "against
the preview deployment". The free tier allows 50 requests a day and 20 a minute, and the model
behind `openrouter/free` is a router — the same prompt returns different text, at a different
speed, on every run.

The journeys assert the product: a chat is created, an answer streams in, Stop interrupts it,
switching chats keeps the partial answer, a reload brings it back. None of that is an assertion
about OpenRouter.

## Options

1. **Preview deployment, real API.** Faithful, and flaky: rate limits, non-deterministic text, and
   a shared quota that a busy day of pull requests exhausts.
2. **Preview deployment, stubbed route.** The deployed proxy is bypassed anyway, so the journeys
   test the deployed static assets while waiting on a deployment to exist.
3. **Local production build, stubbed route.** `vite build` plus `vite preview`, with the page's
   `fetch` answering `/api/chat` from a scripted SSE stream.

## Decision

Option 3. The stub emits real SSE bytes over a live `ReadableStream` — keepalive comment frames, a
`[DONE]` sentinel, a stream that stays open until it is aborted — so the transport, the core
buffer and the hooks all run exactly as they do in production. Behaviour is selected by the text
the test types, which keeps the stub free of test-specific branching.

The gate that the deployment itself is sound is the proxy's own test suite plus the secret scan
over `dist/`, not a browser driving a live model.

## Consequences accepted

- E2E does not prove the deployed proxy answers. `api/chat.test.ts` covers the handler, and a
  broken deploy surfaces on first use rather than in CI. Accepted: the alternative is a suite that
  fails for reasons unrelated to the change under review.
- The stub is a second implementation of the wire format, and can drift from OpenRouter's. It is
  small, and the frames it emits are the ones already pinned by the core unit tests.
- No Vercel token, project id or deployment wait in CI, so the E2E job runs on a fork's pull
  request like any other.
