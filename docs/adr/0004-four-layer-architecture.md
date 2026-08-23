# ADR-0004 — Four layers, dependencies downward only

**Status:** Accepted · **Date:** 2026-08-24

## Context

Everything hard about this product is incremental SSE parsing, event and error classification, and
storage migrations. All of it is pure logic. Testing it through a rendered component or a real
network call means mocks, a browser, and tests that assert implementation detail.

## Options

1. **Feature folders.** Each feature owns its own fetching, parsing and rendering.
2. **Four layers with an enforced downward dependency rule.**
3. **Layers as a convention**, documented but not enforced.

## Decision

Four layers — `ui` → `app` → `adapter` → `core` — enforced by per-directory
`no-restricted-imports` zones in the ESLint flat config. A violation is a lint error.

```
src/ui/       Presentation. React + Chakra. No fetch, no parsing.
src/app/      Hooks. Lifecycle, cancellation, render scheduling.
src/adapter/  HTTP, AbortSignal, byte decoding, localStorage driver.
src/core/     Pure functions. Parsing, classification, migrations.
```

`core/` has no framework, no I/O and no clock, so it is unit-testable without a single mock. The
zones also ban `fetch`, `XMLHttpRequest` and `EventSource` in `ui/`, and browser globals, `Date.now`
and `Math.random` in `core/`.

Roughly twenty lines of config. A dedicated boundaries plugin is not worth a dependency for four
directories.

## Consequences accepted

- Some changes touch three files where feature folders would touch one — a new streaming behaviour
  lands in `core`, `app` and `ui` separately.
- The rule is enforced on import specifiers, so it catches the alias (`@/adapter/x`) and the
  relative escape (`../adapter/x`), but not dependency injection that smuggles a layer through a
  parameter. Review covers that; lint does not.
- Coverage thresholds can be meaningful, because the layer they apply to has no I/O to mock
  (ADR-0005).
