# 0019. One `boards` package draws for both applications; the harness is a bench around it

Status: Accepted. Resolves the question [0018](./0018-one-experience-and-a-puzzle-harness.md) left
open: how the harness and the game share board code. Completes the move [0015](./0015-puzzle-registry.md)
deferred: Bilging's M1 page onto the shared practice frame.

## Context

ADR 0018 split the client in two: the game, one graphical experience, and a puzzle harness that
keeps the practice pages. Both must draw the same boards from the same engines, or a puzzle proven
in the harness is not the puzzle the game ships. The harness also has a job the practice pages
never had: isolating a puzzle under chosen conditions (a seed, a config, a slowed clock), showing
what the engine holds, and proving that a round replays. That is where the owner wants to test
mechanics, and it must be airtight: a lab round that could not have happened on the server tells
us nothing.

## Decision

1. **A `boards` package below both applications.** `@openseas/boards` holds everything the game
   and the harness render with and nothing either owns alone: the five PixiJS renderers and their
   React `Board` hosts, the painted tile, disc, piece and star art, the synthesized sound, the
   content accessor and message lookup, the latency meter, the server connection (HTTP, the socket,
   Better Auth, the pirate provider), the round runner that streams a move log, the tick clock for
   timed engines, and the shared stylesheet. It is presentation and transport. It computes nothing
   the server does not recompute (ADR 0003), reads no content the server does not read, and has no
   page: routes, frames and lifecycles belong to the applications. Both applications import it as
   source (ADR 0012).
2. **The practice frame lives in the harness.** The start card, HUD, legend, result card and the
   practice lifecycle (`usePractice`) move to `packages/harness`, and Bilging's M1 page moves onto
   them, so every puzzle page is the same frame around a different board. The game has no pages
   and no practice frame; until the M3 shell lands it opens on the pirate's card. ADR 0018's rule
   stands: the game never links to the harness.
3. **The round runner keeps time through a clock and keeps its own log.** `PuzzleRound` takes a
   `Clock`. The game and the harness's rated and unrated rounds pass the wall clock and behave
   exactly as before. A lab round passes a `LabClock` the bench can slow, pause and step; the
   round's deadline and the ticks timed engines advance to follow it, while the renderers' own
   animations stay on the wall clock. The runner records every applied move with the engine's
   hash after it, which is the same pair it sends to the server, so what a reviewer sees is what
   the server saw. Engines are untouched: time still reaches them only as ticks in moves (ADR 0015).
4. **A lab round is held to the server's own checks.** Its config is the content config plus a
   set of overrides, and it starts only if the protocol's wire schema and the engine's
   `validateConfig` both accept it: the two checks the server applies to content at startup. Its
   seed is the engine's seed. So any lab round could have been issued by the server with that
   content, and a condition found in the lab is a condition the game can produce. Overrides,
   seed, round length and clock settings are the page's query string, so a scenario is one link.
5. **The bench proves replay, not just play.** When a round ends, the bench replays its log from
   the seed and compares every hash with the recorded one; a round file (seed, config, moves,
   hashes) can be copied out and pasted back, on any machine, and stepped through on the board.
   A `puzzle_round` row from the database is accepted as a round file, with the config taken from
   content as the server took it, so a rejected round can be walked to the move that failed.
6. **The harness is its own Vercel project at `test.openseas.online`**, rooted in
   `packages/harness` with its own `vercel.json`, deployed by the same pipeline after the server,
   previewed per pull request beside the game, and talking to the same server, whose
   `CLIENT_ORIGINS` lists both origins. The game's project is unchanged.

## Consequences

- A board change is one change, seen by both applications; the harness smoke drives every board
  and is where it is proven. The game's smoke covers its shell. CI runs both.
- The game loses its practice routes in this change. Testers practice, and thresholds are
  calibrated, at `test.openseas.online`; the same guest cookie serves both origins, since it is set
  on the server's domain, so a pirate's standing is one standing.
- Rated rounds from the harness still count toward a pirate's standing (ADR 0018). Lab and unrated
  rounds never reach the server and never set a personal best.
- The bench's clock, scenario and review code depends on `PuzzleRound`'s log and clock, which live
  in `boards` so the game can use the tick clock at a station in M3 without carrying the bench.
- Config fields the boards' animation timing is built on (`tickMs`) are shown but locked in the
  bench. Everything else in a config can be changed, within what the server would accept.
- Deploying needs a second Vercel project, a DNS record for the subdomain, two more repository
  variables and the harness origin in the server's `CLIENT_ORIGINS` (`docs/DEPLOY.md`). The Deploy
  pipeline checks the origin and the SPA rewrite after every harness deploy and fails loudly with
  a pointer when either is missing.
