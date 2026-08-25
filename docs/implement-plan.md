# Implementation Plan

**Product:** OpenRouter chat client · **v1.0**

Executes [TECHNICAL-DESIGN.md](./TECHNICAL-DESIGN.md) and
[DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md). Section references (§) point at those.

---

## 1. Context

The repository holds specs and no code. The product is a React + TypeScript + Vite + Chakra UI
chat client over OpenRouter, built to demonstrate production engineering practice
(TECHNICAL-DESIGN §1): layering, unit testing, repository hygiene, GitHub Actions, CI/CD.

Three decisions reshape the build order in TECHNICAL-DESIGN §9:

| Decision         | Choice                        | Effect                                                           |
| ---------------- | ----------------------------- | ---------------------------------------------------------------- |
| First-pass scope | Pipeline and hygiene first    | Scaffolding, lint/format/hooks, CI and ADRs land before app code |
| Credential       | Proxy only                    | BYOK shipped without a UI and was removed (ADR-0009)             |
| Environment      | Localhost first, Vercel later | The proxy must run under `vite dev` without `vercel dev`         |

The third is the only real design pressure. Everything else is the specs executed as written.

---

## 2. Resolved `(verify)` items

The specs flag four unknowns. All four were checked before planning.

**SSE format** — confirmed. `data: {json}` lines, a `data: [DONE]` sentinel,
`: OPENROUTER PROCESSING` keepalive comment frames, mid-stream errors under HTTP 200 delivered as
a top-level `error` field in a frame alongside `finish_reason: "error"`, and cancellation via
`AbortController`. Every row of §3.3's table is a real condition, not a hypothetical.

**Routing model** — `openrouter/free` exists: a router that selects a free model per request and
filters for models supporting the capabilities the request needs. This is the "routing endpoint
rather than a pinned `:free` slug" §3.3 asks for. Fallback list: `openrouter/auto`, then one
pinned slug.

**Free-tier limits** — 50 requests/day (1,000 once $10 of credit is added), 20 RPM. Low enough
that the proxy's own rate limiting and the mocked transport in §5 are load-bearing, not optional.

**Chakra UI** — current release is `3.36.1`; pin it. The token names in DESIGN-SYSTEM §2 match v3
defaults. Confirm `fg.error` against the pinned version at scaffold time and adjust the lint
allowlist if it differs.

---

## 3. Architecture note: one handler, two mounts

`api/chat.ts` exports a plain `(req, res)` Node handler.

- **Vercel** picks it up from `api/` by convention, with no configuration.
- **Locally**, a small Vite plugin in `vite.config.ts` mounts the same module at `/api/chat` via
  `server.middlewares`.

Same code, same environment variables, both environments. No `vercel dev` dependency for local
work, no second Express dev server, and no drift between what runs locally and what deploys. This
is what makes "localhost first, Vercel later" cost nothing at the Vercel step.

---

## 4. Phase 0 — Repository and pipeline

Several §7 jobs have no subject until later phases. Land the jobs that pass green on a scaffold
and add the rest alongside the code they guard, so the default branch is never knowingly red.

1. `git init`; Node pinned via `.nvmrc`; `pnpm`, with the lockfile in the CI cache key.
2. Vite React + TS template. Add `@chakra-ui/react` `3.36.x` and `next-themes`; `Provider` with
   `defaultSystem`. No custom theme (DESIGN-SYSTEM R3).
3. TypeScript `strict` plus `noUncheckedIndexedAccess` (§4). Enable it now — retrofitting it over
   a written parser is hours of churn.
4. ESLint flat config and Prettier, one shared config:
   - **Import boundary** (§2, ADR-0004): per-directory `no-restricted-imports` zones in flat-config
     overrides. `core/` imports nothing local; `adapter/` may import `core/`; `app/` may import
     `adapter/` and `core/`; `ui/` imports downward but never calls `fetch`. Roughly twenty lines
     of config — a dedicated boundaries plugin is not worth a dependency for four directories.
   - **Design rules R1 and R2**: `no-restricted-syntax` matching colour literals (`#hex`, `rgb(`)
     and off-scale `px` values in JSX style props. R4 via `eslint-plugin-jsx-a11y`.
