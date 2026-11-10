/**
 * Deflectors (prototype, ADR 0036): a square grid of two-sided mirrors, each set as `/` or `\`, and
 * beams that come in from ports on the edge. The player's one verb is flipping a mirror.
 *
 * Beams come in volleys: one beam at first, more later in the round. A volley is announced before
 * it fires: every beam's entry port and exit port are marked, and one count runs for the volley.
 * When the count ends, or the player fires early, every beam runs straight, turns at every mirror
 * it meets, and leaves by some port. A beam out through its own exit scores by the mirrors it
 * turned at, (turns + 1) squared; a beam out anywhere else hits the hull. A volley with every beam
 * home is clean: it builds the streak, and the streak multiplies it. A clean volley worth as much as
 * any setting of the mirrors could make it is perfect, and is multiplied again.
 *
 * Mirrors never move. Every volley is dealt exits that one setting of the mirrors reaches together:
 * the engine searches the settings when it deals, and keeps the most they can score as the volley's
 * `best`. No beam is dealt the exit it would leave by as the mirrors stand, so every beam asks for
 * a flip.
 *
 * Cell index = row * size + col, row 0 at the top. Port index = side * size + i: side 0 is the top
 * edge (i counts columns, the beam enters heading down), side 1 the right edge (i counts rows,
 * heading left), side 2 the bottom edge (columns, heading up), side 3 the left edge (rows, heading
 * right). Directions: 0 up, 1 right, 2 down, 3 left.
 *
 * Time is data: every move carries the integer `tick` it happens at, and the reducer fires and
 * deals whatever is due by that tick first. Nothing here reads a clock (ADR 0003, ADR 0015).
 */
import type { PrngState } from "../prng.js";

/** What a cell holds. */
export const DEFLECTORS_EMPTY = 0;
/** A mirror set as `/`: a beam heading right turns up. */
export const DEFLECTORS_SLASH = 1;
/** A mirror set as `\`: a beam heading right turns down. */
export const DEFLECTORS_BACKSLASH = 2;

export interface DeflectorsConfig {
  /** The grid is size by size. */
  readonly size: number;
  /** Mirrors on the grid. They are dealt once and never move. */
  readonly mirrors: number;
  /** The most beams in a volley, late in the round. */
  readonly maxBeams: number;
  /** The round opens with one beam a volley; a volley gets one more every rampTicks, up to maxBeams. */
  readonly rampTicks: number;
  /**
   * A volley is dealt exits whose best setting is worth at least what minBest turns a beam would
   * score, and which a cheaper setting reaches too, when such exits are free: every volley then has
   * a long way round worth finding.
   */
  readonly minBest: number;
  /** A beam out through its exit after b turns scores bouncePoints * (b + 1) * (b + 1), with b counted up to bounceCap. */
  readonly bouncePoints: number;
  readonly bounceCap: number;
  /** What a perfect volley is multiplied by, in percent. */
  readonly perfectPercent: number;
  /** Lost for every beam that leaves by the wrong port. Score never goes below zero. */
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
  /** Ticks a volley waits before it fires at the start of the round, and by the end; the wait shortens evenly. */
  readonly chargeTicks: number;
  readonly chargeTicksMin: number;
  /** Ticks more a volley waits for every beam in it after the first. */
  readonly beamTicks: number;
  /** Ticks from a volley firing to the next being dealt: firing early brings the next one sooner. */
  readonly respawnTicks: number;
}

export const DEFAULT_DEFLECTORS_CONFIG: DeflectorsConfig = {
  size: 6,
  mirrors: 14,
  maxBeams: 2,
  rampTicks: 350,
  minBest: 4,
  bouncePoints: 1,
  bounceCap: 16,
  perfectPercent: 150,
  hullPenalty: 40,
  streakPercent: [100, 110, 120, 130, 140, 150, 160, 180, 200],
  tickMs: 100,
  maxTick: 1200,
  maxMoves: 4000,
  openingTicks: 8,
  chargeTicks: 180,
  chargeTicksMin: 130,
  beamTicks: 50,
  respawnTicks: 6,
};

/** One beam of a volley. */
export interface DeflectorsBeam {
  /** Its place in the volley, and the sign it wears: 0 to maxBeams - 1. */
  readonly sign: number;
  /** The port it comes in by, and the port it must leave by. */
  readonly entry: number;
  readonly exit: number;
}

/** Beams that wait together and fire together. */
export interface DeflectorsVolley {
  /** Stable identity for animation. Never reused within a game. */
  readonly id: number;
  readonly beams: readonly DeflectorsBeam[];
  readonly dealTick: number;
  readonly fireTick: number;
  /** The most the beams' own points come to, over every setting of the mirrors that sends each beam out through its exit. */
  readonly best: number;
}

export type DeflectorsMove =
  /** Flip the mirror at `cell` between `/` and `\`. */
  | { readonly type: "flip"; readonly cell: number; readonly tick: number }
  /** Fire the waiting volley `volley` now instead of waiting out its count. */
  | { readonly type: "fire"; readonly volley: number; readonly tick: number }
  /** Nothing but time passing, so volleys that fired by themselves reach the server. */
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
}

/** One beam of a volley as it fired, or as it would fire now. */
export interface DeflectorsShot extends DeflectorsBeam, DeflectorsTrace {
  /** It left by its own exit. */
  readonly hit: boolean;
  /** A hit's own points, before the volley is multiplied; or what the hull took, as a negative. */
  readonly points: number;
}

/** What a volley did, or would do if it fired now. The board previews with it and the reducer scores with it. */
export interface DeflectorsOutcome {
  readonly shots: readonly DeflectorsShot[];
  readonly hits: number;
  /** Every beam left by its own exit. */
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
  /** A volley fired, at the end of its count or early. */
  | {
      readonly seq: number;
      readonly tick: number;
      readonly type: "fire";
      readonly volley: DeflectorsVolley;
      /** True when the player fired it before its count ended. */
      readonly early: boolean;
      readonly outcome: DeflectorsOutcome;
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
  /** One entry a cell: DEFLECTORS_EMPTY, DEFLECTORS_SLASH or DEFLECTORS_BACKSLASH. */
  readonly mirrors: readonly number[];
  /** The volley waiting to fire, or null between volleys. */
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
