/**
 * Deflectors (prototype, ADR 0036): a square grid of two-sided mirrors, each set as `/` or `\`, a
 * few lenses, and beams that come in from ports on the edge. The player's one verb is flipping a
 * mirror.
 *
 * Beams come in volleys of `beams`, from the first second to the last. A volley is announced and
 * then waits for as long as the player likes: every beam's entry port and exit port are marked,
 * and so is its recipe, the lenses it must pass through on the way. The player fires it. Every beam
 * runs straight, turns at every mirror it meets, passes straight through a lens, and leaves by some
 * port. A beam out through its own exit having passed exactly the lenses of its recipe, no fewer
 * and no other, is home: it scores by the mirrors it turned at, (turns + 1) squared, and half as
 * much again for each lens in its recipe. Any other beam hits the hull. A volley with every beam
 * home is clean: it builds the streak, and the streak multiplies it. A clean volley worth as much
 * as any setting of the mirrors could make it is perfect, and is multiplied again.
 *
 * Every mirror a fired beam turned at is spent. It leaves the grid; whatever stood above it in its
 * column drops one cell, and a fresh mirror, set at random, comes in at the top. So a route changes
 * the grid the next volley is dealt on, and a long route changes more of it.
 *
 * Every volley is dealt exits and recipes that one setting of the mirrors reaches together: the
 * engine searches the settings when it deals, and keeps the most they can score as the volley's
 * `best`. No beam is dealt a way it would go home by as the mirrors stand, so every beam asks for
 * a flip.
 *
 * Cell index = row * size + col, row 0 at the top. Port index = side * size + i: side 0 is the top
 * edge (i counts columns, the beam enters heading down), side 1 the right edge (i counts rows,
 * heading left), side 2 the bottom edge (columns, heading up), side 3 the left edge (rows, heading
 * right). Directions: 0 up, 1 right, 2 down, 3 left. A recipe is a mask of lens kinds: bit k is
 * kind k.
 *
 * Time is data: every move carries the integer `tick` it happens at, and the reducer deals whatever
 * is due by that tick first. Nothing here reads a clock (ADR 0003, ADR 0015).
 */
import type { PrngState } from "../prng.js";

/** What a cell holds. */
export const DEFLECTORS_EMPTY = 0;
/** A mirror set as `/`: a beam heading right turns up. */
export const DEFLECTORS_SLASH = 1;
/** A mirror set as `\`: a beam heading right turns down. */
export const DEFLECTORS_BACKSLASH = 2;
/** A lens of kind k is DEFLECTORS_LENS + k. A beam runs straight through it. */
export const DEFLECTORS_LENS = 3;
/** How many kinds of lens there are. The lenses on a grid are dealt kind 0, 1, 2, 0, ... */
export const DEFLECTORS_LENS_KINDS = 3;

export interface DeflectorsConfig {
  /** The grid is size by size. */
  readonly size: number;
  /** Mirrors on the grid. A spent mirror is replaced, so there are always this many. */
  readonly mirrors: number;
  /** Lenses on the grid, of kind 0, 1, 2, 0 and so on. They are never spent. */
  readonly lenses: number;
  /** Beams in every volley. */
  readonly beams: number;
  /** The most lenses a beam's recipe asks for. 0 turns recipes off: a beam is home at its exit whatever it passed. */
  readonly recipeLenses: number;
  /** What each lens in a beam's recipe adds to its points, in percent. */
  readonly lensPercent: number;
  /** Mirrors a fired beam turned at are spent, and the grid refills from the top. Off, mirrors never move. */
  readonly spend: boolean;
  /**
   * A volley is dealt exits whose best setting is worth at least what minBest turns a beam would
   * score, and which a cheaper setting reaches too, when such exits are free: every volley then has
   * a long way round worth finding.
   */
  readonly minBest: number;
  /** A beam home after b turns scores bouncePoints * (b + 1) * (b + 1), with b counted up to bounceCap, before its lenses. */
  readonly bouncePoints: number;
  readonly bounceCap: number;
  /** What a perfect volley is multiplied by, in percent. */
  readonly perfectPercent: number;
  /** Lost for every beam that is not home. Score never goes below zero. */
  readonly hullPenalty: number;
  /** What the streak of clean volleys multiplies a clean volley by, in percent: the first takes the first entry, a streak past the end takes the last. */
  readonly streakPercent: readonly number[];
  /** Wall-clock ms per tick on the client; the server uses it to bound claimed ticks. */
  readonly tickMs: number;
  /** No move may claim a tick beyond this; the round is over by then. */
  readonly maxTick: number;
  /** Longest move log the server accepts: flips, fires and waits. */
  readonly maxMoves: number;
  /** The first volley is dealt this many ticks in. */
  readonly openingTicks: number;
  /** Ticks from a volley firing to the next being dealt: time for the grid to settle. */
  readonly respawnTicks: number;
}

export const DEFAULT_DEFLECTORS_CONFIG: DeflectorsConfig = {
  size: 6,
  mirrors: 14,
  lenses: 3,
  beams: 2,
  recipeLenses: 2,
  lensPercent: 50,
  spend: true,
  minBest: 4,
  bouncePoints: 1,
  bounceCap: 16,
  perfectPercent: 200,
  hullPenalty: 40,
  streakPercent: [100, 110, 120, 130, 140, 150, 160, 180, 200],
  tickMs: 100,
  maxTick: 1200,
  maxMoves: 4000,
  openingTicks: 8,
  respawnTicks: 9,
};

