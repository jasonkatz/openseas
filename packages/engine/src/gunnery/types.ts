/**
 * Gunnery: a chute in the deck's rail drops powder, wad, shot and water onto the deck one at a
 * time, in a rhythm that quickens through the round. Pieces roll a cell per tick until something
 * turns them. The gunner lays arrows that steer them into cannons, which load in the order
 * powder, wad, shot and fire themselves when full. A wrong piece fouls a cannon; water cleans it.
 * Anything not steered rolls out through the scupper and is gone.
 *
 * Coordinates: `col` runs 0..width-1 left to right, `row` runs 0..height-1 TOP to bottom, the same
 * order as the deck rows in content. Directions: 0 right, 1 down, 2 left, 3 up.
 *
 * Time is data: every move carries the integer `tick` it happens at, the reducer advances the
 * simulation to that tick first. Nothing here reads a clock (ADR 0003).
 */

import type { PrngState } from "../prng.js";

export type Dir = 0 | 1 | 2 | 3;
export const DIRS: readonly Dir[] = [0, 1, 2, 3];
export const DX: readonly number[] = [1, 0, -1, 0];
export const DY: readonly number[] = [0, 1, 0, -1];

export const GunneryKind = { Powder: 0, Wad: 1, Shot: 2, Water: 3 } as const;
export const GUNNERY_KINDS = 4;

/** `barrel` is the chute pieces drop from; `hatch` is a scupper that takes a piece overboard. */
export type DeckCell = "wall" | "deck" | "crate" | "barrel" | "cannon" | "hatch";

export interface GunneryConfig {
  /**
   * The decks a round may be played on; the seed picks one. Each is one string per row: # wall,
   * . plank, X crate, B chute, C cannon, H hatch. The chute must touch exactly one plank: pieces
   * drop onto it heading away from the chute. All decks are the same size, and each must pass
   * `deckProblems` (no loop built in, a stream that leaves, every gun within reach).
   */
  readonly decks: ReadonlyArray<readonly string[]>;
  /** Wall-clock ms per tick on the client; the server uses it to bound claimed ticks. */
  readonly tickMs: number;
  /** No move may claim a tick beyond this; the round is over by then. */
  readonly maxTick: number;
  /** The round ends after this many logged moves (arrows and waits). */
  readonly maxMoves: number;
  /** The chute holds back while this many pieces are on deck. */
  readonly maxOnDeck: number;
  /** Ticks between drops at the start of the round. */
  readonly spawnEveryTicks: number;
  /** Ticks between drops by the end of the round; the rhythm quickens evenly towards it. */
  readonly spawnEveryTicksMin: number;
  /** How many upcoming pieces the chute shows. */
  readonly queueLength: number;
  /** Pieces per refill of the shuffled bag the chute draws from, by kind: powder, wad, shot, water. */
  readonly bag: readonly number[];
  /** A full cannon fires itself this many ticks after loading (practice stand-in for the captain). */
  readonly fireAfterTicks: number;
  /** Points for powder or wad going into a cannon that wants it. */
  readonly stepPoints: number;
  /** Points for a full load. */
  readonly loadPoints: number;
  /** Extra points per load already in the combo, up to `comboCap` of them. */
  readonly comboStep: number;
  readonly comboCap: number;
}

export const DEFAULT_GUNNERY_DECKS: ReadonlyArray<readonly string[]> = [
  [
    "####B####",
    "#.......#",
    "C.......C",
    "#.......#",
    "#..X.X..#",
    "#.X...X.#",
    "H.......H",
    "#.X...X.#",
    "#.......#",
    "#.XX.XX.#",
    "#.......#",
    "C.......C",
    "#.......#",
    "#.......#",
    "####H##H#",
  ],
  [
    "#H##B#H##",
    "#.......#",
    "#.......#",
    "#.......#",
    "C..XXX..C",
    "#.......#",
    "#.X...X.#",
    "#...X...#",
    "#..X.X..#",
    "#.......#",
    "#..X.X..#",
    "#.......#",
    "C.......C",
    "#.......#",
    "#########",
  ],
  [
    "#H##B#H##",
    "#.......#",
    "#.......#",
    "#.......#",
    "#.X...X.#",
    "C.X...X.C",
    "#.......#",
    "#..X.X..#",
    "#.XX.XX.#",
    "#.......#",
    "#.......#",
    "C.......C",
    "#.......#",
    "#.......#",
    "####H####",
  ],
  [
    "#H##B#HH#",
    "#.......#",
    "#.......#",
    "#.......#",
    "#.......#",
    "C...X...C",
    "#...X...#",
    "H..X.X..H",
    "#..X.X..#",
    "#.X...X.#",
    "#.......#",
    "#..X.X..#",
    "C.......C",
    "#.......#",
    "#########",
  ],
  [
    "##H#B####",
    "#.......#",
    "#.......#",
    "C.......C",
    "H.X...X.H",
    "#.......#",
    "#.X...X.#",
    "#.X...X.#",
    "#.......#",
    "#.......#",
    "C.X...X.C",
    "#..X.X..#",
    "#.......#",
    "#.......#",
    "####H##H#",
  ],
  [
    "#H##B#HH#",
    "#.......#",
    "#.......#",
    "#.......#",
    "#.X...X.#",
    "C.......C",
    "#.......#",
    "#.XXXXX.#",
    "#.......#",
    "#..X.X..#",
    "#.......#",
    "C.......C",
    "#.......#",
    "#.......#",
    "#########",
  ],
  [
    "#HH#B####",
    "#.......#",
    "#.......#",
    "#.......#",
    "#..XXX..#",
    "C..XXX..C",
    "#..XXX..#",
    "#.......#",
    "#.......#",
    "#.......#",
    "#.......#",
    "C.......C",
    "#.......#",
    "#.......#",
    "#H#######",
  ],
  [
    "#H##B####",
    "#.......#",
    "#.......#",
    "H.......H",
    "C.......C",
    "#.......#",
    "#.XXXXX.#",
    "#.......#",
    "#.......#",
    "#.......#",
    "C..XXX..C",
    "#...X...#",
    "#.......#",
    "#.......#",
    "#####HH##",
  ],
];

