# ADR-0007 — Hash routing, no router dependency

**Status:** Accepted · **Date:** 2026-08-25

## Context

TECHNICAL-DESIGN §3.1 requires each conversation to be an addressable URL so back and forward
work. The implementation plan named React Router and `/c/:id`.

The application has one route. There are no nested layouts, no loaders, no route-level code
splitting, and no second screen planned for v1.0.

## Options

1. **React Router with `/c/:id`.** A dependency, a provider, and a rewrite rule on the host so a
   deep link to `/c/<id>` does not 404 before the bundle loads.
2. **The URL fragment, `#/c/<id>`.** Two effects in `useConversations`: the fragment follows the
   selection, and a `hashchange` listener moves the selection when the user navigates.
3. **`history.pushState` with a path.** Same rewrite rule as option 1, hand-rolled matching.

## Decision

Option 2. Roughly fifteen lines against a dependency and a hosting rule, for a requirement that is
"back and forward move between chats". The first sync uses `replaceState`, so landing on the app
costs one history entry and the first Back leaves the app rather than appearing to do nothing.

## Consequences accepted

- URLs read `/#/c/<id>`, not `/c/<id>`. Shareable and bookmarkable either way; the fragment is not
  sent to the server, which for a client-only chat list is accurate rather than unfortunate.
- A second screen means either a small matcher here or adopting a router then. The URL shape
  changing at that point is a v1 fragment link breaking, which is acceptable while there is one
  screen and no server-side rendering.
- Routing state lives inside `useConversations` rather than in a route tree, so it is tested with
  the hook, not with a router's test harness.
