## What changed

## Why

## How it was verified

<!-- Commands run, states exercised. For UI work, name which of the six required states
     (DESIGN-SYSTEM §5) this touches: empty, loading, streaming, complete, interrupted, failed. -->

## Checklist

- [ ] Conventional commit messages
- [ ] `pnpm lint && pnpm typecheck && pnpm build` green locally
- [ ] Layer boundaries respected (ui → app → adapter → core)
- [ ] Semantic tokens only; no colour literals, no off-scale pixel values