5. Husky, lint-staged and commitlint. Pre-commit formats and lints staged files; pre-push type
   checks; commit-msg validates conventional commits. Nothing slower (§4).
6. `.github/workflows/`: a reusable setup workflow (checkout, node, pnpm cache) called by
   independent jobs. **Type check, lint and format, build, secret scan** now; **tests with
   coverage, bundle budget and E2E** appended in Phases 1 and 6 as their subjects
   appear. Path filters so docs-only changes skip heavy jobs.
7. `docs/adr/0001`–`0006` from §6's table, each stating context, options, decision and
   consequences accepted.
8. PR template, issue labels, branch protection with required checks.

**Files:** `package.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc`, `vite.config.ts`,
`.husky/*`, `commitlint.config.js`, `.github/workflows/*.yml`, `docs/adr/*.md`.

---

## 5. Phase 1 — Core (`src/core/`)

Risk first (§9). Pure functions: no framework, no I/O, no clock. The product's difficulty lives
here, and it is testable without a browser or a single mock.

- **`sse.ts`** — `createSseBuffer()` with `push(chunk) => Frame[]` and `flush() => Frame[]`.
  Handles a frame or delimiter split across reads, a carriage return at a read boundary treated as
  one line break, comment frames emitted as a distinct kind, and a terminal flush for a stream
  that ends without its final delimiter. Never fabricates a boundary.
- **`events.ts`** — `classifyEvent(frame)` returning `delta | done | keepalive | error | malformed`.
  Covers the `[DONE]` sentinel, a top-level `error` field, and `finish_reason: "error"`. Malformed
  JSON emits an error event and the stream survives.
- **`errors.ts`** — `classifyError` returning `transient` (auto-retry, bounded, backoff with
  jitter), `permanent`, `protocol`, `local` or `cancelled`. Boundaries: `408`, `429` and `504`
  transient; `500` transient once; other `4xx` permanent.
- **`storage/migrate.ts`** — a versioned document plus `migrate(doc)` walking every shipped
  version forward. The v1 schema and the migration harness; the harness is the point, not the
  single version.

**Tests** (Vitest, colocated `*.test.ts`): every row of §3.3's table, driven by feeding the buffer
one byte at a time and at random split points — split tolerance is the entire reason this layer is
pure. Multi-byte characters split across reads are the adapter's `TextDecoder` concern and are
asserted in Phase 2. Coverage thresholds apply here and to the adapter only (ADR-0005).

---

## 6. Phase 2 — Proxy (`api/chat.ts`)

The handler is the security boundary. Vite inlines any client-visible environment value into the
bundle, so the key lives only in a non-`VITE_`-prefixed variable read server-side
(`OPENROUTER_API_KEY` in `.env.local`, gitignored).

Handler responsibilities, all load-bearing (§3.3):

- Pin the model to `openrouter/free` with a fallback list. Never accept a model from the client.
- Cap `max_tokens`, cap request body size, cap message count.
- Rate limit by address.
  `// TODO(scale): in-memory Map, resets on cold start; move to a KV store if abuse appears`
- Reject anything unexpected before it reaches OpenRouter. Without these caps the endpoint is an
  open relay against our quota.
- Stream the upstream response body straight through. The proxy does not parse SSE.

**Local mount.** The Vite plugin from §3 above. Verify with
`curl -N localhost:5173/api/chat` against the real key — the first genuinely end-to-end moment.

---

## 7. Phase 3 — Adapter and application

- **`src/adapter/transport.ts`** — `fetch` with an `AbortSignal`; the response body through
  `TextDecoderStream`, where multi-byte characters split across reads reassemble; bytes into the
  core buffer; frames out as an async iterable. No parsing logic of its own.
- **`src/app/useChatStream.ts`** — lifecycle, cancellation, retry with jittered backoff, and
  render scheduling: deltas accumulate in a ref and flush once per `requestAnimationFrame`. One
  state update per painted frame, not per token. Without this the composer stops accepting input
  during fast responses (§3.3).
