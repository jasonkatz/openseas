/**
 * Assembly (prototype, ADR 0036, ADR 0082): a shipyard's parts bay, where a ship is put together
 * from blueprints. A successor to the original's Shipwrightry: its mechanics, its own everything else.
 *
 * The bay is a full grid of parts. Each kind of part moves its own way, and that is the puzzle:
 *
 * - a girder swaps sideways, with the part left or right of it;
 * - a strut swaps up or down;
 * - a cable swaps on the diagonals;
 * - a panel has no way of its own: it moves only when a neighbour that has one swaps with it;
 * - a core never moves, and in a blueprint it stands for any part.
 *
 * Two neighbouring parts may swap when either one moves that way. A swap scores nothing; it sets the
 * bay up. The tray holds `traySize` blueprints, each a shape of three to five parts drawn on a grid.
 * Fitting a blueprint takes every part under it, when each is the part the blueprint asks for or a
 * core; a new part appears in each cell it took, every other part stays where it is, and a new
 * blueprint takes the used one's place in the tray.
 *
 * Fits made one after another, with no swap between, are a chain. A fit of n parts scores
 * fitPoints * (n - 2) * its place in the chain, and each core in it corePoints * its place; the place
 * counts up to chainCap and holds there. A swap ends the chain. Setting several blueprints up and
 * then fitting them all as one chain is the move the puzzle pays most for.
 *
 * Cell index = row * width + col; row 0 is the top. Nothing here reads a clock: the round's length
 * is the page's and the server's business.
 */
import type { PrngState } from "../prng.js";

/** The four kinds of part that move, as the engine numbers them. */
export const ASSEMBLY_PANEL = 0;
export const ASSEMBLY_GIRDER = 1;
export const ASSEMBLY_STRUT = 2;
export const ASSEMBLY_CABLE = 3;
/** Kinds of part that can be dealt or drawn in a blueprint. */
export const ASSEMBLY_KINDS = 4;
/** A core: never moves, stands for any part in a blueprint. */
export const ASSEMBLY_CORE = 100;

/** The way two neighbours lie: side by side, one over the other, or corner to corner. */
export type AssemblyWay = "side" | "up" | "diagonal";

export interface AssemblyConfig {
  readonly width: number;
  readonly height: number;
  /** How often each kind is dealt, in the engine's order: panel, girder, strut, cable. Blueprints are drawn with the same weights. */
  readonly kindWeights: readonly number[];
  /** Blueprints in the tray. */
  readonly traySize: number;
  /** How often a new blueprint has three, four or five parts. */
  readonly sizeWeights: readonly number[];
  /** A fit of n parts scores fitPoints * (n - 2) * its place in the chain. */
  readonly fitPoints: number;
  /** The place in a chain counts up to this and holds. 1: every fit counts as the first, so there are no chains. */
  readonly chainCap: number;
  /** Each core in a fit scores corePoints * its place in the chain. */
  readonly corePoints: number;
  /** Cores in the opening bay. */
  readonly startCores: number;
  /** Chance, per thousand, that a new part is a core, while fewer than maxCores are in the bay. */
  readonly corePermille: number;
  readonly maxCores: number;
  /** Longest move log the server accepts. */
  readonly maxMoves: number;
}

export const DEFAULT_ASSEMBLY_CONFIG: AssemblyConfig = {
  width: 6,
  height: 6,
  kindWeights: [22, 26, 26, 26],
  traySize: 6,
  sizeWeights: [5, 4, 2],
  fitPoints: 10,
  chainCap: 6,
  corePoints: 10,
  startCores: 2,
  corePermille: 30,
  maxCores: 3,
  maxMoves: 1000,
};

export interface AssemblyPiece {
  /** Stable identity for animation. Never reused within a game. */
  readonly id: number;
  /** 0 to 3 for a part, or ASSEMBLY_CORE. */
  readonly kind: number;
}

/** One part of a blueprint: where it sits in the blueprint's box, and the kind it asks for. */
export interface AssemblyPart {
  readonly dc: number;
  readonly dr: number;
  readonly kind: number;
}

export interface AssemblyBlueprint {
  /** Stable identity for animation. Never reused within a game. */
  readonly id: number;
  /** Its shape's index in ASSEMBLY_SHAPES. */
  readonly shape: number;
  /** The box the parts sit in. */
  readonly width: number;
  readonly height: number;
  readonly parts: readonly AssemblyPart[];
}

export type AssemblyMove =
  /** Swap the parts at `a` and `b`, which are neighbours, side by side, one over the other or corner to corner. */
  | { readonly type: "swap"; readonly a: number; readonly b: number }
  /** Fit the blueprint in tray slot `slot` with the top left of its box on `cell`. */
  | { readonly type: "fit"; readonly slot: number; readonly cell: number }
  | { readonly type: "end" };

/** A piece as it left the bay. */
export interface AssemblyTaken {
  readonly cell: number;
  readonly id: number;
  readonly kind: number;
}

/** What a fit did: what it took, what it scored, how the bay settled and the blueprint that came in. */
export interface AssemblyFitReport {
  readonly slot: number;
  readonly blueprint: AssemblyBlueprint;
  /** The parts taken, in the blueprint's order. */
  readonly taken: readonly AssemblyTaken[];
  /** Its place in the chain, as counted (up to chainCap). */
  readonly place: number;
  /** Cores among what it took. */
  readonly cores: number;
  readonly points: number;
  /** The new parts, one in each cell the fit took, in reading order. */
  readonly spawned: ReadonlyArray<{ readonly id: number; readonly cell: number; readonly kind: number }>;
  /** The blueprint that took the slot. */
  readonly next: AssemblyBlueprint;
}

export interface AssemblyMoveReport {
  readonly move: AssemblyMove;
  /** A swap's two cells: the piece that was at `a` is now at `b`. */
  readonly swap: { readonly a: number; readonly b: number } | null;
  /** The chain a swap ended: its length, 0 when there was none. */
  readonly chainEnded: number;
  readonly fit: AssemblyFitReport | null;
  readonly points: number;
}

/** The streams the deal draws from (ADR 0075): no draw changes what another gives. */
export interface AssemblyStreams {
  /** The kind of each part dealt or refilled. */
  readonly parts: PrngState;
  /** Whether a new part is a core, and where the opening cores sit. */
  readonly cores: PrngState;
  /** Each blueprint's shape and kinds. */
  readonly prints: PrngState;
}

export interface AssemblyState {
  readonly config: AssemblyConfig;
  /** Always full. */
  readonly cells: readonly AssemblyPiece[];
  readonly tray: readonly AssemblyBlueprint[];
  readonly streams: AssemblyStreams;
  readonly nextId: number;
  readonly score: number;
  /** Swaps and fits made. */
  readonly moveCount: number;
  readonly swaps: number;
  readonly fits: number;
  /** Fits since the last swap. */
  readonly chain: number;
  /** The longest chain made. */
  readonly bestChain: number;
  /** Fits of five parts. */
  readonly bigFits: number;
  /** Cores taken in fits. */
  readonly coresUsed: number;
  readonly lastMove: AssemblyMoveReport | null;
  readonly finished: boolean;
}
