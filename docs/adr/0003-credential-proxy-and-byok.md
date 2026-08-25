# ADR-0003 — Credential in a serverless proxy, with BYOK as an option

**Status:** Accepted; BYOK amended by [ADR-0009](0009-drop-byok.md) · **Date:** 2026-08-24

## Context

Vite inlines any client-visible environment value into the bundle at build time. A key referenced
from client code is public, regardless of how it is stored. OpenRouter's free tier allows 50
requests/day and 20 RPM — small enough that an unprotected endpoint is exhausted by one script.

## Options

1. **Key in the client.** Simplest, and immediately compromised.
2. **Serverless proxy holding the key.** One hop, and a place to enforce limits.
3. **BYOK only** — every user supplies their own key. No quota exposure, and a wall in front of
   first use.
4. **Proxy plus an optional BYOK toggle.**

## Decision

Option 4, both paths shipped in v1.0. `OPENROUTER_API_KEY` is read server-side only, never
`VITE_`-prefixed; a CI job greps for client-visible references, and Phase 6 extends it over
`dist/`.

The proxy is a security boundary, not a passthrough. It pins the model, caps `max_tokens`, caps
body size, caps message count, rate limits by address, and rejects anything unexpected before it
reaches OpenRouter. It streams the upstream body straight through — it does not parse SSE.

**BYOK skips rate limiting only.** When the client sends `Authorization: Bearer <user key>`, the
proxy forwards that key instead of the server key and skips the address rate limit, because the
quota being spent is the user's. Every other cap still applies. The user's key is client-side
state: never written to the storage layer, never logged. In the UI it is a settings field and a
"using your key" indicator — a state, not a screen.

## Consequences accepted

- Every request pays one extra network hop and a cold start.
- The rate limiter is an in-memory `Map` that resets on cold start, so it is a speed bump rather
  than a guarantee. Marked in code with its ceiling; a KV store when abuse appears.
- BYOK widens the input surface: a user-supplied header is forwarded upstream. It is forwarded
  verbatim and never persisted or logged, and the remaining caps bound the damage.
- Two credential paths mean two paths to test. Both are covered in Phase 2's verification.
