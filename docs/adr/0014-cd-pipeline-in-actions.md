# 0014. One Actions pipeline deploys Railway, then Vercel

Status: Accepted. Supersedes [0013](./0013-cd-platform-git-integrations.md).

## Context

ADR 0013 let each host's GitHub integration deploy `main` on push, with a verify job after. Two
things changed:

- The Vercel project has to live on a team whose GitHub connection is not available to this
  repo, so the Vercel Git integration cannot be used at all.
- The two integrations deployed independently. A merge that changes both the protocol and the
  server could put a new client in front of an old server for the length of a Railway build,
  and nothing enforced an order.

## Decision

One `Deploy` workflow in GitHub Actions owns production. It runs after CI succeeds on `main`
(or by hand) and:

1. Deploys the server with the Railway CLI (`railway up`) and waits until `/health` reports the
   new commit. A server that never comes up stops the pipeline.
2. Only then builds the client in CI with `vercel build` and ships it with
   `vercel deploy --prebuilt --prod`, and waits until `/version.json` reports the commit.

Neither host is connected to the repository. Each side is skipped when the commit touched
nothing under it, with a manual override. Deploys serialize through a concurrency group.

## Consequences

- Deploy credentials (a Railway project token and a Vercel token) live in GitHub as secrets, on
  the `production` environment. Rotating them is a GitHub change, not a code change.
- Order and gating are explicit and in one file. Adding a step (a smoke test against the new
  server before the client ships, a migration dry run, a staged rollout) is a job edit.
- The client build runs on the GitHub runner, so Vercel build minutes are not used and the
  deployed artifact is the one CI built.
- Vercel's free PR previews are gone. If we want them back, a CI job can run
  `vercel deploy --prebuilt` without `--prod` on pull requests.
- GitHub Actions is now on the critical path for releases. If Actions is down, the dashboards'
  Redeploy and Promote buttons still work for rollbacks.
