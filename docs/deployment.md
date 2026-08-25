# Deployment

Vercel, through its GitHub integration. There is no deploy workflow in `.github/`: the integration
already builds every pull request and every push to `main`, and a workflow duplicating it would be
a second thing to keep in step with the first.

| Environment | Trigger                      | URL                             |
| ----------- | ---------------------------- | ------------------------------- |
| Preview     | Every pull request, per push | Commented on the PR by Vercel   |
| Production  | Merge to `main`              | The project's production domain |

## One-time project setup

1. Import the repository on Vercel. Framework preset **Vite**; build command `pnpm build`, output
   `dist`. `api/chat.ts` is picked up as a function by convention — no `vercel.json`.
2. Add the environment variables, to **all** environments:

   | Name                 | Required | Notes                                                         |
   | -------------------- | -------- | ------------------------------------------------------------- |
   | `OPENROUTER_API_KEY` | Yes      | Server-side only. Never `VITE_`-prefixed (ADR-0003)           |
   | `OPENROUTER_MODEL`   | No       | Overrides the pinned `openrouter/free`; must stay a free slug |

3. Add `OPENROUTER_API_KEY` as a GitHub Actions secret as well. The "No key in build output" scan
   builds with a real key in scope, so that a leak is something the scan can actually observe.

## Version and changelog

`release.yml` runs release-please on every push to `main`. It maintains a release pull request
carrying the next version and the generated `CHANGELOG.md`; merging it publishes the tag. Tags are
never cut by hand, and the version in `package.json` is never edited by hand.

## Rollback

Rollback is redeployment of the previous build — never a revert commit racing a fix forward.

**Roll back immediately, without discussion, when any of these is true on production:**

- The app fails to load, or the transcript does not render.
- `/api/chat` returns 5xx for more than a minute, or streams nothing on a request that should.
- A credential appears in a client response or in the bundle.
- Stored conversations fail to load after a deploy — a migration that corrupts a document is worse
  the longer it runs.

**How:** promote the previous production deployment from the Vercel dashboard, or
`vercel rollback <deployment-url>`. Then open an issue with the deployment id, revert or fix on a
branch, and let the pipeline deploy it forward.

**Do not roll back for:** a single failed request, a rate limit trip, or a cosmetic regression.
Those go through the normal branch and pull request.
