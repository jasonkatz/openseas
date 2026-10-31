# 0016. Vercel's Git integration builds PR previews; production stays in the pipeline

Status: Accepted. Amends [0014](./0014-cd-pipeline-in-actions.md) for previews only.

## Context

ADR 0014 left both hosts unconnected to the repository because the Vercel team's GitHub
connection was not available to this repo, and gave up PR previews as a result. That connection
now works: a second Vercel project was building previews from the repo, separate from the
`openseas` project that serves production. Two projects meant two sets of env and settings, and
previews that did not match what production builds.

## Decision

The `openseas` Vercel project is connected to the repository. `vercel.json` sets
`git.deploymentEnabled.main` to `false`, so Vercel builds a preview for every other branch and
never deploys `main` itself. Production is unchanged: the Actions pipeline from ADR 0014 deploys
it with `vercel deploy --prebuilt --prod` after the server is healthy.

## Consequences

- One Vercel project holds production and previews, so build settings come from one
  `vercel.json` and env differs only by Vercel environment.
- Preview builds run on Vercel and use Vercel build minutes. Production builds still run in CI.
- Previews talk to the production server. They are for looking at UI; anything that needs the
  server's CORS or auth only works if the preview origin is in `CLIENT_ORIGINS`.
- If the Git integration is disconnected, previews stop and production is unaffected.
