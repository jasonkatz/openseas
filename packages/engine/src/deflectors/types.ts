/**
 * Deflectors (prototype, ADR 0036): a square grid the player builds, mirror by mirror, and beams
 * that run through it to light targets on its edge.
 *
 * A round deals a set supply of pieces (`pieces`): mirrors, and now and then a lens. The next few
 * wait in a queue the player can see (`queueSize`). The player puts the next piece on any cell,
 * empty or not; a piece put on another replaces it. A mirror can be turned between `/` and `\`
 * before it goes down. A piece the player does not want can be binned, which uses it up. Nothing
 * comes on a timer and nothing is placed for the player: the clock only bounds the round, so pace
 * counts, but every piece is the player's own choice.
 *
 * Emitters sit on the left edge, targets on the other three. Every target asks for a recipe: the
 * lens kinds a beam must pass on the way, exactly those and no other, and none for a plain target.
 * The player fires when they choose, and every emitter fires at once. Each beam runs straight,
 * turns at every mirror it meets, passes straight through a lens, and leaves by some port. A beam
 * that leaves by a target, having passed exactly its recipe, lights it: it scores (turns + 1)
 * squared, and half as much again for each lens in the recipe. A target lights once a shot. The
 * shot is multiplied by how many targets it lit (`litPercent`). A beam that lights nothing scores
 * nothing.
 *
 * Every mirror a fired beam turned at is spent, and so is every lens a lighting beam passed: they
 * leave the grid. A lit target asks for a new recipe. So there is no one route to find: the
 * player chooses which targets to build towards, where to put a piece that fits nothing, and when a
 * shot is worth firing rather than built on.
 *
 * Cell index = row * size + col, row 0 at the top. Port index = side * size + i: side 0 is the top
 * edge (i counts columns, the beam enters heading down), side 1 the right edge (i counts rows,
 * heading left), side 2 the bottom edge (columns, heading up), side 3 the left edge (rows, heading
 * right). Directions: 0 up, 1 right, 2 down, 3 left. A recipe is a mask of lens kinds: bit k is
 * kind k.
 *
 * The round ends when the clock runs out, or once the supply is used up and the grid lights
 * nothing more.
 *
 * Time is data: every move carries the integer `tick` it happens at. Nothing here reads a clock
 * (ADR 0003, ADR 0015).
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
/** How many kinds of lens there are. */
export const DEFLECTORS_LENS_KINDS = 3;

export interface DeflectorsConfig {
  /** The grid is size by size. */
  readonly size: number;
  /** Emitters on the left edge, spread down it. */
  readonly emitters: number;
  /** Targets on the top, right and bottom edges, dealt at the start. */
  readonly targets: number;
  /** Mirrors on the grid at the start, set at random. */
  readonly mirrors: number;
  /** Lenses on the grid at the start, of kind 0, 1, 2, 0 and so on. */
  readonly lenses: number;
  /** How often a recipe asks for no lens, one, two and so on, as weights. One entry turns recipes off. */
  readonly recipeWeights: readonly number[];
  /** What each lens in a target's recipe adds to a beam's points, in percent. */
  readonly lensPercent: number;
  /** A beam lighting a target after b turns scores bouncePoints * (b + 1) * (b + 1), with b counted up to bounceCap, before its lenses. */
  readonly bouncePoints: number;
  readonly bounceCap: number;
  /** What a shot is multiplied by, in percent, for lighting one target, two, three and so on. */
  readonly litPercent: readonly number[];
  /** Mirrors a fired beam turned at, and lenses a lighting beam passed, leave the grid. Off, the grid stays as built. */
  readonly spend: boolean;
  /** Pieces the round deals, placed or binned. */
  readonly pieces: number;
  /** How many pieces the queue shows, the next first. */
  readonly queueSize: number;
  /** How often a piece is a lens rather than a mirror, in percent. */
  readonly lensChance: number;
  /** Ticks after a shot before the emitters can fire again. */
  readonly fireTicks: number;
  /** Wall-clock ms per tick on the client; the server uses it to bound claimed ticks. */
  readonly tickMs: number;
  /** No move may claim a tick beyond this; the round is over by then. */
  readonly maxTick: number;
  /** Longest move log the server accepts: places, turns, fires and waits. */
  readonly maxMoves: number;
}

