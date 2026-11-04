# 0020. The world is a three.js scene; the PixiJS boards open over it in one frame

Status: Accepted. Resolves the two questions [0018](./0018-one-experience-and-a-puzzle-harness.md)
left open: the renderer for the unified scene, and how a board is embedded in the ship view.

## Context

ADR 0018 made the game one continuous graphical experience: the overworld is home, islands and
their buildings are the menus, the ship is a view inside the same scene, and the puzzle boards open
at a station without leaving it. Two renderers were already in hand. The five duty boards are
PixiJS v8 renderers shared with the harness (ADR 0019), tuned over two milestones for touch and
feel, and must not be rewritten. The first M3 pass drew an isometric chart with three.js, as a
diorama of primitives with a wave shader, and it read as a place rather than a map.

Three ways to one scene were weighed: draw the world in PixiJS too, draw the boards in three.js
too, or keep both renderers and compose them in one frame.

## Decision

1. **The world is one three.js scene that fills the viewport for the whole session.** It holds
   the sea, the islands with their buildings and landmarks, the sea lanes, every ship with a crew
   aboard, and the deck of the ship the pirate is on. An isometric orthographic camera glides
   between three kinds of focus: one island (home, filling the frame), one ship it follows along
   its lane (closer, the deck filling the frame), and the whole ocean behind a map button. There
   are no pages: a place is a camera target plus a card, folded to a strip until it is wanted. The scene computes nothing:
   it draws content and server snapshots (ADR 0003).
2. **The boards stay PixiJS and open in a layer over the world.** A station's board is the same
   `boards` component the harness drives, mounted in a station layer that covers the scene while
   the scene dims and keeps following the ship beneath. A slim HUD above the board carries the
   ship's vitals and the turn clock, so a pirate pumping sees the water drop. Closing the layer
   returns to the deck. The two renderers never share a canvas; the DOM composes them.
3. **Tappable things in the world are DOM spots projected onto the geometry.** Island names,
   building spots (dock, tavern, notice board) and station spots on the deck are HTML buttons
   positioned each frame from the 3D anchors, so they are reachable by touch, by keyboard and by
   tests, and read the same without WebGL. Ray-picking on islands and ships is a shortcut, not the
   only way: every spot has a twin in the place's card.
4. **Places are URLs.** `/`, `/island/:id[/dock|tavern|notice]`, `/ship`, `/ship/:station` and
   `/ship/helm` mirror the place; opening one lands in the scene there. The server's truth wins
   over the URL: boarding moves the place to the deck, going ashore moves it to the island.
5. **The server owns the ship.** The ship reducer runs only on the server, on a turn clock; the
   client renders snapshots and eases the ship along its lane between them. Duty boards are rated
   rounds bound to a station; the server takes each board's points at every turn and cuts a board
   short when its pirate stands down, docks or drops (DESIGN.md 3.4).

## Consequences

- `three` is a dependency of the game only. The harness and `boards` never load it; the scene
  module is imported on demand after sign-in.
- A software renderer (a headless browser, a machine without a GPU) gets a lighter world: no
  shadows, one pixel per pixel, a coarser sea. Without WebGL at all, the cards still carry every
  action, and the shell's smoke test is written against those cards and a fake server, so CI
  needs no GPU and no database to walk from the chart to a board and back.
- The world's art is primitives and flat color (DESIGN.md 3.10). An art pass replaces models, not
  the scene's structure.
- Content grew an `ocean.json` (the start island and the ship's rules), a `landmark` and a blurb
  per island, and a `parScore` per duty puzzle that scales a board's points into a station's
  output (DESIGN.md 3.4). All are files, validated at startup (ADR 0009).
- Chat and island presence are in-memory rooms (ADR 0005), ephemeral in v1.
