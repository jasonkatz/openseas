# 0017. Every pull request gets its own Railway environment, created from CI

Status: Accepted. Amends [0016](./0016-ci-built-previews.md) and the preview consequence of
[0008](./0008-railway-vercel-hosting.md).

## Context

ADR 0016 brought back client previews, but they talk to the production server, which only accepts
the production client's origin. A preview could show UI and nothing else: no guest account, no
rated round, no result. Reviewing a server or protocol change meant running it locally.

Railway can run many environments of one project, each with its own copy of every service, and its
CLI can create one by duplicating another. Railway's own pull request environments need the
repository connected to the project, which ADR 0014 ruled out: nothing deploys outside the
Actions pipeline. Options:

1. Keep client-only previews and add the preview origins to production's `CLIENT_ORIGINS`.
   Previews would then write to the production database with unreviewed code.
2. One shared staging environment that every open PR deploys to in turn. Cheap, but two open PRs
   overwrite each other and its database accumulates every schema experiment.
3. One Railway environment per pull request, duplicated from production by the Preview workflow,
   with the client preview built against it. Isolated, disposable, and the client preview becomes
   a working game.

## Decision

Option 3. The `Preview` workflow runs for every pull request that touches a package or the build
configuration and:

1. Creates a Railway environment `pr-<number>` by duplicating `production` if it does not exist.
   The duplicate has its own server service and its own Postgres with a fresh volume, so the
   database starts empty and the server's migrations build the schema on first boot. It gets its
   own `BETTER_AUTH_SECRET`.
2. Uploads the PR's commit into it with `railway up`, after setting `CLIENT_ORIGINS` to the
   client's address below, and waits until `/health` reports the commit.
3. Builds the client with `VITE_SERVER_URL` pointing at that server, deploys it as a Vercel
   preview (ADR 0016), and aliases it to a stable `<prefix>-<number>.vercel.app`. The alias is
   what makes the server's `CLIENT_ORIGINS` knowable before the client deploys.
4. Keeps one PR comment updated with both URLs.

A `Preview cleanup` workflow deletes the environment and the alias when the PR closes, and sweeps
daily for `pr-*` environments whose PR is closed, for the case where the close event was missed.

The workflow authenticates with a Railway workspace token, not the production project token the
Deploy pipeline uses: project tokens are scoped to one environment and cannot create others.

## Consequences

- Reviewers open a PR's client and play against that PR's server and database. Server and
  protocol changes can be tried before merge without a local setup.
- Every open code PR costs a running server and a Postgres on Railway until it closes. Previews
  are short-lived by construction; the daily sweep bounds the damage of a missed close. A PR
  that touches only docs gets nothing.
- The preview database is empty and disposable. Nothing seeds it; a reviewer starts as a new
  guest. Anything that needs fixture data is a later addition to this workflow.
- The Railway workspace token in GitHub can reach every project in the workspace. It is
  repository-scoped so pull request runs can read it, which is why fork PRs (which get no
  secrets) skip the server preview and fall back to the ADR 0016 behaviour.
- Production is duplicated, so a new production variable or service setting is picked up by the
  next new preview environment automatically; existing `pr-*` environments keep what they copied.
- The client preview still sits behind Vercel's deployment protection; the server's `/health` and
  API are public, as production's are. Previews share production's third-party OAuth app
  settings, so social sign-in redirects will not work from a preview; guest accounts do.