export const DEFAULT_GUNNERY_CONFIG: GunneryConfig = {
  decks: DEFAULT_GUNNERY_DECKS,
  tickMs: 200,
  maxTick: 760,
  maxMoves: 1000,
  maxOnDeck: 8,
  spawnEveryTicks: 8,
  spawnEveryTicksMin: 4,
  queueLength: 3,
  bag: [2, 2, 2, 1],
  fireAfterTicks: 3,
  stepPoints: 10,
  loadPoints: 100,
  comboStep: 25,
  comboCap: 8,
};

export interface GunneryPiece {
  readonly id: number;
  readonly kind: number;
  readonly col: number;
  readonly row: number;
  readonly dir: Dir;
}

/** The gunner may lay as many as they like, one per deck cell. */
export interface Arrow {
  readonly col: number;
  readonly row: number;
  readonly dir: Dir;
}

export interface Cannon {
  readonly col: number;
  readonly row: number;
  /** Pieces loaded so far in order: 0 empty, 1 powder, 2 powder+wad, 3 full. */
  readonly loaded: number;
  readonly fouled: boolean;
  /** Tick the cannon fires itself, while full. */
  readonly firesAt: number | null;
}

export type GunneryMove =
  | { readonly type: "arrow"; readonly col: number; readonly row: number; readonly dir: Dir; readonly tick: number }
  | { readonly type: "remove"; readonly col: number; readonly row: number; readonly tick: number }
  | { readonly type: "wait"; readonly tick: number }
  | { readonly type: "end"; readonly tick: number };

/** What a piece does to a cannon it rolls into. `blocked` means the cannon turns it away like a wall. */
export type CannonOutcome = "load" | "loaded" | "foul" | "clean" | "splash" | "blocked";

export interface GunneryEvent {
  readonly tick: number;
  /** `load` a step, `loaded` a full cannon, `splash` water into a clean cannon, `exit` out a hatch. */
  readonly type: "load" | "loaded" | "foul" | "clean" | "splash" | "fire" | "spawn" | "exit";
  /** Index into `cannons` for cannon events. */
  readonly cannon?: number;
  readonly pieceId?: number;
  readonly kind?: number;
  /** For `exit`, the hatch the piece went out through (it may have turned on its last step). */
  readonly col?: number;
  readonly row?: number;
  /** Points this event scored. */
  readonly points?: number;
}

export interface GunneryMoveReport {
  readonly move: GunneryMove;
  /** Everything that happened from the previous state's tick up to and including this move's tick. */
  readonly events: readonly GunneryEvent[];
  readonly points: number;
}

export interface ParsedDeck {
  readonly width: number;
  readonly height: number;
  /** Row-major, index = row * width + col. */
  readonly cells: readonly DeckCell[];
  /** The chute. */
  readonly barrel: { readonly col: number; readonly row: number };
  /** The deck cell pieces drop onto, and the way they roll from it. */
  readonly drop: { readonly col: number; readonly row: number; readonly dir: Dir };
  readonly cannons: ReadonlyArray<{ readonly col: number; readonly row: number }>;
}

export interface GunneryState {
  readonly config: GunneryConfig;
  /** Which of `config.decks` this round is played on, and that deck parsed. */
  readonly deckIndex: number;
  readonly deck: ParsedDeck;
  readonly tick: number;
  readonly pieces: readonly GunneryPiece[];
  readonly arrows: readonly Arrow[];
  readonly cannons: readonly Cannon[];
  /** Kinds the chute drops next, soonest first; always `queueLength` long. */
  readonly queue: readonly number[];
  /** What is left of the shuffled bag the queue refills from, next first. */
  readonly bag: readonly number[];
  /** Tick of the last drop. */
  readonly lastDrop: number;
  readonly nextId: number;
  readonly rng: PrngState;
  readonly moveCount: number;
  readonly score: number;
  /** Full loads in a row without a foul. */
  readonly combo: number;
  readonly bestCombo: number;
  readonly loads: number;
  readonly fouls: number;
  readonly arrowsPlaced: number;
  readonly lastMove: GunneryMoveReport | null;
  readonly finished: boolean;
}
