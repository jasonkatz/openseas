// A board drawn from events alone. A screen never reads a round's state: it starts from an empty
// board and applies each event's changes, and what it holds is what the round holds. A host draws
// with this, and the tests hold it to the loop for every event of every round.
import type { Cell, Event, Ground, Piece } from "./types.js";

/** What a screen holds: the piece on each cell, row by row. */
export type Seen = readonly (readonly (Piece | null)[])[];

export const seenEmpty = (width: number, height: number): Seen => Array.from({ length: height }, () => Array.from({ length: width }, () => null));

/** The board after one event. The changes of one event happen together: whatever leaves or travels is lifted first. */
export function seenAfter(board: Seen, event: Event): Seen {
  const next = board.map((row) => [...row]);
  const at = (p: Cell): Piece | null => board[p.y]![p.x]!;
  for (const c of event.changes) {
    if (c.change === "leave") next[c.at.y]![c.at.x] = null;
    else if (c.change === "travel") next[c.from.y]![c.from.x] = null;
  }
  for (const c of event.changes) if (c.change === "travel") next[c.to.y]![c.to.x] = at(c.from);
  for (const c of event.changes) if ((c.change === "arrive" || c.change === "change") && "piece" in c) next[c.at.y]![c.at.x] = c.piece;
  return next;
}

/** What a screen holds of the cells themselves: the terrain of each, row by row. Null is a plain cell. */
export type SeenGround = readonly (readonly (Ground | null)[])[];
/** The terrain after one event. */
export function groundAfter(ground: SeenGround, event: Event): SeenGround {
  const next = ground.map((row) => [...row]);
  for (const c of event.changes) if (c.change === "change" && "terrain" in c) next[c.at.y]![c.at.x] = c.terrain === "plain" ? null : { terrain: c.terrain, ...(c.state === undefined ? {} : { state: c.state }) };
  return next;
}