/** One beam of a volley. */
export interface DeflectorsBeam {
  /** Its place in the volley, and the sign it wears: 0 to beams - 1. */
  readonly sign: number;
  /** The port it comes in by, and the port it must leave by. */
  readonly entry: number;
  readonly exit: number;
  /** The lens kinds it must pass through, as a mask, and no others. 0 when recipes are off. */
  readonly recipe: number;
}

/** Beams that wait together and fire together. */
export interface DeflectorsVolley {
  /** Stable identity for animation. Never reused within a game. */
  readonly id: number;
  readonly beams: readonly DeflectorsBeam[];
  readonly dealTick: number;
  /** The most the beams' own points come to, over every setting of the mirrors that sends every beam home. */
  readonly best: number;
}

export type DeflectorsMove =
  /** Flip the mirror at `cell` between `/` and `\`. */
  | { readonly type: "flip"; readonly cell: number; readonly tick: number }
  /** Fire the waiting volley `volley`. */
  | { readonly type: "fire"; readonly volley: number; readonly tick: number }
  /** Nothing but time passing, so volleys dealt meanwhile reach the server. */
  | { readonly type: "wait"; readonly tick: number }
  | { readonly type: "end"; readonly tick: number };

/** The way a beam runs through the mirrors as they stand. */
export interface DeflectorsTrace {
  /** The port it leaves by. */
  readonly out: number;
  /** Mirrors it turns at, counting a mirror met twice twice. */
  readonly bounces: number;
  /** The cell of every turn, in order. The beam runs straight from port to turn to turn to port. */
  readonly turns: readonly number[];
  /** The lens kinds it passed through, as a mask. */
  readonly lenses: number;
  /** The cell of every lens it passed, in order. */
  readonly lensCells: readonly number[];
}

/** One beam of a volley as it fired, or as it would fire now. */
export interface DeflectorsShot extends DeflectorsBeam, DeflectorsTrace {
  /** It left by its own exit, whatever it passed. */
  readonly atExit: boolean;
  /** It left by its own exit having passed exactly its recipe: it is home. */
  readonly hit: boolean;
  /** A hit's own points, before the volley is multiplied; or what the hull took, as a negative. */
  readonly points: number;
}

/** What a volley did, or would do if it fired now. The board previews with it and the reducer scores with it. */
export interface DeflectorsOutcome {
  readonly shots: readonly DeflectorsShot[];
  readonly hits: number;
  /** Every beam is home. */
  readonly clean: boolean;
  /** Clean, and worth as much as any setting of the mirrors could make it. */
  readonly perfect: boolean;
  /** The hits' own points added up. */
  readonly base: number;
  /** The streak after this volley, and what it multiplied the volley by, in percent. */
  readonly streak: number;
  readonly streakPercent: number;
  /** What the hits came to once multiplied. */
  readonly gained: number;
  /** What the hull took, as a positive. */
  readonly lost: number;
  /** What the volley did to the score: gained less lost. */
  readonly points: number;
}

export type DeflectorsEvent =
  /** A volley was announced. */
  | { readonly seq: number; readonly tick: number; readonly type: "deal"; readonly volley: DeflectorsVolley }
  /** A volley fired. */
  | {
      readonly seq: number;
      readonly tick: number;
      readonly type: "fire";
      readonly volley: DeflectorsVolley;
      readonly outcome: DeflectorsOutcome;
      /** The mirrors it spent, in cell order: empty when spending is off. */
      readonly spent: readonly number[];
      /** For every cell after the grid settled, how many rows what is in it dropped: 0 for what did not move. */
      readonly fell: readonly number[];
    };

export interface DeflectorsMoveReport {
  readonly move: DeflectorsMove;
  /** Everything that happened from the previous state's tick up to and including this move's tick. */
  readonly events: readonly DeflectorsEvent[];
  readonly points: number;
}

export interface DeflectorsState {
  readonly config: DeflectorsConfig;
  readonly tick: number;
  /** One entry a cell: DEFLECTORS_EMPTY, DEFLECTORS_SLASH, DEFLECTORS_BACKSLASH or a lens, DEFLECTORS_LENS + kind. */
  readonly mirrors: readonly number[];
  /** The volley waiting to be fired, or null between volleys. */
  readonly volley: DeflectorsVolley | null;
  /** The tick the next volley is dealt at, once none is waiting. */
  readonly nextDealTick: number;
  readonly rng: PrngState;
  readonly nextVolleyId: number;
  readonly eventSeq: number;
  /** Every move in the log, waits included. */
  readonly logLength: number;
  readonly flips: number;
  /** Volleys that have fired. */
  readonly volleys: number;
  /** Beams out through their exits, and beams into the hull. */
  readonly hits: number;
  readonly misses: number;
  /** Mirrors spent. */
  readonly spent: number;
  /** Perfect volleys. */
  readonly perfects: number;
  /** The most turns any hit made. */
  readonly longest: number;
  readonly score: number;
  /** Clean volleys in a row. */
  readonly combo: number;
  readonly bestCombo: number;
  readonly lastMove: DeflectorsMoveReport | null;
  readonly finished: boolean;
}
