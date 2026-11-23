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
| [0039](./0039-five-tiers-and-a-live-pace.md) | Five tiers, and every board's HUD shows the tier being played at |
| [0040](./0040-generated-art-and-sound-from-briefs.md) | Puzzle sprites and sounds are generated from briefs in the repository; the owner picks every take |
| [0041](./0041-sampled-sounds-over-synthesized-cues.md) | A board plays its puzzle's picked samples, with the synthesized cues as the fallback |
| [0042](./0042-the-harness-becomes-the-puzzle-studio.md) | The harness becomes the puzzle studio: live tuning, an agent on a worktree, and tester links |
| [0043](./0043-the-studio-service-starts-with-tester-links.md) | The studio's service starts with tester links: a signed cookie, a schema of its own, and no agent yet |
| [0044](./0044-the-studio-lives-at-studio-openseas-online.md) | The studio lives at studio.openseas.online |
| [0045](./0045-drafts-are-kept-by-the-studio-service.md) | Drafts are kept by the studio's service, and an address's numbers are never saved unasked |
| [0046](./0046-save-writes-a-drafts-numbers-to-a-pull-request.md) | Save writes a draft's numbers to a branch and a draft pull request, with no agent |
| [0047](./0047-the-chat-runs-an-agent-the-service-holds-to-the-puzzle.md) | The chat runs an agent as its own user, behind the service's proxy, under one spend cap |
| [0048](./0048-services-run-under-tini-and-shut-down-within-a-deadline.md) | The services run under tini, and shut down within a deadline |
| [0049](./0049-save-ends-at-the-draft-pull-request.md) | Save ends at the draft pull request: the checklist is a developer's to finish |
| [0050](./0050-a-frame-or-a-cue-can-be-swapped-on-a-running-board.md) | A frame or a cue can be swapped on a running board, and the studio lists every one |
| [0051](./0051-takes-are-kept-in-a-railway-bucket-by-their-hash.md) | Takes are kept in a Railway bucket under their hash, in the form they would be committed in |
| [0052](./0052-a-pick-is-the-drafts-and-a-tester-link-carries-it.md) | A pick is the draft's: kept with its numbers, frozen in a tester link, and loaded by `/play` |
| [0053](./0053-a-picked-frame-ships-as-its-own-image-and-save-places-picks.md) | A picked frame ships as its own image over the atlas, and Save places a draft's picks as their takes' bytes |
| [0054](./0054-each-frame-is-a-file-and-the-build-packs-the-atlas.md) | Each frame is a file of its own, and the build packs every puzzle's atlas |
| [0055](./0055-the-chat-is-told-as-it-happens.md) | The chat is told as it happens: a stream over the rows, replies read as markdown, and a turn that fails says why |
| [0056](./0056-the-studio-is-laid-out-as-a-design-tool.md) | The studio's page is laid out as a design tool: a top bar, a rail of modes, one panel |
| [0057](./0057-a-draft-rewrites-its-puzzles-strings.md) | The studio's Text mode: a draft rewrites its puzzle's strings, and a puzzle has a category |
| [0058](./0058-the-studios-chrome-has-a-look-of-its-own.md) | The studio's chrome has a look of its own: floating panels, teal for what acts, amber for what changed |
| [0059](./0059-the-meter-counts-what-each-api-billed.md) | The meter counts what each API says it billed, and the generation scripts go through the proxy |
| [0060](./0060-a-draft-has-many-chats-and-a-chat-outlasts-its-draft.md) | A draft has many chats, a chat outlasts its draft, and the page lists them |
| [0061](./0061-the-game-looks-lo-fi-and-minimalist-by-a-brand-book.md) | The game looks lo-fi and minimalist, by a brand book: one palette, one typeface, no frame, no marks |
| [0062](./0062-pieces-are-drawn-in-code-and-cues-stay-synthesized.md) | Pieces are drawn in code and cues stay synthesized: the generated sprites and sounds retire |
| [0063](./0063-stored-sprite-picks-and-takes-are-read-and-ignored.md) | Stored sprite picks and sprite takes are kept, read and ignored |
| [0064](./0064-stored-sound-picks-and-takes-are-read-and-ignored-and-the-beats-sound-stands-alone.md) | Stored sound picks and takes are kept, read and ignored, and the beat's sound stands alone |
| [0065](./0065-pieces-and-cues-are-data-the-studio-edits.md) | Pieces and cues are data the studio edits: a Sprites editor, a Sounds editor, and Save writes both |
| [0066](./0066-a-puzzle-is-learned-on-a-ladder-of-stages.md) | A puzzle is learned on a ladder of stages, forward only, and only the whole puzzle counts |
| [0067](./0067-the-bots-live-in-the-repository.md) | The bots live in the repository and play any prototype through one seam, printing its ladder table |
| [0068](./0068-the-board-plays-from-every-mode-and-a-panel-can-open-wide.md) | The board plays from every mode on a transport bar, and a mode's panel can open wide over the middle |
| [0069](./0069-rating-is-a-mode-of-its-own.md) | Rating is a mode of its own, beside Scoring |
| [0070](./0070-each-puzzle-has-its-own-copy-of-its-cues.md) | Each puzzle has its own copy of its cues; the beat stays the game's alone |
| [0071](./0071-the-beat-is-each-puzzles-own-too.md) | The beat is each puzzle's own too; its pulse stays the same on every board |
| [0072](./0072-a-round-keeps-one-difficulty-and-the-stage-sets-it.md) | A round keeps one difficulty, and the stage sets it: no ramp within a round |
| [0073](./0073-motion-is-the-skins-and-the-puzzle-names-its-moment.md) | Motion is the skin's, and the puzzle names its moment: events carry board changes, and the board settles before the next touch |
| [0074](./0074-a-stage-only-switches-layers.md) | A stage only switches layers: its round length, settings and tier starts are the whole puzzle's |
| [0075](./0075-a-puzzle-declares-its-deal.md) | A puzzle declares its deal: draws on streams of their own, checks that always pass, and secrets |
| [0076](./0076-stand-ins-are-four-types-on-two-dials.md) | Stand-ins are four types on two dials, the same for every puzzle |
