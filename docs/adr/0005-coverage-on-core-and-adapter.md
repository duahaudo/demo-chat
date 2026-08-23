# ADR-0005 — Coverage thresholds on core and adapter only

**Status:** Accepted · **Date:** 2026-08-24

## Context

A single repository-wide coverage number is dominated by whichever layer has the most lines. Here
that is presentation, where a high number mostly proves that components render — while the SSE
buffer, where the real defects live, disappears into the average.

## Options

1. **One global threshold.**
2. **No thresholds**, tests judged in review.
3. **Thresholds scoped to `core/` and `adapter/`.**

## Decision

Option 3. Coverage thresholds apply to `src/core/` and `src/adapter/` only. The UI is covered by
component tests asserting that each of the six required states renders _and announces_ correctly
(DESIGN-SYSTEM §5) — a checklist, not a percentage.

Tests assert behaviour, never implementation detail. The mocked transport reproduces adverse
conditions deliberately: one-byte chunks, split delimiters, keepalives, mid-stream errors under
HTTP 200, truncated streams.

## Consequences accepted

- Presentation can regress without the coverage gate noticing. The six-state checklist and the E2E
  journeys carry that weight instead.
- The threshold is a floor for the layers where it means something, not a target to farm.
- If logic migrates upward into hooks without a matching test, coverage will not catch it. The
  import-boundary rule makes that migration visible in review (ADR-0004).
