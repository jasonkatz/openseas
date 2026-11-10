# 0035. No island and no boat: a cratered rock, and a hull that is cut away aboard

Status: Accepted. Supersedes two clauses of [0034](./0034-space-setting.md): that the outposts use
"the heightfield island, walking grid and layout as built", and that "the skiff keeps the sloop's
deck". Builds on [0020](./0020-three-js-world-with-boards-over-it.md) and
[0032](./0032-walking-is-cosmetic-and-relayed.md).

## Context

M7 moved the world to space by redrawing it prop for prop on what was there. Each palm became an
antenna palm, each tree a potted tree, the beach a ring of pale dust, the pier a gantry of plates.
The sloop kept her open deck, her rails, her raised deck aft with its steps and her mast, now under
a clear canopy and called an antenna. That kept every walking grid, door and berth where it was,
which was the point: ADR 0034 froze the layout so the redraw could be proven to change nothing.

The owner played it and found it still an island with a boat tied up at it. The surfaces had
changed and the silhouettes had not. A ring of pale ground round a rise reads as a beach whatever
it is called. Leaning masts with drooping heads read as palms. An open deck with a rail, a mast and
a flag reads as a boat, canopy or not.

ADR 0034 also rejected a cutaway interior for the ship, because walls would get in the way of the
deck's walking grid.

## Decision

- **Silhouettes change, not only surfaces.** Nothing in the world keeps the outline of the sea
  thing it replaced.
- **An outpost is a cratered rock with a settlement bolted to it.** It is still open to the void
  with no dome.
  - The ground is a flat floor inside a raised crater rim that drops sheer to the lip. The pale
    ring is gone: the rim is darker than the floor, not lighter. The rim is cut through where the
    dock comes in.
  - Nothing grows in the open. The only green is in the grow tunnels beside the hab pods.
  - What stands round the rim is light masts, dishes and solar panels. What stands on the floor is
    the outpost's plant: tanks, cargo and vent stacks, with the crystal that grows out of the rock.
    Craters pock the floor, and warning lamps stand along the lip.
  - The dock is an arm: a box girder with a deck on it, a gate where it leaves the rock, and clamps
    that reach out to hold a ship at her berth.
  - The plaza is a round pad with a holo-globe turning over it. The beacon tower is a lattice
    mast. The shipyard has a flat roof, a shutter and a crane.
- **An outpost's layout may move.** The dice are rolled afresh, so props stand in new places.
  Nothing stored or sent depends on where a prop stands: walking is cosmetic, and every client
  builds the outpost from the same code and the same seed (ADR 0032). What stays where it was is
  what the rest of the game is hung on: the dock frame, the dock itself, the buildings and their
  doors, the landmark and the berths' order.
- **The skiff is a closed hull, cut away aboard.**
  - From outside she is shut: a hull with the bridge forward under a canopy, two engine bells in
    the stern, a turret pair in each side, an airlock amidships and a tail fin.
  - Aboard, the roof, the canopy and the side wall nearest the camera are not drawn. The far wall
    stands as the back of the room, and the deck is the floor of one long room.
  - She has no partitions. The walls are where the rails were, round the edge of the deck, so
    nothing stands in the walking grid that did not before. This is what answers ADR 0034's
    objection to a cutaway.
  - The bridge moves forward. A raised deck aft with the helm on it is a quarterdeck; the same
    thing forward, under glass, is a cockpit.
  - She has no mast, no stays and no flag flying. Her crew's flag is painted on each slope of her
    roof, and its emblem on the tail fin as before.
- **The layout is tested without drawing it.** The deck's layout lives in its own module with no
  drawing in it, and a unit test walks every outpost and the deck: every door, berth, station and
  place to stand can be reached, and the grid is the same whichever renderer draws it.
- **What is built never depends on the renderer.** A software renderer draws the same world more
  cheaply (no shadows, no antialiasing, fewer pixels). It used to lay out fewer boulders as well,
  which gave software and GPU clients different walking grids on the same outpost.

## Consequences

- The fingerprint that proved M7's redraw moved nothing no longer holds, by intent. The unit test
  takes its place: it does not pin where things are, it checks that the place can be walked.
- Berths are further apart, because a closed hull with turrets in her sides is beamier than the
  sloop was, and ships lie a little further out along the dock so their engines clear the rim.
- A pirate walking the dock behind a docked ship is hidden by her hull, where the sloop's open
  deck let them show. The player's own pirate is found by the ring drawn over everything, as
  behind a building.
- The far wall hides the dock from the deck's camera when she is docked. The deck was always
  looked at from the side away from the dock, so nothing a crew taps is behind it.
- `docs/GLOSSARY.md` takes the new scenery, and keeps the sea thing each row began as.

## Alternatives considered

- **Keep the layout and the dice, and swap more props.** Rejected: the outlines are what read as
  the sea, and the layout was the island's. A palm in the same place is still a palm.
- **A dome, or an interior to walk.** Still rejected, for ADR 0034's reasons: a dome gets in the
  way of the camera, and an interior means a new kind of place.
- **Rooms inside the ship.** Rejected: partitions would stand in the walking grid and between the
  camera and a station. One room does neither.
- **Fade the near wall and the roof instead of dropping them.** Rejected: a faded wall still
  stands in front of the stations, glass over the whole deck is costly on a software renderer,
  and the far wall is enough to say this is inside.
- **Keep the bridge aft.** Rejected: with the hull shut, a canopy over the stern reads as a
  tugboat's wheelhouse.
