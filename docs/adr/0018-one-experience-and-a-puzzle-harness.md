# 0018. The game is one graphical experience; the puzzle practice pages become a separate harness

Status: Accepted. Amends [0011](./0011-puzzles-first-build-order.md) (where a proven puzzle
lives after its practice page) and [0004](./0004-pixi-react-client.md) (where the UI lives).

## Context

M1 and M2 built each duty puzzle as a practice page: a React page with a start card, a HUD, a
legend and a result card, playable solo, rated by the server. That was the right way to prove
the engines, the replay pipeline, the ratings and the feel of each puzzle (ADR 0011), and the
tester sessions depend on it.

The first pass at M3 (pull requests #24 and #25, closed unmerged) put the ship on the same
structure: a ship page, a notice board page, a chart page, a home page of links, and the puzzle
boards reused inside the ship page. It worked end to end, and it felt wrong. The game read as the
puzzle test harness with ship pages bolted on. Going from the chart to the ship to a station to a
board was page navigation, not play. Two different jobs were being served by one application:
testing puzzles in isolation, and playing the game.

## Decision

1. **The game is one continuous graphical experience.** It opens on the overworld and never
   leaves it for a page. Islands and their buildings, the notice board, the tavern, the dock, the
   ship, its stations, menus, settings and the puzzle boards are all embedded in one scene and one
   frame. Navigation is in-world and diegetic wherever it can be (go to the dock, step aboard, take
   a station) and a single consistent in-scene menu where it cannot (settings, account, leaving a
   ship). A puzzle board opens inside the ship view, at its station, with the ship's state around
   it, and closes back into the ship. A URL may deep-link to a place; the frame does not change.
   What this looks like is described in DESIGN.md 3.11.
2. **A separate application, the puzzle harness, keeps the practice pages.** One route per
   engine with rated and unrated rounds, the HUD, the legend, the result card, the accessibility
   settings and the Playwright smoke, as built in M1 and M2. It is a developer and tester tool: it
   proves engines, the replay pipeline and ratings in isolation, and it is where thresholds are
   calibrated with testers. It is not part of the game and is not linked from it. It is its own
   package, deployed beside the game, talking to the same server.
3. **Nothing below the client belongs to either application.** `engine`, `protocol`, `content`
   and `server` serve both. The ship reducer, the duty binding, the ship rooms and the chart scene
   from the first M3 pass are reusable as they are; the page structure around them is not.

Left open, each for its own ADR when it is built: the renderer for the unified scene (the world
in three.js with PixiJS boards layered over it, or one renderer for both), how a board is
embedded in the ship view, and how the harness and the game share board code.

## Consequences

- M3 is restarted with a new definition (DESIGN.md 5.2): the shell first, then the ship in it.
  The first pass stays on its branches (`claude/m3-ship-voyage`, `claude/m3-overworld`) as
  reference and as parts.
- The client package becomes the game. A `harness` package takes the practice pages and their
  smoke test. CI typechecks, tests and smokes both; previews build both.
- ADR 0011's rule still holds for every puzzle to come: Sea Battle and Swordfighting are proven on
  a harness page first, then embedded in the game.
- Harness rounds go through the same rated sessions as before, so the replay pipeline is
  exercised end to end. Whether they keep counting toward a pirate's standing is decided when the
  game has its own in-world practice (DESIGN.md 3.11); until then they do.
- Reviewers judge the game by playing one continuous session on a phone, from the chart to a
  board and back, and judge a puzzle change in the harness.
