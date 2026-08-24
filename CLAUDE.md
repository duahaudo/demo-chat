# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

**Phases 0-2 landed, plus the adapter from Phase 3.** Repository, toolchain, lint zones, hooks,
CI, ADRs; `src/core/` (SSE framing, event classification, error classification and retry policy,
storage schema and migration harness); `api/chat.ts` (the proxy, mounted locally by a Vite plugin);
and `src/adapter/` (`transport.ts`, `storage.ts`). All under test. `src/ui/` is still a placeholder
shell and `src/app/` is unbuilt — the hooks, render scheduling and conversation-id guard from
Phase 3 remain. `pnpm test:e2e` arrives with its subject in Phase 6.

The three documents in `docs/` are the source of truth, not decoration. Read them before writing
code; they specify behaviour at a level that determines implementation:

| Doc                        | Holds                                                            |
| -------------------------- | ---------------------------------------------------------------- |
| `docs/TECHNICAL-DESIGN.md` | Architecture, features, testing strategy, CI/CD, build order     |
| `docs/DESIGN-SYSTEM.md`    | Tokens, components, the six required states, lint-enforced rules |
| `docs/implement-plan.md`   | Phased execution plan with per-phase verification                |

## Commands

```
pnpm dev             # Vite dev server; will also mount the API proxy at /api/chat (Phase 2)
pnpm typecheck       # tsc --noEmit
pnpm lint            # ESLint (includes import-boundary and design-system rules)
pnpm format          # prettier --check .  (format:write to fix)
pnpm build           # typecheck, then vite build

pnpm test            # Vitest, run once
pnpm test <pattern>  # single file, e.g. pnpm test sse
pnpm test:watch      # Vitest, watching
pnpm test:coverage   # thresholds on core/ and adapter/ only (ADR-0005)
pnpm test:e2e        # Playwright  — added in Phase 6
```

Package manager is pnpm. Node version pinned in `.nvmrc`.

## Architecture

Four layers, dependencies point **downward only**. Enforced by per-directory
`no-restricted-imports` zones in the ESLint flat config — a violation is a lint error, not a
convention.

```
src/ui/       Presentation. React + Chakra. No fetch, no parsing.
src/app/      Hooks. Lifecycle, cancellation, render scheduling.        (unbuilt)
src/adapter/  transport.ts — fetch, AbortSignal, TextDecoderStream, frames out.
              storage.ts   — localStorage driver over core's migrate().
src/core/     Pure functions. Parsing, classification, migrations.
api/chat.ts   Serverless proxy. Holds the credential.
```

`src/core/` has no framework, no I/O and no clock, so it is unit-testable without mocks or a
browser. **Everything hard about this product lives there** — SSE frame buffering, event and error
classification, storage migrations. Coverage thresholds apply to `core/` and `adapter/` only.

### One handler, two mounts

`api/chat.ts` exports a plain `(req, res)` Node handler. Vercel picks it up from `api/` by
convention; locally a small Vite plugin in `vite.config.ts` mounts the same module at `/api/chat`
via `server.middlewares`. Same code and env vars in both environments — do not add a second dev
server or introduce a `vercel dev` dependency.

## Invariants that are easy to break

These are the non-obvious ones. Each is specified, and each has a failure mode that looks like an
unrelated bug.

- **The credential never reaches client code.** Vite inlines any client-visible env value into the
  bundle. `OPENROUTER_API_KEY` is read server-side only, never `VITE_`-prefixed. A CI job greps
  `dist/` for it.
- **The proxy is a security boundary, not a passthrough.** It pins the model, caps `max_tokens`,
  body size and message count, and rate limits by address. Without those it is an open relay
  against the quota. It streams the upstream body through — it does **not** parse SSE.
- **BYOK skips rate limiting only.** A client-supplied `Authorization` header is forwarded instead
  of the server key and the address rate limit is skipped (it is the user's quota); every other cap
  still applies. The user's key is client-side state, never persisted to the storage layer, never
  logged.
- **Never fabricate a frame boundary.** Network reads do not align with SSE frames. The core buffer
  emits only complete frames plus a terminal flush for streams that omit the final delimiter.
- **Deltas flush once per animation frame**, accumulating in a ref — one state update per painted
  frame, not per token. Per-token `setState` makes the composer stop accepting input during fast
  responses.
- **Every delta is matched against the requesting conversation's id** and dropped on mismatch.
  Switching chats mid-stream aborts the request; a late delta must never land in the wrong chat.
- **Partial content is never discarded** — on cancel, on unmount, on error alike.
- **Conversations persist on first message, not on creation**, so abandoned empty chats do not
  accumulate.
- **Every stored document carries a schema version** with a migration path from every shipped
  version. The migration harness exists from v1, when there is nothing to migrate yet.

## Design system rules

Chakra UI v3 default theme, **used unmodified**. Semantic tokens only (see `DESIGN-SYSTEM.md` §2
for the permitted set). R1 (no colour literals or raw palette scales), R2 (no off-scale pixel
values) and R4 (visible focus indicator) are enforced by lint. R3 (do not extend or override the
theme) requires an ADR to change.

Every async surface handles all **six states** — empty, loading, streaming, complete, interrupted,
failed. That list is the review checklist, and it is the unit of UI work: build the states, not the
components. Colour is never the only signal for a state; streaming text is never animated.

## Resolved facts

These were verified against live sources — do not re-research or guess at them:

- **OpenRouter SSE**: `data: {json}` lines, `data: [DONE]` sentinel, `: OPENROUTER PROCESSING`
  keepalive comments, mid-stream errors under HTTP 200 as a top-level `error` field alongside
  `finish_reason: "error"`, cancellation via `AbortController`.
- **Model**: `openrouter/free` — a router selecting a free model per request, filtered by required
  capabilities. This is the "routing endpoint rather than a pinned `:free` slug" the design asks
  for. Fallbacks: `openrouter/auto`, then a pinned slug.
- **Free-tier limits**: 50 requests/day (1,000 with $10 credit), 20 RPM. Too low for real-API E2E —
  E2E runs against a stubbed route.
- **Chakra UI**: pin `3.36.x`. Confirm `fg.error` exists in the pinned version at scaffold time.

## Conventions

- TypeScript `strict` plus `noUncheckedIndexedAccess`.
- Conventional commits, validated by a commit-msg hook and again in CI.
- Trunk-based: short-lived branches, squash merge, branch protection with required checks.
- Pre-commit formats and lints staged files; pre-push type checks. Nothing slower.
- Tests assert behaviour, never implementation detail. The mocked transport reproduces adverse
  conditions deliberately — one-byte chunks, split delimiters, keepalives, mid-stream errors,
  truncated streams.
- Comments are sparse and explain **why**, not what. No doc block on every constant or field, no
  multi-paragraph module essays. Keep rationale, platform quirks, security constraints and ADR
  references; delete anything that restates the code.
- Architectural decisions go in `docs/adr/` with context, options, decision and **consequences
  accepted**.
- Content style: sentence case; buttons name the action ("Send", not "Submit"); errors state what
  happened and what to do, with no apology.
