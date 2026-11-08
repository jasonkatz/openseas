# 0032. Walking is cosmetic: each client paths the same grid, and the server only relays where a pirate walks to

Status: Accepted. Builds on [0005](./0005-node-ws-realtime.md),
[0018](./0018-one-experience-and-a-puzzle-harness.md) and
[0020](./0020-three-js-world-with-boards-over-it.md).

## Context

M5 brings the walkable island (DESIGN.md 3.5): a pirate ashore walks a small town (dock, tavern,
notice board) among the other pirates there. The owner asked for the ship's deck to be walkable as
well, so the whole game hangs together: walk down the dock, up the gangplank, across the deck to the
pump, and the pump's board opens. Until now islands and decks were dioramas with tappable spots, and
the crew stood on deck as pegs at their stations.

Three things were open. Who decides where a pirate stands. How a walk reaches the other pirates in
the place without a stream of positions. And how walking fits a world whose places are camera moves
over one scene (ADR 0020), where every action is already a spot in the world and a button on a card.

A server-simulated position (the server steps every walker and broadcasts positions on a tick) was
weighed and set aside. Nothing in v1 depends on where a pirate stands: no collisions between
pirates, no proximity rules, no fights ashore. Simulating it would cost a tick loop and bandwidth for
something no rule reads.

## Decision

1. **Walking is cosmetic.** No rule reads a position. Boarding, taking a station, the wheel and going
   ashore stay the actions they were; walking is how the world shows them. A tap on a building, a
   ship, a station or the gangway walks the pirate there, and the action runs on arrival. The card's
   buttons still run it at once.
2. **A walk is a target, not a stream.** The client sends `walk.to` with the spot the pirate set off
   for, in the place's own frame: an island's *dock frame* (x out along the dock, z across it), or the
   ship's frame on deck. Held arrow keys send a short step ahead as they go, paced to a few a second.
3. **The server relays and remembers, nothing more.** `SocialService.walk` bounds the spot (the
   schema keeps it within 4 units of the place's origin), drops walks closer together than 80 ms, and
   sends `walk.moved` to everyone else in the place: the island's room ashore, the ship's room aboard.
   It keeps each pirate's last walk while they stay in the place. `island.presence` carries it as
   `at`, and a pirate coming aboard gets `walk.where` for the deck. Leaving a place forgets the walk.
4. **Every client paths the same grid.** An island is built from a PRNG seeded by its id, a ship's
   deck from its model. Each records what it puts down as obstacles in a walk grid. A walker follows
   A* across the grid, pulled taut, at an easy pace, and never takes longer than about two seconds,
   however far. Given the same target, every screen walks a pirate the same way.
5. **Defaults where nobody has walked.** A pirate seen before they walk stands somewhere near the
   plaza, the same spot on every screen, chosen from their id. Coming off a ship, the player steps
   ashore at the foot of its gangplank and says so with a walk. Aboard, everyone stands at their post:
   the station they hold, the wheel for a captain with none, else a spot about the deck. A change of
   station walks them to the new post on every screen.
6. **Inside a building is a spot too.** Every building with a door has a spot just inside it. A walk
   to that spot means the pirate went in: on every screen they walk to the door, it swings open, they
   step through and are out of sight. A walk anywhere else from inside walks them out through the
   door first. The player's own pirate is inside whichever building's room they have open, so a room
   opened from the card walks them in, and closing it walks them out to stand at the door. No new
   message: going in is a walk.

## Consequences

- The server's load for walking is one small message per tap per pirate, relayed to one room.
- Two screens can disagree for a moment about where a pirate is: a walk planned from where one screen
  last showed them, a berth numbered differently on two screens. Nothing depends on it, and the next
  walk settles it.
- Scores, standings and the ship are untouched, so walking needs no replay and no determinism test.
  The walk grid and paths are client code, outside the engine.
- A position is cosmetic, so a hacked client can show its pirate anywhere within the bounds. That
  matters only once a rule reads positions. PvP ashore, proximity chat or anything like them would
  need a new decision first.
- Each building, station and ship keeps its spot and card button, so the game stays fully usable
  without WebGL, and the smoke tests that drive spots still pass. Walking adds to them; it does not
  replace them.
