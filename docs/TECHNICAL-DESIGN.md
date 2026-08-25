# Technical Design — Overview

**Product:** OpenRouter chat client · **Author:** Stiger · **v1.0**

> Platform behaviours for Vercel, Vite, Chakra UI and OpenRouter reflect my
> current understanding and are marked _(verify)_ where unconfirmed.

---

## 1. Purpose

A chat client over the OpenRouter API, built to demonstrate production
engineering practice: coding style, unit testing, repository hygiene, GitHub
Actions, and CI/CD.

**Stack:** React + TypeScript, Vite, Chakra UI, deployed on Vercel.

---

## 2. Architecture

Four layers, dependencies point downward only.

```
PRESENTATION   React + Chakra. No fetch, no parsing.
APPLICATION    Hooks. Lifecycle, cancellation, render scheduling.
ADAPTER        HTTP, cancellation signals, byte decoding.
CORE           Pure functions. Parsing, classification, validation.
```

Core has no framework, no I/O, no clock — so it is unit-testable without
mocks or a browser. Everything hard about this product lives there. The
boundary is enforced by an import lint rule.

A single serverless function acts as a proxy and holds the API credential.

---

## 3. Features

### 3.1 Manage chats

Conversations are stored in local browser storage behind a narrow interface.
Each stored document carries a **schema version** with a migration path from
every shipped version.

- Chat list ordered by last activity
- Rename inline, delete with confirmation
- Each conversation is an addressable URL, so back/forward work
- Switching chats mid-stream cancels the request and matches arriving deltas
  against the requesting conversation's id — deltas never land in the wrong chat

### 3.2 Start new chat

Creates an empty conversation, navigates to it, focuses the composer. The
conversation is persisted on first message, not on creation, so abandoned
empty chats do not accumulate.

### 3.3 OpenRouter integration

**Model.** A routing endpoint rather than a pinned `:free` slug — free model
identifiers rotate without notice _(verify current roster)_. A fallback list
is kept.

**Credential.** Vite inlines client-visible env values into the bundle, so any
key referenced from client code is public. The key therefore lives only in the
serverless proxy, in a non-client-exposed variable. The proxy also pins the
model, caps output tokens, caps request size, and rate limits by address —
without those it is an open relay against our quota.

**Streaming.** Server-Sent Events _(verify format)_. Network reads do not
align with protocol frames, so parsing is incremental: a buffer emits only
complete frames, plus a terminal flush for servers that omit the final
delimiter. Handled cases:

| Case                                    | Behaviour                                  |
| --------------------------------------- | ------------------------------------------ |
| Frame or delimiter split across reads   | Buffer; never fabricate a boundary         |
| Carriage return at a read boundary      | Treat as one line break                    |
| Keepalive comment frames                | Ignore, never render                       |
| Malformed payload                       | Emit error event, stream survives          |
| Error mid-stream under HTTP 200         | Classify by code, surface, mark retryable  |
| Stream ends with no completion event    | Flush buffer, mark complete                |
| Multi-byte character split across reads | Streaming decoder reassembles              |
| User cancels                            | Keep partial text, release connection      |
| Component unmounts                      | Cancel request, no write to dead component |

**Render scheduling.** Deltas accumulate in a ref and flush once per animation
frame — one state update per painted frame, not per token. Without this the
composer stops accepting input during fast responses.

**Errors.** Classified once in core: transient (auto-retry, bounded, backoff
with jitter), permanent (manual only), protocol, local, cancelled.

### 3.4 Web search _(v1.1)_

OpenRouter's web plugin _(verify availability)_, toggled per message. Cited
sources render beneath the assistant bubble. Deferred so v1.0 ships complete.

---

## 4. Coding style

- TypeScript strict, including `noUncheckedIndexedAccess`
- ESLint + Prettier, single shared config, no per-file disables without a reason comment
- Import-boundary rule enforcing §2
- Design-system rules: no colour literals, no off-scale pixel values
- Conventional commits, validated by hook and again in CI
- Pre-commit: format and lint staged files. Pre-push: type check. Nothing slower.

---

## 5. Testing

| Level       | Target                                                      | What it proves                                |
| ----------- | ----------------------------------------------------------- | --------------------------------------------- |
| Unit        | Core: parsing, classification, migrations                   | Correct at every boundary case                |
| Integration | Adapter + hooks against a mocked transport                  | Streams, cancellation, errors work end to end |
| Component   | The six UI states                                           | Each renders and announces correctly          |
| E2E         | 3 journeys: create → send → stream → stop → switch → reload | The product works in a browser                |

The mocked transport reproduces adverse conditions deliberately: one-byte
chunks, split delimiters, keepalives, mid-stream errors, truncated streams.

Coverage thresholds apply to core and adapter only. Tests assert behaviour,
never implementation detail.

---

## 6. GitHub

- Trunk-based: short-lived branches, squash merge
- Branch protection on the default branch; required checks must pass
- PR template: what changed, why, how it was verified
- Issues labelled `bug` / `feature` / `tech-debt`, with a few open `tech-debt`
  items carrying my own reasoning
- `docs/adr/` holds the decision records:

| #    | Decision                                                     |
| ---- | ------------------------------------------------------------ |
| 0001 | Vite + React rather than a meta-framework                    |
| 0002 | Chakra UI default theme, unmodified                          |
| 0003 | Credential in a serverless proxy; BYOK as an option          |
| 0009 | BYOK dropped; the proxy holds the only credential            |
| 0004 | Four-layer architecture with a downward-only dependency rule |
| 0005 | Coverage thresholds on core and adapter only                 |
| 0006 | Local persistence with schema versioning from v1.0           |

Each record states context, options, decision, and **consequences accepted**.

---

## 7. GitHub Actions

Independent parallel jobs so a failure names its own cause.

| Job                                             | Blocking |
| ----------------------------------------------- | -------- |
| Type check                                      | Yes      |
| Lint and format                                 | Yes      |
| Unit + integration tests, with coverage         | Yes      |
| Build                                           | Yes      |
| Bundle size delta, commented on the PR          | Yes      |
| E2E against the preview deployment              | Yes      |
| Secret scan, including "no key in build output" | Yes      |
| Code scanning                                   | Reported |

Dependency and browser caching. Path filters so docs-only changes skip heavy
jobs. Shared setup extracted into a reusable workflow rather than copied.

---

## 8. CI/CD

| Environment | Trigger                            |
| ----------- | ---------------------------------- |
| Preview     | Every pull request — E2E runs here |
| Production  | Merge to default branch            |

Version and changelog generated from commit history. Tags produced by the
pipeline, never by hand. Rollback is redeployment of the previous build, with
the trigger conditions written down in advance.

**Budgets enforced in the pipeline:** initial JS size threshold set at the
first green build, regressions blocked.

---

## 9. Build order

Risk first — if the parsing model is wrong, everything above it is rework.

1. Core parsing and event classification, with tests
2. Proxy with validation, limits, and the credential decision
3. Adapter and application layers
4. Presentation with all six states
5. Chat management and persistence with versioning
6. Pipeline, budgets, and gates
7. ADRs and README, consolidated
