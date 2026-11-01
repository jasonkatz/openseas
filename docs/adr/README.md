# Architecture Decision Records

One file per decision, numbered in the order made. Status is one of Proposed, Accepted,
Superseded (with a link to the successor). Never edit an accepted ADR's decision; write a new one
that supersedes it.

| # | Title |
|---|---|
| [0001](./0001-spiritual-successor.md) | Spiritual successor, not a clone |
| [0002](./0002-typescript-monorepo.md) | TypeScript end to end in a pnpm monorepo |
| [0003](./0003-pure-engine-replay-verification.md) | Pure deterministic engine with server replay verification |
| [0004](./0004-pixi-react-client.md) | PixiJS for game surfaces, React for UI |
| [0005](./0005-node-ws-realtime.md) | Node with plain `ws` for realtime, no game framework |
| [0006](./0006-postgres-drizzle.md) | Postgres via Drizzle ORM |
| [0007](./0007-better-auth-guest-first.md) | Better Auth with guest-first anonymous accounts |
| [0008](./0008-railway-vercel-hosting.md) | Railway for server and database, Vercel for client |
| [0009](./0009-world-content-as-files.md) | World content as versioned JSON files, not database rows |
| [0010](./0010-single-ship-acquisition-path.md) | One ship acquisition path to make gating a config change |
| [0011](./0011-puzzles-first-build-order.md) | Puzzles first, each on a solo practice page |
| [0012](./0012-source-exports-tsx-runtime.md) | Workspace packages export TypeScript source; the server runs on tsx |
| [0013](./0013-cd-platform-git-integrations.md) | Continuous deployment through the hosts' Git integrations, verified from CI |
| [0014](./0014-cd-pipeline-in-actions.md) | One Actions pipeline deploys Railway, then Vercel |
| [0015](./0015-puzzle-registry.md) | One puzzle registry drives every engine; timed engines carry their clock in the move log |
| [0016](./0016-ci-built-previews.md) | PR previews are built in CI and deployed to the production Vercel project |
| [0017](./0017-railway-environment-per-pull-request.md) | Every pull request gets its own Railway environment, created from CI |
