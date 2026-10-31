# 0016. PR previews are built in CI and deployed to the production Vercel project

Status: Accepted. Amends [0014](./0014-cd-pipeline-in-actions.md), which gave previews up.

## Context

ADR 0014 dropped PR previews when production moved to an Actions pipeline, and noted they could
come back as a CI job. Meanwhile a second Vercel project was building previews from the repo,
separate from the `openseas` project that serves production, so previews used different settings
and env from what production builds.

Vercel's Git integration cannot be connected to `openseas`: the owner's GitHub account is already
linked to a different Vercel account.

## Decision

A `Preview` workflow runs on pull requests that touch the client or anything it depends on. It
pulls the `openseas` project's Preview env, builds with `vercel build` on the runner, deploys with
`vercel deploy --prebuilt` (not `--prod`), and keeps one PR comment updated with the URL. It uses
the same token and project ID as the Deploy pipeline. Neither host is connected to the
repository; the separate preview project is deleted.

## Consequences

- One Vercel project holds production and previews. Build settings come from one `vercel.json`;
  env differs only by Vercel environment.
- Preview builds run on GitHub runners, like production, so Vercel build minutes are not used.
- The Vercel secrets must be repository-scoped so pull request runs can read them. Fork PRs get
  no secrets and skip the preview.
- Previews talk to the production server. They are for looking at UI; anything that needs the
  server's CORS or auth works only if the preview origin is in `CLIENT_ORIGINS`.
- No Vercel PR status checks or toolbar on previews; the PR comment is the link.
