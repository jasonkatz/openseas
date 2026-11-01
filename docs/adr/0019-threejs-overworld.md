# 0019. The overworld is an isometric three.js diorama; PixiJS keeps the boards

Status: Accepted. Amends [0004](./0004-pixi-react-client.md), which gave every game surface to PixiJS.

## Context

M3 put ships on the sea, and the first ship page showed a voyage as a progress bar. The ocean
chart (islands, sea lanes, ships under way) is the one surface where the game's world is felt,
and it has to be charming with no art budget: everything is still placeholder art
(DESIGN.md 3.10). A 2D chart needs drawn sprites for islands and ships at several angles to read
as a place; a low-poly 3D diorama reads as one with nothing but geometry, flat color, light and
shadow, and it can be built from content and a seed.

Options: PixiJS with hand-drawn sprites (needs an artist), PixiJS with procedural 2D shapes
(flat, hard to make charming), three.js with an orthographic isometric camera.

## Decision

The overworld is rendered by three.js with a true isometric orthographic camera, as a lazy-loaded
module. Islands are built from primitives with a seeded PRNG from `engine`, so an island looks
the same everywhere; ships are chunky sloops; the sea is a lit plane with vertex waves, shallows
and foam around islands, and sea lanes as marching dashes along a gentle curve. Clouds throw
shadows and gulls circle. Labels are HTML over the canvas, so they are readable, clickable and
testable without WebGL picking. Ships ease between the server's per-turn snapshots so a voyage
reads as motion.

PixiJS remains the renderer for puzzle boards and, per ADR 0004, for the sea battle grid and the
walkable island. If the island or sea battle turn out to want the same diorama look, that is a
new decision.

## Consequences

- The client carries two renderers. three.js is split into its own chunk and only loaded by the
  chart and the ship page; puzzle practice pages do not pay for it.
- The chart simulates nothing: every position comes from content and `ship.state` snapshots,
  which keeps the server the only authority (ADR 0003 spirit).
- Without WebGL the chart says so and the notice board list stands in.
- A Playwright smoke test opens the chart and picks an island through its HTML label, so the
  suite does not depend on WebGL picking on CI's software renderer.
