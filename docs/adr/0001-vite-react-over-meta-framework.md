# ADR-0001 — Vite + React rather than a meta-framework

**Status:** Accepted · **Date:** 2026-08-24

## Context

The product is a single-page chat client: local persistence, no server-rendered content, no SEO
surface, one server-side endpoint (the credential proxy). It exists to demonstrate production
engineering practice — layering, testing, hygiene, CI/CD — so the toolchain should keep those
things visible rather than absorb them.

## Options

1. **Vite + React.** Thin build tool, explicit config, fast dev server. One serverless handler
   deployed alongside as a plain function.
2. **Next.js.** Routing, API routes and deployment conventions supplied. Brings a rendering model
   (Server Components, caching layers) the product does not use.
3. **Remix / TanStack Start.** Same objection as Next, with a smaller ecosystem for this stack.

## Decision

Vite + React + TypeScript. The one server-side need — a credential proxy — is a plain
`(req, res)` handler that Vercel picks up from `api/` and a small Vite plugin mounts locally.

## Consequences accepted

- Routing, data loading and the API mount are wired by hand. Roughly a day of work not delegated
  to a framework.
- No SSR, so no server-rendered first paint. Irrelevant for an authenticated single-page client.
- A future need for SSR is a migration, not a config change.
- Upside: the four-layer architecture stays legible, because nothing else is imposing structure.
