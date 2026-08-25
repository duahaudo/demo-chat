# ADR-0003 — Credential in a serverless proxy

**Status:** Accepted · **Date:** 2026-08-24

## Context

Vite inlines any client-visible environment value into the bundle at build time. A key referenced
from client code is public, regardless of how it is stored. OpenRouter's free tier allows 50
requests/day and 20 RPM — small enough that an unprotected endpoint is exhausted by one script.

## Options

1. **Key in the client.** Simplest, and immediately compromised.
2. **Serverless proxy holding the key.** One hop, and a place to enforce limits.
3. **Every user supplies their own key.** No quota exposure, and a wall in front of first use.

## Decision

Option 2. `OPENROUTER_API_KEY` is read server-side only, never `VITE_`-prefixed; a CI job greps for
client-visible references, and Phase 6 extends it over `dist/`.

The proxy is a security boundary, not a passthrough. It pins the model, caps `max_tokens`, caps
body size, caps message count, rate limits by address, and rejects anything unexpected before it
reaches OpenRouter. It streams the upstream body straight through — it does not parse SSE.

One credential path, so the contract is a sentence: the server key or a 503, and every request rate
limited by address.

Option 3 puts a key prompt in front of a demonstration, and this deployment has one key and a known
operator rather than tenants.

## Consequences accepted

- Every request pays one extra network hop and a cold start.
- The rate limiter is an in-memory `Map` that resets on cold start, so it is a speed bump rather
  than a guarantee. Marked in code with its ceiling; a KV store when abuse appears.
- No per-user quota escape. A visitor who exhausts the address rate limit waits. Acceptable at
  demonstration traffic, and the limiter's own ceiling is the looser bound anyway.
