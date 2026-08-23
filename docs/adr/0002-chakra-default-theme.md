# ADR-0002 — Chakra UI default theme, unmodified

**Status:** Accepted · **Date:** 2026-08-24

## Context

The design work here is not inventing values. It is constraining which inherited values get used
and defining the states every async surface must handle (DESIGN-SYSTEM §1).

## Options

1. **Chakra's default theme, used as-is**, with a written list of permitted semantic tokens.
2. **Extend the theme** with product tokens and component recipes.
3. **Headless primitives plus a hand-built token layer** (Radix, Ark UI, Tailwind).

## Decision

Chakra UI v3, pinned at `3.36.1`, default theme, no extension or override (DESIGN-SYSTEM R3).
Components reference semantic tokens only, from the permitted set in DESIGN-SYSTEM §2. R1 (no
colour literals or raw palette scales), R2 (no off-scale pixel values) and R4 (visible focus
indicator) are lint errors, not conventions.

## Consequences accepted

- The product looks like Chakra's defaults. That is the trade: no bespoke visual identity, and no
  theme to maintain, document or keep in sync.
- Anything the default theme cannot express is a design change, not a code change — and needs a
  superseding ADR.
- Pinning an exact patch version means dependency updates are deliberate. `fg.error` and the rest
  of the permitted token set are verified against the pinned version, not assumed.