- **Conversation-id guard** — every arriving delta is matched against the requesting
  conversation's id and dropped if it does not match. Switching chats mid-stream aborts the
  request, and a late delta never lands in the wrong chat (§3.1). Test this explicitly; it is the
  subtlest bug in the specification.
- Unmount aborts the request and writes nothing to a dead component.

**Tests:** integration against a mocked transport that reproduces adverse conditions deliberately
(§5) — one-byte chunks, split delimiters, keepalives, a mid-stream error under HTTP 200, a
truncated stream, and cancellation mid-delta.

---

## 8. Phase 4 — Presentation (`src/ui/`)

Chakra v3, semantic tokens only. The unit of work is the **six states** (DESIGN-SYSTEM §5) —
empty, loading, streaming, complete, interrupted, failed — not the components.

- **ChatListItem** — rows are links, because chats are addressable URLs. Five states including the
  accent streaming dot. Colour is never the only signal (R5).
- **MessageBubble** — user right-aligned in `colorPalette.solid`; assistant left-aligned in
  `bg.subtle` with a border. Around 75% max width, whitespace preserved, long strings wrap.
- **Composer** — auto-growing textarea, capped then scrolls. Enter sends, Shift+Enter inserts a
  newline, Escape stops. Send becomes Stop while streaming. A disabled control always states why.
- Streaming text sits in a polite live region only while streaming; the caret does not blink under
  `prefers-reduced-motion`; streaming text is never animated (R6).
- Partial content is never discarded, on stop and on failure alike.

**Tests:** component tests asserting that each of the six states renders _and announces_ correctly.

---

## 9. Phase 5 — Chat management and persistence

- `src/core/storage/` holds the document schema behind a narrow interface; the `localStorage`
  driver lives in the adapter. The migration path from every shipped version is already harnessed
  from Phase 1.
- Chat list ordered by last activity; inline rename; delete with confirmation.
- React Router, `/c/:id` per conversation, so back and forward work.
- New chat creates in memory, navigates and focuses the composer. Persisted on first message, not
  on creation, so abandoned empty chats do not accumulate (§3.2).

---

## 10. Phase 6 — Gates, budgets, deployment

The deferred CI jobs now have subjects.

- Playwright E2E, three journeys: create → send → stream → stop → switch → reload, against a
  stubbed route. Free-tier limits make real-API E2E unreliable.
- Bundle size budget: the gzipped delta against the base branch, commented on the PR.
- Secret scan extended with an explicit "no key in build output" check over `dist/`.
- Vercel project: preview on every pull request, where E2E runs; production on
  merge to the default branch. Version and changelog generated from commit history; tags produced
  by the pipeline, never by hand. Rollback is redeployment of the previous build, with trigger
  conditions written down in advance.
- Consolidate the README; open a few `tech-debt` issues carrying real reasoning (§6).

---

## 11. Verification

| Phase | Check                                                                                                                                                                  |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | `pnpm lint && pnpm typecheck && pnpm build` green; a deliberately malformed commit message is rejected by the hook; a `ui/` file importing `fetch` fails lint          |
| 1     | `pnpm test` green with byte-at-a-time and random-split-point feeds; coverage threshold met                                                                             |
| 2     | `curl -N localhost:5173/api/chat` streams real tokens against the real key; an oversized body is rejected; the rate limit trips                                        |
| 3     | Mocked-transport integration suite green; the composer stays responsive during a fast response; switching chat mid-stream leaves zero deltas in the wrong conversation |
| 4     | Each of the six states renders and announces; full keyboard path new chat → select → compose → send → stop                                                             |
| 5     | Reload preserves conversations; a hand-written prior-version document migrates forward; back and forward navigate chats                                                |
| 6     | E2E journeys green against the preview deployment; no key found in `dist/`                                                                                             |

---

## 12. Out of scope for v1.0

| Item                        | Reason                                                                    |
| --------------------------- | ------------------------------------------------------------------------- |
| Web search (§3.4)           | Deferred to v1.1 by the specification itself, so v1.0 ships complete      |
| Custom Chakra theme         | R3 forbids it without an ADR                                              |
| Persistent rate-limit store | In-memory Map, marked with its ceiling; add a KV store when abuse appears |
