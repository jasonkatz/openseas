# 0013. Continuous deployment through the hosts' Git integrations, verified from CI

Status: Superseded by [0014](./0014-cd-pipeline-in-actions.md)

## Context

ADR 0008 chose Railway and Vercel and said both deploy from `main`, but did not say how. Options:

1. Each host's native GitHub integration builds `main` on push. Vercel previews come free. Railway
   can wait for GitHub checks before deploying.
2. A GitHub Actions workflow deploys with each host's CLI after CI passes. One gate, one log, but
   it needs long-lived deploy tokens as repository secrets, re-implements previews, and duplicates
   build logic the hosts already own.

Either way, a green deploy only proves the build finished, not that the merged commit is what
users reach.

## Decision

Option 1. Railway and Vercel deploy `main` through their Git integrations, with Railway set to
wait for CI and path filters on both so a change to one side does not rebuild the other.

The repo adds a post-merge check instead of a deploy step: the server reports its commit on
`/health` and the client ships a `version.json`; a `Deploy verify` workflow runs after CI
succeeds on `main` and polls both until they serve the merged commit. That check is the
definition of "deployed".

## Consequences

- No deploy credentials live in GitHub. Setup is dashboard clicks, written down in
  `docs/DEPLOY.md`.
- The lists of paths that trigger each build exist in three places (`railway.json`, `vercel.json`,
  `deploy-verify.yml`) and must change together.
- Vercel does not gate on CI. A PR cannot merge with red CI once branch protection is on, so
  `main` is green by construction; the Vercel build itself typechecks the client as a second net.
- If we ever need staged rollouts or a deploy order between server and client, revisit option 2.
