# Demo Chat

A streaming chat client over the [OpenRouter](https://openrouter.ai) API. React + TypeScript on
Vite, Chakra UI, deployed on Vercel with the API credential held in a serverless proxy.

Built to demonstrate production engineering practice — layering, unit testing, repository hygiene,
GitHub Actions, CI/CD — rather than to be a large product.

## What it does

- Chat list ordered by last activity: rename inline, delete with confirmation, each conversation an
  addressable URL so back and forward work.
- Answers stream token by token, with a Stop that keeps the partial answer rather than discarding
  it. Switching chats mid-stream cancels the request; a late delta never lands in the wrong chat.
- Conversations persist to `localStorage` behind a versioned schema, with a migration path from
  every shipped version.
- Failures are classified once and explained in the transcript: transient ones retry with bounded
  backoff, permanent ones offer the retry to the user.
- Every async surface handles six states — empty, loading, streaming, complete, interrupted,
  failed — and colour is never the only signal for any of them.

## Run it

```sh
nvm use                 # Node from .nvmrc
pnpm install
cp .env.example .env.local   # add OPENROUTER_API_KEY
pnpm dev                     # app and the /api/chat proxy, one server
```

Without a key the app still runs; requests fail and the failed state explains why. A user can also
supply their own key (BYOK), which skips the proxy's rate limit but no other cap.

## Commands

```sh
pnpm dev             # Vite dev server, with api/chat.ts mounted at /api/chat
pnpm build           # typecheck, then vite build
pnpm typecheck       # tsc --noEmit
pnpm lint            # ESLint, including the import-boundary and design-system rules
pnpm format          # prettier --check .  (format:write to fix)

pnpm test            # Vitest: unit, integration and component
pnpm test:coverage   # thresholds on core/ and adapter/ (ADR-0005)
pnpm test:e2e        # Playwright journeys
```

## Architecture

Four layers, dependencies point **downward only** — enforced by per-directory `no-restricted-imports`
zones in the ESLint config, so a violation is a lint error rather than a convention.

```
src/ui/       Presentation. React + Chakra. No fetch, no parsing.
src/app/      Lifecycle, cancellation, retry, render scheduling, chat list state.
src/adapter/  fetch, AbortSignal, byte decoding, the localStorage driver.
src/core/     Pure functions. SSE framing, event and error classification, migrations.
api/chat.ts   Serverless proxy. Holds the credential; a security boundary, not a passthrough.
```

`src/core/` has no framework, no I/O and no clock, so everything hard about this product is
testable without mocks or a browser. `api/chat.ts` is a plain `(req, res)` handler: Vercel picks it
up from `api/` by convention, and locally a small Vite plugin mounts the same module — same code
and same variables in both, with no `vercel dev` dependency.

## Testing

| Level       | Where                      | What it proves                                |
| ----------- | -------------------------- | --------------------------------------------- |
| Unit        | `src/core/`                | Correct at every boundary case                |
| Integration | `src/adapter/`, `src/app/` | Streams, cancellation, errors work end to end |
| Component   | `src/ui/`                  | The six states render and announce            |
| E2E         | `e2e/`                     | The product works in a browser                |

The mocked transport reproduces adverse conditions deliberately: one-byte chunks, split
delimiters, keepalives, mid-stream errors, truncated streams. E2E runs against the production
build with `/api/chat` stubbed in the page (ADR-0008) — the free tier is too small, and too
non-deterministic, to drive a test suite.

## Pipeline

Independent jobs, so a failure names its own cause: type check, lint and format, unit tests with
coverage, build, bundle size delta (commented on the pull request), E2E, secret
scan including "no key in build output", and reported-only code and dependency scanning. Docs-only
changes skip the heavy jobs.

Preview deploys on every pull request, production on merge to `main`; version, changelog and tag
come from the commit history. See [docs/deployment.md](docs/deployment.md) for setup and for the
conditions that trigger a rollback.

## Documents

| Doc                                             | Holds                                             |
| ----------------------------------------------- | ------------------------------------------------- |
| [TECHNICAL-DESIGN.md](docs/TECHNICAL-DESIGN.md) | Architecture, features, testing, CI/CD            |
| [DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md)       | Tokens, components, the six states, lint rules    |
| [implement-plan.md](docs/implement-plan.md)     | Phased execution plan with per-phase verification |
| [deployment.md](docs/deployment.md)             | Environments, variables, release, rollback        |
| [repository-setup.md](docs/repository-setup.md) | Labels, branch protection, required checks        |
| [adr/](docs/adr/)                               | Decisions, with the consequences accepted         |
