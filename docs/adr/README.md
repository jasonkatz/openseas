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
| [0018](./0018-one-experience-and-a-puzzle-harness.md) | The game is one graphical experience; the puzzle practice pages become a separate harness |
| [0019](./0019-boards-package-and-harness-bench.md) | One `boards` package draws for both applications; the harness is a bench around it |
| [0020](./0020-three-js-world-with-boards-over-it.md) | The world is a three.js scene; the PixiJS boards open over it in one frame |
| [0021](./0021-sea-battle-as-the-captains-board.md) | Sea Battle is the captain's board: a turn-commit engine with the brigand inside it |
| [0022](./0022-swordfight-melee-routed-by-the-server.md) | Swordfighting is one board per pirate; the server routes a melee's attacks as vouched moves |
| [0023](./0023-deckhands-in-the-ship-reducer.md) | Deckhands: AI crew live inside the ship reducer and produce output, not play |
| [0024](./0024-ship-boards-handed-back-after-a-missing-move.md) | A ship's board is handed back after a missing move, not thrown out |
| [0025](./0025-crews-in-memory-over-postgres.md) | Crews: a lasting band with a flag, held in memory over Postgres |
| [0026](./0026-linking-keeps-the-accounts-pirate.md) | Linking a guest: a returning account keeps its own pirate, and we retire the guest |
| [0027](./0027-voyage-bench-sails-the-engines-as-the-server-does.md) | The voyage bench sails a ship through the engine's reducers, wired as the server wires them |
| [0028](./0028-standing-is-earned-in-the-game.md) | Standing is earned in the game; the harness records rounds and rates each one's performance |
| [0029](./0029-harness-bilging-plays-a-lone-ships-bilge.md) | The harness plays Bilging against a lone ship's bilge, and a bilge never reads dry |
| [0030](./0030-booty-weighs-what-the-ship-received.md) | Booty weighs what the ship received, and each station has its own turn cap |
| [0031](./0031-shared-puzzle-sprite-atlases.md) | Shared sprite atlases with code-drawn geometry, marks and procedural fallback |
| [0032](./0032-walking-is-cosmetic-and-relayed.md) | Walking is cosmetic: each client paths the same grid, and the server only relays where a pirate walks to |
| [0033](./0033-pirate-look-and-earned-titles.md) | A pirate's look and titles: content ids on the pirate, titles earned once and kept |
| [0034](./0034-space-setting.md) | The game moves to space: a reskin with the mechanics frozen |
| [0035](./0035-no-island-no-boat.md) | No island and no boat: a cratered rock, and a hull that is cut away aboard |
| [0036](./0036-prototype-puzzles.md) | Prototype puzzles: whole engines the server verifies, dealt only on the harness |
| [0037](./0037-prototype-sprite-atlases.md) | Prototype boards draw from sprite atlases through the kit, with the code-drawn art as fallback |
| [0038](./0038-puzzle-guides-site.md) | Puzzle guides: a static site with one guide per puzzle, its pictures captured from the real boards on the harness |
| [0039](./0039-content-loads-puzzle-configs-through-the-wire-schema.md) | Content loads each puzzle's config through the protocol's wire schema |
| [0040](./0040-every-board-runs-through-the-kit.md) | Every board runs through the kit: one host now, the core renderers one board at a time |
| [0041](./0041-marks-are-one-vocabulary-with-one-geometry.md) | Marks are one vocabulary in content, with one geometry and an adapter for each surface |
| [0042](./0042-vouched-moves-named-by-the-engine.md) | Each engine names the moves the server vouches for, and one queue on a board holds them |
| [0043](./0043-errors-name-the-request-they-refuse.md) | A server error names the request it refuses, and the client routes it by that |