export const DEFAULT_DEFLECTORS_CONFIG: DeflectorsConfig = {
  size: 6,
  emitters: 3,
  targets: 5,
  mirrors: 5,
  lenses: 2,
  recipeWeights: [25, 45, 30],
  lensPercent: 50,
  bouncePoints: 1,
  bounceCap: 16,
  litPercent: [100, 200, 400],
  spend: true,
  pieces: 50,
  queueSize: 3,
  lensChance: 22,
  fireTicks: 10,
  tickMs: 100,
  maxTick: 1200,
  maxMoves: 4000,
};

/** A target on the edge, and the lenses a beam must pass to light it. */
export interface DeflectorsTarget {
  /** Its place in the deal, fixed for the round. */
  readonly id: number;
  readonly port: number;
  /** The lens kinds a beam must pass, as a mask, and no others. 0 asks for none. */
  readonly recipe: number;
}

export type DeflectorsMove =
  /** Put the next piece in the queue on `cell`, replacing whatever is there. */
  | { readonly type: "place"; readonly cell: number; readonly tick: number }
  /** Turn the next piece in the queue, a mirror, between `/` and `\`. */
  | { readonly type: "turn"; readonly tick: number }
  /** Bin the next piece in the queue: it is used up and put nowhere. */
  | { readonly type: "bin"; readonly tick: number }
  /** Fire every emitter. */
  | { readonly type: "fire"; readonly tick: number }
  /** Nothing but time passing. */
  | { readonly type: "wait"; readonly tick: number }
  | { readonly type: "end"; readonly tick: number };

/** The way a beam runs through the grid as it stands. */
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

/** One beam of a shot, as it fired or would fire now. */
export interface DeflectorsShot extends DeflectorsTrace {
  /** The port it came in by. */
  readonly entry: number;
  /** The target it lit, by id, or -1. */
  readonly target: number;
  /** The beam's own points, before the shot is multiplied: 0 when it lit nothing. */
  readonly points: number;
}

/** What a shot did, or would do if fired now. The board previews with it and the reducer scores with it. */
export interface DeflectorsOutcome {
  readonly shots: readonly DeflectorsShot[];
  /** Targets lit. */
  readonly lit: number;
  /** The beams' own points added up. */
  readonly base: number;
  /** What the shot is multiplied by, in percent. */
  readonly litPercent: number;
  /** What the shot scores. */
  readonly points: number;
}

export type DeflectorsEvent =
  /** A piece came into the queue from the supply. */
  | { readonly seq: number; readonly tick: number; readonly type: "piece"; readonly piece: number }
  /** The next piece was binned. */
  | { readonly seq: number; readonly tick: number; readonly type: "bin"; readonly piece: number }
  /** The emitters fired. */
  | {
      readonly seq: number;
      readonly tick: number;
      readonly type: "fire";
      readonly outcome: DeflectorsOutcome;
      /** The cells it spent, in order: empty when spending is off. */
      readonly spent: readonly number[];
      /** The targets after the shot, lit ones with their new recipes. */
      readonly targets: readonly DeflectorsTarget[];
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
  /** The emitters' ports, top to bottom. */
  readonly emitters: readonly number[];
  readonly targets: readonly DeflectorsTarget[];
  /** The pieces waiting, next first, as the cell each would become. */
  readonly queue: readonly number[];
  /** Pieces still to come into the queue. */
  readonly left: number;
  /** The first tick the emitters can fire at. */
  readonly fireTick: number;
  readonly rng: PrngState;
  readonly eventSeq: number;
  /** Every move in the log, waits included. */
  readonly logLength: number;
  /** Pieces put down, and pieces binned. */
  readonly placed: number;
  readonly binned: number;
  /** Shots fired, and targets lit. */
  readonly shots: number;
  readonly lit: number;
  /** Cells spent. */
  readonly spent: number;
  /** The most any one shot scored, and the most targets any one shot lit. */
  readonly bestShot: number;
  readonly bestLit: number;
  /** The most turns any lighting beam made. */
  readonly longest: number;
  readonly score: number;
  readonly lastMove: DeflectorsMoveReport | null;
  readonly finished: boolean;
}
